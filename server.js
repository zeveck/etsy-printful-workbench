// Etsy × Printful staging server.
// Zero-dependency Node (18+) server: serves the UI from ./public and proxies both
// APIs so tokens never reach the browser. Run: node server.js
//
// Routes are listed at the bottom. Everything the UI saves goes to data/*.json,
// which are meant to be committed — the repo is the source of truth for staged work.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');

// --- tiny .env loader (no dependencies) ---
function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#')) {
        const val = m[2].replace(/^["']|["']$/g, '');
        if (!(m[1] in process.env)) process.env[m[1]] = val;
      }
    }
  } catch { /* no .env yet — the UI will say so */ }
}
loadEnv(path.join(ROOT, '.env'));

// Etsy wants "keystring:shared_secret" in the x-api-key header (not just the keystring)
const ETSY_KEY = process.env.ETSY_SHARED_SECRET
  ? `${process.env.ETSY_API_KEY}:${process.env.ETSY_SHARED_SECRET}`
  : (process.env.ETSY_API_KEY || '');
const PRINTFUL_TOKEN = process.env.PRINTFUL_API_TOKEN || '';

const PRINTFUL_API = 'https://api.printful.com';
const ETSY_API = 'https://api.etsy.com/v3/application';

// --- simple in-memory cache: { key: { at, data } } ---
const cache = {};
const CACHE_MS = 5 * 60 * 1000;
function cached(key) {
  const hit = cache[key];
  return hit && Date.now() - hit.at < CACHE_MS ? hit.data : null;
}
function remember(key, data) {
  cache[key] = { at: Date.now(), data };
  return data;
}

// --- JSON file helpers (data/*.json) ---
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(obj, null, 1) + '\n');
}

// --- Printful client (v1 and v2 share the same host and token) ---
async function printful(pathname, { storeId, method = 'GET', body } = {}) {
  const headers = {
    Authorization: `Bearer ${PRINTFUL_TOKEN}`,
    // Printful's edge rejects some default User-Agents with 403; a plain UA is reliable.
    'User-Agent': 'curl/8',
  };
  if (storeId) headers['X-PF-Store-Id'] = String(storeId);
  if (body) headers['Content-Type'] = 'application/json';
  let res, json;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(PRINTFUL_API + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined });
    json = await res.json().catch(() => ({}));
    // General limit is 120 calls/min; the template sweep alone can brush it. Back off and retry.
    if (res.status !== 429 || attempt >= 3) break;
    const wait = Number(res.headers.get('retry-after')) || 5 * (attempt + 1);
    console.warn(`Printful 429 on ${pathname}; retrying in ${wait}s`);
    await new Promise(r => setTimeout(r, wait * 1000));
  }
  if (!res.ok) {
    const msg = json?.error?.message || json?.result || (json?.errors && JSON.stringify(json.errors)) || res.statusText;
    throw Object.assign(new Error(`Printful ${res.status}: ${msg}`), { status: res.status, body: json });
  }
  return json;
}

// --- Etsy client (API key always; OAuth bearer when connected) ---
async function etsy(pathname, { method = 'GET', body } = {}) {
  // Etsy requires the combined "keystring:shared_secret" x-api-key form even on OAuth'd calls
  const headers = { 'x-api-key': ETSY_KEY };
  const tok = await etsyAccessToken().catch(() => null);
  if (tok) headers.Authorization = `Bearer ${tok}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(ETSY_API + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error || res.statusText;
    throw Object.assign(new Error(`Etsy ${res.status}: ${msg}`), { status: res.status });
  }
  return json;
}

// --- Etsy OAuth 2.0 with PKCE ---
// Scopes default to READ-ONLY. Widen deliberately (ETSY_OAUTH_SCOPES in .env) when you
// are ready to write; changing scopes means re-running /etsy/connect — the human's click
// on Etsy's consent screen is the approval gate for the wider access.
const OAUTH_SCOPES = process.env.ETSY_OAUTH_SCOPES || 'listings_r shops_r';
const TOKENS_FILE = path.join(DATA, 'etsy-tokens.json'); // gitignored
const REDIRECT_URI = process.env.ETSY_REDIRECT_URI || `http://localhost:${PORT}/etsy/callback`;
let pendingAuth = null; // { state, verifier } for the single in-flight consent

function loadTokens() {
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch { return null; }
}
function saveTokens(t) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 1));
}

async function tokenRequest(params) {
  const res = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Etsy token ${res.status}: ${body.error_description || body.error || res.statusText}`);
  return body;
}

async function etsyAccessToken() {
  const t = loadTokens();
  if (!t) return null;
  if (Date.now() < t.expires_at - 60_000) return t.access_token;
  const fresh = await tokenRequest({
    grant_type: 'refresh_token',
    client_id: process.env.ETSY_API_KEY,
    refresh_token: t.refresh_token,
  });
  saveTokens({
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token,
    expires_at: Date.now() + fresh.expires_in * 1000,
    scopes: t.scopes,
  });
  return fresh.access_token;
}

function oauthConnect(res) {
  if (!process.env.ETSY_API_KEY) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h2>No Etsy key</h2><p>Set ETSY_API_KEY and ETSY_SHARED_SECRET in .env first — see docs/SETUP-KEYS.md.</p>');
    return;
  }
  const verifier = crypto.randomBytes(32).toString('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  pendingAuth = { state, verifier };
  const auth = new URL('https://www.etsy.com/oauth/connect');
  auth.search = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.ETSY_API_KEY,
    redirect_uri: REDIRECT_URI,
    scope: OAUTH_SCOPES,
    state,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  res.writeHead(302, { Location: auth.toString() });
  res.end();
}

async function oauthCallback(url, res) {
  try {
    const err = url.searchParams.get('error');
    if (err) throw new Error(`${err}: ${url.searchParams.get('error_description') || ''}`);
    if (!pendingAuth || url.searchParams.get('state') !== pendingAuth.state) {
      throw new Error('State mismatch or no auth in flight — start again at /etsy/connect');
    }
    const body = await tokenRequest({
      grant_type: 'authorization_code',
      client_id: process.env.ETSY_API_KEY,
      redirect_uri: REDIRECT_URI,
      code: url.searchParams.get('code'),
      code_verifier: pendingAuth.verifier,
    });
    pendingAuth = null;
    saveTokens({
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: Date.now() + body.expires_in * 1000,
      scopes: OAUTH_SCOPES,
    });
    // Report what Etsy actually granted, not what we asked for.
    let granted = OAUTH_SCOPES;
    try { const me = await etsy('/users/me'); granted += ` (user ${me.user_id}, shop ${me.shop_id ?? 'none'})`; } catch {}
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h2>Etsy connected</h2><p>Scopes: ${granted}. Tokens saved server-side in data/etsy-tokens.json (gitignored). You can close this tab.</p>`);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h2>Etsy OAuth failed</h2><pre>${e.message}</pre><p><a href="/etsy/connect">Try again</a></p>`);
  }
}

// --- Printful: store, sync products, templates ---
async function getStore() {
  const hit = cached('store');
  if (hit) return hit;
  if (process.env.PRINTFUL_STORE_ID) {
    return remember('store', { id: Number(process.env.PRINTFUL_STORE_ID), name: process.env.ETSY_SHOP_NAME || '' });
  }
  const { result } = await printful('/stores');
  if (!result?.length) throw new Error('Printful token can see no stores');
  // account-level tokens also see the built-in "Personal orders" native store — prefer the platform store
  const store = result.find(s => s.type === 'etsy') || result[0];
  return remember('store', { id: store.id, name: store.name, type: store.type });
}

async function getPrintfulProducts() {
  const hit = cached('printful');
  if (hit) return hit;
  const store = await getStore();
  const items = [];
  // Etsy-platform stores expose products via /sync/products (NOT /store/products)
  for (let offset = 0; ; offset += 100) {
    const page = await printful(`/sync/products?limit=100&offset=${offset}`, { storeId: store.id });
    items.push(...page.result);
    if (items.length >= (page.paging?.total ?? items.length) || page.result.length === 0) break;
  }
  return remember('printful', {
    store,
    products: items.map(p => ({
      id: p.id,
      etsy_listing_id: p.external_id, // for Etsy-platform stores this is the Etsy listing ID
      name: p.name,
      variants: p.variants,
      synced: p.synced,
      thumbnail: p.thumbnail_url,
      ignored: p.is_ignored,
    })),
  });
}

async function getTemplates() {
  const hit = cached('templates');
  if (hit) return hit;
  const store = await getStore();
  const byId = new Map();
  let total = Infinity;
  // Printful's template pagination is buggy: some offset/limit combinations return the
  // wrong page's content. Sweep with several page sizes (shifting page boundaries each
  // time) and dedupe by id until the unique count reaches the reported total.
  for (const size of [100, 99, 97, 95, 93, 91]) {
    for (let offset = 0; offset < total; offset += size) {
      const limit = Math.min(size, total - offset);
      const page = await printful(`/product-templates?limit=${limit}&offset=${offset}`, { storeId: store.id });
      total = page.paging?.total ?? 0;
      for (const t of page.result?.items || []) byId.set(t.id, t);
      if (!(page.result?.items || []).length) break;
    }
    if (byId.size >= total) break;
  }
  // What's missing varies run to run (the list is not stably ordered while templates are
  // being edited); a Refresh usually recovers most of it, one or two may stay unreachable.
  if (byId.size < total) console.warn(`templates: got ${byId.size} of ${total} after all sweeps`);
  // Local overlay: Printful can't store a group/collection label or a better title for
  // generic template names ("Poster"), so data/template-meta.json holds {id: {group, title}}.
  const meta = readJson('template-meta.json', {});
  return remember('templates', {
    total,
    templates: [...byId.values()].map(t => {
      const m = meta[t.id] || {};
      return {
        id: t.id,
        title: m.title || t.title,
        original_title: m.title && m.title !== t.title ? t.title : undefined,
        group: m.group || null,
        mockup: t.mockup_file_url,
        product_id: t.product_id,
        updated: t.updated_at,
      };
    }),
  });
}

// --- Printful v2 mockups: styles list + render from an existing template ---
const SEASONAL = /halloween|christmas|holiday|valentine|spring|summer|july|easter|mother|father/i;

async function getMockupStyles(productId) {
  const key = `styles:${productId}`;
  const hit = cached(key);
  if (hit) return hit;
  const { data } = await printful(`/v2/catalog-products/${productId}/mockup-styles?limit=100`);
  const styles = [];
  for (const placement of data || []) {
    for (const s of placement.mockup_styles || []) {
      styles.push({
        id: s.id,
        placement: placement.placement,
        category: s.category_name,
        view: s.view_name,
        label: `${s.category_name}|${s.view_name}`,
        seasonal: SEASONAL.test(s.category_name),
        restricted_to_variants: s.restricted_to_variants || null,
      });
    }
  }
  return remember(key, { product_id: Number(productId), styles });
}

// Create ONE mockup task for ONE template and wait for it. Printful silently renders only
// the first product of a multi-product task, so this endpoint is deliberately singular.
async function renderTemplateMockups(body) {
  const { product_template_id, catalog_variant_ids, mockup_style_ids, format = 'jpg', width = 2000 } = body || {};
  if (!product_template_id) throw new Error('product_template_id is required');
  const store = await getStore();
  const product = {
    source: 'product_template',
    product_template_id: Number(product_template_id),
  };
  if (catalog_variant_ids?.length) product.catalog_variant_ids = catalog_variant_ids.map(Number);
  if (mockup_style_ids?.length) product.mockup_style_ids = mockup_style_ids.map(Number);
  const req = { format, mockup_width_px: Number(width), products: [product] };

  let task;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await printful('/v2/mockup-tasks', { storeId: store.id, method: 'POST', body: req });
      task = r.data?.[0];
      break;
    } catch (e) {
      // Printful refuses to mix vertical and horizontal styles in one request; the error
      // message lists the ids that fit. Keep those and retry once.
      const m = /Vertical mockup style IDs: ([0-9, ]+)/.exec(JSON.stringify(e.body || e.message));
      if (m && product.mockup_style_ids) {
        const keep = new Set(m[1].split(',').map(s => Number(s.trim())).filter(Boolean));
        product.mockup_style_ids = product.mockup_style_ids.filter(id => keep.has(id));
        if (product.mockup_style_ids.length) continue;
      }
      throw e;
    }
  }
  if (!task) throw new Error('Printful did not return a mockup task');

  // Poll. Renders usually finish in 10–60 s; give up after ~3 min.
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 6000));
    const { data } = await printful(`/v2/mockup-tasks?id=${task.id}`, { storeId: store.id });
    const t = data?.[0];
    if (!t) continue;
    if (t.status === 'completed') {
      const mockups = [];
      for (const cv of t.catalog_variant_mockups || []) {
        for (const m of cv.mockups || []) {
          mockups.push({ variant_id: cv.catalog_variant_id, style_id: m.style_id, placement: m.placement, url: m.mockup_url });
        }
      }
      await saveMockupsLocally(product.product_template_id, mockups, format);
      return { task_id: t.id, status: t.status, request: req, mockups };
    }
    if (t.status === 'failed') throw new Error(`mockup task failed: ${JSON.stringify(t.failure_reasons || t)}`);
  }
  throw new Error(`mockup task ${task.id} still pending after 3 minutes — poll /api/printful/mockup-task?id=${task.id}`);
}

// Printful serves rendered mockups from a temporary (/tmp/) S3 path with no documented
// lifetime. Save a copy under data/mockups/<template>/ (gitignored) and point `url` at it,
// so the staging board — and a later Etsy upload — never depend on the remote copy.
// `source_url` keeps the original for provenance.
async function saveMockupsLocally(templateId, mockups, format) {
  const dir = path.join(DATA, 'mockups', String(templateId));
  fs.mkdirSync(dir, { recursive: true });
  for (const m of mockups) {
    const ext = /png/i.test(format) ? 'png' : 'jpg';
    const name = `${m.style_id}-${m.variant_id}.${ext}`;
    try {
      const res = await fetch(m.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(path.join(dir, name), Buffer.from(await res.arrayBuffer()));
      m.source_url = m.url;
      m.url = `/data/mockups/${templateId}/${name}`;
    } catch (e) {
      console.warn(`mockup ${name}: could not save locally (${e.message}); keeping the remote URL`);
    }
  }
}

// --- Etsy: shop lookup + active listings with images ---
async function getEtsyShop() {
  const hit = cached('shop');
  if (hit) return hit;
  if (process.env.ETSY_SHOP_ID) return remember('shop', { shop_id: Number(process.env.ETSY_SHOP_ID) });
  // Without an explicit shop, fall back to the Printful store name — but only if Printful
  // is configured, so a missing Printful token doesn't surface as a Printful error here.
  const name = process.env.ETSY_SHOP_NAME || (PRINTFUL_TOKEN ? (await getStore()).name : '');
  if (!name) throw new Error('Set ETSY_SHOP_ID or ETSY_SHOP_NAME in .env (no Printful store name to fall back on)');
  const found = await etsy(`/shops?shop_name=${encodeURIComponent(name)}`);
  const exact = found.results?.find(s => s.shop_name.toLowerCase() === name.toLowerCase()) || found.results?.[0];
  if (!exact) throw new Error(`No Etsy shop found matching "${name}" — set ETSY_SHOP_ID in .env`);
  return remember('shop', { shop_id: exact.shop_id, shop_name: exact.shop_name });
}

async function getEtsyListings() {
  const hit = cached('etsy');
  if (hit) return hit;
  const shop = await getEtsyShop();
  const listings = [];
  for (let offset = 0; ; offset += 100) {
    const page = await etsy(`/shops/${shop.shop_id}/listings/active?limit=100&offset=${offset}`);
    listings.push(...page.results);
    if (listings.length >= page.count || page.results.length === 0) break;
  }
  // batch-fetch images (100 ids per call)
  const images = {};
  for (let i = 0; i < listings.length; i += 100) {
    const ids = listings.slice(i, i + 100).map(l => l.listing_id).join(',');
    try {
      const batch = await etsy(`/listings/batch?listing_ids=${ids}&includes=Images`);
      for (const l of batch.results) images[l.listing_id] = l.images?.[0]?.url_170x135 || null;
    } catch { /* images are cosmetic; keep going */ }
  }
  return remember('etsy', {
    shop,
    listings: listings.map(l => ({
      listing_id: l.listing_id,
      title: l.title,
      state: l.state,
      quantity: l.quantity,
      tags: l.tags || [],
      price: l.price ? `${(l.price.amount / l.price.divisor).toFixed(2)} ${l.price.currency_code}` : null,
      url: l.url,
      thumbnail: images[l.listing_id] || null,
      // same CDN image at a bigger size for the zoom view
      image_large: images[l.listing_id] ? images[l.listing_id].replace('170x135', '570xN') : null,
    })),
  });
}

// --- status: one call tells the UI what is configured, connected, and broken ---
async function getStatus() {
  const out = {
    etsy: { configured: !!ETSY_KEY, active: false, oauth: false, scopes: null },
    printful: { configured: !!PRINTFUL_TOKEN, active: false, store: null },
    oauth_scopes_requested: OAUTH_SCOPES,
  };
  if (ETSY_KEY) {
    const t = loadTokens();
    out.etsy.oauth = !!t;
    out.etsy.scopes = t?.scopes || null;
    try { await etsy('/openapi-ping'); out.etsy.active = true; } catch (e) { out.etsy.error = e.message; }
    if (t) {
      try {
        const me = await etsy('/users/me');
        out.etsy.user_id = me.user_id;
        out.etsy.shop_id = me.shop_id;
      } catch (e) { out.etsy.oauth_error = e.message; }
    }
  }
  if (PRINTFUL_TOKEN) {
    try { out.printful.store = await getStore(); out.printful.active = true; } catch (e) { out.printful.error = e.message; }
  }
  return out;
}

// --- staging state: data/staging.json, keyed "listing:<id>" or "template:<id>" ---
// See docs/PATTERNS.md for the entry shape. The UI only ever merges patches; nothing
// here writes to Etsy or Printful.
const STAGING_FILE = 'staging.json';
const STATUSES = ['idea', 'staged', 'approved', 'published'];

const routes = {
  '/api/status': getStatus,
  '/api/etsy/listings': getEtsyListings,
  '/api/printful/products': getPrintfulProducts,
  '/api/printful/templates': getTemplates,
  // raw template read — the authoritative source for "what did I actually save"
  '/api/printful/template': async (url) => {
    const id = url.searchParams.get('id');
    if (!id) throw new Error('id is required');
    const store = await getStore();
    return (await printful(`/product-templates/${id}`, { storeId: store.id })).result;
  },
  '/api/printful/mockup-styles': async (url) => {
    const pid = url.searchParams.get('product_id');
    if (!pid) throw new Error('product_id is required');
    return getMockupStyles(pid);
  },
  '/api/printful/mockups': async (url, body) => renderTemplateMockups(body),
  '/api/printful/mockup-task': async (url) => {
    const id = url.searchParams.get('id');
    const store = await getStore();
    return (await printful(`/v2/mockup-tasks?id=${id}`, { storeId: store.id })).data?.[0] || null;
  },
  '/api/staging': async () => readJson(STAGING_FILE, {}),
  '/api/staging/save': async (url, body) => {
    if (!body || typeof body !== 'object') throw new Error('expected {key: patch, ...}');
    const staging = readJson(STAGING_FILE, {});
    for (const [key, patch] of Object.entries(body)) {
      if (!/^(listing|template):\d+$/.test(key)) throw new Error(`bad key ${key}`);
      if (patch === null) { delete staging[key]; continue; }
      if (patch.status && !STATUSES.includes(patch.status)) throw new Error(`bad status ${patch.status}`);
      staging[key] = { ...(staging[key] || { status: 'idea' }), ...patch, edited_at: new Date().toISOString() };
    }
    writeJson(STAGING_FILE, staging);
    return { ok: true, count: Object.keys(staging).length };
  },
  '/api/refresh': async () => {
    for (const k of Object.keys(cache)) delete cache[k];
    return { ok: true };
  },
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  // OAuth endpoints answer with redirects/HTML, not JSON — handled before routes
  if (url.pathname === '/etsy/connect') return oauthConnect(res);
  if (url.pathname === '/etsy/callback') return oauthCallback(url, res);
  const route = routes[url.pathname];
  if (route) {
    try {
      let body = null;
      if (req.method === 'POST') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        body = JSON.parse(Buffer.concat(chunks).toString() || 'null');
      }
      const data = await route(url, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(e.status && e.status >= 400 ? 502 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, upstream_status: e.status || null }));
    }
    return;
  }
  // static files from ./public (and read-only access to ./data for the UI)
  let base = path.join(ROOT, 'public');
  let file = path.join(base, url.pathname === '/' ? 'index.html' : url.pathname);
  if (url.pathname.startsWith('/data/')) {
    base = DATA;
    file = path.join(base, url.pathname.slice('/data/'.length));
    if (path.basename(file) === 'etsy-tokens.json') { res.writeHead(403).end(); return; }
  }
  if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Workbench at http://localhost:${PORT}`));
