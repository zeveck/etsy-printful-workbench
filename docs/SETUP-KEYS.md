# Getting your keys

Two credentials from Etsy, one from Printful. Both are free. Budget about 20 minutes,
plus however long Etsy takes to activate a new app (hours to a few days).

Everything goes in `.env` (copy `.env.example`). `.env` is gitignored; never commit it.

## 1 · Etsy — register an app (~10 min)

1. Go to <https://www.etsy.com/developers/register> and sign in with your **seller**
   account. Etsy requires two-factor authentication on developer accounts; enable it if
   asked.
2. **Create a New App**:
   - *App name*: anything **without the word "Etsy" in it** (their form rejects it).
   - *Describe your application*: e.g. "Personal tool to manage my own shop's listings
     and match them with my Printful products."
   - *Website URL*: informational; your shop URL is fine.
   - "Will your app be used by other Etsy sellers?" → **No, just my own shop.** That keeps
     you on the personal-access track, which is what this tool assumes.
3. Open **Your Apps** → your app. Copy:
   - **Keystring** → `ETSY_API_KEY`
   - **Shared secret** → `ETSY_SHARED_SECRET`
4. Still in the app's settings, find **Callback URLs** (it appears when *editing* the app
   after creation, not on the registration form) and add exactly:

   ```
   http://localhost:3000/etsy/callback
   ```

   Etsy allows plain-http localhost for development. It must match `ETSY_REDIRECT_URI`
   (default shown) character for character. If you run on another port, change both.
5. **Wait for activation.** New apps start in a pending state; `/api/status` reports
   `etsy.active: false` with the error until Etsy approves it. Printful works meanwhile.

### What the key alone can do vs. what OAuth adds

| With | You get |
|---|---|
| API key only | Public data: shop lookup, active listings, images. Enough for the Matching view. |
| + OAuth (`listings_r shops_r`, the default) | Your own drafts / inactive / sold-out listings, shop details. |
| + `listings_w` | Create and edit listings, upload images. **Only add this when you are ready to publish** — set `ETSY_OAUTH_SCOPES="listings_r listings_w shops_r"` in `.env` and re-run `/etsy/connect`. Your click on Etsy's consent screen is the approval. |
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
