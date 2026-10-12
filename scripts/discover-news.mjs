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

for (const feed of feeds) {
  try {
    const parsed = await parser.parseURL(feed.url);
    for (const item of (parsed.items || []).slice(0, 5)) {
      const title = (item.title || "").trim();
      const url = (item.link || "").trim();
      if (!title || !url || !/^https?:\/\//i.test(url)) continue;
      if (issueExists(url)) continue;

      const published = item.isoDate || item.pubDate || "Date not supplied by source";
      const summary = (item.contentSnippet || item.summary || "Open the original source to review the full report.")
        .replace(/\s+/g, " ").slice(0, 450);
      const body = [
        "## Pending editorial review",
        "",
        "**Status:** PENDING — this story is not published on SA News Hub.",
        `**Category:** ${feed.category}`,
        `**Source:** ${parsed.title || "Google News RSS"}`,
        `**Published:** ${published}`,
        "",
        "### Feed summary",
        summary,
        "",
        "### Original story",
        url,
        "",
        "### Editorial checklist",
        "- [ ] Verify the story against the original publisher.",
        "- [ ] Check the date, accuracy, and relevance.",
        "- [ ] Write an original short summary and credit the publisher.",
        "- [ ] Explicitly approve before any publication workflow is added.",
        "",
        "Closing or commenting on this issue does not publish it. Publishing is not automated by this workflow."
      ].join("\n");

      const issueUrl = execFileSync("gh", [
        "issue", "create", "--repo", repo,
        "--title", `[Pending review] [${feed.category}] ${title.slice(0, 160)}`,
        "--body", body
      ], { encoding: "utf8" }).trim();

      newStories.push({ category: feed.category, title, url, published, summary, issueUrl });
    }
  } catch (error) {
    console.error(`Feed failed (${feed.category}): ${error.message}`);
  }
}

if (newStories.length) {
  const rows = newStories.map((story) =>
    `• ${story.category}: ${story.title}\n  Source: ${story.url}\n  Review / approval queue: ${story.issueUrl}\n  Published: ${story.published}\n  Summary: ${story.summary}\n`
  ).join("\n");
  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.NEWS_APPROVER_EMAIL,
    subject: `SA News Hub: ${newStories.length} new story/stories awaiting your approval`,
    text: `New stories were found and added to the pending review queue. None have been published.\n\n${rows}\nReview all issues: https://github.com/${repo}/issues\n\nPlease verify each story at its original publisher before approving it.`
  });
  console.log(`Created ${newStories.length} pending issue(s) and sent email notification.`);
} else {
  console.log("No new stories found; no email sent.");
}
