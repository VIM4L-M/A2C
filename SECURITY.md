# Security and privacy model

A2C fills web forms and document templates from a personal memory the user controls. This document describes what it protects, how, and where the protections stop. It is a hackathon MVP and has not had an independent security review.

## Assets

1. The user's memory: standard facts (name, college, links, ...) and private facts (phone, city, birth date, grades, ...).
2. Credentials and payment data on web pages (passwords, OTPs, card data, API keys). A2C must never read, store, transmit or fill these.
3. Provider secrets (Gemma API key, Backboard API key, Tinker API key), which live only on the backend or the training machine.
4. Per-user backend access tokens and each user's cloud memory.
5. The integrity of what gets written into a page or document.

## Trust boundaries

| Component | Trust | Notes |
| --- | --- | --- |
| Side panel (extension page) | Trusted | Holds decrypted private facts in memory only while the vault is unlocked. |
| Content script | Trusted code, untrusted input | Runs in the page's isolated world. Reads labels/structure, never sends selectors or HTML out. |
| Web page text (labels, placeholders, nearby text) | **Untrusted** | Treated as data and possible prompt injection. |
| Gemma 4 output | **Untrusted** | Only declarative JSON, strictly validated. Cannot override policy. |
| A2C backend (local) | Trusted | Binds to 127.0.0.1, restricts Origin and Host; single-user mode with no token. |
| A2C backend (Render) | Trusted, authenticated | Refuses to start publicly without `A2C_USERS` tokens and `ALLOWED_EXTENSION_ORIGIN`. |
| Backboard.io | Third party | Receives only facts the user explicitly saves to cloud memory. One assistant per user. |
| Fine-tuned specialist | **Untrusted** output | Single-label answers, validated like Gemma output. |
| Uploaded DOCX/PDF | Untrusted | Parsed locally; only placeholder / field names go to mapping. |

## Data flow

```
page DOM --(content script: labels, types, options; no values)--> side panel
side panel: deterministic classifier (red/amber/gray/green)  <- runs BEFORE any AI call
side panel --(eligible field labels + memory KEY names, never values)--> local backend --> Gemma 4
Gemma --(JSON mappings)--> proxy (Zod + key/field filtering) --> side panel (Zod + policy engine)
side panel: resolve values locally, user reviews and approves each field
side panel --(fieldId + validated value)--> content script --(re-verify, then native setter + events)--> page
```

Drafts are the only case where memory values reach the model: the user explicitly ticks which standard (non-private, non-contact) facts are shared for that one draft.

## Authentication and authorization (backend)

- Users are configured as `A2C_USERS=userId:sha256(token),...`; only token hashes are stored server-side. `npm run token -- <userId>` generates a random 192-bit token.
- The extension sends `Authorization: Bearer <token>`; comparison uses constant-time equality per record.
- Every AI and memory route requires authentication except `/api/health` (liveness only).
- Every memory operation is scoped to the authenticated user id, which selects that user's own Backboard assistant. A user cannot address another user's assistant.
- Rate limits: per IP before auth and per user after auth.
- Without users configured the server runs in local single-user mode and will only start on a loopback address. A public bind (`0.0.0.0`, Render) without `A2C_USERS` and `ALLOWED_EXTENSION_ORIGIN` exits at startup.

## Cloud memory (Backboard.io)

- Off by default; enabled with an explicit consent checkbox in Privacy.
- Writes happen only when the user clicks "Save to cloud" on a fact and confirms. Scanning, mapping and filling never write cloud memory.
- Retrieval uses Backboard's memory search endpoint (read-only), triggered by the user from a missing-information prompt. The query is the field label.
- The backend rejects credentials, secret-like values, one-time codes and private facts (catalog-private keys, amber custom keys, phone numbers) before calling Backboard. The extension only offers standard, non-contact facts.
- Isolation: Backboard scopes memory per assistant; A2C creates one assistant per authenticated user (`a2c-memory-<userId>`), never threads under a shared assistant.
- If Backboard is not configured or unreachable, cloud calls fail with a clear error and local memory keeps working.
- Users can delete individual cloud memories or all of them from the extension.

## Fine-tuned specialist (Tinker)

- Trained only on synthetic, hand-written form labels (`training/tinker/generate_dataset.py`); no user data, no values, no blocked information.
- It answers with a single label (memory key, `ask_user` or `skip`) which goes through the same policy engine. It cannot unblock a field.

## Protections

### Deterministic classification before AI

`packages/shared/src/security/classifier.ts` classifies every field from input type, autocomplete tokens, name, id, label, placeholder, aria-description and bounded nearby text.

- **Red (blocked):** `type=password`, credential/OTP/payment autocomplete tokens, passwords, passcodes, PINs, OTP / verification codes, short numeric "code" boxes, CVV/CVC, card numbers and expiry, bank/UPI/IBAN details, API keys, tokens, private keys, passkeys, recovery codes, seed phrases, security questions.
- **Gray (manual only):** CAPTCHA, signatures, legal acceptance / declarations, single checkboxes, unlabelled fields, unsupported inputs, and any label or nearby text containing instruction-like text (prompt injection).
- **Amber (approval required):** phone, email (unless the user allow-listed that site for the fact), address, birth date, grades, salary, government IDs, demographic/medical data, login identifiers, third-party data, open-ended answers.
- **Green:** ordinary reusable profile facts.

Nearby text can only make a field stricter. For red fields the content script does not read the value (not even to check emptiness), sends no hint, section or options, and the field is never included in an inference request.

### Model output is untrusted

- Strict Zod schemas (`.strictObject`) on the proxy and again in the extension. Extra keys such as `selector`, `script` or `submit` invalidate the response.
- Allowed actions: `use_memory`, `draft`, `ask_user`, `skip`. Anything else is rejected.
- Field ids must exist in the latest scan; memory keys must be among the keys offered. Hallucinated keys become "missing information".
- Red and gray fields stay blocked whatever the model says. Low confidence is never pre-approved.
- The model never returns values for memory fields; values are resolved locally. Dropdown/radio values must match a real option on the page.
- There is no path from model output to the DOM other than validated `{fieldId, value}` pairs.

### Filling

- Only approved fields are sent to the content script. Amber fields, low-confidence matches, drafts, and replacements of existing values are never pre-approved.
- Before writing, the content script checks the scan id, the page origin, that the element is still connected, visible and editable, re-classifies the field, compares a structural fingerprint, rejects secret-like values and refuses to overwrite values typed after the scan unless replacement was approved.
- It never submits forms, never clicks buttons or links, and does not touch payment, login, consent or signature controls. Radio buttons and checkboxes are toggled with a click on the input itself only.
- Hidden, `aria-hidden`, `inert`, disabled, read-only, zero-size and off-screen (honeypot) fields are ignored.

### Memory

- Nothing is learned automatically. Facts are written only after explicit save consent, with confirmation for sensitive facts. Notes, plain-text resumes and ChatGPT paste imports are parsed locally and candidates are individually confirmed. Page learning reads only one explicitly selected answer, rechecking its scan, origin, identity and risk before reading; a separate save action is required.
- Category disables and saved website denials override fill approvals. Website rules identify an exact HTTP(S) origin and category. Permissions to fill do not authorize saving, sharing or submitting. Legacy hostname-only grants no longer auto-approve facts.
- Before saving, the key/label is classified (red keys are refused) and the value is checked for secrets: Luhn-valid card numbers, private keys, JWTs, AWS/GitHub/GitLab/Slack/Google/Hugging Face/OpenAI-style keys, random high-entropy tokens and short numeric codes in a code-like context.
- Provenance (manual, onboarding, form domain, document) and timestamps are recorded for every fact.

### Encrypted vault for private facts

- PBKDF2-SHA-256 with 600,000 iterations and a 16-byte random salt per vault, deriving a non-extractable AES-GCM-256 key.
- A fresh 12-byte random IV for every save; associated data binds the ciphertext to the vault format.
- The passphrase and derived key are never persisted. Decrypted facts exist only in the side panel's memory and are dropped when it locks or closes.
- Private facts are refused unless the vault is unlocked; they never fall back to plaintext storage.

### Extension hardening

- Permissions: `activeTab`, `scripting`, `storage`, `sidePanel`. Host access is optional and requested per site (`http(s)://<that site>/*`) only when the user clicks "Allow". No `<all_urls>`, no persistent content scripts, no `tabs` permission.
- Content script messages are accepted only from this extension's own pages (`sender.id` check, no `sender.tab`) and are schema-validated.
- Extension page CSP: `script-src 'self'; object-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:*`. The extension can only talk to a proxy on this machine. Zod runs in jitless mode so no `eval` is needed.
- No API keys in the extension bundle.

### Proxy hardening

- Binds to `127.0.0.1` by default and warns when configured otherwise.
- Host header must be loopback (mitigates DNS rebinding). Origin must be a `chrome-extension://` origin, or exactly `ALLOWED_ORIGINS` when set. Requests from web pages are rejected.
- JSON-only POSTs (forces CORS preflight), 64 KB body limit, request schema validation, fixed-window rate limit, `nosniff` and `no-store` headers.
- Logs contain only method, path, status and duration, never bodies, labels or values.

### Activity log

Counts and timestamps only. No values, labels, domains, documents or submissions.

## Known limitations and residual risks

- **Standard facts are not encrypted.** `chrome.storage.local` is plaintext on disk. Only private facts are in the vault.
- **Unlocked vault exposure.** While unlocked, anything that can run code in the extension or read browser memory can read private facts.
- **Local single-user mode is unauthenticated.** Origin and Host checks stop web pages, not other programs on the same computer. Configure `A2C_USERS` if that matters, even locally.
- **Access token at rest.** The backend token is stored in `chrome.storage.local`, which is not encrypted.
- **Cloud memory leaves the machine.** Facts saved to Backboard are stored by a third party under its terms. Only save what you are comfortable sharing.
- **Render free tier.** Instances sleep; the first request can be slow. Render does not host the model; `GEMMA_BASE_URL` must be reachable from Render (a local Ollama on your laptop is not).
- **Labels go to the model.** Field labels, option labels, section names and memory key names are sent to the backend and the configured Gemma endpoint. If that endpoint is remote (e.g. an HF Inference Endpoint), that metadata leaves the machine.
- **Classification is heuristic.** It is conservative and fails closed for common patterns, but a deliberately obfuscated credential field could be misclassified as amber or green. Values still require user review, and secret-like values are refused on fill.
- **Prompt injection.** Instruction-like labels are excluded and the model output is constrained, but subtle manipulation of label wording could still bias a mapping. The worst case is a wrong but user-visible suggestion; the model cannot read values, run code or unblock fields.
- **Coverage.** Iframes (including cross-origin payment iframes) and closed shadow roots are not scanned. Highly custom widgets (div-based selects, contenteditable) are not supported.
- **Site behaviour.** Some sites reformat or reject programmatic input; such fields are reported as failed rather than filled.
- **Documents.** Only explicit `{{placeholders}}` in DOCX and real AcroForm fields in PDF. Encrypted, scanned or flattened PDFs are reported as unsupported. Signatures and PDF checkboxes are never filled.
- **Supply chain.** Dependencies are pinned by lockfile but not audited beyond `npm audit`.

## Reporting

This is a hackathon project. Please open an issue on the repository for security problems and do not include real personal data in reports.
