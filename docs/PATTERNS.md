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
  enumerate every size in a multi-size title.
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
  several page sizes and dedupe. One template in ~475 stayed unreachable regardless.
- Templates are account-level: account-level token + `X-PF-Store-Id` on store calls.
- Etsy-platform stores: `GET /sync/products`, not `GET /store/products`.
- `POST /v2/mockup-tasks`:
  - `source: "product_template"` + `product_template_id` renders an existing template —
    no print file, nothing uploaded, read-only against the store, 2000 px via
    `mockup_width_px`.
  - **One product per task.** A multi-product task silently renders only the first.
  - Vertical and horizontal style ids can't mix; the error lists the ids that fit.
  - Rate limit ≈ one task per 35–45 s; back off on "exceed available attempts".
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
  "template:105688300": {
    "status": "staged",
    "title": "…",
    "tags": ["…", "…"],
    "description": "…",
    "notes": "free text for the human or the agent",
    "images": [ { "url": "…", "label": "Default|Front", "style_id": 123, "variant_id": 4533 } ],
    "candidates": [ { "url": "…", "label": "Lifestyle 2|Mockup" } ],
    "etsy_listing_id": null,
    "edited_at": "2026-08-29T12:00:00Z"
  }
}
```

- `status` moves **idea → staged → approved → published**. Only a human moves it to
  `approved`. Only a verified write (see §1) moves it to `published`, and that write
  records the resulting `etsy_listing_id`.
- `images` is the listing order; `candidates` is everything rendered but not chosen.
- Human decisions round-trip through this file (or through files the review page
  exports and the human drops back into the repo). Clipboard paste truncates in some
  terminals; files don't.
- The server only ever merge-patches entries. Nothing in the staging flow writes to
  Etsy or Printful.

## 9 · Working with a human reviewer

- Give them one page to decide on, with everything needed on it. Don't ask them to
  judge from raw links.
- Build all products for **one design** before the next, so sets stay adjacent.
- When something can't be done well (a subject too close to the edge for a bleed size),
  **say so** — "this size doesn't work" is a correct output.
- Record who changed what. If the human pre-edited a batch before grading it, the grades
  measure the shared result, not your automation. Don't cite them as evidence it
  improved.
