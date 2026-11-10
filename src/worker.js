// Save-code backend for Lucky's Work Timer (Cloudflare Worker + D1).
// The site itself is the static files in public/; this only answers /api/ requests.
//
//   POST /api/claim        { name, data? }  -> { code }          makes a new code like Mike4821
//   GET  /api/data?code=X                   -> { code, data }
//   PUT  /api/data?code=X  <json>           -> { ok: true }
//
// Needs a D1 database bound with the variable name DB (see wrangler.jsonc).

const MAX_BYTES = 1_500_000;
let ready = false;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

async function setup(db) {
  if (ready) return;
  await db
    .prepare('CREATE TABLE IF NOT EXISTS users (code TEXT PRIMARY KEY, display TEXT NOT NULL, data TEXT, updated INTEGER, created INTEGER)')
    .run();
  ready = true;
}

const cleanCode = (v) => {
  const s = String(v || '').trim().toLowerCase();
  return /^[a-z]{1,12}\d{4}$/.test(s) ? s : null;
};

function fourDigits() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 10000).padStart(4, '0');
}

// Returns the body as a JSON string if it is a valid, reasonably sized JSON object.
function checkData(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const text = JSON.stringify(value);
  return text.length <= MAX_BYTES ? text : null;
}

async function api(request, env, url) {
  const db = env.DB;
  if (!db) return json({ error: 'not_configured' }, 503);

  const route = url.pathname.slice('/api/'.length);
  const method = request.method;

  try {
    await setup(db);

    if (route === 'claim' && method === 'POST') {
      const body = await request.json().catch(() => null);
      const letters = String((body && body.name) || '').replace(/[^a-z]/gi, '').slice(0, 12);
      if (!letters) return json({ error: 'bad_name' }, 400);
      const name = letters[0].toUpperCase() + letters.slice(1).toLowerCase();
      const data = body && body.data != null ? checkData(body.data) : '{}';
      if (data == null) return json({ error: 'bad_data' }, 400);
      const now = Date.now();
      for (let i = 0; i < 25; i++) {
        const display = name + fourDigits();
        const r = await db
          .prepare('INSERT OR IGNORE INTO users (code, display, data, updated, created) VALUES (?, ?, ?, ?, ?)')
          .bind(display.toLowerCase(), display, data, now, now)
          .run();
        if (r.meta && r.meta.changes === 1) return json({ code: display });
      }
      return json({ error: 'try_again' }, 503);
    }

    if (route === 'data') {
      const code = cleanCode(url.searchParams.get('code'));
      if (!code) return json({ error: 'bad_code' }, 400);

      if (method === 'GET') {
        const row = await db.prepare('SELECT display, data FROM users WHERE code = ?').bind(code).first();
        if (!row) return json({ error: 'not_found' }, 404);
        let data = {};
        try { data = JSON.parse(row.data || '{}'); } catch (e) { /* keep empty */ }
        return json({ code: row.display, data });
      }

      if (method === 'PUT') {
        const data = checkData(await request.json().catch(() => null));
        if (data == null) return json({ error: 'bad_data' }, 400);
        const r = await db.prepare('UPDATE users SET data = ?, updated = ? WHERE code = ?').bind(data, Date.now(), code).run();
        if (!r.meta || r.meta.changes !== 1) return json({ error: 'not_found' }, 404);
        return json({ ok: true });
      }
    }

    return json({ error: 'not_found' }, 404);
  } catch (e) {
    return json({ error: 'server_error' }, 500);
  }
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    return url.pathname.startsWith('/api/') ? api(request, env, url) : env.ASSETS.fetch(request);
  },
};
