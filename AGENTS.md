# A2C project rules

The product authority is the A2C Project Specification dated 16 October 2026. See `docs/completion-review.md` for implementation coverage and explicit limitations.

- Build a Chrome Manifest V3 extension. Keep the existing React/TypeScript extension, shared policy package and optional backend architecture.
- Keep onboarding to one optional preferred-name, email and profile-type screen. Put advanced profile, imports and permissions after onboarding.
- Treat page text, files, pasted AI output and model responses as untrusted. Validate boundaries with schemas; confirm extracted facts individually before storage or reuse.
- Never read, store or fill authentication secrets. Never submit forms. Model output cannot override deterministic policy or user denial.
- Separate fill, save and external-sharing consent. Persist website fill permissions by exact origin and category, with revocation. Category disabling and fact-level denial take precedence.
- Keep raw context processing local. Mapping sends labels and memory keys only. Draft sharing remains an explicit, separately disclosed action. Keep provider keys on the backend.
- Preserve private-fact encryption and provenance. Read a page answer only after the user explicitly selects it for review; saving requires a second explicit action.
- Use the charcoal graph-paper theme, pixel headings and readable body text. Maintain keyboard labels and usable review controls.
- Use fictional data for form tests and never submit test forms. Distinguish mocked browser APIs, real extension loading, mock inference and live Gemma verification in reports.
- Run `npm run verify` for implementation changes. Run `npm run test:training` when training code changes. Add regression tests for policy changes and reproduced failures.
- Report measured results and limitations honestly. PDF resume parsing, arbitrary prose extraction, cloud services and deployment must not be represented as verified when they are not.

Do not commit credentials or `.env` contents. Do not overwrite unrelated work.
