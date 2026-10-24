# Contributor and coding-agent notes

- This is a standalone WXT / React / TypeScript browser extension repository.
- Run commands through `./scripts/dev.sh`; generated artifacts and caches belong in `.dev`, `.output`, `.wxt`, or `node_modules`. Never use the maintainer's daily browser profile.
- Use `./scripts/dev.sh run check`, then `./scripts/dev.sh run test:e2e` after a production build. E2E starts an isolated local fixture server and Chromium; no real application is submitted.
- Use fictional data only in fixtures, screenshots, reports, and Issues. Never commit resumes, API keys, browser profiles, `.env` values, or generated build directories.
- Keep AI opt-in and preview-before-send. API keys belong only in extension session storage. Do not introduce a cloud backend or automatic submission.
- Preserve existing field values and user edits made after filling. Ambiguous matches need user review.
- Add regression coverage for changed matching, control handling, persistence, backup, or message boundaries.
- Adapter domain recognition is not proof of tenant compatibility. Do not claim real-site support, benchmark wins, user trials, or publication without recorded evidence.
- Document third-party source reuse and preserve the applicable license text in the extension package.
- `scripts/clean.sh` defaults to a dry run. Generated-artifact cleanup must not delete source or `.git`.
