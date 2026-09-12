/* Carmen — canonical frontend.
   iPhone-first investigation workspace. Preserves the v36 IndexedDB schema and
   all prior capabilities (capture, vision analysis, synthesis, evidence archive,
   pattern board, leads, backup/restore, queue) and adds the discovery hub:
   subject-based public search -> reviewable results -> deep-dive analysis ->
   saved evidence. Carmen never takes external actions on a user's behalf. */
'use strict';

const $ = id => document.getElementById(id);
const VERSION = '38';
const BACKEND_KEY = 'carmen_phone_backend_v36';
const URL_KEY = 'carmen_last_url_v36';
const DB_NAME = 'carmen-phone-v36';
const DB_VERSION = 2;
const SAME_ORIGIN = (window.CARMEN_BACKEND && String(window.CARMEN_BACKEND).length) ? window.CARMEN_BACKEND : location.origin;

let db = null, stream = null, current = null, historyStack = [], historyIndex = -1, currentProjectId = null;
let currentSubject = 'person';
let lastResults = [];
let selectedCandidate = null;
let lastClassification = null;
let lastDiscoveryMeta = null;

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
  if (!ps.length) {
    const p = { id: 'project_' + crypto.randomUUID(), name: 'My first investigation', question: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await put('projects', p);
    ps = [p];
  }
  currentProjectId = (currentProjectId && ps.some(p => p.id === currentProjectId)) ? currentProjectId : ps[0].id;
  renderProjects(ps);
  const cur = ps.find(p => p.id === currentProjectId);
  $('projectQuestion').value = cur?.question || '';
  if ($('projectInstructions')) $('projectInstructions').value = cur?.instructions || '';
  await refresh();
}
function renderProjects(ps) {
  $('projectSelect').innerHTML = ps.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  $('projectSelect').value = currentProjectId;
}

/* ---------- refresh / dashboard ---------- */
async function refresh() {
  const [refs, events, allLeads, queue] = await Promise.all([all('refs'), all('events'), all('leads'), all('queue')]);
  const projectRefs = refs.filter(r => r.projectId === currentProjectId);
  const projectLeads = allLeads.filter(x => x.projectId === currentProjectId);
  const projectEvents = events.filter(e => e.projectId === currentProjectId);
  $('refs').textContent = projectRefs.length;
  $('events').textContent = projectEvents.length;
  const p = buildPatterns(projectRefs);
  $('patterns').textContent = p.length;
  renderPatternBoard(projectRefs);
  renderArchive(projectRefs);
  renderSourceStats(projectRefs);
  renderDashboard(projectRefs);
  const q = queue.filter(x => x.projectId === currentProjectId);
  $('queueCount').textContent = q.filter(x => x.status === 'queued').length;
  renderQueue(q);
  $('projectCount').textContent = `${projectRefs.length} evidence item${projectRefs.length === 1 ? '' : 's'}`;
  renderLeads(projectLeads);
  const next = projectLeads.find(l => l.status === 'new');
  $('nextMove').textContent = next
    ? `Review this lead: ${next.text}`
    : q.some(x => x.status === 'queued') ? `Open the next queued source: ${q.find(x => x.status === 'queued')?.label || 'research item'}.`
    : projectRefs.length < 2 ? 'Run a discovery search or capture evidence so Carmen can compare it.'
    : p.length ? 'Compare evidence around one of the recurring patterns.' : 'Analyze more evidence to build recurring patterns.';
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
const TABS = [['navInvestigate', 'investigateView'], ['navCapture', 'captureView'], ['navEvidence', 'evidenceView'], ['navLeads', 'leadsView']];
function setTab(name) {
  const map = { investigate: 'investigateView', capture: 'captureView', evidence: 'evidenceView', leads: 'leadsView' };
  const view = map[name];
  for (const [nav, v] of TABS) {
    $(nav).classList.toggle('active', v === view);
    $(v).classList.toggle('hidden', v !== view);
  }
}

/* ---------- discovery / search ---------- */
function subjectLabel(s) { return ({ person: 'Person', topic: 'Topic', website: 'Website', claim: 'Claim', product: 'Product / Entity', position: 'Position / Instruction', other: 'Other' }[s] || 'Subject'); }
function subjectQueryHint(s) {
  return ({ person: 'Full name and any known context work best.', website: 'Paste a domain or URL.', claim: 'State the claim to verify.', product: 'Product, brand, or entity name.', position: 'Paste the instruction or position to examine.', topic: 'Describe the topic or question.', other: 'Describe what to investigate.' }[s] || '');
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
    hint.textContent = 'Tap a candidate card to select it, then Deep Dive. Without a selection, Deep Dive uses the top-ranked results.';
    btn.disabled = false;
  } else {
    hint.textContent = 'Deep Dive will expand “' + (selectedCandidate.title || selectedCandidate.domain || 'this candidate') + '” with more public sources, images, and OBSERVED / INFERRED / UNKNOWN analysis.';
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

async function discover() {
  const q = $('searchQuery').value.trim();
  if (!q) return toast('Enter a subject, name, or URL first.');
  const base = backendUrl();
  if (!base) return toast('Set the Carmen Worker URL in Capture → Connection.');
  localStorage.setItem(BACKEND_KEY, base);
  const btn = $('discoverBtn');
  btn.disabled = true;
  selectedCandidate = null;
  $('results').innerHTML = '<div class="skeleton" style="height:120px;margin-bottom:9px"></div>'.repeat(3);
  $('resultsEmpty').classList.add('hidden');
  $('searchDiagnostics').textContent = 'Searching public sources and ranking candidates…';
  $('classBar').innerHTML = '';
  $('selectedBanner').innerHTML = '';
  updateDeepDiveState();
  try {
    const r = await fetch(base + '/search?q=' + encodeURIComponent(q) + '&type=' + encodeURIComponent(currentSubject), { headers: { accept: 'application/json' } });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { throw Error(text || `HTTP ${r.status}`); }
    if (!r.ok || data.error) throw Error(data.error || `HTTP ${r.status}`);
    lastResults = Array.isArray(data.results) ? data.results : [];
    lastClassification = data.classification || null;
    lastDiscoveryMeta = data;
    renderClassification(data);
    renderResults(lastResults, data.providers || {});
    await put('discoveries', {
      id: currentProjectId, projectId: currentProjectId, query: q, subject: currentSubject,
      results: lastResults, providers: data.providers || {}, classification: data.classification,
      variants: data.variants, at: new Date().toISOString(), status: 'DISCOVERED',
    });
    await put('events', { id: 'evt_' + crypto.randomUUID(), projectId: currentProjectId, type: 'discovery_saved', at: new Date().toISOString(), query: q, resultCount: lastResults.length });
    updateDeepDiveState();
    toast(lastResults.length ? `Ranked ${lastResults.length} public candidate${lastResults.length === 1 ? '' : 's'}.` : 'No public results. See diagnostics.');
  } catch (e) {
    $('results').innerHTML = '';
    $('resultsEmpty').textContent = 'Discovery failed: ' + e.message;
    $('resultsEmpty').classList.remove('hidden');
    $('searchDiagnostics').textContent = '';
    toast('Discovery failed: ' + e.message);
  } finally {
    btn.disabled = false;
    updateDeepDiveState();
  }
}
function renderClassification(data) {
  const c = data && data.classification;
  if (!c) { $('classBar').innerHTML = ''; return; }
  const variants = (data.variants || []).map(v => esc(v.q) + (v.why ? ` <span class="muted">(${esc(v.why)})</span>` : '')).join(' · ');
  const warn = data.warning ? `<p class="warning">${esc(data.warning)}</p>` : '';
  $('classBar').innerHTML = `<p class="hint" style="margin-top:8px"><span class="badge">${esc(c.type)}</span> <span class="confidence ${esc(c.confidence)}">${esc(c.confidence)}</span> — ${esc(c.reason)}${c.isUrl ? ' · treating this as a page to inspect' : ''}${variants ? '<br>Search variants: ' + variants : ''}</p>${warn}`;
}
function selectCandidate(r, i) {
  selectedCandidate = r;
  document.querySelectorAll('#results .result').forEach(el => el.classList.toggle('selected', el.dataset.i === String(i)));
  $('selectedBanner').innerHTML = r ? `<div class="selbar"><b>Selected candidate</b><br>${esc(r.title || r.url)} · ${esc(r.domain || hostOf(r.url))}<br><small>${esc(r.reason || '')}</small></div>` : '';
  updateDeepDiveState();
  persistSelection(r);
}
async function persistSelection(r) {
  if (!currentProjectId || !r) return;
  try {
    const disc = (await all('discoveries')).find(d => d.id === currentProjectId) || { id: currentProjectId, projectId: currentProjectId };
    disc.selectedUrl = r.url;
    disc.results = lastResults;
    await put('discoveries', disc);
  } catch {}
}
function openLightbox(src, cap) {
  const box = $('lightbox');
  if (!box) return;
  $('lightboxImg').src = src;
  $('lightboxCap').textContent = cap || 'Image keeps its page provenance. Visual consistency is not identity proof.';
  box.classList.remove('hidden');
}
function closeLightbox() {
  const box = $('lightbox');
  if (!box) return;
  box.classList.add('hidden');
  $('lightboxImg').src = '';
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
            <div class="rsrc"><span class="host">${esc(r.domain || hostOf(r.url))}</span> · ${esc(r.source)} · ${provenanceBadge(r.provenance || 'DISCOVERED')} · <span class="confidence ${esc(r.confidence || 'low')}">${esc(confidenceLabel(r.confidence))}</span>${r.observedAt ? ' · ' + esc(new Date(r.observedAt).toLocaleString()) : ''}</div>
          </div>
        </div>
        ${r.reason ? `<div class="rwhy">${esc(r.reason)}</div>` : ''}
        ${aliases.length ? `<div class="aliases">${aliases.map(a => `<span>${esc(a)}</span>`).join('')}</div>` : ''}
        ${r.snippet ? `<div class="rsnippet">${esc(r.snippet)}</div>` : ''}
        ${rest.length ? `<div class="thumbs">${rest.map(u => `<img data-full="${esc(imgSrc(u))}" data-cap="${esc((r.domain || '') + ' · ' + (r.url || ''))}" src="${esc(imgSrc(u))}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">`).join('')}</div>` : ''}
        <div class="racts">
          <button data-ract="select" data-i="${i}">${selected ? 'Selected' : 'Select'}</button>
          <button data-ract="open" data-i="${i}">Open</button>
          <button data-ract="evidence" data-i="${i}">Save evidence</button>
          <button data-ract="dive" data-i="${i}">Deep dive</button>
        </div>
      </div>
    </div>`;
  }).join('');
  updateDeepDiveState();
}
function renderDiagnostics(providers) {
  const entries = Object.entries(providers || {});
  if (!entries.length) return '';
  return 'Providers: ' + entries.map(([k, v]) => v && v.ok ? `<span class="ok">${esc(k)} ✓</span>` : `<span class="bad">${esc(k)} ✗${v && v.error ? ' ' + esc(v.error) : v && v.status ? ' HTTP ' + v.status : ''}</span>`).join(' · ');
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

/* ---------- deep dive (AI chat) ---------- */
async function deepDive(focusResult) {
  const base = backendUrl();
  if (!base) return toast('Set the Carmen Worker URL in Capture → Connection.');
  const subject = $('searchQuery').value.trim() || $('projectQuestion').value.trim();
  const candidate = focusResult || selectedCandidate || lastResults[0] || null;
  if (!subject && !candidate) return toast('Search and select a candidate first.');
  localStorage.setItem(BACKEND_KEY, base);
  const btn = $('deepDiveBtn');
  btn.disabled = true;
  if (candidate) selectCandidate(candidate, Math.max(0, lastResults.findIndex(x => x.url === candidate.url)));
  $('deepDiveProgress').innerHTML = '<p class="dive-step on">Planning investigation…</p><p class="dive-step">Retrieving public sources…</p><p class="dive-step">Collecting images…</p><p class="dive-step">Analyzing OBSERVED / INFERRED / UNKNOWN…</p>';
  $('deepDiveResult').innerHTML = '<p class="muted">Deep Dive expands the selected candidate. This is read-only public research.</p>';
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
        subject: currentSubject,
        candidate,
        instructions,
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
    const disc = (await all('discoveries')).find(d => d.id === currentProjectId) || { id: currentProjectId, projectId: currentProjectId };
    disc.deepDiveText = data.analysis || '';
    disc.deepDiveAt = new Date().toISOString();
    disc.deepDiveSubject = subject;
    disc.deepDiveFocusUrl = candidate?.url || '';
    disc.deepDivePlan = data.plan;
    disc.deepDiveImages = data.images;
    disc.results = lastResults;
    await put('discoveries', disc);
    await put('events', { id: 'evt_' + crypto.randomUUID(), projectId: currentProjectId, type: 'deep_dive', at: new Date().toISOString(), subject, focusUrl: candidate?.url || '' });
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
  } finally { updateDeepDiveState(); }
}
function renderDeepDivePayload(data, subject) {
  const plan = data.plan || {};
  const steps = (plan.investigating || []).map(s => `<p class="dive-step on">${esc(s)}</p>`).join('');
  $('deepDiveProgress').innerHTML = steps || '<p class="dive-step on">Deep dive finished.</p>';
  const imgs = (data.images || []).slice(0, 12);
  const imgHtml = imgs.length ? `<div class="thumbs">${imgs.map(im => `<img src="${esc(imgSrc(im.url || im))}" alt="" title="${esc((im.domain || '') + ' · ' + (im.pageUrl || ''))}" referrerpolicy="no-referrer" onerror="this.style.display='none'">`).join('')}</div>
    <p class="hint">Images keep page provenance. Visual consistency across sources is not identity proof.</p>` : '<p class="hint">No reliable images were retrieved for this candidate.</p>';
  const retrieved = (data.retrieved || []).map(x => `<div class="pattern"><b>${esc(x.title || x.url)}</b> ${provenanceBadge(x.status)}<br><small>${esc(x.finalUrl || x.url || '')}${x.error ? ' · ' + esc(x.error) : ''}</small></div>`).join('');
  let analysisHtml = '';
  if (data.analysis) analysisHtml = renderDeepDive(data.analysis, subject, true);
  else if (data.analysisError) analysisHtml = `<div class="claim unknown"><b>Analysis unavailable</b><br>${esc(data.analysisError)}</div>`;
  $('deepDiveResult').innerHTML = `
    <div class="claim"><b>Investigating</b><br>${esc(plan.subject || subject)} <span class="badge">${esc(plan.type || currentSubject)}</span><br><small>${esc(plan.why || '')}</small><br><small>${esc(plan.safety || 'Read-only public research.')}</small></div>
    ${retrieved ? `<h4>Retrieved sources</h4>${retrieved}` : ''}
    <h4>Visual evidence</h4>${imgHtml}
    ${analysisHtml}`;
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

/* ---------- event wiring ---------- */
function wire() {
  // tabs
  $('navInvestigate').onclick = () => setTab('investigate');
  $('navCapture').onclick = () => setTab('capture');
  $('navEvidence').onclick = () => setTab('evidence');
  $('navLeads').onclick = () => setTab('leads');
  $('quickDiscover').onclick = () => setTab('investigate');
  $('quickCapture').onclick = () => { setTab('capture'); $('pick').click(); };
  $('quickArchive').onclick = () => setTab('evidence');
  $('quickLeads').onclick = () => setTab('leads');

  // projects
  $('projectSelect').onchange = async () => {
    currentProjectId = $('projectSelect').value;
    const ps = await all('projects');
    $('projectQuestion').value = ps.find(p => p.id === currentProjectId)?.question || '';
    await loadDiscovery();
    await refresh();
  };
  $('newProject').onclick = async () => {
    const name = prompt('Name this investigation:', 'New investigation');
    if (!name?.trim()) return;
    const p = { id: 'project_' + crypto.randomUUID(), name: name.trim(), question: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await put('projects', p);
    currentProjectId = p.id;
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

  // discovery
  $('searchQuery').addEventListener('input', updateDeepDiveState);
  $('searchQuery').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); discover(); } });
  $('discoverBtn').onclick = discover;
  $('deepDiveBtn').onclick = () => deepDive(selectedCandidate);
  $('addQueueBtn').onclick = () => { setTab('investigate'); $('queueUrl').focus(); };
  if ($('lightboxClose')) $('lightboxClose').onclick = closeLightbox;
  if ($('lightbox')) $('lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') closeLightbox(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
  $('results').onclick = async e => {
    const full = e.target.closest('img[data-full]');
    if (full && full.dataset.full) {
      e.stopPropagation();
      openLightbox(full.dataset.full, full.dataset.cap || '');
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
    else if (act === 'queue') { await queueFromResult(r); }
    else if (act === 'dive') { selectCandidate(r, +b.dataset.i); await deepDive(r); }
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
    if (action === 'question') { $('searchQuery').value = l.text; setTab('investigate'); toast('Lead copied into the discovery query.'); }
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
  if (disc.query) $('searchQuery').value = disc.query;
  renderClassification(disc);
  renderResults(lastResults, disc.providers || {});
  const focusUrl = disc.selectedUrl || disc.deepDiveFocusUrl;
  if (focusUrl) {
    const focus = lastResults.find(r => r.url === focusUrl);
    if (focus) selectCandidate(focus, lastResults.indexOf(focus));
  }
  if (disc.deepDiveText) {
    renderDeepDivePayload({ plan: disc.deepDivePlan, analysis: disc.deepDiveText, images: disc.deepDiveImages || [], retrieved: [] }, disc.deepDiveSubject || disc.query || '');
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
  await loadDiscovery();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init().catch(e => toast('Local archive unavailable: ' + e.message));
