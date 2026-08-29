# Etsy × Printful Workbench

**An example, self-hosted tool for running an Etsy shop that Printful fulfils.** It shows
your Etsy listings and Printful products side by side, lets you build new listings on a
staging board (mockups, title, tags, description) before anything goes live, and — once
you mark an item *approved* — pushes it to Etsy and checks the result.

It was extracted from a working tool built for one real shop. Nothing shop-specific is
left in it. It is meant to be forked and grown into the real thing for *your* shop, by
you or by an AI coding agent working for you; [`docs/FOR-AGENTS.md`](docs/FOR-AGENTS.md)
is written for exactly that hand-off.

Not affiliated with Etsy or Printful.

## What you can do with it

- **See what's connected.** Every active Etsy listing paired with its Printful product,
  and anything that's only on one side.
- **Browse your Printful templates** with their mockups, grouped however you like.
- **Stage a listing.** Pick a template, render every mockup style Printful offers for it
  (no uploads, nothing touched on Printful), choose and order the images, write the
  title, 13 tags and description with the limits enforced, and save. Everything lives in
  `data/staging.json`, which you commit.
- **Approve, then publish.** Items move *idea → staged → approved → published*. Only you
  can set *approved*. Publishing writes one approved item to Etsy — updating an existing
  listing's copy and images, or creating a new (draft or active) listing from a template —
  then reads the listing back from Etsy and compares before marking it *published*. A
  mismatch is reported, not hidden.
- **Keep Printful in step.** Snapshot your templates so you can tell when one has been
  edited by hand, and link Etsy variants to Printful variants through the sync API. (Printful's
  API cannot edit templates themselves; that stays in their dashboard.)

## Setup

You need an Etsy API key and a Printful token. [`docs/SETUP-KEYS.md`](docs/SETUP-KEYS.md)
walks through getting both (about 20 minutes, plus Etsy's approval wait).

```bash
git clone https://github.com/zeveck/etsy-printful-workbench && cd etsy-printful-workbench
cp .env.example .env        # paste your keys in
node server.js              # http://localhost:3000  (Node 18+, no npm install needed)
```

Open the page. The header tells you what's connected and what isn't. Click **Connect
Etsy (OAuth)** when your Etsy key is active. The default OAuth scopes are read-only; when
you're ready to publish, add `listings_w` (see SETUP-KEYS) and connect again.

## Where things are

| Path | What it is |
|---|---|
| `server.js` | The whole backend. Zero dependencies. Talks to both APIs so your keys never reach the browser. |
| `public/index.html` | The UI: Matching, Templates, Staging board. |
| `data/staging.json` | Your staged and published items — commit this. |
| `data/template-meta.json` | Optional: a group label and a nicer title per Printful template. |
| `data/template-baseline.json` | Snapshot of your templates (created from the UI/API) for change detection. |
| `data/mockups/` | Rendered mockup images. Not committed (bulk); re-render on a fresh clone. |
| `docs/SETUP-KEYS.md` | Getting keys, OAuth callback, scopes, which Printful token type you need. |
| `docs/PATTERNS.md` | The rules and API quirks learned running this for real. Required reading before writing to either platform. |
| `docs/FOR-AGENTS.md` | For an AI agent (and its human): how to turn this into a tool for a specific shop. |
| `test/` | `node --test` — exercises the publish path against a fake Etsy, so it needs no keys. |

## What has been exercised for real, and what hasn't

Everything up to publishing has run against a real Etsy shop and Printful store:
key checks, OAuth, matching, templates, mockup rendering, the staging board.

**The publish path has only run against a fake Etsy** (`node --test`). The requests it
sends follow Etsy's API docs, and every write is read back and compared, but no real
listing has been created or modified through it yet. Treat your first publishes as the
live test, in this order:

1. An existing **draft** listing, `images: skip` — copy only. Read the listing back on Etsy.
2. The same draft with `images: append`, then `replace`.
3. A live listing.

If a read-back mismatch is reported, believe it: fix the cause before trying again.

## What it does not do (yet)

Orders, inventory, pricing rules, videos, size charts. All natural next steps; some are
sketched in `docs/FOR-AGENTS.md`.

## For developers and agents

The API surface is small and documented in [`docs/PATTERNS.md`](docs/PATTERNS.md) §10,
along with every quirk of both platforms that cost real time to discover.

## License

MIT — see `LICENSE`.
