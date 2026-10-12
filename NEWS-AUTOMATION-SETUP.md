# SA News Hub: news discovery and editorial approval

## What this automation does

- Checks RSS-based Google News searches for South Africa, world news, markets/forex, sport, technology, and economic news.
- Runs on a five-minute GitHub Actions schedule (GitHub may delay scheduled runs).
- Creates one GitHub Issue per newly discovered source URL as the pending editorial-review queue.
- Emails a notification when new pending issues are created.
- Does **not** publish stories. This workflow has no deployment, content-writing, or publishing step. An issue being created, closed, or commented on does not publish it.

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

This initial version intentionally provides a human review queue only. Approving or closing an issue does not add the story to the public site; an explicit, separately reviewed publishing workflow would be required for that.

## Notes

- GitHub scheduled workflows can be delayed, and the schedule is not a guaranteed five-minute delivery service.
- Discovery uses public RSS results and can miss stories, repeat near-duplicates, or return summaries that need verification.
- The first successful run may create a batch of recent stories that were not previously queued.
