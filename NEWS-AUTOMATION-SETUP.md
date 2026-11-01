# SA News Hub automatic news workflow

## Current behaviour

- GitHub Actions checks RSS feeds every 30 minutes. GitHub may delay scheduled runs.
- You can also start a run manually using Actions → Automatically discover and publish verified news → Run workflow (workflow_dispatch).
- The workflow follows RSS links to publisher pages, extracts article text, and asks Groq to draft a new headline and summary.
- Automatic publication requires a successful AI draft and the source checks in scripts/discover-news.mjs. Failed or incomplete items should be skipped.
- Eligible stories are committed to the branch that triggered the workflow. Cloudflare Pages creates a preview for a branch; production changes only when changes reach the configured production branch.

## Required secret

Add GROQ_API_KEY under repository Settings → Secrets and variables → Actions. Never put the key in source code, commits, issues, or chat messages. GitHub Actions supplies GITHUB_TOKEN automatically.

The script currently requests Groq model openai/gpt-oss-20b. Model availability and limits can change; consult Groq's current documentation if requests fail.

## How to verify a run

A green workflow run only means the script completed; it does not prove that a story was published. Read the logs for the number of stories published and for reasons items were skipped. Confirm the branch's Cloudflare preview before merging changes into the production branch.

## Editorial and copyright limitations

Automated phrase-overlap checks are only a warning filter. They cannot guarantee that a summary is original, accurate, legally cleared, or suitable for Google AdSense. AI can make mistakes. Keep publisher attribution and source links visible, and add original reporting, analysis, or useful context. Do not treat AI rewriting as a substitute for editorial review.

The schedule is every 30 minutes, not every five minutes. Scheduled GitHub Actions runs are not guaranteed to start at the exact minute.
