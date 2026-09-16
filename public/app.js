/* Carmen — canonical frontend.
   iPhone-first investigation workspace. Preserves the v36 IndexedDB schema and
   all prior capabilities (capture, vision analysis, synthesis, evidence archive,
   pattern board, leads, backup/restore, queue) and adds the discovery hub:
   subject-based public search -> reviewable results -> deep-dive analysis ->
   saved evidence. Carmen never takes external actions on a user's behalf. */
'use strict';

const $ = id => document.getElementById(id);
const VERSION = '49.7';
const BACKEND_KEY = 'carmen_phone_backend_v36';
const URL_KEY = 'carmen_last_url_v36';
const DB_NAME = 'carmen-phone-v36';
const DB_VERSION = 3;
const SESSION_KEY = 'carmen_session_v49';
const SESSION_KEY_LEGACY = 'carmen_session_v48';
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
let attemptedQueries = [];
let lastPremium = [];
let lastRetrievalTrace = null;
let lastWhatChecked = null;
let lastWhyStop = null;
let lastVariations = [];
let lastEntityIdentity = null;
let lastRejected = [];
let diveAll = true;
let selectedDivePathIds = [];
let diveWorkspaceTab = 'findings';
let lightboxGallery = [];
let lightboxIndex = 0;
let lightboxSourceUrl = '';
let currentLearnType = '';
let expandedMode = false;
let currentAdult = 'on';
let currentDepth = 'contextual';
let researchSubject = '';
let currentLensId = 'everything';
let lastLenses = [];
let classifyTimer = 0;
let selectedEntity = null;
let originalQuery = '';
let lastVisualCandidates = [];
let lastConcepts = [];
let lastResearchState = null;
let lastInvestigationChoices = [];
let selectedInvestigationId = 'everything';
let lastVisuals = [];
let selectedVisual = null;
let lastVideos = [];
let lastCorpusScale = null;
let suppressed = { urls: [], hosts: [], images: [] };
const MEASURE_KEY = 'carmen_measurements_v47';
let diveTopic = '';
let investigationTrail = [];
let diveTab = 'overview';
let identityVerdict = null;
let lastSavedItemId = null;
let surpriseReason = '';
let discoverGen = 0;
let progressiveTimer = 0;
let lastFoundThrough = null;
let lastTopicMap = null;
let confirmedIdentity = [];
let rejectedPeople = [];
let inFlightController = null;
let activeDiveLens = '';
let lastExpansion = null;
let lastRelatedPeople = [];
let lastClothingEvidence = [];
let pendingPhoto = null;

/* Browser-agent observability. Does not change retrieval, ranking, or Deep Dive. */
function carmenNewInvestigationId() {
  try { return (crypto.randomUUID && crypto.randomUUID()) || ('inv-' + Date.now().toString(36)); }
  catch { return 'inv-' + Date.now().toString(36); }
}
let liveInvestigationId = carmenNewInvestigationId();
function setAgentState(patch) {
  const root = document.documentElement;
  if (!root) return;
  const next = {
    status: root.getAttribute('data-carmen-status') || 'idle',
    view: root.getAttribute('data-carmen-view') || 'home',
    busy: root.getAttribute('data-carmen-busy') === 'true',
    results: root.getAttribute('data-carmen-results') || '0',
    error: root.getAttribute('data-carmen-error') || '',
    lens: root.getAttribute('data-carmen-lens') || '',
    saved: root.getAttribute('data-carmen-saved') || '',
    howHere: root.getAttribute('data-carmen-how-here') || 'closed',
  };
  if (patch) Object.assign(next, patch);
  if (patch && patch.investigation) liveInvestigationId = patch.investigation;
  root.setAttribute('data-carmen-status', next.status);
  root.setAttribute('data-carmen-view', next.view);
  root.setAttribute('data-carmen-busy', next.busy ? 'true' : 'false');
  root.setAttribute('data-carmen-results', String(next.results == null ? '0' : next.results));
  root.setAttribute('data-carmen-error', next.error || '');
  root.setAttribute('data-carmen-lens', next.lens || '');
  root.setAttribute('data-carmen-saved', next.saved || '');
  root.setAttribute('data-carmen-how-here', next.howHere || 'closed');
  root.setAttribute('data-carmen-investigation', liveInvestigationId);
  root.setAttribute('aria-busy', next.busy ? 'true' : 'false');
  const results = $('results');
  if (results) {
    results.setAttribute('data-testid', 'results');
    results.setAttribute('aria-busy', next.busy ? 'true' : 'false');
    results.setAttribute('data-carmen-status', next.status);
  }
  const el = $('carmenAgentStatus');
  if (el) {
    el.setAttribute('data-status', next.status);
    el.setAttribute('data-view', next.view);
    el.setAttribute('data-busy', next.busy ? 'true' : 'false');
    el.setAttribute('data-results', String(next.results == null ? '0' : next.results));
    el.setAttribute('data-error', next.error || '');
    el.setAttribute('data-lens', next.lens || '');
    el.setAttribute('data-saved', next.saved || '');
    el.setAttribute('data-how-here', next.howHere || 'closed');
    el.setAttribute('data-investigation', liveInvestigationId);
    const bits = [next.status, next.view];
    if (next.busy) bits.push('loading');
    if (next.lens) bits.push('lens:' + next.lens);
    if (next.error) bits.push('error:' + String(next.error).slice(0, 180));
    el.textContent = bits.join(' · ');
  }
  window.__carmenAgent = {
    status: next.status,
    view: next.view,
    busy: !!next.busy,
    results: Number(next.results) || 0,
    error: next.error || '',
    lens: next.lens || '',
    saved: next.saved || '',
    howHere: next.howHere || 'closed',
    investigation: liveInvestigationId,
  };
}
function syncViewAvailability(activeView) {
  for (const [, v] of TABS) {
    const node = $(v);
    if (!node) continue;
    const on = v === activeView;
    node.classList.toggle('hidden', !on);
    if (on) {
      node.removeAttribute('hidden');
      node.removeAttribute('inert');
      node.removeAttribute('aria-hidden');
    } else {
      node.setAttribute('hidden', '');
      node.setAttribute('inert', '');
      node.setAttribute('aria-hidden', 'true');
    }
  }
  ['lightbox', 'saveSheet', 'toast', 'legacyTools'].forEach(id => {
    const node = $(id);
    if (!node) return;
    const on = !node.classList.contains('hidden');
    if (on) {
      node.removeAttribute('hidden');
      node.removeAttribute('inert');
      node.removeAttribute('aria-hidden');
    } else {
      node.setAttribute('hidden', '');
      node.setAttribute('inert', '');
      node.setAttribute('aria-hidden', 'true');
    }
  });
}



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
  ['navDive', 'diveView'],
  ['navCollections', 'collectionsView'],
  ['navInvestigations', 'investigationsView'],
  ['navLearn', 'learnView'],
];
function setTab(name) {
  const map = {
    home: 'homeView', search: 'searchView', dive: 'diveView', collections: 'collectionsView',
    investigations: 'investigationsView', learn: 'learnView',
    investigate: 'searchView', capture: 'investigationsView', evidence: 'investigationsView', leads: 'investigationsView',
  };
  const view = map[name] || 'homeView';
  for (const [nav, v] of TABS) {
    $(nav)?.classList.toggle('active', v === view);
  }
  syncViewAvailability(view);
  const viewName = view.replace(/View$/, '');
  setAgentState({ view: viewName === 'home' ? 'home' : viewName });
  if (view === 'investigationsView') mountTools();
  if (view === 'homeView') renderHome();
  if (view === 'collectionsView') renderCollections();
  if (view === 'investigationsView') renderInvestigations();
  if (view === 'diveView') {
    renderDiveIdentity();
    renderDiveStream();
    if (lastDivePayload) renderDiveWorkspace(lastDivePayload, lastDivePayload.query || lastDivePayload.plan?.subject || '');
  }
}

/* ---------- discovery / search ---------- */
function subjectLabel(s) {
  return ({
    person: 'Person', topic: 'Topic', website: 'URL', product: 'Product',
    technique: 'Position', skill: 'Tutorial', organization: 'Organization',
    vehicle: 'Vehicle', reddit: 'Reddit', social: 'Social', ambiguous: 'Ambiguous',
    position: 'Position', project: 'Project', place: 'Place', clothing: 'Clothing',
    visuals: 'Visuals', tutorial: 'Tutorial',
  }[s] || (s ? String(s) : 'Auto'));
}
function subjectQueryHint(s) {
  return ({
    person: 'Full name and any known context work best.',
    website: 'Paste a domain or URL.',
    visuals: 'Visuals, photos, stills, or a look you want to research.',
    position: 'A position, pose, or form.',
    tutorial: 'A tutorial, demonstration, or how-to.',
    clothing: 'A garment, outfit, or style.',
    topic: 'Describe the topic or question.',
    product: 'Product, brand, or object.',
    technique: 'A technique, position, or form.',
    skill: 'A skill, craft, or project to learn.',
    organization: 'Organization or institution name.',
    vehicle: 'Vehicle or object.',
    place: 'A place or location.',
  }[s] || 'A person, visuals, position, tutorial, clothing, URL, or topic.');
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
function investigationPhase() {
  const root = document.documentElement;
  const busy = root && root.getAttribute('data-carmen-busy') === 'true';
  const status = root && root.getAttribute('data-carmen-status');
  const n = lastResults.length;
  if (status === 'error' && !n) return 'ERROR';
  if (busy && (status === 'loading' || status === 'searching')) {
    return lastDiscoveryMeta && lastDiscoveryMeta.expansion ? 'EXPANDING' : 'SEARCHING';
  }
  if (lastDiscoveryMeta && lastDiscoveryMeta.noNewSources) return 'EXHAUSTED';
  if (n && confirmedIdentity.length) return 'IDENTITY_CONFIRMED';
  if (n && (lastClassification?.type || currentSubject) === 'person' && !selectedEntity && !selectedCandidate) return 'IDENTITY_NEEDS_CONFIRMATION';
  if (n && (lastVisuals.length || lastVideos.length || lastRelatedPeople.length)) return 'RESULTS_READY';
  if (n) return 'CANDIDATES_FOUND';
  return 'IDLE';
}
function updateDeepDiveState() {
  const btn = $('deepDiveBtn');
  const hint = $('deepDiveHint');
  if (!btn) return;
  const q = $('searchQuery')?.value.trim();
  const hasCandidates = lastResults.length > 0;
  const isPerson = (lastClassification?.type || currentSubject) === 'person';
  const ready = !!(selectedCandidate || selectedEntity || hasCandidates);
  btn.disabled = !ready;
  btn.classList.toggle('primary', !!(selectedCandidate || selectedEntity));
  const phase = investigationPhase();
  if (hasCandidates) {
    if (!selectedCandidate && !selectedEntity) {
      hint.textContent = isPerson
        ? 'Tap the person you mean. A picture is not proof of identity.'
        : 'Tap a candidate, then Deep Dive.';
      btn.disabled = false;
    } else {
      const name = selectedEntity?.canonicalName || selectedCandidate?.title || 'this investigation';
      hint.textContent = 'Selected: “' + name + '”. Deep Dive is ready.';
    }
  } else if (phase === 'SEARCHING' || phase === 'EXPANDING') {
    hint.textContent = 'Searching public sources…';
  } else if (!q) {
    hint.textContent = 'Search, tap what you mean, then Deep Dive.';
  } else {
    hint.textContent = 'No public candidates yet. Search first — Deep Dive will not invent sources.';
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
  if (a === 'on') return 'Adult ON';
  if (a === 'both') return 'Adult BOTH';
  return 'Adult OFF';
}
function setAdult(mode, opts = {}) {
  currentAdult = (mode === 'both') ? 'both' : 'on';
  document.querySelectorAll('#adultChips .chip, #homeAdultChips .chip').forEach(x => {
    x.classList.toggle('active', x.dataset.adult === currentAdult);
  });
  persistSession();
  if (!opts.silent) {
    const el = $('appSub');
    if (el && currentAdult !== 'off') el.textContent = adultLabel(currentAdult) + ' · public research only';
    else if (el) el.textContent = 'Public research. Nothing is saved unless you choose Save.';
    if (researchSubject || ($('searchQuery') && $('searchQuery').value.trim())) classifySubject({ silent: true });
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
  if (!opts.silent) renderLensStack();
}
function extraContextText(c) {
  return String((c && c.context) || '').replace(/adult content/gi, ' ').replace(/\s+/g, ' ').trim();
}
function resultKindLabel(kind) {
  return ({
    VISUAL_ENTITY_MATCH: 'Visual match',
    INTERVIEW_MATCH: 'Interview',
    INTERSECTION_MATCH: 'Direct contextual evidence',
    RELATIONSHIP_MATCH: 'Related',
    MEDIA_MATCH: 'Media',
    AGGREGATOR: 'Index',
    GENERIC_BACKGROUND: 'Background',
    ENTITY_MATCH: 'Entity',
    CONTEXT_MATCH: 'Related context',
    WEAK_MATCH: 'Weak match',
    JUNK: 'Junk',
  }[kind] || '');
}
function resultKindClass(kind) {
  if (kind === 'INTERSECTION_MATCH' || kind === 'VISUAL_ENTITY_MATCH' || kind === 'INTERVIEW_MATCH') return 'access-ok';
  if (kind === 'AGGREGATOR' || kind === 'JUNK' || kind === 'WEAK_MATCH') return 'access-warn';
  if (kind === 'GENERIC_BACKGROUND' || kind === 'ENTITY_MATCH') return '';
  if (kind === 'RELATIONSHIP_MATCH' || kind === 'MEDIA_MATCH') return 'inferred';
  return '';
}
function resultCardClass(kind) {
  if (kind === 'VISUAL_ENTITY_MATCH') return ' person';
  if (kind === 'INTERSECTION_MATCH' || kind === 'INTERVIEW_MATCH') return ' direct';
  if (kind === 'AGGREGATOR' || kind === 'JUNK') return ' index';
  if (kind === 'WEAK_MATCH') return ' weak';
  return '';
}
function currentLens() {
  return (lastLenses || []).find(x => x.id === currentLensId) || null;
}
function composeQuery() {
  const typed = ($('searchQuery')?.value || '').trim();
  const sub = researchSubject || typed;
  const lens = currentLens();
  if (!lens || lens.id === 'everything') return typed || sub;
  if (lens.question) {
    const q = ($('customQuestion')?.value || '').trim();
    return q ? (sub + ' ' + q) : (typed || sub);
  }
  if (lens.custom) {
    const c = ($('customContext')?.value || '').trim();
    return c ? (sub + ' ' + c) : (typed || sub);
  }
  if (lens.context) {
    if (typed && typed.toLowerCase().includes(String(lens.context).toLowerCase())) return typed;
    return (sub + ' ' + lens.context).trim();
  }
  return typed || sub;
}
function matchLensToClassification(c) {
  const extra = extraContextText(c);
  const lenses = lastLenses || [];
  if (!extra) { currentLensId = currentLensId || 'everything'; return; }
  const hit = lenses.find(l => l.context && extra.toLowerCase().includes(String(l.context).toLowerCase()));
  if (hit) currentLensId = hit.id;
  else {
    currentLensId = 'specific';
    if ($('customContext') && !$('customContext').value.trim()) $('customContext').value = extra;
  }
}
function renderInterestChips() {
  const el = $('interestChips');
  if (!el) return;
  const list = lastLenses || [];
  el.innerHTML = list.map(l => `<button type="button" class="chip${l.id === currentLensId ? ' active' : ''}" data-lens="${esc(l.id)}">${esc(l.label)}</button>`).join('')
    || '<span class="hint">Enter a subject to see adaptive research lenses.</span>';
  const lens = currentLens();
  $('customContextWrap')?.classList.toggle('hidden', !(lens && lens.custom));
  $('customQuestionWrap')?.classList.toggle('hidden', !(lens && lens.question));
}
function renderLensStack(data) {
  const el = $('lensStack');
  if (!el) return;
  const c = (data && data.classification) || lastClassification;
  const entity = (c && c.subject) || researchSubject || ($('searchQuery')?.value || '').trim();
  if (!entity) { el.innerHTML = ''; return; }
  const ctx = extraContextText(c) || (currentLens()?.custom ? ($('customContext')?.value || '') : (currentLens()?.context || ''));
  const q = (currentLens()?.question && ($('customQuestion')?.value || '').trim()) || '';
  const adult = currentAdult !== 'off' ? adultLabel(currentAdult) : '';
  el.innerHTML = `<div class="lens-stack">
    <div class="lens-row"><p class="flabel">Entity</p><b>${esc(entity)}</b></div>
    <div class="lens-row"><p class="flabel">Context</p><span>${esc(ctx || (adult ? 'Adult research lens' : 'Everything'))}</span></div>
    ${q ? `<div class="lens-row"><p class="flabel">Question</p><span>${esc(q)}</span></div>` : ''}
    ${adult ? `<div class="lens-row"><p class="flabel">Lens</p><span>${esc(adult)}</span></div>` : ''}
    <div class="lens-row"><p class="flabel">Depth</p><span>${esc(depthLabel(currentDepth))}</span></div>
  </div>`;
}
function foundSummary(data) {
  const n = (data && data.results && data.results.length) || lastResults.length || 0;
  if (!n) return 'Public sources ranked for this search.';
  return n + ' public source' + (n === 1 ? '' : 's');
}
function renderGraphTrail(data) {
  const el = $('graphTrail');
  if (!el) return;
  const c = (data && data.classification) || lastClassification || {};
  const entity = c.subject || researchSubject || '';
  const ctx = extraContextText(c);
  const leads = (data && data.graphLeads) || [];
  if (!entity && !leads.length) { el.innerHTML = ''; return; }
  const bits = [];
  if (entity) bits.push(`<button type="button" class="chip active" data-graph-q="${esc(entity)}">${esc(entity)}</button>`);
  if (ctx) bits.push(`<span class="subtle">→</span><button type="button" class="chip" data-graph-q="${esc((entity + ' ' + ctx).trim())}">${esc(ctx)}</button>`);
  for (const lead of leads.slice(0, 8)) {
    const label = lead.label || lead.text || '';
    if (!label) continue;
    bits.push(`<span class="subtle">→</span><button type="button" class="chip" data-graph-kind="${esc(lead.kind || '')}" data-graph-q="${esc(label)}">${esc(label)}</button>`);
  }
  el.innerHTML = bits.length ? `<p class="flabel">Investigation</p><div class="chips">${bits.join('')}</div><p class="hint">Tap a node to branch. The parent investigation stays.</p>` : '';
}
async function classifySubject(opts = {}) {
  const q = ($('searchQuery')?.value || '').trim();
  if (!q) return null;
  const base = backendUrl();
  if (!base) return null;
  try {
    const r = await fetch(base + '/classify?q=' + encodeURIComponent(q) + '&type=' + encodeURIComponent(currentSubject) + '&adult=' + encodeURIComponent(currentAdult) + '&depth=' + encodeURIComponent(currentDepth), { headers: { accept: 'application/json' } });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { throw Error(text || `HTTP ${r.status}`); }
    if (!r.ok || data.error) throw Error(data.error || `HTTP ${r.status}`);
    lastClassification = data.classification || lastClassification;
    lastLenses = Array.isArray(data.lenses) ? data.lenses : lastLenses;
    if (Array.isArray(data.investigationChoices) && data.investigationChoices.length) lastInvestigationChoices = data.investigationChoices;
    lastPaths = Array.isArray(data.paths) && data.paths.length ? data.paths : lastPaths;
    lastConcepts = Array.isArray(data.concepts) ? data.concepts : lastConcepts;
    if (lastClassification && lastClassification.subject) researchSubject = lastClassification.subject;
    matchLensToClassification(lastClassification);
    const extra = extraContextText(lastClassification);
    if ((extra || currentAdult === 'on' || currentAdult === 'both') && currentDepth !== 'deep') setDepth('contextual', { silent: true });
    renderInterestChips();
    renderLensStack(data);
    persistSession();
    if (!opts.silent) {
      const lensHint = lastLenses.find(x => x.id === currentLensId);
      toast(lensHint ? 'What are you interested in? ' + lensHint.label + ' is selected.' : 'Subject classified. Choose a research lens, then Discover.');
    }
    return data;
  } catch (e) {
    if (!opts.silent) toast('Could not classify yet: ' + e.message);
    return null;
  }
}
function persistSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      query: $('searchQuery')?.value || '',
      originalQuery,
      subject: currentSubject,
      results: lastResults,
      selectedUrl: selectedCandidate?.url || selectedEntity?.url || '',
      selectedEntity,
      visualCandidates: lastVisualCandidates,
      visuals: lastVisuals,
      videos: lastVideos,
      corpusScale: lastCorpusScale,
      suppressed,
      selectedVisual,
      classification: lastClassification,
      paths: lastPaths,
      meta: lastDiscoveryMeta,
      dive: lastDivePayload,
      diveCustom: $('diveCustom')?.value || '',
      adult: currentAdult,
      depth: currentDepth,
      researchSubject,
      lensId: currentLensId,
      lenses: lastLenses,
      investigationChoices: lastInvestigationChoices,
      investigationId: selectedInvestigationId,
      concepts: lastConcepts,
      researchState: lastResearchState,
      diveTopic,
      investigationTrail,
      diveTab,
      identityVerdict,
      lastSavedItemId,
      surpriseReason,
      lastTopicMap,
      confirmedIdentity,
      rejectedPeople,
      liveInvestigationId,
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
  disc.selectedEntity = selectedEntity;
  disc.originalQuery = originalQuery;
  disc.visualCandidates = lastVisualCandidates;
  disc.visuals = lastVisuals;
  disc.videos = lastVideos;
  disc.corpusScale = lastCorpusScale;
  disc.concepts = lastConcepts;
  disc.researchState = lastResearchState;
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
    const raw = sessionStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY_LEGACY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.query && $('searchQuery')) $('searchQuery').value = s.query;
    currentSubject = s.subject || '';
    lastResults = s.results || [];
    lastClassification = s.classification || null;
    lastPaths = s.paths || [];
    lastDiscoveryMeta = s.meta || null;
    lastDivePayload = s.dive || null;
    originalQuery = s.originalQuery || s.query || '';
    lastVisualCandidates = Array.isArray(s.visualCandidates) ? s.visualCandidates : [];
    lastVisuals = Array.isArray(s.visuals) ? s.visuals : [];
    lastVideos = Array.isArray(s.videos) ? s.videos : [];
    lastCorpusScale = s.corpusScale || lastCorpusScale;
    if (s.suppressed) suppressed = { urls: s.suppressed.urls || [], hosts: s.suppressed.hosts || [], images: s.suppressed.images || [] };
    selectedVisual = s.selectedVisual || null;
    lastConcepts = Array.isArray(s.concepts) ? s.concepts : lastConcepts;
    lastResearchState = s.researchState || lastResearchState;
    selectedEntity = s.selectedEntity || null;
    if (s.diveCustom && $('diveCustom')) $('diveCustom').value = s.diveCustom;
    setAdult('on', { silent: true });
    if (s.depth) setDepth(s.depth, { silent: true });
    if (s.researchSubject) researchSubject = s.researchSubject;
    if (s.lensId) currentLensId = s.lensId;
    if (Array.isArray(s.lenses)) lastLenses = s.lenses;
    if (Array.isArray(s.investigationChoices)) lastInvestigationChoices = s.investigationChoices;
    if (s.investigationId) selectedInvestigationId = s.investigationId;
    if (Array.isArray(s.investigationTrail)) investigationTrail = s.investigationTrail;
    if (s.diveTopic) diveTopic = s.diveTopic;
    if (s.diveTab) diveTab = s.diveTab;
    if (s.identityVerdict) identityVerdict = s.identityVerdict;
    if (s.lastSavedItemId) lastSavedItemId = s.lastSavedItemId;
    if (s.surpriseReason) surpriseReason = s.surpriseReason;
    if (s.lastTopicMap) lastTopicMap = s.lastTopicMap;
    if (Array.isArray(s.confirmedIdentity)) confirmedIdentity = s.confirmedIdentity;
    if (Array.isArray(s.rejectedPeople)) rejectedPeople = s.rejectedPeople;
    if (s.liveInvestigationId) liveInvestigationId = s.liveInvestigationId;
    if (s.selectedUrl) selectedCandidate = lastResults.find(r => r.url === s.selectedUrl) || null;
    renderInterestChips();
    renderLensStack(s.meta || { classification: lastClassification });
    if (lastResults.length) {
      renderClassification(lastDiscoveryMeta || { classification: lastClassification, variants: [] });
      renderPathChips(lastPaths, 'divePaths');
      renderResults(lastResults, lastDiscoveryMeta?.providers || {});
      renderVisualCorpus();
      renderVideoCorpus();
      renderGraphTrail(lastDiscoveryMeta);
      renderTopicMap(lastTopicMap);
      if (selectedCandidate) {
        const i = lastResults.findIndex(r => r.url === selectedCandidate.url);
        if (i >= 0) selectCandidate(selectedCandidate, i, { silent: true });
      } else if (selectedEntity) {
        renderSelectedBanner();
      }
      renderPersonRail();
      renderDiveIdentity();
      renderDiveStream();
      if (lastDivePayload) renderDeepDivePayload(lastDivePayload, s.query || '');
    }
  } catch {}
}

async function discover(opts = {}) {
  const keepSubject = opts.keepSubject === true
    || !!(opts.entity)
    || !!(opts.topic && selectedEntity)
    || (!!selectedEntity && opts.keepSubject !== false && !!(opts.visualMore || opts.visualMode || opts.videoMore || opts.append || opts.progressive));
  const typedNow = ($('searchQuery')?.value || $('homeQuery')?.value || '').trim();
  const priorSubject = String(selectedEntity?.canonicalName || lastClassification?.subject || researchSubject || '').trim();
  if (!keepSubject && priorSubject && typedNow) {
    const priorN = priorSubject.toLowerCase();
    const typedN = typedNow.toLowerCase();
    const shares = typedN.includes(priorN) || priorN.includes(typedN.split(/\s+/).slice(0, 2).join(' '));
    if (!shares) {
      const qKeep = typedNow;
      hardNewInvestigation({ silent: true, stay: true });
      if ($('searchQuery')) $('searchQuery').value = qKeep;
      if ($('homeQuery')) $('homeQuery').value = qKeep;
    }
  }
  const entityName = String(opts.entity || (keepSubject && selectedEntity && selectedEntity.canonicalName) || '').trim();
  const topicName = String(opts.topic != null ? opts.topic : (keepSubject ? diveTopic : '') || '').trim();
  if (!keepSubject) {
    const composed = composeQuery();
    if (composed && $('searchQuery')) $('searchQuery').value = composed;
  }
  let q = keepSubject
    ? composeInvestigationQuery(($('diveSearchQuery') && $('diveSearchQuery').value) || $('searchQuery').value, entityName, topicName)
    : $('searchQuery').value.trim();
  if (keepSubject && entityName) q = composeInvestigationQuery(q, entityName, topicName);
  if (!q && pendingPhoto) {
    q = String(pendingPhoto.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim() || 'visual investigation';
    opts.photoInput = true;
    if (!opts.seedVisual) {
      opts.seedVisual = { title: pendingPhoto.name || 'uploaded photo', caption: q, pageUrl: '' };
    }
    if ($('searchQuery') && !$('searchQuery').value.trim()) $('searchQuery').value = q;
  }
  if (!q) return toast('Enter a subject, name, URL, or attach a photo first.');
  const base = backendUrl();
  if (!base) return toast('Set the Carmen Worker URL in Capture → Connection.');
  localStorage.setItem(BACKEND_KEY, base);
  const expanded = opts.expanded === true;
  const visualMore = opts.visualMore === true;
  const visualMode = opts.visualMode || (visualMore ? 'more' : '');
  const videoMore = opts.videoMore === true;
  expandedMode = expanded;
  const gen = ++discoverGen;
  clearTimeout(progressiveTimer);
  if (inFlightController) {
    try { inFlightController.abort(); } catch {}
  }
  inFlightController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const btn = $('discoverBtn');
  if (btn) btn.disabled = true;
  if ($('expandedBtn')) $('expandedBtn').disabled = true;
  if ($('diveSearchBtn')) $('diveSearchBtn').disabled = true;
  if (!visualMore && !visualMode && !videoMore && !keepSubject) {
    selectedCandidate = null;
    selectedEntity = null;
    lastResults = [];
    lastVisualCandidates = [];
    lastVisuals = [];
    lastVideos = [];
    selectedVisual = null;
    suppressed = { urls: [], hosts: [], images: [] };
    attemptedQueries = [];
    lastPremium = [];
    lastRetrievalTrace = null;
    lastRelatedPeople = [];
    lastClothingEvidence = [];
    lastTopicMap = null;
    lastDiscoveryMeta = null;
    diveTopic = '';
    identityVerdict = null;
    if ($('suggestBar')) $('suggestBar').innerHTML = '';
    if ($('topicMap')) $('topicMap').innerHTML = '';
  }
  if (!keepSubject) originalQuery = q;
  else if (entityName) originalQuery = composeInvestigationQuery(originalQuery || entityName, entityName, topicName);
  if (!opts.append && !visualMore && !visualMode && !videoMore) {
    $('results').innerHTML = '<div class="skeleton" style="height:120px;margin-bottom:9px"></div>'.repeat(3);
    if ($('diveStream') && keepSubject) $('diveStream').innerHTML = '<div class="skeleton" style="height:90px;margin-bottom:9px"></div>'.repeat(2);
  }
  if ($('personRail') && !keepSubject) $('personRail').innerHTML = '';
  $('resultsEmpty').classList.add('hidden');
  setAgentState({
    status: (lastResults.length && (opts.append || opts.progressive || opts.visualMore || opts.videoMore || opts.findMore)) ? 'complete' : 'loading',
    busy: true,
    error: '',
    lens: opts.diveLens || activeDiveLens || '',
    results: lastResults.length,
  });
  $('searchDiagnostics').textContent = expanded
    ? 'Looking further across public sources…'
    : (visualMode || visualMore || videoMore)
      ? 'Expanding the visual/video corpus…'
      : (keepSubject && entityName && topicName
        ? ('Searching “' + entityName + '” + “' + topicName + '”…')
        : 'Searching public sources and ranking candidates…');
  if (!keepSubject) $('classBar').innerHTML = '';
  if (!visualMore && !visualMode && !videoMore && !keepSubject) $('selectedBanner').innerHTML = '';
  updateDeepDiveState();
  try {
    const params = new URLSearchParams({
      q,
      type: (keepSubject && selectedEntity && selectedEntity.type) || currentSubject || '',
      adult: currentAdult,
      depth: currentDepth,
    });
    if (entityName) params.set('entity', entityName);
    if (topicName) params.set('topic', topicName);
    if (expanded) params.set('expanded', '1');
    if (visualMore || visualMode === 'more') params.set('visualMore', '1');
    if (visualMode) params.set('visualMode', visualMode);
    if (opts.visualOffset) params.set('visualOffset', String(opts.visualOffset));
    if (videoMore) params.set('videoMore', '1');
    const qLower = String(q || '').toLowerCase();
    const findEverything = opts.findEverything === true || /\b(find everything|everything related|everything about|all sources|full investigation)\b/i.test(q);
    const premiumAccounts = opts.premium === true || opts.premiumAccounts === true || /\b(premium accounts?|subscription accounts?|paid accounts?)\b/i.test(q);
    const intentMode = opts.mode || opts.intentMode || (visualMode === 'different' || opts.findDifferent ? 'find-different' : (visualMode === 'similar' || opts.moreLikeThis ? 'more-like-this' : (visualMode === 'more' || opts.findMore ? 'find-more' : '')));
    if (findEverything) params.set('findEverything', '1');
    if (premiumAccounts) params.set('premium', '1');
    if (intentMode) params.set('mode', intentMode);
    if (opts.findMore) params.set('findMore', '1');
    if (opts.moreLikeThis) params.set('moreLikeThis', '1');
    if (opts.findDifferent || visualMode === 'different') params.set('findDifferent', '1');
    if (opts.findSimilar || visualMode === 'similar') params.set('findSimilar', '1');
    if (opts.searchThisVisual || visualMode === 'searchvisual') params.set('searchThisVisual', '1');
    if (opts.moreFromThisSource) params.set('moreFromThisSource', '1');
    if (opts.moreFromThisPerson) params.set('moreFromThisPerson', '1');
    if (opts.moreOnThisTopic) params.set('moreOnThisTopic', '1');
    if (opts.diveLens) params.set('diveLens', opts.diveLens);
    if (opts.mode && /^dive-/.test(opts.mode)) params.set('mode', opts.mode);
    if (confirmedIdentity.length) params.set('confirmedIdentity', confirmedIdentity.slice(0, 6).join(','));

    if (rejectedPeople.length) params.set('rejectedPeople', rejectedPeople.slice(0, 8).join(','));
    if ((suppressed.images || []).length) params.set('rejectedImages', suppressed.images.slice(0, 12).join(','));
    const excl = [...new Set([...(suppressed.urls || []), ...(opts.excludeUrls || [])])].filter(Boolean);
    const hosts = [...new Set([...(suppressed.hosts || []), ...(opts.excludeHosts || [])])].filter(Boolean);
    if (excl.length) params.set('exclude', excl.slice(0, 12).join(','));
    if (hosts.length) params.set('excludeHosts', hosts.slice(0, 8).join(','));
    if (opts.seedVisual) {
      const sv = opts.seedVisual;
      params.set('seedVisual', JSON.stringify({ title: sv.title || sv.caption || '', domain: sv.domain || '', caption: sv.caption || '', pageUrl: sv.pageUrl || sv.url || '' }));
    }
    const knownImgs = lastVisuals.map(im => im.url || im.src).filter(Boolean).slice(0, 40);
    const knownVids = lastVideos.map(v => v.videoId || videoDedupeKey(v.url || v.pageUrl || '')).filter(Boolean).slice(0, 40);
    if (attemptedQueries.length) params.set('attempted', attemptedQueries.slice(0, 40).join('\n'));
    if (knownImgs.length && (visualMore || visualMode || videoMore || opts.findMore || opts.diveLens || opts.append || keepSubject)) params.set('knownMedia', knownImgs.join('\n'));
    if (knownVids.length && (videoMore || visualMode || opts.findMore || opts.diveLens || opts.append || keepSubject)) params.set('knownVideos', knownVids.join('\n'));
    if (pendingPhoto || opts.photo || opts.photoInput) {
      params.set('photo', '1');
      params.set('photoInput', '1');
    }
    if ((keepSubject || opts.append) && lastResults.length) {
      try {
        params.set('prior', JSON.stringify(lastResults.slice(0, 16).map(r => ({
          url: r.url, title: r.title, snippet: String(r.snippet || '').slice(0, 220),
          domain: r.domain, source: r.source,
          sourceClass: r.sourceClass, discoveryLane: r.discoveryLane,
          provenance: r.provenance, retrievalStatus: r.retrievalStatus, accessState: r.accessState,
          textExcerpt: String(r.textExcerpt || r.snippet || '').slice(0, 280),
          subjectEvidence: r.subjectEvidence, topicEvidence: r.topicEvidence, intersection: r.intersection,
        }))));
      } catch {}
    }
    if ((opts.diveLens || opts.findMore || keepSubject) && ((lastDiscoveryMeta && lastDiscoveryMeta.graphLeads) || (lastRelatedPeople && lastRelatedPeople.length))) {
      try {
        const leads = ((lastDiscoveryMeta && lastDiscoveryMeta.graphLeads) || []).slice(0, 10);
        const people = (lastRelatedPeople || []).slice(0, 8).map(p => ({
          kind: 'collaborator', name: p.name, label: p.name, role: p.role,
          observationState: p.observationState, why: p.why, foundThrough: p.foundThrough,
        }));
        params.set('graphLeads', JSON.stringify(leads.concat(people)));
      } catch {}
    }
    const fetchOpts = { headers: { accept: 'application/json' } };
    if (inFlightController) fetchOpts.signal = inFlightController.signal;
    const r = await fetch(base + '/search?' + params.toString(), fetchOpts);
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { throw Error(text || `HTTP ${r.status}`); }
    if (!r.ok || data.error) throw Error(data.error || `HTTP ${r.status}`);
    if (gen !== discoverGen) return;
    const shouldMerge = !!(opts.append || keepSubject || opts.progressive || lastResults.length && (findEverything || premiumAccounts));
    if (shouldMerge && Array.isArray(data.results)) lastResults = mergeResultsByUrl(lastResults, data.results);
    else if (!visualMore && !visualMode && !videoMore) lastResults = Array.isArray(data.results) ? data.results : [];
    else if ((!lastResults || !lastResults.length) && Array.isArray(data.results)) lastResults = data.results;
    lastClassification = data.classification || lastClassification;
    if (keepSubject && entityName && lastClassification) lastClassification.subject = entityName;
    if (keepSubject && topicName && lastClassification) lastClassification.context = topicName;
    if (keepSubject && selectedEntity && topicName) selectedEntity.context = topicName;
    lastDiscoveryMeta = data;
    lastTopicMap = data.topicMap || lastTopicMap;
    lastPaths = Array.isArray(data.paths) ? data.paths : lastPaths;
    lastVisualCandidates = Array.isArray(data.visualCandidates) ? data.visualCandidates : lastVisualCandidates;
    lastVisuals = mergeVisuals(lastVisuals, data.visuals || data.visualCorpus || []);
    lastVideos = mergeVideos(lastVideos, data.videos || data.videoCorpus || []);
    lastCorpusScale = data.corpusScale || { images: lastVisuals.length, videos: lastVideos.length, sources: lastResults.length, label: lastVisuals.length + ' images · ' + lastVideos.length + ' videos · ' + lastResults.length + ' sources' };
    lastConcepts = Array.isArray(data.concepts) ? data.concepts : lastConcepts;
    if (Array.isArray(data.attemptedQueries)) attemptedQueries = [...new Set([...(attemptedQueries || []), ...data.attemptedQueries])].slice(0, 48);
    else if (Array.isArray(data.variants)) attemptedQueries = [...new Set([...(attemptedQueries || []), ...data.variants.map(v => v.q || v)])].slice(0, 48);
    if (Array.isArray(data.premiumContent)) lastPremium = data.premiumContent;
    lastRetrievalTrace = data.retrievalTrace || lastRetrievalTrace;
    lastWhatChecked = data.whatCarmenChecked || lastWhatChecked;
    lastWhyStop = data.whyDidYouStop || lastWhyStop;
    lastVariations = Array.isArray(data.variations) ? data.variations : lastVariations;
    lastEntityIdentity = data.entityIdentity || lastEntityIdentity;
    if (Array.isArray(data.rejectedCandidates)) lastRejected = data.rejectedCandidates;
    lastExpansion = data.expansion || null;
    lastRelatedPeople = Array.isArray(data.relatedPeople) ? data.relatedPeople : lastRelatedPeople;
    lastClothingEvidence = Array.isArray(data.clothingEvidence) ? data.clothingEvidence : lastClothingEvidence;
    originalQuery = data.query || q;

    if (data.classification && data.classification.subject && !keepSubject) researchSubject = data.classification.subject;
    else if (entityName) researchSubject = entityName;
    if (Array.isArray(data.lenses) && data.lenses.length) lastLenses = data.lenses;
    if (Array.isArray(data.investigationChoices) && data.investigationChoices.length) lastInvestigationChoices = data.investigationChoices;
    matchLensToClassification(lastClassification);
    renderInterestChips();
    renderClassification(data);
    renderLensStack(data);
    renderPathChips(lastPaths, 'divePaths');
    renderResults(lastResults, data.providers || {});
    renderTopicMap(lastTopicMap);
    renderVisualCorpus();
    renderVideoCorpus();
    renderGraphTrail(data);
    renderExpandedCard(data);
    renderIdentityBanner();
    renderDiveIdentity();
    renderDiveStream();
    renderInvestigationTrace(data);
    renderVariationChips(data);
    persistSession();
    updateDeepDiveState();
    pushTrail({
      kind: keepSubject && topicName ? 'topic' : (opts.progressive ? 'expand' : 'search'),
      label: keepSubject && entityName && topicName ? (entityName + ' + ' + topicName) : (entityName || q),
      query: q,
      entity: entityName || lastClassification?.subject || '',
      topic: topicName,
    });
    const scale = lastCorpusScale && lastCorpusScale.label ? lastCorpusScale.label : (lastVisuals.length + ' images · ' + lastVideos.length + ' videos · ' + lastResults.length + ' sources');
    renderExpansionNote(data);
    setAgentState({
      status: 'complete',
      busy: false,
      results: lastResults.length,
      error: '',
      lens: opts.diveLens || activeDiveLens || '',
    });
    toast(data.noNewSources
      ? (data.noNewSourcesMessage || 'No new sources found from this angle.')
      : (data.noNewMedia
      ? 'No new media — pivoted to the next query class.'
      : (lastResults.length || lastVisuals.length || lastVideos.length
      ? (visualMode || visualMore || videoMore ? 'Corpus updated — ' + scale : (opts.progressive ? scale : (expanded ? 'Looked further — ' + scale : (data.expansion && data.expansion.genuinelyNew ? ('Learned ' + data.expansion.genuinelyNew + ' new source' + (data.expansion.genuinelyNew === 1 ? '' : 's')) : scale))))
      : 'No public results. See diagnostics.')));

    if (!opts.expanded && !visualMore && !visualMode && !videoMore && !opts.diveLens && !opts.findMore && lastResults.length && lastResults.length < 18 && !data.noNewMedia && !data.noNewSources) {

      progressiveTimer = setTimeout(() => {
        if (gen !== discoverGen) return;
        discover({ expanded: true, keepSubject, entity: entityName, topic: topicName, append: true, progressive: true });
      }, 900);
    }
  } catch (e) {
    if (gen !== discoverGen) return;
    if (e && (e.name === 'AbortError' || /abort/i.test(String(e.message || e)))) return;
    const msg = String(e.message || e || '');
    const transient = /\b503\b|\b429\b|temporarily unavailable|UNAVAILABLE/i.test(msg);
    if (transient) {
      setAgentState({ status: lastResults.length ? 'complete' : 'error', busy: false, error: '', results: lastResults.length });
      toast('A source is temporarily unavailable. Carmen is keeping what it already found — this is not evidence that nothing exists.');
      if (lastResults.length) {
        renderResults(lastResults);
        renderVisualCorpus();
        updateDeepDiveState();
        return;
      }
      $('resultsEmpty').textContent = 'A public source was temporarily unavailable (HTTP 503). This is not evidence that nothing exists.';
      $('resultsEmpty').classList.remove('hidden');
      $('searchDiagnostics').textContent = 'Service temporarily unavailable. Existing investigation state was not reset.';
      return;
    }
    $('results').innerHTML = '';
    $('resultsEmpty').textContent = 'Discovery failed: ' + msg;
    $('resultsEmpty').classList.remove('hidden');
    $('searchDiagnostics').textContent = '';
    setAgentState({ status: 'error', busy: false, error: msg, results: lastResults.length });
    toast('Discovery failed: ' + msg);
  } finally {
    if (gen === discoverGen) {
      if (btn) btn.disabled = false;
      if ($('expandedBtn')) $('expandedBtn').disabled = false;
      if ($('diveSearchBtn')) $('diveSearchBtn').disabled = false;
      updateDeepDiveState();
      const root = document.documentElement;
      if (root && root.getAttribute('data-carmen-status') === 'loading') {
        setAgentState({ status: lastResults.length ? 'complete' : 'idle', busy: false, results: lastResults.length });
      } else {
        setAgentState({ busy: false, results: lastResults.length });
      }
    }
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
  const warn = data.warning ? `<p class="warning">${esc(data.warning)}</p>` : '';
  const ctx = extraContextText(c);
  const found = foundSummary(data);
  $('classBar').innerHTML = `<div class="briefing">
    <b>${esc(c.subject || data.query || '')}</b>
    <div class="rowbits">
      ${currentAdult !== 'off' ? adultBadge(data.adultContent || currentAdult) : ''}
      ${ctx ? '<span class="badge">' + esc(ctx) + '</span>' : ''}
    </div>
    <p class="hint" style="margin:8px 0 0">${esc(found)}</p>
  </div>${warn}`;
}
function conceptChipsHtml(concepts) {
  const list = Array.isArray(concepts) ? concepts.filter(x => x && x.term) : [];
  if (!list.length) return '';
  return '<div class="rowbits" style="margin-top:8px">' + list.map(x => {
    const rel = (x.related || []).slice(0, 3).join(', ');
    return `<span class="badge access-ok">${esc(x.term)}${x.family && x.family !== 'open' ? ' · ' + esc(x.family) : ''}${x.provenance ? ' · ' + esc(x.provenance) : ''}</span>` + (rel ? `<span class="badge">related: ${esc(rel)}</span>` : '');
  }).join('') + '</div><p class="hint" style="margin:6px 0 0">Carmen is researching these concepts across independent public sources — not concatenating every synonym into one query.</p>';
}
function entityIdFor(type, name) {
  const t = String(type || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return n ? ('entity:' + (t || 'unknown') + ':' + n) : '';
}
function resolveSelectedEntity(r) {
  const c = lastClassification || {};
  const name = String(c.subject || researchSubject || '').trim()
    || String(r?.title || '').split(/\s[\-–—|·]\s/)[0].trim();
  const type = c.type || r?.entityType || currentSubject || '';
  const imgs = [...new Set([r?.image, ...(r?.images || [])].filter(Boolean))].slice(0, 8);
  const ctx = extraContextText(c) || currentLens()?.context || '';
  const url = r?.url || '';
  const evidence = url || r?.image ? {
    url,
    domain: r?.domain || hostOf(url),
    title: r?.title || '',
    snippet: r?.snippet || '',
    source: r?.source || '',
    image: r?.image || imgs[0] || '',
    images: imgs,
    resultKind: r?.resultKind || '',
    provenance: r?.provenance || 'DISCOVERED',
    reason: r?.reason || '',
    observedAt: r?.observedAt || '',
  } : null;
  return {
    entityId: entityIdFor(type, name),
    canonicalName: name,
    type,
    aliases: r?.aliases || [],
    confidence: r?.confidence || 'low',
    discoveryEvidence: evidence,
    sourceRefs: url ? [url] : [],
    url,
    image: r?.image || imgs[0] || '',
    images: imgs,
    provenance: r?.provenance || 'DISCOVERED',
    reason: r?.reason || '',
    sourceUrls: url ? [url] : [],
    originalQuery: originalQuery || $('searchQuery')?.value || '',
    context: ctx,
    adultContent: currentAdult,
    lens: currentLensId,
    depth: currentDepth,
    selectedAt: new Date().toISOString(),
    visualLikenessIsNotIdentityProof: true,
    concepts: lastConcepts,
  };
}
function renderSelectedBanner() {
  const el = $('selectedBanner');
  if (!el) return;
  const r = selectedCandidate;
  const ent = selectedEntity;
  if (!r && !ent) { el.innerHTML = ''; return; }
  const isPerson = (ent?.type || lastClassification?.type) === 'person';
  const name = ent?.canonicalName || r?.title || 'Selected';
  const img = ent?.image || r?.image || '';
  const ctx = ent?.context || extraContextText(lastClassification);
  const why = ent?.reason || r?.reason || '';
  el.innerHTML = `<div class="selbar"><div class="dive-id">
    ${img ? `<img src="${esc(imgSrc(img))}" alt="" referrerpolicy="no-referrer">` : ''}
    <div class="body">
      <b>${esc(name)}</b>
      ${ctx ? '<div class="hint">' + esc(ctx) + (currentAdult !== 'off' ? ' · ' + esc(adultLabel(currentAdult)) : '') + '</div>' : (currentAdult !== 'off' ? '<div class="hint">' + esc(adultLabel(currentAdult)) + '</div>' : '')}
      ${why ? '<div class="rwhy">' + esc(why) + '</div>' : ''}
      <p class="hint" style="margin:8px 0 0">${isPerson ? 'A picture is not proof of identity. Deep Dive investigates this person, not only that page.' : 'Deep Dive investigates this selection. The identifying page is a starting point, not a boundary.'}</p>
      <button class="btn primary sel-cta" type="button" data-go-dive="1">Deep Dive</button>
    </div>
  </div></div>`;
}
function visualCandidatesFromResults() {
  if (Array.isArray(lastVisualCandidates) && lastVisualCandidates.length) return lastVisualCandidates;
  if (Array.isArray(lastDiscoveryMeta?.visualCandidates) && lastDiscoveryMeta.visualCandidates.length) return lastDiscoveryMeta.visualCandidates;
  if ((lastClassification?.type || currentSubject) !== 'person') return [];
  return lastResults.filter(r => {
    if (!r) return false;
    if (r.resultKind === 'AGGREGATOR' || r.resultKind === 'JUNK' || r.resultKind === 'WEAK_MATCH') return false;
    return !!(r.image || (r.images && r.images.length));
  }).slice(0, 6);
}
function visualDedupeKey(url) {
  return String(url || '').replace(/[?#].*$/, '').replace(/\/cdn-cgi\/image\/[^/]+\//, '/').toLowerCase();
}
function mergeVisuals(prior, next) {
  const out = [];
  const seen = new Set();
  for (const im of [...(prior || []), ...(next || [])]) {
    if (!im) continue;
    const key = visualDedupeKey(im.url || im.src || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(im);
  }
  return out.slice(0, 96);
}
function videoDedupeKey(url) {
  const s = String(url || '');
  const yt = s.match(/[?&]v=([\w-]{6,})/) || s.match(/youtu\.be\/([\w-]{6,})/) || s.match(/youtube\.com\/embed\/([\w-]{6,})/);
  if (yt) return 'yt:' + yt[1];
  const vim = s.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vim) return 'vm:' + vim[1];
  return visualDedupeKey(s);
}
function mergeVideos(prior, next) {
  const out = [];
  const seen = new Set();
  for (const v of [...(prior || []), ...(next || [])]) {
    if (!v) continue;
    const key = v.videoId || videoDedupeKey(v.url || v.pageUrl || v.embedUrl || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.slice(0, 48);
}
function loadMeasurements() {
  try { return JSON.parse(localStorage.getItem(MEASURE_KEY) || '{}') || {}; } catch { return {}; }
}
function saveMeasurementsFromForm() {
  const m = {
    height: $('mHeight')?.value.trim() || '',
    chest: $('mChest')?.value.trim() || '',
    waist: $('mWaist')?.value.trim() || '',
    hips: $('mHips')?.value.trim() || '',
    shoulder: $('mShoulder')?.value.trim() || '',
    inseam: $('mInseam')?.value.trim() || '',
    sleeve: $('mSleeve')?.value.trim() || '',
    neck: $('mNeck')?.value.trim() || '',
    torso: $('mTorso')?.value.trim() || '',
    shoe: $('mShoe')?.value.trim() || '',
    notes: $('mNotes')?.value.trim() || '',
    updatedAt: new Date().toISOString(),
    provenance: 'USER-PROVIDED',
  };
  const has = Object.keys(m).some(k => k !== 'updatedAt' && k !== 'provenance' && m[k]);
  if (!has) { localStorage.removeItem(MEASURE_KEY); return null; }
  localStorage.setItem(MEASURE_KEY, JSON.stringify(m));
  return m;
}
function fillMeasurementsForm() {
  const m = loadMeasurements();
  if ($('mHeight')) $('mHeight').value = m.height || '';
  if ($('mChest')) $('mChest').value = m.chest || '';
  if ($('mWaist')) $('mWaist').value = m.waist || '';
  if ($('mHips')) $('mHips').value = m.hips || '';
  if ($('mShoulder')) $('mShoulder').value = m.shoulder || '';
  if ($('mInseam')) $('mInseam').value = m.inseam || '';
  if ($('mSleeve')) $('mSleeve').value = m.sleeve || '';
  if ($('mNeck')) $('mNeck').value = m.neck || '';
  if ($('mTorso')) $('mTorso').value = m.torso || '';
  if ($('mShoe')) $('mShoe').value = m.shoe || '';
  if ($('mNotes')) $('mNotes').value = m.notes || '';
}
function measurementsForRequest() {
  const m = loadMeasurements();
  const filled = {};
  for (const [k, v] of Object.entries(m)) {
    if (k === 'updatedAt' || k === 'provenance') continue;
    if (v) filled[k] = v;
  }
  if (!Object.keys(filled).length) return null;
  filled.provenance = 'USER-PROVIDED';
  return filled;
}
function renderVisualCorpus() {
  const el = $('visualCorpus');
  if (!el) return;
  const visuals = (lastVisuals.length ? lastVisuals : (lastDiscoveryMeta?.visuals || lastDiscoveryMeta?.visualCorpus || [])).filter(im => im && (im.url || im.src) && /^https?:|^data:image\//i.test(im.url || im.src));
  lastVisuals = visuals;
  const failures = (lastDiscoveryMeta && lastDiscoveryMeta.extractionFailures) || lastResults.filter(r => r.imageExtraction && r.imageExtraction.extractionFailed);
  if (!visuals.length && !failures.length) {
    el.innerHTML = '';
    return;
  }
  const gallery = visuals.map(im => ({
    src: imgSrc(im.url || im.src),
    cap: [im.title || im.caption || im.reason, im.domain, im.pageUrl || im.url].filter(Boolean).join(' · '),
    pageUrl: im.pageUrl || im.url || '',
    url: im.url,
    title: im.title || im.caption || '',
    domain: im.domain || '',
  }));
  const scale = (lastCorpusScale && lastCorpusScale.label) ? lastCorpusScale.label : (visuals.length + ' images · ' + lastVideos.length + ' videos · ' + lastResults.length + ' sources');
  const moreHint = lastCorpusScale && lastCorpusScale.moreAvailable ? ' · more available' : '';
  el.innerHTML = `<div class="card" style="padding-top:12px">
    <h3 style="margin:0 0 6px">Visuals <span class="badge">${visuals.length}</span></h3>
    <p class="corpus-scale">${esc(scale)}${moreHint && !/more available/i.test(scale) ? esc(moreHint) : ''}</p>
    <p class="hint">Research objects, not decoration. Visual likeness is not identity proof. Nothing is saved unless you choose Save.</p>
    <div class="gallery dense">${visuals.slice(0, 48).map((im, i) => {
      const sel = selectedVisual && visualDedupeKey(selectedVisual.url) === visualDedupeKey(im.url);
      return `<button type="button" class="visual-tile${sel ? ' selected' : ''}" data-visual="${i}" style="padding:0;border:${sel ? '1px solid var(--accent)' : '1px solid var(--line)'};background:transparent;text-align:left">
        <img src="${esc(imgSrc(im.url))}" alt="${esc(im.title || '')}" referrerpolicy="no-referrer" onerror="this.style.display='none'">
        <div class="vcap">${esc((im.domain || '') + (im.visualClass ? ' · ' + im.visualClass : '') + (im.title ? ' · ' + String(im.title).slice(0, 48) : ''))}</div>
      </button>`;
    }).join('')}</div>
    ${failures.length ? failures.slice(0, 8).map(f => {
      const url = f.url || f.pageUrl || '';
      const domain = f.domain || '';
      return `<div class="person-rel" data-testid="extraction-failed">
        <b>${esc(f.title || domain || 'Source')}</b>
        <p class="warning">Source found, but images could not be extracted from this page.</p>
        ${url ? `<div class="row" style="margin-top:8px"><a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open source</a></div>` : ''}
      </div>`;
    }).join('') : ''}
    <div class="row" style="margin-top:10px">
      <button class="btn" data-visual-act="more">More images</button>
      <button class="btn" data-visual-act="different">Find different</button>
      <button class="btn" data-visual-act="similar">Find similar</button>
      <button class="btn" data-visual-act="sameperson">Same person</button>
      <button class="btn" data-visual-act="sameconcept">Same concept</button>
      <button class="btn" data-visual-act="samesource">Same source</button>
    </div>
  </div>`;
  el._gallery = gallery;
}
function renderVideoCorpus() {
  const el = $('videoCorpus');
  if (!el) return;
  const videos = lastVideos.length ? lastVideos : (lastDiscoveryMeta?.videos || lastDiscoveryMeta?.videoCorpus || []);
  lastVideos = videos;
  if (!videos.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="card" style="padding-top:12px">
    <h3 style="margin:0 0 6px">Videos <span class="badge">${videos.length}</span></h3>
    <p class="hint">Longer public material ranks above clips and trailers. Carmen never invents playback.</p>
    ${videos.slice(0, 18).map((v, i) => {
      const dur = v.durationLabel ? `<span class="badge">${esc(v.durationLabel)}</span> ` : '';
      const thumb = v.thumbnail ? `<img src="${esc(imgSrc(v.thumbnail))}" alt="" referrerpolicy="no-referrer">` : '';
      const open = v.pageUrl || v.url || '';
      return `<div class="video-tile" data-video="${i}">
        ${thumb}
        <div class="vmeta" style="padding:10px 12px">
          <b>${esc(v.title || v.domain || 'Video')}</b><br>
          <small>${dur}${esc(v.domain || '')}${v.reason ? ' · ' + esc(v.reason) : ''}</small>
          <div class="row" style="margin-top:8px">
            ${v.playable && v.embedUrl ? `<button class="btn primary" data-video-act="play" data-i="${i}">Play</button>` : ''}
            <a class="btn" href="${esc(open)}" target="_blank" rel="noopener noreferrer" style="text-align:center">Open source</a>
            <button class="btn" data-video-act="save" data-i="${i}">Save</button>
            <button class="btn" data-video-act="not" data-i="${i}">Not this</button>
          </div>
          ${v.playable && v.embedUrl ? `<div class="hidden" data-video-embed="${i}"><iframe src="${esc(v.embedUrl)}" allow="encrypted-media; picture-in-picture" allowfullscreen title="${esc(v.title || 'Video')}" style="width:100%;aspect-ratio:16/9;border:0;background:#000"></iframe></div>` : ''}
        </div>
      </div>`;
    }).join('')}
    <div class="row" style="margin-top:10px">
      <button class="btn" data-video-more="1">More videos</button>
      <button class="btn" data-video-act="different-set">Find different videos</button>
    </div>
  </div>`;
}
function renderPersonRail() {
  const el = $('personRail');
  if (!el) return;
  const isPerson = (lastClassification?.type || currentSubject) === 'person';
  const cands = visualCandidatesFromResults();
  lastVisualCandidates = cands;
  if ($('identifyHint')) {
    if (!isPerson) $('identifyHint').textContent = 'Tap a candidate to investigate. Deep Dive expands that selected entity.';
    else if (!cands.length) $('identifyHint').textContent = 'No public visual references yet. Tap a source card. Visual resemblance is not identity proof.';
    else if (cands.length > 1) $('identifyHint').textContent = 'Several visual candidates. Tap the person you mean. Visual resemblance is not identity proof.';
    else $('identifyHint').textContent = 'Tap the face that matches. Visual resemblance is not identity proof.';
  }
  if (!isPerson || !cands.length) { el.innerHTML = ''; return; }
  const subjectName = lastClassification?.subject || researchSubject || 'Person';
  el.innerHTML = `<div class="person-rail">` + cands.map(r => {
    const i = lastResults.findIndex(x => x.url === r.url);
    const idx = i >= 0 ? i : lastResults.indexOf(r);
    const imgs = [...new Set([r.image, ...(r.images || [])].filter(Boolean))].slice(0, 5);
    const hero = imgs[0];
    const selected = (selectedCandidate && selectedCandidate.url === r.url) || (selectedEntity && selectedEntity.url === r.url);
    const kind = r.resultKind || '';
    const ctx = extraContextText(lastClassification);
    return `<article class="person-tile${selected ? ' selected' : ''}" data-testid="person-tile" data-identify="${idx}" data-i="${idx}" data-source-url="${esc(r.url || '')}">
      ${hero ? `<img class="hero" data-testid="result-image" data-identify="${idx}" src="${esc(imgSrc(hero))}" alt="${esc(subjectName)}" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ''}
      <div class="rbody">
        <p class="pname">${esc(subjectName)}</p>
        <div class="subtle">${esc(r.domain || hostOf(r.url))}</div>
        ${r.reason ? `<div class="rwhy">${esc(r.reason)}</div>` : ''}
        <p class="hint" style="margin:8px 0 0">A picture is not proof of identity.</p>
        <div class="racts">
          <button data-ract="select" data-testid="identity-confirm" data-i="${idx}">${selected ? 'That’s the one' : 'That’s the one'}</button>
          <button data-ract="dive" data-testid="result-deep-dive" data-i="${idx}">Deep Dive</button>
          <button data-ract="notperson" data-testid="identity-reject" data-i="${idx}">Not this one</button>
        </div>
      </div>
    </article>`;
  }).join('') + `</div>`;
}
function renderDiveIdentity() {
  const el = $('diveIdentity');
  if (!el) return;
  const ent = selectedEntity;
  const r = selectedCandidate;
  if (!ent && !r) {
    el.innerHTML = '<p class="muted">Search and pick someone or something first. Deep Dive investigates that selection.</p>';
    return;
  }
  const name = ent?.canonicalName || lastClassification?.subject || r?.title || 'Selected entity';
  const img = ent?.image || r?.image || '';
  const ctx = ent?.context || diveTopic || extraContextText(lastClassification) || currentLens()?.context || '';
  const isPerson = (ent?.type || lastClassification?.type) === 'person';
  const conf = ent?.confidence || lastClassification?.confidence || '';
  if ($('diveSearchHint') && name) {
    $('diveSearchHint').textContent = ctx
      ? ('Keeping “' + name + '” + “' + ctx + '”.')
      : ('Search this investigation of “' + name + '”. Topics keep this subject.');
  }
  el.innerHTML = `<div class="dive-id">
    ${img ? `<img src="${esc(imgSrc(img))}" alt="" referrerpolicy="no-referrer">` : ''}
    <div class="body">
      <h2>${esc(name)}</h2>
      <div class="rmeta">${currentAdult !== 'off' ? adultBadge(ent?.adultContent || currentAdult) : ''}${ctx ? ' <span class="badge">' + esc(ctx) + '</span>' : ''}${conf ? ' <span class="badge">' + esc(confidenceLabel(conf)) + '</span>' : ''}${identityVerdict === 'confirmed' ? ' <span class="badge access-ok">That’s the one</span>' : ''}</div>
      <p class="hint" style="margin:8px 0 0">${isPerson ? 'A picture is not proof of identity. Search below keeps this person — type a topic, not a new name, unless you want to branch.' : 'Investigating the selected subject. Search below keeps this context.'}</p>
    </div>
  </div>`;
  renderIdentityBanner();
  renderDiveTabs();
}
function goToDive() {
  if (!selectedEntity) {
    const candidate = selectedCandidate || lastResults[0] || null;
    if (!candidate && !$('searchQuery')?.value.trim()) return toast('Search and select a person first.');
    if (candidate && !selectedCandidate) {
      const i = Math.max(0, lastResults.findIndex(x => x.url === candidate.url));
      selectCandidate(candidate, i, { silent: true });
    }
  }
  setTab('dive');
  renderDiveIdentity();
  renderDiveStream();
  openDivePlanner(selectedCandidate);
  pushTrail({
    kind: 'dive',
    label: 'Deep Dive · ' + (selectedEntity?.canonicalName || lastClassification?.subject || 'subject'),
    entity: selectedEntity?.canonicalName || '',
    topic: diveTopic,
  });
}
function selectCandidate(r, i, opts = {}) {
  selectedCandidate = r || null;
  selectedEntity = r ? resolveSelectedEntity(r) : null;
  document.querySelectorAll('#results .result, #personRail .person-tile').forEach(el => {
    el.classList.toggle('selected', el.dataset.i === String(i));
  });
  renderSelectedBanner();
  renderPersonRail();
  renderDiveIdentity();
  updateDeepDiveState();
  persistSelection(r);
  persistSession();
  if (!opts.silent) {
    identityVerdict = 'confirmed';
    const name = selectedEntity?.canonicalName || r?.title || lastClassification?.subject || '';
    if (name && !confirmedIdentity.includes(name)) confirmedIdentity = [...confirmedIdentity, name].slice(-6);
    pushTrail({ kind: 'identity', label: 'That’s the one · ' + name, entity: name, topic: diveTopic });
    const isPerson = (selectedEntity?.type || lastClassification?.type) === 'person';
    toast(isPerson ? 'That’s the one. Later retrieval will prefer this identity.' : 'Selected. Deep Dive is ready.');
    persistSession();
    if (isPerson && name) {
      discover({ keepSubject: true, entity: name, topic: diveTopic, append: true });
    }
  }
}
async function persistSelection(r) {
  if (!currentProjectId || !sessionBoundProject || !r) return;
  try {
    const disc = (await all('discoveries')).find(d => d.id === currentProjectId) || { id: currentProjectId, projectId: currentProjectId };
    disc.selectedUrl = r.url;
    disc.selectedEntity = selectedEntity;
    disc.originalQuery = originalQuery;
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
  if (!c && !selectedEntity && !$('searchQuery')?.value.trim()) return;
  const type = lastClassification?.type || selectedEntity?.type || c?.entityType || currentSubject || 'topic';
  const paths = (lastDiscoveryMeta?.paths && lastDiscoveryMeta.paths.length) ? lastDiscoveryMeta.paths : lastPaths;
  lastPaths = paths.length ? paths : lastPaths;
  diveAll = true;
  selectedDivePathIds = lastPaths.map(p => p.id);
  const name = selectedEntity?.canonicalName || lastClassification?.subject || c?.title || $('searchQuery')?.value || 'this subject';
  const ctx = extraContextText(lastClassification) || currentLens()?.context || '';
  if ($('diveAdultNote')) {
    $('diveAdultNote').textContent = 'Adult-first research is the default. Specialist sources are used when they are relevant — not a random adult feed.';
  }
  $('divePlannerLead').innerHTML = `<p style="margin:0 0 8px"><b>What do you want to find out about ${esc(name)}?</b></p>${ctx ? '<p class="hint" style="margin:0 0 8px">Keeping “' + esc(ctx) + '” in the research.</p>' : ''}`;
  if (!selectedInvestigationId) selectedInvestigationId = 'everything';
  renderDiveSelectChips();
  el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function renderDiveSelectChips() {
  const el = $('diveSelectChips');
  if (!el) return;
  const list = (lastInvestigationChoices && lastInvestigationChoices.length)
    ? lastInvestigationChoices
    : [
        { id: 'everything', label: 'Everything', paths: ['all'] },
        { id: 'question', label: 'Custom question', question: true, paths: [] },
      ];
  if (!lastInvestigationChoices.length) lastInvestigationChoices = list;
  const id = selectedInvestigationId || 'everything';
  el.innerHTML = list.map(c => `<button class="chip${c.id === id ? ' active' : ''}" data-investigation="${esc(c.id)}">${esc(c.label)}</button>`).join('');
  const choice = list.find(c => c.id === id);
  $('diveQuestionWrap')?.classList.toggle('hidden', !(choice && choice.question));
}
function renderExpansionNote(data) {
  const el = $('diveExpansionNote');
  if (!el) return;
  const exp = (data && data.expansion) || lastExpansion;
  if (!exp) {
    el.classList.add('hidden');
    return;
  }
  if (exp.learnedSomething === false || data && data.noNewSources) {
    el.classList.remove('hidden');
    el.innerHTML = '<b>No new sources found from the remaining search paths.</b> Carmen did not rerun the same search.';
    return;
  }
  const bits = [];
  if (exp.genuinelyNew) bits.push(exp.genuinelyNew + ' new');
  if (exp.duplicatesRemoved) bits.push(exp.duplicatesRemoved + ' duplicates removed');
  if (exp.queryEchoesRemoved) bits.push(exp.queryEchoesRemoved + ' query echoes removed');
  if (exp.newEntitiesDiscovered) bits.push(exp.newEntitiesDiscovered + ' new entities');
  if (exp.newDomainsDiscovered) bits.push(exp.newDomainsDiscovered + ' new domains');
  if (!bits.length) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = '<b>Expansion:</b> ' + bits.join(' · ') + (exp.lens ? ' · ' + esc(String(exp.lens).replace(/^dive-/, '')) : '');
}

async function runDiveLens(lens) {
  const entity = selectedEntity?.canonicalName || lastClassification?.subject || researchSubject || '';
  if (!entity) return toast('Search and pick a subject first.');
  let id = String(lens || '').toLowerCase();
  if (id === 'clothing') id = 'visuals';
  if (!['bondage', 'people', 'visuals'].includes(id)) return;
  activeDiveLens = id;
  document.querySelectorAll('#divePrimaryLenses .btn').forEach(b => {
    if (b.id === 'diveFindMoreBtn') return;
    b.classList.toggle('active', (b.id || '').toLowerCase().includes(id));
  });
  const inherited = extraContextText(lastClassification) || (id === 'bondage' ? 'bondage' : (diveTopic || ''));
  const topic = id === 'bondage' ? 'bondage' : inherited;
  if (id === 'bondage') diveTopic = 'bondage';
  if ($('diveLensHint')) {
    $('diveLensHint').textContent = id === 'bondage'
      ? 'Investigating bondage through sources, productions, and people already found — not “' + entity + ' bondage” again.'
      : (id === 'people'
        ? 'Looking for people connected to this investigation. Relationships stay OBSERVED / SUPPORTED / INFERRED / UNKNOWN.'
        : 'Looking for additional and alternate images, galleries, and provenance for this investigation — not generic images.');
  }
  pushTrail({ kind: 'dive-lens', label: 'Deep Dive · ' + id, entity, topic });
  setTab('dive');
  setAgentState({ view: 'dive', lens: id, status: 'loading', busy: true });
  await discover({
    keepSubject: true,
    entity,
    topic,
    append: true,
    diveLens: id,
    mode: 'dive-' + id,
    findMore: false,
  });
}

function selectInvestigation(id) {

  selectedInvestigationId = id || 'everything';
  const choice = (lastInvestigationChoices || []).find(c => c && c.id === selectedInvestigationId);
  if (choice && Array.isArray(choice.paths) && choice.paths.length) {
    if (choice.paths.includes('all') || selectedInvestigationId === 'everything') {
      diveAll = true;
      selectedDivePathIds = (lastPaths || []).map(p => p.id);
    } else {
      diveAll = false;
      selectedDivePathIds = choice.paths.slice();
    }
  } else if (selectedInvestigationId === 'everything' || selectedInvestigationId === 'all') {
    diveAll = true;
    selectedDivePathIds = (lastPaths || []).map(p => p.id);
  }
  renderDiveSelectChips();
  if (['bondage', 'people', 'visuals', 'clothing'].includes(selectedInvestigationId)) {
    runDiveLens(selectedInvestigationId === 'clothing' ? 'visuals' : selectedInvestigationId);
  }
}

function toggleDivePath(id) {
  if (id === 'all' || id === 'everything') selectInvestigation('everything');
  else selectInvestigation(id);
}
function openLightbox(src, cap, gallery, index, sourceUrl) {
  const box = $('lightbox');
  if (!box) return;
  lightboxGallery = Array.isArray(gallery) && gallery.length ? gallery : [{ src, cap, pageUrl: sourceUrl || '' }];
  lightboxIndex = Math.max(0, index || 0);
  showLightboxSlide();
  box.classList.remove('hidden');
  box.removeAttribute('hidden');
  box.removeAttribute('inert');
  box.removeAttribute('aria-hidden');
}
function showLightboxSlide() {
  const item = lightboxGallery[lightboxIndex] || lightboxGallery[0];
  if (!item) return;
  $('lightboxImg').src = item.src || item.url || '';
  const n = lightboxGallery.length;
  const loc = n > 1 ? (lightboxIndex + 1) + ' of ' + n : '';
  if ($('lightboxPos')) $('lightboxPos').textContent = loc;
  $('lightboxCap').textContent = (item.cap || item.caption || 'Image keeps its page provenance. Visual consistency is not identity proof.') + (loc ? ' · ' + loc : '');
  lightboxSourceUrl = item.pageUrl || item.sourceUrl || '';
  if ($('lightboxPrev')) $('lightboxPrev').disabled = lightboxIndex <= 0;
  if ($('lightboxNext')) $('lightboxNext').disabled = lightboxIndex >= n - 1;
  const rel = $('lightboxRelated');
  if (rel) {
    rel.innerHTML = lightboxGallery.slice(Math.max(0, lightboxIndex - 4), lightboxIndex + 8).map((x, k) => {
      const abs = Math.max(0, lightboxIndex - 4) + k;
      return `<img src="${esc(x.src || x.url || '')}" data-lrel="${abs}" class="${abs === lightboxIndex ? 'on' : ''}" alt="" referrerpolicy="no-referrer">`;
    }).join('');
  }
}
function lightboxStep(d) {
  const n = lightboxGallery.length;
  if (!n) return;
  lightboxIndex = Math.max(0, Math.min(n - 1, lightboxIndex + d));
  showLightboxSlide();
}
function currentLightboxVisual() {
  const item = lightboxGallery[lightboxIndex] || {};
  return {
    url: item.url || item.src || '',
    pageUrl: item.pageUrl || lightboxSourceUrl || '',
    title: item.title || item.cap || item.caption || '',
    caption: item.caption || item.cap || '',
    domain: item.domain || hostOf(item.pageUrl || lightboxSourceUrl || ''),
  };
}
function rejectVisual(im) {
  if (!im) return;
  const url = im.url || im.src || '';
  if (url) suppressed.urls.push(url);
  if (url && !(suppressed.images || []).includes(url)) suppressed.images = [...(suppressed.images || []), url];
  if (im.pageUrl) suppressed.urls.push(im.pageUrl);
  lastVisuals = lastVisuals.filter(x => visualDedupeKey(x.url) !== visualDedupeKey(url));
  renderVisualCorpus();
  pushTrail({ kind: 'identity', label: 'Not this image', entity: lastClassification?.subject || '' });
  discover({ visualMode: 'different', seedVisual: im, findDifferent: true });
}
function rejectPerson(r) {
  if (!r) return;
  if (r.url) suppressed.urls.push(r.url);
  const host = r.domain || hostOf(r.url || r.pageUrl || '');
  if (host) suppressed.hosts.push(host);
  const label = r.title || host || r.url || 'rejected candidate';
  if (!rejectedPeople.includes(label)) rejectedPeople = [...rejectedPeople, label].slice(-12);
  lastResults = lastResults.filter(x => x.url !== r.url);
  lastVisualCandidates = lastVisualCandidates.filter(x => x.url !== r.url);
  if (selectedCandidate && selectedCandidate.url === r.url) {
    selectedCandidate = null;
    selectedEntity = null;
    identityVerdict = null;
  }
  renderResults(lastResults, lastDiscoveryMeta?.providers || {});
  renderPersonRail();
  renderIdentityBanner();
  persistSession();
  pushTrail({ kind: 'identity', label: 'Not this person · ' + label, entity: lastClassification?.subject || '' });
  discover({ visualMode: 'different', findDifferent: true, keepSubject: !!(lastClassification?.subject), entity: lastClassification?.subject || '', topic: diveTopic });
}
function closeLightbox() {
  const box = $('lightbox');
  if (!box) return;
  box.classList.add('hidden');
  box.setAttribute('hidden', '');
  box.setAttribute('inert', '');
  box.setAttribute('aria-hidden', 'true');
  $('lightboxImg').src = '';
  lightboxGallery = [];
}
function renderSearchDiagnostics(data) {
  const el = $('searchDiagnostics');
  if (!el) return;
  const providers = (data && data.providers) || {};
  const m = data && data.researchMetrics;
  const bits = [];
  for (const [k, v] of Object.entries(providers)) {
    if (!v || typeof v !== 'object') continue;
    const ok = v.ok === true || (typeof v.added === 'number' && v.added > 0) || v.ran === true;
    const bad = v.ok === false || v.error || (v.status && v.status >= 400);
    if (!ok && !bad && v.status == null && v.ran == null) continue;
    const label = k + (v.status ? ' ' + v.status : '') + (v.error ? ' ' + String(v.error).slice(0, 40) : '') + (typeof v.added === 'number' ? ' +' + v.added : '');
    bits.push(`<span class="${ok && !bad ? 'ok' : (bad ? 'bad' : '')}">${esc(label)}</span>`);
  }
  if (m) {
    bits.push(`<span>${Number(m.resultCount || 0)} results</span>`);
    if (m.reservedLanes && m.reservedLanes.reddit) bits.push('<span class="ok">Reddit reserved lane</span>');
    if (m.reservedLanes && m.reservedLanes.adultIdentity) bits.push('<span class="ok">Adult identity lane</span>');
    if (m.fallbackUsage && m.fallbackUsage.redditIndexed) bits.push('<span class="ok">Indexed Reddit</span>');
    if (m.fallbackUsage && m.fallbackUsage.pullpush) bits.push('<span class="ok">Pullpush</span>');
    if (m.fallbackUsage && m.fallbackUsage.wayback) bits.push('<span class="ok">Wayback</span>');
    if (Array.isArray(m.redditProvenance) && m.redditProvenance.length) bits.push(`<span>${esc(m.redditProvenance.join(', '))}</span>`);
  }
  el.innerHTML = bits.join(' · ');
}
function renderInvestigationTrace(data) {
  const checked = (data && data.whatCarmenChecked) || lastWhatChecked;
  const stop = (data && data.whyDidYouStop) || lastWhyStop;
  const identity = (data && data.entityIdentity) || lastEntityIdentity;
  const rejected = (data && data.rejectedCandidates) || lastRejected || [];
  const fill = (checkedEl, stopEl) => {
    if (checkedEl) {
      checkedEl.innerHTML = checked
        ? `<p>${esc(checked.summary || '')}</p>${(checked.queries && checked.queries.length) ? '<ul class="trail-list">' + checked.queries.slice(0, 12).map(q => `<li>${esc(q.q || '')}<div class="subtle">${esc(q.why || q.lane || '')}</div></li>`).join('') + '</ul>' : ''}${identity ? `<p class="hint">Resolved: ${esc(identity.canonicalName || '')} · ${esc(identity.type || '')} · confidence ${esc(identity.confidence || '')}</p>` : ''}${rejected.length ? `<p class="hint">Considered and rejected: ${rejected.slice(0, 4).map(r => esc((r.title || r.url || '') + (r.reason ? ' — ' + r.reason : ''))).join('; ')}</p>` : ''}`
        : '<p class="muted">No investigation trace yet.</p>';
    }
    if (stopEl) {
      stopEl.innerHTML = stop
        ? `<p><b>Why did you stop?</b> ${esc(stop.headline || '')}</p><p class="hint">${esc(stop.detail || '')}${stop.notFoundVsNotSearched ? ' · ' + esc(String(stop.notFoundVsNotSearched)) : ''}</p>`
        : '';
    }
  };
  fill($('whatCarmenChecked'), $('whyDidYouStop'));
  fill($('diveWhatCarmenChecked'), $('diveWhyDidYouStop'));
}
function renderVariationChips(data) {
  const vars = (data && data.variations) || lastVariations || [];
  const html = vars.length
    ? '<p class="flabel">Variations</p><div class="chips">' + vars.map(v => `<button class="chip" type="button" data-variation="${esc(v.label)}">${esc(v.label)}</button>`).join('') + '</div>'
    : '';
  if ($('variationChips')) $('variationChips').innerHTML = html;
  if ($('diveVariationChips')) $('diveVariationChips').innerHTML = vars.length
    ? vars.map(v => `<button class="chip" type="button" data-variation="${esc(v.label)}">${esc(v.label)}</button>`).join('')
    : '';
}
function evidenceBadges(r) {
  const ev = r && r.evidence || {};
  const bits = [];
  if (ev.subjectEvidence && ev.subjectEvidence !== 'none') bits.push(`<span class="ev-badge">subject ${esc(ev.subjectEvidence)}</span>`);
  if (ev.topicEvidence && ev.topicEvidence !== 'none') bits.push(`<span class="ev-badge">topic ${esc(ev.topicEvidence)}</span>`);
  if ((ev.intersection && ev.intersection !== 'none') || r.intersection) bits.push(`<span class="ev-badge">∩ ${esc(ev.intersection || 'strong')}</span>`);
  if (ev.role && ev.role !== 'DISCOVERY_LEAD') bits.push(`<span class="ev-badge">${esc(ev.role.replace(/_/g, ' '))}</span>`);
  else if (ev.isDiscoveryLead || r.isDiscoveryLead) bits.push(`<span class="ev-badge">discovery lead</span>`);
  if (r && r.ownershipClass && r.ownershipClass !== 'UNKNOWN') bits.push(`<span class="ev-badge">${esc(r.ownershipClass)}</span>`);
  if (r && r.accountOwnership && r.accountOwnership !== 'unknown' && !r.ownershipClass) bits.push(`<span class="ev-badge">${esc(r.accountOwnership)}</span>`);
  if (r && r.accountPlatform && r.accountPlatform !== 'UNKNOWN') bits.push(`<span class="ev-badge">${esc(r.accountPlatform)}</span>`);
  return bits.join(' ');
}
function provenanceRow(r) {
  if (!r) return '';
  const host = r.host || r.domain || hostOf(r.url) || 'UNKNOWN';
  const pub = r.publisher || 'UNKNOWN';
  const creator = r.creator || 'UNKNOWN';
  const orig = r.originalSource || 'UNKNOWN';
  const repost = r.reposter && r.reposter !== 'UNKNOWN' ? ' · reposter ' + r.reposter : '';
  const mirror = r.mirror && r.mirror !== 'UNKNOWN' ? ' · mirror ' + r.mirror : '';
  return `<div class="prov-row">host ${esc(host)} · publisher ${esc(pub)} · creator ${esc(creator)} · original ${esc(orig)}${esc(repost)}${esc(mirror)}</div>`;
}
function sourceClassLabel(key) {
  const map = {
    'identity-profile': 'Identity / profile',
    identity: 'Identity / profile',
    DATABASE: 'Identity database',
    PRIMARY: 'Primary source',
    PUBLIC_PROFILE: 'Public profile',
    ENCYCLOPEDIA: 'Encyclopedia',
    'creator-owned': 'Creator-owned',
    'major-platform': 'Major adult platforms',
    'major-video-platform': 'Major adult video platforms',
    'premium-subscription': 'Premium / subscription',
    'premium-subscription': 'Premium / subscription',
    'creator-store': 'Creator stores',
    'fetish-publisher': 'Specialist BDSM / fetish publishers',
    'studio-producer': 'Studios / producers',
    video: 'Video',
    'images-galleries': 'Images / galleries',
    'community-social': 'Community / social',
    reddit: 'Reddit',
    directories: 'Directories',
    interviews: 'Interviews / articles',
    collaborators: 'Collaborators / related people',
    'related-sites': 'Related websites',
    intersection: 'Subject × topic',
    site: 'Site',
    'known-site': 'Known site',
    other: 'Other public sources',
  };
  return map[key] || String(key || 'Other').replace(/[-_]/g, ' ');
}
function renderTopicMap(map) {
  const el = $('topicMap');
  if (!el) return;
  const tm = map || lastTopicMap;
  if (!tm || !Array.isArray(tm.branches) || !tm.branches.length) {
    el.innerHTML = '';
    return;
  }
  const subj = tm.subject || lastClassification?.subject || '';
  const topic = tm.topic || extraContextText(lastClassification) || '';
  const title = tm.findEverything
    ? ('Topic map' + (subj ? ' · ' + subj : '') + (topic ? ' × ' + topic : ''))
    : (tm.premiumAccounts ? 'Premium accounts map' : (tm.knownEntity ? 'Known site map' : 'Investigation map'));
  const diag = lastDiscoveryMeta && lastDiscoveryMeta.corpusDiagnosis;
  const diversity = lastDiscoveryMeta && lastDiscoveryMeta.sourceDiversity;
  el.innerHTML = `<div class="topic-map-head"><b>${esc(title)}</b>
    ${diag && diag.status && diag.status !== 'ok' ? `<p class="hint">Retrieval status: ${esc(diag.label || diag.status)}. This is not automatically a thin public corpus.</p>` : ''}
    ${lastDiscoveryMeta && lastDiscoveryMeta.redditEvidence === 'unavailable' ? '<p class="hint">Reddit evidence unavailable — search pages are not counted as posts.</p>' : ''}
  </div>` + tm.branches.filter(b => Number(b.results || 0) > 0 || (b.status && b.status !== 'pending' && b.status !== 'unexplored' && b.status !== 'thin')).map(b => {
    const n = Number(b.results || 0);
    return `<div class="topic-branch" data-branch="${esc(b.id)}">
      <div class="tb-h"><b>${esc(b.label)}</b><span class="ev-badge">${esc(b.status || 'observed')}${n ? ' · ' + n : ''}</span></div>
    </div>`;
  }).join('');
}
function resultCardHtml(r, i, isPersonType) {
  const imgs = [...new Set([r.image, ...(r.images || [])].filter(Boolean))].slice(0, 6);
  const hero = imgs[0];
  const rest = imgs.slice(1, 5);
  const selected = (selectedCandidate && selectedCandidate.url === r.url) || (selectedEntity && (selectedEntity.discoveryEvidence?.url === r.url || selectedEntity.url === r.url));
  const kind = r.resultKind || (r.intersection ? 'INTERSECTION_MATCH' : '');
  const kindLabel = resultKindLabel(kind);
  const personCard = isPersonType || r.entityType === 'person';
  const displayName = personCard ? (lastClassification?.subject || r.title) : r.title;
  const ev = evidenceBadges(r);
  return `<div class="result${selected ? ' selected' : ''}${personCard ? ' person' : ''}${r.intersection ? ' direct' : ''}" data-testid="result-card" data-source-url="${esc(r.url || '')}" data-i="${i}"${personCard ? ` data-identify="${i}"` : ''}>
      ${hero ? `<img class="hero" data-testid="result-image"${personCard ? ` data-identify="${i}"` : ''} data-full="${esc(imgSrc(hero))}" data-cap="${esc((r.domain || '') + ' · ' + (r.url || ''))}" src="${esc(imgSrc(hero))}" alt="${esc(displayName)}" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ''}
      <div class="rbody">
        <div class="rtitle">${esc(displayName)}</div>
        <div class="rmeta">
          <span class="badge">${esc(r.source || 'Public web')}</span>
          ${r.accessState ? `<span class="badge">${esc(r.accessState)}</span>` : ''}
          ${r.matchQuality ? `<span class="badge">${esc(r.matchQuality)}</span>` : ''}
          ${r.contentType && r.contentType !== 'source' ? `<span class="badge">${esc(r.contentType)}</span>` : ''}
        </div>
        <div class="subtle">${esc(r.domain || hostOf(r.url))}</div>
        ${ev ? `<div class="rmeta">${ev}</div>` : ''}
        ${r.reason ? `<div class="rwhy">${esc(r.reason)}</div>` : ''}
        ${personCard ? `<p class="hint">A picture is not proof of identity.</p>` : ''}
        ${r.accessNote ? `<p class="warning">${esc(r.accessNote)}</p>` : ''}
        ${r.imageExtraction && r.imageExtraction.extractionFailed ? `<p class="warning">Source found, but images could not be extracted from this page.</p>` : ''}
        ${r.publicEvidence ? `<p class="hint">Public evidence (not protected content): ${esc(r.publicEvidence)}</p>` : ''}
        ${r.snippet ? `<div class="rsnippet">${esc(r.snippet)}</div>` : ''}
        ${provenanceRow(r)}
        ${rest.length ? `<div class="thumbs">${rest.map(u => `<img data-full="${esc(imgSrc(u))}" data-cap="${esc((r.domain || '') + ' · ' + (r.url || ''))}" src="${esc(imgSrc(u))}" alt="" referrerpolicy="no-referrer">`).join('')}</div>` : ''}
        <div class="racts">
          <button data-ract="select" data-testid="${personCard ? 'identity-confirm' : 'result-select'}" data-i="${i}">${selected ? (personCard ? 'That’s the one' : 'Selected') : (personCard ? 'That’s the one' : 'Select')}</button>
          <button data-ract="dive" data-testid="result-deep-dive" data-i="${i}">Deep Dive</button>
          <button data-ract="save" data-testid="result-save" data-i="${i}">Save</button>
          <button data-ract="open" data-testid="result-open" data-source-url="${esc(r.url || '')}" data-i="${i}">Open source</button>
          ${personCard ? `<button data-ract="notperson" data-testid="identity-reject" data-i="${i}">Not this person</button>` : ''}
        </div>
      </div>
    </div>`;
}
function renderResults(results, providers) {
  $('resultCount').textContent = results.length ? String(results.length) : '';
  renderSearchDiagnostics(lastDiscoveryMeta || { providers });
  if (!results.length) {
    $('results').innerHTML = '';
    if ($('personRail')) $('personRail').innerHTML = '';
    const diag = lastDiscoveryMeta && lastDiscoveryMeta.corpusDiagnosis;
    $('resultsEmpty').textContent = diag && diag.status && diag.status !== 'ok'
      ? ('No public-web candidates. Retrieval status: ' + (diag.label || diag.status) + '.')
      : 'No public-web candidates were returned. Diagnostics below show which sources responded.';
    $('resultsEmpty').classList.remove('hidden');
    updateDeepDiveState();
    return;
  }
  $('resultsEmpty').classList.add('hidden');
  const isPersonType = (lastClassification?.type || currentSubject) === 'person';
  renderPersonRail();
  const organize = !!(lastTopicMap && (lastTopicMap.findEverything || lastTopicMap.premiumAccounts || (lastTopicMap.branches && lastTopicMap.branches.length >= 4)));
  if (organize) {
    const groups = new Map();
    results.forEach((r, i) => {
      const key = r.plannerSourceClass || r.sourceClass || r.discoveryLane || 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ r, i });
    });
    let html = '';
    for (const [key, rows] of groups) {
      html += `<div class="topic-branch"><div class="tb-h"><b>${esc(sourceClassLabel(key))}</b><span class="ev-badge">${rows.length}</span></div></div>`;
      html += rows.map(x => resultCardHtml(x.r, x.i, isPersonType)).join('');
    }
    $('results').innerHTML = html;
  } else {
    $('results').innerHTML = results.map((r, i) => resultCardHtml(r, i, isPersonType)).join('');
  }
  renderSearchSuggestions(results);
  renderVisualCorpus();
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
  if (!results || !results.length) {
    el.innerHTML = '';
    return;
  }
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
  if ((results || []).length >= 3 && lastResults.length >= 3) {
    notes.push('Carmen found ' + results.length + ' public candidates. Choose what to investigate.');
  }
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

function composeInvestigationQuery(q, entity, topic) {
  const query = String(q || '').trim();
  const ent = String(entity || '').replace(/"/g, '').trim();
  const top = String(topic || '').replace(/"/g, '').trim();
  if (!ent) return query;
  const qLower = query.toLowerCase();
  const entLower = ent.toLowerCase();
  const topLower = top.toLowerCase();
  if (query && qLower.includes(entLower)) {
    if (top && !qLower.includes(topLower)) return (query + ' ' + top).replace(/\s+/g, ' ').trim();
    return query;
  }
  const extra = (top && topLower !== entLower) ? top : query;
  if (extra && extra.toLowerCase() !== entLower) return (ent + ' ' + extra).replace(/\s+/g, ' ').trim();
  return ent || query;
}
function mergeResultsByUrl(prior, next) {
  const out = [];
  const seen = new Set();
  for (const r of [...(prior || []), ...(next || [])]) {
    if (!r) continue;
    const key = String(r.url || '').replace(/[?#].*$/, '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out.slice(0, 80);
}
function resultIsReddit(r) {
  const h = (r && (r.domain || hostOf(r.url))) || '';
  return h === 'reddit.com' || h.endsWith('.reddit.com') || /reddit/i.test(String(r && r.source || '')) || r?.retrievalLane === 'indexed-reddit' || r?.retrievalLane === 'direct-reddit' || r?.retrievalLane === 'pullpush';
}
function pushTrail(step) {
  if (!step || !step.label) return;
  const last = investigationTrail[investigationTrail.length - 1];
  if (last && last.label === step.label && last.kind === step.kind) return;
  investigationTrail = [...investigationTrail, { ...step, at: new Date().toISOString() }].slice(-24);
  persistSession();
}
function resetInvestigationContext() {
  investigationTrail = [];
  diveTopic = '';
  identityVerdict = null;
  surpriseReason = '';
  diveTab = 'overview';
  activeDiveLens = '';
  lastExpansion = null;
  lastRelatedPeople = [];
  lastClothingEvidence = [];
  pendingPhoto = null;
  currentSubject = '';
  currentLensId = 'everything';
  lastLenses = [];
  lastInvestigationChoices = [];
  lastPaths = [];
  lastFoundThrough = null;
  selectedInvestigationId = 'everything';
  if ($('diveSearchQuery')) $('diveSearchQuery').value = '';
  if ($('diveCustom')) $('diveCustom').value = '';
  if ($('diveExpansionNote')) $('diveExpansionNote').classList.add('hidden');
  if ($('diveLensHint')) $('diveLensHint').textContent = 'Tap a shortcut, type anything, or Find More to expand from new evidence.';
  if ($('howHerePanel')) $('howHerePanel').classList.add('hidden');
  if ($('surpriseWhy')) $('surpriseWhy').classList.add('hidden');
  if ($('teachPanel')) $('teachPanel').classList.add('hidden');
  if ($('analyzePanel')) $('analyzePanel').classList.add('hidden');
  if ($('suggestBar')) $('suggestBar').innerHTML = '';
  if ($('variationChips')) $('variationChips').innerHTML = '';
  if ($('diveVariationChips')) $('diveVariationChips').innerHTML = '';
  if ($('whatCarmenChecked')) $('whatCarmenChecked').innerHTML = '';
  if ($('whyDidYouStop')) $('whyDidYouStop').innerHTML = '';
  if ($('diveWhatCarmenChecked')) $('diveWhatCarmenChecked').innerHTML = '';
  if ($('diveWhyDidYouStop')) $('diveWhyDidYouStop').innerHTML = '';
  if ($('visualCorpus')) $('visualCorpus').innerHTML = '';
  if ($('videoCorpus')) $('videoCorpus').innerHTML = '';
  if ($('graphTrail')) { $('graphTrail').innerHTML = ''; $('graphTrail').classList.add('hidden'); }
  if ($('identityBanner')) $('identityBanner').innerHTML = '';
  if ($('resultsEmpty')) {
    $('resultsEmpty').textContent = 'Public sources will appear here after Search.';
    $('resultsEmpty').classList.remove('hidden');
  }
}
function hardNewInvestigation(opts = {}) {
  discoverGen++;
  clearTimeout(progressiveTimer);
  if (inFlightController) {
    try { inFlightController.abort(); } catch {}
    inFlightController = null;
  }
  selectedCandidate = null;
  selectedEntity = null;
  lastResults = [];
  lastVisualCandidates = [];
  lastVisuals = [];
  lastVideos = [];
  selectedVisual = null;
  suppressed = { urls: [], hosts: [], images: [] };
  attemptedQueries = [];
  lastPremium = [];
  lastRetrievalTrace = null;
  lastWhatChecked = null;
  lastWhyStop = null;
  lastVariations = [];
  lastEntityIdentity = null;
  lastRejected = [];
  lastClassification = null;
  lastDiscoveryMeta = null;
  lastTopicMap = null;
  lastCorpusScale = null;
  lastConcepts = [];
  lastResearchState = null;
  lastDivePayload = null;
  originalQuery = '';
  researchSubject = '';
  confirmedIdentity = [];
  rejectedPeople = [];
  identityVerdict = null;
  currentProjectId = null;
  sessionBoundProject = false;
  resetInvestigationContext();
  if ($('searchQuery')) $('searchQuery').value = '';
  if ($('homeQuery')) $('homeQuery').value = '';
  if ($('results')) $('results').innerHTML = '';
  if ($('personRail')) $('personRail').innerHTML = '';
  if ($('topicMap')) $('topicMap').innerHTML = '';
  if ($('selectedBanner')) $('selectedBanner').innerHTML = '';
  if ($('classBar')) $('classBar').innerHTML = '';
  if ($('diveStream')) $('diveStream').innerHTML = '';
  if ($('resultCount')) $('resultCount').textContent = '';
  if ($('searchDiagnostics')) $('searchDiagnostics').textContent = '';
  if ($('diveIdentity')) $('diveIdentity').innerHTML = '<p class="muted">Search and pick someone or something first. Deep Dive investigates that selection.</p>';
  try { sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY_LEGACY); } catch {}
  persistSession();
  setAgentState({
    status: 'idle',
    busy: false,
    results: 0,
    error: '',
    lens: '',
    saved: '',
    howHere: 'closed',
    investigation: carmenNewInvestigationId(),
  });
  updateDeepDiveState();
  if (!opts.silent) toast('New investigation. Saved collections stay. Live search state is cleared.');
  if (!opts.stay) setTab('home');
}
function currentFoundThrough() {
  const last = investigationTrail[investigationTrail.length - 1];
  return {
    entity: selectedEntity?.canonicalName || lastClassification?.subject || '',
    topic: diveTopic || extraContextText(lastClassification) || '',
    query: originalQuery || $('searchQuery')?.value || '',
    via: last?.label || 'search',
    parentId: lastSavedItemId || null,
    trail: investigationTrail.slice(-8),
  };
}
function renderDiveTabs() {
  const el = $('diveTabs');
  if (!el) return;
  el.querySelectorAll('[data-divetab]').forEach(b => b.classList.toggle('active', b.dataset.divetab === diveTab));
}
function setDiveTab(id) {
  diveTab = id || 'overview';
  renderDiveTabs();
  renderDiveStream();
  persistSession();
}
function streamItemsForTab() {
  const posts = (lastResults || []).filter(resultIsReddit);
  const web = (lastResults || []).filter(r => !resultIsReddit(r));
  if (diveTab === 'posts') return { results: posts, images: [], videos: [], redditFirst: true };
  if (diveTab === 'images') return { results: [], images: lastVisuals, videos: [], redditFirst: false };
  if (diveTab === 'sources') return { results: lastResults, images: [], videos: [], redditFirst: false };
  if (diveTab === 'search') return { results: lastResults, images: lastVisuals.slice(0, 8), videos: lastVideos.slice(0, 6), redditFirst: false };
  const ordered = [...posts, ...web];
  return { results: ordered.length ? ordered : lastResults, images: lastVisuals.slice(0, 6), videos: lastVideos.slice(0, 4), redditFirst: true };
}
function findMoreActions(i, kind) {
  return '';
}
function renderDiveStream() {
  const el = $('diveStream');
  if (!el) return;
  const pack = streamItemsForTab();
  const results = pack.results || [];
  const imgs = pack.images || [];
  const videos = pack.videos || [];
  const entity = selectedEntity?.canonicalName || lastClassification?.subject || '';
  const ctx = diveTopic || extraContextText(lastClassification) || '';
  const n = results.length + imgs.length + videos.length;
  if (!entity && !n) {
    el.innerHTML = '<div class="card"><p class="muted">Public material for this investigation will appear here as a stream. Search first, then Deep Dive.</p></div>';
    return;
  }
  const why = surpriseReason ? `<div class="surprise-why">${esc(surpriseReason)}</div>` : '';
  const exhausted = lastDiscoveryMeta && (lastDiscoveryMeta.noNewMedia || lastDiscoveryMeta.noNewSources);
  const head = `<div class="stream-head"><b>${n ? n + ' public ' + (n === 1 ? 'item' : 'items') : 'No items yet'}</b><span class="subtle">${esc(entity)}${ctx ? ' + ' + esc(ctx) : ''}${exhausted ? (lastDiscoveryMeta.noNewSources ? ' · no new sources from this angle' : ' · reached the end of useful public results') : ''}</span></div>`;

  const postHtml = results.map((r, i) => {
    const reddit = resultIsReddit(r);
    const host = r.domain || hostOf(r.url);
    const sub = reddit ? (String(r.url || '').match(/reddit\.com\/r\/([^/]+)/i) || [])[1] : '';
    const img = r.image || (r.images && r.images[0]) || '';
    return `<article class="stream-post" data-stream="${i}">
      <div class="sp-meta">
        <span class="badge">${esc(reddit ? ('r/' + (sub || host.replace(/\.reddit\.com$/, '') || 'reddit')) : (r.source || host || 'web'))}</span>
        ${r.intersection ? '<span class="badge access-ok">entity ∩ topic</span>' : ''}
        ${r.resultKind ? '<span class="badge">' + esc(resultKindLabel(r.resultKind) || r.resultKind) + '</span>' : ''}
        ${r.accessState ? accessBadge(r.accessState) : ''}
      </div>
      ${img ? `<img class="sp-img" src="${esc(imgSrc(img))}" alt="" referrerpolicy="no-referrer" data-full="${esc(imgSrc(img))}" onerror="this.style.display='none'">` : ''}
      <div class="sp-title">${esc(r.title || host)}</div>
      <div class="sp-body">${esc(r.snippet || r.reason || '')}${r.reason && r.snippet ? '<div class="rwhy">' + esc(r.reason) + '</div>' : ''}</div>
      <div class="sp-acts">
        <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Open</a>
        <button type="button" data-stream-act="save" data-i="${i}">Save</button>
        <button type="button" data-stream-act="analyze" data-i="${i}">Analyze</button>
        <button type="button" data-stream-act="teach" data-i="${i}">Teach me</button>
      </div>
      ${findMoreActions(i, 'result')}
    </article>`;
  }).join('');
  const imgHtml = imgs.length && (diveTab === 'overview' || diveTab === 'images' || diveTab === 'search')
    ? `<div class="gallery dense" style="margin-bottom:12px">${imgs.slice(0, diveTab === 'images' ? 48 : 12).map((im, i) => `<img src="${esc(imgSrc(im.url || im.src))}" data-stream-img="${i}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">`).join('')}</div>`
    : '';
  const vidHtml = videos.length && (diveTab === 'overview' || diveTab === 'search')
    ? videos.slice(0, 4).map((v, i) => `<article class="stream-post">
        ${v.thumbnail ? `<img class="sp-img" src="${esc(imgSrc(v.thumbnail))}" alt="" referrerpolicy="no-referrer">` : ''}
        <div class="sp-title">${esc(v.title || 'Video')}</div>
        <div class="sp-body">${esc(v.domain || '')} · ${esc(v.durationLabel || 'length unknown')} · Carmen does not invent playback.</div>
        <div class="sp-acts">
          <a href="${esc(v.pageUrl || v.url)}" target="_blank" rel="noopener noreferrer">Open source</a>
          <button type="button" data-stream-vid="save" data-i="${i}">Save</button>
          <button type="button" data-stream-vid="analyze" data-i="${i}">Analyze</button>
        </div>
        ${findMoreActions(i, 'video')}
      </article>`).join('')
    : '';
  const people = (lastRelatedPeople || []).filter(p => p && p.name && p.observationState !== 'UNKNOWN');
  const peopleHtml = people.length && (diveTab === 'overview' || activeDiveLens === 'people')
    ? '<div class="stream-head" style="margin-top:8px"><b>Connected people</b></div>' + people.map(p => `<div class="person-rel"><b>${esc(p.name)}</b> <span class="badge">${esc(p.role || 'person')}</span> <span class="badge ${esc((p.observationState || 'UNKNOWN').toLowerCase())}">${esc(p.observationState || 'UNKNOWN')}</span><div class="why">${esc(p.why || 'Connected through retrieved evidence.')}</div></div>`).join('')
    : (activeDiveLens === 'people' && !people.length && (diveTab === 'overview') ? '<p class="hint">No connected people with relationship evidence yet. Co-occurrence on a search page is not a relationship.</p>' : '');
  const clothes = (lastClothingEvidence || []).filter(c => c && (c.term || c.observationState === 'UNKNOWN'));
  const clothHtml = activeDiveLens === 'clothing' && (diveTab === 'overview')
    ? (clothes.some(c => c.term)
      ? '<div class="stream-head" style="margin-top:8px"><b>Clothing / outfits</b></div>' + clothes.filter(c => c.term).map(c => `<div class="person-rel"><b>${esc(c.term)}</b> <span class="badge ${esc((c.observationState || 'UNKNOWN').toLowerCase())}">${esc(c.observationState || 'UNKNOWN')}</span><div class="why">${esc(c.why || '')}</div></div>`).join('')
      : '<p class="hint">Clothing remains UNKNOWN — no visually verified garments yet. Carmen will not pretend an outfit was confirmed from a title keyword.</p>')
    : '';

  el.innerHTML = `<div class="card">${why}${head}${n ? '' : '<p class="muted">No public material on this tab yet. Search this investigation or switch tabs.</p>'}${peopleHtml}${clothHtml}${imgHtml}${postHtml}${vidHtml}${exhausted ? '<p class="hint">' + (lastDiscoveryMeta && lastDiscoveryMeta.noNewSources ? 'No new sources found from this angle. Carmen did not manufacture expansion by rewording the same search.' : 'Carmen stopped because remaining results were repeats or empty — not because the investigation is finished forever.') + '</p>' : ''}</div>`;

}
function renderIdentityBanner() {
  const el = $('identityBanner');
  if (!el) return;
  const isPerson = (selectedEntity?.type || lastClassification?.type || currentSubject) === 'person';
  const cands = visualCandidatesFromResults();
  if (!isPerson || cands.length < 2 || identityVerdict === 'confirmed') {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<div class="identity-banner"><b>I found a few possibilities.</b>
    <p class="hint" style="margin:6px 0 0">Carmen will not silently pick one. Tap That’s the one or Not this one. A picture is not proof of identity.</p></div>`;
}
function renderHowHere() {
  const panel = $('howHerePanel');
  const list = $('howHereList');
  if (!panel || !list) return;
  if (!investigationTrail.length) {
    list.innerHTML = '<p class="muted">This is the start of this investigation.</p>';
    return;
  }
  list.innerHTML = '<ul class="trail-list">' + investigationTrail.map((t, i) => {
    return `<li><button type="button" class="quiet-link" data-trail="${i}">${esc(t.label)}</button><div class="subtle">${esc(t.topic ? (t.entity ? t.entity + ' + ' + t.topic : t.topic) : (t.entity || t.query || ''))}</div></li>`;
  }).join('') + '</ul><p class="hint">Tap a previous point to jump back. The graph stays in the background.</p>';
}
function jumpTrail(i) {
  const step = investigationTrail[i];
  if (!step) return;
  investigationTrail = investigationTrail.slice(0, i + 1);
  diveTopic = step.topic || '';
  if (step.query && $('searchQuery')) $('searchQuery').value = step.entity && step.topic ? composeInvestigationQuery(step.topic, step.entity, step.topic) : (step.query || step.entity || '');
  if ($('diveSearchQuery')) $('diveSearchQuery').value = diveTopic;
  if (step.kind === 'branch' || (step.query && !step.entity)) {
    setTab('search');
    discover();
  } else {
    setTab('dive');
    discover({ keepSubject: true, entity: step.entity || selectedEntity?.canonicalName, topic: diveTopic });
  }
}
function routeDiveRequest(text) {
  const raw = String(text || '').trim();
  const t = raw.toLowerCase();
  if (!raw) return { mode: '', lens: '', topic: '' };
  if (/\b(dive[- ]?bondage|investigate bondage|bondage (?:path|lens|deep dive|work|material)|in bondage|bdsm (?:work|material|scenes?)|go deeper on the bondage)\b/i.test(t)) {
    return { mode: 'dive-bondage', lens: 'bondage', topic: 'bondage' };
  }
  if (/\b(dive[- ]?people|related people|collaborators?|who else|connected (?:to|with)|other people|every other person|find related people)\b/i.test(t)) {
    return { mode: 'dive-people', lens: 'people', topic: diveTopic || '' };
  }
  if (/\b(dive[- ]?visuals?|investigate visuals?|more images?|alternate images?|image provenance|original source|find (?:all |more )?images?|find images from|galleries|sources we haven'?t checked)\b/i.test(t)) {
    return { mode: 'dive-visuals', lens: 'visuals', topic: diveTopic || '' };
  }
  if (/\b(find more|keep looking|go deeper|haven'?t checked)\b/i.test(t)) {
    return { mode: 'find-more', lens: '', topic: diveTopic || raw };
  }
  if (/\bpremium accounts?\b/i.test(t)) {
    return { mode: 'premium-accounts', lens: '', topic: 'premium accounts' };
  }
  const topicHit = raw.match(/\b(career|filmography|credits|interviews?|videos?|productions?)\b/i);
  if (topicHit) return { mode: 'intersection', lens: '', topic: topicHit[1] };
  return { mode: 'intersection', lens: '', topic: raw };
}
async function investigateTopic(topic) {
  const t = String(topic || $('diveSearchQuery')?.value || $('diveCustom')?.value || '').trim();
  if (!t) return toast('Type what you want Carmen to find in this investigation.');
  const entity = selectedEntity?.canonicalName || lastClassification?.subject || researchSubject || '';
  if (!entity) {
    $('searchQuery').value = t;
    setTab('search');
    return discover();
  }
  const routed = routeDiveRequest(t);
  if (routed.lens) return runDiveLens(routed.lens);
  if (routed.mode === 'find-more') {
    pushTrail({ kind: 'find-more', label: 'Find more', entity, topic: routed.topic || diveTopic });
    return discover({
      keepSubject: true,
      entity,
      topic: routed.topic || diveTopic || extraContextText(lastClassification) || '',
      expanded: true,
      append: true,
      findMore: true,
      mode: 'find-more',
    });
  }
  diveTopic = routed.topic || t;
  if (selectedEntity) selectedEntity.context = diveTopic;
  if ($('diveSearchQuery')) $('diveSearchQuery').value = t;
  if ($('diveCustom') && !$('diveCustom').value.trim()) $('diveCustom').value = t;
  if ($('diveSearchHint')) $('diveSearchHint').textContent = 'Searching “' + entity + '” + “' + diveTopic + '”. Carmen keeps this subject.';
  setTab('dive');
  await discover({ keepSubject: true, entity, topic: diveTopic, mode: routed.mode || 'intersection' });
}
function likeThisTraits(item) {
  const traits = [];
  const host = (item && (item.domain || hostOf(item.url || item.pageUrl || ''))) || '';
  const blob = String((item && (item.title || '')) + ' ' + (item && (item.snippet || item.caption || item.reason || ''))).toLowerCase();
  const entity = String(selectedEntity?.canonicalName || lastClassification?.subject || '').toLowerCase();
  if (resultIsReddit(item) || /reddit\.com/.test(host)) traits.push('discussion');
  if (/\binterview|podcast|ama|transcript\b/.test(blob)) traits.push('interview');
  if (/\bphoto|gallery|photoset|image|still\b/.test(blob) || item?.image) traits.push('photos');
  if (/\bvideo|clip|watch|scene\b/.test(blob) || item?.mediaKind === 'video' || item?.kind === 'video') traits.push('video');
  if (diveTopic) traits.push(diveTopic);
  const stop = new Set(['this', 'that', 'with', 'from', 'https', 'http', 'www', 'reddit', 'imgur', 'watch', 'video', 'html', 'index', entity, ...entity.split(/\s+/)]);
  const words = blob.split(/[^a-z0-9]+/).filter(w => w.length > 3 && !stop.has(w) && !/^\d+$/.test(w));
  for (const w of words) {
    if (traits.length >= 4) break;
    if (!traits.includes(w)) traits.push(w);
  }
  return traits.slice(0, 4);
}
async function findMore(kind, item) {
  const entity = selectedEntity?.canonicalName || lastClassification?.subject || '';
  const host = (item && (item.domain || hostOf(item.url || item.pageUrl || ''))) || '';
  lastFoundThrough = { kind, itemUrl: item?.url || item?.pageUrl || '', host, entity, topic: diveTopic };
  if (kind === 'who') {
    const name = entity || String(item?.title || '').split(/\s[\-–—|·]\s/)[0].trim();
    if (!name) return toast('Not enough public evidence to ask who this is.');
    $('searchQuery').value = name;
    currentSubject = 'person';
    setTab('search');
    pushTrail({ kind: 'find-more', label: 'Who is this? → ' + name, entity: name });
    return discover();
  }
  if (kind === 'person') {
    if (!entity) return toast('Select a person first.');
    diveTopic = '';
    if ($('diveSearchQuery')) $('diveSearchQuery').value = '';
    pushTrail({ kind: 'find-more', label: 'More from ' + entity, entity });
    return discover({ keepSubject: true, entity, expanded: true, append: true, findMore: true, moreFromThisPerson: true, mode: 'more-from-this-person' });
  }
  if (kind === 'like') {
    const traits = likeThisTraits(item);
    if (!traits.length) return toast('Not enough public characteristics to find similar material.');
    const topic = diveTopic || extraContextText(lastClassification) || traits.join(' ');
    pushTrail({ kind: 'more-like-this', label: 'More like this · ' + topic, entity, topic });
    return discover({ keepSubject: !!entity, entity, topic, append: true, moreLikeThis: true, mode: 'more-like-this', seedVisual: item });
  }
  if (kind === 'similar') {
    pushTrail({ kind: 'find-similar', label: 'Find similar', entity, topic: diveTopic });
    return discover({ keepSubject: !!entity, entity, topic: diveTopic, append: true, findSimilar: true, mode: 'find-similar', visualMode: 'similar', seedVisual: item });
  }
  if (kind === 'visual') {
    pushTrail({ kind: 'search-this-visual', label: 'Search this visual', entity, topic: diveTopic });
    return discover({ keepSubject: !!entity, entity, topic: diveTopic, append: true, searchThisVisual: true, mode: 'search-this-visual', visualMode: 'searchvisual', seedVisual: item });
  }
  if (kind === 'topic') {
    const topic = diveTopic || extraContextText(lastClassification);
    if (!topic) return toast('No topic to expand yet.');
    pushTrail({ kind: 'more-on-this-topic', label: 'More on this topic · ' + topic, entity, topic });
    return discover({ keepSubject: !!entity, entity, topic, append: true, moreOnThisTopic: true, mode: 'more-on-this-topic' });
  }
  if (kind === 'subject') {
    const topic = diveTopic || extraContextText(lastClassification) || entity;
    if (!topic) return toast('No subject to expand yet.');
    pushTrail({ kind: 'find-more', label: 'Find more · ' + topic, entity, topic });
    return discover({ keepSubject: !!entity, entity, topic, expanded: true, append: true, findMore: true, mode: 'find-more' });
  }
  if (kind === 'source') {
    if (!host) return toast('No public host to follow.');
    pushTrail({ kind: 'find-more', label: 'More from ' + host + ' (host, not necessarily the creator)', entity, topic: host });
    toast('This is the hosting site. The creator or original publisher may be someone else.');
    return discover({ keepSubject: !!entity, entity, topic: diveTopic, append: true, moreFromThisSource: true, mode: 'more-from-this-source', seedVisual: item });
  }
  if (kind === 'different') {
    const exclHosts = [...new Set([host, ...(suppressed.hosts || []), ...((lastResults || []).map(x => x.domain || hostOf(x.url)).filter(Boolean))])].filter(Boolean).slice(0, 8);
    pushTrail({ kind: 'find-different', label: 'Find different sources' + (entity ? ' · ' + entity : ''), entity, topic: diveTopic });
    return discover({
      keepSubject: !!entity,
      entity,
      topic: diveTopic,
      append: true,
      findDifferent: true,
      mode: 'find-different',
      excludeHosts: exclHosts,
      excludeUrls: (lastResults || []).map(x => x.url).filter(Boolean).slice(0, 12),
    });
  }
  if (kind === 'surprise') return surpriseMe();
}
async function surpriseMe() {
  let items = [];
  try { items = await all('collectionItems'); } catch { items = []; }
  const terms = [];
  for (const it of items) {
    if (it.subject) terms.push(it.subject);
    if (it.topic) terms.push(it.topic);
    if (it.title) terms.push(String(it.title).split(/\s[\-–—|·]\s/)[0]);
  }
  for (const t of investigationTrail) {
    if (t.entity) terms.push(t.entity);
    if (t.topic) terms.push(t.topic);
  }
  if (selectedEntity?.canonicalName) terms.push(selectedEntity.canonicalName);
  if (diveTopic) terms.push(diveTopic);
  const cleaned = [...new Set(terms.map(s => String(s || '').trim()).filter(s => s.length > 2 && !/^site:/.test(s)))];
  if (!cleaned.length) {
    surpriseReason = 'No explicit saves, searches, or “more like this” yet — Surprise me stays empty rather than inventing a hidden preference model.';
    if ($('surpriseWhy')) { $('surpriseWhy').textContent = surpriseReason; $('surpriseWhy').classList.remove('hidden'); }
    if ($('surpriseWhyHome')) { $('surpriseWhyHome').textContent = surpriseReason; $('surpriseWhyHome').hidden = false; }
    return toast('Save or investigate a few things first. Surprise me learns from what you actually use — it is not random and not advertising.');
  }
  const current = (selectedEntity?.canonicalName || '').toLowerCase();
  const pick = cleaned.find(s => s.toLowerCase() !== current) || cleaned[Math.floor(Math.random() * cleaned.length)];
  const because = cleaned.slice(0, 3).join(', ');
  surpriseReason = 'Surprise me is a bounded heuristic: it prefers something you already saved, selected, or asked to expand — not a hidden preference model. Picked “' + pick + '” because you have been investigating: ' + because + '.';
  if ($('surpriseWhy')) { $('surpriseWhy').textContent = surpriseReason; $('surpriseWhy').classList.remove('hidden'); }
  if ($('surpriseWhyHome')) { $('surpriseWhyHome').textContent = surpriseReason; $('surpriseWhyHome').hidden = false; }
  pushTrail({ kind: 'surprise', label: 'Surprise me → ' + pick, query: pick, entity: selectedEntity?.canonicalName || '', topic: pick });
  if (selectedEntity?.canonicalName && pick.toLowerCase() !== current) {
    diveTopic = pick;
    if ($('diveSearchQuery')) $('diveSearchQuery').value = pick;
    setTab('dive');
    return investigateTopic(pick);
  }
  $('searchQuery').value = pick;
  setTab('search');
  return discover();
}
function streamResultAt(i) {
  return (streamItemsForTab().results || [])[i] || lastResults[i] || null;
}
async function teachAbout(item) {
  const subject = selectedEntity?.canonicalName || lastClassification?.subject || item?.title || '';
  const topic = diveTopic || extraContextText(lastClassification) || '';
  const q = [subject, topic, item && item.title !== subject ? item.title : ''].filter(Boolean).join(' — ');
  const panel = $('teachPanel');
  if (panel) {
    panel.classList.remove('hidden');
    panel.innerHTML = '<h3>Teach me</h3><p class="muted">Teaching from the current investigation context…</p>';
  }
  if ($('learnQuery')) $('learnQuery').value = q;
  currentLearnType = selectedEntity?.type || lastClassification?.type || currentLearnType || '';
  setTab('learn');
  await runLearn();
  pushTrail({ kind: 'teach', label: 'Teach me · ' + q, entity: subject, topic });
}
async function analyzeDiscoveryItem(item) {
  const panel = $('analyzePanel');
  if (!panel || !item) return toast('Nothing to analyze.');
  panel.classList.remove('hidden');
  const isVideo = item.kind === 'video' || item.mediaKind === 'video' || item.thumbnail || /youtube|vimeo|youtu\.be|\.mp4|xvideos|pornhub|redgifs/i.test(String(item.url || item.pageUrl || ''));
  const isImage = !!(item.imageDataUrl || (item.image && !isVideo && /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(String(item.url || item.image || ''))));
  let html = '<h3>Analyze</h3>';
  html += '<p class="hint">SOURCE FACTS are on the page. SUPPORTED FACTS are backed by retrieved text. INFERENCES are labeled. GENERAL BACKGROUND is not from this source. UNKNOWN stays unknown.</p>';
  if (isVideo) {
    html += '<div class="claim unknown"><b>UNKNOWN — video frames</b><br>Carmen cannot currently inspect the actual video frames. Timestamps are UNKNOWN until real frame analysis is available. This analysis uses the title, thumbnail, page metadata, and retrieved public pages — not a frame-by-frame watch.</div>';
  }
  html += `<div class="claim"><b>SOURCE FACTS</b><br>${esc(item.title || item.url || '')}<br>${esc(item.domain || hostOf(item.url || item.pageUrl || ''))}${item.snippet ? '<br>' + esc(item.snippet) : ''}</div>`;
  html += `<div class="claim inferred"><b>INFERRED</b><br>${esc(item.reason || 'Relevance is inferred from public title/snippet overlap with the current subject. That is not identity proof.')}</div>`;
  html += `<div class="claim unknown"><b>UNKNOWN</b><br>Creator vs host vs original publisher are not assumed to be the same. ${isVideo ? 'What happens in the video is unknown without frame analysis.' : 'Unretrieved page contents are unknown.'}</div>`;
  html += '<div class="row" style="margin-top:8px"><button class="btn" data-stream-close-analyze="1">Hide</button><button class="btn primary" data-findmore="like" data-kind="result" data-i="0">More like this</button><button class="btn" id="analyzeTeach">Teach me about this</button></div>';
  panel.innerHTML = html;
  $('analyzeTeach').onclick = () => teachAbout(item);
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const base = backendUrl();
  if (base) {
    try {
      const body = {
        kind: isVideo ? 'video' : (isImage ? 'webpage' : 'webpage'),
        url: item.url || item.pageUrl || '',
        pageUrl: item.pageUrl || item.url || '',
        title: item.title || '',
        snippet: item.snippet || item.textExcerpt || item.description || '',
        evidence: {
          url: item.url || item.pageUrl || '',
          title: item.title || '',
          snippet: item.snippet || '',
          domain: item.domain || hostOf(item.url || item.pageUrl || ''),
          kind: isVideo ? 'video' : (resultIsReddit(item) ? 'reddit' : 'webpage'),
        },
        subject: selectedEntity?.canonicalName || lastClassification?.subject || '',
        topic: diveTopic || extraContextText(lastClassification) || '',
      };
      if (item.imageDataUrl) body.imageDataUrl = item.imageDataUrl;
      const r = await fetch(base + '/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = { error: text || ('HTTP ' + r.status) }; }
      if (!r.ok) {
        panel.insertAdjacentHTML('beforeend', `<div class="claim unknown"><b>Analyze failed</b><br>${esc(data.error || ('HTTP ' + r.status))}</div>`);
      } else {
        const facts = (data.sourceFacts || data.observations || []).map(f => typeof f === 'string' ? f : (f.field ? f.field + ': ' + f.value : JSON.stringify(f))).slice(0, 8);
        const supported = (data.supportedFacts || []).map(f => typeof f === 'string' ? f : (f.value || JSON.stringify(f))).slice(0, 6);
        const inf = (data.inferences || []).map(f => typeof f === 'string' ? f : (f.value || JSON.stringify(f))).slice(0, 6);
        const unk = (data.unknowns || []).map(f => typeof f === 'string' ? f : (f.value || JSON.stringify(f))).slice(0, 6);
        const bg = (data.generalBackground || []).map(f => typeof f === 'string' ? f : (f.value || JSON.stringify(f))).slice(0, 4);
        let extra = '';
        if (data.kind) extra += `<p class="hint">Evidence kind: ${esc(data.kind)}</p>`;
        if (facts.length) extra += `<div class="claim"><b>SOURCE FACTS</b><br>${esc(facts.join(' · '))}</div>`;
        if (supported.length) extra += `<div class="claim"><b>SUPPORTED FACTS</b><br>${esc(supported.join(' · '))}</div>`;
        if (inf.length) extra += `<div class="claim inferred"><b>INFERENCES</b><br>${esc(inf.join(' · '))}</div>`;
        if (bg.length) extra += `<div class="claim"><b>GENERAL BACKGROUND</b><br>${esc(bg.join(' · '))}</div>`;
        if (unk.length) extra += `<div class="claim unknown"><b>UNKNOWN</b><br>${esc(unk.join(' · '))}</div>`;
        if (data.videoFrames && data.videoFrames.timestamps) extra += `<div class="claim unknown"><b>VIDEO FRAMES</b><br>${esc(data.videoFrames.note || 'Timestamps UNKNOWN')}</div>`;
        if (data.analysisError) extra += `<div class="claim unknown"><b>AI note</b><br>${esc(data.analysisError)}</div>`;
        if (extra) panel.insertAdjacentHTML('beforeend', extra);
      }
    } catch (e) {
      panel.insertAdjacentHTML('beforeend', `<div class="claim unknown"><b>UNKNOWN — analyze</b><br>${esc(e.message)}</div>`);
    }
  } else if (item.url) {
    try {
      const retrieved = await retrieveSource(item.url);
      const extra = retrieved && retrieved.status === 'RETRIEVED'
        ? `<div class="claim"><b>OBSERVED from page</b><br>${esc((retrieved.title || '') + ' — ' + String(retrieved.textExcerpt || retrieved.description || '').slice(0, 400))}</div>`
        : `<div class="claim unknown"><b>UNKNOWN — page body</b><br>${esc(retrieved && (retrieved.accessNote || retrieved.error) || 'The page could not be retrieved.')}</div>`;
      panel.insertAdjacentHTML('beforeend', extra);
    } catch (e) {
      panel.insertAdjacentHTML('beforeend', `<div class="claim unknown"><b>UNKNOWN — page body</b><br>${esc(e.message)}</div>`);
    }
  }
  pushTrail({ kind: 'analyze', label: 'Analyzed “' + (item.title || item.url || 'item') + '”', entity: selectedEntity?.canonicalName || '', topic: diveTopic });
}

/* ---------- deep dive workspace ---------- */
function openPlannerFromButton() {
  goToDive();
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
async function runDeepDive(opts = {}) {
  const continueFrom = opts.continueFrom || null;
  const analysisOnly = opts.analysisOnly === true;
  const further = opts.further === true;
  const base = backendUrl();
  if (!base) return toast('Set the Carmen Worker URL in Capture → Connection.');
  const subject = selectedEntity?.canonicalName || $('searchQuery').value.trim() || $('projectQuestion').value.trim();
  const seed = selectedEntity && diveTopic
    ? composeInvestigationQuery(originalQuery || diveTopic, selectedEntity.canonicalName, diveTopic)
    : (originalQuery || selectedEntity?.originalQuery || $('searchQuery').value.trim() || subject);
  const evidence = selectedEntity?.discoveryEvidence || selectedCandidate || null;
  const candidate = selectedCandidate
    || (evidence && evidence.url ? evidence : null)
    || (!selectedEntity && lastResults[0] ? lastResults[0] : null);
  if (!subject && !candidate && !selectedEntity) return toast('Search and select a candidate first.');
  localStorage.setItem(BACKEND_KEY, base);
  const btn = $('startDiveBtn');
  if (btn) btn.disabled = true;
  if ($('continueDiveBtn')) $('continueDiveBtn').disabled = true;
  if ($('retryAnalysisBtn')) $('retryAnalysisBtn').disabled = true;
  $('deepDiveBtn').disabled = true;
  if (candidate) selectCandidateKeepPlanner(candidate);
  setTab('dive');
  renderDiveIdentity();
  const customQuestion = $('diveCustom')?.value.trim() || '';
  if (customQuestion && !analysisOnly && !further && !continueFrom) {
    const routed = routeDiveRequest(customQuestion);
    if (routed.lens) {
      if (btn) btn.disabled = false;
      $('deepDiveBtn').disabled = false;
      return runDiveLens(routed.lens);
    }
    if (routed.topic) diveTopic = routed.topic;
  }
  const pathIds = diveAll ? ['all'] : selectedDivePathIds.slice();
  const useExpanded = expandedMode || !!$('diveExpanded')?.checked;
  const ctx = selectedEntity?.context || diveTopic || extraContextText(lastClassification) || '';
  const waitSteps = analysisOnly
    ? ['Retrying analysis of already-retrieved sources…', 'Keeping collected evidence…', 'Synthesizing findings…']
    : further
    ? ['Looking for unanswered questions…', 'Searching new source types…', 'Following related leads…', 'Collecting additional visuals…']
    : continueFrom
    ? ['Continuing research…', 'Retrieving the next evidence batch…', 'Comparing accumulated sources…', 'Synthesizing findings…']
    : ['Planning research…', 'Understanding concepts…', 'Finding independent sources…', 'Checking interviews…', 'Checking media…', 'Expanding related concepts…', 'Comparing evidence…', 'Synthesizing findings…'];
  $('deepDiveProgress').innerHTML = waitSteps.map((s, i) => '<p class="dive-step' + (i < 2 ? ' on' : '') + '">' + esc(s) + '</p>').join('');
  $('deepDiveResult').innerHTML = '<p class="muted">Deep Dive is a read-only research workspace. Carmen will not contact anyone or take external actions.</p>';
  let instructions = '';
  try {
    const p = (await all('projects')).find(x => x.id === currentProjectId);
    instructions = (p && p.instructions) || ($('projectInstructions') && $('projectInstructions').value.trim()) || '';
  } catch {}
  try {
    const body = {
      query: seed,
      originalQuery: seed,
      subject: selectedEntity?.type || currentSubject || lastClassification?.type || '',
      candidate,
      selectedEntity,
      context: ctx,
      topic: diveTopic || ctx,
      instructions,
      customQuestion,
      all: selectedInvestigationId === 'everything' || selectedInvestigationId === 'all' || diveAll,
      investigation: selectedInvestigationId || 'everything',
      paths: (selectedInvestigationId === 'everything' || selectedInvestigationId === 'all' || diveAll) ? ['all'] : selectedDivePathIds.slice(),
      expanded: useExpanded,
      adult: currentAdult,
      adultContent: currentAdult,
      depth: currentDepth,
      lens: currentLensId,
      selectedVisual: selectedVisual || null,
      measurements: measurementsForRequest(),
    };
    if (further) {
      body.further = true;
      body.investigateFurther = true;
      body.priorResults = lastDivePayload?.results || lastResults || [];
      body.priorRetrieved = lastDivePayload?.retrieved || [];
      body.graphLeads = lastDivePayload?.graphLeads || lastResearchState?.graphLeads || [];
      if (lastResearchState) body.continueFrom = lastResearchState;
    }
    if (continueFrom) {
      body.continueFrom = continueFrom;
      body.priorResults = lastDivePayload?.results || lastResults || [];
      body.priorRetrieved = lastDivePayload?.retrieved || [];
    }
    if (analysisOnly) {
      body.analysisOnly = true;
      body.retryAnalysis = true;
      body.priorResults = lastDivePayload?.results || lastResults || [];
      body.priorRetrieved = lastDivePayload?.retrieved || [];
      if (!body.continueFrom) body.continueFrom = { ...(lastResearchState || lastDivePayload?.researchState || {}), stage: 'analyze' };
    }
    const r = await fetch(base + '/dive', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { throw Error(text || `HTTP ${r.status}`); }
    if (!r.ok || data.error) throw Error(data.error || `HTTP ${r.status}`);
    if (Array.isArray(data.results) && data.results.length) {
      lastResults = data.results;
      renderResults(lastResults, data.providers || {});
    }
    renderDeepDivePayload(data, subject);
    persistSession();
    if (sessionBoundProject && currentProjectId) {
      await persistDiscoveryIfKept();
      const disc = (await all('discoveries')).find(d => d.id === currentProjectId) || { id: currentProjectId, projectId: currentProjectId };
      disc.deepDiveText = data.analysis || '';
      disc.deepDiveAt = new Date().toISOString();
      disc.deepDiveSubject = subject;
      disc.deepDiveFocusUrl = candidate?.url || selectedEntity?.url || '';
      disc.selectedEntity = selectedEntity;
      disc.originalQuery = seed;
      disc.deepDivePlan = data.plan;
      disc.deepDiveImages = data.images;
      disc.deepDiveVideos = data.videos;
      disc.visuals = data.visuals || data.visualCorpus || disc.visuals;
      disc.tutorials = data.tutorials;
      disc.deepDiveRetrieved = data.retrieved;
      disc.deepDiveRelated = data.related;
      disc.selectedPathIds = data.selectedPathIds || pathIds;
      disc.customQuestion = customQuestion;
      disc.adultContent = currentAdult;
      disc.paths = data.paths || lastPaths;
      disc.results = lastResults;
      disc.classification = data.classification || lastClassification;
      disc.graphLeads = data.graphLeads || [];
      disc.concepts = data.concepts || lastConcepts;
      disc.researchState = data.researchState || lastResearchState;
      disc.conceptGraph = data.conceptGraph || null;
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
    }
    toast(data.paused ? 'Research paused — more evidence available to continue. Nothing was auto-saved.' : 'Deep dive complete. Save if you want to keep this research.');
  } catch (e) {
    const msg = String(e.message || e);
    const isConfig = /API_KEY|not configured|provider is not configured/i.test(msg);
    $('deepDiveResult').innerHTML = `<div class="claim unknown"><b>Deep Dive unavailable</b><br>${esc(msg)}</div>${isConfig ? '<p class="hint">Search and evidence still work. AI analysis needs the Worker secret.</p>' : '<p class="hint">Non-AI investigation features remain available.</p>'}`;
    toast(isConfig ? 'AI not configured — search & evidence still work' : 'Deep dive failed: ' + msg);
  } finally {
    if (btn) btn.disabled = false;
    if ($('continueDiveBtn')) $('continueDiveBtn').disabled = false;
    if ($('retryAnalysisBtn')) $('retryAnalysisBtn').disabled = false;
    updateDeepDiveState();
  }
}
function selectCandidateKeepPlanner(candidate) {
  if (candidate) selectedCandidate = candidate;
  if (!selectedEntity && candidate) selectedEntity = resolveSelectedEntity(candidate);
  const url = candidate?.url || selectedEntity?.discoveryEvidence?.url || selectedEntity?.url || '';
  const i = url ? Math.max(0, lastResults.findIndex(x => x.url === url)) : -1;
  document.querySelectorAll('#results .result, #personRail .person-tile').forEach(el => el.classList.toggle('selected', el.dataset.i === String(i)));
  renderSelectedBanner();
}
function renderDeepDivePayload(data, subject) {
  const plan = data.plan || {};
  lastDivePayload = data;
  lastPaths = data.availablePaths || data.paths || lastPaths;
  if (Array.isArray(data.concepts)) lastConcepts = data.concepts;
  lastResearchState = data.researchState || lastResearchState;
  if (Array.isArray(data.premiumContent)) lastPremium = data.premiumContent;
  lastRetrievalTrace = data.retrievalTrace || lastRetrievalTrace;
  if (data.paused) lastResearchState = data.researchState || lastResearchState;
  if (Array.isArray(data.investigationChoices) && data.investigationChoices.length) lastInvestigationChoices = data.investigationChoices;
  if (Array.isArray(data.videos) || Array.isArray(data.videoCorpus)) lastVideos = mergeVideos(lastVideos, data.videos || data.videoCorpus || []);
  if (Array.isArray(data.visuals) || Array.isArray(data.visualCorpus) || Array.isArray(data.images)) {
    lastVisuals = mergeVisuals(lastVisuals, data.visuals || data.visualCorpus || data.images || []);
  }
  persistSession();
  $('deepDiveProgress').innerHTML = '';
  const contBtn = $('continueDiveBtn');
  if (contBtn) {
    const pending = !!(data.paused || (data.researchState && Array.isArray(data.researchState.pendingUrls) && data.researchState.pendingUrls.length));
    contBtn.classList.toggle('hidden', !pending);
  }
  const retryBtn = $('retryAnalysisBtn');
  if (retryBtn) {
    const fail = !!(data.analysisError || (data.researchState && (data.researchState.analysisStatus === 'failed' || data.researchState.analysisStatus === 'stub')));
    retryBtn.classList.toggle('hidden', !fail);
  }
  const furtherBtn = $('furtherDiveBtn');
  if (furtherBtn) furtherBtn.classList.remove('hidden');
  const tutBtn = $('makeTutorialBtn');
  if (tutBtn) tutBtn.classList.remove('hidden');
  diveWorkspaceTab = 'findings';
  renderDiveIdentity();
  renderDiveWorkspace(data, subject);
  renderInvestigationTrace(data);
  renderVariationChips(data);
}
function relatedListHtml(items, data) {
  const all = data.related || [];
  return items.map(rel => {
    const i = all.indexOf(rel);
    return `<div class="branch"><b>${esc(rel.label)}</b> <span class="badge">${esc(rel.kind || 'related')}</span><div class="subtle">${esc(rel.why || '')}${rel.domain ? ' · ' + esc(rel.domain) : ''}</div>${i >= 0 ? `<button class="btn primary" data-branch="${i}" style="margin-top:8px">Investigate this</button>` : ''}</div>`;
  }).join('');
}
function resultListHtml(items) {
  return items.map(r => `<div class="pattern"><b>${esc(r.title || r.label || r.url)}</b> ${r.resultKind ? '<span class="badge ' + resultKindClass(r.resultKind) + '">' + esc(resultKindLabel(r.resultKind) || r.resultKind) + '</span>' : ''}${r.intersection ? ' <span class="badge access-ok">entity ∩ context</span>' : ''}<br><small>${esc(r.domain || hostOf(r.url || ''))}${r.reason ? ' · ' + esc(r.reason) : ''}</small></div>`).join('');
}
function renderDiveWorkspace(data, subject) {
  const plan = (data && data.plan) || {};
  const imgs = (data.images || data.visuals || data.visualCorpus || []).slice(0, 48);
  const videos = data.videos || [];
  const tutorials = data.tutorials || videos.filter(v => /\b(tutorial|how to|howto|demonstration|lesson|guide)\b/i.test(String(v.title || '')));
  const retrieved = data.retrieved || [];
  const related = data.related || [];
  const leads = data.leads || [];
  const suggestions = data.suggestions || [];
  const writeup = data.analysis || data.lesson || '';
  const results = data.results || lastResults || [];
  const graphLeads = data.graphLeads || [];
  const blob = (x) => String((x && (x.kind || '')) + ' ' + (x && (x.label || x.title || '')) + ' ' + (x && (x.why || x.reason || ''))).toLowerCase();
  const tabs = [
    ['findings', 'Findings'],
    imgs.length ? ['images', 'Images'] : null,
    videos.length ? ['videos', 'Videos'] : null,
    tutorials.length ? ['tutorials', 'Tutorials'] : null,
    retrieved.length || results.length ? ['sources', 'Sources'] : null,
    (related.length || leads.length || graphLeads.length) ? ['explore', 'Explore'] : null,
    (data.premiumContent && data.premiumContent.length) || lastPremium.length ? ['premium', 'Premium'] : null,
  ].filter(Boolean);
  if (diveWorkspaceTab === 'overview' || diveWorkspaceTab === 'media') {
    diveWorkspaceTab = diveWorkspaceTab === 'media' ? (imgs.length ? 'images' : (videos.length ? 'videos' : 'findings')) : 'findings';
  }
  if (!tabs.some(t => t[0] === diveWorkspaceTab)) diveWorkspaceTab = tabs[0] ? tabs[0][0] : 'findings';
  const tabHtml = `<div class="ws-tabs">${tabs.map(([id, label]) => `<button class="chip${diveWorkspaceTab === id ? ' active' : ''}" data-wstab="${id}">${esc(label)}</button>`).join('')}</div>`;
  const suggestHtml = suggestions.length ? suggestions.map(s => `<div class="suggest">${esc(s)}</div>`).join('') : '';
  const access = data.access || {};
  const accessHtml = access.headline ? `<div class="access-banner"><b>${esc(access.headline)}</b>${access.paywalled || access.authenticationRequired || access.ageRestricted ? '<p class="hint">ACCESS RESTRICTED — Carmen does not bypass paywalls, logins, or age verification. Public titles, snippets, and thumbnails are referenced public evidence only.</p>' : ''}${!data.expanded && (access.paywalled || access.authenticationRequired || (access.inaccessible || []).length) ? '<p class="hint">PUBLIC ALTERNATIVES FOUND: Carmen continued researching publicly accessible sources.</p><div class="row" style="margin-top:8px"><button class="btn" data-expand-dive="1">Expanded Research</button></div>' : ''}</div>` : '';
  let body = '';
  const videoCard = (v) => {
    const dur = v.durationLabel ? `<span class="badge">${esc(v.durationLabel)}</span> ` : '';
    if (v.playable && v.embedUrl) {
      return `<div class="video-card"><iframe src="${esc(v.embedUrl)}" allow="encrypted-media; picture-in-picture" allowfullscreen title="${esc(v.title || 'Video')}"></iframe><div class="vmeta"><b>${esc(v.title || v.domain)}</b><br><small>${dur}${esc(v.domain)} · playable public embed${v.reason ? ' · ' + esc(v.reason) : ''}</small><br><a href="${esc(v.pageUrl || v.url)}" target="_blank" rel="noopener noreferrer">Open source</a></div></div>`;
    }
    const thumb = v.thumbnail ? `<img src="${esc(imgSrc(v.thumbnail))}" alt="" style="width:100%;aspect-ratio:16/9;object-fit:cover;background:#000" referrerpolicy="no-referrer">` : '';
    const note = v.accessNote || 'Embedding is blocked here. Open the source to watch. Carmen does not invent playback.';
    return `<div class="video-card">${thumb}<div class="vmeta"><b>${esc(v.title || v.domain)}</b><br><small>${dur}${esc(v.domain)} · ${v.accessState ? accessBadge(v.accessState) + ' · ' : ''}${esc(note)}</small><div class="row" style="margin-top:8px"><a class="btn primary" href="${esc(v.pageUrl || v.url)}" target="_blank" rel="noopener noreferrer" style="text-align:center;display:block">Open source</a></div></div></div>`;
  };
  if (diveWorkspaceTab === 'images') {
    const gallery = imgs.map(im => ({ src: imgSrc(im.url || im), cap: [im.reason || im.caption, im.domain, im.pageUrl || im.url].filter(Boolean).join(' · '), pageUrl: im.pageUrl || im.url || '', url: im.url, title: im.caption || im.title || '' }));
    lastDivePayload = lastDivePayload || data;
    lastDivePayload._gallery = gallery;
    body = imgs.length ? `<div class="gallery dense">${imgs.map((im, i) => `<img src="${esc(imgSrc(im.url || im))}" data-g="${i}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">`).join('')}</div>
      <p class="hint">Images keep page provenance. A picture is not proof of identity.</p>
      <div class="row"><button class="btn" data-save-images="1">Save images</button><button class="btn" data-visual-act="more">More images</button><button class="btn" data-visual-act="different">Find different</button></div>` : '<p class="hint">No public images were retrieved.</p>';
  } else if (diveWorkspaceTab === 'videos') {
    body = videos.length ? videos.map(videoCard).join('') + '<div class="row" style="margin-top:10px"><button class="btn" data-video-more="1">More videos</button></div>' : '<p class="hint">No public videos were retrieved.</p>';
  } else if (diveWorkspaceTab === 'tutorials') {
    body = (tutorials.length ? tutorials.map(videoCard).join('') : '<p class="hint">No public instructional videos were retrieved yet.</p>')
      + '<div class="row" style="margin-top:10px"><button class="btn primary" data-make-tutorial="1">Make tutorial from this research</button></div>';
  } else if (diveWorkspaceTab === 'sources') {
    body = (retrieved.length ? retrieved.map(x => `<div class="pattern"><b>${esc(x.title || x.url)}</b> ${accessBadge(x.accessState || (x.status === 'RETRIEVED' ? 'DIRECTLY_RETRIEVED' : 'UNAVAILABLE'))}<br><small>${esc(x.finalUrl || x.url || '')}${x.accessNote ? ' · ' + esc(x.accessNote) : ''}</small>${x.publicEvidence ? '<p class="hint">Public evidence (not protected content): ' + esc(x.publicEvidence) + '</p>' : ''}</div>`).join('') : '')
      + (results.length && !retrieved.length ? resultListHtml(results.slice(0, 12)) : '')
      || '<p class="muted">No retrieved pages.</p>';
  } else if (diveWorkspaceTab === 'premium') {
    const prem = (data.premiumContent && data.premiumContent.length) ? data.premiumContent : lastPremium;
    body = prem.length ? prem.map(x => `<div class="pattern"><b>${esc(x.title || x.url)}</b> <span class="badge">${esc(x.accessKind || x.accessState || 'restricted')}</span><br><small>${esc(x.domain || '')} · ${esc(x.accessState || '')}</small><p class="hint">${esc(x.note || 'Referenced as a public citation. Carmen did not access restricted material.')}</p>${x.publicEvidence ? '<p class="hint">Public evidence (not protected content): ' + esc(x.publicEvidence) + '</p>' : ''}${x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">Open public page</a>' : ''}</div>`).join('') : '<p class="hint">No public references to subscription or login-gated material were found.</p>';
  } else if (diveWorkspaceTab === 'explore') {
    const relHtml = related.length ? related.map((rel, i) => `<div class="branch"><b>${esc(rel.label)}</b><div class="subtle">${esc(rel.why || '')}${rel.domain ? ' · ' + esc(rel.domain) : ''}</div><button class="btn primary" data-branch="${i}" style="margin-top:8px">Investigate this</button></div>`).join('') : '';
    const leadHtml = leads.map(l => `<div class="lead"><b>${esc(l.text || l)}</b></div>`).join('');
    const gHtml = graphLeads.map(l => `<div class="lead"><b>${esc(l.label || l.text || '')}</b><div class="subtle">${esc(l.why || '')}</div></div>`).join('');
    body = (relHtml + leadHtml + gHtml) || '<p class="muted">No related people, sources, or next steps yet.</p>';
  } else {
    let analysisHtml = '';
    if (writeup) analysisHtml = renderAdaptiveWriteup(writeup, data.paths || lastPaths, subject);
    else if (data.paused || data.analysisSkipped || (data.researchState && data.researchState.stage === 'paused')) {
      analysisHtml = `<div class="claim inferred"><b>Research paused — more evidence available to continue</b><br>Carmen reached the per-request research budget. Findings so far are kept. Continue to retrieve the next batch. This is not a failed analysis.</div>`;
    } else if (data.analysisError) analysisHtml = `<div class="claim unknown"><b>Research collected. Analysis unavailable — retry analysis.</b><br>${esc(data.analysisError)}<br><span class="hint">Retrieved sources, images, videos, and leads are kept. Analysis can continue without repeating web research.</span><div class="row" style="margin-top:8px"><button class="btn" data-retry-analysis="1">Retry analysis</button></div></div>`;
    const instruction = plan.instruction || {};
    const ins = instruction.intent ? `<p class="hint">${esc(instruction.intent)}${instruction.topic ? ' · ' + esc(instruction.topic) : ''}</p>` : '';
    body = (ins + (analysisHtml || '<p class="muted">Findings will appear here after Deep Dive finishes.</p>'));
  }
  const name = selectedEntity?.canonicalName || plan.subject || subject;
  const ctx = extraContextText(plan.context ? { context: plan.context } : lastClassification);
  $('deepDiveResult').innerHTML = `
    <div class="selbar"><b>${esc(name)}</b>${currentAdult !== 'off' ? ' ' + adultBadge(plan.adultContent || data.adultContent || currentAdult) : ''}${ctx ? ' <span class="badge">' + esc(ctx) + '</span>' : ''}<br>
    <small>${esc(plan.safety || 'Read-only public research.')} Nothing is saved unless you choose Save.</small>
    <div class="row" style="margin-top:8px"><button class="btn primary" data-keep-dive="1">Save this research</button></div></div>
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
    <div class="claim unknown"><b>Video frames</b> <span class="badge unknown">UNKNOWN unless a still was captured</span><br>Carmen analyzes the supplied image or screenshot. It cannot currently inspect video frames unless you capture a still.</div>
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
  $('homeRecent').innerHTML = ps.slice(0, 4).map(p => `<div class="inv-card" data-resume="${esc(p.id)}">${p.thumbnail ? `<img src="${esc(imgSrc(p.thumbnail))}" alt="">` : ''}<div class="body"><b>${esc(p.name)}</b><div class="subtle">${esc(subjectLabel(p.entityType))} · ${esc(p.status || 'active')}</div></div></div>`).join('') || '<p class="empty">No saved investigations yet. Continue, choose a lens, then Discover — Keep or Deep Dive to persist one.</p>';
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
  </div>`).join('') || '<p class="empty">Investigations appear here after you Keep or Save a search. Deep Dive never auto-saves.</p>';
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
  const parent = {
    entity: selectedEntity?.canonicalName || lastClassification?.subject || '',
    topic: diveTopic,
    query: originalQuery,
    projectId: currentProjectId,
  };
  pushTrail({ kind: 'branch', label: 'Found “' + rel.label + '” while investigating “' + (parent.entity || parent.query || 'previous') + '”', entity: rel.label, query: rel.label, parent });
  lastFoundThrough = { kind: 'branch', parent, via: parent.entity || parent.query };
  $('searchQuery').value = rel.label;
  if (rel.kind && ['person', 'technique', 'product', 'place', 'skill', 'organization', 'website'].includes(String(rel.kind).toLowerCase())) {
    currentSubject = String(rel.kind).toLowerCase();
    document.querySelectorAll('#subjectChips .chip').forEach(x => x.classList.toggle('active', x.dataset.subject === currentSubject));
  }
  diveTopic = '';
  identityVerdict = null;
  if ($('diveSearchQuery')) $('diveSearchQuery').value = '';
  selectedEntity = null;
  selectedCandidate = null;
  setTab('search');
  toast('Following “' + rel.label + '” as a new investigation. The previous trail is kept. Save if you want the original.');
  await discover({ keepSubject: false });
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
    ${items.map(it => `<div class="inv-card">${it.image ? `<img src="${esc(imgSrc(it.image))}" data-full="${esc(imgSrc(it.image))}" data-cap="${esc((it.domain || '') + ' · ' + (it.sourceUrl || it.url || ''))}" alt="">` : ''}<div class="body"><b>${esc(it.title || it.url)}</b><div class="subtle">${esc(it.kind)} · ${esc(it.domain || '')} · ${esc(it.createdAt ? new Date(it.createdAt).toLocaleString() : '')}${it.foundThrough && it.foundThrough.via ? ' · found through ' + esc(it.foundThrough.via) : ''}${it.subject ? ' · ' + esc(it.subject) : ''}</div><div class="row" style="margin-top:8px"><button class="btn" data-open-item="${esc(it.url || '')}">Open</button><button class="btn" data-branch-item="${esc(it.id)}">Investigate this</button><button class="btn" data-move-item="${esc(it.id)}">Move</button><button class="btn" data-remove-item="${esc(it.id)}">Remove</button></div></div></div>`).join('') || '<p class="muted">Empty collection.</p>'}
  </div>`;
}

async function openSaveSheet(item) {
  pendingSaveItem = item;
  const cols = await all('collections');
  $('saveSheetList').innerHTML = cols.map(c => `<label class="refitem"><input type="checkbox" data-col="${esc(c.id)}"><span>${esc(c.name)}</span></label>`).join('') || '<p class="muted">Create a collection below.</p>';
  $('saveSheet').classList.remove('hidden'); $('saveSheet').removeAttribute('hidden'); $('saveSheet').removeAttribute('inert'); $('saveSheet').removeAttribute('aria-hidden');
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
    $('saveSheet').classList.add('hidden'); if ($('saveSheet')) { $('saveSheet').setAttribute('hidden',''); $('saveSheet').setAttribute('inert',''); $('saveSheet').setAttribute('aria-hidden','true'); }
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
    foundThrough: pendingSaveItem.foundThrough || currentFoundThrough(),
    parentId: pendingSaveItem.parentId || lastSavedItemId || null,
    investigationId: currentProjectId || null,
    subject: selectedEntity?.canonicalName || lastClassification?.subject || '',
    topic: diveTopic || extraContextText(lastClassification) || '',
  };
  await put('collectionItems', item);
  lastSavedItemId = item.id;
  lastFoundThrough = item.foundThrough;
  pushTrail({ kind: 'save', label: 'Saved “' + item.title + '”', itemId: item.id, itemUrl: item.url, entity: item.subject, topic: item.topic });
  $('saveSheet').classList.add('hidden'); if ($('saveSheet')) { $('saveSheet').setAttribute('hidden',''); $('saveSheet').setAttribute('inert',''); $('saveSheet').setAttribute('aria-hidden','true'); }
  $('saveSheetNew').value = '';
  pendingSaveItem = null;
  toast('Saved. Carmen remembers how you got here. Nothing else was auto-saved.');
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
      body: JSON.stringify({ query: q, type: currentLearnType, adult: currentAdult, adultContent: currentAdult, measurements: measurementsForRequest() }),
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

async function makeTutorial(opts = {}) {
  const visual = opts.visual || selectedVisual;
  const q = String(opts.query || selectedEntity?.canonicalName || lastClassification?.subject || $('searchQuery')?.value || $('learnQuery')?.value || '').trim();
  if (!q && !visual) return toast('Select a subject or visual first.');
  const base = backendUrl();
  if (!base) return toast('Backend is not set.');
  setTab('learn');
  if ($('learnQuery')) $('learnQuery').value = q;
  $('learnResult').innerHTML = '<div class="skeleton"></div><p class="muted">Building an evidence-backed tutorial from public sources…</p>';
  try {
    const r = await fetch(base + '/learn', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: q,
        type: lastClassification?.type || currentLearnType || '',
        adult: currentAdult,
        adultContent: currentAdult,
        visualUrl: visual && (visual.pageUrl || visual.url) || '',
        measurements: measurementsForRequest(),
        instructions: visual ? ('Tutorial from selected visual at ' + (visual.pageUrl || visual.url) + '. Visual likeness is not identity proof.') : '',
      }),
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
    const measureNote = data.measurementsUsed ? '<p class="hint">USER-PROVIDED MEASUREMENT were included. Fit conclusions are CALCULATED/INFERRED unless a source size chart was retrieved.</p>' : '';
    $('learnResult').innerHTML = `<div class="card">
      <span class="badge">${esc(subjectLabel(data.classification?.type))}</span> ${adultBadge(data.adultContent || currentAdult)}
      <p class="hint">${esc(data.classification?.reason || '')}${data.classification?.context ? ' · context: ' + esc(data.classification.context) : ''}</p>
      ${measureNote}
      ${imgHtml}
      ${lesson ? renderAdaptiveWriteup(lesson, lastPaths, q) : (data.analysisError ? `<div class="claim unknown">${esc(data.analysisError)}</div>` : '')}
      <h4>Sources</h4>${sources || '<p class="muted">No retrieved pages.</p>'}
      <p class="hint">${esc(data.safety || '')}</p>
      <button class="btn" id="learnSave">Save this brief to a collection</button>
    </div>`;
    $('learnSave').onclick = () => openSaveSheet({ kind: 'tutorial', title: q, url: visual && (visual.pageUrl || visual.url) || '', note: String(lesson).slice(0, 500), image: (visual && visual.url) || imgs[0]?.url || '' });
    toast('Tutorial drafted from public sources.');
  } catch (e) {
    $('learnResult').innerHTML = `<div class="claim unknown"><b>Tutorial unavailable</b><br>${esc(e.message)}</div>`;
  }
}

/* ---------- event wiring ---------- */
function wire() {
  setAgentState({ status: 'idle', view: 'home', busy: false, investigation: liveInvestigationId });
  $('navHome').onclick = () => setTab('home');
  $('navSearch').onclick = () => setTab('search');
  if ($('navDive')) $('navDive').onclick = () => setTab('dive');
  $('navCollections').onclick = () => setTab('collections');
  $('navInvestigations').onclick = () => setTab('investigations');
  $('navLearn').onclick = () => setTab('learn');
  const submitHomeSearch = () => {
    const q = $('homeQuery').value.trim();
    const photo = pendingPhoto;
    hardNewInvestigation({ silent: true, stay: true });
    pendingPhoto = photo;
    if ($('searchQuery')) $('searchQuery').value = q;
    if ($('homeQuery')) $('homeQuery').value = q;
    setTab('search');
    if (q || pendingPhoto) discover({ photo: !!pendingPhoto, seedVisual: pendingPhoto ? { title: pendingPhoto.name || 'uploaded photo', caption: q, pageUrl: '' } : null });
  };
  if ($('homeSearchForm')) $('homeSearchForm').onsubmit = e => { e.preventDefault(); submitHomeSearch(); };
  $('homeSearchBtn').onclick = e => { if (e) e.preventDefault(); submitHomeSearch(); };
  if ($('newInvestigationBtn')) $('newInvestigationBtn').onclick = () => hardNewInvestigation();
  if ($('surpriseMeBtn')) $('surpriseMeBtn').onclick = () => surpriseMe();
  if ($('diveSearchBtn')) $('diveSearchBtn').onclick = () => investigateTopic($('diveCustom')?.value || $('diveSearchQuery')?.value || '');
  if ($('diveBondageBtn')) $('diveBondageBtn').onclick = () => runDiveLens('bondage');
  if ($('divePeopleBtn')) $('divePeopleBtn').onclick = () => runDiveLens('people');
  if ($('diveVisualsBtn')) $('diveVisualsBtn').onclick = () => runDiveLens('visuals');
  if ($('diveClothingBtn')) $('diveClothingBtn').onclick = () => runDiveLens('visuals');
  if ($('diveFindMoreBtn')) $('diveFindMoreBtn').onclick = () => {
    const entity = selectedEntity?.canonicalName || lastClassification?.subject || '';
    if (!entity && !lastResults.length) return toast('Investigate something first.');
    pushTrail({ kind: 'find-more', label: 'Find more', entity, topic: diveTopic });
    discover({
      keepSubject: !!entity,
      entity,
      topic: diveTopic || extraContextText(lastClassification) || '',
      expanded: true,
      append: true,
      findMore: true,
      mode: 'find-more',
    });
  };
  if ($('divePremiumBtn')) $('divePremiumBtn').onclick = () => {
    const entity = selectedEntity?.canonicalName || lastClassification?.subject || researchSubject || '';
    if (!entity) return toast('Resolve a person first, then investigate Account / Premium.');
    pushTrail({ kind: 'premium-accounts', label: 'Account / Premium', entity, topic: diveTopic });
    discover({
      keepSubject: true,
      entity,
      topic: diveTopic || extraContextText(lastClassification) || '',
      premiumAccounts: true,
      premium: true,
      append: true,
      expanded: true,
      mode: 'premium-accounts',
    });
  };

  if ($('diveSearchQuery')) $('diveSearchQuery').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); investigateTopic($('diveSearchQuery').value); }
  });
  if ($('diveCustom')) $('diveCustom').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); investigateTopic($('diveCustom').value); }
  });
  if ($('howGotHereBtn')) $('howGotHereBtn').onclick = () => {
    const panel = $('howHerePanel');
    if (!panel) return;
    const open = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !open);
    if (open) {
      panel.removeAttribute('hidden');
      renderHowHere();
    } else {
      panel.setAttribute('hidden', '');
    }
    setAgentState({ howHere: open ? 'open' : 'closed' });
  };
  if ($('diveSurpriseBtn')) $('diveSurpriseBtn').onclick = () => surpriseMe();
  if ($('diveTabs')) $('diveTabs').onclick = e => {
    const t = e.target.closest('[data-divetab]');
    if (t) setDiveTab(t.dataset.divetab);
  };
  if ($('howHereList')) $('howHereList').onclick = e => {
    const b = e.target.closest('[data-trail]');
    if (b) jumpTrail(+b.dataset.trail);
  };
  if ($('diveStream')) $('diveStream').addEventListener('click', e => {
    if (e.target.closest('[data-stream-close-analyze]')) { $('analyzePanel')?.classList.add('hidden'); return; }
    const fm = e.target.closest('[data-findmore]');
    if (fm) {
      const kind = fm.dataset.findmore;
      const item = fm.dataset.kind === 'video' ? lastVideos[+fm.dataset.i] : streamResultAt(+fm.dataset.i);
      findMore(kind, item);
      return;
    }
    const act = e.target.closest('[data-stream-act]');
    if (act) {
      const item = streamResultAt(+act.dataset.i);
      if (!item) return;
      if (act.dataset.streamAct === 'save') openSaveSheet({ kind: resultIsReddit(item) ? 'reddit' : 'page', title: item.title, url: item.url, image: item.image, domain: item.domain, provenance: item.provenance, sourceUrl: item.url, foundThrough: currentFoundThrough() });
      if (act.dataset.streamAct === 'analyze') analyzeDiscoveryItem(item);
      if (act.dataset.streamAct === 'teach') teachAbout(item);
      return;
    }
    const vid = e.target.closest('[data-stream-vid]');
    if (vid) {
      const v = lastVideos[+vid.dataset.i];
      if (!v) return;
      if (vid.dataset.streamVid === 'save') openSaveSheet({ kind: 'video', title: v.title, url: v.pageUrl || v.url, image: v.thumbnail, domain: v.domain, sourceUrl: v.pageUrl || v.url, foundThrough: currentFoundThrough() });
      if (vid.dataset.streamVid === 'analyze') analyzeDiscoveryItem({ ...v, kind: 'video', url: v.pageUrl || v.url });
      return;
    }
    const im = e.target.closest('[data-stream-img]');
    if (im) {
      const gallery = lastVisuals.map(x => ({ src: imgSrc(x.url), cap: [x.title || x.caption, x.domain, x.pageUrl || x.url].filter(Boolean).join(' · '), pageUrl: x.pageUrl || x.url || '', url: x.url }));
      openLightbox(gallery[+im.dataset.streamImg]?.src, gallery[+im.dataset.streamImg]?.cap, gallery, +im.dataset.streamImg);
      return;
    }
    const full = e.target.closest('img[data-full]');
    if (full) openLightbox(full.dataset.full || full.src, '');
  });
  if ($('analyzePanel')) $('analyzePanel').addEventListener('click', e => {
    if (e.target.closest('[data-stream-close-analyze]')) $('analyzePanel').classList.add('hidden');
  });
  $('homeQuery').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('homeSearchBtn').click(); } });
  document.body.addEventListener('click', e => {
    const resume = e.target.closest('[data-resume]');
    if (resume) { e.preventDefault(); resumeInvestigation(resume.dataset.resume); return; }
    const goDive = e.target.closest('[data-go-dive]');
    if (goDive) { e.preventDefault(); goToDive(); return; }
    const variation = e.target.closest('[data-variation]');
    if (variation) {
      e.preventDefault();
      const label = variation.getAttribute('data-variation') || '';
      if (!label) return;
      const entity = selectedEntity?.canonicalName || lastClassification?.subject || '';
      diveTopic = label;
      pushTrail({ kind: 'variation', label: 'Variation · ' + label, entity, topic: label });
      discover({
        keepSubject: !!entity,
        entity,
        topic: label,
        append: true,
        expanded: true,
      });
    }
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
  $('searchQuery').addEventListener('input', () => {
    updateDeepDiveState();
    persistSession();
    clearTimeout(classifyTimer);
    classifyTimer = setTimeout(() => {
      if (($('searchQuery').value || '').trim().length >= 2) classifySubject({ silent: true });
    }, 480);
  });
  $('searchQuery').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); discover(); } });
  $('discoverBtn').onclick = discover;
  if ($('interestChips')) $('interestChips').onclick = e => {
    const c = e.target.closest('[data-lens]');
    if (!c) return;
    currentLensId = c.dataset.lens;
    renderInterestChips();
    const lens = currentLens();
    if (lens && (lens.context || lens.custom || lens.question) && currentDepth !== 'deep') setDepth('contextual', { silent: true });
    if (lens?.id === 'everything' && researchSubject) $('searchQuery').value = researchSubject;
    else {
      const composed = composeQuery();
      if (composed && $('searchQuery') && (lens?.context || lens?.custom || lens?.question)) $('searchQuery').value = composed;
    }
    renderLensStack();
    persistSession();
  };
  if ($('customContext')) $('customContext').addEventListener('input', () => {
    const composed = composeQuery();
    if (composed) $('searchQuery').value = composed;
    renderLensStack();
    persistSession();
  });
  if ($('customQuestion')) $('customQuestion').addEventListener('input', () => {
    const composed = composeQuery();
    if (composed) $('searchQuery').value = composed;
    renderLensStack();
    persistSession();
  });
  if ($('expandedBtn')) $('expandedBtn').onclick = () => discover({ expanded: true });
  $('deepDiveBtn').onclick = () => goToDive();
  if ($('startDiveBtn')) $('startDiveBtn').onclick = () => runDeepDive();
  if ($('continueDiveBtn')) $('continueDiveBtn').onclick = () => {
    const state = lastResearchState || lastDivePayload?.researchState;
    if (!state) return toast('Nothing to continue yet.');
    runDeepDive({ continueFrom: state });
  };
  if ($('furtherDiveBtn')) $('furtherDiveBtn').onclick = () => {
    if (!lastDivePayload && !lastResults.length) return toast('Investigate something first.');
    runDeepDive({ further: true });
  };
  if ($('makeTutorialBtn')) $('makeTutorialBtn').onclick = () => makeTutorial();
  if ($('retryAnalysisBtn')) $('retryAnalysisBtn').onclick = () => {
    if (!lastDivePayload) return toast('Nothing to re-analyze yet.');
    runDeepDive({ analysisOnly: true });
  };
  if ($('cancelDiveBtn')) $('cancelDiveBtn').onclick = () => setTab('search');
  if ($('diveCustom')) $('diveCustom').addEventListener('input', persistSession);
  if ($('diveSelectChips')) $('diveSelectChips').onclick = e => {
    const inv = e.target.closest('[data-investigation]');
    if (inv) { selectInvestigation(inv.dataset.investigation); return; }
    const all = e.target.closest('[data-diveall]');
    if (all) { toggleDivePath('all'); return; }
    const p = e.target.closest('[data-divepath]');
    if (p) toggleDivePath(p.dataset.divepath);
  };
  $('keepBtn').onclick = async () => {
    const p = await keepInvestigation();
    setAgentState({ saved: p ? (p.id || 'kept') : '' });
    toast(p ? 'Investigation kept on this phone.' : 'Nothing to keep yet.');
    await refresh();
  };
  $('addQueueBtn').onclick = () => { setTab('investigations'); $('queueUrl').focus(); };
  if ($('lightboxClose')) $('lightboxClose').onclick = closeLightbox;
  if ($('lightboxPrev')) $('lightboxPrev').onclick = () => lightboxStep(-1);
  if ($('lightboxNext')) $('lightboxNext').onclick = () => lightboxStep(1);
  if ($('lightboxSource')) $('lightboxSource').onclick = () => { if (lightboxSourceUrl) window.open(lightboxSourceUrl, '_blank', 'noopener,noreferrer'); };
  if ($('lightboxInvestigate')) $('lightboxInvestigate').onclick = () => {
    const item = lightboxGallery[lightboxIndex] || {};
    selectedVisual = { url: item.url || item.src, pageUrl: item.pageUrl || lightboxSourceUrl, title: item.title || item.cap || '', domain: item.domain || hostOf(item.pageUrl || '') };
    closeLightbox();
    goToDive();
    runDeepDive({ further: true, selectedVisual });
  };
  if ($('lightboxTutorial')) $('lightboxTutorial').onclick = () => {
    const item = lightboxGallery[lightboxIndex] || {};
    selectedVisual = { url: item.url || item.src, pageUrl: item.pageUrl || lightboxSourceUrl, title: item.title || item.cap || '', domain: item.domain || hostOf(item.pageUrl || '') };
    closeLightbox();
    makeTutorial({ visual: selectedVisual });
  };
  if ($('lightboxSave')) $('lightboxSave').onclick = () => {
    const item = lightboxGallery[lightboxIndex] || {};
    openSaveSheet({ kind: 'image', title: item.title || item.cap || 'Visual', url: item.pageUrl || lightboxSourceUrl || '', image: item.url || item.src || $('lightboxImg')?.src || '', sourceUrl: item.pageUrl || lightboxSourceUrl || '', domain: item.domain || hostOf(item.pageUrl || '') });
  };
  if ($('lightboxSimilar')) $('lightboxSimilar').onclick = () => {
    const item = currentLightboxVisual();
    closeLightbox();
    discover({ visualMode: 'similar', seedVisual: item });
  };
  if ($('lightboxSearchVisual')) $('lightboxSearchVisual').onclick = () => {
    const item = currentLightboxVisual();
    closeLightbox();
    discover({ visualMode: 'searchvisual', seedVisual: item });
  };
  if ($('lightboxNotImage')) $('lightboxNotImage').onclick = () => {
    const item = currentLightboxVisual();
    closeLightbox();
    rejectVisual(item);
  };
  if ($('lightboxNotPerson')) $('lightboxNotPerson').onclick = () => {
    const item = currentLightboxVisual();
    closeLightbox();
    rejectPerson({ url: item.pageUrl || item.url, domain: item.domain || hostOf(item.pageUrl || item.url || '') });
  };
  if ($('lightboxRelated')) $('lightboxRelated').onclick = e => {
    const im = e.target.closest('[data-lrel]');
    if (!im) return;
    lightboxIndex = Number(im.dataset.lrel) || 0;
    showLightboxSlide();
  };
  if ($('videoCorpus')) $('videoCorpus').addEventListener('click', e => {
    if (e.target.closest('[data-video-more]') || e.target.closest('[data-video-act="different-set"]')) {
      discover({ videoMore: true, visualMode: e.target.closest('[data-video-act="different-set"]') ? 'different' : 'more' });
      return;
    }
    const play = e.target.closest('[data-video-act="play"]');
    if (play) {
      const wrap = document.querySelector('[data-video-embed="' + play.dataset.i + '"]');
      if (wrap) wrap.classList.remove('hidden');
      return;
    }
    const save = e.target.closest('[data-video-act="save"]');
    if (save) {
      const v = lastVideos[+save.dataset.i];
      if (v) openSaveSheet({ kind: 'video', title: v.title, url: v.pageUrl || v.url, image: v.thumbnail, domain: v.domain, sourceUrl: v.pageUrl || v.url });
      return;
    }
    const not = e.target.closest('[data-video-act="not"]');
    if (not) {
      const v = lastVideos[+not.dataset.i];
      if (v) {
        suppressed.urls.push(v.url || v.pageUrl);
        lastVideos = lastVideos.filter((_, i) => i !== +not.dataset.i);
        renderVideoCorpus();
        discover({ visualMode: 'different', videoMore: true });
      }
    }
  });
  if ($('saveMeasurements')) $('saveMeasurements').onclick = () => {
    const m = saveMeasurementsFromForm();
    toast(m ? 'Measurements saved on this phone (USER-PROVIDED).' : 'Measurements cleared.');
  };
  if ($('lightbox')) $('lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') closeLightbox(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeLightbox(); const sheet = $('saveSheet'); if (sheet) { sheet.classList.add('hidden'); sheet.setAttribute('hidden',''); sheet.setAttribute('inert',''); sheet.setAttribute('aria-hidden','true'); } }
    if (!$('lightbox')?.classList.contains('hidden')) {
      if (e.key === 'ArrowLeft') lightboxStep(-1);
      if (e.key === 'ArrowRight') lightboxStep(1);
    }
  });
  if ($('homeImageBtn')) $('homeImageBtn').onclick = () => $('homeImage')?.click();
  if ($('homePhotoBtn')) $('homePhotoBtn').onclick = () => $('homeImage')?.click();
  if ($('searchPhotoBtn')) $('searchPhotoBtn').onclick = () => ($('searchImage') || $('homeImage'))?.click();
  function renderPhotoPreview(id, dataUrl, name) {
    const el = $(id);
    if (!el) return;
    if (!dataUrl) {
      el.innerHTML = '';
      el.classList.add('hidden');
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.classList.remove('hidden');
    el.innerHTML = '<img alt="Attached photo" src="' + dataUrl + '"><div class="body"><b>' + esc(name || 'Photo attached') + '</b><div class="hint">Used as an investigation visual. Carmen will not identify a person from this image alone.</div></div><button class="btn ghost" type="button" data-clear-photo>Remove</button>';
    el.querySelector('[data-clear-photo]')?.addEventListener('click', () => {
      pendingPhoto = null;
      if ($('homeImage')) $('homeImage').value = '';
      if ($('searchImage')) $('searchImage').value = '';
      renderPhotoPreview('homePhotoPreview', '');
      renderPhotoPreview('searchPhotoPreview', '');
    });
  }
  async function ingestPhotoFile(f) {
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) return toast('Image is too large. Choose one under 12 MB.');
    const rd = new FileReader();
    rd.onload = () => {
      current = rd.result;
      pendingPhoto = { dataUrl: rd.result, name: String(f.name || 'photo'), type: f.type || 'image' };
      try { showCurrent(); enableCapture(); } catch {}
      const name = String(f.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
      renderPhotoPreview('homePhotoPreview', rd.result, name || 'Photo attached');
      renderPhotoPreview('searchPhotoPreview', rd.result, name || 'Photo attached');
      if (name && !$('searchQuery')?.value.trim()) {
        if ($('searchQuery')) $('searchQuery').value = name;
        if ($('homeQuery') && !$('homeQuery').value.trim()) $('homeQuery').value = name;
      }
      toast('Photo attached as investigation input. Carmen will not identify a person from the image alone.');
    };
    rd.readAsDataURL(f);
  }
  if ($('homeImage')) $('homeImage').onchange = async () => {
    await ingestPhotoFile($('homeImage').files?.[0]);
  };
  if ($('searchImage')) $('searchImage').onchange = async () => {
    await ingestPhotoFile($('searchImage').files?.[0]);
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
  $('saveSheetCancel').onclick = () => { $('saveSheet').classList.add('hidden'); if ($('saveSheet')) { $('saveSheet').setAttribute('hidden',''); $('saveSheet').setAttribute('inert',''); $('saveSheet').setAttribute('aria-hidden','true'); } pendingSaveItem = null; };
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
    const brItem = e.target.closest('[data-branch-item]');
    if (brItem) {
      const items = await all('collectionItems');
      const it = items.find(x => x.id === brItem.dataset.branchItem);
      if (it) {
        lastSavedItemId = it.id;
        lastFoundThrough = it.foundThrough || { via: it.title, parentId: it.id };
        branchInvestigation({ label: it.subject || it.title || it.url, kind: it.kind === 'page' ? '' : it.kind });
      }
      return;
    }
    const mv = e.target.closest('[data-move-item]');
    if (mv) {
      const items = await all('collectionItems');
      const it = items.find(x => x.id === mv.dataset.moveItem);
      if (!it) return;
      pendingSaveItem = { ...it, _moveId: it.id };
      const cols = await all('collections');
      $('saveSheetList').innerHTML = cols.map(c => `<label class="refitem"><input type="checkbox" data-col="${esc(c.id)}"${(it.collectionIds || []).includes(c.id) ? ' checked' : ''}><span>${esc(c.name)}</span></label>`).join('') || '<p class="muted">Create a collection below.</p>';
      $('saveSheet').classList.remove('hidden'); $('saveSheet').removeAttribute('hidden'); $('saveSheet').removeAttribute('inert'); $('saveSheet').removeAttribute('aria-hidden');
    }
  });
  $('deepDiveResult').addEventListener('click', e => {
    if (e.target.closest('[data-keep-dive]')) {
      keepInvestigation(selectedEntity?.canonicalName || lastClassification?.subject || $('searchQuery')?.value).then(p => {
        toast(p ? 'Research saved on this phone.' : 'Nothing to save yet.');
        refresh();
      });
      return;
    }
    if (e.target.closest('[data-visual-act]')) {
      const mode = e.target.closest('[data-visual-act]').dataset.visualAct;
      discover({ visualMode: mode, visualMore: mode === 'more', visualOffset: lastVisuals.length });
      return;
    }
    if (e.target.closest('[data-video-more]')) {
      discover({ videoMore: true, visualMode: 'more' });
      return;
    }
    if (e.target.closest('[data-expand-dive]')) {
      if ($('diveExpanded')) $('diveExpanded').checked = true;
      expandedMode = true;
      runDeepDive();
      return;
    }
    if (e.target.closest('[data-retry-analysis]')) {
      runDeepDive({ analysisOnly: true });
      return;
    }
    const tab = e.target.closest('[data-wstab]');
    if (tab && lastDivePayload) {
      diveWorkspaceTab = tab.dataset.wstab;
      renderDiveWorkspace(lastDivePayload, lastDivePayload.query || lastDivePayload.plan?.subject || '');
      return;
    }
    if (e.target.closest('[data-make-tutorial]')) {
      makeTutorial();
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
    const gq = e.target.closest('[data-graph-q]');
    if (gq) {
      const label = gq.dataset.graphQ;
      const kind = gq.dataset.graphKind || '';
      if (kind) branchInvestigation({ label, kind });
      else {
        $('searchQuery').value = label;
        researchSubject = lastClassification?.subject || researchSubject;
        discover();
      }
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
  if ($('visualCorpus')) $('visualCorpus').addEventListener('click', e => {
    const act = e.target.closest('[data-visual-act]');
    if (act) {
      const mode = act.dataset.visualAct;
      const seed = selectedVisual || lastVisuals[0] || null;
      discover({ visualMode: mode, visualMore: mode === 'more', seedVisual: seed, visualOffset: mode === 'more' ? lastVisuals.length : 0 });
      return;
    }
    if (e.target.closest('[data-visual-more]')) {
      discover({ visualMore: true, visualMode: 'more', visualOffset: lastVisuals.length });
      return;
    }
    const tile = e.target.closest('[data-visual]');
    if (!tile) return;
    const i = Number(tile.dataset.visual);
    const im = lastVisuals[i];
    if (!im) return;
    selectedVisual = im;
    const gallery = ($('visualCorpus')._gallery) || lastVisuals.map(x => ({ src: imgSrc(x.url), cap: [x.title || x.caption, x.domain, x.pageUrl || x.url].filter(Boolean).join(' · '), pageUrl: x.pageUrl || x.url || '', url: x.url, title: x.title || '', domain: x.domain || '' }));
    openLightbox(imgSrc(im.url), [im.title || im.caption, im.domain, im.pageUrl || im.url].filter(Boolean).join(' · '), gallery, i, im.pageUrl || im.url);
    persistSession();
  });
  function identifyFromEvent(e, root) {
    const b = e.target.closest('[data-ract]');
    const tile = e.target.closest('[data-identify], .result, .person-tile');
    const i = b ? +b.dataset.i : (tile ? +(tile.dataset.identify || tile.dataset.i) : -1);
    if (!(i >= 0) || !lastResults[i]) return null;
    return { r: lastResults[i], i, act: b ? b.dataset.ract : 'select' };
  }
  $('results').onclick = async e => {
    const thumb = e.target.closest('.thumbs img[data-full], img.rthumb[data-full]');
    if (thumb && !e.target.closest('[data-ract]')) {
      const card = e.target.closest('.result');
      const r = card ? lastResults[+card.dataset.i] : null;
      const imgs = r ? [...new Set([r.image, ...(r.images || [])].filter(Boolean))].map(u => ({ src: imgSrc(u), cap: (r.domain || '') + ' · ' + (r.url || ''), pageUrl: r.url })) : [{ src: thumb.dataset.full || thumb.src, cap: thumb.dataset.cap || '', pageUrl: '' }];
      const idx = Math.max(0, imgs.findIndex(x => x.src === (thumb.dataset.full || thumb.src)));
      e.stopPropagation();
      openLightbox(thumb.dataset.full || thumb.src, thumb.dataset.cap || '', imgs, idx);
      return;
    }
    const isPerson = (lastClassification?.type || currentSubject) === 'person';
    const hero = e.target.closest('img.hero');
    if (hero && !isPerson && !e.target.closest('[data-identify]') && !e.target.closest('[data-ract]')) {
      const card = e.target.closest('.result');
      const r = card ? lastResults[+card.dataset.i] : null;
      const imgs = r ? [...new Set([r.image, ...(r.images || [])].filter(Boolean))].map(u => ({ src: imgSrc(u), cap: (r.domain || '') + ' · ' + (r.url || ''), pageUrl: r.url })) : [{ src: hero.dataset.full || hero.src, cap: hero.dataset.cap || '', pageUrl: '' }];
      const idx = Math.max(0, imgs.findIndex(x => x.src === (hero.dataset.full || hero.src)));
      e.stopPropagation();
      openLightbox(hero.dataset.full || hero.src, hero.dataset.cap || '', imgs, idx);
      return;
    }
    const hit = identifyFromEvent(e, $('results'));
    if (!hit) return;
    if (hit.act === 'open') { window.open(hit.r.url, '_blank', 'noopener,noreferrer'); return; }
    if (hit.act === 'evidence') { await saveResultAsEvidence(hit.r); return; }
    if (hit.act === 'save') { await openSaveSheet({ kind: 'page', title: hit.r.title, url: hit.r.url, image: hit.r.image, domain: hit.r.domain, provenance: hit.r.provenance, sourceUrl: hit.r.url }); return; }
    if (hit.act === 'queue') { await queueFromResult(hit.r); return; }
    selectCandidate(hit.r, hit.i);
    if (hit.act === 'dive') goToDive();
    if (hit.act === 'notperson') rejectPerson(hit.r);
  };
  if ($('personRail')) $('personRail').onclick = async e => {
    const thumb = e.target.closest('.thumbs img[data-full]');
    if (thumb) {
      const tile = e.target.closest('.person-tile');
      const r = tile ? lastResults[+tile.dataset.i] : null;
      const imgs = r ? [...new Set([r.image, ...(r.images || [])].filter(Boolean))].map(u => ({ src: imgSrc(u), cap: (r.domain || '') + ' · ' + (r.url || ''), pageUrl: r.url })) : [{ src: thumb.dataset.full || thumb.src, cap: thumb.dataset.cap || '', pageUrl: '' }];
      const idx = Math.max(0, imgs.findIndex(x => x.src === (thumb.dataset.full || thumb.src)));
      openLightbox(thumb.dataset.full || thumb.src, thumb.dataset.cap || '', imgs, idx);
      return;
    }
    const hit = identifyFromEvent(e, $('personRail'));
    if (!hit) return;
    if (hit.act === 'open') { window.open(hit.r.url, '_blank', 'noopener,noreferrer'); return; }
    if (hit.act === 'evidence') { await saveResultAsEvidence(hit.r); return; }
    if (hit.act === 'save') { await openSaveSheet({ kind: 'page', title: hit.r.title, url: hit.r.url, image: hit.r.image, domain: hit.r.domain, provenance: hit.r.provenance, sourceUrl: hit.r.url }); return; }
    selectCandidate(hit.r, hit.i);
    if (hit.act === 'dive') goToDive();
    if (hit.act === 'notperson') rejectPerson(hit.r);
  };
  if ($('graphTrail')) $('graphTrail').onclick = e => {
    const gq = e.target.closest('[data-graph-q]');
    if (!gq) return;
    const label = gq.dataset.graphQ;
    const kind = gq.dataset.graphKind || '';
    if (kind) branchInvestigation({ label, kind });
    else {
      $('searchQuery').value = label;
      researchSubject = lastClassification?.subject || researchSubject;
      discover();
    }
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
  selectedEntity = disc.selectedEntity || selectedEntity;
  originalQuery = disc.originalQuery || disc.query || originalQuery;
  lastVisualCandidates = disc.visualCandidates || lastVisualCandidates;
  lastVisuals = disc.visuals || lastVisuals;
  if (disc.customQuestion && $('diveCustom') && !$('diveCustom').value) $('diveCustom').value = disc.customQuestion;
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
    if (focus) selectCandidate(focus, lastResults.indexOf(focus), { silent: true });
  } else if (selectedEntity) {
    renderSelectedBanner();
    renderDiveIdentity();
  }
  renderPersonRail();
  if (disc.deepDiveText || disc.deepDiveImages) {
    renderDeepDivePayload({
      plan: disc.deepDivePlan,
      analysis: disc.deepDiveText,
      images: disc.deepDiveImages || [],
      videos: disc.deepDiveVideos || [],
      retrieved: disc.deepDiveRetrieved || [],
      related: disc.deepDiveRelated || [],
      graphLeads: disc.graphLeads || [],
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
  fillMeasurementsForm();
  renderHome();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init().catch(e => toast('Local archive unavailable: ' + e.message));
