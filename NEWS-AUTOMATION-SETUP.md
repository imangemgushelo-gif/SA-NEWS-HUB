# SA News Hub: news discovery, AI drafts, and editorial approval

## What this automation does

- Checks RSS-based Google News searches for South Africa, world news, markets/forex, sport, technology, and economic news.
- Runs on a five-minute GitHub Actions schedule (GitHub may delay scheduled runs).
- Creates one GitHub Issue per newly discovered source URL as the review queue.
- If Cloudflare AI secrets are configured, prepares a headline and short original summary from the RSS headline/snippet. If AI is unavailable, it still creates a review issue with a fallback draft.
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

## Optional: enable free-tier AI draft preparation

Without these two extra secrets, discovery still works but drafts will not be AI-prepared. To enable the AI step:

1. Use a Cloudflare account on the **Workers Free** plan. Workers AI currently includes a daily free allocation of 10,000 Neurons; usage beyond that requires upgrading to Workers Paid, and paid-plan usage above the free allocation can be charged. To keep this project at **zero cost**, do not upgrade or add a paid billing method. On the Free plan, requests can fail after the daily allowance is used rather than silently continuing as paid usage. See the [official Cloudflare Workers AI pricing page](https://developers.cloudflare.com/workers-ai/platform/pricing/).
2. In Cloudflare, find your account ID and create an API token with the minimum Workers AI permission needed to run models. Do not share the token in chat or commit it to the repository.
3. In GitHub, open **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.
   - `CLOUDFLARE_API_TOKEN`: the token from step 2.
4. Run the discovery workflow manually once and check the generated issue. If the AI call fails or the daily allowance is exhausted, the workflow falls back to a clearly marked non-AI draft.

The workflow uses Cloudflare's `@cf/zai-org/glm-4.7-flash` model. Cloudflare's available models and free allocation can change; check the official pricing page before enabling it. The workflow does not require an OpenAI subscription or any paid AI subscription.

## Important editorial limitation

The AI sees only a Google News RSS headline and short snippet, not necessarily the full article. It can make mistakes or miss context, and it cannot independently confirm breaking news. Treat its draft as a starting point. Open the source link, verify the key facts, and reject the issue if the story or draft looks wrong. Never approve a story you have not checked.

## Automatic publishing of checked stories

The discovery workflow can automatically publish a story only when all of these checks pass:

- Cloudflare AI returns a usable headline and summary that pass basic length/category checks.
- The story link resolves successfully over HTTPS to a publisher on the explicit trusted-publisher allowlist in `scripts/discover-news.mjs`.
- The normalized source URL and headline are not already present in the published news data.
- The GitHub token has permission to update `src/src/data/news.js`.

Stories with missing AI drafts, unrecognized publishers, unreachable links, duplicate content, or failed checks remain in the pending review queue. This is a basic filter, not a guarantee of factual accuracy: the AI draft is based on the RSS title/snippet and may omit context. Check the live site and email notifications regularly. The allowlist is intentionally conservative, so some legitimate sources will remain pending until added to the code after review.

Automatic publication commits directly to `main`; if Cloudflare Pages is configured to deploy from `main`, the site updates after the deployment finishes.

## Reviewing stories

Open the repository's **Issues** tab. New stories are titled `[Pending review] [Category] …`. Each issue includes a draft, source link, category, and a short review checklist.

- **Approve:** if the story and draft check out, comment exactly `/approve`. Only the repository owner can trigger the publication workflow.
- **Reject:** close the issue without commenting `/approve`.

## Explicit approval and publishing

1. Open the source link and check the facts against the draft.
2. If it looks accurate and relevant, comment exactly `/approve`.
3. The workflow prepares a pull request. It does **not** publish the story immediately.
4. Review the pull request and merge it into `main` only when you are ready to publish.

The publication workflow validates the headline, category, summary, publisher attribution, and HTTPS source URL. The original publisher's article remains the source; SA News Hub should publish an original summary, not a copied article.

## Notes

- GitHub scheduled workflows can be delayed, so the schedule is not a guaranteed five-minute delivery service.
- Discovery uses public RSS results and can miss stories, repeat near-duplicates, or return snippets that need verification.
- The first successful run after setup may create a batch of recent stories that were not previously queued.
