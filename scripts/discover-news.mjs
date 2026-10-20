import Parser from "rss-parser";
import nodemailer from "nodemailer";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const required = [
  "GMAIL_USER",
  "GMAIL_APP_PASSWORD",
  "NEWS_APPROVER_EMAIL",
  "GITHUB_REPOSITORY"
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const feeds = [
  {
    category: "South Africa",
    url: "https://news.google.com/rss/search?q=South+Africa+news&hl=en-ZA&gl=ZA&ceid=ZA:en"
  },
  {
    category: "World",
    url: "https://news.google.com/rss/search?q=world+news&hl=en-ZA&gl=ZA&ceid=ZA:en"
  },
  {
    category: "Politics",
    url: "https://news.google.com/rss/search?q=South+Africa+politics+parliament+government&hl=en-ZA&gl=ZA&ceid=ZA:en"
  },
  {
    category: "Markets & Forex",
    url: "https://news.google.com/rss/search?q=South+Africa+markets+forex+economy&hl=en-ZA&gl=ZA&ceid=ZA:en"
  },
  {
    category: "Sport",
    url: "https://news.google.com/rss/search?q=South+Africa+sport&hl=en-ZA&gl=ZA&ceid=ZA:en"
  },
  {
    category: "Technology",
    url: "https://news.google.com/rss/search?q=technology+news&hl=en-ZA&gl=ZA&ceid=ZA:en"
  },
  {
    category: "Economic Calendar",
    url: "https://news.google.com/rss/search?q=South+Africa+economic+data+interest+rates+inflation&hl=en-ZA&gl=ZA&ceid=ZA:en"
  }
];

const parser = new Parser({
  timeout: 20000
});

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

const repo = process.env.GITHUB_REPOSITORY;
const newStories = [];
const autoPublishedStories = [];
const aiConfigured = Boolean(process.env.GROQ_API_KEY);
const newsFilePath = "src/src/data/news.js";
const newsFileText = await readFile(newsFilePath, "utf8");
const newsMatch = newsFileText.match(/export\s+const\s+news\s*=\s*(\[[\s\S]*\])\s*;?/);
if (!newsMatch) throw new Error("Could not safely read src/src/data/news.js; refusing to publish.");
let publishedStories = JSON.parse(newsMatch[1]);

function slugify(value) {
  return value.normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function issueExists(url) {
  try {
    const output = execFileSync(
      "gh",
      [
        "issue",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--search",
        `"${url}" in:body`,
        "--json",
        "number",
        "--limit",
        "1"
      ],
      {
        encoding: "utf8"
      }
    );

    return JSON.parse(output).length > 0;
  } catch (error) {
    throw new Error(
      `Could not check the review queue safely: ${error.message}`
    );
  }
}

function publisherFromTitle(title) {
  const match = title.match(/\s+-\s+([^\-].*)$/);

  return match?.[1]?.trim().slice(0, 120) || "";
}

function cleanText(value, max = 900) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function htmlAttributes(tag) {
  const attributes = {};
  const pattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = pattern.exec(tag))) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function metaContent(html, wantedName) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = htmlAttributes(tag);
    const key = (attributes.name || attributes.property || attributes.itemprop || "").toLowerCase();
    if (key === wantedName.toLowerCase() && attributes.content) {
      return cleanText(attributes.content, 900);
    }
  }
  return "";
}

async function enrichSource(feedUrl, fallbackSummary, fallbackPublisher) {
  try {
    const response = await fetch(feedUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "SA-News-Hub/1.0 (news source metadata; contact site owner)"
      },
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) {
      throw new Error(`source returned HTTP ${response.status}`);
    }

    const finalUrl = new URL(response.url || feedUrl);
    if (finalUrl.protocol !== "https:") {
      throw new Error("source did not resolve to HTTPS");
    }

    const html = (await response.text()).slice(0, 750000);
    let canonicalUrl = "";

    for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
      const attributes = htmlAttributes(tag);
      if ((attributes.rel || "").toLowerCase().split(/\s+/).includes("canonical") && attributes.href) {
        try {
          const candidate = new URL(attributes.href, finalUrl);
          if (candidate.protocol === "https:") canonicalUrl = candidate.toString();
        } catch {
          // Ignore malformed canonical URLs and keep the resolved source URL.
        }
        if (canonicalUrl) break;
      }
    }

    const publisherDescription =
      metaContent(html, "og:description") ||
      metaContent(html, "description") ||
      metaContent(html, "twitter:description");
    const verifiedPublisherName = metaContent(html, "og:site_name");
    const summary = publisherDescription || fallbackSummary;
    const publisher = verifiedPublisherName || fallbackPublisher;

    console.log(
      `Source metadata: resolved ${feedUrl} to ${canonicalUrl || finalUrl.toString()}; description ${summary.length >= 80 ? "available" : "short/unavailable"}.`
    );

    return {
      url: canonicalUrl || finalUrl.toString(),
      summary: cleanText(summary, 450),
      publisher: cleanText(publisher, 120),
      descriptionVerified: Boolean(publisherDescription),
      publisherVerified: Boolean(verifiedPublisherName)
    };
  } catch (error) {
    console.warn(`Could not enrich source metadata: ${error.message}`);
    return {
      url: feedUrl,
      summary: fallbackSummary,
      publisher: fallbackPublisher,
      descriptionVerified: false,
      publisherVerified: false
    };
  }
}

async function createAiDraft({
  title,
  summary,
  category,
  publisher
}) {
  if (!aiConfigured) {
    return null;
  }

  if (String(summary || "").trim().length < 80) {
    throw new Error(
      "RSS snippet is too short for a responsible 90–110 word draft; held for review."
    );
  }

  const endpoint =
    "https://api.groq.com/openai/v1/chat/completions";

  let payload = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response;

    try {
      response = await fetch(endpoint, {
        method: "POST",

        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },

        signal: AbortSignal.timeout(25000),

        body: JSON.stringify({
          model: "openai/gpt-oss-20b",
          temperature: 0.2,
          max_tokens: 700,

          response_format: {
            type: "json_object"
          },

          messages: [
            {
              role: "system",

              content: [
                "You prepare cautious, original draft copy for a South African news site.",

                "Use ONLY the supplied headline and extracted publisher-provided page description/snippet. You have not independently verified the article body. Do not invent or infer facts, names, numbers, quotes, dates, causes, consequences, or claims.",

                "Write a neutral summary of 90–110 words in clear South African English, but only if the provided information genuinely supports that length without repetition or speculation.",

                "If the snippet is too thin, ambiguous, or insufficient to support a reliable summary, set needs_review to true and explain why in editorial_note. Never pad the summary with generic claims to reach the word count.",

                "Keep the category exactly as supplied. Use the supplied publisher string or an empty string; do not guess the publisher.",

                "Return only valid JSON with keys headline, summary, needs_review, editorial_note."
              ].join(" ")
            },

            {
              role: "user",

              content: JSON.stringify({
                headline: title,
                feed_snippet: summary,
                category,
                publisher
              })
            }
          ]
        })
      });
    } catch (error) {
      if (attempt === 3) {
        throw new Error(
          `Groq request failed after 3 attempts: ${error.message}`
        );
      }

      const delay = 1000 * (2 ** (attempt - 1));

      console.warn(
        `Groq network/timeout error (attempt ${attempt}/3); retrying in ${delay}ms.`
      );

      await new Promise(resolve => setTimeout(resolve, delay));

      continue;
    }

    if (!response.ok) {
      const retryable =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;

      if (!retryable || attempt === 3) {
        throw new Error(
          `Groq API returned HTTP ${response.status}${
            retryable ? " after retries" : ""
          }`
        );
      }

      const retryAfterHeader =
        response.headers.get("retry-after");

      const retryAfterSeconds = Number(retryAfterHeader);

      const retryAfterDate = retryAfterHeader
        ? Date.parse(retryAfterHeader)
        : NaN;

      const retryAfterMs =
        Number.isFinite(retryAfterSeconds) &&
        retryAfterSeconds > 0
          ? Math.min(retryAfterSeconds * 1000, 30000)
          : Number.isFinite(retryAfterDate) &&
            retryAfterDate > Date.now()
            ? Math.min(
                retryAfterDate - Date.now(),
                30000
              )
            : 1000 * (2 ** (attempt - 1));

      console.warn(
        `Groq API HTTP ${response.status} (attempt ${attempt}/3); retrying in ${retryAfterMs}ms.`
      );

      await new Promise(resolve => setTimeout(resolve, retryAfterMs));

      continue;
    }

    try {
      payload = await response.json();
    } catch {
      throw new Error("Groq API returned invalid JSON.");
    }

    break;
  }

  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error("Groq API returned no draft text.");
  }

  const jsonText = content
    .trim()
    .replace(/^\x60{3}(?:json)?\s*/i, "")
    .replace(/\s*\x60{3}$/i, "");

  let draft;

  try {
    draft = JSON.parse(jsonText);
  } catch {
    throw new Error("Groq draft was not valid JSON.");
  }

  const headline = cleanText(draft.headline, 160);
  const draftSummary = cleanText(draft.summary, 1200);

  const wordCount = draftSummary
    .split(/\s+/)
    .filter(Boolean)
    .length;

  if (draft.needs_review !== false) {
    throw new Error(
      "Groq flagged this item for editorial review."
    );
  }

  if (
    headline.length < 8 ||
    wordCount < 90 ||
    wordCount > 110
  ) {
    throw new Error(
      `Draft validation failed (headline length or summary word count: ${wordCount}; expected 90–110 words).`
    );
  }

  return {
    headline,
    summary: draftSummary,

    editorialNote:
      cleanText(draft.editorial_note, 350) ||
      "AI-generated from the RSS headline/snippet only; verify the full original report before relying on it."
  };
}

for (const feed of feeds) {
  try {
    const parsed = await parser.parseURL(feed.url);

    for (const item of (parsed.items || []).slice(0, 5)) {
      const title = cleanText(item.title, 250);
      const feedUrl = cleanText(item.link, 1000);

      if (
        !title ||
        !feedUrl ||
        !/^https?:\/\//i.test(feedUrl)
      ) {
        continue;
      }

      const published =
        item.isoDate ||
        item.pubDate ||
        "Date not supplied by source";

      const feedSummaryFallback = cleanText(
        item.contentSnippet ||
          item.summary ||
          "Open the original source to review the full report.",
        450
      );

      const publisherFallback = publisherFromTitle(title);
      const enrichedSource = await enrichSource(
        feedUrl,
        feedSummaryFallback,
        publisherFallback
      );
      const url = enrichedSource.url;
      const feedSummary = enrichedSource.summary || feedSummaryFallback;
      const publisher = enrichedSource.publisher || publisherFallback;
      const publishedDateMs = Date.parse(published);
      let normalizedSourceUrl = "";
      try {
        const parsedSourceUrl = new URL(url);
        if (parsedSourceUrl.protocol === "https:") normalizedSourceUrl = parsedSourceUrl.toString();
      } catch {
        // Invalid source URLs are held out of publication.
      }
      if (!normalizedSourceUrl) {
        console.warn(`Skipping item without a valid HTTPS publisher URL: ${title}`);
        continue;
      }
      if (publishedStories.some(story => story.sourceUrl === normalizedSourceUrl)) continue;

      let draft = null;

      let draftStatus =
        "AI draft not configured — add the GROQ_API_KEY repository secret described in NEWS-AUTOMATION-SETUP.md.";

      if (aiConfigured) {
        try {
          draft = await createAiDraft({
            title,
            summary: feedSummary,
            category: feed.category,
            publisher
          });

          draftStatus =
            "AI draft generated from the RSS headline and snippet. It has not been independently fact-checked.";
        } catch (error) {
          console.error(
            `AI draft failed for one story (${feed.category}): ${error.message}`
          );

          draftStatus =
            "AI draft failed for this item; fill the publication draft manually or reject this story.";
        }
      }

      // Auto-publish only when a draft passed validation and the original publisher
      // supplied its own description and site name. Uncertain stories stay in review.
      const sourceHost = new URL(normalizedSourceUrl).hostname.toLowerCase();
      const isRecent =
        Number.isFinite(publishedDateMs) &&
        publishedDateMs <= Date.now() + 5 * 60 * 1000 &&
        Date.now() - publishedDateMs <= 72 * 60 * 60 * 1000;
      const safeForAutoPublish =
        Boolean(draft) &&
        enrichedSource.descriptionVerified &&
        enrichedSource.publisherVerified &&
        feedSummary.length >= 150 &&
        publisher.length > 1 &&
        isRecent &&
        !sourceHost.endsWith("news.google.com");

      if (safeForAutoPublish) {
        let slug = slugify(draft.headline) || "news";
        if (publishedStories.some(story => story.slug === slug) ||
            autoPublishedStories.some(story => story.slug === slug)) {
          slug = slug + "-" + Date.now().toString(36);
        }
        const story = {
          slug,
          title: draft.headline,
          category: feed.category,
          summary: draft.summary,
          publisher,
          sourceUrl: normalizedSourceUrl,
          publishedAt: new Date(publishedDateMs).toISOString()
        };
        autoPublishedStories.push(story);
        publishedStories.unshift(story);
        console.log(`Eligible for automatic publication: [${feed.category}] ${draft.headline}`);
        continue;
      }

      if (issueExists(normalizedSourceUrl)) {
        continue;
      }

      const body = [
        "## Pending editorial review",
        "",

        "**Status:** PENDING — this story is not published on SA News Hub.",

        `**Category:** ${feed.category}`,

        `**Feed:** ${parsed.title || "Google News RSS"}`,

        `**Published:** ${published}`,

        `**AI preparation:** ${draftStatus}`,

        "",

        "### Feed summary",
        feedSummary,

        "",

        "### Original story link",
        url,

        "",

        "### Quick review checklist",

        "- [ ] Open the source link and check that the article is real, current, and relevant.",

        "- [ ] Compare the draft with the source; reject it if the draft adds unsupported details or gets anything wrong.",

        "- [ ] If it looks good, comment exactly /approve. If not, close the issue without approving it.",

        "",

        "### Publication draft",
        "",

        "The draft is a starting point, not independent verification. The AI only receives the RSS headline and snippet, which may omit important context.",

        ...(draft?.editorialNote
          ? [`**AI note:** ${draft.editorialNote}`, ""]
          : []),

        "#### Approved headline",

        draft?.headline ||
          `[AI draft unavailable — suggested feed headline: ${title}]`,

        "",

        "#### Publication category",
        feed.category,

        "",

        "#### Original summary",

        draft?.summary ||
          `[Draft unavailable. Feed summary: ${feedSummary}]`,

        "",

        "#### Publisher attribution",

        publisher ||
          "[Check the original article and enter the publisher name]",

        "",

        "#### Original source URL",
        url,

        "",

        "Commenting /approve prepares a pull request; it does not publish immediately. The story becomes live only after you review and merge that pull request into main."
      ].join("\n");

      const issueUrl = execFileSync(
        "gh",
        [
          "issue",
          "create",
          "--repo",
          repo,

          "--title",
          `[Pending review] [${feed.category}] ${(draft?.headline || title).slice(0, 150)}`,

          "--body",
          body
        ],
        {
          encoding: "utf8"
        }
      ).trim();

      newStories.push({
        category: feed.category,
        title: draft?.headline || title,
        url,
        published,
        summary: draft?.summary || feedSummary,
        issueUrl,
        ai: Boolean(draft)
      });
    }
  } catch (error) {
    console.error(
      `Feed failed (${feed.category}): ${error.message}`
    );
  }
}

if (autoPublishedStories.length) {
  const updatedNewsFile = "export const news = " + JSON.stringify(publishedStories, null, 2) + ";\n";
  await writeFile(newsFilePath, updatedNewsFile, "utf8");
  execFileSync("git", ["config", "user.name", "github-actions[bot]"]);
  execFileSync("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
  execFileSync("git", ["add", newsFilePath]);
  execFileSync("git", ["commit", "-m", `Publish ${autoPublishedStories.length} verified news story/stories`]);
  execFileSync("git", ["push", "origin", "HEAD:main"]);
  console.log(`Published ${autoPublishedStories.length} story/stories to src/src/data/news.js.`);
}

if (newStories.length) {
  const reviewRows = newStories
    .map(story =>
      "• HELD FOR REVIEW [" +
      story.category +
      "]: " +
      story.title +
      "\n  Source: " +
      story.url +
      "\n  Review issue: " +
      story.issueUrl +
      "\n  AI draft: " +
      (story.ai
        ? "prepared but not independently verified"
        : "not available") +
      "\n  Summary: " +
      story.summary +
      "\n"
    )
    .join("\n");

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.NEWS_APPROVER_EMAIL,

    subject:
      "SA News Hub: " +
      newStories.length +
      " stories held for editorial review",

    text:
      (autoPublishedStories.length
        ? "Automatically published after strict checks:\n\n" +
          autoPublishedStories.map(story => "• " + story.title + "\n  " + story.sourceUrl).join("\n\n") + "\n\n"
        : "") +
      "Stories held for editorial review:\n\n" +
      reviewRows +
      "\\nReview queue: https://github.com/" +
      repo +
      "\\nLive site: https://sa-news-hub.pages.dev/\\n\\nOnly stories with a recent timestamp, direct HTTPS publisher page, publisher-provided description and site name, and a validated AI draft are auto-published."
  });

  console.log(
    "Created " +
    newStories.length +
    " editorial review issue(s); email notification sent."
  );
} else {
  console.log("No new stories found; no email sent.");
                   }
