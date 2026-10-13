import Parser from "rss-parser";
import nodemailer from "nodemailer";
import { execFileSync } from "node:child_process";

const required = ["GMAIL_USER", "GMAIL_APP_PASSWORD", "NEWS_APPROVER_EMAIL", "GITHUB_REPOSITORY"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}

const feeds = [
  { category: "South Africa", url: "https://news.google.com/rss/search?q=South+Africa+news&hl=en-ZA&gl=ZA&ceid=ZA:en" },
  { category: "World", url: "https://news.google.com/rss/search?q=world+news&hl=en-ZA&gl=ZA&ceid=ZA:en" },
  { category: "Markets & Forex", url: "https://news.google.com/rss/search?q=South+Africa+markets+forex+economy&hl=en-ZA&gl=ZA&ceid=ZA:en" },
  { category: "Sport", url: "https://news.google.com/rss/search?q=South+Africa+sport&hl=en-ZA&gl=ZA&ceid=ZA:en" },
  { category: "Technology", url: "https://news.google.com/rss/search?q=technology+news&hl=en-ZA&gl=ZA&ceid=ZA:en" },
  { category: "Economic Calendar", url: "https://news.google.com/rss/search?q=South+Africa+economic+data+interest+rates+inflation&hl=en-ZA&gl=ZA&ceid=ZA:en" }
];

const parser = new Parser({ timeout: 20000 });
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
});
const repo = process.env.GITHUB_REPOSITORY;
const newStories = [];
const aiConfigured = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);

const autoPublished = [];
const trustedPublishers = {
  "enca.com": "eNCA", "news24.com": "News24", "timeslive.co.za": "TimesLIVE",
  "dailymaverick.co.za": "Daily Maverick", "sowetanlive.co.za": "Sowetan",
  "citizen.co.za": "The Citizen", "businesstech.co.za": "BusinessTech",
  "businessday.co.za": "Business Day", "businesslive.co.za": "BusinessLIVE",
  "mg.co.za": "Mail & Guardian", "mailandguardian.co.za": "Mail & Guardian",
  "iol.co.za": "IOL", "ewn.co.za": "Eyewitness News", "sabcnews.com": "SABC News",
  "mybroadband.co.za": "MyBroadband", "techcentral.co.za": "TechCentral",
  "sport24.co.za": "Sport24", "supersport.com": "SuperSport",
  "reuters.com": "Reuters", "apnews.com": "Associated Press", "bbc.com": "BBC",
  "bbc.co.uk": "BBC", "theguardian.com": "The Guardian", "aljazeera.com": "Al Jazeera",
  "dw.com": "Deutsche Welle", "france24.com": "France 24", "cnn.com": "CNN",
  "npr.org": "NPR", "theconversation.com": "The Conversation", "reliefweb.int": "ReliefWeb",
  "who.int": "World Health Organization", "un.org": "United Nations",
  "uct.ac.za": "University of Cape Town", "wits.ac.za": "University of the Witwatersrand",
  "techcrunch.com": "TechCrunch", "arstechnica.com": "Ars Technica",
  "wired.com": "WIRED", "theverge.com": "The Verge", "nature.com": "Nature",
  "science.org": "Science", "ft.com": "Financial Times", "bloomberg.com": "Bloomberg",
  "cnbc.com": "CNBC", "espn.com": "ESPN", "formula1.com": "Formula 1",
  "olympics.com": "Olympics", "fifa.com": "FIFA"
};

function trustedPublisher(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  for (const [domain, publisher] of Object.entries(trustedPublishers)) {
    if (host === domain || host.endsWith("." + domain)) return publisher;
  }
  return "";
}

async function resolveTrustedSource(url) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { "User-Agent": "SA-News-Hub-Bot/1.0 (+https://sa-news-hub.pages.dev/)" },
    signal: AbortSignal.timeout(15000)
  });
  let finalUrl;
  try { finalUrl = new URL(response.url || url); } catch { return null; }
  if (!response.ok || finalUrl.protocol !== "https:") return null;
  const publisher = trustedPublisher(finalUrl.hostname);
  if (!publisher) return null;
  return { url: finalUrl.toString(), publisher };
}

async function autoPublishStory({ title, category, summary, sourceUrl, publisher }) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is missing");
  if (!title || title.length < 8 || title.length > 160 || title.includes("[") ||
      !summary || summary.length < 40 || summary.length > 900 ||
      !["South Africa", "World", "Markets & Forex", "Sport", "Technology", "Economic Calendar"].includes(category)) {
    throw new Error("Draft failed basic content validation");
  }

  const apiUrl = "https://api.github.com/repos/" + repo + "/contents/src/data/news.js";
  const headers = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const getResponse = await fetch(apiUrl, { headers });
  const raw = await getResponse.text();
  let file;
  try { file = JSON.parse(raw); } catch { throw new Error("Could not read published news data"); }
  if (!getResponse.ok || !file.content || !file.sha) throw new Error("Could not read published news data (HTTP " + getResponse.status + ")");
  const existingText = Buffer.from(file.content, "base64").toString("utf8");
  const match = existingText.match(/export\s+const\s+news\s*=\s*(\[[\s\S]*\])\s*;?/);
  if (!match) throw new Error("Published news data format was not recognized");
  let stories;
  try { stories = JSON.parse(match[1]); } catch { throw new Error("Published news data is invalid JSON"); }

  const normalizedUrl = new URL(sourceUrl).toString();
  const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (stories.some(story =>
    story.sourceUrl === normalizedUrl ||
    String(story.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === normalizedTitle
  )) return "duplicate";

  const slugify = value => value.normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "").trim().replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 70);
  let slug = slugify(title) || ("news-" + Date.now());
  if (stories.some(story => story.slug === slug)) slug += "-" + Date.now().toString().slice(-6);

  const story = {
    slug, title, category, summary, publisher,
    sourceUrl: normalizedUrl,
    publishedAt: new Date().toISOString()
  };
  const updatedText = "export const news = " + JSON.stringify([story, ...stories], null, 2) + ";\n";
  const putResponse = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Auto-publish checked news: " + title.slice(0, 65),
      content: Buffer.from(updatedText, "utf8").toString("base64"),
      sha: file.sha,
      branch: "main"
    })
  });
  const putText = await putResponse.text();
  if (!putResponse.ok) throw new Error("Publishing failed (HTTP " + putResponse.status + "): " + putText.slice(0, 200));
  return "published";
}


function issueExists(url) {
  try {
    const output = execFileSync("gh", [
      "issue", "list", "--repo", repo, "--state", "all",
      "--search", `"${url}" in:body`, "--json", "number", "--limit", "1"
    ], { encoding: "utf8" });
    return JSON.parse(output).length > 0;
  } catch (error) {
    throw new Error(`Could not check the review queue safely: ${error.message}`);
  }
}

function publisherFromTitle(title) {
  const match = title.match(/\s+-\s+([^\-].*)$/);
  return match?.[1]?.trim().slice(0, 120) || "";
}

function cleanText(value, max = 900) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function createAiDraft({ title, summary, category, publisher }) {
  if (!aiConfigured) return null;

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)}/ai/v1/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    signal: AbortSignal.timeout(25000),
    body: JSON.stringify({
      model: "@cf/zai-org/glm-4.7-flash",
      temperature: 0.2,
      max_tokens: 650,
      messages: [
        {
          role: "system",
          content: [
            "You prepare cautious draft copy for a small South African news site.",
            "Use ONLY the provided RSS headline and short feed snippet. Do not add facts, names, numbers, quotes, dates, causes, or claims not present in those inputs.",
            "Do not copy the headline verbatim if a clearer accurate version is possible.",
            "The summary must be original, neutral, and 40-900 characters. If the snippet is too thin, clearly say the brief feed information is limited instead of inventing details.",
            "Keep the category exactly as supplied. Do not guess the publisher; use the supplied publisher string or an empty string.",
            "Return ONLY valid JSON with keys headline, summary, editorial_note. No markdown fences."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({ headline: title, feed_snippet: summary, category, publisher })
        }
      ]
    })
  });

  if (!response.ok) throw new Error(`Cloudflare AI returned HTTP ${response.status}`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Cloudflare AI returned no draft text.");
  const jsonText = content.trim().replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/i, "");
  const draft = JSON.parse(jsonText);
  const headline = cleanText(draft.headline, 160);
  const draftSummary = cleanText(draft.summary, 900);
  if (headline.length < 8 || draftSummary.length < 40) throw new Error("AI draft did not meet the minimum headline/summary checks.");
  return {
    headline,
    summary: draftSummary,
    editorialNote: cleanText(draft.editorial_note, 350) || "AI-generated from the RSS feed only; verify every detail at the original publisher."
  };
}

for (const feed of feeds) {
  try {
    const parsed = await parser.parseURL(feed.url);
    for (const item of (parsed.items || []).slice(0, 5)) {
      const title = cleanText(item.title, 250);
      const url = cleanText(item.link, 1000);
      if (!title || !url || !/^https?:\/\//i.test(url)) continue;
      if (issueExists(url)) continue;

      const published = item.isoDate || item.pubDate || "Date not supplied by source";
      const feedSummary = cleanText(item.contentSnippet || item.summary || "Open the original source to review the full report.", 450);
      const publisher = publisherFromTitle(title);
      let draft = null;
      let draftStatus = "AI draft not configured — add the Cloudflare secrets described in NEWS-AUTOMATION-SETUP.md.";
      if (aiConfigured) {
        try {
          draft = await createAiDraft({ title, summary: feedSummary, category: feed.category, publisher });
          draftStatus = "AI draft generated from the RSS headline and snippet. It has not been independently fact-checked.";
        } catch (error) {
          console.error(`AI draft failed for one story (${feed.category}): ${error.message}`);
          draftStatus = "AI draft failed for this item; fill the publication draft manually or reject this story.";
        }
      }

      // Publish only when AI returned a complete draft and the resolved source is on the trusted allowlist.
      // Any failed or uncertain check falls back to the existing pending-review issue.
      if (draft) {
        try {
          const verified = await resolveTrustedSource(url);
          if (verified) {
            const result = await autoPublishStory({
              title: draft.headline,
              category: feed.category,
              summary: draft.summary,
              sourceUrl: verified.url,
              publisher: verified.publisher
            });
            if (result === "published") {
              autoPublished.push({ category: feed.category, title: draft.headline, sourceUrl: verified.url, publisher: verified.publisher });
              console.log("Auto-published checked story (" + feed.category + "): " + draft.headline);
              continue;
            }
            if (result === "duplicate") {
              console.log("Skipped already-published duplicate: " + draft.headline);
              continue;
            }
          } else {
            draftStatus = "Held for review: source did not resolve to an approved publisher.";
          }
        } catch (error) {
          console.error("Automatic publishing checks failed (" + feed.category + "): " + error.message);
          draftStatus = "Held for review: automatic publishing checks could not be completed.";
        }
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
        ...(draft?.editorialNote ? [`**AI note:** ${draft.editorialNote}`, ""] : []),
        "#### Approved headline",
        draft?.headline || `[AI draft unavailable — suggested feed headline: ${title}]`,
        "",
        "#### Publication category",
        feed.category,
        "",
        "#### Original summary",
        draft?.summary || `[Draft unavailable. Feed summary: ${feedSummary}]`,
        "",
        "#### Publisher attribution",
        publisher || "[Check the original article and enter the publisher name]",
        "",
        "#### Original source URL",
        url,
        "",
        "Commenting /approve prepares a pull request; it does not publish immediately. The story becomes live only after you review and merge that pull request into main."
      ].join("\n");

      const issueUrl = execFileSync("gh", [
        "issue", "create", "--repo", repo,
        "--title", `[Pending review] [${feed.category}] ${(draft?.headline || title).slice(0, 150)}`,
        "--body", body
      ], { encoding: "utf8" }).trim();

      newStories.push({ category: feed.category, title: draft?.headline || title, url, published, summary: draft?.summary || feedSummary, issueUrl, ai: Boolean(draft) });
    }
  } catch (error) {
    console.error(`Feed failed (${feed.category}): ${error.message}`);
  }
}

if (newStories.length || autoPublished.length) {
  const publishedRows = autoPublished.map(story =>
    "• AUTO-PUBLISHED [" + story.category + "]: " + story.title + "\n  Publisher: " + story.publisher + "\n  Source: " + story.sourceUrl + "\n"
  ).join("\n");
  const reviewRows = newStories.map(story =>
    "• HELD FOR REVIEW [" + story.category + "]: " + story.title + "\n  Source: " + story.url + "\n  Review issue: " + story.issueUrl + "\n  AI draft: " + (story.ai ? "prepared but not independently verified" : "not available") + "\n  Summary: " + story.summary + "\n"
  ).join("\n");
  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.NEWS_APPROVER_EMAIL,
    subject: "SA News Hub: " + autoPublished.length + " auto-published, " + newStories.length + " held for review",
    text: "Automatic publishing results:\n\n" +
      (publishedRows || "No stories auto-published this run.\n") +
      "\nStories held for review:\n\n" +
      (reviewRows || "No stories held for review this run.\n") +
      "\nReview queue: https://github.com/" + repo + "/issues\nLive site: https://sa-news-hub.pages.dev/\n\nOnly stories with a valid AI draft and a resolved source on the trusted publisher allowlist are auto-published."
  });
  console.log("Auto-published " + autoPublished.length + " story/stories; created " + newStories.length + " review issue(s).");
} else {
  console.log("No new stories found; no email sent.");
}
