# Getting your keys

Two credentials from Etsy, one from Printful. Both are free. Budget about 20 minutes,
plus however long Etsy takes to activate a new app (hours to a few days).

Everything goes in `.env` (copy `.env.example`). `.env` is gitignored; never commit it.

## 1 · Etsy — register an app (~10 min, then a wait for approval)

Etsy's developer portal is **<https://www.etsy.com/developers>** (the *Dashboard*; the
navigation has just "Dashboard" and "Settings"). The docs site, developers.etsy.com, is
reference material only — apps are not managed there.

1. Sign in with your **seller** account. Etsy requires two-factor authentication on
   developer accounts; enable it if asked.
2. The Dashboard offers two tracks. Etsy's help centre puts it this way:

   | Seller App | Personal App / Commercial Access |
   |---|---|
   | "Connect your own shop data to custom tools, automations, or workflows" | "Build applications that other sellers will use" |
   | "Short application. Eligible sellers who register their app are usually approved within minutes" | "More detailed application and review process" — register a personal app first, then request Commercial API Access for it later |

   Etsy calls the seller app "the recommended starting point if you are a shop owner
   building custom tools … for your shop only", and lists as an eligibility condition
   that you "do not already have a registered app". A personal app also works for your
   own shop — this repo's author registered one in August 2026 and the menu labels
   below were checked on it. Both give you a keystring, a shared secret and callback
   URLs. Pick your track, **Get started**, and fill in:
   - *App name*: anything **without the word "Etsy" in it** (their form rejects it).
   - *Describe your application*: be concrete about the write access — reviewers approve
     boring, specific, single-shop tools. E.g. "A private tool for managing my own Etsy
     shop. It reads my listings, lets me draft and preview edits locally, and then updates
     my own listings. Not used by anyone else and not distributed."
   - *Website URL*: informational; your shop URL is fine.
   - If asked "Will your app be used by other Etsy sellers?" → **No, just my own shop.**
3. After creating it, the app appears in the Dashboard's apps table (**Personal Apps** or
   **Seller Apps**) with its **keystring** and **shared secret** (a visibility toggle
   reveals the secret). Paste them into `.env` as
   `ETSY_API_KEY` and `ETSY_SHARED_SECRET` — even while the app still says *Pending*;
   they are shown before approval and simply don't work yet.
4. **Add the callback URL.** On the Dashboard, in the apps table, click the **⋮** (three
   vertical dots) at the end of your app's row → **Edit callback URLs**
   → **+ Add callback URL** → enter exactly:

   ```
   http://localhost:3000/etsy/callback
   ```

   → **Save**. (The field is not on the registration form; it only exists in this menu.)
   Plain-http localhost is accepted for local development. It must match
   `ETSY_REDIRECT_URI` character for character (case-sensitive, no trailing slash, same
   port and path); a mismatch shows "The requested redirect URL is not permitted" at
   sign-in — the single most common setup failure with this API. If you run the server on
   another port, register that URL and set `ETSY_REDIRECT_URI` in `.env` to match — the
   server accepts whatever path that URL has.
5. **Wait for activation.** New apps start *Pending*; `/api/status` reports
   `etsy.active: false` with the error until Etsy approves it (a day or two, sometimes
   longer). Printful works meanwhile.

### What the key alone can do vs. what OAuth adds

| With | You get |
|---|---|
| API key only | Public data: shop lookup, active listings, images. Enough for the Matching view. |
| + OAuth (`listings_r shops_r`, the default) | Your own drafts / inactive / sold-out listings, shop details. |
| + `listings_w` | Create and edit listings, upload images. **Only add this when you are ready to publish** — set `ETSY_OAUTH_SCOPES="listings_r listings_w shops_r"` in `.env` and re-run `/etsy/connect`. Your click on Etsy's consent screen is the approval. |
| + `listings_d` | Delete listings. Only needed for `/api/etsy/retract` (undo a draft the tool created). |
| + `transactions_r` | Orders and sales. |

Tokens land in `data/etsy-tokens.json` (gitignored). Access tokens last an hour; the
server refreshes them automatically with the refresh token.

Etsy's rules about personal vs. commercial API access change — if `/users/me` or listing
writes 403 after activation, check the current
[Etsy API terms](https://www.etsy.com/legal/api) rather than the code.

## 2 · Printful — create a private token (~5 min)

1. Go to <https://developers.printful.com/tokens> and log in.
2. **Create a token** → **Private token** (public apps are for software sold to others).
3. Fill in:
   - *Name*: anything.
   - *Expiration*: far out; you'll make a new one when it expires.
   - **Access level — this matters:**
     - **Account level** if you want to see **product templates** (the Templates view and
       the mockup renderer). There is no template scope on single-store tokens. With an
       account-level token, set `PRINTFUL_STORE_ID` in `.env` — `server.js` sends it as
       the `X-PF-Store-Id` header that store-level calls then require.
     - *Single store* is simpler and enough for the Matching view only.
   - *Scopes*: select everything related to viewing store products, product templates,
     files, and mockups. Easier to grant now than to re-create the token later.
4. **Copy the token immediately** — it is shown once. → `PRINTFUL_API_TOKEN`.

To find your store id: `GET https://api.printful.com/stores` with the token (or start the
server without `PRINTFUL_STORE_ID` and read it from `/api/status`; the server picks the
Etsy-platform store automatically when it can).

## 3 · Put them in `.env`

```bash
cp .env.example .env
```

```
ETSY_API_KEY=your_keystring
ETSY_SHARED_SECRET=your_shared_secret
PRINTFUL_API_TOKEN=your_token
PRINTFUL_STORE_ID=1234567          # needed with an account-level token
# ETSY_SHOP_ID=12345678            # optional; skips the shop-name lookup
# ETSY_SHOP_NAME=YourShopName      # optional; defaults to the Printful store name
# ETSY_OAUTH_SCOPES=listings_r shops_r
# ETSY_REDIRECT_URI=http://localhost:3000/etsy/callback
# PORT=3000
```

## 4 · Verify

```bash
node server.js
curl -s localhost:3000/api/status | python3 -m json.tool
```

You want `printful.active: true` with a store, and `etsy.active: true`. Then open
http://localhost:3000 and click **Connect Etsy (OAuth)**.

Keep the keys private: together they can read — and, with write scopes, change — your
store.
