# Etsy × Printful Workbench

**An example, self-hosted tool for running an Etsy shop that Printful fulfils.** It shows
your Etsy listings and Printful products side by side, lets you build new listings on a
staging board (mockups, title, tags, description) before anything goes live, and — once
you mark an item *approved* — pushes it to Etsy and checks the result.

Not affiliated with Etsy or Printful.

## What you can do with it

- **See what's connected.** Each Etsy listing paired with its Printful product, plus
  anything on only one side.
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
  A draft the tool created can be retracted (deleted, with the 404 confirmed) as the undo.
  The create → update → retract cycle is verified live against a real shop.
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

## What has been verified for real

Everything has run against a real Etsy shop and Printful store, including the publish
path: a draft listing was created from a template with its rendered mockups, updated
(copy plus an appended image), and retracted, with each step read back from Etsy and
compared — see `docs/PATTERNS.md` §10 for what that run found. Activation was verified
the same way (a test listing was made active, read back, deactivated and deleted), and so
was a real Printful sync-variant change (a price changed, read back, and reverted). If a
read-back mismatch is ever reported, believe it: fix the cause before trying again.

## What it does not do (yet)

Orders, inventory, pricing rules, videos, size charts. All natural next steps; some are
sketched in `docs/FOR-AGENTS.md`.

## For developers and agents

The API surface is small and documented in [`docs/PATTERNS.md`](docs/PATTERNS.md) §10,
along with every quirk of both platforms that cost real time to discover.

## License

MIT — see `LICENSE`.
