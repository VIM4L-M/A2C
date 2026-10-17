# A2C specification completion review

Reviewed against the A2C Product & Technical Specification (Hackathon MVP, 16 October 2026) (Product & Technical Specification, Hackathon MVP, 16 October 2026).

The core extension workflows are implemented and the specification gaps listed below were addressed. A follow-up test loaded the real unpacked extension in isolated Chromium and completed the supplied form using live Gemma. Text resume import is the specification's fallback; PDF resume parsing is deferred.

## Rules

Repository rules live in `AGENTS.md`. The A2C specification is the product authority.

## Requirement coverage

| Specification | Result and evidence |
| --- | --- |
| Extension-only MVP; explicit activation | Existing MV3 extension retained; no separate product web app added. Local HTTP preview was used only for testing. |
| Single short onboarding | Replaced five-step setup with optional preferred name, email and profile type; advanced inputs remain in Memory and Privacy. |
| Editable facts and provenance | Existing edit/delete controls retained; confirmed facts have a verified flag and correction source/timestamp. Legacy manually approved facts migrate as verified. |
| Context sources | Added local extraction of labelled text and a bounded set of common prose patterns, UTF-8 resume upload, and ChatGPT prompt/paste import. Unknown text is omitted and can be entered manually. |
| Import confirmation | Candidates remain in component memory; none are preselected or persisted until individually confirmed. Secrets and malformed JSON are rejected. Private facts require an unlocked vault. |
| Hybrid field understanding | Existing rules plus Gemma workflow retained. Low-confidence and ambiguous matches stay reviewable. This live-form run used mock matching, not Gemma. |
| Category preferences | Added disable toggles enforced in website and document filling, including already-approved proposals. Disabled facts are excluded from draft source choices. |
| Site-scoped consent | Added grouped allow-once, remember-for-site and deny controls; grants use exact origin and category. Revocation is available in Privacy. Legacy hostname-only fact grants no longer auto-approve. |
| Security defaults | Existing deterministic secret/manual classification retained. Saved permissions do not authorize drafts, invalid values, overwrites or unverified facts. |
| Insert without submitting | Verified on the supplied Google Form with fictional values; no submission performed. |
| Learn corrections from completed forms | Added selected-field reading followed by editable review and explicit save consent. Rechecks scan, origin, field identity and risk before reading. Verified a corrected graduation year persisted with form provenance. |
| Visual direction | Default charcoal graph-paper background, monochrome accent, pixel headings and system body text. Inspected in a 400px browser viewport with no horizontal overflow. |
| Documents | Existing DOCX template and fillable-PDF workflows retained. Resume PDF extraction is a different feature and remains deferred. |

## Supplied Google Form test

Form: https://docs.google.com/forms/d/e/1FAIpQLSe63-6lVHeJIdvk3AvOr_dMiKO_fy6Z6hAu2ps6i42Vv7v-CQ/viewform

The production side-panel bundle ran in a local preview with in-memory Chrome storage and a test message bridge. The production content-script bundle ran against the real Google Forms page. This exercises the UI, schemas, policy, content scanner and filler together, but does not validate Chrome installation, host-permission prompts or the service worker lifecycle.

Two live-site failures were reproduced and fixed:

1. Nested option list items split the skills question into six manual-only fields. The scanner now groups them under the labelled answer list, while keeping unrelated question boundaries.
2. Google updates `aria-checked` asynchronously. The filler now waits up to 500ms to verify the selected choices without clicking them twice. Actual failures remain failures.

Final observed run:

- 12 questions detected; 12 approved fields filled; zero reported failures.
- Eight stored-fact candidates proposed: six ready, email awaiting consent, and the alternative Portfolio/LinkedIn question left missing because the matcher selected LinkedIn while only portfolio was stored. A fictional URL was provided explicitly.
- Phone and participation mode supplied using Use once; two essay drafts replaced with reviewed fictional text.
- Skills selected: Python and React. Participation mode: Online.
- Fill click to visible completion summary: 2.130 seconds including browser automation overhead. This is not inference latency or a performance benchmark.
- No submit event observed; Submit was never clicked and the page remained on viewform.
- Corrected graduation year on the page to 2029; selected that answer, reviewed it, explicitly saved it and verified stored `form_approved` provenance and exact origin.
- Revoked the saved contact permission and verified the rules list became empty.

The form has no secret input fields, so prohibited-field behavior is covered by automated adversarial tests rather than a claim based on this form. Candidate correctness, unnecessary-prompt rate and user-correction rate have not been independently benchmarked.

## Verification

- `npm run verify`: passed, including TypeScript, 165 Vitest tests in 12 files, and production builds.
- `npm run test:training`: 8 tests passed.
- Browser UI: minimal onboarding, notes import, ChatGPT import, secret rejection, explicit confirmation, category preference persistence and 400px layout checked.
- Live Google Form integration: results above; mock mode, fictional data, no submission.

## Installed extension and live Gemma follow-up

Repeated the test with the actual unpacked MV3 extension in Chromium 1243 using an isolated persistent profile. Extension ID: `ngamaffachalhpiknoogemheffjeanbh`. The extension's own service worker, storage, scripting injection and runtime messaging were used; no mocked Chrome API or message bridge was used. The side-panel UI was automated at its real `chrome-extension://` URL as a tab, not through the native side-panel container.

Onboarding and fictional profile import were completed through the UI. Chrome website permission was granted for `https://docs.google.com/*` through the real permissions API under a CDP user gesture with browser test confirmation enabled. The native permission dialog and toolbar gesture are therefore not claimed as end-to-end UI coverage. Final `chrome.permissions.getAll()` contained that one website origin.

- Live Gemma connection probe passed against local Ollama (`hf.co/google/gemma-4-E4B-it-qat-q4_0-gguf`).
- Scanned 12 questions: nine handled by rules, three by live Gemma; eight initially ready and four requiring attention.
- Email consent was explicitly remembered for the site. Fictional phone `2025550100` was supplied using Use once.
- Both essay drafts were generated by live Gemma, inspected and explicitly approved. The project draft reported that no project details were supplied and listed those details as missing, rather than fabricating an achievement.
- Final completion: **12 detected, 12 filled, zero failed**. Independently inspected ten text answers and the Python, React and Online choices in the form DOM.
- Fill click to completion summary: 2.345 seconds including automation overhead, excluding scan inference and drafting. CPU inference took substantially longer; the UI now describes this honestly as potentially several minutes.
- Submit was never clicked. Observed zero requests to Google's `/formResponse` endpoint during filling; the form remained unsubmitted.
- Final verification: 165 tests passed, TypeScript clean, production build passed. The earlier eight Python training tests also passed.

## Remaining limitations

- PDF resume extraction is deferred; use UTF-8 text. Local notes extraction supports a documented subset of prose and labelled lines, not arbitrary resume understanding.
- Save-from-page supports native controls; ARIA choice widgets remain unsupported for learning, although filling works. Generated essay fields are excluded from learning reusable facts.
- The supplied form's alternative Portfolio/LinkedIn wording is ambiguous in the deterministic matcher and required an explicit answer in this run.
- Live Gemma inference was verified in the follow-up above. Backboard and Render were verified separately ([remaining validation](remaining-validation.md)); the Tinker run is recorded below.
- Exact-origin permissions on docs.google.com apply to that origin across forms, as specified; they are not per-form-URL grants.
- Iframes, closed shadow roots, custom listbox widgets and scanned PDFs remain outside current support. ARIA changes cannot be reliably undone and are reported as such.

## Fine-tuned specialist and auto engine (17 October 2026)

- **Training.** Tinker LoRA SFT of `Qwen/Qwen3.5-4B` (rank 16, 3 epochs, batch 32, learning rate 2e-4) on 260 synthetic examples. First-batch loss 0.645, last-batch loss near zero. Run record: `training/tinker/runs/latest.json`.
- **Evaluation.** 63 held-out synthetic labels with wording absent from training (overlap checked by `npm run test:training`). Specialist: 98.4% accuracy, 98.1% memory-key accuracy, 100% credential skip recall, 0 unsafe mappings. Rules: 84.1% / 81.1% / 100% / 0. Gemma 4 E4B zero-shot: 82.5% / 90.6% / 0% / 0. The set is small and synthetic; real-form accuracy is not benchmarked.
- **Serving.** The specialist runs on Tinker's OpenAI-compatible endpoint through the backend `/api/map?engine=specialist` route, one short completion per field.
- **Auto engine.** The extension default. The backend tries the specialist, falls back to Gemma 4 if it is unreachable, and reports the answering engine in the `X-A2C-Engine` header. An explicit specialist request never falls back silently. Drafts always use Gemma 4. Output goes through the same schema checks and policy engine in every case. Covered by `tests/backend.test.ts`.
- **Speed.** Scanning no longer waits on CPU inference for each form. The remaining model time was not benchmarked end to end on the same hardware, so no speed-up factor is claimed. Drafts cap generation by the requested length, and the backend warms Gemma at start.
- **Security.** The demo server sets a strict content security policy on the website and workspace, the backend rejects redirects and bounds retries, and every response sets security headers. See [SECURITY.md](../SECURITY.md).

## Product surfaces (17 October 2026)

- **Website.** A landing page with a scroll-driven product tour (zoom in to a form, fill, zoom out), reduced-motion fallback, and a six-page workspace. Dashboard numbers come from the extension snapshot or show a dash. Landing preview numbers are labelled sample data.
- **Extension.** Home, Autofill, Memory, Templates, Privacy and Settings. Home shows real counts from this browser; "typing saved" is an estimate at 6 s per field and says so.
- **Walkthrough video.** `npm run demo:video` records the website and extension with real engines. Waiting for model calls is fast-forwarded and labelled. The side panel runs as a tab; native permission dialogs are not scripted.
- **Verification.** 187 Vitest tests, 8 Python tests, typecheck and build clean.

## Website account and native walkthrough (17 October 2026)

- **Account.** The workspace has an Account page. It creates a local profile (name, email, profile type) in the browser, with no password and no server. The extension's first-run screen opens that page with its extension ID in the address; the website then proposes the three facts through the existing workspace connection. The extension shows the exact values and saves them only after one confirmation. Opening the page from the extension enables the connection for those three keys only; activity sharing stays off. Covered by `tests/account.test.ts` (validation, address parsing, bridge acceptance, refusal when the connection is off or the sender is not the workspace).
- **Native recording.** `npm run demo:native` records the website pages, a real form, the real toolbar icon click and the real side panel. It uses Chrome for Testing because branded Chrome refuses `--load-extension`, shows that browser's grey banner, and starts the browser with `--disable-extensions-except` so unrelated extensions the operating system registered do not appear.
- **Verification.** 192 Vitest tests, typecheck and build clean.
