// Carmen v37 — full worker restored. Payload lives at public/carmen-v37-payload.b64
// Complete v37: /retrieve, provenance, instructions, timeline, multi-provider search.
const PAYLOAD_PATH = '/carmen-v37-payload.b64';

async function loadCode(env, req) {
  const url = new URL(PAYLOAD_PATH, req.url);
  let res;
  if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
    res = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
  } else {
    res = await fetch(url.toString());
  }
  if (!res.ok) throw new Error('payload missing: ' + res.status);
  const b64 = (await res.text()).trim();
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
