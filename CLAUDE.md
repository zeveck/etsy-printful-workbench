# Etsy × Printful Workbench — notes for coding agents

Read, in order: `README.md` → `docs/SETUP-KEYS.md` → `docs/PATTERNS.md` → `docs/FOR-AGENTS.md`.

Non-negotiable:
- Nothing here writes to Etsy or Printful. Adding a write path requires the human's
  explicit per-item approval (`status: approved` in `data/staging.json`) and a read-back
  verification against the API before marking anything `published`.
- Never edit a Printful template or Etsy listing the human may have touched — check
  `updated_at` against your baseline first. Printful has no version history.
- Only state product facts read from `GET /products/{id}`.
- State a postcondition before acting; verify it after, against the API, not the click.
- State lives in `data/*.json`, committed. Never in browser storage or chat.

Run: `node server.js` (Node 18+, no dependencies) → http://localhost:3000
Check: `curl -s localhost:3000/api/status`
