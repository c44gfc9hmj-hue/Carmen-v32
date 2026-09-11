// Carmen v37 loader — full worker restored via compressed payload
// This is the complete v37 worker (retrieval, provenance, instructions, timeline)
const B64 = "H4sIAP92pGoC/90921IbyZLv/ooyO2GpbakF+DrCQDCYmeGMbRyAPWcCGNxqlaQ2fZH7AtZYROxH7L9sxD7up+yXbGbWpau6WwLmcs7ZnQtIdc3KyszKzMosej2266URj9n//Pt/M";
async function loadWorkerCode() {
  const bin = Uint8Array.from(atob(B64), c => c.charCodeAt(0));
  const ds = new DecompressionStream("gzip");
  const stream = new Response(bin).body.pipeThrough(ds);
  return await new Response(stream).text();
}
let handlerPromise = null;
function getHandler() {
  if (!handlerPromise) {
    handlerPromise = loadWorkerCode().then(code => {
      const wrapped = code.replace(
        /export\s+default\s+/,
        "const __carmen_default = "
      ) + ";\nreturn __carmen_default;";
      const factory = new Function(wrapped);
      return factory();
    });
  }
  return handlerPromise;
}
export default {
  async fetch(req, env, ctx) {
    const mod = await getHandler();
    return mod.fetch(req, env, ctx);
  }
};
