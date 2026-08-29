# Patterns and hard-won rules

Everything here was learned the expensive way on a real shop: work destroyed, wrong
products shipped to listings, a human's careful edits overwritten. The rules are
general; the examples are from print-on-demand art products (posters, mugs, totes,
cards), but nothing depends on that.

If you are an AI agent about to act on a live store: read the first section twice.

## 1 · The prime rule: state a postcondition, verify it against the authority

Every action that changes something gets a **postcondition stated before acting** and
**checked after acting**, against the **authoritative source** — the API's own read of
the object, or the rendered mockup image — never the UI you clicked in, never your
memory of what you sent.

- Not "did my click run" but "is the world now in the state that was asked for."
- Verify the *requirement*, not a proxy. "Black is selected" was true while the actual
  requirement "yellow is absent" was false: handle colours were toggles, not radios, and
  both shipped.
- Browser automation returns success for no-op clicks on empty selectors. Silent no-ops
  are the number one failure mode. Count layers, re-read the object, look at the image.
- After saving a Printful template: `GET /product-templates/{id}` and assert the variant
  ids, options, and title; then fetch `mockup_file_url` and **look at it**.
- After anything on Etsy: `GET /listings/{id}` and compare field by field.
- A degenerate lookup result ("Poster" as a whole title, "no sizes") is a **bug in the
  lookup**, not a fact about the product. Re-check before recording it.

## 2 · Never edit what the human touched

Printful keeps **no version history**. If you overwrite a template the shop owner has
hand-adjusted, their work is gone. So:

- Before touching a template, snapshot `{id: {updated_at, owner}}` into a baseline file
  in the repo. If `updated_at` has moved since your snapshot, a human edited it: **do not
  modify; ask.**
- Same for Etsy listings: the human's live copy is the baseline; stage changes in
  `data/staging.json`, never apply them without explicit per-item approval.

## 3 · Only state product facts you have read from the spec

Titles and descriptions may only assert material, size, or quality claims that appear in
`GET /products/{id}` → `result.product.description` (Printful's catalog). Examples of
what this rule caught: 25 tote titles that said "canvas" for a 100%-polyester bag.

Never write *handmade / hand-painted / original / eco-friendly / waterproof* about a
print-on-demand product. Claims about the **artwork** (it was an original watercolour)
are fine when the print pathway is explicit ("printed here on…").

Generate the title **from the saved template's actual variant list**, after saving —
never from the plan. Mug titles said "11oz 15oz" while the template carried 20oz.

## 4 · Describe only what is visible

A generated description once said "one very tangled ghost" for a picture of two
untangled ghosts. If copy is generated from an image, keep the evidence: store a
`seen_in_image` field beside the description saying what was actually observed.

## 5 · Framing is a judgement, not a formula

For any product where art is placed on a print area:

- **Size and position are separate decisions.** Resizing displaces the art (it anchors,
  it doesn't recentre); every width change must be followed by a placement check.
- **No width formulas.** Every serious framing failure came from computing a number from
  an aspect ratio instead of looking at where the subject sits. Find the subject; never
  crop it; crop background only as much as the size needs; keep sizes that work; **drop
  sizes that can't** and say so.
- "Fill" is a minimum, not a target. After no white bands, stop zooming.
- Prints: no white bands, ever. Cards: white trim is acceptable and often better.
- The default mockup thumbnail is a three-quarter view — **not evidence of placement**.
  Ground truth is the editor's print area and centre line, or a straight-on render.

## 6 · Etsy listing constraints (as of 2026)

- Title ≤ 140 chars. Etsy's guidance favours front-loaded, noun-first titles; don't
  enumerate every size in a multi-size title. **At most 3 words may begin with two
  capital letters** — a fourth gets a 400 `all_caps` ("more than 3 start with 2
  sequential capital letters"). Verified live 2026-08-29; the tool pre-checks it.
- **Exactly 13 tags, each ≤ 20 chars.** Put sizes and product types in tags ("8x10
  print", "15oz coffee mug") — Printful pushes sizes as *custom* variations (property
  513), which search doesn't index, and formats them "8×10" while buyers type "8x10".
- The live listing editor allows **up to 20 photos and 2 videos** (verified in the editor
  2026-08; help articles lag). Videos up to 60 s are trimmed to 15 s. Photos: 2000 px
  shortest side, under 1 MB recommended.
- Etsy crops the **first image square** and uses it for query matching. Keep image 1
  simple: product centred, plain background. Images 2+ can vary freely (scale shot,
  room shot, size chart, artwork detail).
- Etsy's API cannot set the shop banner (`updateShop` takes text fields only).

## 7 · Printful API gotchas

- `x-api-key` on Etsy is `keystring:shared_secret`. (Yes, this is an Etsy note. It bites
  everyone.)
- Template pagination returns wrong pages for some `offset`/`limit` pairs — sweep with
  several page sizes and dedupe. The miss is not deterministic: the same sweep returned
  485 and then 500 of 501 templates minutes apart (the list isn't stably ordered while
  templates are being edited). Refresh and merge; one or two may stay unreachable.
- General rate limit is 120 calls/min; a 429 mid-sweep should back off, not abort.
- Templates are account-level: account-level token + `X-PF-Store-Id` on store calls.
- Etsy-platform stores: `GET /sync/products`, not `GET /store/products`.
- `POST /v2/mockup-tasks`:
  - `source: "product_template"` + `product_template_id` renders an existing template —
    no print file, nothing uploaded, read-only against the store, 2000 px via
    `mockup_width_px`.
  - **One product per task.** A multi-product task silently renders only the first.
  - Vertical and horizontal style ids can't mix; the error lists the ids that fit.
  - Rate limit ≈ one task per 35–45 s; back off on "exceed available attempts".
  - Result `mockup_url`s are on a temporary `/tmp/` S3 path. Download immediately; never
    store only the URL.
  - Request `format: "png"` for transparent-background Default/Flat styles — you can
    composite them on your own background for consistent shop-wide scenes.
  - Style lists come from `GET /v2/catalog-products/{id}/mockup-styles`. Greeting-card
    style ids remap per render; label by return order if you need stable names.
  - `source: "catalog"` with a file URL and **no layer position** auto-centres the design
    (same placement the real sync variants use). Supplying the whole print area as the
    position stretches the art. The v1 create-task path is worse; avoid it.
- `GET /files` is retired (410). Template layer `url`s come back blank. Neither matters
  with the template route.
- Some default User-Agents get 403; send a plain one.

## 8 · The staging board contract

`data/staging.json` is a map keyed `listing:<etsy_listing_id>` or
`template:<printful_template_id>`:

```json
{
  "template:12345678": {
    "status": "staged",
    "title": "…",
    "tags": ["…", "…"],
    "description": "…",
    "notes": "free text for the human or the agent",
    "images": [ { "url": "/data/mockups/12345678/123-4533.jpg", "source_url": "https://…/tmp/…",
                  "label": "Default|Front", "style_id": 123, "variant_id": 4533 } ],
    "candidates": [ { "url": "…", "label": "Lifestyle 2|Mockup" } ],
    "etsy_listing_id": null,
    "edited_at": "2026-08-29T12:00:00Z"
  }
}
```

- `status` moves **idea → staged → approved → published**. Only a human moves it to
  `approved`. Only `/api/etsy/publish` moves it to `published`, and only after its
  read-back comparison is clean; it records `etsy_listing_id`, `etsy_state`,
  `published_at`. A failed comparison leaves the status alone and stores
  `last_publish_error`.
- Optional publish inputs on the entry: `like_listing_id` (an existing listing whose
  taxonomy / shipping profile / return policy / who- and when-made are copied when
  creating a new listing), `price`, `quantity`.
- `images` is the listing order; `candidates` is everything rendered but not chosen.
  Rendered images are saved under `data/mockups/<template>/` and referenced by local
  path — Printful's result URLs are temporary. The folder is gitignored, so a fresh
  clone re-renders; the JSON (decisions, order, labels) is what's versioned.
- Human decisions round-trip through this file (or through files the review page
  exports and the human drops back into the repo). Clipboard paste truncates in some
  terminals; files don't.
- The staging routes only merge-patch entries. Platform writes happen only in the
  publish routes (§10), one approved entry per call.

## 9 · Working with a human reviewer

- Give them one page to decide on, with everything needed on it. Don't ask them to
  judge from raw links.
- Build all products for **one design** before the next, so sets stay adjacent.
- When something can't be done well (a subject too close to the edge for a bleed size),
  **say so** — "this size doesn't work" is a correct output.
- Record who changed what. If the human pre-edited a batch before grading it, the grades
  measure the shared result, not your automation. Don't cite them as evidence it
  improved.

## 10 · The API surface, and writing to the platforms

All routes are served by `server.js`; the UI uses nothing else.

| Route | Purpose |
|---|---|
| `GET /api/status` | What's configured, connected, broken — one call |
| `GET /api/etsy/listings` | Shop lookup + all active listings with a thumbnail |
| `GET /api/etsy/listing?id=` | One listing with images — the read-back source |
| `GET /api/etsy/shop-settings` | Shipping profiles, return policies, sections (what a new listing references) |
| `POST /api/etsy/publish` | Push ONE approved entry to Etsy and verify (below) |
| `GET /api/printful/products` | All sync products for the store |
| `GET /api/printful/sync-product?id=` · `GET /api/printful/sync-variant?id=` | Sync product / variant detail |
| `POST /api/printful/sync-variant` | `{id, variant_id?, files?, retail_price?, external_id?, …}` → PUT + read-back compare |
| `GET /api/printful/templates` | All product templates, merged with `data/template-meta.json` |
| `GET /api/printful/template?id=` | One template, raw |
| `GET /api/printful/baseline` · `POST … {snapshot:true}` | Diff templates against `data/template-baseline.json` / take the snapshot |
| `GET /api/printful/mockup-styles?product_id=` | Mockup styles for a catalog product (seasonal flagged) |
| `POST /api/printful/mockups` | `{product_template_id, mockup_style_ids?, catalog_variant_ids?}` → renders saved under `data/mockups/<template>/` |
| `GET /api/printful/mockup-task?id=` | Poll a task that outlived the request |
| `GET /api/staging` · `POST /api/staging/save` | Read / merge-patch `data/staging.json` (`{key: patch}`, `{key: null}` removes) |
| `GET /etsy/connect` · `GET /etsy/callback` | OAuth start / callback |
| `GET /api/refresh` | Clear the server cache |

### Writing — what the APIs allow, and how this repo does it

**Human control is the point; the writes still have to happen.** A staging tool that
can't push what the human approved isn't useful. So: `approved` is set only by a human,
and once it is, the tool does the write and proves it.

### Etsy (full API support, scope `listings_w`)

| Operation | Call | Notes |
|---|---|---|
| Update copy | `PATCH /shops/{shop_id}/listings/{id}` | `application/x-www-form-urlencoded`; `tags` comma-separated; ≤140-char title, ≤13 tags ≤20 chars |
| Upload image | `POST /shops/{shop_id}/listings/{id}/images` | multipart, field `image`, `rank` 1-based; `overwrite` replaces the image at that rank |
| Delete image | `DELETE /shops/{shop_id}/listings/{id}/images/{image_id}` | |
| Create listing | `POST /shops/{shop_id}/listings` | form; required: `quantity title description price who_made when_made taxonomy_id`; physical listings also need `shipping_profile_id` (and a `return_policy_id` in most shops). Created as a **draft**. |
| Activate | `PATCH … state=active` | needs at least one image |
| Delete (draft/inactive) | `DELETE /listings/{id}` — **not** under `/shops/{shop_id}/`, unlike every other write | scope `listings_d`; `/api/etsy/retract` only deletes listings the tool created and refuses active ones |
| Read back | `GET /listings/{id}?includes=Images` | the comparison source |
| Shop settings | `GET /shops/{id}/shipping-profiles`, `/policies/return`, `/sections`, `/readiness-state-definitions` | what a new listing must reference. `readiness_state_id` (processing profile) is **required** for physical listings though the spec doesn't mark it; the listing object only exposes it while the listing is active |

**Verified live 2026-08-29** against a real shop: create draft with 2 images → read back →
update copy + append image → read back → delete → 404; shop listing counts unchanged
after. Etsy's validation errors arrive as a JSON **array** of `{path, type, message}`, not
`{error}`; the client joins them into the error message. The shop's listing indexes
(`?state=draft` etc.) lag the authoritative `GET /listings/{id}` by up to a minute.

`POST /api/etsy/publish` `{key, images: skip|append|replace, activate?, like_listing_id?,
price?, quantity?, dry_run?}` does, in order: gate on `status == approved` and on the
token having `listings_w`; validate copy limits; for a new listing, copy the commercial
settings from `like_listing_id`, create the draft, **write the new id to staging.json
immediately** (so a later failure can't orphan it); PATCH the copy; upload images in
picked order — and for `replace`, **upload first, delete the old images last**, so a
failure half-way never leaves a live listing with fewer images (the 20-image limit is
checked against existing + new before anything is sent); optionally activate; `GET` the
listing back; compare title / description / tags / image count / state; only then set
`published`. `dry_run: true` returns the plan and sends nothing, and works with a
read-only token. Mismatches come back as HTTP 502 with both sides in `detail`.
`POST /api/etsy/retract {key}` is the undo for a create: deletes the draft the tool made
(refuses anything else, refuses active listings, needs `listings_d`), confirms the 404,
and returns the entry to `approved` with a `retracted` record.

Facts learned publishing a different shop with a sibling tool (30 listings live), not
exercised here yet but worth knowing before you hit them:
- `when_made`, `who_made` and `is_supply` must be PATCHed together; Etsy rejects one alone.
- Etsy refuses to delete a listing's last image — upload replacements first (the tool does).
- Deleting a video only marks it `inactive` on the first call; it still counts toward the
  2-video cap. Delete again after the replacement is up.
- `PUT /listings/{id}/inventory` is a whole-record replace whose shape differs from the
  GET: strip `product_id`, `offering_id`, `is_deleted`; price object → number;
  `readiness_state_id` per offering. `createDraftListing` takes price and quantity
  directly, so a new listing never needs it.
- No copy/duplicate endpoint, and no API field for "how does your shop produce this
  item?" — Shop Manager's Copy carries those checkboxes; the API can't.
- Setting `state: active` publishes immediately and charges the listing fee; deactivating
  hides but does not refund. Drafts have no public URL until activated.
- Descriptions are plain text; HTML and Markdown are stripped.
- Sustained reads 429 — keep ~0.6–1 s between calls in audits. Etsy's public pages 403 curl.

### Printful (API is deliberately limited for platform stores)

- **Product templates are read-only via API** (`GET`, `DELETE` only). Framing, sizes,
  renaming: dashboard only. This repo's tool for that is the **baseline**:
  `POST /api/printful/baseline {snapshot:true}` records `{id: {title, updated_at}}`;
  `GET /api/printful/baseline` diffs the live list against it. Use it (a) before any
  automation touches a template — a changed `updated_at` means a human edited it, stop
  and ask — and (b) after a browser-driven edit, to prove exactly which templates changed
  and how. If you automate the dashboard (Playwright etc.), every step needs the §1
  treatment; the original project's playbook for that is summarised in §5 and §9.
- **The Products API "will never support creating and managing products in external
  platforms"** (Printful's words). For an Etsy store the product is created on Etsy and
  synced; the writable Printful side is the **sync layer**:
  `PUT /sync/variant/{id}` sets `variant_id` (Printful catalog variant), `files`
  (print files), `retail_price`, `external_id` (the Etsy variant), `is_ignored`, `sku`.
  `POST /api/printful/sync-variant {id, …fields}` does the PUT, reads the variant back,
  and compares every scalar field you sent. `GET /api/printful/sync-product?id=` shows a
  product's variants.
- Pushing a *new* Printful design to Etsy end-to-end is: template in Printful (dashboard)
  → render mockups here → stage + approve → `publish` creates the Etsy listing → link
  its variants to the template's variants with `sync-variant`. The dashboard's "Add to
  Etsy" does the last two steps in one click if you prefer; the API route is what lets
  the human approve the copy and images first.
