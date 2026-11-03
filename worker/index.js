const FOLDS = new Set(['gate', 'pagu', 'jeff']);
const PRESETS = new Set(['cream', 'lined', 'kraft', 'airmail']);
const MAX_TEXT = 4000;
// Must match `base` in vite.config.js.
const BASE = '/locked-letters';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === BASE) return Response.redirect(`${url.origin}${BASE}/${url.search}`, 301);
    if (!url.pathname.startsWith(`${BASE}/`)) return new Response('Not found.', { status: 404 });

    const pathname = url.pathname.slice(BASE.length);
    if (pathname === '/api/letters' && request.method === 'POST') return createLetter(request, env);
    const match = pathname.match(/^\/api\/letters\/([^/]+)$/);
    if (match && request.method === 'GET') return readLetter(decodeURIComponent(match[1]), env);
    if (pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);

    url.pathname = pathname;
    return env.ASSETS.fetch(new Request(url, request));
  },
};

async function createLetter(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'The letter could not be read.' }, 400);
  }
  const text = String(form.get('text') || '').replace(/\r\n/g, '\n').trim();
  const fold = String(form.get('fold') || '');
  const preset = String(form.get('preset') || '');

  if (!text) return json({ error: 'Write a message before locking it.' }, 400);
  if (text.length > MAX_TEXT) return json({ error: 'Keep the message under 4,000 characters.' }, 400);
  if (!FOLDS.has(fold)) return json({ error: 'Choose a fold.' }, 400);
  if (!PRESETS.has(preset)) return json({ error: 'Choose a paper.' }, 400);

  const day = new Date().toISOString().slice(0, 10);
  // Senders are counted by a daily hash of their address, never the address itself.
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const sender = await digest(`${day}|${ip}`);
  const id = randomId();
  try {
    const counts = await env.DB
      .prepare('SELECT COUNT(*) AS total, COALESCE(SUM(sender = ?1), 0) AS mine FROM letters WHERE day = ?2')
      .bind(sender, day)
      .first();
    if (counts.total >= Number(env.DAILY_LETTER_CAP)) {
      return json({ error: 'Today’s letters are all sent. Please try again tomorrow.' }, 429);
    }
    if (counts.mine >= Number(env.SENDER_DAILY_CAP)) {
      return json({ error: 'You’ve sent a lot of letters today. Please try again tomorrow.' }, 429);
    }
    await env.DB
      .prepare('INSERT INTO letters (id, text, fold, preset, day, sender, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(id, text, fold, preset, day, sender, Date.now())
      .run();
  } catch {
    return json({ error: 'The letter could not be saved.' }, 500);
  }
  return json({ id, url: `${BASE}/l/${id}` });
}

async function readLetter(id, env) {
  let letter;
  try {
    letter = await env.DB
      .prepare('SELECT text, fold, preset FROM letters WHERE id = ?1')
      .bind(id)
      .first();
  } catch {
    return json({ error: 'The letter could not be opened.' }, 500);
  }
  if (!letter) return json({ error: 'This letter is not here.' }, 404);
  return json({ text: letter.text, fold: letter.fold, backgroundUrl: null, preset: letter.preset });
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}

async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
