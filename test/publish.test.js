// Exercises the Etsy publish path against a FAKE Etsy (global fetch is replaced), so it
// runs with no keys and touches no live shop. What it checks: the approval gate, the
// scope gate, the exact requests sent (method, path, encoding, order), and that the
// read-back comparison is what decides `published`.
// Run: node --test
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

// Isolated data dir + fake env, then load the server.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
fs.mkdirSync(path.join(tmp, 'data'));
fs.mkdirSync(path.join(tmp, 'public'));
fs.writeFileSync(path.join(tmp, 'public', 'index.html'), '<html></html>');
fs.copyFileSync(path.join(__dirname, '..', 'server.js'), path.join(tmp, 'server.js'));
process.env.PORT = '0';
process.env.ETSY_API_KEY = 'key';
process.env.ETSY_SHARED_SECRET = 'secret';
process.env.ETSY_SHOP_ID = '777';
process.env.PRINTFUL_API_TOKEN = '';

const nodeFetch = global.fetch; // the real one, for the test's own calls to the server
const calls = [];
const listing = { listing_id: 555, title: 'old', description: 'old desc', tags: ['x'], state: 'active', url: 'https://www.etsy.com/listing/555', images: [{ listing_image_id: 1 }, { listing_image_id: 2 }],
  quantity: 5, price: { amount: 1800, divisor: 100 }, who_made: 'i_did', when_made: 'made_to_order', taxonomy_id: 1234, shipping_profile_id: 9, return_policy_id: 8, readiness_state_id: 55, type: 'physical' };
let failReadback = false;
let failNextUpload = false;

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  calls.push({ method, url: u, body: opts.body, ct: opts.headers?.['Content-Type'] });
  const json = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj), headers: new Map() });
  if (u.includes('/oauth/token')) return json({ access_token: 'tok', refresh_token: 'r', expires_in: 3600 });
  if (u.endsWith('/listings/555/images') && method === 'GET') return json({ results: [...listing.images] }); // copy: a real API can't hand back a live reference
  if (/\/images\/\d+$/.test(u) && method === 'DELETE') { listing.images = listing.images.filter(i => !u.endsWith('/' + i.listing_image_id)); return json({}); }
  if (u.endsWith('/listings/555/images') && method === 'POST' && failNextUpload) { failNextUpload = false; return json({ error: 'upload failed' }, 500); }
  if (u.endsWith('/listings/555/images') && method === 'POST') { listing.images.push({ listing_image_id: 100 + listing.images.length }); return json({}); }
  if (u.endsWith('/listings/555') && method === 'DELETE') { listing.deleted = true; return json({}); }
  if (u.endsWith('/listings/555') && method === 'GET' && listing.deleted) return json({ error: 'Resource not found' }, 404);
  if (u.includes('/shops/777/listings/555') && method === 'PATCH') {
    const p = new URLSearchParams(opts.body);
    if (!failReadback) { for (const k of ['title', 'description', 'state']) if (p.has(k)) listing[k] = p.get(k); if (p.has('tags')) listing.tags = p.get('tags').split(','); }
    return json(listing);
  }
  if (u.endsWith('/shops/777/listings') && method === 'POST') return json({ listing_id: 556 });
  if (u.includes('/listings/555')) return json(listing);
  if (u.includes('/listings/556')) return json({ ...listing, listing_id: 556, title: new URLSearchParams(calls.find(c => c.url.endsWith('/shops/777/listings') && c.method === 'POST').body).get('title'), tags: ['new'], description: 'new desc', images: [], state: 'draft' });
  return json({ error: 'unexpected ' + method + ' ' + u }, 404);
};

// Start the server on a random port and talk to it over HTTP like the UI does.
let base, server;
async function start() {
  const origListen = http.Server.prototype.listen;
  await new Promise(resolve => {
    http.Server.prototype.listen = function (port, cb) { server = this; return origListen.call(this, 0, () => { base = `http://localhost:${this.address().port}`; cb && cb(); resolve(); }); };
    require(path.join(tmp, 'server.js'));
  });
}
async function api(p, body) {
  const res = await fetch(base + p, body ? { method: 'POST', body: JSON.stringify(body) } : {});
  return { status: res.status, json: await res.json() };
}
function stage(entry) { fs.writeFileSync(path.join(tmp, 'data', 'staging.json'), JSON.stringify(entry)); }
function tokens(scopes) { fs.writeFileSync(path.join(tmp, 'data', 'etsy-tokens.json'), JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Date.now() + 1e7, scopes })); }

test('publish path', async (t) => {
  const fake = global.fetch;
  await start();
  // the server's outbound calls go to the fake Etsy; the test's own calls go to the real server
  global.fetch = (url, opts) => String(url).startsWith(base) ? nodeFetch(url, opts) : fake(url, opts);
  t.after(() => { server.closeAllConnections?.(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

  await t.test('refuses anything not approved', async () => {
    stage({ 'listing:555': { status: 'staged', title: 'New title' } });
    tokens('listings_r listings_w shops_r');
    const r = await api('/api/etsy/publish', { key: 'listing:555' });
    assert.equal(r.status, 500);
    assert.match(r.json.error, /not "approved"/);
    assert.equal(calls.filter(c => c.method !== 'GET').length, 0, 'no writes were sent');
  });

  await t.test('refuses without listings_w', async () => {
    stage({ 'listing:555': { status: 'approved', title: 'New title' } });
    tokens('listings_r shops_r');
    const r = await api('/api/etsy/publish', { key: 'listing:555' });
    assert.match(r.json.error, /listings_w/);
  });

  await t.test('refuses copy over Etsy limits', async () => {
    stage({ 'listing:555': { status: 'approved', title: 'x'.repeat(141) } });
    tokens('listings_r listings_w shops_r');
    const r = await api('/api/etsy/publish', { key: 'listing:555' });
    assert.match(r.json.error, /141 chars/);
  });

  await t.test('dry run returns the plan and writes nothing, even without listings_w', async () => {
    stage({ 'listing:555': { status: 'approved', title: 'New title', tags: ['a', 'b'] } });
    tokens('listings_r shops_r');
    calls.length = 0;
    const r = await api('/api/etsy/publish', { key: 'listing:555', dry_run: true });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.plan.update, { title: 'New title', tags: ['a', 'b'] });
    assert.equal(r.json.plan.has_listings_w, false);
    assert.equal(calls.filter(c => ['PATCH', 'POST', 'DELETE'].includes(c.method)).length, 0);
    tokens('listings_r listings_w shops_r');
  });

  await t.test('updates copy, replaces images in order, reads back, marks published', async () => {
    const img = path.join(tmp, 'data', 'mockups', '1'); fs.mkdirSync(img, { recursive: true });
    fs.writeFileSync(path.join(img, 'a.jpg'), 'AAA'); fs.writeFileSync(path.join(img, 'b.jpg'), 'BBB');
    stage({ 'listing:555': { status: 'approved', title: 'New title', description: 'new desc', tags: ['a', 'b'],
      images: [{ url: '/data/mockups/1/a.jpg' }, { url: '/data/mockups/1/b.jpg' }] } });
    calls.length = 0;
    const r = await api('/api/etsy/publish', { key: 'listing:555', images: 'replace' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const writes = calls.filter(c => c.method !== 'GET').map(c => `${c.method} ${new URL(c.url).pathname}`);
    // uploads BEFORE deletes: a failed upload must never strip a live listing
    assert.deepEqual(writes, [
      'PATCH /v3/application/shops/777/listings/555',
      'POST /v3/application/shops/777/listings/555/images',
      'POST /v3/application/shops/777/listings/555/images',
      'DELETE /v3/application/shops/777/listings/555/images/1',
      'DELETE /v3/application/shops/777/listings/555/images/2',
    ]);
    const patch = calls.find(c => c.method === 'PATCH');
    assert.equal(patch.ct, 'application/x-www-form-urlencoded');
    assert.equal(new URLSearchParams(patch.body).get('tags'), 'a,b');
    const up = calls.filter(c => c.method === 'POST');
    assert.ok(up[0].body instanceof FormData);
    assert.equal(up[0].body.get('rank'), '3'); // after the 2 existing images, which are deleted afterwards
    assert.equal(up[1].body.get('rank'), '4');
    assert.deepEqual(r.json.plan.images_result, { uploaded: 2, deleted: 2, mode: 'replace' });
    assert.equal(up[0].body.get('image').name, 'a.jpg');
    assert.deepEqual(r.json.mismatches, []);
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'staging.json')));
    assert.equal(saved['listing:555'].status, 'published');
    assert.equal(saved['listing:555'].etsy_listing_id, 555);
  });

  await t.test('a failed upload during replace leaves the existing images in place', async () => {
    const img = path.join(tmp, 'data', 'mockups', '1');
    stage({ 'listing:555': { status: 'approved', title: 'New title', images: [{ url: '/data/mockups/1/a.jpg' }, { url: '/data/mockups/1/b.jpg' }] } });
    const before = listing.images.map(i => i.listing_image_id);
    failNextUpload = true;
    calls.length = 0;
    const r = await api('/api/etsy/publish', { key: 'listing:555', images: 'replace' });
    assert.equal(r.status, 502);
    assert.match(r.json.error, /upload failed/);
    assert.equal(calls.filter(c => c.method === 'DELETE').length, 0, 'nothing was deleted');
    assert.deepEqual(listing.images.map(i => i.listing_image_id), before);
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'staging.json')));
    assert.equal(saved['listing:555'].status, 'approved');
  });

  await t.test('more than 20 images is refused before any image write', async () => {
    stage({ 'listing:555': { status: 'approved', images: Array.from({ length: 21 }, () => ({ url: '/data/mockups/1/a.jpg' })) } });
    calls.length = 0;
    const r = await api('/api/etsy/publish', { key: 'listing:555', images: 'append' });
    assert.match(r.json.error, /exceeds Etsy's limit of 20/);
    assert.equal(calls.filter(c => c.method !== 'GET').length, 0);
  });

  await t.test('a read-back mismatch does NOT mark published', async () => {
    stage({ 'listing:555': { status: 'approved', title: 'Another title' } });
    failReadback = true;
    const r = await api('/api/etsy/publish', { key: 'listing:555' });
    failReadback = false;
    assert.equal(r.status, 502);
    assert.match(r.json.error, /read-back differs on: title/);
    assert.equal(r.json.detail.mismatches[0].field, 'title');
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'staging.json')));
    assert.equal(saved['listing:555'].status, 'approved');
    assert.ok(saved['listing:555'].last_publish_error);
  });

  await t.test('creates a draft listing from a template entry, cloning settings from a like-listing', async () => {
    stage({ 'template:42': { status: 'approved', title: 'Brand new', description: 'new desc', tags: ['new'] } });
    calls.length = 0;
    const r = await api('/api/etsy/publish', { key: 'template:42', like_listing_id: 555, price: 22 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const create = calls.find(c => c.method === 'POST' && c.url.endsWith('/shops/777/listings'));
    const p = new URLSearchParams(create.body);
    assert.equal(p.get('taxonomy_id'), '1234');
    assert.equal(p.get('shipping_profile_id'), '9');
    assert.equal(p.get('who_made'), 'i_did');
    assert.equal(p.get('readiness_state_id'), '55');
    assert.equal(p.get('price'), '22');
    assert.equal(p.get('quantity'), '5');
    assert.equal(r.json.listing_id, 556);
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'staging.json')));
    assert.equal(saved['template:42'].status, 'published');
    assert.equal(saved['template:42'].etsy_listing_id, 556);
    assert.equal(saved['template:42'].etsy_state, 'draft');
  });

  await t.test('retract refuses entries the tool did not create, then deletes its own draft and verifies 404', async () => {
    stage({ 'listing:555': { status: 'published', etsy_listing_id: 555 } });
    tokens('listings_r listings_w listings_d shops_r');
    let r = await api('/api/etsy/retract', { key: 'listing:555' });
    assert.match(r.json.error, /not created by this tool/);
    stage({ 'template:42': { status: 'published', etsy_listing_id: 555, created_by_tool: true } });
    listing.state = 'draft';
    calls.length = 0;
    r = await api('/api/etsy/retract', { key: 'template:42' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const del = calls.find(c => c.method === 'DELETE');
    assert.equal(new URL(del.url).pathname, '/v3/application/listings/555', 'deleteListing is not under /shops/');
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'staging.json')));
    assert.equal(saved['template:42'].status, 'approved');
    assert.equal(saved['template:42'].etsy_listing_id, null);
    assert.equal(saved['template:42'].retracted.listing_id, 555);
    listing.deleted = false; listing.state = 'active';
  });

  await t.test('rejects a title with more than 3 all-caps words before any write', async () => {
    stage({ 'listing:555': { status: 'approved', title: 'WORKBENCH TEST LISTING DELETE ME now' } });
    tokens('listings_r listings_w shops_r');
    calls.length = 0;
    const r = await api('/api/etsy/publish', { key: 'listing:555' });
    assert.match(r.json.error, /5 words starting with two capitals/);
    assert.equal(calls.filter(c => c.method !== 'GET').length, 0);
  });

  await t.test('creating without a like-listing is refused before any write', async () => {
    stage({ 'template:43': { status: 'approved', title: 'Brand new' } });
    calls.length = 0;
    const r = await api('/api/etsy/publish', { key: 'template:43' });
    assert.match(r.json.error, /like_listing_id/);
    assert.equal(calls.filter(c => c.method !== 'GET').length, 0);
  });
});
