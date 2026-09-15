#!/usr/bin/env node
// Carmen Machine API smoke test.
// Hits a live origin (default: production Worker). Never hardcodes secrets.
//
//   CARMEN_API_KEY=... node machine-smoke.mjs
//   node machine-smoke.mjs --fixture
//   node machine-smoke.mjs --origin https://carmen-iphone-v25.94bwfd5grv.workers.dev
//
// Distinguishes: unauthenticated/open, authenticated, API failure,
// Cloudflare failure, malformed JSON.

const ORIGIN = (process.env.CARMEN_API_ORIGIN
  || argVal('--origin')
  || 'https://carmen-iphone-v25.94bwfd5grv.workers.dev').replace(/\/+$/, '');
const KEY = process.env.CARMEN_API_KEY || '';
const USE_FIXTURE = process.argv.includes('--fixture');
const SUBJECTS = [
  { name: 'Drea Morgan', topic: 'bondage', adult: 'on', type: 'person' },
  { name: 'Sensi Pearl', topic: 'bondage', adult: 'on', type: 'person' },
];

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : '';
}

const results = [];
function record(name, ok, extra = {}) {
  const row = { name, ok, ...extra };
  results.push(row);
  const tag = ok ? 'PASS' : 'FAIL';
  const detail = extra.detail ? ' — ' + extra.detail : '';
  console.log(`  ${tag}  ${name}${detail}`);
}

function classifyFailure(status, text, err) {
  if (err && /ENOTFOUND|ECONNREFUSED|certificate|fetch failed/i.test(String(err))) return 'network';
  if (status === 403 && /cloudflare|attention required|cf-ray/i.test(text || '')) return 'cloudflare';
  if (status >= 520 && status <= 530) return 'cloudflare';
  if (status === 401) return 'auth';
  if (status >= 500) return 'api-failure';
  if (status === 0) return 'network';
  return 'api-failure';
}

function headers(extra = {}) {
  const h = { accept: 'application/json', ...extra };
  if (KEY) {
    h.authorization = 'Bearer ' + KEY;
    h['x-carmen-api-key'] = KEY;
  }
  return h;
}

async function call(method, path, body, opts = {}) {
  const url = ORIGIN + path;
  const init = { method, headers: headers(opts.json ? { 'content-type': 'application/json' } : {}) };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const started = Date.now();
  let res, text;
  try {
    res = await fetch(url, init);
    text = await res.text();
  } catch (err) {
    return {
      ok: false,
      status: 0,
      json: null,
      text: String(err),
      ms: Date.now() - started,
      kind: classifyFailure(0, String(err), err),
    };
  }
  let json = null;
  let malformed = false;
  try { json = text ? JSON.parse(text) : null; }
  catch { malformed = true; }
  const kind = malformed
    ? 'malformed-response'
    : (!res.ok ? classifyFailure(res.status, text) : 'ok');
  return { ok: res.ok, status: res.status, json, text, ms: Date.now() - started, kind, malformed };
}

function authMode(health) {
  const configured = !!(health && (health.machineAuthConfigured || (health.environment && health.environment.machineAuthConfigured)));
  if (configured && KEY) return 'authenticated';
  if (configured && !KEY) return 'auth-required-but-key-missing';
  if (!configured && KEY) return 'open-key-ignored';
  return 'unauthenticated-open';
}

function summarizeResults(payload) {
  const items = (payload && payload.results) || [];
  return {
    count: items.length,
    investigationId: payload && payload.investigationId,
    subject: payload && payload.subject,
    diagnosis: payload && payload.corpusDiagnosis && payload.corpusDiagnosis.status,
    identityConfirmed: (payload && payload.identityState && payload.identityState.confirmed) || [],
    hosts: items.slice(0, 8).map(r => r.host || r.sourceUrl || r.url).filter(Boolean),
    titles: items.slice(0, 5).map(r => r.title).filter(Boolean),
    foundThrough: items.slice(0, 5).map(r => r.foundThrough).filter(Boolean),
  };
}

async function runSubject(subject) {
  const label = subject.name;
  const fixture = USE_FIXTURE ? (label.toLowerCase().includes('drea') ? 'drea-intersection' : 'drea-intersection') : undefined;
  const searchBody = {
    query: subject.name + (subject.topic ? ' ' + subject.topic : ''),
    subject: subject.name,
    topic: subject.topic,
    type: subject.type,
    adult: subject.adult,
  };
  if (fixture) searchBody.fixture = fixture;

  const search = await call('POST', '/api/v1/machine/search', searchBody, { json: true });
  if (search.malformed) {
    record(label + ' search', false, { detail: 'malformed-response', kind: search.kind, status: search.status });
    return { subject: label, ok: false };
  }
  if (!search.ok || !search.json) {
    record(label + ' search', false, { detail: search.kind + ' HTTP ' + search.status, kind: search.kind, status: search.status });
    return { subject: label, ok: false, search };
  }
  const s = search.json;
  const hasState = !!(s.investigationId && s.investigationState);
  const structured = Array.isArray(s.results);
  record(label + ' search JSON', structured && hasState, {
    detail: `id=${s.investigationId} results=${(s.results || []).length} diagnosis=${s.corpusDiagnosis && s.corpusDiagnosis.status} ${search.ms}ms`,
    summary: summarizeResults(s),
  });

  const diveBody = {
    lens: 'bondage',
    query: searchBody.query,
    subject: subject.name,
    topic: subject.topic,
    type: subject.type,
    adult: subject.adult,
    investigationId: s.investigationId,
    investigationState: s.investigationState,
  };
  if (fixture) diveBody.fixture = fixture;
  const dive = await call('POST', '/api/v1/machine/dive', diveBody, { json: true });
  const d = dive.json || {};
  const diveOk = dive.ok && d.investigationId === s.investigationId && Array.isArray(d.results);
  record(label + ' dive accepts investigationState', diveOk, {
    detail: dive.ok ? `results=${(d.results || []).length} ${dive.ms}ms` : (dive.kind + ' HTTP ' + dive.status),
    summary: summarizeResults(d),
  });

  const inspect = await call('POST', '/api/v1/machine/investigations/' + encodeURIComponent(d.investigationId || s.investigationId), {
    investigationId: d.investigationId || s.investigationId,
    investigationState: d.investigationState || s.investigationState,
  }, { json: true });
  const i = inspect.json || {};
  record(label + ' POST inspect echoes state', inspect.ok && i.investigationState && i.investigationState.investigationId === (d.investigationId || s.investigationId), {
    detail: inspect.ok ? 'ok' : (inspect.kind + ' HTTP ' + inspect.status),
  });

  const echoJson = d.investigationStateJson || s.investigationStateJson;
  if (echoJson) {
    const viaString = await call('POST', '/api/v1/machine/dive', {
      lens: 'people',
      query: subject.name,
      subject: subject.name,
      type: subject.type,
      adult: subject.adult,
      investigationId: d.investigationId || s.investigationId,
      investigationStateJson: echoJson,
      ...(fixture ? { fixture } : {}),
    }, { json: true });
    record(label + ' dive via investigationStateJson', viaString.ok && viaString.json && viaString.json.investigationId === (d.investigationId || s.investigationId), {
      detail: viaString.ok ? 'string state accepted' : (viaString.kind + ' HTTP ' + viaString.status),
    });
  }

  const analyzeUrl = ((d.results || s.results || []).find(r => r.sourceUrl || r.url) || {}).sourceUrl
    || ((d.results || s.results || []).find(r => r.sourceUrl || r.url) || {}).url
    || 'https://example.com/interview';
  const analyze = await call('POST', '/api/v1/machine/investigations/' + encodeURIComponent(d.investigationId || s.investigationId) + '/analyze', {
    url: analyzeUrl,
    title: 'smoke-analyze',
    kind: 'webpage',
    investigationId: d.investigationId || s.investigationId,
    investigationState: d.investigationState || s.investigationState,
  }, { json: true });
  record(label + ' analyze', analyze.ok && analyze.json && analyze.json.ok !== false, {
    detail: analyze.ok ? `url=${analyzeUrl} ${analyze.ms}ms` : (analyze.kind + ' HTTP ' + analyze.status),
  });

  return { subject: label, search: summarizeResults(s), dive: summarizeResults(d), ok: search.ok && diveOk };
}

async function main() {
  console.log('Carmen machine smoke');
  console.log('  origin:', ORIGIN);
  console.log('  key:', KEY ? 'CARMEN_API_KEY present (value not printed)' : 'CARMEN_API_KEY not set');
  console.log('  mode:', USE_FIXTURE ? 'fixture' : 'live');
  console.log('');

  console.log('--- health / capabilities / openapi ---');
  const health = await call('GET', '/api/v1/health');
  if (health.malformed) {
    record('health', false, { detail: 'malformed-response', kind: 'malformed-response' });
  } else if (health.kind === 'cloudflare' || health.kind === 'network') {
    record('health', false, { detail: health.kind + ' HTTP ' + health.status, kind: health.kind });
  } else {
    record('health', health.ok && health.json && health.json.ok === true, {
      detail: `version=${health.json && health.json.version} build=${health.json && health.json.build} auth=${authMode(health.json)}`,
    });
  }
  const mode = authMode(health.json);
  console.log('  AUTH_MODE', mode);
  if (mode === 'auth-required-but-key-missing') {
    record('authenticated test', false, { detail: 'Worker requires CARMEN_API_KEY but env is empty' });
  }

  const caps = await call('GET', '/api/v1/machine/capabilities');
  record('capabilities', caps.ok && caps.json && caps.json.readOnly === true && caps.json.pipelineFunction === 'runDiscovery', {
    detail: caps.ok ? `machineAuthConfigured=${caps.json && caps.json.machineAuthConfigured}` : (caps.kind + ' HTTP ' + caps.status),
  });

  const spec = await call('GET', '/api/v1/openapi.json');
  const openapi = spec.json || {};
  const hasBearer = !!(openapi.components && openapi.components.securitySchemes && openapi.components.securitySchemes.BearerAuth);
  const hasSearch = !!(openapi.paths && openapi.paths['/api/v1/machine/search']);
  record('openapi', spec.ok && openapi.openapi === '3.0.3' && hasBearer && hasSearch, {
    detail: spec.ok ? `paths=${Object.keys(openapi.paths || {}).length}` : spec.kind,
  });

  console.log('--- external-action guard ---');
  for (const path of ['/api/v1/machine/message', '/api/v1/machine/purchase', '/api/v1/investigations/inv_x/post']) {
    const denied = await call('POST', path, {}, { json: true });
    record('403 ' + path, denied.status === 403 && denied.json && denied.json.error === 'External action denied', {
      detail: 'HTTP ' + denied.status,
    });
  }

  console.log('--- investigation continuity ---');
  const subjectReports = [];
  for (const subject of SUBJECTS) {
    console.log('--- subject: ' + subject.name + ' ---');
    subjectReports.push(await runSubject(subject));
  }

  const failed = results.filter(r => !r.ok);
  console.log('');
  console.log(results.filter(r => r.ok).length + ' passed,', failed.length + ' failed');
  console.log('AUTH_MODE=' + mode);
  if (failed.length) {
    console.log('Failures:');
    for (const f of failed) console.log('  -', f.name, f.detail || f.kind || '');
    process.exit(1);
  }
}

await main();
