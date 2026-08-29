# Etsy × Printful Workbench

**An example repo for managing and staging an Etsy shop fulfilled by Printful.**

This is a small, self-hosted, zero-dependency tool that talks to both APIs, shows
your Etsy listings and Printful products side by side, lets you stage new listings
(images, title, tags, description) before they go live, and keeps track of what's
staged, approved, and published — all in JSON files you commit to this repo.

It is an **example**, extracted from a working tool built for one real shop. Nothing
shop-specific is hardcoded. It's meant to be forked — by you, or by an AI coding agent
working on your behalf — and grown into the real thing for your own account pair. See
[`docs/FOR-AGENTS.md`](docs/FOR-AGENTS.md) for exactly that.

Not affiliated with Etsy or Printful.

## What's in the box

| Path | What it is |
|---|---|
| `server.js` | Node 18+ server, **no npm dependencies**. Proxies both APIs so tokens never reach the browser. Etsy OAuth 2.0 (PKCE, refresh). 5-minute cache. |
| `public/index.html` | The UI: **Matching** (Etsy ↔ Printful pairs), **Templates** (Printful product templates with mockups), **Staging board** (idea → staged → approved → published). |
| `data/staging.json` | Staging state. The UI edits it; you commit it. |
| `data/template-meta.json` | Optional overlay for Printful templates: a group label and a better title. Printful's API can't store either. |
| `docs/SETUP-KEYS.md` | Step-by-step: Etsy app + OAuth callback, Printful token, which scopes and access level you need. |
| `docs/PATTERNS.md` | Hard-won rules and API quirks. Read before writing anything to either platform. |
| `docs/FOR-AGENTS.md` | How to turn this into a real tool for a specific shop, written for an AI agent (and its human). |

## Quick start

```bash
git clone <this repo> && cd etsy-printful-workbench
cp .env.example .env        # then fill in keys — see docs/SETUP-KEYS.md
node server.js              # http://localhost:3000
```

1. Open http://localhost:3000. The header tells you what's configured and what isn't.
2. Click **Connect Etsy (OAuth)** when the Etsy key is active. Default scopes are
   read-only (`listings_r shops_r`).
3. **Matching** shows every active Etsy listing paired with its Printful sync product
   (joined on Printful `external_id` == Etsy `listing_id`), grouped *Connected / Etsy only
   / Printful only*.
4. **Templates** shows your Printful product templates. Click one to stage it.
5. On a staged item, **Render mockups** asks Printful for every non-seasonal mockup style
   of that template — no print file or upload needed — and drops them in *Candidates*.
   Click to pick, click a picked image to move it earlier, write the copy, set the status,
   **Save**. It's now in `data/staging.json`.

## What it deliberately does not do

- **It never writes to Etsy or Printful.** No listing is created, no template edited.
  Staging is a preview; publishing is a separate step a human approves per item. The
  OAuth scopes default to read-only for the same reason. `docs/FOR-AGENTS.md` describes
  how to add the publish step when you're ready.
- No orders, no inventory, no pricing logic. Those are natural next steps; they aren't here.

## API quirks you'd otherwise rediscover

- **Etsy `x-api-key` must be `keystring:shared_secret`**, not the keystring alone, even on
  OAuth'd calls. Most docs get this wrong.
- **Printful template pagination is buggy.** Some `offset`/`limit` combinations return the
  wrong page. `server.js` sweeps with several page sizes and dedupes by id.
- **Product templates are account-level.** Reading them needs an *account-level* token
  (there is no template scope on single-store tokens), which then requires the
  `X-PF-Store-Id` header on store-level calls. `server.js` handles the header.
- **Etsy-platform stores use `GET /sync/products`.** `GET /store/products` rejects them.
- **Mockups from a template:** `POST /v2/mockup-tasks` with `source: "product_template"`
  renders any existing template's mockups at 2000 px with nothing uploaded. But it
  **silently renders only the first product of a multi-product task**, refuses to mix
  vertical and horizontal styles in one call, and rate-limits at roughly one task per
  35–45 s. `server.js` does one template per call and retries on the orientation error.
- Some default `User-Agent` strings get a 403 from Printful. `server.js` sends `curl/8`.
- Printful pushes sizes to Etsy as *custom* variations, which Etsy search doesn't index.
  If you want size queries to find you, put sizes in tags, not just variations.

More in [`docs/PATTERNS.md`](docs/PATTERNS.md).

## Endpoints

| Route | Purpose |
|---|---|
| `GET /api/status` | What's configured, connected, and broken — one call |
| `GET /api/etsy/listings` | Shop lookup + all active listings with a thumbnail |
| `GET /api/printful/products` | All sync products for the store |
| `GET /api/printful/templates` | All product templates, merged with `data/template-meta.json` |
| `GET /api/printful/template?id=` | One template, raw — the authoritative "what did I save" read |
| `GET /api/printful/mockup-styles?product_id=` | Mockup styles for a catalog product (seasonal ones flagged) |
| `POST /api/printful/mockups` | `{product_template_id, mockup_style_ids?, catalog_variant_ids?}` → rendered mockup URLs |
| `GET /api/printful/mockup-task?id=` | Poll a task that outlived the request |
| `GET /api/staging` · `POST /api/staging/save` | Read / merge-patch `data/staging.json` (`{key: patch}` or `{key: null}` to remove) |
| `GET /etsy/connect` · `GET /etsy/callback` | OAuth start / callback |
| `GET /api/refresh` | Clear the server cache |

## License

MIT — see `LICENSE`.
