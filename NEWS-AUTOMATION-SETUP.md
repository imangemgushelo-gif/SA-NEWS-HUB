# SA News Hub: news discovery, AI drafts, and editorial approval

## What this automation does

- Checks RSS-based Google News searches for South Africa, world news, markets/forex, sport, technology, and economic news.
- Runs on a five-minute GitHub Actions schedule (GitHub may delay scheduled runs).
- Creates one GitHub Issue per newly discovered source URL as the review queue.
- If the Groq API key is configured, tries to resolve the publisher's original page and extract its public description before preparing an original headline and summary. If AI or page metadata is unavailable, it still creates a review issue and reports the missing draft.
- Emails a notification when new pending issues are created.
- Keeps discovery separate from publishing. Nothing is published just because an issue is created. Only the repository owner can comment exactly `/approve`; that prepares a pull request, and the story goes live only after that pull request is reviewed and merged into `main`.

## One-time Gmail setup

1. Sign in to the Gmail account that will send alerts.
2. Enable 2-Step Verification on that Google account, if available.
3. Create a Google **App Password** for this workflow in your Google Account security settings. Use the app password, not your normal Gmail password. If Google does not offer App Passwords for your account, do not weaken account security; choose another mail delivery method before enabling notifications.
4. Open this repository on GitHub, then go to **Settings → Secrets and variables → Actions → New repository secret**.
5. Add these three repository secrets:
   - `GMAIL_USER`: the sending Gmail address.
   - `GMAIL_APP_PASSWORD`: the Gmail App Password (paste it without spaces if Google displays it grouped).
   - `NEWS_APPROVER_EMAIL`: the address that should receive review alerts. This can be the same Gmail address.
6. Open **Actions**, select **Discover news and request approval**, and choose **Run workflow** to test it.

Do not put passwords or app passwords in source files, issues, commits, or chat messages.

## Enable Groq AI draft preparation

Add the `GROQ_API_KEY` repository secret to enable AI draft preparation. Without it, discovery still works but items stay in the review queue.

1. Create an API key in your Groq account. Check the current model availability and pricing on the official Groq documentation before relying on it.
2. In GitHub, open **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `GROQ_API_KEY`: your Groq API key. Never commit it to source code or share it in issues.
3. The workflow uses Groq's OpenAI-compatible chat completions endpoint and the `openai/gpt-oss-20b` model. It retries transient network errors, HTTP 408/429 responses, and server errors up to three attempts with backoff.
4. Drafts are validated for JSON shape, a 90–110 word summary, and the model's explicit `needs_review: false` result. Insufficient RSS snippets or any failed validation are held for review rather than auto-published.

## Important editorial limitation

The AI sees only a Google News RSS headline and short snippet, not necessarily the full article. It can make mistakes or miss context, and it cannot independently confirm breaking news. Treat its draft as a starting point. Open the source link, verify the key facts, and reject the issue if the story or draft looks wrong. Never approve a story you have not checked.

## Publishing stories

News discovery and publication are deliberately separate so unverified RSS headlines do not go live by themselves.

1. The discovery workflow checks public RSS feeds, tries to resolve each Google News result to the publisher's original HTTPS page, and extracts a public page description when available.
2. It creates a pending GitHub Issue and emails the review queue. Groq can prepare an original draft from the headline and available page metadata, but that draft is not independent fact-checking.
3. Open the original publisher article and verify the key facts, dates, names, figures, and relevance. Fill in any missing draft fields in the issue.
4. Only the repository owner can comment exactly `/approve` on an open pending-review issue.
5. The approval workflow validates the headline, category, summary, publisher attribution, and HTTPS source URL, then creates a publication pull request.
6. Review and merge that pull request into `main`. The story is added to `src/src/data/news.js`; the site shows it after the configured Cloudflare Pages deployment finishes.

The publication workflow supports these categories: South Africa, World, Politics, Markets & Forex, Sport, Technology, and Economic Calendar. Duplicate source URLs are rejected. An issue or AI draft by itself does not publish anything. If the original source cannot be verified or the summary is incomplete, do not approve the story.

## Notes

- GitHub scheduled workflows can be delayed, so the schedule is not a guaranteed five-minute delivery service.
- Discovery uses public RSS results and can miss stories, repeat near-duplicates, or return snippets that need verification.
- The first successful run after setup may create a batch of recent stories that were not previously queued.
