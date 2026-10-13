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
const categories = feeds.map((feed) => feed.category);

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
        "",
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

if (newStories.length) {
  const rows = newStories.map((story) =>
    `• ${story.category}: ${story.title}\n  Source: ${story.url}\n  Review / approval queue: ${story.issueUrl}\n  Published: ${story.published}\n  AI draft: ${story.ai ? "prepared; still needs your source check" : "not available"}\n  Summary: ${story.summary}\n`
  ).join("\n");
  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.NEWS_APPROVER_EMAIL,
    subject: `SA News Hub: ${newStories.length} new story/stories awaiting your approval`,
    text: `New stories were found and added to the pending review queue. None have been published.\n\n${rows}\nReview all issues: https://github.com/${repo}/issues\n\nOpen the original source and check the draft before approving. Comment /approve only when you want a publication pull request prepared.`
  });
  console.log(`Created ${newStories.length} pending issue(s) and sent email notification.`);
} else {
  console.log("No new stories found; no email sent.");
}
