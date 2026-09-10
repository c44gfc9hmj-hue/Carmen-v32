// Carmen V33 — fixed Cloudflare Worker
// Preserves the existing UI through Cloudflare Workers Static Assets.

const TYPES = {
  "/": "text/html; charset=utf-8",
  "/index.html": "text/html; charset=utf-8",
  "/app.js": "application/javascript; charset=utf-8",
  "/manifest.webmanifest": "application/manifest+json; charset=utf-8",
  "/icon.svg": "image/svg+xml",
  "/sw.js": "application/javascript; charset=utf-8"
};

function cors(req) {
  const origin = req.headers.get("Origin");
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}

function json(value, status, req) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...cors(req), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function cleanText(s) {
  return String(s || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

function unwrap(url) {
  let u = String(url || "");
  if (u.startsWith("//")) u = "https:" + u;
  try {
    const p = new URL(u);
    const target = p.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : u;
  } catch { return u; }
}

async function searchWeb(req) {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") || "").trim();
  if (!q) return json({ results: [] }, 200, req);

  const results = [];
  const seen = new Set();
  const add = r => {
    if (!r?.url || !r?.title) return;
    const url = String(r.url);
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    results.push({ title: String(r.title).slice(0,240), url, source: String(r.source || "Public web").slice(0,120), snippet: String(r.snippet || "").slice(0,500), image: r.image || "" });
  };

  try {
    const r = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q), {
      headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15", accept: "text/html" }
    });
    if (r.ok) {
      const h = await r.text();
      const re = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      for (const m of h.matchAll(re)) {
        add({ title: cleanText(m[2]), url: unwrap(m[1]), source: "Public web" });
        if (results.length >= 12) break;
      }
    }
  } catch {}

  try {
    const r = await fetch("https://www.reddit.com/search.json?q=" + encodeURIComponent(q) + "&limit=10&sort=relevance&t=all", {
      headers: { accept: "application/json", "user-agent": "CarmenResearch/1.0" }
    });
    if (r.ok) {
      const j = await r.json();
      for (const child of j?.data?.children || []) {
        const d = child?.data;
        if (!d?.permalink) continue;
        add({ title: d.title || "Reddit result", url: "https://www.reddit.com" + d.permalink, source: d.subreddit ? "Reddit · r/" + d.subreddit : "Reddit", snippet: d.selftext || "" });
        if (results.length >= 20) break;
      }
    }
  } catch {}

  return json({ results: results.slice(0,20), query: q, count: results.length }, 200, req);
}

async function provider(env, messages, temperature = 0.2) {
  if (!env.API_KEY) throw Error("AI provider is not configured. Add the API_KEY Worker secret before using Carmen AI.");
  const r = await fetch(env.API_URL || "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.API_KEY}` },
    body: JSON.stringify({ model: env.MODEL || "gpt-4.1-mini", temperature, messages })
  });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch { throw Error(text || `AI provider returned HTTP ${r.status}`); }
  if (!r.ok) throw Error(j?.error?.message || `AI provider returned HTTP ${r.status}`);
  return j;
}

async function chat(req, env) {
  try {
    const b = await req.json();
    const messages = [{ role: "system", content: "You are Carmen, a conservative AI research assistant. Be concise and useful. Distinguish observations, inferences, and unknowns. Never invent facts. Never claim something was saved unless the user explicitly requested it. Never autonomously contact people, send messages, post, comment, submit forms, purchase anything, or take external actions. Investigation context: " + JSON.stringify(b.context || {}) }];
    for (const m of Array.isArray(b.messages) ? b.messages : []) {
      if (m && typeof m.content === "string") messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content.slice(0,20000) });
    }
    const j = await provider(env, messages, 0.3);
    return json({ text: j?.choices?.[0]?.message?.content || "" }, 200, req);
  } catch (e) { return json({ error: e?.message || String(e) }, 500, req); }
}

function validateImage(x) {
  if (typeof x !== "string" || !x.startsWith("data:image/")) throw Error("imageDataUrl must be an image data URL");
  if (x.length > 16000000) throw Error("Image is too large. Use a smaller screenshot.");
}

async function structuredVision(req, env, body, mode) {
  if (!env.API_KEY) throw Error("AI provider is not configured. Add the API_KEY Worker secret before using Carmen AI.");
  let content;
  if (mode === "analyze") {
    validateImage(body.imageDataUrl);
    content = [{ type:"text", text:"You are Carmen, a conservative visual-evidence analyst. Return ONLY valid JSON with exactly these keys: title, observations, inferences, unknowns, relationships, candidatePatterns, signature, audit. Observations are directly visible only. Inferences are labeled interpretations. Never invent identity, intent, ownership, price, location, safety, authenticity, or obscured details. CandidatePatterns are hypotheses, not facts. Page URL: " + String(body.pageUrl||"") + "\nSource type: " + String(body.sourceType||"web") + "\nSource name: " + String(body.sourceName||"") + "\nContext: " + String(body.pageContext||"") }, { type:"image_url", image_url:{url:body.imageDataUrl} }];
  } else {
    const refs = Array.isArray(body.references) ? body.references : [];
    if (refs.length < 2) throw Error("Select at least 2 saved references to compare.");
    if (refs.length > 4) throw Error("Compare up to 4 references at once.");
    content = [{ type:"text", text:"You are Carmen performing conservative evidence synthesis. Return ONLY valid JSON with exactly these keys: summary, consistentFindings, differences, candidatePatterns, leads, unknowns, audit. Compare only visible or explicitly supplied evidence. Do not identify people or infer intent, ownership, price, location, authenticity, or hidden facts. User question: " + String(body.question || "Compare these references and identify useful similarities, differences, and patterns.") }];
    refs.forEach((r,i)=>{
      content.push({ type:"text", text:`REFERENCE ${i+1}: ${String(r.title||"Untitled")} | URL: ${String(r.url||"")} | Source type: ${String(r.sourceType||"web")} | Source name: ${String(r.sourceName||"")} | Context: ${String(r.context||"")}` });
      if (typeof r.imageDataUrl === "string" && r.imageDataUrl.startsWith("data:image/")) { validateImage(r.imageDataUrl); content.push({type:"image_url",image_url:{url:r.imageDataUrl}}); }
    });
  }
  const j = await provider(env, [{role:"user",content}], 0);
  const raw = j?.choices?.[0]?.message?.content || "";
  const clean = raw.replace(/^```json\s*/i,"").replace(/\s*```$/i,"").trim();
  try { return JSON.parse(clean); } catch { throw Error("AI provider returned invalid JSON."); }
}

async function analyze(req, env) { try { return json(await structuredVision(req, env, await req.json(), "analyze"), 200, req); } catch(e) { return json({error:e?.message||String(e)},500,req); } }
async function synthesize(req, env) { try { return json(await structuredVision(req, env, await req.json(), "synthesize"), 200, req); } catch(e) { return json({error:e?.message||String(e)},500,req); } }

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === "OPTIONS") return new Response("", { headers: cors(req) });
    if (u.pathname === "/health" && req.method === "GET") return json({ ok:true, worker:"carmen-v33-fixed", provider:env.API_KEY ? "configured" : "not-configured", model:env.MODEL || "gpt-4.1-mini", routes:["/health","/search","/chat","/analyze","/synthesize"] },200,req);
    if (u.pathname === "/search" && req.method === "GET") return searchWeb(req);
    if (u.pathname === "/chat" && req.method === "POST") return chat(req,env);
    if (u.pathname === "/analyze" && req.method === "POST") return analyze(req,env);
    if (u.pathname === "/synthesize" && req.method === "POST") return synthesize(req,env);
    if (env.ASSETS && typeof env.ASSETS.fetch === "function") return env.ASSETS.fetch(req);
    let path = u.pathname; if (path.endsWith("/")) path = "/";
    return new Response("Carmen static assets binding is missing.", { status:500, headers:{...cors(req),"content-type":TYPES[path]||"text/plain; charset=utf-8"} });
  }
};
