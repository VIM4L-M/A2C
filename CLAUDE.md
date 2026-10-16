# A2C

Read and follow `AGENTS.md`. The A2C product specification is authoritative; `docs/completion-review.md` records current coverage, test evidence and deferred work.

This repository is a Chrome extension for permission-aware form filling, not the SurakshaSMS Android project described by the separate Downloads/CLAUDE.md.

Main modules: `apps/extension` (UI, scanning, filling and local memory), `packages/shared` (schemas, matching and deterministic policy), `apps/server` (optional inference proxy and cloud memory), and `training/tinker` (optional specialist experiment).
