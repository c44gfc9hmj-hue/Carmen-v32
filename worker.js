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

let cached = null;
async function getMod(env, req) {
  if (cached) return cached;
  const code = await loadCode(env, req);
  const wrapped = code.replace(/export\s+default\s+/, 'const __d = ') + ';\nreturn __d;';
  const factory = new Function(wrapped);
  cached = factory();
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
