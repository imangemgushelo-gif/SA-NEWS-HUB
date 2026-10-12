import { readFile } from "node:fs/promises";

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const eventPath = process.env.GITHUB_EVENT_PATH;

if (!token || !repo || !eventPath) throw new Error("Missing GitHub workflow environment.");

const event = JSON.parse(await readFile(eventPath, "utf8"));
const owner = repo.split("/")[0];
const issue = event.issue;
const comment = event.comment;
const sender = event.sender?.login || "";

if (!issue || issue.pull_request || !comment || comment.body?.trim() !== "/approve") {
  throw new Error("This workflow only accepts the exact /approve command on an issue.");
}
if (sender.toLowerCase() !== owner.toLowerCase()) throw new Error("Only the repository owner can approve publication.");
if (!String(issue.title || "").startsWith("[Pending review]")) throw new Error("This is not a pending news-review issue.");
if (issue.state !== "open") throw new Error("Only open review issues can be approved.");

const apiBase = "https://api.github.com";
const headers = {
  Authorization: "Bearer " + token,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28"
};

async function api(path, options = {}) {
  const response = await fetch(apiBase + "/repos/" + repo + path, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
      ...(options.body ? { "Content-Type": "application/json" } : {})
    }
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) throw new Error("GitHub API " + response.status + ": " + (data.message || response.statusText));
  return data;
}

function section(body, heading) {
  const marker = "#### " + heading;
  const start = body.indexOf(marker);
  if (start < 0) return "";
  const contentStart = start + marker.length;
  const next = body.indexOf("\n#### ", contentStart);
  return body.slice(contentStart, next < 0 ? body.length : next).trim();
}
function clean(value) { return value.replace(/^\s*[-*]?\s*/, "").trim(); }

const body = issue.body || "";
const title = clean(section(body, "Approved headline"));
const category = clean(section(body, "Publication category"));
const summary = clean(section(body, "Original summary"));
const publisher = clean(section(body, "Publisher attribution"));
const sourceUrl = clean(section(body, "Original source URL"));
const allowedCategories = ["South Africa", "World", "Markets & Forex", "Sport", "Technology", "Economic Calendar"];

if (!title || title.includes("[") || title.length < 8 || title.length > 160) {
  throw new Error("Fill in Approved headline with a real headline (8–160 characters) before using /approve.");
}
if (!allowedCategories.includes(category)) throw new Error("Choose one exact category: " + allowedCategories.join(", "));
if (!summary || summary.includes("[") || summary.length < 40 || summary.length > 900) {
  throw new Error("Write an original, fact-checked summary of 40–900 characters before using /approve.");
}
if (!publisher || publisher.includes("[") || publisher.length > 120) throw new Error("Fill in Publisher attribution with the original publisher's name.");
let parsedUrl;
try { parsedUrl = new URL(sourceUrl); } catch { throw new Error("Fill in Original source URL with a valid HTTPS article link."); }
if (parsedUrl.protocol !== "https:") throw new Error("The original source URL must use HTTPS.");

const contentPath = "/contents/src/src/data/news.js";
const file = await api(contentPath);
const existingText = Buffer.from(file.content, "base64").toString("utf8");
const match = existingText.match(/export\s+const\s+news\s*=\s*(\[[\s\S]*\])\s*;?/);
if (!match) throw new Error("Could not safely read the published-news data file; no changes were made.");
let stories;
try { stories = JSON.parse(match[1]); } catch { throw new Error("Published-news data is not valid JSON; no changes were made."); }

const normalizedUrl = parsedUrl.toString();
if (stories.some((story) => story.sourceUrl === normalizedUrl)) {
  await api("/issues/" + issue.number + "/comments", {
    method: "POST",
    body: JSON.stringify({ body: "This source URL is already in the published-news data. No duplicate publication pull request was created." })
  });
  console.log("This source has already been added; no duplicate was created.");
  process.exit(0);
}

function slugify(value) {
  return value.normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}
let slug = slugify(title) || ("news-" + issue.number);
if (stories.some((story) => story.slug === slug)) slug = slug + "-issue-" + issue.number;

const newStory = {
  slug,
  title,
  category,
  summary,
  publisher,
  sourceUrl: normalizedUrl,
  publishedAt: new Date().toISOString()
};
const updatedText = "export const news = " + JSON.stringify([newStory, ...stories], null, 2) + ";\n";
const branch = "news/approved-issue-" + issue.number;
const mainRef = await api("/git/ref/heads/main");
await api("/git/refs", {
  method: "POST",
  body: JSON.stringify({ ref: "refs/heads/" + branch, sha: mainRef.object.sha })
});
await api(contentPath, {
  method: "PUT",
  body: JSON.stringify({
    message: "Prepare approved news story: " + title.slice(0, 65),
    content: Buffer.from(updatedText, "utf8").toString("base64"),
    sha: file.sha,
    branch
  })
});
const pr = await api("/pulls", {
  method: "POST",
  body: JSON.stringify({
    title: "Publish news: " + title.slice(0, 150),
    head: branch,
    base: "main",
    body: [
      "## Publication review",
      "",
      "This pull request was created after the repository owner explicitly commented /approve on the pending story issue.",
      "",
      "**This story is not live yet.** Review the title, original summary, category, and source attribution below. Merge this pull request only when you want the story published.",
      "",
      "- Category: " + category,
      "- Source: " + normalizedUrl,
      "- Publisher: " + publisher,
      "- Review issue: #" + issue.number,
      "",
      "Closes #" + issue.number
    ].join("\n")
  })
});
await api("/issues/" + issue.number + "/comments", {
  method: "POST",
  body: JSON.stringify({
    body: "A publication pull request is ready: " + pr.html_url + "\n\nThe story is **not live yet**. Review the pull request and merge it only when you're ready to publish. Merging into main is the final publishing step."
  })
});
console.log("Created publication pull request: " + pr.html_url);
