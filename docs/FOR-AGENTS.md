# Building a real tool from this example — a guide for agents

You are (probably) an AI coding agent whose human wants a working Etsy + Printful
coordinator for **their** shop. This repo is your starting point. This document is the
order of operations, the rules you must not break, and the places you'll want to extend.

Read `README.md` and `docs/PATTERNS.md` first. Keep `docs/PATTERNS.md` §1 in mind for
every action that touches a live platform.

## Ground rules

1. **Read-only until the human says otherwise, per item.** This repo never writes to
   Etsy or Printful. When you add a publish step, it acts only on entries whose
   `status` is `approved`, one at a time, and verifies each result (§1 of PATTERNS)
   before marking it `published`.
2. **State lives in the repo**, in `data/*.json`, committed. Not in browser storage, not
   in your context window. When the human decides something, it lands in a file.
3. **Never edit a Printful template or Etsy listing the human has touched** without
   asking. Snapshot `updated_at` first (PATTERNS §2).
4. **Only claim product facts you read from `GET /products/{id}`** (PATTERNS §3).
5. **Verify against the API, not the click** (PATTERNS §1).
6. Don't kill processes by port. In containers `kill $(lsof -t -i:PORT)` has hit PID 1.
   Kill the exact PID you started.

## Phase 0 — keys and connectivity

- Walk the human through `docs/SETUP-KEYS.md`. They must create the Etsy app and the
  Printful token themselves; you cannot.
- `node server.js` then `curl localhost:3000/api/status`. Postcondition: `printful.active`
  true with a store; `etsy.active` true. Etsy activation can take days — do the Printful
  side while waiting.
- If templates are needed, the Printful token must be **account-level** and
  `PRINTFUL_STORE_ID` set.
- Have the human click **Connect Etsy (OAuth)**. Confirm `etsy.oauth` true and the scopes
  in `/api/status`.

## Phase 1 — understand the shop (read-only)

- Open the **Matching** view. Report the counts: connected / Etsy-only / Printful-only.
  Etsy-only listings are usually not fulfilled by Printful; Printful-only products are
  usually unpublished or `is_ignored`.
- Open **Templates**. If template titles are generic ("Poster"), fill
  `data/template-meta.json` with `{id: {group, title}}` so the UI is usable. Groups are
  whatever the shop uses: brand, product line, collection.
- Snapshot templates into `data/template-baseline.json` (`{id: {updated_at, title}}`).
  This is the "did the human touch it" guard.
- Pull the product specs the shop uses (`GET /products/{id}` for each distinct
  `product_id` in the templates) into `data/product-facts.json`. This is the only source
  for material/size claims in copy.

## Phase 2 — staging

For each item the human wants to work on:

1. Stage it (the **Stage** button, or a script that POSTs to `/api/staging/save`).
2. **Render mockups** (`POST /api/printful/mockups`). One template per call; respect the
   rate limit if scripting a batch (~40 s between tasks).
3. Pick images in listing order. Image 1: plain, centred product. Then a scale shot
   (person/room), then detail. Label any image where the shown size matters.
4. Write copy under the constraints in PATTERNS §6, from the product facts and what is
   actually visible in the artwork. Store `seen_in_image` evidence if generating from
   images.
5. Set `status: staged`. The human reviews on the board and moves items to `approved`.

Good extensions here, in rough order of value:

- A **review page** the human can use without you: cards per item, drag-to-reorder
  images, editable copy, an "approve" tick, and an export that writes back to
  `data/staging.json` (or downloads a decisions file they drop in the repo).
- **Size charts** rendered from each listing's real Printful variants.
- **Transparent-background composites** (`format: "png"`) on one house background, for
  a consistent image 1 across product lines.
- A **baseline diff**: which templates/listings changed since the last snapshot.

## Phase 3 — publishing (only when asked, only when approved)

Etsy's create-listing flow is: create the draft listing (`POST
/shops/{shop_id}/listings`, needs `listings_w`), upload images (`POST
/shops/{shop_id}/listings/{id}/images`, in order), set inventory/variations, then
activate. Printful connects the listing to a product on its side (its API creates the
sync product; the dashboard "Add to store" flow does the same). Check current API docs
for both before implementing — the endpoints are stable but details change.

Rules for this phase:

- Widen OAuth scopes only now (`ETSY_OAUTH_SCOPES` + re-run `/etsy/connect`); the
  human's consent click is the gate.
- Act on one `approved` entry at a time. After each write, `GET` the listing back,
  compare field by field with the staged entry, then set `status: published` and record
  `etsy_listing_id`. On any mismatch, stop and report.
- Never bulk-edit live listings from a plan. A change to N live listings is N human
  decisions unless the human explicitly said otherwise.

## Things that look like shortcuts and aren't

- Computing crop/placement from aspect ratios (PATTERNS §5).
- Trusting a template's thumbnail for placement (three-quarter view).
- Matching artwork to products by shared words in filenames. Require subject-word
  overlap **and** visual confirmation.
- Judging success by whether your click ran.
- Bulk multi-product mockup tasks (only the first renders).
- Putting state in the browser (it vanishes) or in chat (it truncates).

## A prompt the human can hand you

> This repo is a working example of a self-hosted Etsy + Printful coordinator. Read
> `README.md`, `docs/SETUP-KEYS.md`, `docs/PATTERNS.md`, and `docs/FOR-AGENTS.md`, in that
> order. Keep the proxy design (tokens stay server-side) and the API quirks — they cost
> real time to discover.
>
> Build for me: (1) get it running against my shop and confirm the Matching view; (2) a
> staging page where I can see rendered mockups for each product, choose the image order,
> edit title/tags/description, and mark items approved, with state in JSON in the repo;
> (3) a tracker of what is staged / approved / published. Do not write to Etsy or edit
> Printful templates without my explicit per-item approval. After any write, re-read
> from the API and confirm the result matches before reporting it done.
