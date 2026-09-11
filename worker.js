// Carmen v37 — full worker restored via 4-part compressed payload in ASSETS.
// Complete v37: /retrieve, provenance, instructions, timeline, multi-provider search, Reddit, Deep Dive.
const PARTS = [
  '/carmen-v37-payload-0.b64',
  '/carmen-v37-payload-1.b64',
  '/carmen-v37-payload-2.b64',
  '/carmen-v37-payload-3.b64',
];

async function loadCode(env, req) {
  const texts = [];
  for (const p of PARTS) {
    const url = new URL(p, req.url);
    let res;
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      res = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
    } else {
      res = await fetch(url.toString());
    }
    if (!res.ok) throw new Error('payload part missing: ' + p + ' ' + res.status);
    texts.push((await res.text()).trim());
  }
  const b64 = texts.join('');
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const ds = new DecompressionStream('gzip');
  const stream = new Response(bin).body.pipeThrough(ds);
  return await new Response(stream).text();
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

let cached = null;
async function getMod(env, req) {
  if (cached) return cached;
  const code = await loadCode(env, req);
  const dataUrl = 'data:text/javascript;base64,' + toBase64(code);
  const mod = await import(dataUrl);
  cached = mod.default || mod;
  return cached;
}

export default {
  async fetch(req, env, ctx) {
    try {
      const mod = await getMod(env, req);
      return mod.fetch(req, env, ctx);
    } catch (e) {
      return new Response(JSON.stringify({ error: 'v37 loader: ' + (e && e.message || e), ok: false }), {
        status: 500,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      });
    }
  },
};
