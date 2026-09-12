/* Carmen — canonical frontend.
   iPhone-first investigation workspace. Preserves the v36 IndexedDB schema and
   all prior capabilities (capture, vision analysis, synthesis, evidence archive,
   pattern board, leads, backup/restore, queue) and adds the discovery hub:
   subject-based public search -> reviewable results -> deep-dive analysis ->
   saved evidence. Carmen never takes external actions on a user's behalf. */
'use strict';

const $ = id => document.getElementById(id);
const VERSION = '43';
const BACKEND_KEY = 'carmen_phone_backend_v36';
const URL_KEY = 'carmen_last_url_v36';
const DB_NAME = 'carmen-phone-v36';
const DB_VERSION = 3;
const SESSION_KEY = 'carmen_session_v43';
const SAME_ORIGIN = (window.CARMEN_BACKEND && String(window.CARMEN_BACKEND).length) ? window.CARMEN_BACKEND : location.origin;

let db = null, stream = null, current = null, historyStack = [], historyIndex = -1, currentProjectId = null;
let currentSubject = '';
let lastResults = [];
let selectedCandidate = null;
let lastClassification = null;
let lastDiscoveryMeta = null;
let lastPaths = [];
let pendingSaveItem = null;
let invFilter = 'all';
let openCollectionId = null;
let lastDivePayload = null;
let sessionBoundProject = false;
let diveAll = true;
let selectedDivePathIds = [];
let diveWorkspaceTab = 'findings';
let lightboxGallery = [];
let lightboxIndex = 0;
let lightboxSourceUrl = '';
let currentLearnType = '';
let expandedMode = false;
let currentAdult = 'off';
let currentDepth = 'contextual';

const ACCESS_LABELS = {
  DIRECTLY_RETRIEVED: 'DIRECTLY RETRIEVED',
  PUBLIC_ALTERNATIVE: 'PUBLIC ALTERNATIVE RETRIEVED',
  PARTIALLY_RETRIEVED: 'PARTIALLY RETRIEVED',
  REFERENCED: 'REFERENCED BUT INACCESSIBLE',
  PAYWALLED: 'PAYWALLED — COULD NOT RETRIEVE',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION REQUIRED — COULD NOT RETRIEVE',
  AGE_RESTRICTED: 'AGE/ACCESS RESTRICTION — COULD NOT RETRIEVE',
  BLOCKED: 'BLOCKED/UNAVAILABLE',
  UNAVAILABLE: 'BLOCKED/UNAVAILABLE',
  UNVERIFIED: 'COULD NOT VERIFY',
};

$('backend').value = localStorage.getItem(BACKEND_KEY) || SAME_ORIGIN;

/* ---------- utilities ---------- */
function toast(s) {
  const t = $('toast');
  t.textContent = s;
  t.classList.remove('hidden');
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => t.classList.add('hidden'), 3200);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function normalizeUrl(s) {
  s = String(s || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return 'https://' + s;
  return s;
}
function hostOf(u) { try { return new URL(normalizeUrl(u)).hostname.replace(/^www\./, ''); } catch { return ''; } }
async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/* ---------- IndexedDB (v36 schema + migrations) ---------- */
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('refs')) d.createObjectStore('refs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('events')) d.createObjectStore('events', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('leads')) d.createObjectStore('leads', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('discoveries')) d.createObjectStore('discoveries', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('collections')) d.createObjectStore('collections', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('collectionItems')) d.createObjectStore('collectionItems', { keyPath: 'id' });
    };
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
}
function put(store, v) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).put(v);
    t.oncomplete = () => res(v);
    t.onerror = () => rej(t.error);
  });
}
function all(store) {
  return new Promise((res, rej) => {
    const t = db.transaction(store);
    const r = t.objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function del(store, id) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).delete(id);
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}
function openLegacy(name) {
  return new Promise((res, rej) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onupgradeneeded = () => { r.transaction.abort(); rej(new Error('legacy database does not exist')); };
  });
}
function readFrom(d, store) {
  return new Promise((res, rej) => {
    if (!d.objectStoreNames.contains(store)) return res([]);
    const t = d.transaction(store);
    const q = t.objectStore(store).getAll();
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function migrateLegacy(name, marker, stores) {
  if (localStorage.getItem(marker)) return;
  let old;
  try { old = await openLegacy(name); } catch { localStorage.setItem(marker, '1'); return; }
  try {
    const data = await Promise.all(stores.map(s => readFrom(old, s)));
    for (let i = 0; i < stores.length; i++) {
      const existing = await all(stores[i]);
      for (const x of data[i]) if (!existing.some(y => y.id === x.id)) await put(stores[i], x);
    }
    localStorage.setItem(marker, '1');
  } catch (e) { console.warn(name, 'migration failed', e); }
  finally { old.close(); }
}
async function backfillFingerprints() {
  const refs = await all('refs');
  for (const r of refs) {
    if (!r.fingerprint && r.imageDataUrl) { r.fingerprint = await sha(r.imageDataUrl); await put('refs', r); }
  }
}

/* ---------- projects ---------- */
async function ensureProject() {
  let ps = await all('projects');
  const last = localStorage.getItem('carmen_current_project_v39');
  if (last && ps.some(p => p.id === last)) currentProjectId = last;
  else currentProjectId = (currentProjectId && ps.some(p => p.id === currentProjectId)) ? currentProjectId : (ps[0]?.id || null);
  renderProjects(ps);
  const cur = ps.find(p => p.id === currentProjectId);
  if ($('projectQuestion')) $('projectQuestion').value = cur?.question || '';
  if ($('projectInstructions')) $('projectInstructions').value = cur?.instructions || '';
  await refresh();
}
function renderProjects(ps) {
  if (!$('projectSelect')) return;
  const real = (ps || []).filter(p => p.status !== 'scratch');
  $('projectSelect').innerHTML = real.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('') || '<option value="">None</option>';
  if (currentProjectId) $('projectSelect').value = currentProjectId;
}

/* ---------- refresh / dashboard ---------- */
async function refresh() {
  const [refs, events, allLeads, queue] = await Promise.all([all('refs'), all('events'), all('leads'), all('queue')]);
  const projectRefs = refs.filter(r => r.projectId === currentProjectId);
  const projectLeads = allLeads.filter(x => x.projectId === currentProjectId);
  const projectEvents = events.filter(e => e.projectId === currentProjectId);
  if ($('refs')) $('refs').textContent = projectRefs.length;
  if ($('events')) $('events').textContent = projectEvents.length;
  const p = buildPatterns(projectRefs);
  if ($('patterns')) $('patterns').textContent = p.length;
  if ($('patternBoard')) renderPatternBoard(projectRefs);
  if ($('archive')) renderArchive(projectRefs);
  if ($('sourceStats')) renderSourceStats(projectRefs);
  if ($('evidenceHealth')) renderDashboard(projectRefs);
  const q = queue.filter(x => x.projectId === currentProjectId);
  if ($('queueCount')) $('queueCount').textContent = q.filter(x => x.status === 'queued').length;
  if ($('queueList')) renderQueue(q);
  if ($('projectCount')) $('projectCount').textContent = `${projectRefs.length} evidence item${projectRefs.length === 1 ? '' : 's'}`;
  if ($('leadList')) renderLeads(projectLeads);
  const next = projectLeads.find(l => l.status === 'new');
  if ($('nextMove')) $('nextMove').textContent = next
    ? `Review this lead: ${next.text}`
    : q.some(x => x.status === 'queued') ? `Open the next queued source: ${q.find(x => x.status === 'queued')?.label || 'research item'}.`
    : projectRefs.length < 2 ? 'Run a discovery search or capture evidence so Carmen can compare it.'
    : p.length ? 'Compare evidence around one of the recurring patterns.' : 'Analyze more evidence to build recurring patterns.';
  renderHome();
  renderInvestigations();
  renderCollections();
}

/* ---------- patterns ---------- */
function patternKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim(); }
function patternTokens(s) {
  return new Set(patternKey(s).split(' ').filter(w => w.length > 2 && !['the','and','with','that','this','from','visible','appears','likely','possibly'].includes(w)));
}
function similarity(a, b) {
  const A = patternTokens(a), B = patternTokens(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit / (A.size + B.size - hit);
}
function buildPatterns(refs) {
  const groups = [];
  for (const r of refs) {
    for (const raw of (r.candidatePatterns || [])) {
      const label = String(raw.text || raw).trim();
      if (!label) continue;
      let g = groups.find(x => similarity(x.label, label) >= 0.62);
      if (!g) { g = { label, support: 0, evidenceIds: new Set(), firstSeen: r.createdAt, lastSeen: r.createdAt }; groups.push(g); }
      g.support++; g.evidenceIds.add(r.id);
      if (r.createdAt < g.firstSeen) g.firstSeen = r.createdAt;
      if (r.createdAt > g.lastSeen) g.lastSeen = r.createdAt;
    }
  }
  return groups.map(g => ({ ...g, evidenceIds: [...g.evidenceIds], evidenceCount: g.evidenceIds.size, confidence: g.evidenceIds.size >= 3 ? 'strong recurring' : g.evidenceIds.size >= 2 ? 'recurring' : 'emerging' }))
    .sort((a, b) => b.evidenceCount - a.evidenceCount || b.support - a.support);
}
function renderPatternBoard(refs) {
  const ps = buildPatterns(refs);
  $('patternBoard').innerHTML = ps.map(p => `<div class="pattern"><b>${esc(p.label)}</b> <span class="badge">${esc(p.confidence)}</span><div class="patternbar"><span style="width:${Math.min(100, p.evidenceCount / Math.max(1, refs.length) * 100)}%"></span></div><small>${p.evidenceCount} of ${refs.length} evidence items support this hypothesis · ${p.support} mentions</small></div>`).join('') || '<span class="muted">No recurring pattern hypotheses yet. Analyze more evidence to build the board.</span>';
  return ps;
}

/* ---------- archive / source stats / dashboard ---------- */
function sourceTypeLabel(v) { return ({ adult_video: 'Adult video', reddit: 'Reddit', web: 'Web', other: 'Other' }[v] || 'Web'); }
function currentSourceType() { return $('sourceType')?.value || 'web'; }
function renderArchive(refs) {
  const q = String($('archiveSearch')?.value || '').trim().toLowerCase();
  const filtered = !q ? refs : refs.filter(r => [r.title, r.url, r.context, r.signature, ...(r.observations || []).map(x => x.text || x), ...(r.candidatePatterns || []).map(x => x.text || x)].join(' ').toLowerCase().includes(q));
  $('archive').innerHTML = filtered.slice().reverse().map(r => `<label class="refitem"><input type="checkbox" class="refcheck" value="${esc(r.id)}"><span><b>${esc(r.title || r.url || r.id)}</b> <span class="badge">${esc(sourceTypeLabel(r.sourceType || 'web'))}</span><br><small>${new Date(r.createdAt).toLocaleString()}${r.url ? ' · ' + esc(r.url) : ''}</small><br>${(r.observations || []).slice(0, 2).map(x => esc(x.text || x)).join(' · ') || esc(r.context || '')}</span></label>`).join('') || '<span class="muted">No matching evidence in this investigation.</span>';
}
function sourceStats(refs) {
  const m = {};
  for (const r of refs) {
    const type = sourceTypeLabel(r.sourceType || 'web'), name = r.sourceName || hostOf(r.url) || 'Unknown source';
    const k = type + '|' + name;
    if (!m[k]) m[k] = { type, name, count: 0, last: r.createdAt };
    m[k].count++;
    if (r.createdAt > m[k].last) m[k].last = r.createdAt;
  }
  return Object.values(m).sort((a, b) => b.count - a.count);
}
function renderSourceStats(refs) {
  const rows = sourceStats(refs);
  $('sourceStats').innerHTML = rows.map(x => `<div class="pattern"><b>${esc(x.name)}</b> <span class="badge">${esc(x.type)}</span><br><small>${x.count} evidence item${x.count === 1 ? '' : 's'} · last captured ${new Date(x.last).toLocaleString()}</small></div>`).join('') || '<span class="muted">No source statistics yet.</span>';
}
function evidenceHealth(refs) {
  const n = refs.length;
  if (!n) return { score: 0, label: 'No evidence yet', tips: ['Run a discovery search or capture your first reference.'] };
  const typed = refs.filter(r => r.sourceType).length;
  const contextual = refs.filter(r => String(r.context || '').trim()).length;
  const analyzed = refs.filter(r => Array.isArray(r.observations) && r.observations.length).length;
  const score = Math.round((typed / n * 0.25 + contextual / n * 0.2 + analyzed / n * 0.35 + Math.min(1, n / 5) * 0.2) * 100);
  const tips = [];
  if (typed < n) tips.push(`${n - typed} reference${n - typed === 1 ? '' : 's'} missing a source type.`);
  if (contextual < n) tips.push('Add context or a research question to more captures.');
  if (analyzed < n) tips.push('Analyze more saved captures.');
  if (n < 5) tips.push(`Add ${5 - n} more reference${5 - n === 1 ? '' : 's'} for a stronger comparison set.`);
  return { score, label: score >= 80 ? 'Strongly documented' : score >= 55 ? 'Developing' : 'Needs more documentation', tips };
}
function renderDashboard(refs) {
  const h = evidenceHealth(refs);
  $('evidenceHealth').innerHTML = `<div class="stat" style="grid-template-columns:repeat(3,1fr)"><div><div class="num">${h.score}%</div><small>Documentation</small></div><div><div class="num">${refs.filter(r => r.sourceType).length}</div><small>Typed sources</small></div><div><div class="num">${refs.filter(r => Array.isArray(r.observations) && r.observations.length).length}</div><small>Analyzed</small></div></div><p><b>${esc(h.label)}</b></p><small>${h.tips.map(esc).join(' · ')}</small>`;
  $('timeline').innerHTML = refs.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 8).map(r => `<div class="pattern"><b>${esc(r.title || r.url || 'Evidence')}</b> <span class="badge">${esc(sourceTypeLabel(r.sourceType || 'web'))}</span><br><small>${new Date(r.createdAt).toLocaleString()} · ${esc(r.sourceName || hostOf(r.url) || 'source')}</small></div>`).join('') || '<span class="muted">Your recent evidence timeline will appear here.</span>';
}

/* ---------- research queue ---------- */
function renderQueue(items) {
  const f = $('queueFilter')?.value || 'all';
  const arr = items.filter(x => f === 'all' || x.status === f).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  $('queueList').innerHTML = arr.map(x => `<div class="lead"><div><b>${esc(x.label || x.url)}</b> <span class="badge">${esc(x.status)}</span> <span class="badge">${esc(sourceTypeLabel(x.sourceType))}</span></div><small>${esc(hostOf(x.url))}${x.note ? ' · ' + esc(x.note) : ''}</small><div class="row" style="margin-top:8px"><button data-queue="open" data-id="${esc(x.id)}">Open</button><button data-queue="done" data-id="${esc(x.id)}">${x.status === 'completed' ? 'Re-queue' : 'Mark done'}</button><button data-queue="delete" data-id="${esc(x.id)}">Remove</button></div></div>`).join('') || '<span class="muted">No research items in this queue.</span>';
}
async function addQueue() {
  const url = normalizeUrl($('queueUrl').value);
  if (!url) return toast('Enter a URL first.');
  const q = { id: 'queue_' + crypto.randomUUID(), projectId: currentProjectId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), url, label: $('queueLabel').value.trim() || hostOf(url), sourceType: $('queueSourceType').value, note: $('queueNote').value.trim(), status: 'queued' };
  await put('queue', q);
  $('queueUrl').value = ''; $('queueLabel').value = ''; $('queueNote').value = '';
  await refresh();
  toast('Added to research queue.');
}
async function queueFromResult(r) {
  const q = { id: 'queue_' + crypto.randomUUID(), projectId: currentProjectId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), url: r.url, label: r.title || hostOf(r.url), sourceType: 'web', note: r.source || '', status: 'queued' };
  await put('queue', q);
  await refresh();
  toast('Result queued for later.');
}

/* ---------- tabs ---------- */
const TABS = [
  ['navHome', 'homeView'],
  ['navSearch', 'searchView'],
  ['navCollections', 'collectionsView'],
  ['navInvestigations', 'investigationsView'],
  ['navLearn', 'learnView'],
];
function setTab(name) {
  const map = {
    home: 'homeView', search: 'searchView', collections: 'collectionsView',
    investigations: 'investigationsView', learn: 'learnView',
    investigate: 'searchView', capture: 'investigationsView', evidence: 'investigationsView', leads: 'investigationsView',
  };
  const view = map[name] || 'homeView';
  for (const [nav, v] of TABS) {
    $(nav)?.classList.toggle('active', v === view);
    $(v)?.classList.toggle('hidden', v !== view);
  }
  if (view === 'investigationsView') mountTools();
  if (view === 'homeView') renderHome();
  if (view === 'collectionsView') renderCollections();
  if (view === 'investigationsView') renderInvestigations();
}

/* ---------- discovery / search ---------- */
function subjectLabel(s) {
  return ({
    person: 'Person', topic: 'Topic', website: 'Website', product: 'Product',
    technique: 'Technique', skill: 'Skill / project', organization: 'Organization',
    vehicle: 'Vehicle', reddit: 'Reddit', social: 'Social', ambiguous: 'Ambiguous',
    position: 'Technique', project: 'Project', place: 'Place',
  }[s] || (s ? String(s) : 'Auto'));
}
function subjectQueryHint(s) {
  return ({
    person: 'Full name and any known context work best.',
    website: 'Paste a domain or URL.',
    product: 'Product, brand, or object.',
    technique: 'A technique, position, or form.',
    skill: 'A skill, craft, or project to learn.',
    organization: 'Organization or institution name.',
    vehicle: 'Vehicle or object.',
    place: 'A place or location.',
    topic: 'Describe the topic or question.',
  }[s] || 'A name, URL, product, technique, or skill.');
}
function backendUrl() { return $('backend').value.trim().replace(/\/$/, ''); }
function imgSrc(u) {
  if (!u || typeof u !== 'string') return '';
  if (u.startsWith('data:image/')) return u;
  const base = backendUrl();
  if (!base) return u;
  return base + '/img?u=' + encodeURIComponent(u);
}
function confidenceLabel(c) {
  return c === 'high' ? 'High confidence' : c === 'medium' ? 'Medium confidence' : 'Low confidence';
}
function updateDeepDiveState() {
  const btn = $('deepDiveBtn');
  const hint = $('deepDiveHint');
  if (!btn) return;
  const q = $('searchQuery')?.value.trim();
  const hasCandidates = lastResults.length > 0;
  const ready = !!(selectedCandidate || hasCandidates);
  btn.disabled = !ready;
  btn.classList.toggle('primary', !!selectedCandidate);
  if (!q && !hasCandidates) {
    hint.textContent = 'Enter a subject or URL and run Discover. Deep Dive stays unavailable until Carmen has a candidate to investigate.';
  } else if (!hasCandidates) {
    hint.textContent = 'No public candidates yet. Run Discover — Deep Dive will not invent sources.';
  } else if (!selectedCandidate) {
    hint.textContent = 'Tap a candidate. Carmen will then ask what you want to investigate — ALL, several areas, or a custom question.';
    btn.disabled = false;
  } else {
    hint.textContent = 'Choose research areas for “' + (selectedCandidate.title || selectedCandidate.domain || 'this candidate') + '”, then Start Deep Dive.';
  }
}

async function retrieveSource(url) {
  const base = backendUrl();
  if (!base) throw Error('Backend URL not set');
  const r = await fetch(base + '/retrieve?url=' + encodeURIComponent(url), { headers: { accept: 'application/json' } });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { throw Error(text || 'Invalid retrieve response'); }
  return data;
}
function provenanceBadge(p) {
  const v = String(p || 'DISCOVERED').toUpperCase();
  const cls = v === 'RETRIEVED' || v === 'OBSERVED' ? 'observed' : v === 'INFERRED' ? 'inferred' : v === 'UNKNOWN' || v === 'RETRIEVAL_FAILED' ? 'unknown' : '';
  return `<span class="badge ${cls}">${esc(v)}</span>`;
}
function accessBadge(state) {
  if (!state) return '';
  const k = String(state).toUpperCase().replace(/[\s—–-]+/g, '_').replace(/_+/g, '_');
  const label = ACCESS_LABELS[k] || String(state).replace(/_/g, ' ');
  const ok = k === 'DIRECTLY_RETRIEVED' || k === 'PUBLIC_ALTERNATIVE';
  const warn = k === 'PARTIALLY_RETRIEVED' || k === 'REFERENCED';
  const cls = ok ? 'access-ok' : warn ? 'access-warn' : 'access-bad';
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}
function adultLabel(v) {
  const a = String(v || 'off').toLowerCase();
  if (a === 'on') return 'Adult content: ON';
  if (a === 'both') return 'Adult content: BOTH';
  return 'Adult content: OFF';
}
function setAdult(mode, opts = {}) {
  currentAdult = (mode === 'on' || mode === 'both') ? mode : 'off';
  document.querySelectorAll('#adultChips .chip, #homeAdultChips .chip').forEach(x => {
    x.classList.toggle('active', x.dataset.adult === currentAdult);
  });
  persistSession();
  if (!opts.silent) {
    const el = $('appSub');
    if (el && currentAdult !== 'off') el.textContent = adultLabel(currentAdult) + ' · public research only';
  }
}
function adultBadge(v) {
  const a = String(v || currentAdult || 'off').toLowerCase();
  const cls = a === 'on' ? 'access-warn' : a === 'both' ? 'inferred' : '';
  return `<span class="badge ${cls}">${esc(adultLabel(a))}</span>`;
}
function depthLabel(v) {
  const d = String(v || currentDepth || 'contextual').toLowerCase();
  if (d === 'deep') return 'Deep';
  if (d === 'broad') return 'Broad';
  return 'Contextual';
}
function setDepth(mode, opts = {}) {
  currentDepth = (mode === 'broad' || mode === 'deep') ? mode : 'contextual';
  document.querySelectorAll('#depthChips .chip').forEach(x => {
    x.classList.toggle('active', x.dataset.depth === currentDepth);
  });
  persistSession();
}
function persistSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      query: $('searchQuery')?.value || '',
      subject: currentSubject,
      results: lastResults,
      selectedUrl: selectedCandidate?.url || '',
      classification: lastClassification,
      paths: lastPaths,
      meta: lastDiscoveryMeta,
      dive: lastDivePayload,
      adult: currentAdult,
      depth: currentDepth,
    }));
  } catch {}
}
async function persistDiscoveryIfKept() {
  if (!currentProjectId || !sessionBoundProject) return;
  const p = (await all('projects')).find(x => x.id === currentProjectId);
  if (!p || p.status === 'scratch') return;
  const disc = (await all('discoveries')).find(d => d.id === currentProjectId) || { id: currentProjectId, projectId: currentProjectId };
  disc.query = $('searchQuery')?.value.trim() || disc.query;
  disc.subject = currentSubject;
  disc.results = lastResults;
  disc.classification = lastClassification;
  disc.paths = lastPaths;
  disc.providers = lastDiscoveryMeta?.providers;
  disc.variants = lastDiscoveryMeta?.variants;
  disc.adultContent = currentAdult;
  disc.depth = currentDepth;
  disc.at = new Date().toISOString();
  disc.status = 'DISCOVERED';
  await put('discoveries', disc);
  p.lastActivityAt = disc.at;
  p.entityType = lastClassification?.type || p.entityType;
  p.query = disc.query;
  p.adultContent = currentAdult;
  p.researchDepth = currentDepth;
  p.thumbnail = selectedCandidate?.image || lastResults[0]?.image || p.thumbnail;
  p.updatedAt = disc.at;
  await put('projects', p);
}
async function keepInvestigation(nameHint) {
  const now = new Date().toISOString();
  const q = $('searchQuery')?.value.trim() || nameHint || 'Investigation';
  let p = (sessionBoundProject && currentProjectId) ? (await all('projects')).find(x => x.id === currentProjectId) : null;
  const prev = String(p?.query || p?.question || '').trim().toLowerCase();
  const next = q.trim().toLowerCase();
  const sameSubject = !prev || !next || prev === next || prev.includes(next) || next.includes(prev);
  if (!p || p.status === 'scratch' || !sameSubject) {
    p = {
      id: 'project_' + crypto.randomUUID(),
      name: (nameHint || q).slice(0, 80),
      question: q,
      instructions: $('projectInstructions')?.value.trim() || '',
      status: 'active',
      entityType: lastClassification?.type || currentSubject || '',
      adultContent: currentAdult,
      researchDepth: currentDepth,
      thumbnail: selectedCandidate?.image || lastResults[0]?.image || '',
      query: q,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    };
    await put('projects', p);
    currentProjectId = p.id;
    sessionBoundProject = true;
    localStorage.setItem('carmen_current_project_v39', p.id);
  } else {
    p.status = p.status === 'completed' ? 'active' : (p.status || 'active');
    p.lastActivityAt = now;
    p.updatedAt = now;
    p.query = q;
    p.entityType = lastClassification?.type || p.entityType;
    p.adultContent = currentAdult;
    p.researchDepth = currentDepth;
    p.thumbnail = selectedCandidate?.image || p.thumbnail;
    await put('projects', p);
  }
  renderProjects(await all('projects'));
  await persistDiscoveryIfKept();
  return p;
}
function renderPathChips(paths, elId) {
  const el = $(elId);
  if (!el) return;
  const list = paths || lastPaths || [];
  el.innerHTML = list.map(p => `<button class="chip" data-path="${esc(p.id)}">${esc(p.label)}</button>`).join('');
}
function restoreSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.query && $('searchQuery')) $('searchQuery').value = s.query;
    currentSubject = s.subject || '';
    lastResults = s.results || [];
    lastClassification = s.classification || null;
    lastPaths = s.paths || [];
    lastDiscoveryMeta = s.meta || null;
    lastDivePayload = s.dive || null;
    if (s.adult) setAdult(s.adult, { silent: true });
    if (s.depth) setDepth(s.depth, { silent: true });
    if (s.selectedUrl) selectedCandidate = lastResults.find(r => r.url === s.selectedUrl) || null;
    if (lastResults.length) {
      renderClassification(lastDiscoveryMeta || { classification: lastClassification, variants: [] });
      renderPathChips(lastPaths, 'divePaths');
      renderResults(lastResults, lastDiscoveryMeta?.providers || {});
      if (selectedCandidate) {
        const i = lastResults.findIndex(r => r.url === selectedCandidate.url);
        if (i >= 0) selectCandidate(selectedCandidate, i);
      }
      if (lastDivePayload) renderDeepDivePayload(lastDivePayload, s.query || '');
    }
  } catch {}
}

async function discover(opts = {}) {
  const q = $('searchQuery').value.trim();
  if (!q) return toast('Enter a subject, name, or URL first.');
  const base = backendUrl();
  if (!base) return toast('Set the Carmen Worker URL in Capture → Connection.');
  localStorage.setItem(BACKEND_KEY, base);
  const expanded = opts.expanded === true;
  expandedMode = expanded;
  const btn = $('discoverBtn');
  btn.disabled = true;
  if ($('expandedBtn')) $('expandedBtn').disabled = true;
  selectedCandidate = null;
  $('results').innerHTML = '<div class="skeleton" style="height:120px;margin-bottom:9px"></div>'.repeat(3);
  $('resultsEmpty').classList.add('hidden');
  $('searchDiagnostics').textContent = expanded
    ? 'Expanded Research — looking across more public sources, image and video indexes, and alternatives…'
    : 'Searching public sources and ranking candidates…';
  $('classBar').innerHTML = '';
  $('selectedBanner').innerHTML = '';
  updateDeepDiveState();
  try {
    const r = await fetch(base + '/search?q=' + encodeURIComponent(q) + '&type=' + encodeURIComponent(currentSubject) + '&adult=' + encodeURIComponent(currentAdult) + '&depth=' + encodeURIComponent(currentDepth) + (expanded ? '&expanded=1' : ''), { headers: { accept: 'application/json' } });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { throw Error(text || `HTTP ${r.status}`); }
    if (!r.ok || data.error) throw Error(data.error || `HTTP ${r.status}`);
    lastResults = Array.isArray(data.results) ? data.results : [];
    lastClassification = data.classification || null;
    lastDiscoveryMeta = data;
    lastPaths = Array.isArray(data.paths) ? data.paths : lastPaths;
    renderClassification(data);
    renderPathChips(lastPaths, 'divePaths');
    renderResults(lastResults, data.providers || {});
    renderExpandedCard(data);
    persistSession();
    updateDeepDiveState();
    toast(lastResults.length ? (expanded ? `Expanded Research ranked ${lastResults.length} public candidate${lastResults.length === 1 ? '' : 's'}.` : `Ranked ${lastResults.length} public candidate${lastResults.length === 1 ? '' : 's'}.`) : 'No public results. See diagnostics.');
  } catch (e) {
    $('results').innerHTML = '';
    $('resultsEmpty').textContent = 'Discovery failed: ' + e.message;
    $('resultsEmpty').classList.remove('hidden');
    $('searchDiagnostics').textContent = '';
    toast('Discovery failed: ' + e.message);
  } finally {
    btn.disabled = false;
    if ($('expandedBtn')) $('expandedBtn').disabled = false;
    updateDeepDiveState();
  }
}
function renderExpandedCard(data) {
  const el = $('expandedResearch');
  if (!el) return;
  const lead = $('expandedLead');
  const thin = !data || !Array.isArray(data.results) || data.results.length < 4;
  const blocked = !!(data && (data.continued || data.warning || (data.results || []).some(r => /PAYWALL|AUTH|BLOCKED|FAILED/i.test(r.accessState || r.retrievalStatus || ''))));
  if (data && data.expanded) {
    el.classList.remove('hidden');
    if (lead) lead.textContent = 'Expanded Research ran for this search. Carmen used broader queries, public indexes, and alternatives when the obvious path failed.';
    if ($('expandedBtn')) $('expandedBtn').textContent = 'Run Expanded Research again';
    return;
  }
  el.classList.remove('hidden');
  if (lead) {
    lead.textContent = thin || blocked
      ? 'The first pass was thin or a source was inaccessible. Expanded Research will try harder across the public web — it will not log in or bypass paywalls.'
      : 'Try harder across the public web. One blocked website is not the end of the investigation.';
  }
  if ($('expandedBtn')) $('expandedBtn').textContent = 'Expanded Research';
}
function renderClassification(data) {
  const c = data && data.classification;
  if (!c) { $('classBar').innerHTML = ''; return; }
  const variants = (data.variants || []).map(v => esc(v.q) + (v.why ? ` <span class="muted">(${esc(v.why)})</span>` : '')).join(' · ');
  const warn = data.warning ? `<p class="warning">${esc(data.warning)}</p>` : '';
  const lanes = (data.lanes || []).map(l => esc(l.id)).join(', ');
  const depth = data.depth || currentDepth;
  const ctx = c.context && !/^adult content$/i.test(c.context) ? c.context : '';
  $('classBar').innerHTML = `<div class="briefing">
    <b>Investigating ${esc(c.subject || data.query || '')}</b>
    <div class="rowbits">
      <span class="badge">${esc(c.type)}</span>
      ${adultBadge(data.adultContent || currentAdult)}
      <span class="badge">${esc(depthLabel(depth))}</span>
      ${ctx ? '<span class="badge access-ok">context: ' + esc(ctx) + '</span>' : '<span class="badge">no extra context</span>'}
      ${data.intersectionCount ? '<span class="badge access-ok">' + esc(String(data.intersectionCount)) + ' intersection hits</span>' : ''}
      ${data.expanded ? '<span class="badge access-ok">Expanded Research</span>' : ''}
    </div>
    <p class="hint" style="margin:8px 0 0">${esc(c.reason)}${c.isUrl ? ' · treating this as a page to inspect' : ''}${lanes ? '<br>Discovery lanes: ' + lanes : ''}${variants ? '<br>Queries: ' + variants : ''}</p>
  </div>${warn}`;
}
function selectCandidate(r, i, opts = {}) {
  selectedCandidate = r;
  document.querySelectorAll('#results .result').forEach(el => el.classList.toggle('selected', el.dataset.i === String(i)));
  $('selectedBanner').innerHTML = r ? `<div class="selbar"><b>Selected candidate</b><br>${esc(r.title || r.url)} · ${esc(r.domain || hostOf(r.url))}<br><small>${esc(r.reason || '')}</small></div>` : '';
  updateDeepDiveState();
  persistSelection(r);
  if (!opts.silent) openDivePlanner(r);
}
async function persistSelection(r) {
  if (!currentProjectId || !sessionBoundProject || !r) return;
  try {
    const disc = (await all('discoveries')).find(d => d.id === currentProjectId) || { id: currentProjectId, projectId: currentProjectId };
    disc.selectedUrl = r.url;
    disc.results = lastResults;
    await put('discoveries', disc);
  } catch {}
}
function availablePathsForNow() {
  if (lastPaths && lastPaths.length) return lastPaths;
  const t = lastClassification?.type || currentSubject || 'topic';
  return lastDiscoveryMeta?.paths || [];
}
function openDivePlanner(candidate) {
  const el = $('divePlanner');
  if (!el) return;
  const c = candidate || selectedCandidate || lastResults[0];
  if (!c && !$('searchQuery')?.value.trim()) return;
  const type = lastClassification?.type || c?.entityType || currentSubject || 'topic';
  const paths = (lastDiscoveryMeta?.paths && lastDiscoveryMeta.paths.length) ? lastDiscoveryMeta.paths : lastPaths;
  lastPaths = paths.length ? paths : lastPaths;
  diveAll = true;
  selectedDivePathIds = lastPaths.map(p => p.id);
  const name = c?.title || $('searchQuery')?.value || 'this subject';
  $('divePlannerLead').innerHTML = `<b>${esc(name)}</b> <span class="badge">${esc(subjectLabel(type))}</span><br>Carmen found several research areas. What do you want to explore?`;
  renderDiveSelectChips();
  el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function renderDiveSelectChips() {
  const el = $('diveSelectChips');
  if (!el) return;
  const paths = lastPaths || [];
  el.innerHTML = `<button class="chip${diveAll ? ' active' : ''}" data-diveall="1">ALL</button>` +
    paths.map(p => `<button class="chip${(!diveAll && selectedDivePathIds.includes(p.id)) || diveAll ? ' active' : ''}" data-divepath="${esc(p.id)}">${esc(p.label)}</button>`).join('');
}
function toggleDivePath(id) {
  if (id === 'all') {
    diveAll = true;
    selectedDivePathIds = (lastPaths || []).map(p => p.id);
  } else if (diveAll) {
    diveAll = false;
    selectedDivePathIds = [id];
  } else {
    if (selectedDivePathIds.includes(id)) selectedDivePathIds = selectedDivePathIds.filter(x => x !== id);
    else selectedDivePathIds = [...selectedDivePathIds, id];
    if (!selectedDivePathIds.length) {
      diveAll = true;
      selectedDivePathIds = (lastPaths || []).map(p => p.id);
    } else if (lastPaths.length && selectedDivePathIds.length === lastPaths.length) {
      diveAll = true;
    }
  }
  renderDiveSelectChips();
}
function openLightbox(src, cap, gallery, index, sourceUrl) {
  const box = $('lightbox');
  if (!box) return;
  lightboxGallery = Array.isArray(gallery) && gallery.length ? gallery : [{ src, cap, pageUrl: sourceUrl || '' }];
  lightboxIndex = Math.max(0, index || 0);
  showLightboxSlide();
  box.classList.remove('hidden');
}
function showLightboxSlide() {
  const item = lightboxGallery[lightboxIndex] || lightboxGallery[0];
  if (!item) return;
  $('lightboxImg').src = item.src || item.url || '';
  const n = lightboxGallery.length;
  const loc = n > 1 ? ` (${lightboxIndex + 1} of ${n})` : '';
  $('lightboxCap').textContent = (item.cap || item.caption || 'Image keeps its page provenance. Visual consistency is not identity proof.') + loc;
  lightboxSourceUrl = item.pageUrl || item.sourceUrl || '';
  if ($('lightboxPrev')) $('lightboxPrev').disabled = lightboxIndex <= 0;
  if ($('lightboxNext')) $('lightboxNext').disabled = lightboxIndex >= n - 1;
}
function lightboxStep(d) {
  const n = lightboxGallery.length;
  if (!n) return;
  lightboxIndex = Math.max(0, Math.min(n - 1, lightboxIndex + d));
  showLightboxSlide();
}
function closeLightbox() {
  const box = $('lightbox');
  if (!box) return;
  box.classList.add('hidden');
  $('lightboxImg').src = '';
  lightboxGallery = [];
}
function renderResults(results, providers) {
  $('resultCount').textContent = results.length ? String(results.length) : '';
  $('searchDiagnostics').innerHTML = renderDiagnostics(providers);
  if (!results.length) {
    $('results').innerHTML = '';
    $('resultsEmpty').textContent = 'No public-web candidates were returned. Diagnostics below show which sources responded.';
    $('resultsEmpty').classList.remove('hidden');
    updateDeepDiveState();
    return;
  }
  $('resultsEmpty').classList.add('hidden');
  $('results').innerHTML = results.map((r, i) => {
    const imgs = [...new Set([r.image, ...(r.images || [])].filter(Boolean))].slice(0, 6);
    const hero = imgs[0];
    const rest = imgs.slice(1, 5);
    const selected = selectedCandidate && selectedCandidate.url === r.url;
    const aliases = (r.aliases || []).filter(Boolean).slice(0, 4);
    return `<div class="result${selected ? ' selected' : ''}" data-i="${i}">
      ${hero ? `<img class="hero" data-full="${esc(imgSrc(hero))}" data-cap="${esc((r.domain || '') + ' · ' + (r.url || ''))}" src="${esc(imgSrc(hero))}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ''}
      <div class="rbody">
        <div class="rhead">
          ${!hero && r.image ? `<img class="rthumb" data-full="${esc(imgSrc(r.image))}" data-cap="${esc((r.domain || '') + ' · ' + (r.url || ''))}" src="${esc(imgSrc(r.image))}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ''}
          <div class="rmeta">
            <div class="rtitle">${esc(r.title)}</div>
            <div class="rmeta"><span class="badge">${esc(subjectLabel(r.entityType || lastClassification?.type || currentSubject || 'web'))}</span>${r.intersection ? ' <span class="badge access-ok">entity ∩ context</span>' : ''}${r.contextLane === 'adult' ? ' <span class="badge access-warn">adult-context</span>' : ''} <span class="host">${esc(r.domain || hostOf(r.url))}</span> · ${esc(r.source)} · ${provenanceBadge(r.provenance || 'DISCOVERED')}${r.accessState ? ' · ' + accessBadge(r.accessState) : ''} · <span class="confidence ${esc(r.confidence || 'low')}">${esc(confidenceLabel(r.confidence))}</span>${r.observedAt ? ' · ' + esc(new Date(r.observedAt).toLocaleString()) : ''}</div>
          </div>
        </div>
        ${r.reason ? `<div class="rwhy">${esc(r.reason)}</div>` : ''}
        ${r.accessNote ? `<p class="warning">${esc(r.accessNote)}</p>` : ''}
        ${r.publicEvidence ? `<p class="hint">Public evidence (not protected content): ${esc(r.publicEvidence)}</p>` : ''}
        ${aliases.length ? `<div class="aliases">${aliases.map(a => `<span>${esc(a)}</span>`).join('')}</div>` : ''}
        ${r.snippet ? `<div class="rsnippet">${esc(r.snippet)}</div>` : ''}
        ${rest.length ? `<div class="thumbs">${rest.map(u => `<img data-full="${esc(imgSrc(u))}" data-cap="${esc((r.domain || '') + ' · ' + (r.url || ''))}" src="${esc(imgSrc(u))}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">`).join('')}</div>` : ''}
        <div class="racts">
          <button data-ract="select" data-i="${i}">${selected ? 'Selected' : 'Select'}</button>
          <button data-ract="dive" data-i="${i}">Deep dive</button>
          <button data-ract="save" data-i="${i}">Save</button>
          <button data-ract="open" data-i="${i}">Open</button>
        </div>
      </div>
    </div>`;
  }).join('');
  renderSearchSuggestions(results);
  updateDeepDiveState();
}
function renderDiagnostics(providers) {
  const entries = Object.entries(providers || {});
  if (!entries.length) return '';
  return 'Providers: ' + entries.map(([k, v]) => v && v.ok ? `<span class="ok">${esc(k)} ✓</span>` : `<span class="bad">${esc(k)} ✗${v && v.error ? ' ' + esc(v.error) : v && v.status ? ' HTTP ' + v.status : ''}</span>`).join(' · ');
}
function renderSearchSuggestions(results) {
  const el = $('suggestBar');
  if (!el) return;
  const notes = [];
  const c = lastClassification;
  if (c && (c.type === 'ambiguous' || c.confidence === 'low')) {
    notes.push('There are multiple possible interpretations of this query. Select a type chip or a candidate to disambiguate.');
  }
  const hosts = {};
  for (const r of results || []) {
    const h = r.domain || hostOf(r.url);
    if (!h) continue;
    hosts[h] = (hosts[h] || 0) + 1;
  }
  const clustered = Object.entries(hosts).filter(([, n]) => n >= 2)[0];
  if (clustered) notes.push('Several results on ' + clustered[0] + ' appear to describe the same entity.');
  if ((results || []).length >= 3) notes.push('Carmen found ' + results.length + ' public candidates. Choose what to investigate.');
  el.innerHTML = notes.slice(0, 2).map(n => `<div class="suggest">${esc(n)}</div>`).join('');
}
async function saveResultAsEvidence(r) {
  const fp = await sha(normalizeUrl(r.url) + '|' + String(r.title || '').toLowerCase().trim());
  const existing = (await all('refs')).find(x => x.projectId === currentProjectId && (x.urlFingerprint === fp || (x.url && normalizeUrl(x.url) === normalizeUrl(r.url))));
  if (existing) { toast('That result is already saved in this investigation.'); return; }
  const id = 'ref_' + crypto.randomUUID();
  let retrieval = null;
  let provenance = r.provenance || 'DISCOVERED';
  try {
    toast('Retrieving source…');
    retrieval = await retrieveSource(r.url);
    if (retrieval && retrieval.status === 'RETRIEVED') provenance = 'RETRIEVED';
    else if (retrieval && retrieval.status === 'RETRIEVAL_FAILED') provenance = 'RETRIEVAL_FAILED';
  } catch (e) {
    provenance = 'RETRIEVAL_FAILED';
    retrieval = { status: 'RETRIEVAL_FAILED', error: String(e.message || e).slice(0, 200) };
  }
  const images = (retrieval && retrieval.images) || r.images || [];
  const ref = {
    id, projectId: currentProjectId, createdAt: new Date().toISOString(),
    source: 'public-web', url: r.url, title: (retrieval && retrieval.title) || r.title, urlFingerprint: fp,
    context: r.snippet || '', sourceType: r.sourceType || inferSourceType(r), sourceName: r.domain || hostOf(r.url),
    snippet: r.snippet || '', observedAt: r.observedAt || new Date().toISOString(), fromSearch: true,
    reason: r.reason || '', confidence: r.confidence || '',
    provenance, retrievalStatus: provenance,
    retrievedAt: retrieval && retrieval.retrievedAt || null,
    textExcerpt: retrieval && (retrieval.textExcerpt || retrieval.text) || r.textExcerpt || null,
    description: retrieval && retrieval.description || null,
    images,
    image: r.image || images[0] || '',
    contentFingerprint: retrieval && retrieval.fingerprint || null,
    retrievalError: retrieval && retrieval.error || null,
  };
  await put('refs', ref);
  await put('events', { id: 'evt_' + crypto.randomUUID(), projectId: currentProjectId, type: 'evidence_saved', at: new Date().toISOString(), refId: id, url: r.url, provenance });
  await refresh();
  toast(provenance === 'RETRIEVED' ? 'Saved with retrieved source content.' : provenance === 'RETRIEVAL_FAILED' ? 'Saved (retrieval failed — snippet only).' : 'Saved to evidence.');
}
function inferSourceType(r) {
  const h = hostOf(r.url);
  if (h === 'reddit.com' || h.endsWith('.reddit.com')) return 'reddit';
  return 'web';
}

/* ---------- deep dive workspace ---------- */
function openPlannerFromButton() {
  const candidate = selectedCandidate || lastResults[0] || null;
  if (!candidate && !$('searchQuery')?.value.trim()) return toast('Search and select a candidate first.');
  if (candidate && !selectedCandidate) {
    const i = lastResults.findIndex(x => x.url === candidate.url);
    selectCandidate(candidate, Math.max(0, i));
    return;
  }
  openDivePlanner(candidate);
}
async function deepDive(focusResult) {
  if (focusResult) {
    const i = lastResults.findIndex(x => x.url === focusResult.url);
    if (i >= 0) selectCandidate(focusResult, i);
    else openDivePlanner(focusResult);
    return;
  }
  openPlannerFromButton();
}
async function runDeepDive() {
  const base = backendUrl();
  if (!base) return toast('Set the Carmen Worker URL in Capture → Connection.');
  const subject = $('searchQuery').value.trim() || $('projectQuestion').value.trim();
  const candidate = selectedCandidate || lastResults[0] || null;
  if (!subject && !candidate) return toast('Search and select a candidate first.');
  await keepInvestigation(subject || candidate?.title);
  localStorage.setItem(BACKEND_KEY, base);
  const btn = $('startDiveBtn');
  if (btn) btn.disabled = true;
  $('deepDiveBtn').disabled = true;
  if (candidate) selectCandidateKeepPlanner(candidate);
  const customQuestion = $('diveCustom')?.value.trim() || '';
  const pathIds = diveAll ? ['all'] : selectedDivePathIds.slice();
  const useExpanded = expandedMode || !!$('diveExpanded')?.checked;
  $('deepDiveProgress').innerHTML = '<p class="dive-step on">Planning investigation…</p><p class="dive-step on">Selected: ' + esc(diveAll ? 'ALL' : selectedDivePathIds.join(', ')) + (useExpanded ? ' · Expanded Research' : '') + '</p><p class="dive-step">Retrieving public sources…</p><p class="dive-step">Collecting images and videos…</p><p class="dive-step">Analyzing OBSERVED / INFERRED / UNKNOWN…</p>';
  $('deepDiveResult').innerHTML = '<p class="muted">Deep Dive is a read-only research workspace. Carmen will not contact anyone or take external actions.</p>';
  let instructions = '';
  try {
    const p = (await all('projects')).find(x => x.id === currentProjectId);
    instructions = (p && p.instructions) || ($('projectInstructions') && $('projectInstructions').value.trim()) || '';
  } catch {}
  try {
    const r = await fetch(base + '/dive', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: subject,
        subject: currentSubject || lastClassification?.type || '',
        candidate,
        instructions,
        customQuestion,
        all: diveAll,
        paths: pathIds,
        expanded: useExpanded,
        adult: currentAdult,
        adultContent: currentAdult,
        depth: currentDepth,
      }),
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { throw Error(text || `HTTP ${r.status}`); }
    if (!r.ok || data.error) throw Error(data.error || `HTTP ${r.status}`);
    if (Array.isArray(data.results) && data.results.length) {
      lastResults = data.results;
      renderResults(lastResults, data.providers || {});
    }
    renderDeepDivePayload(data, subject);
    await persistDiscoveryIfKept();
    const disc = (await all('discoveries')).find(d => d.id === currentProjectId) || { id: currentProjectId, projectId: currentProjectId };
    disc.deepDiveText = data.analysis || '';
    disc.deepDiveAt = new Date().toISOString();
    disc.deepDiveSubject = subject;
    disc.deepDiveFocusUrl = candidate?.url || '';
    disc.deepDivePlan = data.plan;
    disc.deepDiveImages = data.images;
    disc.deepDiveVideos = data.videos;
    disc.deepDiveRetrieved = data.retrieved;
    disc.deepDiveRelated = data.related;
    disc.selectedPathIds = data.selectedPathIds || pathIds;
    disc.customQuestion = customQuestion;
    disc.adultContent = currentAdult;
    disc.paths = data.paths || lastPaths;
    disc.results = lastResults;
    disc.classification = data.classification || lastClassification;
    await put('discoveries', disc);
    const proj = (await all('projects')).find(x => x.id === currentProjectId);
    if (proj) {
      proj.selectedPathIds = disc.selectedPathIds;
      proj.customQuestion = customQuestion;
      proj.updatedAt = disc.deepDiveAt;
      proj.lastActivityAt = disc.deepDiveAt;
      await put('projects', proj);
    }
    await put('events', { id: 'evt_' + crypto.randomUUID(), projectId: currentProjectId, type: 'deep_dive', at: new Date().toISOString(), subject, focusUrl: candidate?.url || '', paths: disc.selectedPathIds });
    for (const raw of (data.leads || []).slice(0, 8)) {
      const t = String(raw.text || raw).trim();
      if (t) await put('leads', { id: 'lead_' + crypto.randomUUID(), projectId: currentProjectId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), text: t, url: raw.url || '', status: 'new', refIds: [] });
    }
    await refresh();
    toast('Deep dive complete.');
  } catch (e) {
    const msg = String(e.message || e);
    const isConfig = /API_KEY|not configured|provider is not configured/i.test(msg);
    $('deepDiveResult').innerHTML = `<div class="claim unknown"><b>Deep Dive unavailable</b><br>${esc(msg)}</div>${isConfig ? '<p class="hint">Search and evidence still work. AI analysis needs the Worker secret.</p>' : '<p class="hint">Non-AI investigation features remain available.</p>'}`;
    toast(isConfig ? 'AI not configured — search & evidence still work' : 'Deep dive failed: ' + msg);
  } finally {
    if (btn) btn.disabled = false;
    updateDeepDiveState();
  }
}
function selectCandidateKeepPlanner(candidate) {
  selectedCandidate = candidate;
  const i = Math.max(0, lastResults.findIndex(x => x.url === candidate.url));
  document.querySelectorAll('#results .result').forEach(el => el.classList.toggle('selected', el.dataset.i === String(i)));
}
function renderDeepDivePayload(data, subject) {
  const plan = data.plan || {};
  lastDivePayload = data;
  lastPaths = data.availablePaths || data.paths || lastPaths;
  renderPathChips(data.paths || lastPaths, 'divePaths');
  persistSession();
  const steps = (plan.investigating || []).map(s => `<p class="dive-step on">${esc(s)}</p>`).join('');
  $('deepDiveProgress').innerHTML = steps || '<p class="dive-step on">Deep dive finished.</p>';
  diveWorkspaceTab = 'findings';
  renderDiveWorkspace(data, subject);
}
function renderDiveWorkspace(data, subject) {
  const plan = (data && data.plan) || {};
  const imgs = (data.images || []).slice(0, 24);
  const videos = data.videos || [];
  const retrieved = data.retrieved || [];
  const related = data.related || [];
  const leads = data.leads || [];
  const suggestions = data.suggestions || [];
  const writeup = data.analysis || data.lesson || '';
  const tabs = [
    ['findings', 'Findings'],
    ['images', 'Images' + (imgs.length ? ' ' + imgs.length : '')],
    ['videos', 'Videos' + (videos.length ? ' ' + videos.length : '')],
    ['sources', 'Sources'],
    ['evidence', 'Evidence'],
    ['leads', 'Leads'],
    ['related', 'Related'],
  ];
  const tabHtml = `<div class="ws-tabs">${tabs.map(([id, label]) => `<button class="chip${diveWorkspaceTab === id ? ' active' : ''}" data-wstab="${id}">${esc(label)}</button>`).join('')}</div>`;
  const suggestHtml = suggestions.length ? suggestions.map(s => `<div class="suggest">${esc(s)}</div>`).join('') : '';
  const access = data.access || {};
  const accessHtml = access.headline ? `<div class="access-banner"><b>${esc(access.headline)}</b>${access.paywalled ? '<span class="hint">Paywalled material was not converted into retrieved evidence.</span>' : ''}${!data.expanded && (access.paywalled || access.authenticationRequired || (access.inaccessible || []).length) ? '<div class="row" style="margin-top:8px"><button class="btn" data-expand-dive="1">Expanded Research</button></div>' : ''}</div>` : '';
  let body = '';
  if (diveWorkspaceTab === 'images') {
    const gallery = imgs.map(im => ({ src: imgSrc(im.url || im), cap: [im.reason || im.caption, im.domain, im.pageUrl || im.url].filter(Boolean).join(' · '), pageUrl: im.pageUrl || im.url || '' }));
    body = imgs.length ? `<div class="gallery">${imgs.map((im, i) => `<img src="${esc(imgSrc(im.url || im))}" data-g="${i}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">`).join('')}</div>
      <p class="hint">Images keep page provenance. Visual consistency across sources is not identity proof.</p>
      <button class="btn" data-save-images="1">Save images to a collection</button>` : '<p class="hint">No reliable images were retrieved for this candidate.</p>';
    lastDivePayload = lastDivePayload || data;
    lastDivePayload._gallery = gallery;
  } else if (diveWorkspaceTab === 'videos') {
    body = videos.length ? videos.map(v => {
      if (v.playable && v.embedUrl) {
        return `<div class="video-card"><iframe src="${esc(v.embedUrl)}" allow="encrypted-media; picture-in-picture" allowfullscreen title="${esc(v.title || 'Video')}"></iframe><div class="vmeta"><b>${esc(v.title || v.domain)}</b>${v.contextLane === 'adult' ? ' <span class="badge access-warn">adult-context</span>' : ''}<br><small>${esc(v.domain)} · playable public embed${v.reason ? ' · ' + esc(v.reason) : ''}</small><br><a href="${esc(v.pageUrl || v.url)}" target="_blank" rel="noopener noreferrer">Open source</a> · <button class="btn" data-save-video="${esc(v.url)}" data-title="${esc(v.title || '')}" data-thumb="${esc(v.thumbnail || '')}" style="margin-top:6px">Save</button></div></div>`;
      }
      const thumb = v.thumbnail ? `<img src="${esc(imgSrc(v.thumbnail))}" alt="" style="width:100%;aspect-ratio:16/9;object-fit:cover;background:#000" referrerpolicy="no-referrer">` : '';
      const note = v.accessNote || 'Embedding is blocked here. Open the source to watch. Carmen does not invent playback.';
      return `<div class="video-card">${thumb}<div class="vmeta"><b>${esc(v.title || v.domain)}</b><br><small>${esc(v.domain)} · ${v.accessState ? accessBadge(v.accessState) + ' · ' : ''}${esc(note)}</small><div class="row" style="margin-top:8px"><a class="btn primary" href="${esc(v.pageUrl || v.url)}" target="_blank" rel="noopener noreferrer" style="text-align:center;display:block">Open source</a><button class="btn" data-save-video="${esc(v.url)}" data-title="${esc(v.title || '')}" data-thumb="${esc(v.thumbnail || '')}">Save</button></div></div></div>`;
    }).join('') : '<p class="hint">No public videos were retrieved. Carmen does not invent playback.</p>';
  } else if (diveWorkspaceTab === 'sources') {
    body = retrieved.map(x => `<div class="pattern"><b>${esc(x.title || x.url)}</b> ${accessBadge(x.accessState || (x.status === 'RETRIEVED' ? 'DIRECTLY_RETRIEVED' : 'UNAVAILABLE'))} ${provenanceBadge(x.status)}<br><small>${esc(x.finalUrl || x.url || '')}${x.accessNote ? ' · ' + esc(x.accessNote) : ''}${x.error ? ' · ' + esc(x.error) : ''}${x.subreddit ? ' · ' + esc(x.subreddit) : ''}${x.author ? ' · ' + esc(x.author) : ''}</small>${x.publicEvidence ? '<p class="hint">Public evidence (not protected content): ' + esc(x.publicEvidence) + '</p>' : ''}</div>`).join('') || '<p class="muted">No retrieved pages.</p>';
  } else if (diveWorkspaceTab === 'evidence') {
    const inaccessible = access.inaccessible || retrieved.filter(x => x.status !== 'RETRIEVED');
    const ok = retrieved.filter(x => x.status === 'RETRIEVED');
    body = `<p class="hint">OBSERVED is only what was actually retrieved. Inferences stay labeled. Inaccessible sources are not discarded and are not treated as retrieved evidence.</p>
      ${ok.map(x => `<div class="pattern"><b>${esc(x.title || x.url)}</b> ${accessBadge(x.accessState || 'DIRECTLY_RETRIEVED')}<br><small class="hint">OBSERVED from retrieved public page</small></div>`).join('')}
      ${inaccessible.map(x => `<div class="pattern"><b>${esc(x.title || x.url)}</b> ${accessBadge(x.accessState || 'UNAVAILABLE')}<br><small>${esc(x.note || x.accessNote || x.error || '')}</small>${x.publicEvidence ? '<p class="hint">What Carmen can verify from public references: ' + esc(x.publicEvidence) + '</p><p class="warning">What Carmen cannot verify: content that requires access.</p>' : '<p class="warning">No protected content was retrieved.</p>'}</div>`).join('')}
      ${!ok.length && !inaccessible.length ? '<p class="muted">No evidence records yet.</p>' : ''}`;
  } else if (diveWorkspaceTab === 'leads') {
    body = leads.map(l => `<div class="lead"><b>${esc(l.text || l)}</b></div>`).join('') || '<p class="muted">No leads yet.</p>';
  } else if (diveWorkspaceTab === 'related') {
    body = related.length ? related.map((rel, i) => `<div class="branch"><b>${esc(rel.label)}</b> <span class="badge">${esc(rel.kind || 'related')}</span><div class="subtle">${esc(rel.why || '')}${rel.domain ? ' · ' + esc(rel.domain) : ''}</div><button class="btn primary" data-branch="${i}" style="margin-top:8px">Investigate this</button></div>`).join('') : '<p class="muted">No related aspects yet. Deep Dive can surface people, techniques, objects, or sources connected to this case.</p>';
  } else {
    let analysisHtml = '';
    if (writeup) analysisHtml = renderAdaptiveWriteup(writeup, data.paths || lastPaths, subject);
    else if (data.analysisError) analysisHtml = `<div class="claim unknown"><b>Analysis unavailable</b><br>${esc(data.analysisError)}</div>`;
    body = analysisHtml || '<p class="muted">Findings will appear here after Deep Dive finishes.</p>';
  }
  $('deepDiveResult').innerHTML = `
    <div class="selbar"><b>${esc(plan.subject || subject)}</b> <span class="badge">${esc(subjectLabel(plan.type || currentSubject))}</span> ${plan.all ? '<span class="badge">ALL</span>' : ''}${adultBadge(plan.adultContent || data.adultContent || currentAdult)}<span class="badge">${esc(depthLabel(plan.depth || data.depth || currentDepth))}</span>${plan.expanded ? '<span class="badge access-ok">Expanded Research</span>' : ''}${plan.context ? '<span class="badge">context: ' + esc(plan.context) + '</span>' : ''}<br><small>${esc(plan.why || '')}</small>${plan.customQuestion ? '<br><small>Question: ' + esc(plan.customQuestion) + '</small>' : ''}<br><small>${esc(plan.safety || 'Read-only public research.')}</small></div>
    ${accessHtml}${suggestHtml}${tabHtml}${body}`;
}
function renderAdaptiveWriteup(text, paths, subject) {
  const labels = (paths || []).map(p => p.label).filter(Boolean);
  const pathRe = labels.length
    ? new RegExp('(?:^|\\n)\\s*(?:#+\\s*)?(' + labels.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\s*[:\\-]?\\s*(?=\\n|$)', 'i')
    : null;
  const chunks = [];
  if (pathRe) {
    const parts = String(text || '').split(pathRe);
    if (parts.length >= 3) {
      if (parts[0].trim()) chunks.push({ title: subject || 'Brief', body: parts[0], id: 'path-overview' });
      for (let i = 1; i < parts.length; i += 2) {
        const title = parts[i];
        const body = parts[i + 1] || '';
        const match = (paths || []).find(p => p.label.toLowerCase() === String(title).toLowerCase());
        chunks.push({ title, body, id: 'path-' + (match?.id || title.toLowerCase().replace(/[^a-z0-9]+/g, '-')) });
      }
    }
  }
  if (!chunks.length) return renderDeepDive(text, subject, true);
  const html = chunks.map(c => {
    const inner = String(c.body || '').split(/\n(?=#+\s*(?:OBSERVED|INFERRED|UNKNOWN)|\b(OBSERVED|INFERRED|UNKNOWN)\b\s*[:\-])/i).filter(Boolean).map(s => {
      const m = s.match(/^(?:#+\s*)?(OBSERVED|INFERRED|UNKNOWN)\b\s*[:\-]?\s*([\s\S]*)/i);
      if (m) {
        const kind = m[1].toLowerCase();
        const cls = kind === 'observed' ? '' : kind === 'unknown' ? 'unknown' : 'inferred';
        return `<div class="claim ${cls}"><b>${esc(m[1])}</b><br>${esc(m[2]).replace(/\n/g, '<br>')}</div>`;
      }
      return `<p>${esc(s).replace(/\n/g, '<br>')}</p>`;
    }).join('');
    return `<div class="card" id="${esc(c.id)}"><h3>${esc(c.title)}</h3>${inner}</div>`;
  }).join('');
  return html + '<p class="hint">Distinguish OBSERVED (in sources), INFERRED (Carmen\'s interpretation), and UNKNOWN (gaps). Visual consistency is not identity proof.</p>';
}
function renderDeepDive(text, subject, asFragment) {
  // Lightly structure the model's OBSERVED / INFERRED / UNKNOWN sections if present.
  const sections = text.split(/\n(?=#+\s*(?:OBSERVED|INFERRED|UNKNOWN)|\b(OBSERVED|INFERRED|UNKNOWN)\b\s*[:\-])/i).filter(Boolean);
  let html;
  if (sections.length >= 2) {
    html = sections.map(s => {
      const m = s.match(/^(?:#+\s*)?(OBSERVED|INFERRED|UNKNOWN)\b\s*[:\-]?\s*([\s\S]*)/i);
      if (m) {
        const kind = m[1].toLowerCase();
        const cls = kind === 'observed' ? '' : kind === 'unknown' ? 'unknown' : 'inferred';
        return `<div class="claim ${cls}"><b>${esc(m[1])}</b><br>${esc(m[2]).replace(/\n/g, '<br>')}</div>`;
      }
      return `<div class="claim"><br>${esc(s).replace(/\n/g, '<br>')}</div>`;
    }).join('');
  } else {
    html = `<div class="claim"><b>Deep dive: ${esc(subject)}</b><br>${esc(text).replace(/\n/g, '<br>')}</div>`;
  }
  html += '<p class="hint">Distinguish OBSERVED (in sources), INFERRED (Carmen\'s interpretation), and UNKNOWN (gaps). Visual consistency is not identity proof.</p>';
  if (asFragment) return html;
  $('deepDiveResult').innerHTML = html;
}

/* ---------- leads ---------- */
function renderLeads(leads) {
  const order = { new: 0, reviewed: 1, dismissed: 2 };
  leads.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || String(b.createdAt).localeCompare(String(a.createdAt)));
  $('leadList').innerHTML = leads.map(l => `<div class="lead"><div><b>${esc(l.text)}</b> <span class="badge">${esc(l.status)}</span></div><small>${new Date(l.createdAt).toLocaleString()} · ${l.refIds?.length || 0} source reference${(l.refIds?.length || 0) === 1 ? '' : 's'}</small><div class="row" style="margin-top:8px"><button data-lead-action="review" data-id="${esc(l.id)}">${l.status === 'reviewed' ? 'Reviewed' : 'Mark reviewed'}</button><button data-lead-action="question" data-id="${esc(l.id)}">Use as question</button><button data-lead-action="dismiss" data-id="${esc(l.id)}">Dismiss</button></div></div>`).join('') || '<span class="muted">No research leads yet. Compare evidence or run a deep dive to generate leads.</span>';
}
async function updateLead(id, patch) {
  const leads = await all('leads'), l = leads.find(x => x.id === id);
  if (!l) return;
  Object.assign(l, patch, { updatedAt: new Date().toISOString() });
  await put('leads', l);
  await refresh();
}

/* ---------- capture / browser ---------- */
function navigate(u, push = true) {
  u = normalizeUrl(u);
  if (!u) return;
  $('url').value = u;
  $('webview').src = u;
  localStorage.setItem(URL_KEY, u);
  if (push) { historyStack = historyStack.slice(0, historyIndex + 1); historyStack.push(u); historyIndex = historyStack.length - 1; }
  updateNav();
}
function updateNav() {
  $('back').disabled = historyIndex <= 0;
  $('forward').disabled = historyIndex < 0 || historyIndex >= historyStack.length - 1;
}
function enableCapture() { $('analyze').disabled = false; $('save').disabled = false; }
function showCurrent() {
  let el = $('captured');
  if (!el) { el = document.createElement('img'); el.id = 'captured'; el.className = 'preview-img'; $('capturedWrap').appendChild(el); }
  el.src = current; el.alt = 'Current Carmen capture';
}
function currentUrl() { return normalizeUrl($('url').value); }
async function saveReference(source = 'iphone-screenshot', data = {}) {
  if (!current) return null;
  if (!currentProjectId || !sessionBoundProject) {
    toast('Keep or resume an investigation first. Capture is never auto-saved into a collection.');
    return null;
  }
  const fingerprint = await sha(current);
  const existing = (await all('refs')).find(r => r.projectId === currentProjectId && r.fingerprint === fingerprint);
  if (existing) { toast('This capture is already saved in this investigation.'); return existing; }
  const id = 'ref_' + crypto.randomUUID();
  const ref = { id, projectId: currentProjectId, createdAt: new Date().toISOString(), source, url: currentUrl(), title: data.title || currentUrl(), context: $('context').value, sourceType: currentSourceType(), sourceName: $('sourceName').value.trim(), ...data, imageDataUrl: current, fingerprint };
  await put('refs', ref);
  await put('events', { id: 'evt_' + crypto.randomUUID(), projectId: currentProjectId, type: 'reference_saved', at: new Date().toISOString(), refId: id });
  await refresh();
  return ref;
}
function list(v) { return (v || []).map(x => `<div>• ${esc(x.text || x)}</div>`).join('') || 'None reported.'; }
function renderAnalysis(d) {
  $('result').innerHTML = `<div class="claim"><b>${esc(d.title || 'Carmen analysis')}</b></div>
    <div class="claim"><b>Observations</b> <span class="badge observed">OBSERVED</span><br>${list(d.observations)}</div>
    <div class="claim inferred"><b>Inferences</b> <span class="badge inferred">INFERRED</span><br>${list(d.inferences)}</div>
    <div class="claim unknown"><b>Unknowns</b> <span class="badge unknown">UNKNOWN</span><br>${list(d.unknowns)}</div>
    <div class="claim"><b>Relationships</b><br>${list(d.relationships)}</div>
    <div class="claim"><b>Candidate patterns</b><br>${list(d.candidatePatterns)}</div>
    <div class="claim"><b>Signature</b><br>${esc(d.signature || 'Not supplied.')}</div>`;
}

function mountTools() {
  const mount = $('toolsMount');
  const src = $('legacyTools');
  if (mount && src && src.parentElement !== mount) {
    src.classList.remove('hidden');
    mount.appendChild(src);
  }
}

async function renderHome() {
  if (!$('homeRecent')) return;
  const ps = (await all('projects')).filter(p => p.status !== 'scratch');
  ps.sort((a, b) => String(b.lastActivityAt || b.updatedAt || '').localeCompare(String(a.lastActivityAt || a.updatedAt || '')));
  const resume = ps.find(p => p.status === 'active') || ps[0];
  if ($('homeResume')) {
    $('homeResume').innerHTML = resume ? `<div class="card"><h3>Resume</h3><div class="inv-card" data-resume="${esc(resume.id)}">${resume.thumbnail ? `<img src="${esc(imgSrc(resume.thumbnail))}" alt="">` : ''}<div class="body"><b>${esc(resume.name)}</b><div class="subtle">${esc(subjectLabel(resume.entityType))} · ${esc(adultLabel(resume.adultContent || 'off'))} · ${esc(resume.status || 'active')} · ${esc(resume.lastActivityAt ? new Date(resume.lastActivityAt).toLocaleString() : '')}</div><button class="btn primary" data-resume="${esc(resume.id)}" style="margin-top:8px">Resume investigation</button></div></div></div>` : '';
  }
  $('homeRecent').innerHTML = ps.slice(0, 4).map(p => `<div class="inv-card" data-resume="${esc(p.id)}">${p.thumbnail ? `<img src="${esc(imgSrc(p.thumbnail))}" alt="">` : ''}<div class="body"><b>${esc(p.name)}</b><div class="subtle">${esc(subjectLabel(p.entityType))} · ${esc(p.status || 'active')}</div></div></div>`).join('') || '<p class="empty">No saved investigations yet. Search, then Deep Dive or Keep to persist one.</p>';
}

async function renderInvestigations() {
  if (!$('investigationList')) return;
  const ps = (await all('projects')).filter(p => p.status !== 'scratch');
  const f = invFilter;
  const list = ps.filter(p => f === 'all' || (p.status || 'active') === f).sort((a, b) => String(b.lastActivityAt || b.updatedAt || '').localeCompare(String(a.lastActivityAt || a.updatedAt || '')));
  $('investigationList').innerHTML = list.map(p => `<div class="inv-card">
    ${p.thumbnail ? `<img src="${esc(imgSrc(p.thumbnail))}" alt="">` : ''}
    <div class="body">
      <b>${esc(p.name)}</b>
      <div class="subtle">${esc(subjectLabel(p.entityType))} · ${esc(adultLabel(p.adultContent || 'off'))} · ${esc(p.status || 'active')} · ${esc(p.lastActivityAt ? new Date(p.lastActivityAt).toLocaleString() : '')}${p.parentId ? ' · branched' : ''}${p.relation ? ' · ' + esc(p.relation) : ''}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn primary" data-resume="${esc(p.id)}">Resume</button>
        <button class="btn" data-invstat="paused" data-id="${esc(p.id)}">Pause</button>
        <button class="btn" data-invstat="completed" data-id="${esc(p.id)}">Complete</button>
      </div>
    </div>
  </div>`).join('') || '<p class="empty">Investigations appear here after you Keep a search or run Deep Dive.</p>';
  const cur = ps.find(p => p.id === currentProjectId);
  if ($('projectMeta')) $('projectMeta').textContent = cur ? `${cur.name} · ${cur.status} · notes stay on this phone.` : 'No investigation selected.';
  if ($('appSub') && cur) $('appSub').textContent = cur.name;
}

async function resumeInvestigation(id) {
  currentProjectId = id;
  sessionBoundProject = true;
  localStorage.setItem('carmen_current_project_v39', id);
  const p = (await all('projects')).find(x => x.id === id);
  if (p && $('projectInstructions')) $('projectInstructions').value = p.instructions || '';
  if (p && $('projectQuestion')) $('projectQuestion').value = p.question || p.query || '';
  if (p && p.adultContent) setAdult(p.adultContent, { silent: true });
  if (p && p.researchDepth) setDepth(p.researchDepth, { silent: true });
  await loadDiscovery();
  setTab('search');
  toast('Resumed ' + (p?.name || 'investigation'));
}

async function branchInvestigation(rel) {
  if (!rel || !rel.label) return toast('Nothing to branch into.');
  const parentId = currentProjectId;
  const parentName = (await all('projects')).find(x => x.id === parentId)?.name || '';
  sessionBoundProject = false;
  currentProjectId = null;
  $('searchQuery').value = rel.label;
  if (rel.kind && ['person', 'technique', 'product', 'place', 'skill', 'organization', 'website'].includes(String(rel.kind).toLowerCase())) {
    currentSubject = String(rel.kind).toLowerCase();
    document.querySelectorAll('#subjectChips .chip').forEach(x => x.classList.toggle('active', x.dataset.subject === currentSubject));
  }
  const p = await keepInvestigation(rel.label);
  p.parentId = parentId;
  p.relation = rel.kind || 'related';
  p.relatedFrom = parentName;
  p.query = rel.label;
  p.adultContent = currentAdult;
  await put('projects', p);
  await put('events', { id: 'evt_' + crypto.randomUUID(), projectId: p.id, type: 'branched', at: new Date().toISOString(), parentId, label: rel.label, kind: rel.kind || '' });
  setTab('search');
  toast('Branched into “' + rel.label + '” without discarding the original investigation.');
  await discover();
}

async function renderCollections() {
  if (!$('collectionList')) return;
  const cols = await all('collections');
  const items = await all('collectionItems');
  cols.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  $('collectionList').innerHTML = cols.map(c => {
    const n = items.filter(i => (i.collectionIds || []).includes(c.id)).length;
    const thumb = items.find(i => (i.collectionIds || []).includes(c.id) && i.image);
    return `<div class="col-card" data-open-col="${esc(c.id)}">${thumb ? `<img src="${esc(imgSrc(thumb.image))}" alt="">` : ''}<div class="body"><b>${esc(c.name)}</b><div class="subtle">${n} item${n === 1 ? '' : 's'}</div></div></div>`;
  }).join('') || '<p class="empty">No collections yet. Save a result or image explicitly.</p>';
  if (openCollectionId) await renderCollectionDetail(openCollectionId);
  else if ($('collectionDetail')) $('collectionDetail').innerHTML = '';
}

async function renderCollectionDetail(id) {
  openCollectionId = id;
  const cols = await all('collections');
  const c = cols.find(x => x.id === id);
  if (!c) { $('collectionDetail').innerHTML = ''; return; }
  const items = (await all('collectionItems')).filter(i => (i.collectionIds || []).includes(id));
  $('collectionDetail').innerHTML = `<div class="card"><h3>${esc(c.name)}</h3>
    <div class="row"><button class="btn" data-rename-col="${esc(id)}">Rename</button><button class="btn danger" data-del-col="${esc(id)}">Delete collection</button></div>
    ${items.map(it => `<div class="inv-card">${it.image ? `<img src="${esc(imgSrc(it.image))}" data-full="${esc(imgSrc(it.image))}" data-cap="${esc((it.domain || '') + ' · ' + (it.sourceUrl || it.url || ''))}" alt="">` : ''}<div class="body"><b>${esc(it.title || it.url)}</b><div class="subtle">${esc(it.kind)} · ${esc(it.domain || '')} · ${esc(it.createdAt ? new Date(it.createdAt).toLocaleString() : '')}</div><div class="row" style="margin-top:8px"><button class="btn" data-open-item="${esc(it.url || '')}">Open</button><button class="btn" data-move-item="${esc(it.id)}">Move</button><button class="btn" data-remove-item="${esc(it.id)}">Remove</button></div></div></div>`).join('') || '<p class="muted">Empty collection.</p>'}
  </div>`;
}

async function openSaveSheet(item) {
  pendingSaveItem = item;
  const cols = await all('collections');
  $('saveSheetList').innerHTML = cols.map(c => `<label class="refitem"><input type="checkbox" data-col="${esc(c.id)}"><span>${esc(c.name)}</span></label>`).join('') || '<p class="muted">Create a collection below.</p>';
  $('saveSheet').classList.remove('hidden');
}

async function confirmSaveSheet() {
  if (!pendingSaveItem) return;
  let ids = [...document.querySelectorAll('#saveSheetList input:checked')].map(x => x.dataset.col);
  const newName = $('saveSheetNew').value.trim();
  if (newName) {
    const c = { id: 'col_' + crypto.randomUUID(), name: newName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await put('collections', c);
    ids.push(c.id);
  }
  if (!ids.length) return toast('Choose or create a collection.');
  if (pendingSaveItem._moveId) {
    const existing = (await all('collectionItems')).find(x => x.id === pendingSaveItem._moveId);
    if (existing) {
      existing.collectionIds = [...new Set(ids)];
      await put('collectionItems', existing);
    }
    $('saveSheet').classList.add('hidden');
    $('saveSheetNew').value = '';
    pendingSaveItem = null;
    toast('Moved. The item can belong to more than one collection.');
    await renderCollections();
    if (openCollectionId) await renderCollectionDetail(openCollectionId);
    return;
  }
  const item = {
    id: 'ci_' + crypto.randomUUID(),
    collectionIds: ids,
    kind: pendingSaveItem.kind || 'page',
    url: pendingSaveItem.url || '',
    title: pendingSaveItem.title || pendingSaveItem.url || 'Saved item',
    image: pendingSaveItem.image || '',
    sourceUrl: pendingSaveItem.sourceUrl || pendingSaveItem.url || '',
    domain: pendingSaveItem.domain || hostOf(pendingSaveItem.url || pendingSaveItem.sourceUrl || ''),
    note: pendingSaveItem.note || '',
    provenance: pendingSaveItem.provenance || 'DISCOVERED',
    createdAt: new Date().toISOString(),
  };
  await put('collectionItems', item);
  $('saveSheet').classList.add('hidden');
  $('saveSheetNew').value = '';
  pendingSaveItem = null;
  toast('Saved to collection. Carmen did not save anything automatically.');
  await renderCollections();
}

async function runLearn() {
  const q = $('learnQuery').value.trim();
  if (!q) return toast('Enter something to learn.');
  const base = backendUrl();
  if (!base) return toast('Backend is not set.');
  $('learnBtn').disabled = true;
  $('learnResult').innerHTML = '<div class="skeleton"></div><p class="muted">Researching public sources, then writing a conservative brief…</p>';
  try {
    const r = await fetch(base + '/learn', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: q, type: currentLearnType, adult: currentAdult, adultContent: currentAdult }),
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { throw Error(text || `HTTP ${r.status}`); }
    if (!r.ok || data.error) throw Error(data.error || `HTTP ${r.status}`);
    lastPaths = data.paths || [];
    renderPathChips(lastPaths, 'learnPaths');
    const imgs = (data.images || []).slice(0, 12);
    const imgHtml = imgs.length ? `<div class="gallery">${imgs.map(im => `<img src="${esc(imgSrc(im.url || im))}" data-full="${esc(imgSrc(im.url || im))}" data-cap="${esc([im.reason || im.caption, im.domain, im.pageUrl || ''].filter(Boolean).join(' · '))}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">`).join('')}</div>` : '';
    const sources = (data.retrieved || []).map(x => `<div class="pattern"><b>${esc(x.title || x.url)}</b> ${provenanceBadge(x.status)}<br><small>${esc(x.finalUrl || x.url || '')}${x.error ? ' · ' + esc(x.error) : ''}</small></div>`).join('');
    const lesson = data.lesson || data.analysis || '';
    $('learnResult').innerHTML = `<div class="card">
      <span class="badge">${esc(subjectLabel(data.classification?.type))}</span> ${adultBadge(data.adultContent || currentAdult)}
      <p class="hint">${esc(data.classification?.reason || '')}${data.classification?.context ? ' · context: ' + esc(data.classification.context) : ''}</p>
      ${imgHtml}
      ${lesson ? renderAdaptiveWriteup(lesson, lastPaths, q) : (data.analysisError ? `<div class="claim unknown">${esc(data.analysisError)}</div>` : '')}
      <h4>Sources</h4>${sources || '<p class="muted">No retrieved pages.</p>'}
      <p class="hint">${esc(data.safety || '')}</p>
      <button class="btn" id="learnSave">Save this brief to a collection</button>
    </div>`;
    $('learnSave').onclick = () => openSaveSheet({ kind: 'tutorial', title: q, url: '', note: String(lesson).slice(0, 500), image: imgs[0]?.url || '' });
  } catch (e) {
    $('learnResult').innerHTML = `<div class="claim unknown"><b>Learn unavailable</b><br>${esc(e.message)}</div>`;
  } finally { $('learnBtn').disabled = false; }
}

/* ---------- event wiring ---------- */
function wire() {
  $('navHome').onclick = () => setTab('home');
  $('navSearch').onclick = () => setTab('search');
  $('navCollections').onclick = () => setTab('collections');
  $('navInvestigations').onclick = () => setTab('investigations');
  $('navLearn').onclick = () => setTab('learn');
  $('homeSearchBtn').onclick = () => {
    sessionBoundProject = false;
    currentProjectId = null;
    $('searchQuery').value = $('homeQuery').value.trim();
    setTab('search');
    if ($('searchQuery').value) discover();
  };
  $('homeQuery').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('homeSearchBtn').click(); } });
  document.body.addEventListener('click', e => {
    const resume = e.target.closest('[data-resume]');
    if (resume) { e.preventDefault(); resumeInvestigation(resume.dataset.resume); }
  });
  $('quickDiscover').onclick = () => setTab('search');
  $('quickCapture').onclick = () => { setTab('investigations'); $('pick').click(); };
  $('quickArchive').onclick = () => setTab('investigations');
  $('quickLeads').onclick = () => setTab('investigations');

  // projects
  $('projectSelect').onchange = async () => {
    currentProjectId = $('projectSelect').value;
    sessionBoundProject = !!currentProjectId;
    const ps = await all('projects');
    $('projectQuestion').value = ps.find(p => p.id === currentProjectId)?.question || '';
    await loadDiscovery();
    await refresh();
  };
  $('newProject').onclick = async () => {
    const name = prompt('Name this investigation:', 'New investigation');
    if (!name?.trim()) return;
    const p = { id: 'project_' + crypto.randomUUID(), name: name.trim(), question: '', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString() };
    await put('projects', p);
    currentProjectId = p.id;
    sessionBoundProject = true;
    renderProjects(await all('projects'));
    $('projectQuestion').value = '';
    await refresh();
    toast('Investigation created.');
  };
  $('renameProject').onclick = async () => {
    const ps = await all('projects'), p = ps.find(x => x.id === currentProjectId);
    if (!p) return;
    const name = prompt('Rename investigation:', p.name);
    if (!name?.trim()) return;
    p.name = name.trim(); p.updatedAt = new Date().toISOString();
    await put('projects', p);
    renderProjects(await all('projects'));
    toast('Investigation renamed.');
  };
  $('saveProjectQuestion').onclick = async () => {
    const ps = await all('projects'), p = ps.find(x => x.id === currentProjectId);
    if (!p) return;
    p.question = $('projectQuestion').value.trim();
    const prevInst = p.instructions || '';
    p.instructions = ($('projectInstructions') && $('projectInstructions').value.trim()) || '';
    p.updatedAt = new Date().toISOString();
    await put('projects', p);
    if (p.instructions !== prevInst) {
      await put('events', { id: 'evt_' + crypto.randomUUID(), projectId: currentProjectId, type: 'instructions_changed', at: p.updatedAt });
    }
    toast('Investigation saved.');
  };

  // subject chips
  $('subjectChips').onclick = e => {
    const c = e.target.closest('.chip'); if (!c) return;
    document.querySelectorAll('#subjectChips .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    currentSubject = c.dataset.subject;
    const q = $('searchQuery'); q.placeholder = subjectQueryHint(currentSubject) || 'Describe what to investigate.';
  };
  const wireAdult = id => {
    const el = $(id);
    if (!el) return;
    el.onclick = e => {
      const c = e.target.closest('[data-adult]');
      if (!c) return;
      setAdult(c.dataset.adult);
    };
  };
  wireAdult('adultChips');
  wireAdult('homeAdultChips');
  if ($('depthChips')) $('depthChips').onclick = e => {
    const c = e.target.closest('[data-depth]');
    if (!c) return;
    setDepth(c.dataset.depth);
  };

  // discovery
  $('searchQuery').addEventListener('input', updateDeepDiveState);
  $('searchQuery').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); discover(); } });
  $('discoverBtn').onclick = discover;
  if ($('expandedBtn')) $('expandedBtn').onclick = () => discover({ expanded: true });
  $('deepDiveBtn').onclick = () => openPlannerFromButton();
  if ($('startDiveBtn')) $('startDiveBtn').onclick = runDeepDive;
  if ($('cancelDiveBtn')) $('cancelDiveBtn').onclick = () => $('divePlanner')?.classList.add('hidden');
  if ($('diveSelectChips')) $('diveSelectChips').onclick = e => {
    const all = e.target.closest('[data-diveall]');
    if (all) { toggleDivePath('all'); return; }
    const p = e.target.closest('[data-divepath]');
    if (p) toggleDivePath(p.dataset.divepath);
  };
  $('keepBtn').onclick = async () => {
    const p = await keepInvestigation();
    toast(p ? 'Investigation kept on this phone.' : 'Nothing to keep yet.');
    await refresh();
  };
  $('addQueueBtn').onclick = () => { setTab('investigations'); $('queueUrl').focus(); };
  if ($('lightboxClose')) $('lightboxClose').onclick = closeLightbox;
  if ($('lightboxPrev')) $('lightboxPrev').onclick = () => lightboxStep(-1);
  if ($('lightboxNext')) $('lightboxNext').onclick = () => lightboxStep(1);
  if ($('lightboxSource')) $('lightboxSource').onclick = () => { if (lightboxSourceUrl) window.open(lightboxSourceUrl, '_blank', 'noopener,noreferrer'); };
  if ($('lightbox')) $('lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') closeLightbox(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeLightbox(); $('saveSheet')?.classList.add('hidden'); }
    if (!$('lightbox')?.classList.contains('hidden')) {
      if (e.key === 'ArrowLeft') lightboxStep(-1);
      if (e.key === 'ArrowRight') lightboxStep(1);
    }
  });
  if ($('homeImageBtn')) $('homeImageBtn').onclick = () => $('homeImage')?.click();
  if ($('homeImage')) $('homeImage').onchange = async () => {
    const f = $('homeImage').files?.[0];
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) return toast('Image is too large. Choose one under 12 MB.');
    const rd = new FileReader();
    rd.onload = async () => {
      current = rd.result;
      showCurrent();
      enableCapture();
      const name = String(f.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
      $('searchQuery').value = name;
      $('homeQuery').value = name;
      setTab('search');
      toast('Image loaded on this phone. Analyze it in Investigate, or search the name/context.');
    };
    rd.readAsDataURL(f);
  };
  $('createCollection').onclick = async () => {
    const name = $('newCollectionName').value.trim();
    if (!name) return toast('Name the collection first.');
    await put('collections', { id: 'col_' + crypto.randomUUID(), name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    $('newCollectionName').value = '';
    await renderCollections();
    toast('Collection created. Nothing else was saved.');
  };
  $('saveSheetConfirm').onclick = confirmSaveSheet;
  $('saveSheetCancel').onclick = () => { $('saveSheet').classList.add('hidden'); pendingSaveItem = null; };
  $('learnBtn').onclick = runLearn;
  $('learnChips').onclick = e => {
    const c = e.target.closest('.chip'); if (!c) return;
    document.querySelectorAll('#learnChips .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    currentLearnType = c.dataset.learn || '';
  };
  $('invFilter').onclick = e => {
    const c = e.target.closest('.chip'); if (!c) return;
    document.querySelectorAll('#invFilter .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    invFilter = c.dataset.inv || 'all';
    renderInvestigations();
  };
  function wirePathChips(elId) {
    const el = $(elId);
    if (!el) return;
    el.onclick = e => {
      const c = e.target.closest('[data-path]');
      if (!c) return;
      el.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c));
      const target = document.getElementById('path-' + c.dataset.path);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }
  wirePathChips('divePaths');
  wirePathChips('learnPaths');
  $('investigationList').addEventListener('click', async e => {
    const st = e.target.closest('[data-invstat]');
    if (!st) return;
    const p = (await all('projects')).find(x => x.id === st.dataset.id);
    if (!p) return;
    p.status = st.dataset.invstat;
    p.updatedAt = new Date().toISOString();
    await put('projects', p);
    await renderInvestigations();
  });
  $('collectionList').addEventListener('click', e => {
    const open = e.target.closest('[data-open-col]');
    if (open) renderCollectionDetail(open.dataset.openCol);
  });
  $('collectionDetail').addEventListener('click', async e => {
    const full = e.target.closest('img[data-full]');
    if (full) { openLightbox(full.dataset.full, full.dataset.cap || ''); return; }
    const rn = e.target.closest('[data-rename-col]');
    if (rn) {
      const cols = await all('collections');
      const c = cols.find(x => x.id === rn.dataset.renameCol);
      const name = prompt('Rename collection:', c?.name || '');
      if (!name?.trim() || !c) return;
      c.name = name.trim(); c.updatedAt = new Date().toISOString();
      await put('collections', c);
      await renderCollections();
    }
    const delc = e.target.closest('[data-del-col]');
    if (delc && confirm('Delete this collection? Items are removed from it, not from other collections.')) {
      const items = await all('collectionItems');
      for (const it of items) {
        it.collectionIds = (it.collectionIds || []).filter(id => id !== delc.dataset.delCol);
        if (it.collectionIds.length) await put('collectionItems', it);
        else await del('collectionItems', it.id);
      }
      await del('collections', delc.dataset.delCol);
      openCollectionId = null;
      await renderCollections();
    }
    const rm = e.target.closest('[data-remove-item]');
    if (rm) {
      const items = await all('collectionItems');
      const it = items.find(x => x.id === rm.dataset.removeItem);
      if (!it) return;
      it.collectionIds = (it.collectionIds || []).filter(id => id !== openCollectionId);
      if (it.collectionIds.length) await put('collectionItems', it);
      else await del('collectionItems', it.id);
      await renderCollectionDetail(openCollectionId);
    }
    const op = e.target.closest('[data-open-item]');
    if (op && op.dataset.openItem) window.open(op.dataset.openItem, '_blank', 'noopener,noreferrer');
    const mv = e.target.closest('[data-move-item]');
    if (mv) {
      const items = await all('collectionItems');
      const it = items.find(x => x.id === mv.dataset.moveItem);
      if (!it) return;
      pendingSaveItem = { ...it, _moveId: it.id };
      const cols = await all('collections');
      $('saveSheetList').innerHTML = cols.map(c => `<label class="refitem"><input type="checkbox" data-col="${esc(c.id)}"${(it.collectionIds || []).includes(c.id) ? ' checked' : ''}><span>${esc(c.name)}</span></label>`).join('') || '<p class="muted">Create a collection below.</p>';
      $('saveSheet').classList.remove('hidden');
    }
  });
  $('deepDiveResult').addEventListener('click', e => {
    if (e.target.closest('[data-expand-dive]')) {
      if ($('diveExpanded')) $('diveExpanded').checked = true;
      expandedMode = true;
      runDeepDive();
      return;
    }
    const tab = e.target.closest('[data-wstab]');
    if (tab && lastDivePayload) {
      diveWorkspaceTab = tab.dataset.wstab;
      renderDiveWorkspace(lastDivePayload, lastDivePayload.query || lastDivePayload.plan?.subject || '');
      return;
    }
    const g = e.target.closest('img[data-g]');
    if (g) {
      const gallery = lastDivePayload?._gallery || (lastDivePayload?.images || []).map(im => ({ src: imgSrc(im.url || im), cap: [im.reason || im.caption, im.domain, im.pageUrl || im.url].filter(Boolean).join(' · '), pageUrl: im.pageUrl || im.url || '' }));
      openLightbox(g.src, g.dataset.cap || '', gallery, Number(g.dataset.g) || 0);
      return;
    }
    const full = e.target.closest('img[data-full]');
    if (full) { openLightbox(full.dataset.full, full.dataset.cap || '', null, 0, full.dataset.cap); return; }
    const br = e.target.closest('[data-branch]');
    if (br && lastDivePayload?.related) {
      branchInvestigation(lastDivePayload.related[+br.dataset.branch]);
      return;
    }
    const sv = e.target.closest('[data-save-video]');
    if (sv) {
      openSaveSheet({ kind: 'video', title: sv.dataset.title || 'Video', url: sv.dataset.saveVideo, image: sv.dataset.thumb || '', sourceUrl: sv.dataset.saveVideo, domain: hostOf(sv.dataset.saveVideo) });
      return;
    }
    if (e.target.closest('[data-save-images]')) {
      const imgs = (lastDivePayload && lastDivePayload.images) || [];
      const first = imgs[0] || {};
      openSaveSheet({
        kind: 'image',
        title: (selectedCandidate?.title || lastDivePayload?.plan?.subject || 'Visual sources') + (imgs.length > 1 ? ` (${imgs.length} images)` : ''),
        url: first.pageUrl || selectedCandidate?.url || '',
        image: first.url || selectedCandidate?.image || '',
        sourceUrl: first.pageUrl || selectedCandidate?.url || '',
        domain: first.domain || selectedCandidate?.domain || '',
        provenance: 'RETRIEVED',
        note: imgs.map(im => (im.pageUrl || im.url || '')).filter(Boolean).slice(0, 8).join('\n'),
      });
    }
  });
  $('learnResult').addEventListener('click', e => {
    const full = e.target.closest('img[data-full]');
    if (full) openLightbox(full.dataset.full, full.dataset.cap || '');
  });
  $('results').onclick = async e => {
    const full = e.target.closest('img[data-full], img.hero');
    if (full && (full.dataset.full || full.src) && e.target.closest('img') && !e.target.closest('[data-ract]')) {
      const card = e.target.closest('.result');
      const r = card ? lastResults[+card.dataset.i] : null;
      const imgs = r ? [...new Set([r.image, ...(r.images || [])].filter(Boolean))].map(u => ({ src: imgSrc(u), cap: (r.domain || '') + ' · ' + (r.url || ''), pageUrl: r.url })) : [{ src: full.dataset.full || full.src, cap: full.dataset.cap || '', pageUrl: '' }];
      const idx = Math.max(0, imgs.findIndex(x => x.src === (full.dataset.full || full.src)));
      e.stopPropagation();
      openLightbox(full.dataset.full || full.src, full.dataset.cap || '', imgs, idx);
      return;
    }
    const b = e.target.closest('[data-ract]');
    if (!b) {
      if (e.target.closest('a')) return;
      const card = e.target.closest('.result');
      if (!card) return;
      const r = lastResults[+card.dataset.i]; if (!r) return;
      selectCandidate(r, +card.dataset.i);
      return;
    }
    const r = lastResults[+b.dataset.i]; if (!r) return;
    const act = b.dataset.ract;
    if (act === 'select') { selectCandidate(r, +b.dataset.i); }
    else if (act === 'open') { window.open(r.url, '_blank', 'noopener,noreferrer'); }
    else if (act === 'evidence') { await saveResultAsEvidence(r); }
    else if (act === 'save') { await openSaveSheet({ kind: 'page', title: r.title, url: r.url, image: r.image, domain: r.domain, provenance: r.provenance, sourceUrl: r.url }); }
    else if (act === 'queue') { await queueFromResult(r); }
    else if (act === 'dive') { selectCandidate(r, +b.dataset.i); }
  };

  // queue
  $('queueAdd').onclick = addQueue;
  $('queueFilter').onchange = async () => renderQueue((await all('queue')).filter(q => q.projectId === currentProjectId));
  $('queueList').onclick = async e => {
    const b = e.target.closest('[data-queue]'); if (!b) return;
    const id = b.dataset.id, act = b.dataset.queue;
    const qs = await all('queue'), q = qs.find(x => x.id === id); if (!q) return;
    if (act === 'open') { window.open(q.url, '_blank', 'noopener,noreferrer'); return; }
    if (act === 'done') { q.status = q.status === 'completed' ? 'queued' : 'completed'; q.updatedAt = new Date().toISOString(); await put('queue', q); }
    if (act === 'delete') { if (!confirm('Remove this research item from the queue?')) return; await del('queue', id); }
    await refresh();
  };

  // leads
  $('leadFilter').onchange = applyLeadFilter;
  $('showNewLeads').onclick = () => { setTab('leads'); $('leadFilter').value = 'new'; applyLeadFilter(); };
  $('leadList').onclick = async e => {
    const b = e.target.closest('[data-lead-action]'); if (!b) return;
    const id = b.dataset.id, action = b.dataset.leadAction;
    const leads = await all('leads'), l = leads.find(x => x.id === id); if (!l) return;
    if (action === 'review') await updateLead(id, { status: l.status === 'reviewed' ? 'new' : 'reviewed' });
    if (action === 'dismiss') await updateLead(id, { status: 'dismissed' });
    if (action === 'question') { $('searchQuery').value = l.text; setTab('search'); toast('Lead copied into the discovery query.'); }
  };

  // browser / capture
  $('go').onclick = () => navigate($('url').value);
  $('url').addEventListener('keydown', e => { if (e.key === 'Enter') $('go').click(); });
  $('back').onclick = () => { if (historyIndex > 0) { historyIndex--; navigate(historyStack[historyIndex], false); } };
  $('forward').onclick = () => { if (historyIndex < historyStack.length - 1) { historyIndex++; navigate(historyStack[historyIndex], false); } };
  $('reload').onclick = () => { $('webview').src = $('webview').src; };
  $('openExternal').onclick = () => { const u = normalizeUrl($('url').value); if (u) location.href = u; };
  $('pick').onclick = () => $('file').click();
  $('file').onchange = () => {
    const f = $('file').files?.[0]; if (!f) return;
    if (f.size > 12 * 1024 * 1024) return toast('Screenshot is too large. Choose one under 12 MB.');
    const rd = new FileReader();
    rd.onload = () => { current = rd.result; showCurrent(); enableCapture(); setTab('capture'); toast('Screenshot loaded.'); };
    rd.readAsDataURL(f);
  };
  $('start').onclick = async () => {
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw Error('Screen capture is not available here. Use Choose screenshot.');
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
      $('preview').srcObject = stream; $('preview').classList.remove('hidden');
      $('start').disabled = true; $('snap').disabled = false; $('stop').disabled = false;
      stream.getVideoTracks()[0].onended = stop;
    } catch (e) { toast(e.message); }
  };
  function stop() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    $('preview').srcObject = null; $('preview').classList.add('hidden');
    $('start').disabled = false; $('snap').disabled = true; $('stop').disabled = true;
  }
  $('stop').onclick = stop;
  $('snap').onclick = () => {
    const v = $('preview'), c = $('canvas');
    const w = Math.min(v.videoWidth || 1280, 1600), h = Math.round(w * (v.videoHeight || 720) / (v.videoWidth || 1280));
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    current = c.toDataURL('image/jpeg', 0.82);
    showCurrent(); enableCapture(); setTab('capture'); toast('Frame captured.');
  };
  $('save').onclick = async () => { if (!current) return toast('Choose or capture a screenshot first.'); await saveReference(); toast('Saved to this investigation.'); };
  $('analyze').onclick = async () => {
    if (!current) return;
    const url = backendUrl(); if (!url) return toast('Enter the Worker URL first.');
    localStorage.setItem(BACKEND_KEY, url);
    $('status').textContent = 'Carmen is analyzing…'; $('analyze').disabled = true;
    try {
      const r = await fetch(url + '/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageDataUrl: current, pageContext: $('context').value, pageUrl: currentUrl(), sourceType: currentSourceType(), sourceName: $('sourceName').value.trim() }) });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { throw Error(text || `HTTP ${r.status}`); }
      if (!r.ok || data.error) throw Error(data.error || `HTTP ${r.status}`);
      renderAnalysis(data);
      await saveReference('iphone-screenshot+vision', data);
      toast('Analyzed and archived.');
    } catch (e) {
      $('status').textContent = 'Analysis failed';
      $('result').innerHTML = `<p class="muted">Analysis failed: ${esc(e.message)}</p><p class="hint">AI analysis requires the API_KEY Worker secret to be configured.</p>`;
      toast(e.message);
    } finally { $('analyze').disabled = false; $('status').textContent = 'Local archive works without a connection.'; }
  };

  // connection
  $('health').onclick = async () => {
    const u = backendUrl(); if (!u) return toast('Enter Worker URL.');
    localStorage.setItem(BACKEND_KEY, u);
    try {
      const r = await fetch(u + '/health'); const j = await r.json();
      if (!r.ok || !j.ok) throw Error(j.error || `HTTP ${r.status}`);
      const aiReady = j.configured === true || j.provider === 'configured';
      $('status').textContent = `Connected · ${j.model || 'model'} · ${aiReady ? 'AI configured' : 'AI not configured'} · ${j.searchProviders?.length || 0} search providers`;
      toast(aiReady ? 'Carmen backend connected (AI ready).' : 'Backend connected, but AI is not configured.');
    } catch (e) { $('status').textContent = 'Connection failed'; toast('Could not reach Worker: ' + e.message); }
  };

  // compare / synthesize
  $('compare').onclick = async () => {
    const ids = [...document.querySelectorAll('.refcheck:checked')].map(x => x.value);
    if (ids.length < 2) return toast('Select at least 2 references.');
    if (ids.length > 4) return toast('Select no more than 4 references.');
    const refs = await all('refs'), selected = refs.filter(r => ids.includes(r.id));
    const url = backendUrl(); if (!url) return toast('Enter the Worker URL first.');
    $('compare').disabled = true;
    $('compareResult').innerHTML = '<p class="muted">Carmen is comparing the selected evidence…</p>';
    try {
      const r = await fetch(url + '/synthesize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: $('researchQuestion').value || $('projectQuestion').value, references: selected }) });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { throw Error(text || `HTTP ${r.status}`); }
      if (!r.ok || data.error) throw Error(data.error || `HTTP ${r.status}`);
      $('compareResult').innerHTML = `<div class="claim"><b>Summary</b><br>${esc(data.summary || '')}</div>
        <div class="claim"><b>Consistent findings</b> <span class="badge observed">OBSERVED</span><br>${list(data.consistentFindings)}</div>
        <div class="claim inferred"><b>Differences</b><br>${list(data.differences)}</div>
        <div class="claim"><b>Candidate patterns</b><br>${list(data.candidatePatterns)}</div>
        <div class="claim"><b>Leads</b><br>${list(data.leads)}</div>
        <div class="claim unknown"><b>Unknowns</b> <span class="badge unknown">UNKNOWN</span><br>${list(data.unknowns)}</div>`;
      for (const raw of (data.leads || [])) {
        const text = String(raw.text || raw).trim();
        if (text) await put('leads', { id: 'lead_' + crypto.randomUUID(), projectId: currentProjectId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), text, status: 'new', refIds: ids, question: $('researchQuestion').value || $('projectQuestion').value });
      }
      await put('events', { id: 'evt_' + crypto.randomUUID(), projectId: currentProjectId, type: 'evidence_synthesis', at: new Date().toISOString(), refIds: ids, question: $('researchQuestion').value || $('projectQuestion').value });
      await refresh();
      toast('Comparison complete.');
    } catch (e) {
      $('compareResult').innerHTML = `<p class="muted">Comparison failed: ${esc(e.message)}</p><p class="hint">AI synthesis requires the API_KEY Worker secret to be configured.</p>`;
      toast(e.message);
    } finally { $('compare').disabled = false; }
  };

  // archive selection / search
  $('selectAll').onclick = () => document.querySelectorAll('.refcheck').forEach(x => x.checked = true);
  $('clearSelect').onclick = () => document.querySelectorAll('.refcheck').forEach(x => x.checked = false);
  $('archiveSearch').oninput = async () => renderArchive((await all('refs')).filter(r => r.projectId === currentProjectId));

  // backup / restore
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async () => {
    const f = $('importFile').files?.[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || !Array.isArray(data.references)) throw Error('That file is not a Carmen archive.');
      for (const r of data.references) { if (r.id && !(await all('refs')).some(x => x.id === r.id)) await put('refs', { ...r, projectId: currentProjectId }); }
      for (const l of (data.leads || [])) { if (l.id && !(await all('leads')).some(x => x.id === l.id)) await put('leads', { ...l, projectId: currentProjectId }); }
      for (const q of (data.queue || [])) { if (q.id && !(await all('queue')).some(x => x.id === q.id)) await put('queue', { ...q, projectId: currentProjectId }); }
      for (const e of (data.events || [])) { if (e.id && !(await all('events')).some(x => x.id === e.id)) await put('events', { ...e, projectId: currentProjectId }); }
      for (const d of (data.discoveries || [])) { if (d.id && !(await all('discoveries')).some(x => x.id === d.id)) await put('discoveries', { ...d, projectId: currentProjectId }); }
      for (const c of (data.collections || [])) { if (c.id && !(await all('collections')).some(x => x.id === c.id)) await put('collections', c); }
      for (const it of (data.collectionItems || [])) { if (it.id && !(await all('collectionItems')).some(x => x.id === it.id)) await put('collectionItems', it); }
      await refresh();
      toast('Archive imported into this investigation.');
    } catch (e) { toast('Import failed: ' + e.message); }
    finally { $('importFile').value = ''; }
  };
  $('export').onclick = async () => {
    const payload = {
      version: Number(VERSION), schema: 'carmen-v36', exportedAt: new Date().toISOString(),
      project: (await all('projects')).find(p => p.id === currentProjectId),
      references: (await all('refs')).filter(r => r.projectId === currentProjectId),
      leads: (await all('leads')).filter(l => l.projectId === currentProjectId),
      events: (await all('events')).filter(e => e.projectId === currentProjectId),
      queue: (await all('queue')).filter(q => q.projectId === currentProjectId),
      discoveries: (await all('discoveries')).filter(d => d.projectId === currentProjectId),
      collections: await all('collections'),
      collectionItems: await all('collectionItems'),
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    a.download = `carmen-${currentProjectId}-archive.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('clear').onclick = async () => {
    if (!confirm('Clear this investigation archive?')) return;
    const refs = (await all('refs')).filter(r => r.projectId === currentProjectId);
    const events = (await all('events')).filter(e => e.projectId === currentProjectId);
    const leads = (await all('leads')).filter(l => l.projectId === currentProjectId);
    const queue = (await all('queue')).filter(q => q.projectId === currentProjectId);
    const disc = (await all('discoveries')).filter(d => d.projectId === currentProjectId);
    for (const r of refs) await del('refs', r.id);
    for (const e of events) await del('events', e.id);
    for (const l of leads) await del('leads', l.id);
    for (const q of queue) await del('queue', q.id);
    for (const d of disc) await del('discoveries', d.id);
    await refresh();
    toast('Investigation archive cleared.');
  };

  // install prompt
  let deferred;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('install').classList.remove('hidden'); });
  $('install').onclick = async () => { if (deferred) { deferred.prompt(); deferred = null; } };
}

function applyLeadFilter() {
  const f = $('leadFilter')?.value; if (!f) return;
  document.querySelectorAll('#leadList .lead').forEach(x => {
    const badge = x.querySelector('.badge');
    x.classList.toggle('hidden', f !== 'all' && badge?.textContent !== f);
  });
}

/* ---------- load saved discovery for current project ---------- */
async function loadDiscovery() {
  const disc = (await all('discoveries')).find(d => d.id === currentProjectId) || (await all('discoveries')).filter(d => d.projectId === currentProjectId).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0];
  if (!disc) {
    lastResults = [];
    selectedCandidate = null;
    $('results').innerHTML = '';
    $('resultCount').textContent = '';
    $('resultsEmpty').textContent = 'Run discovery to see ranked public candidates. Each card keeps images, provenance, a match reason, and a Deep Dive action.';
    $('resultsEmpty').classList.remove('hidden');
    $('searchDiagnostics').innerHTML = '';
    if ($('classBar')) $('classBar').innerHTML = '';
    if ($('selectedBanner')) $('selectedBanner').innerHTML = '';
    $('deepDiveResult').innerHTML = '';
    if ($('deepDiveProgress')) $('deepDiveProgress').innerHTML = '';
    updateDeepDiveState();
    return;
  }
  lastResults = disc.results || [];
  lastClassification = disc.classification || null;
  if (disc.subject) {
    currentSubject = disc.subject;
    document.querySelectorAll('#subjectChips .chip').forEach(x => x.classList.toggle('active', x.dataset.subject === disc.subject));
  }
  lastPaths = disc.paths || lastPaths;
  if (disc.adultContent) setAdult(disc.adultContent, { silent: true });
  if (disc.depth) setDepth(disc.depth, { silent: true });
  else if (disc.classification && disc.classification.adultContent) setAdult(disc.classification.adultContent, { silent: true });
  if (disc.query) $('searchQuery').value = disc.query;
  renderClassification(disc);
  renderPathChips(lastPaths, 'divePaths');
  renderResults(lastResults, disc.providers || {});
  const focusUrl = disc.selectedUrl || disc.deepDiveFocusUrl;
  if (focusUrl) {
    const focus = lastResults.find(r => r.url === focusUrl);
    if (focus) selectCandidate(focus, lastResults.indexOf(focus), { silent: !!disc.deepDiveText });
  }
  if (disc.deepDiveText || disc.deepDiveImages) {
    renderDeepDivePayload({
      plan: disc.deepDivePlan,
      analysis: disc.deepDiveText,
      images: disc.deepDiveImages || [],
      videos: disc.deepDiveVideos || [],
      retrieved: disc.deepDiveRetrieved || [],
      related: disc.deepDiveRelated || [],
      leads: [],
      paths: disc.paths,
      availablePaths: disc.availablePaths || disc.paths,
      selectedPathIds: disc.selectedPathIds,
      all: disc.all,
      customQuestion: disc.customQuestion,
      query: disc.deepDiveSubject || disc.query || '',
    }, disc.deepDiveSubject || disc.query || '');
  } else $('deepDiveResult').innerHTML = '';
  updateDeepDiveState();
}

/* ---------- init ---------- */
async function init() {
  wire();
  const last = localStorage.getItem(URL_KEY) || '';
  $('url').value = last || 'https://www.google.com';
  if (last) {
    historyStack = [last]; historyIndex = 0;
    navigate(last, false);
  } else {
    historyStack = []; historyIndex = -1;
    $('webview').src = 'about:blank';
  }
  updateNav();
  await openDB();
  await migrateLegacy('carmen-phone-v18', 'carmen_migrated_v18_to_v23', ['projects', 'refs', 'events']);
  await migrateLegacy('carmen-phone-v19', 'carmen_migrated_v19_to_v23', ['projects', 'refs', 'events', 'leads']);
  await migrateLegacy('carmen-phone-v20', 'carmen_migrated_v20_to_v23', ['projects', 'refs', 'events', 'leads']);
  await migrateLegacy('carmen-phone-v21', 'carmen_migrated_v21_to_v23', ['projects', 'refs', 'events', 'leads']);
  await migrateLegacy('carmen-phone-v22', 'carmen_migrated_v22_to_v23', ['projects', 'refs', 'events', 'leads', 'queue']);
  await migrateLegacy('carmen-phone-v23', 'carmen_migrated_v23_to_v24', ['projects', 'refs', 'events', 'leads', 'queue']);
  await migrateLegacy('carmen-phone-v24', 'carmen_migrated_v24_to_v36', ['projects', 'refs', 'events', 'leads', 'queue']);
  await backfillFingerprints();
  await ensureProject();
  restoreSession();
  renderHome();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init().catch(e => toast('Local archive unavailable: ' + e.message));
