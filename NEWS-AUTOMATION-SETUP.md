# SA News Hub automatic news workflow

## Current behaviour

- GitHub Actions is configured to check RSS feeds every five minutes. GitHub may delay scheduled runs.
- You can also start a run manually using Actions → Automatically discover and publish verified news → Run workflow (workflow_dispatch).
- The script follows RSS links to publisher pages, extracts article text, and asks Groq to draft a new headline and 90–110 word summary.
- Automatic publication requires a trusted HTTPS publisher domain, publisher metadata, substantial extracted article text, a recent source timestamp, a valid AI draft, and passing phrase-overlap checks. Failed checks skip the story.
- Eligible stories are committed to the branch that triggered the workflow. Cloudflare Pages creates a preview for a branch; production changes only when changes reach the configured production branch.

## Required secret

Add GROQ_API_KEY under repository Settings → Secrets and variables → Actions. Never put the key in source code, commits, issues, or chat messages. GitHub Actions supplies GITHUB_TOKEN automatically.

The script currently requests Groq model openai/gpt-oss-20b. Model availability and limits can change; consult Groq's current documentation if requests fail.

## How to verify a run

A green workflow run only means the script completed; it does not prove that a story was published. Read the logs for the published-story count or reasons items were skipped. Confirm the branch's Cloudflare preview before merging into production.

## Editorial and copyright limitations

Automated phrase-overlap checks are only screening filters. They cannot guarantee originality, accuracy, legal clearance, or Google AdSense approval. AI can make mistakes. Keep publisher attribution and source links visible, and add original reporting, analysis, or useful context. AI rewriting is not a substitute for editorial review.

The five-minute schedule is a request to GitHub Actions, not a guarantee that every run starts exactly on time.