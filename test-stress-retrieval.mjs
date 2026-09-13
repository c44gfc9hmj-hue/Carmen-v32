// v47.1 live retrieval stress suite.
// Hits /search (and optionally /dive) and scores whether Carmen retrieved
// the requested ENTITY × CONCEPT intersection — not merely the person.
// Test subjects live here only. They must never appear in worker.js.
import { classifyQuery, applyResearchFilter, discoveryLanes, interpretRequest, extraContext } from './worker.js';

const BASE = process.env.CARMEN_STRESS_URL || 'http://127.0.0.1:8080';
const TIMEOUT_MS = Number(process.env.CARMEN_STRESS_TIMEOUT || 45000);

const cases = [
  { id: 'A1', q: 'Abella Danger bondage', adult: 'on', expectType: 'person', concept: 'bondage', needIntersection: true },
  { id: 'A2', q: 'Drea Morgan bondage', adult: 'on', expectType: 'person', concept: 'bondage', needIntersection: true },
  { id: 'A3', q: 'Riley Reid bondage', adult: 'on', expectType: 'person', concept: 'bondage', needIntersection: true },
  { id: 'A4', q: 'Drea Morgan rope', adult: 'on', expectType: 'person', concept: 'rope', needIntersection: true, longTail: true },
  { id: 'A5', q: 'Riley Reid interview', adult: 'off', expectType: 'person', concept: 'interview', needIntersection: true },
  { id: 'A6', q: 'Drea Morgan interview', adult: 'off', expectType: 'person', concept: 'interview', needIntersection: true, longTail: true },
  { id: 'A7', q: 'Drea Morgan photography', adult: 'off', expectType: 'person', concept: 'photography', needIntersection: true, longTail: true },
  { id: 'B1', q: 'Lincoln Aviator towing', adult: 'off', expectType: 'vehicle', concept: 'towing', needIntersection: true },
  { id: 'B2', q: 'welding a trailer hitch', adult: 'off', expectType: 'skill', concept: 'hitch', needIntersection: false },
  { id: 'C1', q: 'zorbith history', adult: 'off', expectType: 'topic', concept: 'history', needIntersection: false, unknown: true },
  { id: 'N1', q: 'Abella Danger towing', adult: 'off', expectType: 'person', concept: 'towing', needIntersection: false, negative: true },
  { id: 'L2', q: 'Ashley Anderson interview', adult: 'off', expectType: 'person', concept: 'interview', needIntersection: true, longTail: true },
];

let passed = 0, failed = 0, skipped = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

async function getJson(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(BASE + path, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
    });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: r.status, body };
  } finally { clearTimeout(t); }
}

function plannerCheck(c) {
  const cls = applyResearchFilter(classifyQuery(c.q), c.adult, c.q);
  const lanes = discoveryLanes(cls, 'contextual');
  const ir = interpretRequest(cls);
  const qs = lanes.lanes.flatMap(l => l.queries || []);
  const concept = extraContext(cls) || c.concept;
  const inter = lanes.lanes.find(l => l.id === 'intersection');
  return { cls, lanes, ir, qs, concept, inter };
}

console.log('Carmen stress suite against', BASE);

{
  const health = await getJson('/health');
  assert(health.status === 200, 'health 200');
  assert(String(health.body.version).startsWith('47'), 'health version 47.x (' + health.body.version + ')');
}

console.log('\n--- planner (no web) ---');
for (const c of cases) {
  const p = plannerCheck(c);
  assert(p.cls.type === c.expectType, c.id + ' type=' + p.cls.type + ' expected ' + c.expectType);
  if (c.concept) assert(new RegExp(c.concept, 'i').test(p.concept || p.cls.context || ''), c.id + ' preserved concept "' + c.concept + '" (got ' + (p.concept || p.cls.context || '') + ')');
  if (c.expectType !== 'topic' || c.concept) {
    assert(!!p.inter, c.id + ' has intersection lane');
  }
  if (p.inter && c.concept) {
    assert(p.inter.queries.every(q => new RegExp(c.concept, 'i').test(q)), c.id + ' every intersection query keeps the concept');
    assert(p.inter.queries.length >= 1, c.id + ' at least one intersection formulation');
  }
  const ids = p.lanes.lanes.map(l => l.id);
  if (p.concept && ids.includes('identity') && ids.includes('intersection')) {
    assert(ids.indexOf('intersection') < ids.indexOf('identity'), c.id + ' intersection planned before identity');
  }
  const prod = p.lanes.lanes.find(l => l.id === 'productions');
  if (prod && c.concept) {
    assert(prod.queries.some(q => new RegExp(c.concept, 'i').test(q)), c.id + ' productions keep concept');
  }
  const concepts = p.ir.concepts || [];
  assert(concepts.every(x => x.knowledge === 'planning' || x.provenance === 'INFERRED' || x.provenance === 'UNKNOWN'), c.id + ' concepts are planning knowledge before retrieval');
}

console.log('\n--- live /search ---');
const liveRows = [];
for (const c of cases) {
  const url = '/search?q=' + encodeURIComponent(c.q) + '&adult=' + encodeURIComponent(c.adult) + '&depth=contextual';
  let res;
  try {
    res = await getJson(url);
  } catch (e) {
    failed++;
    console.log('  FAIL', c.id, 'search threw', e.name || e.message);
    liveRows.push({ id: c.id, q: c.q, error: String(e.message || e) });
    continue;
  }
  const body = res.body || {};
  const results = Array.isArray(body.results) ? body.results : [];
  const cls = body.classification || {};
  const hosts = new Set(results.map(r => r.domain || '').filter(Boolean));
  const kinds = {};
  for (const r of results) kinds[r.resultKind || '?'] = (kinds[r.resultKind || '?'] || 0) + 1;
  const inter = results.filter(r => r.intersection || r.resultKind === 'INTERSECTION_MATCH' || r.resultKind === 'INTERVIEW_MATCH');
  const generic = results.filter(r => r.resultKind === 'GENERIC_BACKGROUND' || r.resultKind === 'ENTITY_MATCH');
  const aggregators = results.filter(r => r.resultKind === 'AGGREGATOR');
  const top = results[0] || null;
  const conceptRe = new RegExp(c.concept, 'i');
  const nameTok = String(cls.subject || c.q).split(/\s+/).filter(t => t.length > 2);
  const identityOk = !c.expectType || cls.type === c.expectType;
  const contextOk = !c.concept || conceptRe.test(cls.context || extraContext(cls) || '');
  const topHasConcept = !!(top && conceptRe.test((top.title || '') + ' ' + (top.snippet || '') + ' ' + (top.url || '')));
  const topHasEntity = !!(top && nameTok.every(t => ((top.title || '') + ' ' + (top.snippet || '') + ' ' + (top.url || '')).toLowerCase().includes(t.toLowerCase())));
  let verdict = 'PASS';
  const notes = [];
  if (res.status !== 200) { verdict = 'FAIL'; notes.push('HTTP ' + res.status); }
  if (!identityOk) { verdict = 'FAIL'; notes.push('type ' + cls.type); }
  if (!contextOk) { verdict = 'FAIL'; notes.push('lost concept'); }
  if (c.needIntersection) {
    if (!inter.length && !topHasConcept) {
      verdict = c.longTail ? 'WEAK' : 'FAIL';
      notes.push('no intersection evidence');
    } else if (top && top.resultKind === 'GENERIC_BACKGROUND' && !topHasConcept) {
      verdict = 'FAIL';
      notes.push('generic identity ranked first');
    } else if (top && top.resultKind === 'AGGREGATOR' && !inter.some(r => r.resultKind === 'INTERSECTION_MATCH')) {
      verdict = 'WEAK';
      notes.push('only aggregator co-occurrence');
    }
  }
  if (c.negative) {
    if (inter.some(r => r.resultKind === 'INTERSECTION_MATCH' && r.confidence === 'high')) {
      notes.push('claimed a strong intersection for an unsupported pairing');
      verdict = 'FAIL';
    } else {
      notes.push('did not invent a strong unsupported intersection');
    }
  }
  if (verdict === 'FAIL') { failed++; console.log('  FAIL', c.id, c.q, notes.join('; ') || ''); }
  else if (verdict === 'WEAK') { skipped++; console.log('  WEAK', c.id, c.q, notes.join('; ') || ''); }
  else { passed++; console.log('  OK', c.id, c.q); }

  const row = {
    id: c.id,
    q: c.q,
    adult: c.adult,
    http: res.status,
    type: cls.type,
    subject: cls.subject,
    context: cls.context,
    identityOk,
    contextOk,
    resultCount: results.length,
    intersectionCount: body.intersectionCount || inter.length,
    hostCount: hosts.size,
    kinds,
    media: results.filter(r => r.image || r.mediaKind === 'video').length,
    top: top ? { title: top.title, url: top.url, kind: top.resultKind, score: top.score, intersection: !!top.intersection } : null,
    verdict,
    notes,
  };
  liveRows.push(row);
  console.log('     type=' + cls.type, 'subject=' + cls.subject, 'context=' + (cls.context || ''),
    'n=' + results.length, '∩=' + (body.intersectionCount || inter.length), 'hosts=' + hosts.size,
    'top=' + (top ? (top.resultKind + ' ' + String(top.title || '').slice(0, 60)) : 'none'));
}

console.log('\n=== LIVE TABLE ===');
console.log(['Test', 'Identity', 'Context', 'Intersection', 'Hosts', 'Top kind', 'Result'].join('\t'));
for (const r of liveRows) {
  console.log([
    r.id + ' ' + r.q,
    r.identityOk ? 'yes' : ('NO ' + r.type),
    r.contextOk ? 'yes' : 'NO',
    r.intersectionCount > 0 ? String(r.intersectionCount) : 'none',
    r.hostCount || 0,
    (r.top && r.top.kind) || '-',
    r.verdict,
  ].join('\t'));
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} weak/partial`);
if (failed) process.exit(1);
