# SA News Hub: news discovery and editorial approval

## What this automation does

- Checks RSS-based Google News searches for South Africa, world news, markets/forex, sport, technology, and economic news.
- Runs on a five-minute GitHub Actions schedule (GitHub may delay scheduled runs).
- Creates one GitHub Issue per newly discovered source URL as the pending editorial-review queue.
- Emails a notification when new pending issues are created.
- Keeps discovery separate from publishing. New stories are never published just because an issue is created, closed, or commented on. Publishing requires an explicit owner command, a pull-request review, and a merge into `main`.

## One-time Gmail setup

1. Sign in to the Gmail account that will send alerts.
2. Enable 2-Step Verification on that Google account, if available.
3. Create a Google **App Password** for this workflow in your Google Account security settings. Use the app password, not your normal Gmail password. If Google does not offer App Passwords for your account, do not weaken account security; choose another mail delivery method before enabling notifications.
4. Open this repository on GitHub, then go to **Settings → Secrets and variables → Actions → New repository secret**.
5. Add these three repository secrets:
   - `GMAIL_USER`: the sending Gmail address.
   - `GMAIL_APP_PASSWORD`: the Gmail App Password (paste it without spaces if Google displays it grouped).
   - `NEWS_APPROVER_EMAIL`: the address that should receive review alerts. This can be the same Gmail address.
6. Open **Actions** in the repository, select **Discover news and request approval**, and choose **Run workflow** to test it.

Do not put passwords or app passwords in source files, issues, commits, or chat messages.

## Reviewing stories

Open the repository's **Issues** tab. New stories are titled `[Pending review] [Category] …` and include the original story link plus a short feed summary. Verify each item with the original publisher and write your own summary with attribution before deciding whether it should be used.

## Explicit approval and publishing

1. Open a pending review issue and verify the story at the original publisher.
2. Replace every bracketed instruction in the **Publication draft** section. Use an original, fact-checked summary in your own words and name the publisher.
3. Add a new issue comment containing exactly `/approve`. Only the repository owner can trigger the workflow.
4. The workflow prepares a pull request. It does **not** publish the story immediately.
5. Review the pull request. Merge it into `main` only when you're ready to publish. The site build then includes the story on its category page and its own story page.

Do not merge a story whose summary, category, or source attribution is incomplete. The workflow rejects missing fields and only accepts the six listed categories. The original publisher's article remains the source; SA News Hub should publish an original summary, not a copied article.

## Notes

- GitHub scheduled workflows can be delayed, and the schedule is not a guaranteed five-minute delivery service.
- Discovery uses public RSS results and can miss stories, repeat near-duplicates, or return summaries that need verification.
- The first successful run may create a batch of recent stories that were not previously queued.
