// Focused AI-provider tests. Never talks to a real network AI API.
// Fake keys are placeholders only and must never appear in Worker responses.
import worker from './worker.js';

const FAKE_KEY = 'sk-or-test-FAKESECRET-do-not-leak-111';
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const captured = [];
const originalFetch = globalThis.fetch;

function openaiCompat(content, extra = {}) {
  return {
    id: 'gen-test',
    model: extra.model || 'upstage/solar-pro-3:free',
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  let body = init.body || '';
  if (typeof body !== 'string') {
    try { body = JSON.stringify(body); } catch { body = String(body); }
  }
  captured.push({
    url: href,
    method: init.method || 'GET',
    authorization: init.headers?.authorization || init.headers?.Authorization || '',
    body,
  });
  if (href.includes('openrouter.ai') || href.includes('openai.com')) {
    return new Response(JSON.stringify(openaiCompat(pendingAiContent)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return originalFetch(url, init);
};

let pendingAiContent = 'hello from carmen test';
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

function leakCheck(value, label) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  assert(!s.includes(FAKE_KEY), `${label} does not leak API secret`);
}

async function call(path, init = {}, env) {
  const req = new Request('https://test' + path, init);
  const res = await worker.fetch(req, env);
  const text = await res.text();
  leakCheck(text, path + ' response');
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text };
}

function lastAi() {
  return [...captured].reverse().find(c => c.url.includes('/chat/completions'));
}

function parseLastBody() {
  const req = lastAi();
  try { return JSON.parse(req.body); } catch { return {}; }
}

const assets = { async fetch() { return new Response('ok'); } };

console.log('--- health without key ---');
{
  captured.length = 0;
  const { status, body } = await call('/health', {}, { ASSETS: assets });
  assert(status === 200, 'health 200');
  assert(body.provider === 'openrouter', 'provider openrouter');
  assert(body.model === 'openrouter/free', 'model openrouter/free');
  assert(body.configured === false, 'configured false');
  assert(!String(JSON.stringify(body)).includes('openai.com'), 'health does not claim openai');
  assert(!String(JSON.stringify(body)).includes('gpt-4.1-mini'), 'health does not claim gpt-4.1-mini');
}

console.log('--- health with Api_key ---');
{
  const { body } = await call('/health', {}, { Api_key: FAKE_KEY, ASSETS: assets });
  assert(body.provider === 'openrouter', 'provider openrouter with Api_key');
  assert(body.model === 'openrouter/free', 'model openrouter/free with Api_key');
  assert(body.configured === true, 'configured true');
  leakCheck(body, 'health body');
}

console.log('--- leftover OpenAI env is ignored ---');
{
  const { body } = await call('/health', {}, {
    Api_key: FAKE_KEY,
    API_URL: 'https://api.openai.com/v1/chat/completions',
    MODEL: 'gpt-4.1-mini',
    ASSETS: assets,
  });
  assert(body.provider === 'openrouter', 'openai API_URL does not win');
  assert(body.model === 'openrouter/free', 'gpt-4.1-mini does not win');
}

console.log('--- /chat uses OpenRouter + Api_key ---');
{
  captured.length = 0;
  pendingAiContent = 'OBSERVED: test reply';
  const { status, body } = await call('/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }, { Api_key: FAKE_KEY, ASSETS: assets });
  const req = lastAi();
  const payload = parseLastBody();
  assert(status === 200, 'chat 200');
  assert(body.text === 'OBSERVED: test reply', 'chat returns model text');
  assert(req && req.url === 'https://openrouter.ai/api/v1/chat/completions', 'chat hits OpenRouter endpoint');
  assert(payload.model === 'openrouter/free', 'chat model openrouter/free');
  assert(req.authorization === `Bearer ${FAKE_KEY}`, 'chat uses env.Api_key');
  assert(!captured.some(c => c.url.includes('api.openai.com')), 'chat does not call OpenAI');
  leakCheck(body, 'chat body');
}

console.log('--- /chat also accepts API_KEY alias ---');
{
  captured.length = 0;
  pendingAiContent = 'alias-ok';
  const { status, body } = await call('/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }, { API_KEY: FAKE_KEY, ASSETS: assets });
  assert(status === 200, 'chat 200 with API_KEY');
  assert(body.text === 'alias-ok', 'API_KEY alias works');
  assert(lastAi()?.url === 'https://openrouter.ai/api/v1/chat/completions', 'API_KEY still uses OpenRouter');
}

console.log('--- leftover OpenAI env does not redirect /chat ---');
{
  captured.length = 0;
  pendingAiContent = 'still-openrouter';
  const { body } = await call('/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }, {
    Api_key: FAKE_KEY,
    API_URL: 'https://api.openai.com/v1/chat/completions',
    MODEL: 'gpt-4.1-mini',
    ASSETS: assets,
  });
  assert(body.text === 'still-openrouter', 'chat succeeded');
  assert(lastAi()?.url === 'https://openrouter.ai/api/v1/chat/completions', 'OpenAI URL override rejected');
  assert(parseLastBody().model === 'openrouter/free', 'OpenAI model override rejected');
}

console.log('--- /analyze uses shared provider + vision ---');
{
  captured.length = 0;
  pendingAiContent = JSON.stringify({
    title: 'Test image',
    observations: ['a pixel'],
    inferences: [],
    unknowns: ['identity'],
    relationships: [],
    candidatePatterns: [],
    signature: {},
    audit: { notes: 'ok' },
  });
  const { status, body } = await call('/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageDataUrl: TINY_PNG, pageUrl: 'https://example.com', sourceType: 'web' }),
  }, { Api_key: FAKE_KEY, ASSETS: assets });
  const payload = parseLastBody();
  const content = payload.messages?.[0]?.content;
  const hasImage = Array.isArray(content) && content.some(p => p?.type === 'image_url' && p?.image_url?.url?.startsWith('data:image/'));
  assert(status === 200, 'analyze 200');
  assert(body.title === 'Test image', 'analyze parsed structured JSON');
  assert(lastAi()?.url === 'https://openrouter.ai/api/v1/chat/completions', 'analyze hits OpenRouter');
  assert(payload.model === 'openrouter/free', 'analyze model openrouter/free');
  assert(hasImage, 'analyze sends image_url vision payload');
  leakCheck(body, 'analyze body');
}

console.log('--- /synthesize uses shared provider ---');
{
  captured.length = 0;
  pendingAiContent = JSON.stringify({
    summary: 'two refs',
    consistentFindings: [],
    differences: [],
    candidatePatterns: [],
    leads: [],
    unknowns: [],
    audit: {},
  });
  const refs = [
    { title: 'A', url: 'https://example.com/a', sourceType: 'web', context: 'one' },
    { title: 'B', url: 'https://example.com/b', sourceType: 'web', context: 'two', imageDataUrl: TINY_PNG },
  ];
  const { status, body } = await call('/synthesize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'compare', references: refs }),
  }, { Api_key: FAKE_KEY, ASSETS: assets });
  const payload = parseLastBody();
  const content = payload.messages?.[0]?.content;
  const hasImage = Array.isArray(content) && content.some(p => p?.type === 'image_url');
  assert(status === 200, 'synthesize 200');
  assert(body.summary === 'two refs', 'synthesize parsed structured JSON');
  assert(lastAi()?.url === 'https://openrouter.ai/api/v1/chat/completions', 'synthesize hits OpenRouter');
  assert(payload.model === 'openrouter/free', 'synthesize model openrouter/free');
  assert(hasImage, 'synthesize still accepts vision input');
}

console.log('--- fenced JSON from free models is accepted ---');
{
  captured.length = 0;
  pendingAiContent = 'Sure.\n```json\n{"title":"fenced","observations":[],"inferences":[],"unknowns":[],"relationships":[],"candidatePatterns":[],"signature":{},"audit":{}}\n```\n';
  const { status, body } = await call('/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageDataUrl: TINY_PNG }),
  }, { Api_key: FAKE_KEY, ASSETS: assets });
  assert(status === 200, 'fenced JSON 200');
  assert(body.title === 'fenced', 'fenced JSON parsed');
}

console.log('--- malformed AI output is rejected ---');
{
  captured.length = 0;
  pendingAiContent = 'this is not json at all, sorry!';
  const { status, body } = await call('/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageDataUrl: TINY_PNG }),
  }, { Api_key: FAKE_KEY, ASSETS: assets });
  assert(status === 500, 'malformed JSON 500');
  assert(/invalid JSON/i.test(body.error || ''), 'malformed JSON error');
  assert(body.title == null, 'malformed output does not bypass validation');
}

console.log('--- array content parts still parse ---');
{
  captured.length = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    captured.push({ url: String(url), method: init.method || 'GET', authorization: init.headers?.authorization || '', body: init.body || '' });
    return new Response(JSON.stringify({
      choices: [{
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '{"title":"parts","observations":[],"inferences":[],"unknowns":[],"relationships":[],"candidatePatterns":[],"signature":{},"audit":{}}' }],
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const { status, body } = await call('/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageDataUrl: TINY_PNG }),
  }, { Api_key: FAKE_KEY, ASSETS: assets });
  globalThis.fetch = original;
  assert(status === 200, 'array content 200');
  assert(body.title === 'parts', 'array content parsed');
}

globalThis.fetch = originalFetch;
console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
