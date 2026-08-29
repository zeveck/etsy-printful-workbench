# Etsy × Printful Workbench — notes for coding agents

Read, in order: `README.md` → `docs/SETUP-KEYS.md` → `docs/PATTERNS.md` → `docs/FOR-AGENTS.md`.

Non-negotiable:
- Writes to Etsy go through `/api/etsy/publish` only, only for entries the human set to
  `approved` in `data/staging.json`, one entry per call, and every write is read back from
  the API and compared before the entry becomes `published`. The only delete path is
  `/api/etsy/retract`, which removes only listings the tool created. Never bypass either
  to "just fix" a live listing.
- Never edit a Printful template or Etsy listing the human may have touched without
  asking — check `/api/printful/baseline` (templates) or the live listing first. Printful
  has no version history.
- Only state product facts read from `GET /products/{id}`.
- State a postcondition before acting; verify it after, against the API, not the click.
- State lives in `data/*.json`, committed. Never in browser storage or chat.

Run: `node server.js` (Node 18+, no dependencies) → http://localhost:3000
Check: `curl -s localhost:3000/api/status`
Test: `node --test` (fake Etsy; no keys needed)
