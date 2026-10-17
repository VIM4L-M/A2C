# Follow-up validation — 16 October 2026

## Latest implementation and live checks

This section supersedes the historical results below where they differ.

- `npm run verify`: 180 tests in 15 files passed, with TypeScript and production extension build passing. Training tests: 8 passed (training unchanged). Production dependency audit: zero reported vulnerabilities.
- Selectable-text PDF resume import now runs locally using a bundled PDF.js worker. A genuine generated PDF was imported in the real MV3 extension and six candidates individually confirmed. Limits: 5 MB, 20 pages, 100,000 text characters, 30 seconds. Scanned/image-only and encrypted PDFs remain unsupported.
- Optional local Gemma prose extraction validates each candidate and requires exact source evidence. A live model call took 100.427 seconds and returned four accepted facts. It omitted one skill, so arbitrary prose accuracy is not guaranteed. Remote/production extraction is rejected; regression tests cover this boundary.
- Same-origin, unsandboxed iframe controls and visible single-select ARIA listboxes are supported. An actual-extension fixture run detected five controls, filled four, blocked the password, and reported zero failures. The fixture was served by browser automation, not supplied by Google. Cross-origin/sandboxed frames, closed shadow roots, multiselect listboxes and unopened/virtualized options remain unsupported.
- Live Backboard isolated smoke test passed assistant creation, add, list, search, delete and cleanup with fictional data. This tests the provider lifecycle separately from extension cloud-consent UI.
- A fresh headed Chrome profile loaded the real extension and opened its native side panel via Chrome's debugging protocol. Physical toolbar clicks and native permission-dialog interaction remain unverified. Final desktop demo capture was stopped because unrelated desktop windows remained foreground. No final native-panel video has been delivered; fresh onboarding is still ready.
- Tinker remains blocked by DNS resolution of its documented endpoint. No training job/checkpoint exists.
- Render backend deployed from published main at https://a2c-backend-ghu1.onrender.com (free plan, automatic deployments off). Live checks: health 200; allowed extension origin without token 401; authenticated status 200; untrusted origin 403; live Backboard connectivity true. Gemma and specialist are not configured on Render. This deployment excludes uncommitted local changes. The generated client token is stored only in ignored `.env.render-client` and was not printed.
- No new commits were made. Deployment must not be described as including these local changes until the corresponding source is published.

## Historical audit (before the fixes above)

This audit checks the previously reported limitations. It does not claim universal form support or completed cloud deployment.

## Measured results

- `npm run verify`: 169 tests across 13 files passed; TypeScript and extension production builds passed.
- `npm run test:training`: 8 tests passed. These validate data/prompt/metric code, not a trained model.
- Actual unpacked MV3 extension loaded in isolated Chromium, with real Chrome extension APIs. The supplied Google Form detected 12 fields and filled all 12, with zero skipped or failed. Screenshots confirm text answers, Python/React checkboxes, and Online radio selection. The form was never submitted.
- This recorded run uses explicitly labelled **mock matching and local template drafts**, followed by manual draft editing and approval. It does not demonstrate live model inference. The earlier installed-extension/live Gemma run is documented in `completion-review.md`.
- `.env` contained keys under `tinker_api` and `backboard_api`. The local names were corrected to `TINKER_API_KEY` and `BACKBOARD_API_KEY`; values were never logged or committed. The initial claim that keys were absent was incorrect.
- Backboard authenticated `GET /api/assistants?limit=1`: HTTP 200. Cloud write/search/delete workflows were not exercised live in this audit.
- Tinker SDK 0.33.1 was installed into an isolated ignored environment. Its capabilities check did not complete; a direct request with a 25-second timeout identified DNS failure (`getaddrinfo failed`, Windows 11001) for `tinker.thinkingmachines.dev`. No training job or checkpoint was created. This does not establish that the key is invalid.

## Support boundaries

| Area | Result |
| --- | --- |
| PDF resume import | Unsupported. Fixed a reproduced validation hole where an ASCII PDF with no null bytes could pass the text-file reader. A magic-header check now rejects it with a plain-text export instruction; regression passes. This is not PDF extraction support. |
| Arbitrary prose | Unsupported beyond explicit supported patterns and labelled lines. Regression confirms unrecognized prose generates no invented facts. Individually reviewed structured imports remain supported. |
| Open shadow DOM | Scanner regression passes. |
| Closed shadow DOM | Fields are inaccessible to the scanner; regression confirms omission. |
| Iframes | Same-origin iframe fields are omitted by the current scanner; regression confirms this. Cross-origin frame support is not claimed. |
| Custom widgets | Google Forms ARIA checkboxes/radios worked in the real browser. Arbitrary custom listboxes are not supported; regression confirms omission. |
| Native toolbar / permission UI | Not verified through native desktop clicks. A fresh automated permission request stalled. The successful demo reused the isolated test profile's previously granted Google Forms origin. Extension UI is opened in a tab; the video is not a recording of the native browser side panel. |
| Backboard | Key accepted by a live authenticated read. Full live memory lifecycle remains unverified. |
| Render | No deployment URL or Render credentials supplied. Deployment remains unverified. |
| Tinker | DNS blocks the documented SDK endpoint. Fine-tuning remains unverified. |
| Local Gemma | Previously verified live; see completion review. The recorded run uses mock mode, so it supplies no new Gemma latency measurement. Several-minute local inference remains a limitation. |

## Demo artifacts

Local files under `output/demo/`:

- `a2c-demo.mp4`: approximately 76-second, silent, side-by-side recording of extension review/fill and the supplied Google Form. Real browser recording; mock inference. Streams start within 0.3 seconds of each other.
- `extension-review-fill.webm` and `google-form-result.webm`: separate recordings at original resolution.
- `onboarding-review.webm`: longer raw recording of optional onboarding, structured fact extraction and individual confirmations, followed by audit idle time.
- `review-result.png` and `filled-form.png`: full-page evidence showing 12 filled and the unsubmitted form.

The MP4 was decoded and a frame near the end was visually inspected. No API keys appear in the recordings. No new commits or pushes were made for this audit.

Service references: [Backboard authentication](https://docs.backboard.io/authentication), [Tinker documented production hostname](https://tinker-docs.thinkingmachines.ai/tinker/compatible-apis/anthropic/).
