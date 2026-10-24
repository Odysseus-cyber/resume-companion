# Resume Companion

A local-first Chrome / Edge extension for Chinese graduate job applications. No account or project backend is required.

**Development preview, not a store release.** Moka, Beisen and Feishu are experimental domain detectors using the generic form engine. No real employer compatibility, user-study results or competitor advantage is claimed.

Edit multiple profiles, preview field mappings, fill supported controls, keep existing values, undo unchanged extension edits, and reuse manual mappings. PDF / DOCX / TXT text extraction is local; basic parsing extracts a few contact fields. Optional bring-your-own-key AI reads a previewed text-and-control layout, matches value-free database keys, and fills valid matches locally after confirmation. Resume files and extracted text stay local. Review all imported information before saving.

Profiles, mappings, settings and form templates live in extension `storage.local`, not cloud sync. The local database itself is not encrypted. Full encrypted backups include templates; uninstalling the extension can erase local data. AI keys are session-only. AI requests go directly to your configured HTTPS provider, whose fees and policies apply.

AI collection does not require the rule matcher to identify labels first. It sends filtered text blocks and candidate control rectangles, hierarchy and order, together with standard database keys, semantic labels, types and entry indices. Custom fields use temporary aliases instead of internal IDs. The model returns control-to-key mappings and evidence text IDs; values are resolved locally. Requests exclude resume values, existing page values, selected content, editable content, raw DOM attributes, full HTML, screenshots and page URLs. API keys are sent only for authentication, never in AI message content, logs or backups.

Select “识别并填写” to check local templates first. A fully applicable same-site template fills locally without AI, even when AI is disabled. With AI enabled, unresolved fields produce a request preview; select “确认识别并填写” to send it. Valid matches are filled automatically; uncertain matches, empty source values and unsupported controls are skipped. Existing page content is preserved, stale layout/profile responses are rejected, and undo remains available. AI failure never silently triggers rule-based filling. Limits are 500 candidate controls and a 200 KB complete request body; oversized requests fail without truncation. The value-free layout can be exported as JSON for diagnosis; review its page text before sharing.

Known resume/page values and common sensitive patterns are filtered out of page text. Review each request: arbitrary custom page labels may still contain information the filters cannot recognize. AI output cannot execute scripts or submit applications.

## Source and installation

Repository: [Odysseus-cyber/resume-companion](https://github.com/Odysseus-cyber/resume-companion). The current development version is **0.3.0**; the archived baseline is `v0.2.3`. Only published entries on [Releases](https://github.com/Odysseus-cyber/resume-companion/releases) are public downloads; draft releases are visible only to maintainers.

```sh
git clone https://github.com/Odysseus-cyber/resume-companion.git
cd resume-companion
```

## Learn once, reuse locally (0.3.0 development)

After checking the actual page and source mapping, select “已核对，保存到模板” on the confirmed field cards and “保存已核对字段”. Partial templates are supported. The template stores semantic labels, redacted static anchors, region boundaries, control kinds and source paths, not resume values or raw HTML. AI output alone is never saved as verified knowledge.

On later scans, controls are located again from the current page and values are read from the active profile. Changed fields can be sent for incremental AI recognition with necessary context, after preview and confirmation. Cross-employer candidates require “已核对，确认跨站点复用”; matching the same recruitment vendor is not enough to execute automatically. Updating a same-site template keeps currently matched verified fields plus newly checked fields, replacing obsolete associations.

Manage templates in “管理资料 → 表单模板”: inspect, rename, disable or delete them. Schema v3 migrates older local data, JSON and encrypted backups with an empty template collection. Custom references remain local and are checked again when switching profiles. See the [template guide](docs/templates.md).

## Choice controls

Explicitly associated ARIA listboxes and region trees can be operated locally, including readonly triggers and asynchronous options. Full administrative paths are required when the widget does not expose an unambiguous city-level option. Undo uses a verifiable local clear operation when available; otherwise restoration remains manual. This does not establish compatibility with the actual Hellobike picker or unlabelled visual column widgets. Popup searches, option values and selected summaries are excluded from AI layout capture.

## Development

Use Node.js >=22 and the pnpm version declared in `package.json`.

```sh
bash scripts/dev.sh install --frozen-lockfile
bash scripts/dev.sh dev
bash scripts/dev.sh check
bash scripts/dev.sh exec playwright install chromium
bash scripts/dev.sh test:e2e
bash scripts/dev.sh build:edge
bash scripts/dev.sh zip
```

Load `.output/chrome-mv3` or `.output/edge-mv3` as an unpacked extension. Open the toolbar action and edit a profile. With AI disabled, scan a job form, review proposed values and fill selected fields. With AI enabled, use the preview-and-autofill flow above. Submit manually. Layout collection covers rendered, expanded forms in the top frame; iframes, Shadow DOM, collapsed sections and complex custom widgets remain limitations. Add repeated experience entries on the website first. Online model quality and the user-reported Hellobike page still require real-page verification.

Template execution can rebind a uniquely labelled, originally empty native control only while its original parent, static evidence, shape and region/control counts survive. Row reconstruction or repeated-section changes require another scan. Native date/month inputs are supported; custom date panels and non-ARIA visual pickers remain manual. No real Hellobike or second Beisen tenant/model acceptance has been completed.

See [Chinese README](README.md), [privacy](docs/privacy.html), [support scope](docs/support.md), [contributing](CONTRIBUTING.md) and [third-party notices](THIRD_PARTY_NOTICES.md). Maintained by [Odysseus-cyber](https://github.com/Odysseus-cyber). Use [Issues](https://github.com/Odysseus-cyber/resume-companion/issues) for ordinary feedback and [SECURITY.md](SECURITY.md) for private vulnerability reporting. See the [maintenance roadmap](docs/roadmap.md). Store accounts and store contact details remain pending. Original project code is MIT licensed; dependencies retain their own licenses.

### Progress and missing profile data

The panel distinguishes collection, confirmation (nothing sent yet), AI recognition, local filling, completion, errors and stale page/profile state. Request details are expandable. Field naming is independent of key matching and fill eligibility; empty data and unsupported controls can still receive supported names.

The profile fields introduced in schema v2 include explicitly entered highest education, its study mode, household registration location and ethnicity, all empty by default. Schema v3 adds templates. Older databases and backups migrate without inferring personal values from education entries.

AI settings support a custom request deadline (30 seconds by default) or unlimited waiting. The panel shows elapsed seconds and offers cancellation; unlimited waiting does not override provider or network limits.

During filling, validation hints and geometry shifts no longer invalidate every target. Changed targets are skipped independently. Equivalent meanings reuse existing profile keys; genuinely missing fields become blank custom fields that can be completed locally in the panel and reused later.
