// Carmen — canonical Cloudflare Worker backend.
// Routes: GET /health, GET /search, GET /img, POST /dive, GET|POST /retrieve, GET|POST /source,
// POST /chat, POST /analyze, POST /synthesize, GET /test, GET /browser-test.
// /test and /browser-test serve the SAME frontend as / via ASSETS (no parallel UI, no redirect).
// Everything else is served from static assets (the Carmen frontend) via the ASSETS binding.
//
// Safety contract: Carmen is a research/analysis tool only. It never contacts
// people, sends messages, posts, comments, submits forms, makes purchases,
// creates accounts, performs transactions, or takes any external action on a
// user's behalf. The AI system prompt enforces this; the search layer only
// reads public web pages.

import {
  PLANNER_VERSION,
  PLANNER_BUILD,
  parseInvestigationIntent,
  resolveKnownEntity,
  buildTopicMap,
  plannerLaneQueries,
  evidenceForResult,
  isQueryEchoTitle,
  isRedditSearchPage,
  isActualRedditEvidence,
  annotateProvenance,
  classifyAccountOwnership,
  mergeInvestigationEvidence,
  sourceDiversityReport,
  shouldOpenMoreAdultLanes,
  corpusDiagnosis,
  competingIdentityCandidates,
  findMoreQueries,
  moreLikeThisQueries,
  findDifferentQueries,
  findSimilarQueries,
  searchThisVisualQueries,
  moreFromThisSourceQueries,
  moreFromThisPersonQueries,
  moreOnThisTopicQueries,
  canonicalizeUrl,
  ADULT_SOURCE_CLASSES,
  PREMIUM_PLATFORM_SEEDS,
  analyzePayloadKind,
  videoFrameHonesty,
  imageQueryInherits,
  KNOWN_SITE_ENTITIES,
  applyIdentityFeedback,
  mergeIdentityFeedback,
  knownSiteAccessStatus,
  classifyProviderFailure,
  evidenceBuckets,
  serializeEvidenceItem,
  createInvestigationState,
  applyInvestigationAction,
  API_ACTION_CATALOG,
  DETERMINISTIC_FIXTURES,
  fixtureItems,
  newInvestigationId,
  buildLensQueries,
  nextFindMoreLane,
  additiveMerge,
  extractDiscoverySeeds,
  applyVisualIdentityFilter,
  visualIdentityGrade,
  expansionReport,
  PRIMARY_DIVE_LENSES,
  NO_NEW_SOURCES_MESSAGE,
  primaryDiveLenses,
  looksLikeFirstPartySource,
  fillTopicMapFromEvidence,
  isObjectOrTechniquePhrase,
  firstPartyDomains,
  isNaiveLensQuery,
  resolveIdentityAnchor,
  subsequentRetrievalFromFeedback,
  retrievalExecutionOrder,
  plannedWebExecutionSequence,
  isClothingColorFalsePositive,
  auditStructuredResults,
  RETRIEVAL_PHASES,
  routeNaturalLanguageResearch,
  isTutorialIntent,
  parseRetrievalIntents,
  fictionalNameCollision,
  semanticVariations,
  classifyVisualRelevance,
  classifyMatchQuality,
  classifyContentType,
  socialShouldDeprioritize,
  sourceVolumePenalty,
  premiumAccessClassification,
  premiumEscalationQueries,
  publicAccountQueries,
  tutorialQueries,
  detectImpersonator,
  buildEntityIdentityRecord,
  buildWhatCarmenChecked,
  buildWhyDidYouStop,
  coupleEntityTopic,
  keepEntityTopicQueries,
  negativeResultReport,
  ANIME_CARTOON_HOSTS,
  SOCIAL_IDENTITY_HOSTS,
  PREMIUM_ACCESS_STATES,
  identityDisambiguation,
  conceptOrthographyVariants,
  conceptDiscoveryQueries,
  conceptVisualSearchQuery,
  isRestraintTechnique,
  identityVariantQueries,
  visualInvestigationQueries,
  entityAssociatedVisualQueries,
  accountInvestigationQueries,
  extractInvestigationSeeds,
  evaluateNovelty,
  createAdaptiveController,
  enqueueInvestigationPaths,
  nextInvestigationBatch,
  recordInvestigationBatch,
  decideInvestigationContinuation,
  enqueueAdaptiveFamilies,
  seedsToQueries,
  adaptiveTrace,
  ADAPTIVE_TIME_GUARD_MS,
  ADAPTIVE_MAX_ITERATIONS,
  ADAPTIVE_BATCH_SIZE,
  buildIdentityVerificationPack,
  visualEvidenceGate,
  applyVisualEvidenceGate,
  dedupeVisualEvidence,
  findMoreVisualQueries,
  serializeAdaptiveController,
  restoreAdaptiveController,
  persistInvestigationQueue,
  resumeInvestigationQueue,
  identityPhaseShouldHoldExpansion,
  analyzePublicAccountPlan,
  sourceLifecycleState,
  parseResearchFocus,
  adaptiveLensesForFocus,
  researchFocusQueries,
  honestResourceStop,
  queuedWorkSummary,
  suppressionFromRejection,
  sourceIdFromCanonicalUrl,
  canonicalizeExactSourceUrl,
  identifyExactSourceType,
  parseRedditPermalink,
  parsePremiumProfile,
  exactSourceIdentity,
  parseRedditListing,
  extractOutboundLinks,
  extractEntitiesFromExcerpt,
  extractTopicsFromExcerpt,
  createExactSourceSeeds,
  terminalStateForExactSource,
  buildSourceDebug,
  attachExactSourceToInvestigation,
  EXACT_SOURCE_PIPELINE_LABELS,
  SOURCE_ANALYSIS_STATES,
  isGenericPlatformDiscoveryQuery,
} from './investigation-planner.js';


const MAX_RESULTS = 20;
const DIVE_RESULTS_CAP = 48;
const SEARCH_TIMEOUT_MS = 8000;
const AI_TIMEOUT_MS = 30000;
const FETCH_HARD_CAP = 45;
const INVESTIGATION_TIME_GUARD_MS = ADAPTIVE_TIME_GUARD_MS;
let SEARCH_BUDGET = { used: 0, max: 36, reserved: { reddit: 0, adultIdentity: 0, visual: 0 } };
let FETCH_COUNT = 0;
const FETCH_KINDS = { search: 0, retrieve: 0, image: 0, video: 0, graph: 0, ai: 0 };

function emptyReservedBudget() {
  return { reddit: 0, adultIdentity: 0, visual: 0, account: 0 };
}
function resetFetchBudget(max) {
  FETCH_COUNT = 0;
  FETCH_KINDS.search = FETCH_KINDS.retrieve = FETCH_KINDS.image = FETCH_KINDS.video = FETCH_KINDS.graph = FETCH_KINDS.ai = 0;
  SEARCH_BUDGET = { used: 0, max: Math.min(max || 28, FETCH_HARD_CAP), reserved: emptyReservedBudget() };
}
function remainingFetches() { return Math.max(0, FETCH_HARD_CAP - FETCH_COUNT); }
function budgetReport() {
  return { used: FETCH_COUNT, max: FETCH_HARD_CAP, remaining: remainingFetches(), search: FETCH_KINDS.search, retrieve: FETCH_KINDS.retrieve, image: FETCH_KINDS.image, video: FETCH_KINDS.video, graph: FETCH_KINDS.graph, ai: FETCH_KINDS.ai, reserved: { ...(SEARCH_BUDGET.reserved || emptyReservedBudget()) } };
}
function noteFetchKind(url) {
  const u = String(url || '');
  if (/\/chat\/completions|openrouter\.ai/i.test(u)) FETCH_KINDS.ai++;
  else if (/bing\.com\/images/i.test(u)) FETCH_KINDS.image++;
  else if (/bing\.com\/videos/i.test(u)) FETCH_KINDS.video++;
  else if (/html\.duckduckgo|lite\.duckduckgo|bing\.com\/search|reddit\.com\/.*search|wikipedia\.org\/w\/api|startpage\.com|mojeek\.com|pullpush\.io|web\.archive\.org|archive\.org\/wayback/i.test(u)) FETCH_KINDS.search++;
  else FETCH_KINDS.retrieve++;
}

const PROVIDERS = ['DuckDuckGo', 'Bing', 'Google', 'Mojeek', 'Startpage', 'Yahoo', 'Reddit'];

const BLOCKED_HOSTS = new Set([
  'duckduckgo.com', 'www.duckduckgo.com',
  'bing.com', 'www.bing.com', 'microsoft.com', 'www.microsoft.com',
  'google.com', 'www.google.com',
  'search.yahoo.com', 'yahoo.com', 'www.yahoo.com',
  'mojeek.com', 'www.mojeek.com',
  'startpage.com', 'www.startpage.com',
  // search-engine help/account/nav surfaces that leak into result lists
  'support.google.com', 'support.microsoft.com', 'support.apple.com',
  'accounts.google.com', 'myaccount.google.com', 'policies.google.com',
  'go.microsoft.com', 'www.msn.com', 'msn.com',
  'support.startpage.com', 'support.duckduckgo.com',
  'blog.mojeek.com', 'community.mojeek.com',
  'about.google', 'ads.google.com',
]);

const NAV_LINK_RE = /^(images?|videos?|news|maps|shopping|mail|sign in|sign up|log in|login|more|web|all|finance|sports|weather|travel|games?|apps?|about|help|privacy|terms|settings|preferences|account|home|search|filter|tools?|feedback|learn more|learn|mobile|desktop|menu|skip|close|open|back|next|previous|continue|submit|cancel|yes|no)$/i;

function cors(req) {
  const origin = req.headers.get('Origin') || '';
  const allowedExact = new Set([
    'http://localhost:8787',
    'http://127.0.0.1:8787',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'https://carmen-iphone-v25.94bwfd5grv.workers.dev',
  ]);
  let allow = 'https://carmen-iphone-v25.94bwfd5grv.workers.dev';
  if (origin) {
    if (allowedExact.has(origin) || origin.endsWith('.workers.dev') ||
        origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:') || origin.endsWith('.grok.app') || origin.includes('grok.com') ||
        origin.endsWith('.chatgpt.com') || origin === 'https://chatgpt.com' || origin.includes('openai.com')) {
      allow = origin;
    }
  } else {
    allow = '*';
  }
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type, x-carmen-client, x-carmen-test-key, x-carmen-api-key, authorization',
    'access-control-expose-headers': 'x-carmen-version, x-carmen-build, x-carmen-browser-test',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}

function json(value, status, req, extra = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...cors(req),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-carmen-version': PLANNER_VERSION,
      'x-carmen-build': PLANNER_BUILD,
      ...extra,
    },
  });
}

function cleanText(s = '') {
  return decodeEntities(String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function decodeEntities(s = '') {
  // Build named-entity patterns at runtime so the source cannot get HTML-decoded
  // by editors into no-op replacements.
  return String(s)
    .replace(new RegExp('&' + 'nbsp;', 'gi'), ' ')
    .replace(new RegExp('&' + 'amp;', 'gi'), '&')
    .replace(new RegExp('&' + 'quot;', 'gi'), '"')
    .replace(new RegExp('&' + 'apos;', 'gi'), "'")
    .replace(new RegExp('&' + 'lt;', 'gi'), '<')
    .replace(new RegExp('&' + 'gt;', 'gi'), '>')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ''; } });
}

function decodeBingBase64Url(raw) {
  try {
    let s = String(raw || '');
    if (!s) return '';
    try { s = decodeURIComponent(s); } catch {}
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith('a1')) s = s.slice(2);
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const decoded = atob(s);
    if (/^https?:\/\//i.test(decoded)) return decoded;
  } catch {}
  return '';
}

// Resolve redirect-wrapped URLs (DuckDuckGo uddg=, Bing ck/a u=a1…, etc.).
function unwrap(raw) {
  let url = decodeEntities(String(raw || '')).trim();
  if (!url) return '';
  if (url.startsWith('//')) url = 'https:' + url;
  try {
    const u = new URL(url);
    for (const key of ['uddg', 'url', 'u', 'ru', 'goto']) {
      const target = u.searchParams.get(key);
      if (!target) continue;
      if (/^https?:\/\//i.test(target)) {
        try { return decodeURIComponent(target); } catch { return target; }
      }
      if (key === 'u' && /(^|\.)bing\.com$/i.test(u.hostname)) {
        const decoded = decodeBingBase64Url(target);
        if (decoded) return decoded;
      }
    }
  } catch {}
  return url;
}

function validUrl(url) {
  try { return /^https?:$/i.test(new URL(url).protocol); } catch { return false; }
}

// Strip a trailing/leading bare URL copied into a title by messy anchor parsing.
function cleanTitle(title) {
  let t = cleanText(decodeEntities(title));
  if (!t) return '';
  // Remove any embedded "https://..." fragments (Bing/Yahoo splice the URL into the title).
  t = t.replace(/https?:\/\/\S+/gi, ' ').trim();
  // Drop a leading "host.com" breadcrumb token copied in front of the real title.
  t = t.replace(/^\s*[\w.-]+\.(com|net|org|gov|edu|io|co|ai|us|uk|de)\b[\s\u203a>\-]*/i, '').trim();
  // Drop trailing " › path › segment" breadcrumb leftovers.
  t = t.replace(/\s+\u203a.*$/g, '').trim();
  t = t.replace(/\s+/g, ' ').trim();
  if (NAV_LINK_RE.test(t)) return '';
  if (t.length < 4 || t.length > 300) return '';
  if (/^[\w.-]+\.(com|net|org|gov|edu|io|co|ai)$/i.test(t)) return ''; // bare host
  return t;
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function isQueryShapedTitle(title) {
  const t = String(title || '');
  if (/\sOR\s/.test(t) && /[("']/.test(t)) return true;
  if (/\bsite:/i.test(t)) return true;
  if (/^\s*"[^"]+"\s*\(/.test(t)) return true;
  return false;
}

function isRedditHost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'reddit.com' || h.endsWith('.reddit.com');
}

function uniqueAdd(results, seen, item) {
  const url = unwrap(item.url);
  const title = cleanTitle(item.title);
  if (!validUrl(url) || !title) return false;
  const host = hostOf(url);
  if (BLOCKED_HOSTS.has(host)) return false;
  if (isRedditSearchPage(url, title)) return false;
  if (item.queryVariant && isQueryEchoTitle(title, item.queryVariant, { subject: item.subject || '' }) && !isActualRedditEvidence(url)) return false;
  let source = String(item.source || 'Public web').slice(0, 120);
  let accessState = item.accessState || '';
  let retrievalLane = item.retrievalLane || '';
  if (isRedditHost(host)) {
    if (!/^Reddit/i.test(source)) {
      source = item.sourceLabel || 'Reddit (indexed)';
      accessState = accessState || 'PUBLIC_ALTERNATIVE';
      retrievalLane = retrievalLane || 'indexed-reddit';
    } else if (!retrievalLane) {
      if (/pullpush/i.test(source)) retrievalLane = 'pullpush';
      else if (/wayback/i.test(source)) retrievalLane = 'wayback';
      else if (/indexed/i.test(source)) retrievalLane = 'indexed-reddit';
      else retrievalLane = 'direct-reddit';
    }
  }
  let href;
  try { href = new URL(url).href.replace(/#.*$/, ''); } catch { return false; }
  const key = canonicalVideoKey(href) || href;
  if (seen.has(key) || seen.has(href)) {
    const existing = results.find(r => r.url === href || r.canonicalUrl === canonicalizeUrl(href) || (r.videoId && key && r.videoId === key));
    if (existing) {
      const path = item.discoveryLane || item.queryVariant || item.source || '';
      existing.discoveryPaths = existing.discoveryPaths || [existing.discoveryLane || existing.queryVariant || existing.source].filter(Boolean);
      if (path && !existing.discoveryPaths.includes(path)) existing.discoveryPaths.push(path);
      existing.corroboration = (existing.corroboration || 1) + 1;
      if (!existing.retrievedAt) existing.retrievedAt = existing.observedAt;
    }
    return false;
  }
  seen.add(key);
  if (key !== href) seen.add(href);
  const images = Array.isArray(item.images) ? item.images.filter(x => typeof x === 'string' && x.startsWith('http')).slice(0, 8) : [];
  const image = typeof item.image === 'string' && item.image.startsWith('http') ? item.image : (images[0] || '');
  const videoId = (youtubeId(href) || vimeoId(href)) ? key : (item.videoId || '');
  const prov = annotateProvenance({ url: href, title, snippet: item.snippet || '' });
  const row = {
    title: title.slice(0, 240),
    url: href,
    canonicalUrl: canonicalizeUrl(href),
    source: source.slice(0, 120),
    snippet: cleanText(decodeEntities(item.snippet || '')).slice(0, 600),
    image,
    images,
    observedAt: new Date().toISOString(),
    queryVariant: item.queryVariant || '',
    videoId,
    host: prov.host,
    publisher: prov.publisher,
    creator: prov.creator,
    originalSource: prov.originalSource,
    reposter: prov.reposter,
    mirror: prov.mirror,
  };
  if (accessState) row.accessState = accessState;
  if (retrievalLane) row.retrievalLane = retrievalLane;
  if (item.sourceLane) row.sourceLane = item.sourceLane;
  if (item.discoveryLane) row.discoveryLane = item.discoveryLane;
  if (item.plannerSourceClass) row.plannerSourceClass = item.plannerSourceClass;
  if (item.sourceClass) row.sourceClass = item.sourceClass;
  if (item.sourceLabel) row.sourceLabel = item.sourceLabel;
  row.discoveryPaths = [item.discoveryLane || item.queryVariant || item.source].filter(Boolean);
  row.corroboration = 1;
  row.retrievedAt = row.observedAt;
  results.push(row);
  return true;
}

async function fetchText(url, init = {}, timeout = SEARCH_TIMEOUT_MS) {
  if (FETCH_COUNT >= FETCH_HARD_CAP) {
    const err = new Error('Research budget reached');
    err.name = 'BudgetExhausted';
    throw err;
  }
  FETCH_COUNT++;
  noteFetchKind(url);
  SEARCH_BUDGET.used = Math.max(SEARCH_BUDGET.used, FETCH_COUNT);
  const attemptOnce = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally { clearTimeout(timer); }
  };
  let res = await attemptOnce();
  if (res && (res.status === 503 || res.status === 429)) {
    await new Promise(r => setTimeout(r, 280));
    if (FETCH_COUNT < FETCH_HARD_CAP) {
      FETCH_COUNT++;
      SEARCH_BUDGET.used = Math.max(SEARCH_BUDGET.used, FETCH_COUNT);
      try { res = await attemptOnce(); } catch { /* keep first 503 */ }
    }
  }
  return res;
}

const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

// --- Provider-specific parsers ------------------------------------------------
// Each returns true if it produced any results. Falls back to generic anchor
// parsing so a changed class name never zeroes out a whole provider.

function parseDDG(html, results, seen) {
  const out = [];
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = unwrap(m[1]);
    // Snippet follows in a result__snippet anchor.
    const after = html.slice(m.index, m.index + 1600);
    const sm = after.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    out.push({ title: m[2], url, snippet: sm ? sm[1] : '', source: 'DuckDuckGo' });
  }
  let added = false;
  for (const it of out) added = uniqueAdd(results, seen, it) || added;
  return added;
}

function parseBing(html, results, seen) {
  // Bing mobile: the page title lives in <h2>...</h2>, the URL in a separate
  // <a class="tilk" href> anchor, and the snippet in a <p>.
  // Desktop/safe-search pages often wrap the real destination in bing.com/ck/a
  // or only expose it in <cite>.
  let added = false;
  const re = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(html))) {
    const block = m[1];
    const hm = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const um = block.match(/href="(https?:[^"]+)"/i);
    const cite = block.match(/<cite[^>]*>([\s\S]*?)<\/cite>/i);
    let url = um ? unwrap(um[1]) : '';
    const host = hostOf(url);
    if ((!url || BLOCKED_HOSTS.has(host) || /(^|\.)bing\.com$/i.test(host)) && cite) {
      const cited = citeToUrl(cite[1]);
      if (cited) url = cited;
    }
    if (!hm || !url) continue;
    const sm = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    added = uniqueAdd(results, seen, { title: hm[1], url, snippet: sm ? sm[1] : '', source: 'Bing' }) || added;
  }
  return added;
}

function citeToUrl(citeHtml) {
  const text = cleanText(decodeEntities(citeHtml || '')).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  let s = text.replace(/\s+[\u203a>]\s+/g, '/').replace(/\s+/g, '');
  s = s.replace(/\/+$/, '');
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(s)) return 'https://' + s;
  return '';
}

function parseYahoo(html, results, seen) {
  let added = false;
  const re = /<a[^>]*class="[^"]*(?:yschttl| ac-1st|result-link)[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    added = uniqueAdd(results, seen, { title: m[2], url: unwrap(m[1]), snippet: '', source: 'Yahoo' }) || added;
  }
  return added;
}

function parseGoogle(html, results, seen) {
  let added = false;
  // Google wraps result titles in <h3> inside an <a href>.
  const re = /<a[^>]*href="\/url\?q=([^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  let m;
  while ((m = re.exec(html))) {
    added = uniqueAdd(results, seen, { title: m[2], url: decodeURIComponent(m[1]), snippet: '', source: 'Google' }) || added;
  }
  if (!added) {
    const re2 = /<h3[^>]*>([\s\S]*?)<\/h3>\s*(?:<\/div>)?\s*<\/a>/gi;
    while ((m = re2.exec(html))) {
      // Best-effort: find the nearest preceding href.
      const before = html.slice(Math.max(0, m.index - 400), m.index);
      const hm = before.match(/href="([^"]+)"/g);
      if (hm) {
        const href = hm[hm.length - 1].replace(/^href="|"/g, '');
        added = uniqueAdd(results, seen, { title: m[1], url: href, snippet: '', source: 'Google' }) || added;
      }
    }
  }
  return added;
}

function parseMojeek(html, results, seen) {
  let added = false;
  const re = /<a[^>]*class="[^"]*ob[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    added = uniqueAdd(results, seen, { title: m[2], url: unwrap(m[1]), snippet: '', source: 'Mojeek' }) || added;
  }
  return added;
}

function parseStartpage(html, results, seen) {
  let added = false;
  const re = /<a[^>]*class="[^"]*w-gl__result[^"]*"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<span[^>]*class="[^"]*w-gl__result-title[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
  let m;
  while ((m = re.exec(html))) {
    added = uniqueAdd(results, seen, { title: m[2], url: unwrap(m[1]), snippet: '', source: 'Startpage' }) || added;
  }
  return added;
}

// Generic fallback: extract ordinary result-like links.
function parseAnchors(html, source, results, seen, limit) {
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < limit) {
    const url = unwrap(m[1]);
    const host = hostOf(url);
    if (!host || BLOCKED_HOSTS.has(host)) continue;
    // Reddit URLs from indexed web results are kept and labeled in uniqueAdd.
    // Require a real-looking title (not a bare nav link).
    const title = cleanTitle(m[2]);
    if (!title) continue;
    uniqueAdd(results, seen, { title, url, source });
  }
}

async function htmlSearch(url, source, parser, results, seen, diagnostics, queryVariant = '') {
  if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) {
    diagnostics[source] = { error: 'skipped (fetch budget)' };
    return;
  }
  SEARCH_BUDGET.used++;
  const before = results.length;
  try {
    const r = await fetchText(url, { headers: BROWSER_HEADERS });
    const challenged = r.status === 202 || r.status === 403;
    diagnostics[source] = { status: r.status, ok: r.ok && !challenged };
    if (challenged) diagnostics[source].error = r.status === 202 ? 'challenge' : 'blocked';
    if (!r.ok) return;
    const html = await r.text();
    const structured = parser ? parser(html, results, seen) : false;
    if (!structured) parseAnchors(html, source, results, seen, MAX_RESULTS);
    if (challenged && results.length === before) diagnostics[source].added = 0;
  } catch (e) {
    if (e && e.name === 'BudgetExhausted') {
      diagnostics[source] = { error: 'skipped (fetch budget)' };
      return;
    }
    diagnostics[source] = { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200) };
  }
  if (queryVariant) {
    for (let i = before; i < results.length; i++) {
      if (!results[i].queryVariant) results[i].queryVariant = queryVariant;
    }
  }
}

async function ddg(q, results, seen, diagnostics) {
  const before = results.length;
  await htmlSearch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q) + '&kp=-2', 'DuckDuckGo', parseDDG, results, seen, diagnostics, q);
  // Retry Lite when THIS query added nothing — not when the global result
  // set is already full from an earlier reserved lane.
  if (results.length === before) {
    await htmlSearch('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q), 'DuckDuckGo Lite', null, results, seen, diagnostics, q);
  }
}

async function bing(q, results, seen, diagnostics) {
  await htmlSearch('https://www.bing.com/search?q=' + encodeURIComponent(q) + '&adlt=off', 'Bing', parseBing, results, seen, diagnostics, q);
}

async function google(q, results, seen, diagnostics) {
  await htmlSearch('https://www.google.com/search?q=' + encodeURIComponent(q) + '&safe=off&num=10', 'Google', parseGoogle, results, seen, diagnostics, q);
}

async function mojeek(q, results, seen, diagnostics) {
  await htmlSearch('https://www.mojeek.com/search?q=' + encodeURIComponent(q), 'Mojeek', parseMojeek, results, seen, diagnostics, q);
}

async function startpage(q, results, seen, diagnostics) {
  await htmlSearch('https://www.startpage.com/sp/search?query=' + encodeURIComponent(q) + '&cat=web', 'Startpage', parseStartpage, results, seen, diagnostics, q);
}

async function yahoo(q, results, seen, diagnostics) {
  await htmlSearch('https://search.yahoo.com/search?p=' + encodeURIComponent(q), 'Yahoo', parseYahoo, results, seen, diagnostics, q);
}

function unescapeJsonUrl(s) {
  return decodeEntities(String(s || '').replace(/\\u0026/g, '&').replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/\\"/g, '"'));
}

function attachImageHit(results, seen, hit, diagnosticsKey) {
  const image = usableImage(hit.image) || usableImage(hit.thumb);
  if (!image) return false;
  const pageUrl = unwrap(hit.pageUrl || '');
  if (pageUrl && validUrl(pageUrl)) {
    const existing = results.find(r => r.url === pageUrl || (hostOf(r.url) === hostOf(pageUrl) && hostOf(pageUrl)));
    if (existing) {
      existing.images = rankImages([...(existing.images || []), image, hit.thumb], existing.url).slice(0, 8);
      existing.image = existing.image || existing.images[0] || '';
      existing.imageOrigin = existing.imageOrigin || 'image-index';
      return true;
    }
  }
  const hostTitle = hostOf(pageUrl || image).replace(/^www\./, '');
  const rawTitle = cleanTitle(hit.title);
  const title = (rawTitle && !isQueryShapedTitle(rawTitle)) ? rawTitle : (hostTitle ? hostTitle + ' image' : 'Public image result');
  const url = (pageUrl && validUrl(pageUrl)) ? pageUrl : image;
  return uniqueAdd(results, seen, {
    title,
    url,
    source: diagnosticsKey || 'Image index',
    snippet: 'Public image-index result. Attribution is the hosting page — visual likeness is not identity proof.',
    image,
    images: [image, hit.thumb].filter(Boolean),
    queryVariant: hit.query || '',
  });
}

async function bingImages(q, results, seen, diagnostics, limit, visualHits, first) {
  const cap = Math.max(12, Math.min(Number(limit) || 24, 36));
  const offset = Math.max(0, Number(first) || 0);
  const hits = Array.isArray(visualHits) ? visualHits : null;
  if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) {
    diagnostics['Bing Images'] = { error: 'skipped (fetch budget)' };
    return;
  }
  SEARCH_BUDGET.used++;
  try {
    const r = await fetchText('https://www.bing.com/images/search?q=' + encodeURIComponent(q) + '&adlt=off' + (offset ? ('&first=' + (offset + 1)) : ''), { headers: BROWSER_HEADERS });
    diagnostics['Bing Images'] = { status: r.status, ok: r.ok, first: offset };
    if (!r.ok) return;
    const html = decodeEntities(await r.text());
    const re = /"murl":"([^"]+)","turl":"([^"]+)"[\s\S]{0,400}?"purl":"([^"]+)"[\s\S]{0,200}?"t":"([^"]*)"/g;
    let m, added = 0;
    while ((m = re.exec(html)) && added < cap) {
      const hit = {
        image: unescapeJsonUrl(m[1]),
        thumb: unescapeJsonUrl(m[2]),
        pageUrl: unescapeJsonUrl(m[3]),
        title: unescapeJsonUrl(m[4]),
        query: q,
      };
      const toHits = hits ? pushVisualHit(hits, hit, 'Bing Images') : false;
      const toResults = added < 4 ? attachImageHit(results, seen, hit, 'Bing Images') : false;
      if (toHits || toResults) added++;
    }
    if (!added) {
      const loose = /"murl"\s*:\s*"([^"]+)"/g;
      const purl = /"purl":"([^"]+)"/g;
      const images = [];
      const pages = [];
      let x;
      while ((x = loose.exec(html)) && images.length < cap) images.push(unescapeJsonUrl(x[1]));
      while ((x = purl.exec(html)) && pages.length < cap) pages.push(unescapeJsonUrl(x[1]));
      for (let i = 0; i < images.length && added < cap; i++) {
        const hit = { image: images[i], pageUrl: pages[i] || '', title: q, query: q };
        const toHits = hits ? pushVisualHit(hits, hit, 'Bing Images') : false;
        const toResults = added < 4 ? attachImageHit(results, seen, hit, 'Bing Images') : false;
        if (toHits || toResults) added++;
      }
    }
    diagnostics['Bing Images'].added = added;
  } catch (e) {
    diagnostics['Bing Images'] = { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200) };
  }
}

async function bingVideos(q, results, seen, diagnostics) {
  if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) {
    diagnostics['Bing Videos'] = { error: 'skipped (fetch budget)' };
    return;
  }
  SEARCH_BUDGET.used++;
  try {
    const r = await fetchText('https://www.bing.com/videos/search?q=' + encodeURIComponent(q) + '&adlt=off', { headers: BROWSER_HEADERS });
    diagnostics['Bing Videos'] = { status: r.status, ok: r.ok };
    if (!r.ok) return;
    const html = decodeEntities(await r.text());
    const before = results.length;
    const idRe = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]{6,})/gi;
    let m, added = 0;
    const seenVid = new Set();
    const pushYt = (id, title) => {
      if (!id || seenVid.has(id)) return false;
      seenVid.add(id);
      const url = 'https://www.youtube.com/watch?v=' + id;
      return uniqueAdd(results, seen, {
        title: title || (q + ' video'),
        url,
        source: 'Bing Videos',
        snippet: 'Public video index result. Canonical video ID preserved.',
        image: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg',
        images: ['https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'],
        queryVariant: q,
        videoId: 'yt:' + id,
      });
    };
    while ((m = idRe.exec(html)) && added < 24) {
      if (pushYt(m[1])) added++;
    }
    const murlRe = /"murl"\s*:\s*"(https?:[^"]+)"/gi;
    while ((m = murlRe.exec(html)) && added < 28) {
      const href = unescapeJsonUrl(m[1]);
      const yt = youtubeId(href);
      if (yt) { if (pushYt(yt)) added++; continue; }
      if (isVideoUrl(href) && uniqueAdd(results, seen, {
        title: q + ' video',
        url: href,
        source: 'Bing Videos',
        snippet: 'Public video index result. Canonical video ID preserved.',
        queryVariant: q,
      })) added++;
    }
    const vimeoRe = /vimeo\.com\/(?:video\/)?(\d{6,})/gi;
    while ((m = vimeoRe.exec(html)) && added < 28) {
      const id = m[1];
      const url = 'https://vimeo.com/' + id;
      if (uniqueAdd(results, seen, { title: q + ' video', url, source: 'Bing Videos', snippet: 'Public Vimeo reference. Canonical video ID preserved.', queryVariant: q })) added++;
    }
    parseAnchors(html, 'Bing Videos', results, seen, Math.min(40, results.length + 12));
    // Keep only actual video resources from the video index — do not promote
    // incidental page links (tube indexes, articles) as if they were videos.
    for (let i = results.length - 1; i >= before; i--) {
      const row = results[i];
      if (row && row.source === 'Bing Videos' && !isVideoUrl(row.url) && !youtubeId(row.url) && !vimeoId(row.url)) {
        results.splice(i, 1);
      }
    }
    diagnostics['Bing Videos'].added = Math.max(0, results.length - before);
    diagnostics['Bing Videos'].videoIds = added;
  } catch (e) {
    diagnostics['Bing Videos'] = { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200) };
  }
}

async function yahooImages(q, results, seen, diagnostics, limit, visualHits) {
  const cap = Math.max(10, Math.min(Number(limit) || 20, 28));
  const hits = Array.isArray(visualHits) ? visualHits : null;
  if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) {
    diagnostics['Yahoo Images'] = { error: 'skipped (fetch budget)' };
    return;
  }
  SEARCH_BUDGET.used++;
  try {
    const r = await fetchText('https://images.search.yahoo.com/search/images?p=' + encodeURIComponent(q), { headers: BROWSER_HEADERS });
    diagnostics['Yahoo Images'] = { status: r.status, ok: r.ok };
    if (!r.ok) return;
    const html = decodeEntities(await r.text());
    let added = 0;
    const re = /"iurl":"([^"]+)"[\s\S]{0,240}?"rurl":"([^"]*)"/g;
    let m;
    while ((m = re.exec(html)) && added < cap) {
      const hit = { image: unescapeJsonUrl(m[1]), pageUrl: unescapeJsonUrl(m[2]), title: q, query: q };
      const toHits = hits ? pushVisualHit(hits, hit, 'Yahoo Images') : false;
      const toResults = added < 4 ? attachImageHit(results, seen, hit, 'Yahoo Images') : false;
      if (toHits || toResults) added++;
    }
    if (!added) {
      const loose = /(?:imgurl|iurl|data-src)=["']?(https?:\/\/[^"'&\s]+)/gi;
      let x;
      while ((x = loose.exec(html)) && added < cap) {
        const hit = { image: unescapeJsonUrl(x[1]), pageUrl: '', title: q, query: q };
        if (hits && pushVisualHit(hits, hit, 'Yahoo Images')) added++;
      }
    }
    diagnostics['Yahoo Images'].added = added;
  } catch (e) {
    diagnostics['Yahoo Images'] = { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200) };
  }
}

function extractImagesFromHtml(html, pageUrl) {
  const raw = [];
  const push = (u) => {
    if (!u || typeof u !== 'string') return;
    const t = u.trim();
    if (!t || t.startsWith('data:image/svg') || t.startsWith('data:image/gif')) return;
    raw.push(t);
  };
  const pushSrcset = (ss) => {
    if (!ss) return;
    const parts = String(ss).split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
    if (parts.length) push(parts[parts.length - 1]);
  };
  const doc = String(html || '');
  const og = doc.match(/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)/i)
    || doc.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i);
  if (og) push(og[1]);
  const tw = doc.match(/<meta[^>]+(?:name|property)=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)/i)
    || doc.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']twitter:image/i);
  if (tw) push(tw[1]);
  const link = doc.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)/i);
  if (link) push(link[1]);
  const imgRe = /<img\b([^>]*)>/gi;
  let m;
  while ((m = imgRe.exec(doc)) && raw.length < 80) {
    const tag = m[1];
    const src = (tag.match(/\ssrc=["']([^"']+)/i) || [])[1];
    const data = (tag.match(/\s(?:data-src|data-lazy-src|data-original|data-url|data-lazy|data-image|data-bg|data-full|data-large_image|data-hi-res-src)=["']([^"']+)/i) || [])[1];
    pushSrcset((tag.match(/\ssrcset=["']([^"']+)/i) || [])[1]);
    pushSrcset((tag.match(/\sdata-srcset=["']([^"']+)/i) || [])[1]);
    push(data);
    push(src);
  }
  const picRe = /<source\b([^>]*)>/gi;
  while ((m = picRe.exec(doc)) && raw.length < 100) {
    const tag = m[1];
    pushSrcset((tag.match(/\ssrcset=["']([^"']+)/i) || [])[1]);
    push((tag.match(/\ssrc=["']([^"']+)/i) || [])[1]);
  }
  const nsRe = /<noscript[^>]*>([\s\S]*?)<\/noscript>/gi;
  while ((m = nsRe.exec(doc)) && raw.length < 100) {
    const inner = m[1] || '';
    let im;
    const innerImg = /<img\b([^>]*)>/gi;
    while ((im = innerImg.exec(inner)) && raw.length < 100) {
      push((im[1].match(/\ssrc=["']([^"']+)/i) || [])[1]);
    }
  }
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = ldRe.exec(doc)) && raw.length < 120) {
    try {
      const j = JSON.parse(m[1]);
      const walk = (o) => {
        if (!o || raw.length > 120) return;
        if (typeof o === 'string') {
          if (/^https?:/i.test(o) && /(\.(jpe?g|png|webp|gif)(\?|$)|\/(image|photo|media|uploads?|content)\b)/i.test(o)) push(o);
        } else if (Array.isArray(o)) o.slice(0, 12).forEach(walk);
        else if (typeof o === 'object') {
          if (o.image) walk(o.image);
          if (o.thumbnailUrl) walk(o.thumbnailUrl);
          if (o.contentUrl) walk(o.contentUrl);
          if (o.thumbnail) walk(o.thumbnail);
          if (o.url && typeof o.url === 'string' && /\.(jpe?g|png|webp|gif)/i.test(o.url)) walk(o.url);
          if (o['@type'] && /ImageObject/i.test(String(o['@type'])) && o.url) walk(o.url);
        }
      };
      walk(j);
    } catch {}
  }
  const jsonRe = /<script[^>]+type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = jsonRe.exec(doc)) && raw.length < 140) {
    const blob = m[1] || '';
    const urlRe = /https?:\/\/[^"'\\\s>]+\.(?:jpe?g|png|webp)(?:\?[^"'\\\s>]*)?/gi;
    let u;
    while ((u = urlRe.exec(blob)) && raw.length < 140) push(u[0]);
  }
  return rankImages(raw, pageUrl);
}

function describeImageExtraction(html, pageUrl, retrieved) {
  const accessible = !!(retrieved && (retrieved.status === 'RETRIEVED' || retrieved.accessState === 'DIRECTLY_RETRIEVED' || retrieved.accessState === 'PARTIALLY_RETRIEVED' || retrieved.accessState === 'PUBLIC_ALTERNATIVE'));
  const urls = extractImagesFromHtml(html || (retrieved && retrieved.html) || '', pageUrl);
  const extracted = (retrieved && Array.isArray(retrieved.images) && retrieved.images.length) ? retrieved.images : urls;
  const n = (extracted || []).filter(Boolean).length;
  let reason = '';
  if (!retrieved) reason = 'Source was discovered but the page was not retrieved.';
  else if (retrieved.status === 'RETRIEVAL_FAILED' || !accessible) {
    reason = retrieved.accessNote || retrieved.error || 'Page was not accessible.';
  } else if (!n) reason = 'Source found, but images could not be extracted from this page.';
  return {
    sourceDiscovered: true,
    pageAccessible: !!accessible,
    imagesFound: n,
    imageUrlsExtracted: (extracted || []).slice(0, 18),
    extractionSucceeded: n > 0,
    extractionFailed: !!accessible && n === 0,
    reason,
    visualEvidence: n > 0 ? 'EXTRACTED' : (accessible ? 'UNKNOWN' : 'UNAVAILABLE'),
  };
}

function galleryLinks(html, pageUrl) {
  const out = [];
  let pageHost = '';
  try { pageHost = new URL(pageUrl).hostname; } catch { return out; }
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html || '')) && out.length < 4) {
    try {
      const u = new URL(decodeEntities(m[1]), pageUrl);
      if (u.hostname !== pageHost) continue;
      if (/\/(gallery|galleries|photos?|images|pictures|press|media|portfolio)(\/|$)/i.test(u.pathname)) {
        const href = u.href.split('#')[0];
        if (!out.includes(href) && href !== pageUrl) out.push(href);
      }
    } catch {}
  }
  return out.slice(0, 2);
}

function summarizeAccess(retrieved, results) {
  const counts = {};
  const inaccessible = [];
  for (const page of retrieved || []) {
    const state = page.accessState || (page.status === 'RETRIEVED' ? 'DIRECTLY_RETRIEVED' : 'UNAVAILABLE');
    counts[state] = (counts[state] || 0) + 1;
    if (page.status !== 'RETRIEVED' || state === 'PAYWALLED' || state === 'AUTHENTICATION_REQUIRED' || state === 'AGE_RESTRICTED' || state === 'BLOCKED') {
      inaccessible.push({
        url: page.finalUrl || page.url,
        title: page.title || page.url,
        accessState: state,
        label: accessLabel(state),
        note: page.accessNote || page.error || '',
        publicEvidence: page.publicEvidence || '',
      });
    }
  }
  const paywalled = inaccessible.filter(x => x.accessState === 'PAYWALLED');
  const auth = inaccessible.filter(x => x.accessState === 'AUTHENTICATION_REQUIRED');
  const age = inaccessible.filter(x => x.accessState === 'AGE_RESTRICTED');
  const retrievedN = (retrieved || []).filter(p => p.status === 'RETRIEVED').length;
  const publicAlt = (retrieved || []).filter(p => p.accessState === 'PUBLIC_ALTERNATIVE' || p.accessState === 'DIRECTLY_RETRIEVED').length;
  let headline = '';
  if (paywalled.length || auth.length || age.length) {
    const kinds = [
      paywalled.length ? 'login/subscription/paywall' : '',
      auth.length ? 'login' : '',
      age.length ? 'age verification' : '',
    ].filter(Boolean);
    const restriction = paywalled.length ? 'paywall or subscription' : (auth.length ? 'login' : 'age verification');
    if (retrievedN === 0 && (results || []).length) {
      headline = 'ACCESS RESTRICTED — Carmen found the source, but the requested content requires ' + restriction + '. Carmen does not bypass it.';
    } else if (publicAlt) {
      headline = 'ACCESS RESTRICTED — some sources require ' + restriction + '. PUBLIC ALTERNATIVES FOUND on the public web.';
    } else if (inaccessible.length && retrievedN === 0) {
      headline = 'ACCESS RESTRICTED — the obvious source requires ' + restriction + '. Carmen kept looking across public alternatives.';
    }
  }
  if (!headline && paywalled.length && retrievedN === 0 && (results || []).length) {
    headline = 'Absolutely cannot retrieve due to paywall.';
  } else if (!headline && auth.length && retrievedN === 0) {
    headline = 'Authentication required — could not retrieve. Carmen does not log in.';
  } else if (!headline && inaccessible.length && retrievedN === 0) {
    headline = 'The obvious source was inaccessible. Carmen kept looking across public alternatives.';
  } else if (!headline && inaccessible.length) {
    headline = 'Some sources are inaccessible. Public alternatives and references are labeled below.';
  }
  return {
    counts,
    inaccessible,
    paywalled: paywalled.length,
    authenticationRequired: auth.length,
    ageRestricted: age.length,
    retrieved: retrievedN,
    headline,
  };
}

async function reddit(q, results, seen, diagnostics) {
  if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) {
    diagnostics.Reddit = { error: 'skipped (fetch budget)' };
    return;
  }
  SEARCH_BUDGET.used++;
  const endpoints = [
    'https://old.reddit.com/search.json?q=' + encodeURIComponent(q) + '&limit=25&sort=relevance&t=all&include_over_18=on',
    'https://www.reddit.com/search.json?q=' + encodeURIComponent(q) + '&limit=25&sort=relevance&t=all&include_over_18=on',
    'https://api.reddit.com/search?q=' + encodeURIComponent(q) + '&limit=25&sort=relevance&t=all&include_over_18=on',
  ];
  let lastErr = null;
  for (const endpoint of endpoints) {
    try {
      const r = await fetchText(endpoint, {
        headers: { ...BROWSER_HEADERS, accept: 'application/json' },
      });
      diagnostics.Reddit = { status: r.status, ok: r.ok };
      if (!r.ok) { lastErr = 'HTTP ' + r.status; continue; }
      const j = await r.json();
      for (const child of j?.data?.children || []) {
        const d = child?.data;
        if (!d?.permalink) continue;
        uniqueAdd(results, seen, {
          title: d.title || 'Reddit result',
          url: 'https://www.reddit.com' + d.permalink,
          source: d.subreddit_name_prefixed || (d.subreddit ? 'Reddit · r/' + d.subreddit : 'Reddit'),
          snippet: d.selftext || '',
          image: typeof d.thumbnail === 'string' && d.thumbnail.startsWith('http') ? d.thumbnail : (d.preview?.images?.[0]?.source?.url ? decodeEntities(d.preview.images[0].source.url) : ''),
          queryVariant: q,
          retrievalLane: 'direct-reddit',
        });
        if (results.length >= MAX_RESULTS) break;
      }
      return;
    } catch (e) {
      lastErr = e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200);
    }
  }
  if (!diagnostics.Reddit) diagnostics.Reddit = { error: lastErr || 'unavailable' };
}

function noteReserved(kind) {
  SEARCH_BUDGET.reserved = SEARCH_BUDGET.reserved || emptyReservedBudget();
  SEARCH_BUDGET.reserved[kind] = (SEARCH_BUDGET.reserved[kind] || 0) + 1;
}

function redditBlocked(diagnostics) {
  const d = (diagnostics && diagnostics.Reddit) || {};
  if (d.ok === true) return false;
  const st = Number(d.status || 0);
  if (st === 403 || st === 401 || st === 429 || st === 451) return true;
  if (d.error) return true;
  if (d.ok === false) return true;
  return !d.status;
}

function redditResultCount(results) {
  return (results || []).filter(r => {
    const url = r && r.url || '';
    if (isRedditSearchPage(url, r && r.title)) return false;
    if (isActualRedditEvidence(url)) return true;
    return /web\.archive\.org/i.test(url) && /reddit\.com/i.test(url) && /\/comments\//i.test(url);
  }).length;
}

function labelIndexedReddit(results, from, lane, sourceLabel) {
  let added = 0;
  for (const r of results || []) {
    if (!r || r.retrievalLane) continue;
    const host = hostOf(r.url);
    const waybackReddit = /web\.archive\.org/i.test(r.url || '') && /reddit\.com/i.test(r.url || '');
    if (isRedditHost(host) || waybackReddit) {
      r.source = sourceLabel || r.source;
      r.retrievalLane = lane;
      r.accessState = r.accessState || 'PUBLIC_ALTERNATIVE';
      if (from && r.source === from) r.source = sourceLabel;
      added++;
    }
  }
  return added;
}

const ADULT_IDENTITY_SITES = [
  'iafd.com',
  'adultfilmdatabase.com',
  'babepedia.com',
  'indexxx.com',
  'freeones.com',
  'thenude.com',
  'data18.com',
  'boobpedia.com',
  'adultdvdtalk.com',
  'onlyfans.com',
  'fansly.com',
  'loyalfans.com',
  'manyvids.com',
  'fancentro.com',
  'clips4sale.com',
  'iwantclips.com',
];

function isAdultIdentityHost(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  return ADULT_IDENTITY_SITES.some(s => h === s || h.endsWith('.' + s));
}

function adultIdentityQueries(classification) {
  const subject = String((classification && classification.subject) || '').replace(/"/g, '').trim();
  const adult = (classification && classification.adultContent) || 'off';
  const type = (classification && classification.type) || '';
  if (!subject) return [];
  if (!(adult === 'on' || adult === 'both')) return [];
  if (!(type === 'person' || type === 'social')) return [];
  const quoted = '"' + subject + '"';
  return ADULT_IDENTITY_SITES.map(site => ({
    q: quoted + ' site:' + site,
    why: 'adult-identity source lane',
    lane: 'adult-identity',
    kind: 'web',
    site,
  }));
}

function adultIdentityCombinedQuery(classification) {
  const subject = String((classification && classification.subject) || '').replace(/"/g, '').trim();
  if (!subject) return '';
  const sites = ADULT_IDENTITY_SITES.slice(0, 6).map(s => 'site:' + s).join(' OR ');
  return '"' + subject + '" (' + sites + ')';
}

async function redditIndexedWeb(q, results, seen, diagnostics, provider) {
  const raw = String(q || '').trim();
  if (!raw) return 0;
  const query = /site:\s*reddit\.com/i.test(raw) ? raw : (raw + ' site:reddit.com');
  const before = results.length;
  const tmp = {};
  if (provider === 'ddg') await ddg(query, results, seen, tmp);
  else await bing(query, results, seen, tmp);
  const slice = results.slice(before);
  let added = 0;
  for (const r of slice) {
    if (!isRedditHost(hostOf(r.url))) continue;
    r.source = provider === 'ddg' ? 'Reddit (indexed · DuckDuckGo)' : 'Reddit (indexed · Bing)';
    r.retrievalLane = 'indexed-reddit';
    r.accessState = r.accessState || 'PUBLIC_ALTERNATIVE';
    added++;
  }
  const key = provider === 'ddg' ? 'RedditIndexedDDG' : 'RedditIndexedBing';
  diagnostics[key] = {
    ...(tmp.DuckDuckGo || tmp['DuckDuckGo Lite'] || tmp.Bing || {}),
    added,
    query,
  };
  noteReserved('reddit');
  return added;
}

async function redditPullpush(q, results, seen, diagnostics) {
  if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) {
    diagnostics.Pullpush = { error: 'skipped (fetch budget)' };
    return 0;
  }
  SEARCH_BUDGET.used++;
  noteReserved('reddit');
  try {
    const url = 'https://api.pullpush.io/reddit/search/submission/?q=' + encodeURIComponent(q) + '&size=25&sort=desc';
    const r = await fetchText(url, { headers: { ...BROWSER_HEADERS, accept: 'application/json' } });
    diagnostics.Pullpush = { status: r.status, ok: r.ok };
    if (!r.ok) return 0;
    const j = await r.json().catch(() => ({}));
    const rows = Array.isArray(j?.data) ? j.data : (Array.isArray(j) ? j : []);
    let added = 0;
    for (const d of rows) {
      const permalink = d.permalink || d.full_link || (d.id ? '/comments/' + d.id + '/' : '');
      if (!permalink) continue;
      const href = /^https?:/i.test(permalink) ? permalink : ('https://www.reddit.com' + (String(permalink).startsWith('/') ? permalink : '/' + permalink));
      if (uniqueAdd(results, seen, {
        title: d.title || 'Reddit archive result',
        url: href,
        source: 'Reddit (Pullpush)',
        snippet: d.selftext || d.body || '',
        queryVariant: q,
        retrievalLane: 'pullpush',
        accessState: 'PUBLIC_ALTERNATIVE',
      })) added++;
    }
    diagnostics.Pullpush.added = added;
    return added;
  } catch (e) {
    diagnostics.Pullpush = { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200) };
    return 0;
  }
}

async function redditWayback(q, results, seen, diagnostics) {
  if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) {
    diagnostics.WaybackReddit = { error: 'skipped (fetch budget)' };
    return 0;
  }
  noteReserved('reddit');
  const subject = String(q || '').replace(/"/g, '').trim();
  let added = 0;
  const collapsed = subject.replace(/\s+/g, '');
  const candidate = collapsed ? ('https://www.reddit.com/r/' + collapsed + '/') : ('https://www.reddit.com/search/?q=' + encodeURIComponent(subject));
  try {
    SEARCH_BUDGET.used++;
    const availUrl = 'https://archive.org/wayback/available?url=' + encodeURIComponent(candidate);
    const r = await fetchText(availUrl, { headers: { ...BROWSER_HEADERS, accept: 'application/json' } });
    diagnostics.WaybackReddit = { status: r.status, ok: r.ok, query: candidate };
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      const snap = j && j.archived_snapshots && j.archived_snapshots.closest;
      if (snap && snap.url) {
        const href = String(snap.url).replace(/^http:\/\//i, 'https://');
        if (uniqueAdd(results, seen, {
          title: subject + ' on Reddit (Wayback)',
          url: href,
          source: 'Reddit (Wayback)',
          snippet: 'Archived Reddit page via Wayback Machine',
          retrievalLane: 'wayback',
          accessState: 'PUBLIC_ALTERNATIVE',
          sourceLabel: 'Reddit (Wayback)',
        })) added++;
      }
    }
  } catch (e) {
    diagnostics.WaybackReddit = { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200) };
  }
  if (added < 1 && SEARCH_BUDGET.used < SEARCH_BUDGET.max) {
    const query = '"' + subject + '" site:web.archive.org reddit.com';
    const before = results.length;
    const tmp = {};
    await bing(query, results, seen, tmp);
    for (const row of results.slice(before)) {
      if (!/web\.archive\.org/i.test(row.url || '') || !/reddit\.com/i.test(row.url || '')) continue;
      row.source = 'Reddit (Wayback)';
      row.retrievalLane = 'wayback';
      row.accessState = row.accessState || 'PUBLIC_ALTERNATIVE';
      added++;
    }
    diagnostics.WaybackReddit = { ...(diagnostics.WaybackReddit || {}), ...(tmp.Bing || {}), added, query };
  } else {
    diagnostics.WaybackReddit = { ...(diagnostics.WaybackReddit || {}), added };
  }
  return added;
}

async function reservedRedditLane(q, results, seen, diagnostics) {
  const blocked = redditBlocked(diagnostics);
  const have = redditResultCount(results);
  if (!blocked && have > 0) {
    diagnostics.ReservedReddit = { ran: false, reason: 'direct Reddit already produced results', added: have };
    return have;
  }
  const reason = blocked ? 'direct Reddit blocked/failed' : 'direct Reddit empty';
  const fallbacks = [];
  diagnostics.ReservedReddit = { ran: true, reason, fallbacks, added: 0 };
  let added = await redditIndexedWeb(q, results, seen, diagnostics, 'ddg');
  fallbacks.push('ddg-indexed');
  if (redditResultCount(results) < 2) {
    added += await redditIndexedWeb(q, results, seen, diagnostics, 'bing');
    fallbacks.push('bing-indexed');
  }
  if (redditResultCount(results) < 2) {
    added += await redditPullpush(q, results, seen, diagnostics);
    fallbacks.push('pullpush');
  }
  if (redditResultCount(results) < 2) {
    added += await redditWayback(q, results, seen, diagnostics);
    fallbacks.push('wayback');
  }
  if (redditResultCount(results) < 1) {
    diagnostics.ReservedReddit.redditEvidence = 'unavailable';
    diagnostics.ReservedReddit.unavailableReason = 'No actual Reddit posts/comments/threads were retrieved. A Reddit search page is not Reddit evidence.';
    fallbacks.push('unavailable');
  }
  diagnostics.ReservedReddit.fallbacks = fallbacks;
  diagnostics.ReservedReddit.added = redditResultCount(results);
  return added;
}

async function reservedAdultIdentityLane(classification, results, seen, diagnostics) {
  const qs = adultIdentityQueries(classification);
  if (!qs.length) {
    diagnostics.AdultIdentityLane = { ran: false, reason: 'not adult-person identity research' };
    return 0;
  }
  const combined = adultIdentityCombinedQuery(classification);
  diagnostics.AdultIdentityLane = { ran: true, query: combined, added: 0, sites: [] };
  const before = results.length;
  const direct = await fetchAdultIdentitySources(classification, results, seen, diagnostics);
  const sites = [...direct.sites];
  const tmp = {};
  const park = [];
  const parkSeen = new Set(seen);
  if (SEARCH_BUDGET.used < SEARCH_BUDGET.max) await bing(combined, park, parkSeen, tmp);
  if (SEARCH_BUDGET.used < SEARCH_BUDGET.max) await ddg(combined, park, parkSeen, tmp);
  noteReserved('adultIdentity');
  for (const r of park) {
    const host = hostOf(r.url).replace(/^www\./, '');
    if (!isAdultIdentityHost(host)) continue;
    r.retrievalLane = r.retrievalLane || 'adult-identity';
    r.sourceLane = 'adult-identity';
    r.discoveryLane = r.discoveryLane || 'adult-identity';
    if (uniqueAdd(results, seen, r)) sites.push(host);
  }
  diagnostics.AdultIdentityLane.providers = {
    Bing: tmp.Bing || null,
    DuckDuckGo: tmp.DuckDuckGo || tmp['DuckDuckGo Lite'] || null,
  };
  const have = new Set(sites);
  const subject = String((classification && classification.subject) || '').replace(/"/g, '').trim();
  for (const site of ADULT_IDENTITY_SITES.slice(0, 3)) {
    if (have.has(site)) continue;
    if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) break;
    const q = '"' + subject + '" site:' + site;
    const tmp2 = {};
    const mark = results.length;
    await bing(q, results, seen, tmp2);
    for (const r of results.slice(mark)) {
      const host = hostOf(r.url).replace(/^www\./, '');
      if (isAdultIdentityHost(host)) {
        r.retrievalLane = r.retrievalLane || 'adult-identity';
        r.sourceLane = 'adult-identity';
        r.discoveryLane = r.discoveryLane || 'adult-identity';
        sites.push(host);
      }
    }
    diagnostics.AdultIdentityLane.individualFallback = true;
  }
  diagnostics.AdultIdentityLane.added = results.length - before;
  diagnostics.AdultIdentityLane.sites = [...new Set(sites)];
  diagnostics.AdultIdentityLane.directSources = direct.sites;
  return diagnostics.AdultIdentityLane.added;
}

function identitySlugUnderscore(subject) {
  return String(subject || '').trim().replace(/\s+/g, '_');
}

async function fetchAdultIdentitySources(classification, results, seen, diagnostics) {
  const subject = String((classification && classification.subject) || '').replace(/"/g, '').trim();
  if (!subject) return { added: 0, sites: [] };
  const before = results.length;
  const sites = [];
  const tag = {
    retrievalLane: 'adult-identity',
    sourceLane: 'adult-identity',
    discoveryLane: 'adult-identity',
  };
  if (SEARCH_BUDGET.used < SEARCH_BUDGET.max) {
    SEARCH_BUDGET.used++;
    noteReserved('adultIdentity');
    const url = 'https://www.iafd.com/results.asp?searchtype=comprehensive&searchstring=' + encodeURIComponent(subject);
    try {
      const r = await fetchText(url, { headers: BROWSER_HEADERS });
      diagnostics.AdultIdentityIAFD = { status: r.status, ok: r.ok };
      if (r.ok) {
        const html = await r.text();
        const re = /href="([^"]*person\.rme[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        let n = 0;
        while ((m = re.exec(html)) && n < 3) {
          let href = decodeEntities(m[1]);
          if (href.startsWith('/')) href = 'https://www.iafd.com' + href;
          const title = cleanTitle(m[2]) || (subject + ' - IAFD');
          if (uniqueAdd(results, seen, { title, url: href, source: 'IAFD', snippet: 'Adult identity database', ...tag })) {
            sites.push('iafd.com');
            n++;
          }
        }
        if (n === 0) {
          if (uniqueAdd(results, seen, { title: subject + ' - IAFD search', url, source: 'IAFD', snippet: 'IAFD public search results', ...tag })) {
            sites.push('iafd.com');
          }
        }
        diagnostics.AdultIdentityIAFD.added = n || (sites.includes('iafd.com') ? 1 : 0);
      }
    } catch (e) {
      diagnostics.AdultIdentityIAFD = { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 120) };
    }
  }
  if (SEARCH_BUDGET.used < SEARCH_BUDGET.max) {
    SEARCH_BUDGET.used++;
    noteReserved('adultIdentity');
    const slug = identitySlugUnderscore(subject);
    const url = 'https://www.babepedia.com/babe/' + encodeURIComponent(slug);
    try {
      const r = await fetchText(url, { headers: BROWSER_HEADERS });
      diagnostics.AdultIdentityBabepedia = { status: r.status, ok: r.ok };
      if (r.ok) {
        if (uniqueAdd(results, seen, { title: subject + ' - Babepedia', url, source: 'Babepedia', snippet: 'Adult identity encyclopedia', ...tag })) {
          sites.push('babepedia.com');
          diagnostics.AdultIdentityBabepedia.added = 1;
        }
      }
    } catch (e) {
      diagnostics.AdultIdentityBabepedia = { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 120) };
    }
  }
  return { added: results.length - before, sites: [...new Set(sites)] };
}

function buildResearchMetrics(results, diagnostics, extra = {}) {
  const rows = Array.isArray(results) ? results : [];
  const sourceCounts = {};
  const laneCounts = {};
  for (const r of rows) {
    const src = String(r.source || 'unknown');
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
    const lane = r.retrievalLane || r.sourceLane || r.discoveryLane || '';
    if (lane) laneCounts[lane] = (laneCounts[lane] || 0) + 1;
  }
  const providerCoverage = {};
  for (const [k, v] of Object.entries(diagnostics || {})) {
    if (!v || typeof v !== 'object') continue;
    providerCoverage[k] = {
      ok: v.ok === true,
      status: v.status || undefined,
      added: typeof v.added === 'number' ? v.added : undefined,
      error: v.error ? String(v.error).slice(0, 120) : undefined,
      ran: v.ran,
    };
  }
  const redditRows = rows.filter(r => isRedditHost(hostOf(r.url)) || r.retrievalLane === 'wayback' || r.retrievalLane === 'pullpush' || r.retrievalLane === 'indexed-reddit' || r.retrievalLane === 'direct-reddit');
  const identityRows = rows.filter(r => r.retrievalLane === 'adult-identity' || r.sourceLane === 'adult-identity' || isAdultIdentityHost(hostOf(r.url)));
  const redditDiag = diagnostics && diagnostics.ReservedReddit;
  const identityDiag = diagnostics && diagnostics.AdultIdentityLane;
  return {
    version: '48.1',
    resultCount: rows.length,
    providerCoverage,
    sourceCounts,
    laneCounts,
    reservedLanes: {
      reddit: !!(redditDiag && redditDiag.ran),
      redditReason: (redditDiag && redditDiag.reason) || '',
      redditFallbacks: (redditDiag && redditDiag.fallbacks) || [],
      redditResults: redditRows.length,
      adultIdentity: !!(identityDiag && identityDiag.ran),
      adultIdentitySites: (identityDiag && identityDiag.sites) || [],
      adultIdentityResults: identityRows.length,
    },
    fallbackUsage: {
      redditIndexed: !!(diagnostics && (diagnostics.RedditIndexedDDG || diagnostics.RedditIndexedBing)),
      pullpush: !!(diagnostics && diagnostics.Pullpush && (diagnostics.Pullpush.ok || diagnostics.Pullpush.added)),
      wayback: !!(diagnostics && diagnostics.WaybackReddit && (diagnostics.WaybackReddit.added || diagnostics.WaybackReddit.ok)),
      startpage: !!(diagnostics && diagnostics.Startpage && diagnostics.Startpage.ok),
      publicSearch: !!(redditDiag && Array.isArray(redditDiag.fallbacks) && redditDiag.fallbacks.includes('public-search')),
      identityDirect: !!(diagnostics && (diagnostics.AdultIdentityIAFD || diagnostics.AdultIdentityBabepedia)),
    },
    retrievalCounts: budgetReport(),
    reservedBudget: { ...(SEARCH_BUDGET.reserved || emptyReservedBudget()) },
    redditProvenance: [...new Set(redditRows.map(r => r.source).filter(Boolean))],
    ...extra,
  };
}

async function wikipedia(q, results, seen, diagnostics, classification) {
  if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) return;
  SEARCH_BUDGET.used++;
  try {
    const r = await fetchText('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(q) + '&utf8=1&format=json&srlimit=5', {
      headers: { accept: 'application/json', 'user-agent': 'CarmenResearch/38 (investigation workspace)' },
    });
    diagnostics.Wikipedia = { status: r.status, ok: r.ok };
    if (!r.ok) return;
    const j = await r.json();
    const hits = j?.query?.search || [];
    const tokens = String(q || '').toLowerCase().split(/\s+/).filter(t => t.length > 2);
    for (const hit of hits) {
      const title = hit.title || '';
      if (tokens.length && tokens.every(t => !title.toLowerCase().includes(t))) continue;
      if (classification && classification.type === 'person' && tokens.length >= 2) {
        const hitCount = tokens.filter(t => title.toLowerCase().includes(t)).length;
        if (hitCount === 0) continue;
      }
      const url = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
      uniqueAdd(results, seen, {
        title,
        url,
        source: 'Wikipedia',
        snippet: cleanText(hit.snippet || ''),
        queryVariant: q,
      });
    }
    const top = hits[0]?.title;
    if (top && SEARCH_BUDGET.used < SEARCH_BUDGET.max && !(tokens.length && tokens.every(t => !String(top).toLowerCase().includes(t)))) {
      SEARCH_BUDGET.used++;
      try {
        const r2 = await fetchText('https://en.wikipedia.org/w/api.php?action=query&titles=' + encodeURIComponent(top) + '&prop=pageimages|extracts&pithumbsize=640&exintro=1&explaintext=1&format=json', {
          headers: { accept: 'application/json', 'user-agent': 'CarmenResearch/38 (investigation workspace)' },
        });
        const j2 = await r2.json();
        const page = Object.values(j2?.query?.pages || {})[0];
        if (page) {
          const url = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(String(page.title || top).replace(/ /g, '_'));
          const existing = results.find(x => x.url === url);
          const thumb = page.thumbnail?.source;
          if (existing && thumb) {
            existing.image = existing.image || thumb;
            existing.images = [...new Set([...(existing.images || []), thumb])];
            if (page.extract && !existing.snippet) existing.snippet = String(page.extract).slice(0, 600);
          }
        }
      } catch {}
    }
  } catch (e) {
    diagnostics.Wikipedia = { error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200) };
  }
}

const SEO_JUNK_RE = /(nameberry|howmanyofme|houseofnames|behindthename|urbandictionary|quizlet\.com|coursehero|chegg\.com|slideplayer|scribd\.com|pinterest\.com|fandom\.com\/wiki\/Special|instagram\.com\/popular\/)/i;
const TUBE_INDEX_RE = /(nudevista|xvideos|pornhub|xnxx|spankbang|xhamster|redtube|youporn|alohatube|tubepornstars|heavyfetish|bdsmx\.tube|thothub|fapello|erome|tnaflix|hdzog|xgroovy|eporner|tubebdsm|porntrex|ixxx|fapality|hqporner|pornone|vipwank|xxx|porntube|fucktube)\./i;
const RETAILER_RE = /(bestbuy|walmart|amazon|ebay|target|newegg|bhphotovideo|costco)\./i;
const NAV_TITLE_RE = /^(blog|community|newsletter|home|login|sign in|search|menu)$/i;
const SKIP_IMAGE_RE = /(favicon|sprite|1x1|pixel|tracking|badge\.svg|logo\.(png|svg|jpg|gif)|icon-?\d+|apple-touch-icon|join\.(jpg|png|gif)|play\.(png|gif|jpg)|spinner|placeholder|blank\.(gif|png)|custom_assets|\/icons?\/)/i;
const NON_NAME_TOKENS = /^(workers?|iphone|ipad|server|engine|cloud|docs?|api|sdk|framework|protocol|database|linux|windows|android|ios|iphones?)$/i;
const VEHICLE_CUE_RE = /\b(toyota|honda|ford|chevy|chevrolet|nissan|bmw|lincoln|aviator|runner|civic|f-?150|mustang|ram|dodge|jeep|gmc|tesla|hyundai|kia|mazda|subaru|volkswagen|\bvw\b|audi|mercedes|porsche|lexus|acura|cadillac|buick|chrysler|volvo|jaguar|wrangler|silverado|sierra|tacoma|tundra|camry|accord|corolla|truck|suv|pickup|sedan|van|coupe|minivan)\b/i;
const PROFILE_HOST_RE = /(^|\.)(linkedin|instagram|twitter|x|onlyfans)\.com$/i;
const TECHNIQUE_WORD_RE = /\b(technique|techniques|position|positions|tutorial|tutorials|how[- ]to|howto|knot|knots|tie|ties|pose|poses|grip|stance|method|procedure|form|hitch|splice|joinery|jig|frog[- ]tie|hog[- ]tie|shibari|kinbaku|suspension|rope[- ]bondage|bondage[- ](?:chair|position))\b/i;
const SKILL_WORD_RE = /\b(weld|welding|welder|woodwork|woodworking|carpentry|fabricat(?:e|ion)|repair|repairs|solder|soldering|machin(?:e|ing)|plumbing|electrical|diy|craft|crafts|build(?:ing)?|project)\b/i;
const INSTRUCTIONAL_HOST_RE = /(youtube\.com|youtu\.be|wikihow\.com|instructables\.com|wikipedia\.org|reddit\.com|khronos|familyhandyman|thisoldhouse|finewoodworking|lincolnelectric|millerwelds|hobart)/i;
const TECHNIQUE_HINTS = new Set(['technique', 'position', 'instruction']);
const SKILL_HINTS = new Set(['skill', 'project']);
const CLOTHING_HINTS = new Set(['clothing', 'garment', 'outfit', 'fashion']);
const CLOTHING_WORD_RE = /\b(dress|dresses|gown|jacket|coat|coats|jeans|trousers|pants|skirt|blouse|shirt|shirts|outfit|outfits|garment|wardrobe|corset|heels|boots|sneakers|sweater|hoodie|suit|kimono|sari|lingerie|cardigan|blazer|shorts|leggings|jumpsuit|romper|knitwear|harness|leather|latex|pvc|collar)\b/i;
const OBJECT_ANCHOR_RE = /\b(harness|collar|gag|cinch|cuffs?|restraints?|blindfold|spreader|bit[- ]gag|ball[- ]gag|frog[- ]tie|hog[- ]tie|shibari|kinbaku|bondage[- ]chair)\b/i;
const QUESTION_LEAD_RE = /^(how|what|why|when|where|who|which|is|are|does|do|can|could|should)\b/i;
const STOCK_IMAGE_RE = /(shutterstock|gettyimages|istockphoto|adobestock|unsplash\.com|pexels\.com|pixabay\.com|depositphotos)/i;
const ADULT_HOST_RE = /(^|\.)(onlyfans|fansly|loyalfans|manyvids|clips4sale|iwantclips|fancentro|justfor\.fans|fanvue|patreon|fetlife|pornhub|xvideos|xhamster|xnxx|youporn|spankbang|eporner|iafd|adultfilmdatabase|adultdvdtalk|babepedia|boobpedia|indexxx|data18|thenude|freeones|houseofgord|kink|devicebondage|hogtied|sexandsubmission|thetrainingofo|whippedass|waterbondage)\./i;
const ADULT_PATH_RE = /\/(pornstar|pornstars|photoset|photosets|xxx|performer|performers)(\/|$)/i;
const GENERIC_BIO_HOST_RE = /(wikipedia\.org|britannica\.com|biography\.com)/i;
const ADULT_LANG_RE = /\b(adult(?:[- ]content)?|nsfw|xxx|porn(?:star)?|onlyfans|bdsm|bondage|fetish|kink|performer|photoset)\b/i;
const ADULT_EVIDENCE_RE = /\b(performer|photoset|adult film|pornstar|xxx|onlyfans|bdsm|bondage|fetish|iafd)\b/i;
const MEMBER_HOST_RE = /(^|\.)(onlyfans|fansly|loyalfans|patreon|fancentro|manyvids|clips4sale)\.com$/i;
const AUTH_HOST_RE = /(^|\.)(onlyfans|fansly|loyalfans|patreon|linkedin|facebook|instagram|fancentro)\.com$/i;
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

function accessLabel(state) {
  const k = String(state || '').toUpperCase().replace(/[\s—–-]+/g, '_').replace(/_+/g, '_');
  if (ACCESS_LABELS[k]) return ACCESS_LABELS[k];
  if (/PAYWALL/i.test(state || '')) return ACCESS_LABELS.PAYWALLED;
  if (/AUTH|LOGIN/i.test(state || '')) return ACCESS_LABELS.AUTHENTICATION_REQUIRED;
  if (/AGE/i.test(state || '')) return ACCESS_LABELS.AGE_RESTRICTED;
  if (/PARTIAL/i.test(state || '')) return ACCESS_LABELS.PARTIALLY_RETRIEVED;
  if (/ALTERNATIVE/i.test(state || '')) return ACCESS_LABELS.PUBLIC_ALTERNATIVE;
  if (/DIRECT/i.test(state || '')) return ACCESS_LABELS.DIRECTLY_RETRIEVED;
  if (/REFERENCED/i.test(state || '')) return ACCESS_LABELS.REFERENCED;
  if (/UNVERIF/i.test(state || '')) return ACCESS_LABELS.UNVERIFIED;
  return ACCESS_LABELS.UNAVAILABLE;
}

function classifyAccess({ httpStatus, html, url, host, error } = {}) {
  const h = String(host || hostOf(url) || '').replace(/^www\./, '').toLowerCase();
  const sample = String(html || '').slice(0, 14000);
  const low = sample.toLowerCase();
  const textLen = cleanText(sample).length;
  if (PRIVATE_HOST_RE.test(h) || BLOCKED_HOSTS.has(h) || BLOCKED_HOSTS.has('www.' + h)) {
    return { accessState: 'BLOCKED', status: 'RETRIEVAL_FAILED', error: error || 'Private or blocked host', note: 'Carmen does not retrieve private or blocked hosts.' };
  }
  if (httpStatus === 401) {
    return { accessState: 'AUTHENTICATION_REQUIRED', status: 'RETRIEVAL_FAILED', error: 'HTTP 401', note: 'This source requires a login. Carmen will not sign in.' };
  }
  if (httpStatus === 402) {
    return { accessState: 'PAYWALLED', status: 'RETRIEVAL_FAILED', error: 'HTTP 402', note: 'Absolutely cannot retrieve due to paywall.' };
  }
  if (httpStatus === 403 || httpStatus === 451) {
    if (AUTH_HOST_RE.test(h) || MEMBER_HOST_RE.test(h)) {
      return { accessState: 'AUTHENTICATION_REQUIRED', status: 'RETRIEVAL_FAILED', error: 'HTTP ' + httpStatus, note: 'This source requires a login or subscription. Carmen will not sign in or bypass access controls. A blocked Worker fetch is not a retrieval of the exact profile.' };
    }
    return { accessState: 'BLOCKED', status: 'RETRIEVAL_FAILED', error: 'HTTP ' + httpStatus, note: 'The host blocked public retrieval.' };
  }
  if (httpStatus === 404 || httpStatus === 410) {
    return { accessState: 'BLOCKED', status: 'RETRIEVAL_FAILED', error: 'HTTP ' + httpStatus, note: 'This page is gone or was not found.' };
  }
  if (httpStatus && httpStatus >= 500) {
    return { accessState: 'UNAVAILABLE', status: 'RETRIEVAL_FAILED', error: 'HTTP ' + httpStatus, note: httpStatus === 503 ? 'The source is temporarily unavailable (HTTP 503). This is not evidence that nothing exists.' : 'The host did not return a usable page.' };
  }
  if (/cloudflare[- ](?:challenge|error)|attention required|just a moment\.\.\.|enable javascript and cookies to continue/i.test(low) && textLen < 500) {
    return { accessState: 'BLOCKED', status: 'RETRIEVAL_FAILED', error: error || 'challenge page', note: 'An anti-bot or challenge page blocked retrieval. Carmen does not bypass it.' };
  }
  const loginWall = /(sign in to continue|log in to continue|you must (?:log|sign) in|create an account to (?:continue|view)|authentication required|login to view|log in to view)/i.test(low);
  const paywallWall = /(subscribe to (?:continue|read|view|unlock)|become a (?:paid )?member|this article is for subscribers|\bpaywall\b|members[- ]only content|subscribers? only|paid members? only|join for full access|subscription required)/i.test(low);
  const ageWall = /(you must be (?:18|21)|age verification required|verify your age|age-?gate|confirm your age)/i.test(low);
  if ((loginWall || AUTH_HOST_RE.test(h)) && textLen < 1400) {
    return { accessState: 'AUTHENTICATION_REQUIRED', status: 'RETRIEVAL_FAILED', error: error || 'login wall', note: 'Authentication required — could not retrieve. Carmen does not log in or scrape behind accounts.' };
  }
  if ((paywallWall) && textLen < 1600) {
    return { accessState: 'PAYWALLED', status: 'RETRIEVAL_FAILED', error: error || 'paywall', note: 'Absolutely cannot retrieve due to paywall. Public titles, snippets, and thumbnails are not the protected content.' };
  }
  if (ageWall && textLen < 1600) {
    return { accessState: 'AGE_RESTRICTED', status: 'RETRIEVAL_FAILED', error: error || 'age gate', note: 'Age or access restriction — could not retrieve. Carmen does not bypass gates.' };
  }
  if (paywallWall && textLen >= 1600) {
    return { accessState: 'PARTIALLY_RETRIEVED', status: 'RETRIEVED', error: '', note: 'Public teaser retrieved. Full article appears paywalled and was not retrieved.' };
  }
  if (error && /timeout/i.test(error)) {
    return { accessState: 'UNAVAILABLE', status: 'RETRIEVAL_FAILED', error: 'timeout', note: 'The page timed out. Carmen did not invent its contents.' };
  }
  if (!httpStatus && error) {
    return { accessState: 'UNAVAILABLE', status: 'RETRIEVAL_FAILED', error: String(error).slice(0, 200), note: 'Retrieval failed. Carmen did not invent this source’s contents.' };
  }
  if (textLen < 80) {
    return { accessState: 'PARTIALLY_RETRIEVED', status: 'RETRIEVED', error: '', note: 'Only a thin public preview was available.' };
  }
  if (MEMBER_HOST_RE.test(h)) {
    return { accessState: 'PARTIALLY_RETRIEVED', status: 'RETRIEVED', error: '', note: 'Public landing page retrieved. Member or logged-in content was not accessed.' };
  }
  return { accessState: 'DIRECTLY_RETRIEVED', status: 'RETRIEVED', error: '', note: '' };
}

const CONTEXT_RELATIONS = [
  { id: 'adult', re: /\b(adult(?:[- ]content)?|nsfw|pornstar|performer)\b/i, synonyms: 'performer OR photoset OR "official site" OR models' },
  { id: 'bondage', re: /\b(bondage|bdsm|shibari|kinbaku|restraint|self[- ]bondage)\b/i, synonyms: 'bondage OR bdsm OR shibari OR rope' },
  { id: 'interview', re: /\b(interview|interviews|podcast|talk show|q\s*&\s*a|qanda)\b/i, synonyms: 'interview OR podcast OR talk OR q&a' },
  { id: 'visual', re: /\b(photos?|images?|pics?|gallery|portrait|headshot)\b/i, synonyms: 'photos OR images OR gallery OR portrait' },
  { id: 'video', re: /\b(videos?|youtube|clip|footage|watch)\b/i, synonyms: 'video OR youtube OR clip OR footage' },
  { id: 'clothing', re: /\b(wearing|outfit|outfits|dress|dresses|gown|jacket|coat|coats|clothing|clothes|costume|wardrobe|jeans|skirt|blouse|shirt|lingerie|heels|boots|garment|harness|leather|latex)\b/i, synonyms: 'wearing OR outfit OR dress OR harness OR photos' },
  { id: 'vehicle', re: /\b(car|truck|vehicle|motorcycle|bike)\b/i, synonyms: 'car OR vehicle OR photos' },
  { id: 'towing', re: /\b(tow|towing|payload)\b/i, synonyms: 'towing OR tow capacity OR payload' },
  { id: 'repair', re: /\b(repair|repairs|fix|service|maintenance)\b/i, synonyms: 'repair OR service OR maintenance' },
  { id: 'skill', re: /\b(weld(?:ing|er)?|woodwork(?:ing)?|fabricat(?:e|ion)|soldering)\b/i, synonyms: 'tutorial OR procedure OR how to OR guide' },
  { id: 'performance', re: /\b(concert|performance|show|tour|stage|set)\b/i, synonyms: 'performance OR concert OR live OR show' },
  { id: 'hobby', re: /\b(hobby|hobbies)\b/i, synonyms: 'hobby OR photos' },
  { id: 'location', re: /\b(in|at|near)\s+[A-Z][A-Za-z.-]+/i, synonyms: 'photos OR event OR location' },
  { id: 'technique', re: /\b(technique|position|pose|poses|frog[- ]tie|hog[- ]tie|shibari|kinbaku|suspension)\b/i, synonyms: 'photos OR video OR reference OR tutorial' },
  { id: 'object', re: /\b(harness|collar|gag|chair|cuffs?|restraints?|with|holding|using)\b/i, synonyms: 'photos OR images OR reference' },
];

const TRAILING_CONTEXT_RE = /\s+((?:adult(?:\s+content)?)|nsfw|bondage(?:\s+(?:images?|photos?|videos?|scenes?|interview|position))?|bdsm|shibari|kinbaku|restrained|restraint|tied(?:\s+up)?|rope(?:\s+bondage)?|suspension|frog[- ]tie|interview|interviews|photos?|images?|videos?|repair|towing|maintenance|welding)$/i;
const NAME_PARTICLE_RE = /^(?:d[aeu]|del|della|dei|degli|di|des|van|von|la|le|el|al|bin|ibn|ter|ten|dos|das|do|y|af|st|saint)$/i;

function isNameParticle(w) {
  return NAME_PARTICLE_RE.test(String(w || '').replace(/[.'’]/g, ''));
}

function hasVehicleCueIgnoringNameParticles(text) {
  return String(text || '').split(/\s+/).some(w => VEHICLE_CUE_RE.test(w) && !isNameParticle(w));
}

function isKnownInvestigativeContext(w) {
  const t = String(w || '').trim();
  if (!t || isNameParticle(t)) return false;
  if (detectRelation(t)) return true;
  if (TRAILING_CONTEXT_RE.test(' ' + t)) return true;
  if (TECHNIQUE_WORD_RE.test(t) || SKILL_WORD_RE.test(t) || CLOTHING_WORD_RE.test(t)) return true;
  if (STRUCTURAL_FAMILIES.some(f => f.re.test(t))) return true;
  return false;
}

function normalizeAdult(v) {
  const s = String(v || '').toLowerCase().trim();
  if (s === 'on' || s === 'true' || s === '1' || s === 'yes') return 'on';
  if (s === 'both') return 'both';
  return 'off';
}

function detectRelation(text) {
  const t = String(text || '');
  for (const rel of CONTEXT_RELATIONS) {
    if (rel.re.test(t)) return rel.id;
  }
  return '';
}

function plusSplitQuery(q) {
  const full = String(q || '').trim();
  if (!full || /^https?:\/\//i.test(full)) return { head: full, concepts: [], full };
  const parts = full.split(/\s*\+\s*|\s+;\s+|\s+\/\s+/).map(s => s.trim()).filter(s => s.length > 1);
  if (parts.length >= 2) return { head: parts[0], concepts: parts.slice(1).slice(0, 6), full };
  return { head: full, concepts: [], full };
}

function parseQueryContext(q, classification) {
  const raw = String(q || '').trim().replace(/\s+/g, ' ');
  const empty = { subject: raw, context: '', relation: '', full: raw };
  if (!raw || (classification && classification.isUrl)) return empty;
  const type = classification && classification.type;
  const plus = plusSplitQuery(raw);
  if (plus.concepts.length) {
    const context = plus.concepts.join(' ');
    const relation = detectRelation(context) || detectRelation(plus.concepts[0]) || 'context';
    return { subject: plus.head, context, relation, full: raw, conceptsList: plus.concepts };
  }
  const words = raw.split(/\s+/);
  let subject = raw, context = '';
  const trail = raw.match(TRAILING_CONTEXT_RE);
  if (trail && words.length >= 2) {
    const head = raw.slice(0, raw.length - trail[0].length).trim();
    const headWords = head.split(/\s+/).filter(Boolean);
    if (type === 'person' && headWords.length >= 2 && isNameParticle(headWords[headWords.length - 1]) && !isKnownInvestigativeContext(trail[1])) {
      subject = raw;
      context = '';
    } else {
      subject = head;
      context = trail[1].trim();
    }
  } else if (type === 'person' && words.length >= 3 && words.slice(0, 2).every(w => /^[A-Za-z][A-Za-z.'’-]*$/.test(w))) {
    const last = words[words.length - 1];
    const head = words.slice(0, -1);
    const particleInHead = head.some(isNameParticle) || words.slice(1, -1).some(isNameParticle);
    if (isKnownInvestigativeContext(last) && !isNameParticle(last)) {
      let contextStart = words.length - 1;
      while (contextStart > 2) {
        const prev = words[contextStart - 1];
        if (isNameParticle(prev)) break;
        if (isKnownInvestigativeContext(prev) || (/^[a-z][a-z-]*$/.test(prev) && prev.length <= 12)) {
          contextStart--;
          continue;
        }
        break;
      }
      subject = words.slice(0, contextStart).join(' ');
      context = words.slice(contextStart).join(' ');
    } else if (particleInHead) {
      subject = raw;
      context = '';
    } else if (/^[A-Z][a-z]/.test(last) && head.every(w => isNameParticle(w) || /^[A-Z]/.test(w))) {
      subject = raw;
      context = '';
    } else {
      subject = words.slice(0, 2).join(' ');
      context = words.slice(2).join(' ');
    }
  } else if (type === 'person' && words.length >= 4) {
    subject = words.slice(0, 2).join(' ');
    context = words.slice(2).join(' ');
  } else if (type === 'clothing') {
    subject = raw;
    context = '';
  } else if ((type === 'product' || type === 'vehicle' || type === 'organization') && words.length >= 2) {
    const last = words[words.length - 1];
    if ((detectRelation(last) || isConceptToken(last)) && words.length >= 2) {
      subject = words.slice(0, -1).join(' ');
      context = last;
    }
  } else if ((type === 'skill' || type === 'technique' || type === 'topic') && words.length >= 3) {
    const last = words[words.length - 1];
    if (detectRelation(last) || isConceptToken(last)) {
      subject = words.slice(0, -1).join(' ').replace(/\s+\b(a|an|the|to)\s*$/i, '').trim();
      context = last;
    }
  } else if (words.length >= 2) {
    const last = words[words.length - 1];
    if (detectRelation(last) || STRUCTURAL_FAMILIES.some(f => f.re.test(last))) {
      subject = words.slice(0, -1).join(' ');
      context = last;
    }
  }
  let relation = detectRelation(context) || detectRelation(raw);
  if (context && !relation) relation = 'context';
  return { subject, context, relation, full: raw };
}

function attachContext(q, classification) {
  const out = (classification && typeof classification === 'object') ? classification : { type: 'topic', confidence: 'low', reason: '', isUrl: false };
  const ctx = parseQueryContext(q, out);
  if (ctx.context) {
    out.subject = ctx.subject;
    out.context = ctx.context;
    out.relation = ctx.relation;
  } else if (ctx.subject) {
    out.subject = out.subject || ctx.subject;
  }
  if (Array.isArray(ctx.conceptsList) && ctx.conceptsList.length) {
    out.conceptsList = ctx.conceptsList.slice(0, 6);
  } else {
    const listed = splitContextConcepts(out);
    if (listed.length) out.conceptsList = listed;
  }
  return out;
}

function applyResearchFilter(classification, adultMode, q) {
  const out = (classification && typeof classification === 'object') ? classification : classifyQuery(q);
  const adult = normalizeAdult(adultMode);
  out.adultContent = adult;
  const raw = String(q || '').trim();
  if (!out.subject) out.subject = out.context ? String(raw).replace(TRAILING_CONTEXT_RE, '').trim() : raw;
  const adultLensEntity = out.type === 'person' || out.type === 'social';
  if ((adult === 'on' || adult === 'both') && !out.context && adultLensEntity) {
    if (adult === 'on') {
      out.context = 'adult content';
      out.relation = out.relation || 'adult';
    } else {
      out.contextLanes = ['general', 'adult'];
      out.relation = out.relation || 'adult';
    }
  }
  if (adult === 'on' && out.context && out.relation !== 'adult') {
    out.adultContext = true;
  }
  if (adult === 'off' && ADULT_LANG_RE.test(out.context || '')) {
    out.adultFromQuery = true;
  }
  return out;
}

function contextualSynonyms(context, relation) {
  const rel = CONTEXT_RELATIONS.find(r => r.id === relation);
  if (rel && rel.synonyms) {
    if (relation === 'clothing' || relation === 'technique' || relation === 'object' || relation === 'location' || relation === 'bondage' || relation === 'repair' || relation === 'towing' || relation === 'skill') {
      return String(context || '') + ' OR ' + rel.synonyms;
    }
    return rel.synonyms;
  }
  return context ? (context + ' photos OR images OR video') : '';
}

function adultSemanticVariants(subject, extraContext) {
  const sub = String(subject || '').replace(/"/g, '').trim();
  const extra = String(extraContext || '').replace(/adult content/i, '').trim();
  const out = [];
  const add = (q, why) => {
    const t = String(q || '').trim();
    if (!t) return;
    if (!out.some(x => x.q === t)) out.push({ q: t, why });
  };
  add('"' + sub + '" (performer OR photoset OR "official site" OR models)', 'adult-industry public sources');
  if (extra) {
    add('"' + sub + '" ' + extra + ' (photoset OR scene OR gallery OR video)', 'requested adult visual context');
    const syn = contextualSynonyms(extra, detectRelation(extra));
    if (syn) add('"' + sub + '" ' + syn, 'adult-context synonyms');
  } else {
    add('"' + sub + '" (credits OR filmography OR scene OR database)', 'adult-industry career, credits, and databases');
    add('"' + sub + '" (interview OR feature) (performer OR "official site")', 'adult-context interviews/features');
    add('"' + sub + '" (studio OR production OR collaborator)', 'adult-industry collaborators');
    add('"' + sub + '" (aka OR "stage name" OR "also known as")', 'public aliases and identifiers');
  }
  return out.slice(0, 5);
}

function imageSearchQuery(q, classification) {
  const subject = (classification && classification.subject) || q;
  const adult = (classification && classification.adultContent) || 'off';
  const ctx = (classification && classification.context) || '';
  const extra = /adult content/i.test(ctx) ? '' : ctx;
  const adultLensEntity = classification && (classification.type === 'person' || classification.type === 'social');
  const concepts = splitContextConcepts(classification);
  const fb = (classification && classification.identityFeedback) || {};
  const inherited = imageQueryInherits({
    subject,
    topic: extra || (concepts[0] || ''),
    adultLens: adult,
  }, classification, fb);
  let out = '';
  if (classification && (classification.type === 'technique' || classification.type === 'object' || classification.type === 'clothing' || classification.intentClass === 'OBJECT')) {
    out = conceptVisualSearchQuery(subject, extra);
  } else if ((adult === 'on' || adult === 'both') && concepts.length) out = '"' + subject + '" ' + concepts[0];
  else if ((adult === 'on' || adult === 'both') && extra) out = '"' + subject + '" ' + extra;
  else if (adult === 'on' && adultLensEntity) out = '"' + subject + '" (photoset OR scene OR models OR gallery)';
  else if (adult === 'both' && adultLensEntity) out = '"' + subject + '" (photoset OR scene OR models OR gallery OR portrait)';
  else if (concepts.length) out = '"' + subject + '" ' + concepts[0];
  else if (extra) out = '"' + subject + '" ' + extra;
  else out = subject;
  const neg = (fb.rejectedHosts || []).slice(0, 3).map(h => '-site:' + String(h).replace(/^www\./, '')).join(' ');
  if (neg && !out.includes('-site:')) out = (out + ' ' + neg).trim();
  if (inherited && inherited.identityConfirmed && subject && !out.includes(String(subject))) out = '"' + subject + '" ' + out;
  return out.replace(/\s+/g, ' ').trim();
}

function isAdultishSource(item) {
  const url = String(item && item.url || '');
  const host = hostOf(url);
  if (ADULT_HOST_RE.test(host) || ADULT_PATH_RE.test(url)) return true;
  const title = String(item && item.title || '');
  const snippet = String(item && item.snippet || '');
  const blob = ((isQueryShapedTitle(title) ? '' : title) + ' ' + snippet + ' ' + url).toLowerCase();
  return ADULT_EVIDENCE_RE.test(blob);
}

function isAggregatorPage(item) {
  const url = String(item && item.url || '');
  const host = hostOf(url);
  const title = String(item && item.title || '');
  if (TUBE_INDEX_RE.test(host)) return true;
  if (/(^|\.)(tube|xxx)[a-z0-9-]*\./i.test(host) || /\b(tube|xxx)\./i.test(host)) return true;
  if (ADULT_HOST_RE.test(host)) return false;
  if (/\/(top|playlists?|search|tags?|browse|categor(?:y|ies)|popular)(\/|\?|$)/i.test(url)) return true;
  if (/\b(tube search|search results?|videos to watch|watch free porn|most relevant porn|free sex vids?|tube videos?|free \w+ tube)\b/i.test(title)) return true;
  if (/^['""].+['""]\s*search\b/i.test(title)) return true;
  if (/\b(free \w+ videos?|watch .+ videos?)\b/i.test(title) && !/\(([12][0-9]{3})\)/.test(title) && !/\bin\s+[A-Z]/.test(title)) return true;
  if (/\b(porn videos?|xxx videos?|bondage porn|\bporn\b)\b/i.test(title) && !/\b((?:19|20)\d{2})\b/.test(title) && !/\bin\s+[A-Z]/.test(title) && !isSpecialistSource(item)) return true;
  return false;
}

function isSpecialistSource(item) {
  const host = hostOf(item && item.url);
  if (ADULT_HOST_RE.test(host) && !TUBE_INDEX_RE.test(host)) return true;
  if (INSTRUCTIONAL_HOST_RE.test(host)) return true;
  if (/\b(title\.rme|person\.rme|perfid=)/i.test(String(item && item.url || ''))) return true;
  return false;
}

function isSpecificEvidence(item, classification) {
  if (isAggregatorPage(item)) return false;
  const title = String(item && item.title || '');
  const snip = String(item && item.snippet || '');
  const url = String(item && item.url || '');
  if (isSpecialistSource(item)) return true;
  if (/\(([12][0-9]{3})\)/.test(title) && /[A-Z][a-z]/.test(title)) return true;
  if (/\bin\s+[A-Z][A-Za-z]/.test(title)) return true;
  if (/\b(interview|transcript|credits|filmography|review|tutorial|procedure|capacity|manual|photoset|scene)\b/i.test(title)) return true;
  if (/\/title\.|\/perfid=|\/babe\//i.test(url) && !/\/search/i.test(url)) return true;
  return false;
}

function classifyResultKind(item, classification, flags) {
  flags = flags || {};
  const host = hostOf(item && item.url);
  const title = String(item && item.title || '').trim();
  const hasVisual = flags.hasVisual || !!(item && (item.image || (item.images && item.images.length)));
  if (NAV_TITLE_RE.test(title) || SEO_JUNK_RE.test(host) || SEO_JUNK_RE.test(String(item && item.url || ''))) return 'JUNK';
  if (isAggregatorPage(item)) return 'AGGREGATOR';
  if (flags.intersection) {
    if (/\b(interview|podcast|transcript)\b/i.test(title)) return 'INTERVIEW_MATCH';
    return 'INTERSECTION_MATCH';
  }
  if (flags.relationship) return 'RELATIONSHIP_MATCH';
  if (item && (item.imageOrigin === 'image-index' || item.mediaKind === 'video') && flags.hasContext) return 'MEDIA_MATCH';
  if (GENERIC_BIO_HOST_RE.test(host)) return extraContext(classification) ? 'GENERIC_BACKGROUND' : 'ENTITY_MATCH';
  if ((classification && classification.type === 'person') && flags.hasEntity && hasVisual && !GENERIC_BIO_HOST_RE.test(host)) return 'VISUAL_ENTITY_MATCH';
  if (flags.hasContext && !flags.hasEntity) return 'CONTEXT_MATCH';
  if (flags.hasEntity && extraContext(classification) && !flags.hasContext) return 'GENERIC_BACKGROUND';
  if (flags.hasEntity) return 'ENTITY_MATCH';
  return 'WEAK_MATCH';
}

function interestLenses(type, classification) {
  const t = String(type || (classification && classification.type) || 'topic');
  const adult = (classification && classification.adultContent) || 'off';
  const byType = {
    person: [
      { id: 'everything', label: 'Everything' },
      { id: 'career', label: 'Career', context: 'career' },
      { id: 'interviews', label: 'Interviews', context: 'interviews' },
      { id: 'projects', label: 'Projects', context: 'projects' },
      { id: 'collaborations', label: 'Collaborations', context: 'collaborations' },
      { id: 'appearances', label: 'Public appearances', context: 'appearances' },
    ],
    vehicle: [
      { id: 'everything', label: 'Everything' },
      { id: 'reliability', label: 'Reliability', context: 'reliability' },
      { id: 'repair', label: 'Repair', context: 'repair' },
      { id: 'towing', label: 'Towing', context: 'towing' },
      { id: 'performance', label: 'Performance', context: 'performance' },
      { id: 'ownership', label: 'Ownership', context: 'ownership' },
      { id: 'issues', label: 'Common problems', context: 'problems' },
    ],
    product: [
      { id: 'everything', label: 'Everything' },
      { id: 'overview', label: 'Overview' },
      { id: 'repair', label: 'Repair', context: 'repair' },
      { id: 'specs', label: 'Specifications', context: 'specifications' },
      { id: 'reviews', label: 'Reviews', context: 'reviews' },
      { id: 'alternatives', label: 'Alternatives', context: 'alternatives' },
    ],
    skill: [
      { id: 'everything', label: 'Everything' },
      { id: 'fundamentals', label: 'Fundamentals', context: 'fundamentals' },
      { id: 'tools', label: 'Tools', context: 'tools' },
      { id: 'techniques', label: 'Techniques', context: 'techniques' },
      { id: 'safety', label: 'Safety', context: 'safety' },
      { id: 'projects', label: 'Projects', context: 'projects' },
      { id: 'trouble', label: 'Troubleshooting', context: 'troubleshooting' },
    ],
    clothing: [
      { id: 'everything', label: 'Everything' },
      { id: 'visuals', label: 'Visuals', context: 'photos' },
      { id: 'fit', label: 'Fit & sizing', context: 'fit' },
      { id: 'materials', label: 'Materials', context: 'fabric' },
      { id: 'similar', label: 'Similar garments', context: 'similar' },
    ],
    place: [
      { id: 'everything', label: 'Everything' },
      { id: 'visuals', label: 'Visuals', context: 'photos' },
      { id: 'history', label: 'History', context: 'history' },
    ],
    technique: [
      { id: 'everything', label: 'Everything' },
      { id: 'what', label: 'What this is' },
      { id: 'visuals', label: 'Visual references', context: 'photos' },
      { id: 'tutorials', label: 'Tutorials', context: 'tutorial' },
      { id: 'variations', label: 'Variations', context: 'variations' },
    ],
    organization: [
      { id: 'everything', label: 'Everything' },
      { id: 'official', label: 'Official presence' },
      { id: 'people', label: 'People', context: 'people' },
      { id: 'history', label: 'History', context: 'history' },
    ],
    topic: [
      { id: 'everything', label: 'Everything' },
      { id: 'overview', label: 'Overview' },
      { id: 'sources', label: 'Sources' },
    ],
  };
  const list = (byType[t] || byType.topic).map(function (x) { return Object.assign({}, x); });
  if ((adult === 'on' || adult === 'both') && t === 'person' && !list.some(function (x) { return x.id === 'credits'; })) {
    list.splice(1, 0, { id: 'credits', label: 'Credits & public work', context: 'credits' });
  }
  if (!list.some(function (x) { return x.id === 'specific'; })) list.push({ id: 'specific', label: 'Specific context', custom: true });
  if (!list.some(function (x) { return x.id === 'question'; })) list.push({ id: 'question', label: 'Ask a question', question: true });
  return list;
}

function investigationChoices(type, classification) {
  const t = String(type || (classification && classification.type) || 'topic');
  const adult = (classification && classification.adultContent) || 'off';
  const adultOn = adult === 'on' || adult === 'both';
  const extra = extraContext(classification);
  const byType = {
    person: [
      { id: 'everything', label: 'Everything', paths: ['all'] },
      { id: 'bondage', label: 'Bondage', paths: ['context', 'projects', 'images', 'videos'] },
      { id: 'people', label: 'People', paths: ['related', 'entities'] },
      { id: 'visuals', label: 'Visuals', paths: ['images', 'visuals'] },
      { id: 'clothing', label: 'Clothing', paths: ['images', 'visuals'] },
      { id: 'videos', label: 'Videos', paths: ['videos'] },

      { id: 'images', label: 'Images', paths: ['images'] },
      { id: 'interviews', label: 'Interviews', paths: ['interviews'] },
      { id: 'career', label: adultOn ? 'Career & credits' : 'Career & history', paths: adultOn ? ['career', 'projects', 'timeline'] : ['career', 'timeline', 'presence'] },
      { id: 'related', label: 'Related people', paths: ['related', 'entities'] },
      { id: 'premium', label: 'Premium Content', paths: ['premium', 'presence', 'sources'] },
    ],
    vehicle: [
      { id: 'everything', label: 'Everything', paths: ['all'] },
      { id: 'specs', label: 'Specifications', paths: ['specs'] },
      { id: 'repair', label: 'Repair', paths: ['maintenance', 'issues'] },
      { id: 'reviews', label: 'Reviews', paths: ['reviews'] },
      { id: 'history', label: 'History', paths: ['overview'] },
      { id: 'images', label: 'Images', paths: ['images'] },
      { id: 'videos', label: 'Videos', paths: ['videos'] },
    ],
    product: [
      { id: 'everything', label: 'Everything', paths: ['all'] },
      { id: 'repair', label: 'Repair', paths: ['manuals'] },
      { id: 'specs', label: 'Specifications', paths: ['specs'] },
      { id: 'reviews', label: 'Reviews', paths: ['reviews'] },
      { id: 'history', label: 'History', paths: ['pricing', 'overview'] },
    ],
    skill: [
      { id: 'everything', label: 'Everything', paths: ['all'] },
      { id: 'tutorials', label: 'Tutorials', paths: ['steps', 'tutorials'] },
      { id: 'tools', label: 'Tools', paths: ['tools'] },
      { id: 'safety', label: 'Safety', paths: ['safety'] },
      { id: 'history', label: 'Background', paths: ['goal'] },
    ],
    technique: [
      { id: 'everything', label: 'Everything', paths: ['all'] },
      { id: 'visuals', label: 'Visuals', paths: ['visuals', 'images'] },
      { id: 'terms', label: 'Terminology', paths: ['terms'] },
      { id: 'variations', label: 'Variations', paths: ['variations'] },
      { id: 'tutorials', label: 'Tutorials', paths: ['tutorials'] },
      { id: 'videos', label: 'Videos', paths: ['videos'] },
    ],
    clothing: [
      { id: 'everything', label: 'Everything', paths: ['all'] },
      { id: 'visuals', label: 'Visuals', paths: ['visuals', 'images'] },
      { id: 'fit', label: 'Fit & sizing', paths: ['fit', 'measurements'] },
      { id: 'materials', label: 'Materials', paths: ['materials'] },
      { id: 'similar', label: 'Similar garments', paths: ['similar'] },
      { id: 'videos', label: 'Videos', paths: ['videos'] },
    ],
    place: [
      { id: 'everything', label: 'Everything', paths: ['all'] },
      { id: 'visuals', label: 'Visuals', paths: ['images'] },
      { id: 'history', label: 'History', paths: ['overview'] },
      { id: 'related', label: 'Related places', paths: ['related'] },
    ],
    organization: [
      { id: 'everything', label: 'Everything', paths: ['all'] },
      { id: 'official', label: 'Official presence', paths: ['official'] },
      { id: 'people', label: 'People', paths: ['people'] },
      { id: 'history', label: 'History', paths: ['history'] },
    ],
    topic: [
      { id: 'everything', label: 'Everything', paths: ['all'] },
      { id: 'overview', label: 'Overview', paths: ['overview'] },
      { id: 'sources', label: 'Sources', paths: ['sources'] },
    ],
  };
  const list = (byType[t] || byType.topic).map(function (x) { return Object.assign({}, x); });
  if (extra && t === 'person' && !list.some(function (x) { return x.id === 'context'; })) {
    const label = extra.length > 28 ? extra.slice(0, 26) + '…' : extra;
    list.splice(1, 0, { id: 'context', label: label, paths: ['context', 'projects', 'images'] });
  }
  if (t === 'vehicle' && /\b(tow|towing|payload|hitch)\b/i.test(extra) && !list.some(function (x) { return x.id === 'towing'; })) {
    list.splice(3, 0, { id: 'towing', label: 'Towing', paths: ['specs'] });
  }
  if (!list.some(function (x) { return x.id === 'question'; })) {
    list.push({ id: 'question', label: 'Custom question', question: true, paths: [] });
  }
  return list;
}

function extraContext(classification) {
  return String((classification && classification.context) || '').replace(/adult content/gi, ' ').replace(/\s+/g, ' ').trim();
}

function splitContextConcepts(classification) {
  if (Array.isArray(classification && classification.conceptsList) && classification.conceptsList.length) {
    return classification.conceptsList.map(s => String(s || '').trim()).filter(s => s.length > 1).slice(0, 6);
  }
  const extra = extraContext(classification);
  if (!extra) return [];
  const plus = extra.split(/\s*(?:\+|\/|,|;|\band\b)\s*/i).map(s => s.trim()).filter(s => s.length > 1);
  if (plus.length >= 2) return [...new Set(plus)].slice(0, 6);
  const words = extra.split(/\s+/).filter(Boolean);
  const out = [];
  let buf = [];
  for (const w of words) {
    const atom = isKnownInvestigativeContext(w) || !!detectRelation(w) || CLOTHING_WORD_RE.test(w) || TECHNIQUE_WORD_RE.test(w);
    if (atom && buf.length) {
      out.push(buf.join(' '));
      buf = [w];
    } else buf.push(w);
  }
  if (buf.length) out.push(buf.join(' '));
  return [...new Set(out.filter(s => s && s.length > 1))].slice(0, 6);
}

function isVisualSubject(classification) {
  const t = String((classification && classification.type) || '');
  if (t === 'person' || t === 'technique' || t === 'product' || t === 'vehicle' || t === 'place' || t === 'clothing' || t === 'skill' || t === 'project' || t === 'social' || t === 'object' || t === 'visuals' || t === 'tutorial') return true;
  const rel = String((classification && classification.relation) || '');
  if (rel === 'clothing' || rel === 'visual' || rel === 'technique') return true;
  if (extraContext(classification)) return true;
  return false;
}

function visualDedupeKey(url) {
  return String(url || '').replace(/[?#].*$/, '').replace(/\/cdn-cgi\/image\/[^/]+\//, '/').toLowerCase();
}

function pushVisualHit(hits, hit, source) {
  if (!Array.isArray(hits) || !hit) return false;
  const image = usableImage(hit.image) || usableImage(hit.thumb);
  if (!image) return false;
  const key = visualDedupeKey(image);
  if (!key) return false;
  if (hits.some(h => visualDedupeKey(h.url) === key)) return false;
  const pageUrl = unwrap(hit.pageUrl || '') || '';
  hits.push({
    url: image,
    thumb: usableImage(hit.thumb) || image,
    pageUrl,
    domain: hostOf(pageUrl || image).replace(/^www\./, ''),
    title: (cleanTitle(hit.title) && !isQueryShapedTitle(hit.title)) ? cleanTitle(hit.title) : '',
    source: source || 'Image index',
    queryVariant: hit.query || '',
    imageOrigin: 'image-index',
    researchObject: true,
    visualLikenessIsNotIdentityProof: true,
    provenance: 'DISCOVERED',
    accessState: 'DISCOVERED',
    reason: 'Public image-index result. Attribution is the hosting page — visual likeness is not identity proof.',
    caption: cleanTitle(hit.title) || '',
    confidence: 'medium',
    relevance: 2,
  });
  return true;
}

function classifySourceClass(item, classification) {
  const url = String(item && (item.url || item.pageUrl) || '');
  const host = hostOf(url).replace(/^www\./, '');
  const adult = classification && (classification.adultContent === 'on' || classification.adultContent === 'both');
  const person = classification && (classification.type === 'person' || classification.type === 'social' || classification.type === 'ambiguous');
  if (GENERIC_BIO_HOST_RE.test(host)) return 'ENCYCLOPEDIA';
  if (isAggregatorPage(item) || TUBE_INDEX_RE.test(host)) return 'AGGREGATOR';
  if (/(^|\.)reddit\.com$/.test(host)) return 'COMMUNITY';
  if (PROFILE_HOST_RE.test(host)) return 'PUBLIC_PROFILE';
  if (ADULT_HOST_RE.test(host) || /houseofgord/i.test(host)) {
    if (/(iafd|adultfilmdatabase|data18|indexxx|babepedia|boobpedia|freeones|thenude|adultdvdtalk)/i.test(host)) return 'DATABASE';
    if (/(houseofgord|kink|devicebondage|hogtied|sexandsubmission|thetrainingofo|whippedass)/i.test(host)) return 'PRIMARY';
    return 'ADULT_PLATFORM';
  }
  if (isSpecialistSource(item) || INSTRUCTIONAL_HOST_RE.test(host)) return 'PRIMARY';
  if (adult && person && isAdultishSource(item)) return 'ADULT_PLATFORM';
  return 'UNKNOWN';
}

function applyExclusions(list, opts) {
  opts = opts || {};
  const urls = new Set((opts.excludeUrls || []).map(u => visualDedupeKey(u)).filter(Boolean));
  const hosts = new Set((opts.excludeHosts || []).map(h => String(h).replace(/^www\./, '').toLowerCase()).filter(Boolean));
  if (!urls.size && !hosts.size) return list || [];
  return (list || []).filter(item => {
    const u = visualDedupeKey(item && (item.url || item.image));
    const h = hostOf(item && (item.url || item.pageUrl || '')).replace(/^www\./, '').toLowerCase();
    if (u && urls.has(u)) return false;
    if (h && hosts.has(h)) return false;
    return true;
  });
}

function visualQueryVariants(classification, opts) {
  opts = opts || {};
  const subject = String((classification && classification.subject) || '').replace(/"/g, '');
  const extra = extraContext(classification);
  const concepts = splitContextConcepts(classification);
  const mode = String(opts.mode || 'more').toLowerCase();
  const quoted = subject ? '"' + subject + '"' : '';
  const out = [];
  const add = (q, why) => {
    const t = String(q || '').trim();
    if (!t || out.some(x => x.q === t)) return;
    out.push({ q: t, why: why || mode });
  };
  if (!quoted) return out;
  if (mode === 'similar' && opts.seedVisual) {
    const t = String((opts.seedVisual && (opts.seedVisual.title || opts.seedVisual.caption)) || extra || 'photos').replace(/"/g, '').slice(0, 48);
    add(quoted + ' ' + t, 'similar to the selected visual');
    if (opts.seedVisual.domain) add(quoted + ' site:' + String(opts.seedVisual.domain).replace(/^www\./, ''), 'same source as the selected visual');
  } else if (mode === 'samesource' && opts.seedVisual && opts.seedVisual.domain) {
    add(quoted + ' site:' + String(opts.seedVisual.domain).replace(/^www\./, ''), 'same source');
  } else if (mode === 'sameperson') {
    add(quoted + ' (portrait OR photos OR gallery OR photoset)', 'same person, broader visuals');
  } else if (mode === 'sameconcept' && extra) {
    add(quoted + ' ' + extra, 'same concept intersection');
    add(extra + ' (photos OR gallery OR diagram)', 'concept visuals without collapsing to identity');
  } else if (mode === 'sameproduction' && opts.seedVisual) {
    add(quoted + ' ' + String((opts.seedVisual.title || extra || 'scene')).replace(/"/g, '').slice(0, 48), 'same production/visual');
  } else if (mode === 'searchvisual' || mode === 'thisvisual') {
    if (opts.seedVisual && opts.seedVisual.domain) add(quoted + ' site:' + String(opts.seedVisual.domain).replace(/^www\./, ''), 'source page of the selected visual');
    const cap = String((opts.seedVisual && (opts.seedVisual.title || opts.seedVisual.caption)) || extra || '').replace(/"/g, '').slice(0, 48);
    if (cap) add(quoted + ' ' + cap, 'new evidence lane from selected visual');
    add(quoted + ' (gallery OR stills OR photoset)', 'gallery class from selected visual');
    if (concepts[0]) add(quoted + ' ' + concepts[0] + ' (photos OR stills)', 'keep the requested concept on the visual lane');
  } else if (mode === 'different') {
    add(quoted + (extra ? ' ' + extra : '') + ' (gallery OR stills OR photoset OR lookbook) -wikipedia', 'different visual providers');
    const neg = (opts.excludeHosts || []).slice(0, 3).map(h => '-site:' + String(h).replace(/^www\./, '')).join(' ');
    if (neg) add(quoted + ' ' + (extra || 'photos') + ' ' + neg, 'exclude rejected sources');
    if (concepts[1]) add(quoted + ' ' + concepts[1] + ' (photos OR gallery)', 'alternate concept visual lane');
    for (const sc of sourceClassQueries(classification)) {
      if (sc.kind === 'image' || sc.lane === 'galleries') add(sc.q, sc.why);
    }
  } else {
    add(imageSearchQuery(subject, classification), 'primary visual corpus');
    if (concepts.length) {
      for (const c of concepts.slice(0, 4)) add(quoted + ' ' + c + ' (gallery OR photos OR stills)', 'entity × independent concept visual lane');
    } else if (extra) {
      add(quoted + ' ' + extra + ' (gallery OR photos OR stills)', 'entity × concept visuals');
    }
    add(quoted + ' (photos OR images OR gallery)', 'broad visual index');
    add(quoted + ' (interview OR feature) (photo OR still)', 'interview stills query class');
    add(quoted + ' (credits OR filmography OR production) (still OR gallery)', 'production stills query class');
    for (const sc of sourceClassQueries(classification)) {
      if (sc.kind === 'image') add(sc.q, sc.why);
    }
  }
  const unused = nextUnusedQueries(out, opts.attemptedQueries || [], mode === 'more' || mode === 'searchvisual' ? 8 : 6);
  if (unused.length) return unused.slice(0, 8);
  if ((mode === 'more' || mode === 'searchvisual') && quoted) {
    add(quoted + ' (photocall OR "press still" OR "behind the scenes")', 'additional stills class after exhausted primary visual classes');
    add(quoted + ' (screenshot OR frame OR thumbnail OR still)', 'frame stills class');
    const extraUnused = nextUnusedQueries(out, opts.attemptedQueries || [], 8);
    if (extraUnused.length) return extraUnused.slice(0, 8);
  }
  return out.slice(0, 8);
}

function videoQueryVariants(classification, opts) {
  opts = opts || {};
  const subject = String((classification && classification.subject) || '').replace(/"/g, '');
  const extra = extraContext(classification);
  const concepts = splitContextConcepts(classification);
  const quoted = subject ? '"' + subject + '"' : '';
  const adult = (classification && classification.adultContent) || 'off';
  const adultOn = adult === 'on' || adult === 'both';
  const out = [];
  const add = (q, why) => {
    const t = String(q || '').trim();
    if (!t || out.some(x => x.q === t)) return;
    out.push({ q: t, why: why || 'video class' });
  };
  if (!quoted) return out;
  add(quoted + ' (interview OR podcast) (video OR youtube)', 'interview video class');
  add(quoted + ' site:youtube.com', 'youtube source class');
  if (adultOn) add(quoted + ' (scene OR clip OR video)', 'adult-context public video class');
  else add(quoted + ' (trailer OR clip OR video OR talk)', 'public video class');
  if (concepts.length) {
    for (const c of concepts.slice(0, 3)) add(quoted + ' ' + c + ' (video OR clip)', 'entity × concept video lane');
  } else if (extra && !/adult content/i.test(extra)) {
    add(quoted + ' ' + extra + ' (video OR clip)', 'entity × context video lane');
  }
  add(quoted + ' (vimeo OR youtube) interview', 'public host video class');
  const unused = nextUnusedQueries(out, opts.attemptedQueries || [], 6);
  return (unused.length ? unused : out).slice(0, 6);
}

function identityExpansionQueries(classification) {
  const subject = String((classification && classification.subject) || '').replace(/"/g, '');
  const type = (classification && classification.type) || '';
  const adult = (classification && classification.adultContent) || 'off';
  if (!subject || (type !== 'person' && type !== 'social' && type !== 'ambiguous')) return [];
  const out = [];
  const add = (q, why) => {
    const t = String(q || '').trim();
    if (!t || out.some(x => x.q === t)) return;
    out.push({ q: t, why });
  };
  add('"' + subject + '" (aka OR "also known as" OR "stage name" OR alias OR "real name")', 'public aliases and identifiers');
  add('"' + subject + '" (profile OR credits OR filmography OR "official site")', 'identity surfaces');
  if (adult === 'on' || adult === 'both') {
    add('"' + subject + '" (performer OR "adult film" OR photoset OR models OR credits)', 'adult-industry identity surfaces');
  }
  return out;
}

function canonicalVideoKey(url) {
  const yt = youtubeId(url);
  if (yt) return 'yt:' + yt;
  const vim = vimeoId(url);
  if (vim) return 'vm:' + vim;
  const raw = String(url || '');
  if (/\.(mp4|webm|mov)(\?|$)/i.test(raw)) {
    return 'file:' + raw.replace(/[?#].*$/, '').toLowerCase();
  }
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (/youtube\.com|youtu\.be|vimeo\.com/i.test(host)) return (host + u.pathname + (u.searchParams.get('v') ? ('?v=' + u.searchParams.get('v')) : '')).toLowerCase();
    return u.href.replace(/#.*$/, '');
  } catch {
    return raw.replace(/[?#].*$/, '').toLowerCase();
  }
}

function parseAttemptedList(raw) {
  if (Array.isArray(raw)) return raw.map(s => String(s || '').trim()).filter(Boolean);
  const s = String(raw || '').trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try { return JSON.parse(s).map(x => String(x || '').trim()).filter(Boolean); } catch { return []; }
  }
  return s.split(/\n|,/).map(x => x.trim()).filter(Boolean);
}

function attemptedSet(list) {
  return new Set((list || []).map(s => String(s).trim().toLowerCase()).filter(Boolean));
}

function nextUnusedQueries(candidates, attempted, limit) {
  const seen = attemptedSet(attempted);
  const out = [];
  for (const c of candidates || []) {
    const q = typeof c === 'string' ? c : (c && c.q);
    const t = String(q || '').trim();
    if (!t) continue;
    if (seen.has(t.toLowerCase())) continue;
    out.push(typeof c === 'string' ? { q: t, why: 'next query class' } : c);
    if (out.length >= (limit || 6)) break;
  }
  return out;
}

function sourceClassCatalog(classification) {
  const subject = String((classification && classification.subject) || '').replace(/"/g, '').trim();
  const type = (classification && classification.type) || '';
  const adult = (classification && classification.adultContent) || 'off';
  const adultOn = adult === 'on' || adult === 'both';
  const quoted = subject ? '"' + subject + '"' : '';
  const person = type === 'person' || type === 'social' || type === 'ambiguous';
  const classes = [];
  const add = (id, label, queries, kind) => {
    const qs = [...new Set((queries || []).map(q => String(q || '').trim()).filter(Boolean))];
    if (!qs.length) return;
    classes.push({ id, label, queries: qs, kind: kind || 'web' });
  };
  if (!quoted) return classes;
  add('identity', 'identity/primary', [quoted + ' (profile OR "official site" OR bio OR about)'], 'web');
  if (person) {
    add('professional', 'professional/industry', adultOn
      ? [quoted + ' (credits OR filmography OR database OR performer OR "official site")']
      : [quoted + ' (credits OR filmography OR discography OR "official site" OR agency)'], 'web');
    add('interviews', 'interviews/articles', [quoted + ' (interview OR podcast OR transcript OR feature OR "q&a")'], 'web');
    add('productions', 'production databases', adultOn
      ? [quoted + ' (filmography OR credits OR scene OR photoset OR production)']
      : [quoted + ' (filmography OR credits OR productions OR appearing)'], 'web');
    add('galleries', 'public galleries', [quoted + ' (gallery OR photoset OR "press photos" OR stills OR portfolio)'], 'image');
    add('media', 'media', [quoted + ' (video OR clip OR interview video OR trailer)'], 'video');
    add('community', 'community', [quoted + ' site:reddit.com'], 'web');
    add('reference', 'reference', adultOn ? [] : [quoted + ' (encyclopedia OR biography OR wiki)'], 'web');
  } else if (type === 'vehicle' || type === 'product') {
    add('professional', 'manufacturer/documentation', [quoted + ' (official OR spec OR manual OR brochure)'], 'web');
    add('media', 'media', [quoted + ' (review OR video OR walkaround)'], 'video');
    add('community', 'community', [quoted + ' site:reddit.com (owner OR review)'], 'web');
  } else if (type === 'skill' || type === 'technique') {
    add('professional', 'instructional', [quoted + ' (tutorial OR "how to" OR demonstration)'], 'web');
    add('media', 'media', [quoted + ' (video OR diagram)'], 'video');
  } else {
    add('reference', 'reference', [quoted + ' (overview OR article OR source)'], 'web');
  }
  return classes.filter(c => c.queries.length);
}

function sourceClassQueries(classification) {
  const out = [];
  for (const c of sourceClassCatalog(classification)) {
    for (const q of c.queries) out.push({ q, why: c.label, lane: c.id, kind: c.kind, sourceClass: c.id });
  }
  return out;
}

function independentLaneQueries(classification) {
  const subject = String((classification && classification.subject) || '').replace(/"/g, '').trim();
  const concepts = splitContextConcepts(classification);
  const out = [];
  const add = (q, why, lane) => {
    const t = String(q || '').trim();
    if (!t || out.some(x => x.q === t)) return;
    out.push({ q: t, why, lane: lane || 'lane' });
  };
  if (!subject) return out;
  add('"' + subject + '"', 'entity-only identity lane', 'entity');
  for (const c of concepts.slice(0, 4)) {
    add(String(c), 'independent concept lane', 'solo-' + String(c).replace(/\s+/g, '-').slice(0, 24));
    add('"' + subject + '" ' + c, 'entity × independent concept', 'pair-' + String(c).replace(/\s+/g, '-').slice(0, 24));
  }
  if (concepts.length >= 2) {
    add('"' + subject + '" ' + concepts[0] + ' ' + concepts[1], 'first progressive intersection', 'intersect-2');
  }
  return out;
}

function harvestPageGraph(html, pageUrl) {
  const videos = [];
  const related = [];
  const productions = [];
  const seenV = new Set();
  const seenU = new Set();
  const pushVideo = (href, title) => {
    const url = unwrap(href);
    if (!url) return;
    const key = canonicalVideoKey(url);
    if (!key || seenV.has(key)) return;
    if (!(isVideoUrl(url) || youtubeId(url) || vimeoId(url))) return;
    seenV.add(key);
    videos.push({ url, key, title: title || '', pageUrl });
  };
  const pushUrl = (href, into, kind) => {
    try {
      const u = new URL(decodeEntities(href), pageUrl);
      if (!/^https?:$/i.test(u.protocol)) return;
      const hrefs = u.href.split('#')[0];
      if (seenU.has(hrefs) || hrefs === pageUrl) return;
      seenU.add(hrefs);
      into.push({ url: hrefs, kind });
    } catch {}
  };
  const iframeRe = /<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = iframeRe.exec(html || '')) && videos.length < 16) pushVideo(m[1], '');
  const hrefRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = hrefRe.exec(html || '')) && (videos.length < 20 || productions.length < 8 || related.length < 8)) {
    const href = m[1];
    const title = cleanTitle(m[2]) || '';
    if (youtubeId(href) || vimeoId(href)) pushVideo(href, title);
    else if (/\/(title|titles|movie|film|scene|scenes|video|videos|photoset|gallery|galleries|credits|name\/)(\/|$)/i.test(href)) {
      pushUrl(href, /gallery|photoset|photo/i.test(href) ? productions : productions, /gallery|photoset/i.test(href) ? 'gallery' : 'production');
    } else if (/\b(19|20)\d{2}\b/.test(title) && title.split(/\s+/).length >= 2 && title.split(/\s+/).length <= 8) {
      pushUrl(href, productions, 'production');
    }
  }
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = ldRe.exec(html || ''))) {
    try {
      const j = JSON.parse(m[1]);
      const walk = (o) => {
        if (!o) return;
        if (Array.isArray(o)) { o.slice(0, 12).forEach(walk); return; }
        if (typeof o !== 'object') return;
        const typ = String(o['@type'] || o.type || '');
        if (/VideoObject/i.test(typ)) {
          pushVideo(o.contentUrl || o.embedUrl || o.url, o.name || o.title || '');
          if (o.thumbnailUrl) { /* images harvested elsewhere */ }
        }
        if (o.contentUrl) pushVideo(o.contentUrl, o.name || '');
        if (o.embedUrl) pushVideo(o.embedUrl, o.name || '');
        if (o.itemListElement) walk(o.itemListElement);
        if (o.video) walk(o.video);
        if (o.embedUrl) walk(o);
      };
      walk(j);
    } catch {}
  }
  const ytRe = /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[\w-]{6,}|youtu\.be\/[\w-]{6,}|youtube\.com\/embed\/[\w-]{6,}|vimeo\.com\/(?:video\/)?\d+)/gi;
  while ((m = ytRe.exec(html || '')) && videos.length < 24) pushVideo(m[0], '');
  return {
    videos: videos.slice(0, 16),
    related: related.slice(0, 8),
    productions: productions.slice(0, 8),
    galleries: galleryLinks(html, pageUrl),
  };
}

function collectPremiumContent(results, retrieved) {
  const out = [];
  const seen = new Set();
  const add = (item) => {
    const url = String((item && (item.finalUrl || item.url || item.pageUrl)) || '');
    if (!url || seen.has(url)) return;
    const host = hostOf(url);
    const platform = PREMIUM_PLATFORM_SEEDS.find(p => {
      const h = p.host;
      return host === h || host.endsWith('.' + h) || host.replace(/^www\./, '') === h;
    });
    const state = String((item && (item.accessState || '')) || '');
    const restricted = /PAYWALLED|AUTHENTICATION_REQUIRED|AGE_RESTRICTED|BLOCKED|SUBSCRIPTION/i.test(state)
      || MEMBER_HOST_RE.test(host)
      || AUTH_HOST_RE.test(host)
      || !!platform
      || /onlyfans|fansly|loyalfans|manyvids|clips4sale|patreon|fancentro/i.test(url + ' ' + String((item && item.title) || ''));
    if (!restricted) return;
    seen.add(url);
    const row = premiumAccessClassification(item, item);
    const own = classifyAccountOwnership(item, (item && (item.subject || item.entity || '')) || '');
    let accessKind = row.accessKind === 'authorized_access_required' ? 'subscription required'
      : (row.accessKind === 'inaccessible' ? 'unavailable/blocked'
        : (row.accessKind === 'public_preview_found' ? 'public preview found'
          : (row.accessKind === 'public_metadata_found' ? 'public metadata found'
            : (row.accessKind === 'account_corroborated' ? 'account independently corroborated'
              : (row.accessKind === 'unverified_claim' ? 'unverified/possibly fraudulent claim'
                : 'account discovered')))));
    if (state === 'PAYWALLED' || MEMBER_HOST_RE.test(hostOf(url))) accessKind = accessKind === 'account discovered' ? 'subscription required' : accessKind;
    else if (state === 'AUTHENTICATION_REQUIRED') accessKind = 'login required';
    else if (state === 'AGE_RESTRICTED') accessKind = 'login required';
    else if (state === 'PARTIALLY_RETRIEVED') accessKind = 'public page but restricted content';
    out.push({
      url,
      title: (item && (item.title || item.label)) || hostOf(url),
      domain: hostOf(url).replace(/^www\./, ''),
      accessState: state || 'REFERENCED',
      accessKind,
      premiumAccess: row.accessKind,
      publiclyViewable: !!row.publiclyViewable,
      contentRetrieved: !!row.contentRetrieved,
      accountDiscovered: true,
      ownership: own.kind,
      platform: own.platform || row.platform,
      handle: own.handle,
      note: row.note || (item && (item.accessNote || item.publicEvidence || item.error)) || 'Referenced as a public citation. Carmen did not access restricted material. Finding the profile URL is not content retrieval.',
      publicEvidence: (item && item.publicEvidence) || '',
      discoveryPaths: item && item.discoveryPaths,
    });
  };
  for (const r of retrieved || []) add(r);
  for (const r of results || []) add(r);
  return out.slice(0, 24);
}

function providerPivotReport(diagnostics) {
  const failures = [];
  const empty = [];
  const ok = [];
  for (const [name, d] of Object.entries(diagnostics || {})) {
    if (!d || typeof d !== 'object') continue;
    if (d.error || (typeof d.status === 'number' && d.status >= 400 && !d.ok)) {
      failures.push({ provider: name, reason: d.error || ('HTTP ' + d.status) });
    } else if (d.ok && Number(d.added) === 0) {
      empty.push({ provider: name, reason: 'empty' });
    } else if (d.ok || d.added > 0) {
      ok.push(name);
    }
  }
  return { failures, empty, ok, pivots: empty.length + failures.length };
}

function knowledgeModelGuide() {
  return `Knowledge model for important claims:
- KNOWN: multiple independent public sources agree
- PROBABLE: supported but thin
- UNCERTAIN: mentioned without corroboration
- CONTRADICTED: sources disagree
- NOT YET ESTABLISHED: not found in retrieved public sources

For each meaningful conclusion preserve provenance:
SOURCE SAYS: what the source actually establishes
INFERENCE: what is inferred from multiple sources
UNVERIFIED: what remains unsupported

Keep OBSERVED / INFERRED / UNKNOWN labels as well.
End with: NEXT HIGH-VALUE STEP — the next useful public retrieval action, not a guess.`;
}

function buildVisualCorpus(results, retrieved, classification, extraHits) {
  const imgs = collectDiveImages(retrieved || [], results || [], classification);
  const out = [];
  const seen = new Set();
  const push = (im) => {
    if (!im) return;
    const rawUrl = im.url || im.image || im.src || '';
    if (!usableImage(rawUrl)) return;
    const key = visualDedupeKey(rawUrl);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      url: im.url || im.image,
      thumb: im.thumb || im.url || im.image,
      pageUrl: im.pageUrl || '',
      domain: im.domain || '',
      title: im.title || im.caption || im.reason || '',
      source: im.source || '',
      reason: im.reason || 'Image keeps page provenance. Visual likeness is not identity proof.',
      caption: im.caption || im.title || '',
      confidence: im.confidence || 'medium',
      relevance: im.relevance || 0,
      provenance: im.provenance || 'DISCOVERED',
      accessState: im.accessState || 'DISCOVERED',
      relationshipToEntity: im.relationshipToEntity || '',
      relationshipToContext: im.relationshipToContext || '',
      queryVariant: im.queryVariant || '',
      visualLikenessIsNotIdentityProof: true,
      researchObject: true,
      associatedSource: im.pageUrl || im.source || '',
      visualClass: (classifyVisualRelevance(im, classification) || {}).visualClass || 'unknown',
      visualClassReason: (classifyVisualRelevance(im, classification) || {}).reason || '',
      matchQuality: (classifyMatchQuality(im, classification) || {}).matchQuality || 'unknown',
      matchQualityReason: (classifyMatchQuality(im, classification) || {}).reason || '',
      demote: !!(classifyVisualRelevance(im, classification) || {}).demote,
    });
  };
  const adultOn = ((classification && classification.adultContent) === 'on' || (classification && classification.adultContent) === 'both') && classification.type === 'person';
  const hitAdult = (h) => isAdultishSource({ url: h.pageUrl || h.url || h.image, title: h.title || h.caption || '', snippet: h.source || '' });
  if (adultOn) {
    for (const h of (extraHits || []).filter(hitAdult)) push(h);
    for (const im of imgs) push(im);
    for (const h of extraHits || []) push(h);
  } else {
    for (const h of extraHits || []) push(h);
    for (const im of imgs) push(im);
  }
  return out.slice(0, 96);
}

function classifyVideoDuration(item) {
  const blob = String((item && (item.title || '')) + ' ' + (item && (item.snippet || '')) + ' ' + (item && (item.url || '')) + ' ' + (item && (item.pageUrl || ''))).toLowerCase();
  let seconds = null;
  const hm = blob.match(/\b(\d+)\s*(?:h|hr|hours?)\s*(\d+)?\s*(?:m|min|minutes?)?\b/);
  const mm = blob.match(/\b(\d+)\s*(?:m|min|minutes?)\b/);
  const clock = blob.match(/\b(\d+):(\d{2})(?::(\d{2}))?\b/);
  if (hm) seconds = (Number(hm[1]) || 0) * 3600 + (Number(hm[2]) || 0) * 60;
  else if (clock) {
    if (clock[3]) seconds = Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    else seconds = Number(clock[1]) * 60 + Number(clock[2]);
  } else if (mm) seconds = (Number(mm[1]) || 0) * 60;
  if (seconds != null && seconds > 0) {
    if (seconds < 30) return { class: 'very-short', seconds, label: 'very short' };
    if (seconds < 120) return { class: 'short', seconds, label: 'short' };
    if (seconds < 600) return { class: 'medium', seconds, label: 'medium' };
    if (seconds < 1800) return { class: 'long', seconds, label: 'long' };
    if (seconds < 3600) return { class: 'full-length', seconds, label: 'full-length' };
    return { class: 'extended', seconds, label: 'extended' };
  }
  if (/\b(short|#shorts|clip|trailer|teaser|preview|promo)\b/i.test(blob)) return { class: 'short', seconds: null, label: 'short' };
  if (/\b(full[- ]?(?:length|movie|video|scene)|uncut|complete|extended|documentary|featurette|feature)\b/i.test(blob)) return { class: 'full-length', seconds: null, label: 'full-length' };
  return { class: 'unknown', seconds: null, label: '' };
}

function investigateFurtherQueries(classification, priorResults, graphLeads) {
  const subject = String((classification && classification.subject) || '').replace(/"/g, '');
  const extra = extraContext(classification);
  const quoted = subject ? '"' + subject + '"' : '';
  const type = (classification && classification.type) || '';
  const out = [];
  const add = (q, why) => {
    const t = String(q || '').trim();
    if (!t || out.some(x => x.q === t)) return;
    out.push({ q: t, why: why || 'second-pass research' });
  };
  if (!quoted) return out;
  add(quoted + ' site:reddit.com', 'community discussion not covered in the first pass');
  if (type === 'person' || type === 'social') {
    add(quoted + ' interview OR podcast OR transcript', 'interviews missing from the first pass');
    add(quoted + ' (credits OR filmography OR "also known")', 'credits and aliases');
  }
  if (type === 'technique' || type === 'skill' || type === 'project') {
    add(quoted + ' tutorial OR demonstration OR "how to"', 'instructional sources');
    add(quoted + ' (variations OR "also called" OR terminology)', 'terminology and variations');
  }
  if (type === 'clothing') {
    add(quoted + ' (fit OR sizing OR fabric OR lookbook)', 'fit and material sources');
    add(quoted + ' similar OR inspired OR alternative', 'similar garments');
  }
  if (type === 'product' || type === 'vehicle') {
    add(quoted + ' (manual OR spec OR review OR diagram)', 'spec and demonstration sources');
  }
  if (isVisualSubject(classification)) {
    add(imageSearchQuery(subject, classification), 'additional visual corpus');
  }
  if (extra) add(quoted + ' ' + extra + ' (review OR discussion OR explained)', 'deeper entity × concept');
  for (const l of (graphLeads || []).slice(0, 4)) {
    if (l && l.q) add(l.q, l.why || 'related lead from the first pass');
  }
  const seenHosts = new Set((priorResults || []).map(r => hostOf(r && r.url).replace(/^www\./, '')).filter(Boolean));
  return out.filter(v => {
    const hostGuess = String(v.q || '').match(/site:([a-z0-9.-]+)/i);
    if (hostGuess && seenHosts.has(hostGuess[1].replace(/^www\./, ''))) return true;
    return true;
  }).slice(0, 8);
}

function ambiguousInterpretations(q, classification) {
  const t = String((classification && classification.type) || '');
  const conf = String((classification && classification.confidence) || '');
  if (t !== 'ambiguous' && conf !== 'low') return [];
  const raw = String(q || (classification && classification.subject) || '').trim();
  if (!raw) return [];
  const out = [];
  const add = (type, why) => { if (!out.some(x => x.type === type)) out.push({ type, why, q: raw }); };
  add('person', 'Could be a person');
  add('product', 'Could be a product or brand');
  add('technique', 'Could be a technique or position');
  add('topic', 'Could be a topic or community term');
  return out.slice(0, 4);
}

function normalizeDepth(v, classification) {
  const s = String(v || '').toLowerCase().trim();
  if (s === 'deep' || s === 'all') return 'deep';
  if (s === 'broad') return 'broad';
  const extra = extraContext(classification);
  const adultOn = classification && (classification.adultContent === 'on' || classification.adultContent === 'both');
  if (s === 'contextual' || s === 'context') {
    if (extra || adultOn) return 'contextual';
    return 'broad';
  }
  if (extra || adultOn) return 'contextual';
  return 'broad';
}

const RELATION_VOCAB = {
  bondage: {
    related: ['bdsm', 'restraint', 'shibari', 'kinbaku', 'rope'],
    production: ['scene', 'photoset', 'credits'],
    interview: ['interview', 'podcast'],
    media: ['video', 'clip', 'gallery'],
    specialist: ['filmography', 'database', 'credits'],
    org: ['studio', 'production'],
  },
  interview: {
    related: ['podcast', 'q&a', 'feature', 'talk'],
    production: ['episode', 'appearance'],
    interview: ['interview', 'transcript'],
    media: ['youtube', 'video'],
    specialist: ['press', 'magazine'],
    org: ['network', 'show'],
  },
  repair: {
    related: ['service', 'maintenance', 'fix'],
    production: [],
    interview: [],
    media: ['video', 'diagram'],
    specialist: ['manual', 'bulletin', 'guide'],
    org: ['dealer', 'service'],
  },
  towing: {
    related: ['tow capacity', 'payload', 'hitch'],
    production: [],
    interview: [],
    media: ['video'],
    specialist: ['specs', 'capacity'],
    org: ['dealer'],
  },
  adult: {
    related: ['performer', 'photoset'],
    production: ['scene', 'filmography', 'credits'],
    interview: ['interview', 'feature'],
    media: ['gallery', 'video', 'photoset'],
    specialist: ['database', 'credits', 'filmography'],
    org: ['studio'],
  },
  visual: {
    related: ['photos', 'gallery', 'images'],
    production: [],
    interview: [],
    media: ['photoset', 'gallery'],
    specialist: [],
    org: [],
  },
  video: {
    related: ['clip', 'footage', 'youtube'],
    production: [],
    interview: ['interview'],
    media: ['video', 'clip'],
    specialist: [],
    org: [],
  },
  clothing: {
    related: ['outfit', 'wardrobe', 'wearing'],
    production: [],
    interview: [],
    media: ['photos', 'gallery'],
    specialist: [],
    org: [],
  },
  skill: {
    related: ['tutorial', 'procedure', 'how to'],
    production: [],
    interview: [],
    media: ['video', 'diagram'],
    specialist: ['guide'],
    org: [],
  },
  technique: {
    related: ['form', 'variation', 'reference'],
    production: [],
    interview: [],
    media: ['photo', 'video', 'diagram'],
    specialist: ['guide'],
    org: [],
  },
  performance: {
    related: ['concert', 'live', 'tour'],
    production: ['set', 'show'],
    interview: ['interview'],
    media: ['video', 'photos'],
    specialist: [],
    org: ['venue'],
  },
};


function isConceptToken(w) {
  const s = String(w || '');
  if (s.length < 3 || s.length > 40) return false;
  if (/^(and|the|for|with|from|that|this|into|over|near|a|an)$/i.test(s)) return false;
  if (/^\d+$/.test(s)) return false;
  return /^[A-Za-z][A-Za-z0-9'-]*$/.test(s);
}

function morphologicalNeighbors(term) {
  const t = String(term || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  const out = [];
  const add = (x) => {
    const s = String(x || '').trim();
    if (s && s !== t && s.length > 2 && out.indexOf(s) < 0) out.push(s);
  };
  if (!t) return out;
  const parts = t.split(/[\s-]+/).filter(w => w.length > 2);
  for (const w of parts) {
    if (w !== t) add(w);
    if (w.endsWith('ing') && w.length > 5) {
      const stem = w.slice(0, -3);
      add(stem);
      add(stem + 'e');
    } else if (w.endsWith('ed') && w.length > 4) {
      add(w.slice(0, -2));
      add(w.slice(0, -1));
    } else if (w.endsWith('tion') && w.length > 6) {
      add(w.replace(/tion$/, 't'));
    } else if (w.length > 7 && !/(ing|tion|phy|graphy|ness|ment|ology)$/i.test(w)) {
      add(w + 'ing');
    }
  }
  return out.slice(0, 5);
}

// Structural families = source/intent axes. Not a topic dictionary. Not an adult tag dump.
// Platform vocabulary ≠ Carmen ontology. Adult is a lens of this same system.
const STRUCTURAL_FAMILIES = [
  { id: 'interview', vocabKey: 'interview', re: /\b(interview|podcast|discuss(?:ion|es|ed)?|transcript|q\s*&\s*a|talks?)\b/i, sourceTypes: ['interview', 'article'] },
  { id: 'visual', vocabKey: 'visual', re: /\b(photos?|images?|pics?|gallery|portrait|photography|photoshoot|low[- ]light)\b/i, sourceTypes: ['images'] },
  { id: 'video', vocabKey: 'video', re: /\b(videos?|youtube|clip|footage)\b/i, sourceTypes: ['videos'] },
  { id: 'documentation', vocabKey: '', re: /\b(spec|specs|capacity|rating|manual|documentation|datasheet|bulletin)\b/i, sourceTypes: ['manufacturer', 'manual'] },
  { id: 'practice', vocabKey: 'skill', re: /\b(weld(?:ing|er)?|woodwork(?:ing)?|joinery|fabricat(?:e|ion)|solder(?:ing)?|install(?:ation)?|repair|repairs|fix|service|maintenance|tutorial|how[- ]to|procedure|technique|method|form)\b/i, sourceTypes: ['tutorial', 'manual', 'safety'] },
  { id: 'capability', vocabKey: 'towing', re: /\b(tow|towing|payload|hauling)\b/i, sourceTypes: ['manufacturer', 'spec', 'owner-report'] },
  { id: 'history', vocabKey: '', re: /\b(history|timeline|origins?|controversy|scandal|terminology|glossary)\b/i, sourceTypes: ['article', 'encyclopedia'] },
  { id: 'clothing', vocabKey: 'clothing', re: /\b(wearing|outfit|dress|clothing|costume|wardrobe)\b/i, sourceTypes: ['images'] },
  { id: 'performance', vocabKey: 'performance', re: /\b(concert|performance|show|tour|stage)\b/i, sourceTypes: ['review', 'video'] },
];

// Similarweb Adult ranking (August 2026). IA type only — never copied tag lists.
const PLATFORM_IA = [
  { id: 'pornhub', kind: 'tube', taxonomy: 'curated-categories+uploader-tags' },
  { id: 'xhamster', kind: 'tube', taxonomy: 'community-categories+tags' },
  { id: 'xvideos', kind: 'tube', taxonomy: 'tag-heavy' },
  { id: 'xnxx', kind: 'tube', taxonomy: 'folksonomy-tags' },
  { id: 'eporner', kind: 'tube', taxonomy: 'tag-heavy' },
  { id: 'youporn', kind: 'tube', taxonomy: 'curated-categories+tags' },
  { id: 'spankbang', kind: 'tube', taxonomy: 'tag-heavy' },
  { id: 'stripchat', kind: 'livestream', taxonomy: 'performer-room-tags' },
  { id: 'chaturbate', kind: 'livestream', taxonomy: 'performer-room-tags' },
  { id: 'livejasmin', kind: 'livestream', taxonomy: 'performer-room-tags' },
  { id: 'onlyfans', kind: 'creator', taxonomy: 'creator-search-not-categories' },
  { id: 'erome', kind: 'gallery', taxonomy: 'albums+tags' },
  { id: 'dmm', kind: 'studio-catalog', taxonomy: 'maker-series-genre' },
];

function inferFamily(term, entityType, adult) {
  const t = String(term || '');
  const type = String(entityType || '');
  const rel = detectRelation(t);
  const hits = STRUCTURAL_FAMILIES.filter(f => f.re.test(t));
  if (type === 'skill' || type === 'technique') {
    if (rel === 'towing' || rel === 'repair' || hits.some(f => f.id === 'capability')) {
      return { id: 'practice', vocabKey: 'skill', sourceTypes: ['tutorial', 'manual', 'safety'], applied: 'skill-object', re: null };
    }
    const p = hits.find(f => f.id === 'practice') || hits[0];
    if (p) return { ...p, applied: 'cue' };
    return { id: 'practice', vocabKey: 'skill', sourceTypes: ['tutorial', 'manual', 'safety'], applied: 'unknown', re: null };
  }
  if (type === 'person' && (rel === 'towing' || rel === 'vehicle' || rel === 'repair' || /\b(tow|towing|payload|hitch)\b/i.test(t))) {
    return { id: 'open', vocabKey: '', sourceTypes: defaultSourceTypes(type, adult), applied: 'unrelated-to-entity-type', re: null };
  }
  if (type === 'vehicle' || type === 'product') {
    if (rel === 'towing' || hits.some(f => f.id === 'capability') || /\bhitch\b/i.test(t)) {
      return { id: 'capability', vocabKey: 'towing', sourceTypes: ['manufacturer', 'spec', 'owner-report'], applied: rel === 'towing' ? 'cue' : 'inferred-capability', re: null };
    }
    const p = hits.find(f => f.id === 'documentation' || f.id === 'practice') || hits[0];
    if (p) return { ...p, applied: 'cue' };
    if (type === 'vehicle' && /ing\b/i.test(t)) {
      return { id: 'capability', vocabKey: '', sourceTypes: ['manufacturer', 'spec', 'review'], applied: 'morphology', re: null };
    }
    return { id: 'documentation', vocabKey: '', sourceTypes: ['manufacturer', 'spec', 'review'], applied: 'unknown', re: null };
  }
  if (rel && rel !== 'context' && rel !== 'object' && rel !== 'location' && rel !== 'hobby' && rel !== 'vehicle' && RELATION_VOCAB[rel]) {
    const fam = hits[0];
    return { id: (fam && fam.id) || rel, vocabKey: rel, sourceTypes: (fam && fam.sourceTypes) || defaultSourceTypes(type, adult), applied: 'cue', re: fam && fam.re };
  }
  if (hits[0]) return { ...hits[0], applied: 'cue' };
  return { id: 'open', vocabKey: '', sourceTypes: defaultSourceTypes(type, adult), applied: 'unknown', re: null };
}

function defaultSourceTypes(entityType, adult) {
  const adultOn = adult === 'on' || adult === 'both';
  if (entityType === 'person') return adultOn ? ['official-profile', 'interview', 'credits', 'public-media', 'contextual'] : ['official-site', 'interview', 'profile', 'productions', 'public-media'];
  if (entityType === 'vehicle' || entityType === 'product') return ['manufacturer', 'documentation', 'reviews', 'owner-reports', 'specifications'];
  if (entityType === 'skill' || entityType === 'technique') return ['tutorial', 'manual', 'educational-video', 'professional'];
  if (entityType === 'organization') return ['official', 'article'];
  return ['article', 'encyclopedia'];
}

function interpretConcept(rawTerm, entityType, adult) {
  const term = String(rawTerm || '').replace(/adult content/gi, ' ').replace(/\s+/g, ' ').trim();
  const type = String(entityType || '');
  const lens = normalizeAdult(adult);
  const adultOn = lens === 'on' || lens === 'both';
  if (!term) {
    return { term: '', family: 'none', aliases: [], related: [], broader: [], narrower: [], sourceTypes: [], production: [], interview: [], media: [], confidence: 'unknown', provenance: 'UNKNOWN', entityType: type, adult: lens };
  }
  const family = inferFamily(term, type, lens);
  let pack = (family.vocabKey && RELATION_VOCAB[family.vocabKey]) || {};
  if (type === 'person' && (family.vocabKey === 'towing' || family.id === 'capability') && family.vocabKey === 'towing') {
    pack = { related: [], production: [], interview: ['interview'], media: ['video'], specialist: [], org: [] };
  }
  const related = [];
  const add = (x, into) => {
    const s = String(x || '').trim();
    if (!s) return;
    if (s.toLowerCase() === term.toLowerCase()) return;
    if (into.indexOf(s) < 0) into.push(s);
  };
  for (const x of (pack.related || [])) add(x, related);
  for (const x of morphologicalNeighbors(term)) add(x, related);
  if (type === 'vehicle' || type === 'product') {
    if (family.id === 'capability' || family.vocabKey === 'towing') {
      ['tow rating', 'hitch', 'payload', 'tongue weight', 'trailer'].forEach(x => add(x, related));
    } else {
      ['spec', 'capacity', 'manual', 'review'].forEach(x => add(x, related));
    }
  }
  if (type === 'skill' || type === 'technique' || family.id === 'practice') {
    ['fabrication', 'installation', 'procedure', 'safety', 'tutorial'].forEach(x => add(x, related));
  }
  if (family.id === 'history' || type === 'topic') {
    ['history', 'terminology', 'overview'].forEach(x => add(x, related));
  }
  if (family.id === 'documentation') ['spec', 'manual', 'capacity'].forEach(x => add(x, related));
  const sourceTypes = [...new Set([...(family.sourceTypes || []), ...defaultSourceTypes(type, lens)])].slice(0, 6);
  const production = [...(pack.production || [])];
  const interview = [...(pack.interview || [])];
  const media = [...(pack.media || [])];
  if (type === 'person' && adultOn) {
    if (!interview.length) interview.push('interview', 'podcast');
    if (!production.length) production.push('credits', 'photoset');
    if (!media.length) media.push('gallery', 'video');
  } else if (type === 'person' && (family.id === 'interview' || family.vocabKey === 'interview')) {
    if (!interview.length) interview.push('interview', 'podcast');
  }
  if ((type === 'skill' || type === 'technique') && !media.length) media.push('video', 'diagram');
  if ((type === 'vehicle' || type === 'product') && !media.length) media.push('video');
  const confidence = family.applied === 'unknown' || family.id === 'open' ? 'inferred' : 'inferred';
  return {
    term,
    family: family.id,
    familyApplied: family.applied || '',
    aliases: morphologicalNeighbors(term).slice(0, 3),
    related: related.slice(0, 8),
    broader: family.vocabKey && family.vocabKey !== family.id ? [family.vocabKey] : [],
    narrower: [],
    sourceTypes,
    production: production.slice(0, 4),
    interview: interview.slice(0, 4),
    media: media.slice(0, 4),
    specialist: [...(pack.specialist || [])].slice(0, 4),
    org: [...(pack.org || [])].slice(0, 4),
    platformKinds: adultOn ? [...new Set(PLATFORM_IA.map(p => p.kind))] : [],
    confidence,
    provenance: term ? 'INFERRED' : 'UNKNOWN',
    knowledge: 'planning',
    entityType: type,
    adult: lens,
    visualLikenessIsNotIdentityProof: true,
  };
}

function interpretRequest(classification, customQuestion) {
  const c = classification || {};
  const type = c.type || '';
  const adult = c.adultContent || 'off';
  const extra = extraContext(c);
  const instruction = customQuestion ? parseInvestigativeQuestion(customQuestion, c) : null;
  const terms = [];
  const pushTerm = (t) => {
    const s = String(t || '').trim();
    if (!s || s.length < 2) return;
    if (terms.some(x => x.toLowerCase() === s.toLowerCase())) return;
    terms.push(s);
  };
  if (extra) extra.split(/[\/,&+|]| or /i).forEach(pushTerm);
  if (instruction && instruction.topic) pushTerm(instruction.topic);
  if (instruction && instruction.intent === 'interviews') pushTerm('interview');
  const concepts = terms.map(t => interpretConcept(t, type, adult));
  if (!concepts.length && (adult === 'on' || adult === 'both') && (type === 'person' || type === 'social' || type === 'ambiguous')) {
    concepts.push(interpretConcept('adult content', type, adult));
  }
  const nodes = concepts.map(x => ({ id: x.term, family: x.family, confidence: x.confidence, provenance: x.provenance }));
  const edges = [];
  for (const x of concepts) {
    for (const r of (x.related || []).slice(0, 4)) edges.push({ from: x.term, to: r, type: 'RELATED_TO', provenance: x.provenance });
    for (const a of (x.aliases || []).slice(0, 2)) edges.push({ from: x.term, to: a, type: 'ALIAS_OF', provenance: 'INFERRED' });
  }
  return { concepts, instruction, graph: { nodes, edges } };
}

function sourceEvidenceBlob(r) {
  if (!r || typeof r !== 'object') return '';
  return [r.title, r.snippet, r.description, r.textExcerpt, r.text]
    .filter(x => typeof x === 'string' && x)
    .join(' ')
    .toLowerCase();
}

function enrichConceptsFromEvidence(concepts, results) {
  const STOP = new Set('a an the of for to in on at by with from or and as is was are be this that into over about than then also known called related category glossary meaning wiki official site search videos photos watch free home page click here more strong exact match query tokens token possible confidence overlap ranking scorer reason kind host domain provider'.split(' '));
  const BLOCKED = /\b(teen|teens|underage|minor|loli|shota|child|preteen)\b/i;
  return (concepts || []).map(c => {
    const seed = String(c.term || '').toLowerCase();
    if (!seed) return c;
    const counts = new Map();
    for (const r of results || []) {
      const blob = sourceEvidenceBlob(r);
      if (!blob.includes(seed) && !(c.related || []).some(x => blob.includes(String(x).toLowerCase()))) continue;
      for (const w of blob.split(/[^a-z0-9+]+/)) {
        if (w.length < 4 || w === seed || STOP.has(w) || BLOCKED.test(w)) continue;
        counts.set(w, (counts.get(w) || 0) + 1);
      }
    }
    const observed = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
    const related = [...(c.related || [])];
    for (const w of observed) {
      if (!related.some(x => String(x).toLowerCase() === w)) related.push(w);
    }
    const seedSeen = (results || []).some(r => sourceEvidenceBlob(r).includes(seed));
    const evidenced = seedSeen && observed.length > 0;
    return {
      ...c,
      related: related.slice(0, 10),
      observedRelated: observed,
      provenance: evidenced ? 'OBSERVED' : (c.provenance || 'INFERRED'),
      confidence: evidenced ? 'observed' : (c.confidence || 'inferred'),
      knowledge: evidenced ? 'evidence' : (c.knowledge || 'planning'),
    };
  });
}

function mergeConceptKnowledge(prior, next) {
  const out = new Map();
  const put = (c) => {
    if (!c || !c.term) return;
    const k = String(c.term).toLowerCase();
    const prev = out.get(k);
    if (!prev) { out.set(k, { ...c }); return; }
    const priorObs = prev.knowledge === 'evidence' || prev.provenance === 'OBSERVED';
    const nextObs = c.knowledge === 'evidence' || c.provenance === 'OBSERVED';
    if (priorObs && !nextObs) {
      const related = [...(prev.related || [])];
      for (const w of (c.related || [])) if (!related.some(x => String(x).toLowerCase() === String(w).toLowerCase())) related.push(w);
      out.set(k, { ...c, ...prev, related: related.slice(0, 10), provenance: 'OBSERVED', knowledge: 'evidence', confidence: 'observed' });
      return;
    }
    const related = [...(c.related || [])];
    for (const w of (prev.related || [])) if (!related.some(x => String(x).toLowerCase() === String(w).toLowerCase())) related.push(w);
    out.set(k, { ...prev, ...c, related: related.slice(0, 10) });
  };
  for (const c of prior || []) put(c);
  for (const c of next || []) put(c);
  return [...out.values()];
}

function contextVocabulary(classification) {
  const extra = extraContext(classification);
  const rel = (classification && classification.relation) || '';
  const type = (classification && classification.type) || '';
  const adultLensEntity = type === 'person' || type === 'social' || type === 'ambiguous';
  let pack = RELATION_VOCAB[rel] || {};
  if ((type === 'skill' || type === 'technique') && (rel === 'towing' || rel === 'repair' || rel === 'vehicle')) {
    pack = RELATION_VOCAB.skill || {};
  }
  if (type === 'person' && (rel === 'towing' || rel === 'vehicle' || rel === 'repair')) {
    pack = {};
  }
  if (!adultLensEntity && (rel === 'adult' || (!extra && (classification && (classification.adultContent === 'on' || classification.adultContent === 'both'))))) {
    pack = {};
  }
  if ((type === 'vehicle' || type === 'product') && /\bhitch\b/i.test(extra) && !pack.related) {
    pack = RELATION_VOCAB.towing || pack;
  }
  const listed = splitContextConcepts(classification);
  const userTerms = listed.length
    ? listed.map(s => String(s).trim()).filter(s => s.length > 2 && !/^(and|the|for|with|adult|content)$/i.test(s))
    : extra
      ? extra.split(/[\/,&+|]| or /i).map(s => s.trim()).filter(s => s.length > 2 && !/^(and|the|for|with|adult|content)$/i.test(s))
      : [];
  const core = [...new Set(userTerms.length ? userTerms : (rel && rel !== 'adult' && rel !== 'context' ? [rel] : []))];
  const interpreted = (core.length ? core : (extra ? [extra] : [])).map(t => interpretConcept(t, classification && classification.type, classification && classification.adultContent));
  const fromConcepts = interpreted.flatMap(c => c.related || []);
  const exclude = new Set(core.map(t => String(t).toLowerCase()));
  const take = (arr) => (arr || []).filter(t => t && !exclude.has(String(t).toLowerCase()));
  const related = take([...(pack.related || []), ...fromConcepts]);
  return {
    core,
    related: [...new Set(related)].slice(0, 8),
    production: take([...(pack.production || []), ...interpreted.flatMap(c => c.production || [])]),
    interview: take([...(pack.interview || []), ...interpreted.flatMap(c => c.interview || [])]),
    media: take([...(pack.media || []), ...interpreted.flatMap(c => c.media || [])]),
    specialist: take([...(pack.specialist || []), ...interpreted.flatMap(c => c.specialist || [])]),
    org: take([...(pack.org || []), ...interpreted.flatMap(c => c.org || [])]),
    concepts: interpreted,
  };
}

function contextTermsForScore(classification) {
  const v = contextVocabulary(classification);
  return [...v.core, ...v.related].map(t => String(t).toLowerCase()).filter(t => t.length > 2);
}

function quoteName(s) {
  return '"' + String(s || '').replace(/"/g, '').trim() + '"';
}

function intersectionFormulations(subject, concept, classification) {
  const quoted = quoteName(subject);
  const extra = String(concept || '').trim();
  const type = (classification && classification.type) || '';
  const adult = (classification && classification.adultContent) || 'off';
  const adultOn = adult === 'on' || adult === 'both';
  const out = [];
  const add = (q) => {
    const t = String(q || '').trim();
    if (t && out.indexOf(t) < 0) out.push(t);
  };
  if (!extra) return out;
  add(quoted + ' ' + extra);
  if (type === 'person') {
    if (adultOn) {
      add(quoted + ' ' + extra + ' (photoset OR scene OR gallery OR video)');
      add(quoted + ' ' + extra + ' (credits OR filmography OR database)');
      add(quoted + ' ' + extra + ' (interview OR podcast OR feature)');
    } else {
      add(quoted + ' ' + extra + ' (interview OR article OR feature)');
      add(quoted + ' ' + extra + ' (work OR credits OR project)');
    }
  } else if (type === 'vehicle' || type === 'product') {
    add(quoted + ' ' + extra + ' (capacity OR spec OR rating OR manual)');
    add(quoted + ' ' + extra + ' (review OR owner OR test)');
  } else if (type === 'skill' || type === 'technique') {
    add(quoted + ' ' + extra + ' (tutorial OR "how to" OR procedure)');
    add(quoted + ' ' + extra + ' (install OR fabrication OR safety)');
  } else {
    add(quoted + ' ' + extra + ' (overview OR source OR article)');
  }
  return out;
}

function intersectionBroadenQueries(classification) {
  const subject = String((classification && classification.subject) || '').trim();
  const extra = extraContext(classification);
  const out = extra ? intersectionFormulations(subject, extra, classification) : [];
  const adult = (classification && classification.adultContent) || 'off';
  if ((adult === 'on' || adult === 'both') && extra) {
    for (const v of adultSemanticVariants(subject, extra)) out.push(v.q);
  }
  const vocab = contextVocabulary(classification);
  for (const t of (vocab.related || []).slice(0, 3)) {
    const q = quoteName(subject) + ' ' + t;
    if (out.indexOf(q) < 0) out.push(q);
  }
  return out.filter(Boolean);
}

function discoveryLanes(classification, depth) {
  const d = normalizeDepth(depth, classification);
  const subject = String((classification && classification.subject) || '').trim();
  const type = (classification && classification.type) || '';
  const adult = (classification && classification.adultContent) || 'off';
  const vocab = contextVocabulary(classification);
  const lanes = [];
  const add = (id, why, queries, kind) => {
    const qs = [...new Set((queries || []).map(q => String(q || '').trim()).filter(Boolean))];
    if (!qs.length) return;
    lanes.push({ id, why, queries: qs, kind: kind || 'web' });
  };
  if (!subject) return { depth: d, vocab, lanes };

  if (vocab.core.length) {
    const forms = [];
    for (const t of vocab.core) {
      for (const q of intersectionFormulations(subject, t, classification)) forms.push(q);
    }
    add('intersection', 'exact entity ∩ requested context across source types', [...new Set(forms)].slice(0, 4));
  } else if ((adult === 'on' || adult === 'both') && (type === 'person' || type === 'social' || type === 'ambiguous')) {
    add('intersection', 'entity in adult-industry public sources', adultSemanticVariants(subject, '').map(v => v.q).slice(0, 2));
  }

  const concepts = splitContextConcepts(classification);
  if (concepts.length >= 2) {
    add('entity', 'entity-only identity lane (concepts stay independent)', [quoteName(subject)]);
    add('pair', 'entity ∩ first two requested concepts independently', [quoteName(subject) + ' ' + concepts[0] + ' ' + concepts[1]]);
    for (const c of concepts.slice(0, 4)) {
      add('concept-' + String(c).replace(/\s+/g, '-').slice(0, 24), 'entity ∩ independent concept lane', [quoteName(subject) + ' ' + c]);
      add('solo-' + String(c).replace(/\s+/g, '-').slice(0, 24), 'independent concept lane without mixing other concepts', [String(c)]);
    }
  }

  const relatedCap = d === 'deep' ? 4 : d === 'contextual' ? 2 : 0;
  if (d !== 'broad') {
    if (vocab.interview.length) {
      add('interviews', 'interviews and discussions about the entity in this context', [quoteName(subject) + ' ' + (vocab.core[0] || '') + ' ' + vocab.interview[0]]);
    }
    if (vocab.specialist.length) {
      add('specialist', 'specialist publications and public databases', [quoteName(subject) + ' ' + vocab.specialist.slice(0, 2).join(' ') + (vocab.core[0] ? ' ' + vocab.core[0] : '')]);
    }
  }
  for (const t of vocab.related.slice(0, relatedCap)) {
    add('term-' + String(t).replace(/\s+/g, '-'), 'related terminology for the requested context', [quoteName(subject) + ' ' + t]);
  }
  const inferred = (vocab.concepts || []).filter(c => c && (c.family === 'open' || c.familyApplied === 'unknown'));
  if (inferred.length && d !== 'broad') {
    add('concept-sense', 'what the requested concept means in public sources', inferred.map(c => '"' + String(c.term).replace(/"/g, '') + '" (meaning OR glossary OR terminology OR "also called")').slice(0, 1));
  }

  if (d !== 'broad') {
    if (vocab.production.length) {
      const coreBit = vocab.core[0] ? vocab.core[0] + ' ' : '';
      add('productions', 'productions, credits, and project references', [quoteName(subject) + ' ' + coreBit + vocab.production.slice(0, 2).join(' ')]);
    }
  }
  const wantVisual = isVisualSubject(classification) || d !== 'broad';
  if (wantVisual) {
    const mediaTerms = [...vocab.core, ...vocab.media].filter(Boolean).slice(0, 2);
    const mediaQ = mediaTerms.length ? quoteName(subject) + ' ' + mediaTerms.join(' ') : quoteName(subject);
    add('images', 'visual corpus for a visually demonstrable subject', [mediaQ], 'image');
    add('videos', 'video corpus for a visually demonstrable subject', [mediaQ], 'video');
  }

  if (type === 'person') {
    if (adult === 'on') add('identity', 'entity identity in the active domain', [quoteName(subject) + ' (performer OR profile OR "official site")']);
    else add('identity', 'entity identity', [subject + ' official OR website OR profile', quoteName(subject)]);
  } else {
    add('identity', 'entity identity', [quoteName(subject)]);
  }

  if (d === 'deep' && vocab.org.length) {
    add('organizations', 'organizations associated with the requested context', [quoteName(subject) + ' ' + vocab.org[0] + (vocab.core[0] ? ' ' + vocab.core[0] : '')]);
    add('collaborators', 'people publicly associated with the entity in this context', [quoteName(subject) + ' ' + (vocab.core[0] || '') + ' (with OR directed OR studio)']);
  }
  if ((adult === 'on' || adult === 'both') && type === 'person' && lanes.length > 1) {
    const prefer = { intersection: 0, pair: 0.4, productions: 1, images: 2, videos: 3, interviews: 4, specialist: 5, collaborators: 6, organizations: 7 };
    lanes.sort((a, b) => {
      const ia = Object.prototype.hasOwnProperty.call(prefer, a.id) ? prefer[a.id] : (/^(term-|concept-)/.test(a.id) ? 0.6 : a.id === 'identity' ? 9 : 8);
      const ib = Object.prototype.hasOwnProperty.call(prefer, b.id) ? prefer[b.id] : (/^(term-|concept-)/.test(b.id) ? 0.6 : b.id === 'identity' ? 9 : 8);
      return ia - ib;
    });
  }
  return { depth: d, vocab, lanes };
}

function extractGraphLeads(retrieved, results, classification) {
  const subject = String((classification && classification.subject) || '').trim();
  const ctxTerms = contextTermsForScore(classification);
  const leads = [];
  const seen = new Set();
  const add = (kind, label, why, q) => {
    const clean = String(label || '').replace(/\s+/g, ' ').trim();
    if (!clean || clean.length < 3) return;
    if (subject && clean.toLowerCase() === subject.toLowerCase()) return;
    const key = (kind + '|' + clean).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    leads.push({ kind, label: clean.slice(0, 80), why, q: String(q || '').trim() });
  };
  const yearTitle = /\b([A-Z][A-Za-z0-9:'&.\-]*(?:\s+[A-Z][A-Za-z0-9:'&.\-]*){1,5})\s*\(((?:19|20)\d{2})\)/g;
  const quoted = /"([A-Z][^"]{6,70})"/g;
  const sources = [...(retrieved || [])];
  for (const r of results || []) {
    if (r && (r.textExcerpt || r.snippet)) {
      sources.push({
        title: r.title,
        url: r.url,
        textExcerpt: r.textExcerpt || r.snippet,
        identifiers: { aliases: r.aliases || [], handles: [], profiles: r.profiles || [] },
      });
    }
  }
  for (const page of sources) {
    const text = String(page.textExcerpt || page.text || page.description || '').slice(0, 8000);
    for (const a of (page.identifiers && page.identifiers.aliases) || []) {
      add('alias', a, 'Public alias observed on a retrieved source', quoteName(a) + (ctxTerms[0] ? ' ' + ctxTerms[0] : ''));
    }
    for (const h of (page.identifiers && page.identifiers.handles) || []) {
      add('handle', h, 'Public handle observed on a retrieved source', h);
    }
    let m;
    yearTitle.lastIndex = 0;
    while ((m = yearTitle.exec(text)) && leads.length < 18) {
      const title = m[1].trim();
      if (title.split(/\s+/).length < 2) continue;
      if (!/[a-z]/.test(title)) continue;
      if (/wikipedia|retrieved|official site|home page/i.test(title)) continue;
      add('production', title, 'Title/year observed on a retrieved source (' + m[2] + ')', quoteName(subject) + ' ' + quoteName(title));
    }
    quoted.lastIndex = 0;
    while ((m = quoted.exec(text)) && leads.length < 18) {
      const title = m[1].trim();
      const n = title.split(/\s+/).length;
      if (n < 2 || n > 8) continue;
      const nearby = text.slice(Math.max(0, m.index - 90), m.index + title.length + 90).toLowerCase();
      const contextNearby = !ctxTerms.length || ctxTerms.some(t => nearby.includes(t)) || /scene|film|video|photoset|feature|interview|episode|directed|studio/i.test(nearby);
      if (!contextNearby) continue;
      add('title', title, 'Quoted title observed near the requested context', quoteName(subject) + ' ' + quoteName(title));
    }
  }
  return leads.slice(0, 12);
}

function buildEntityIdentity(classification, retrieved, results, leads) {
  const aliases = new Set();
  const handles = new Set();
  const domains = new Set();
  for (const page of retrieved || []) {
    for (const a of (page.identifiers && page.identifiers.aliases) || []) aliases.add(a);
    for (const h of (page.identifiers && page.identifiers.handles) || []) handles.add(h);
    const host = hostOf(page.finalUrl || page.url).replace(/^www\./, '');
    if (host) domains.add(host);
  }
  for (const r of results || []) {
    for (const a of r.aliases || []) aliases.add(a);
    if (r.domain) domains.add(r.domain);
  }
  for (const l of leads || []) {
    if (l.kind === 'alias') aliases.add(l.label);
    if (l.kind === 'handle') handles.add(l.label);
  }
  return {
    canonicalName: (classification && classification.subject) || '',
    type: (classification && classification.type) || '',
    aliases: [...aliases].filter(Boolean).slice(0, 8),
    handles: [...handles].filter(Boolean).slice(0, 8),
    domains: [...domains].filter(Boolean).slice(0, 8),
  };
}

function isStockImage(url) {
  return typeof url === 'string' && STOCK_IMAGE_RE.test(url);
}

function intentClassFor(classification, raw) {
  const t = String((classification && classification.type) || '');
  if (classification && classification.isQuestion) return 'QUESTION';
  if (classification && classification.isUrl) return 'URL';
  if (t === 'person' || t === 'social') return 'PERSON';
  if (t === 'technique' || t === 'skill' || t === 'project') return 'OBJECT';
  if (t === 'clothing' || t === 'object' || t === 'product' || t === 'vehicle') return t === 'clothing' ? 'OBJECT' : (t === 'object' ? 'OBJECT' : 'OBJECT');
  if (t === 'visuals' || (classification && classification.relation === 'visual')) return 'VISUAL';
  if (QUESTION_LEAD_RE.test(String(raw || '')) || /\?\s*$/.test(String(raw || ''))) return 'QUESTION';
  if (t === 'website' || t === 'reddit') return 'URL';
  return 'TOPIC';
}

function looksLikePersonName(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  if (words.some(w => NON_NAME_TOKENS.test(w))) return false;
  if (OBJECT_ANCHOR_RE.test(text) || TECHNIQUE_WORD_RE.test(text)) return false;
  const head = words.slice(0, 2);
  if (head.every(w => CLOTHING_WORD_RE.test(w))) return false;
  return words.every(w => /^[A-Za-z][A-Za-z.'’-]*$/.test(w));
}

function classifyQuery(q, hint = '') {
  const split = splitSourceRestriction(q);
  const raw = split.text;
  const restrictedDomain = split.domain;
  const plus = plusSplitQuery(raw);
  const typeSource = plus.head || raw;
  const done = (obj) => {
    const attached = attachContext(raw, obj);
    if (restrictedDomain) attached.requestedSourceDomain = restrictedDomain;
    if (QUESTION_LEAD_RE.test(raw) || /\?\s*$/.test(raw)) attached.isQuestion = true;
    attached.intentClass = intentClassFor(attached, raw);
    return attached;
  };
  const hintMap = {
    person: 'person', topic: 'topic', website: 'website', claim: 'topic',
    product: 'product', position: 'technique', other: '', organization: 'organization',
    vehicle: 'vehicle', place: 'place', social: 'social', reddit: 'reddit',
    technique: 'technique', skill: 'skill', project: 'project', instruction: 'technique',
    clothing: 'clothing', garment: 'clothing', outfit: 'clothing', fashion: 'clothing',
    visuals: 'visuals', tutorial: 'tutorial', url: 'website', object: 'object',
    question: 'question',
  };
  const hinted = hintMap[String(hint || '').toLowerCase()] || '';
  if (!raw) return done({ type: 'unknown', confidence: 'low', reason: 'Empty query', isUrl: false });
  if (hinted === 'visuals') {
    return done({ type: 'visuals', confidence: 'medium', reason: 'Visual research focus', isUrl: false, relation: 'visual' });
  }
  if (hinted === 'object') {
    return done({ type: 'object', confidence: 'medium', reason: 'Object / technique research focus', isUrl: false, relation: 'object' });
  }
  if (hinted === 'question') {
    return done({ type: 'topic', confidence: 'medium', reason: 'Question-shaped research request', isUrl: false, isQuestion: true });
  }
  if (hinted === 'tutorial') {
    return done({ type: 'skill', confidence: 'medium', reason: 'Tutorial / instructional research focus', isUrl: false });
  }
  if (isObjectOrTechniquePhrase(typeSource) && hinted !== 'person') {
    return done({ type: 'technique', confidence: 'medium', reason: 'Looks like an object or technique, not a person', isUrl: false, relation: 'technique' });
  }
  const maybeUrl = /^https?:\/\//i.test(raw) || (/^[\w.-]+\.[a-z]{2,}([/:?]|$)/i.test(raw) && !/\s/.test(raw));
  if (maybeUrl) {
    const url = normalizeUrlForStore(raw.startsWith('http') ? raw : 'https://' + raw) || ('https://' + raw);
    const host = hostOf(url);
    const isImage = /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(url);
    if (/reddit\.com$/i.test(host) || host.endsWith('.reddit.com')) {
      return done({ type: 'reddit', confidence: 'high', reason: 'Direct Reddit URL', isUrl: true, url, isImage });
    }
    return done({ type: 'website', confidence: 'high', reason: 'Direct URL', isUrl: true, url, isImage });
  }
  const trailEarly = typeSource.match(TRAILING_CONTEXT_RE);
  if (trailEarly && !hinted) {
    const rel = detectRelation(trailEarly[1]) || detectRelation(typeSource);
    const head = typeSource.slice(0, typeSource.length - trailEarly[0].length).trim();
    const headWords = head.split(/\s+/).filter(Boolean);
    const headNameLike = headWords.length >= 2 && headWords.every(w => /^[A-Za-z][A-Za-z.'’-]*$/.test(w));
    const headLooksLikePerson = headNameLike && !hasVehicleCueIgnoringNameParticles(head) && !headWords.some(w => NON_NAME_TOKENS.test(w));
    if (head && hasVehicleCueIgnoringNameParticles(head) && headWords.length >= 2 && !headLooksLikePerson) {
      return done({ type: 'vehicle', confidence: 'medium', reason: 'Vehicle-like subject with a trailing context', isUrl: false });
    }
    if (head && (rel === 'towing' || rel === 'vehicle') && !headLooksLikePerson) {
      return done({ type: 'vehicle', confidence: 'medium', reason: 'Vehicle-like subject with a technical context', isUrl: false });
    }
    if (head && rel === 'repair' && !headLooksLikePerson && !/\b(weld|welding|woodwork|solder|plumbing|electrical|diy)\b/i.test(head)) {
      return done({ type: 'product', confidence: 'medium', reason: 'Product-like subject with a repair/service context', isUrl: false });
    }
  }
  if (TECHNIQUE_HINTS.has(hinted) || (TECHNIQUE_WORD_RE.test(typeSource) && !SKILL_WORD_RE.test(typeSource))) {
    return done({ type: 'technique', confidence: hinted ? 'medium' : 'medium', reason: 'Looks like a technique, position, or instructional form', isUrl: false });
  }
  if (SKILL_HINTS.has(hinted) || ((SKILL_WORD_RE.test(typeSource) || /\bhow to\b/i.test(typeSource)) && !['person', 'product', 'vehicle', 'organization', 'clothing'].includes(hinted))) {
    return done({ type: hinted === 'project' ? 'project' : 'skill', confidence: 'medium', reason: 'Looks like a skill, craft, or project to learn', isUrl: false });
  }
  if (OBJECT_ANCHOR_RE.test(typeSource) && !looksLikePersonName(typeSource) && !['person', 'product', 'vehicle', 'organization'].includes(hinted)) {
    const clothingHit = CLOTHING_WORD_RE.test(typeSource);
    return done({
      type: clothingHit ? 'clothing' : 'technique',
      confidence: 'medium',
      reason: clothingHit ? 'Looks like a garment or wearable object, not a person' : 'Looks like an object or technique, not a person',
      isUrl: false,
      relation: clothingHit ? 'clothing' : 'technique',
    });
  }
  if (CLOTHING_HINTS.has(hinted) || (CLOTHING_WORD_RE.test(typeSource) && !SKILL_WORD_RE.test(typeSource))) {
    const words = typeSource.split(/\s+/).filter(Boolean);
    const garmentish = (w) => CLOTHING_WORD_RE.test(w) || /^(red|blue|black|white|green|navy|grey|gray|brown|pink|gold|silver|purple|cream|ivory|olive|maroon|burgundy|teal|beige|khaki|wool|silk|cotton|leather|denim|linen|cashmere|suede|velvet|satin|long|short|mini|maxi|midi|vintage|oversized|slim|fitted|tailored)$/i.test(w);
    const allGarmentish = words.length > 0 && words.every(garmentish);
    const headName = words.length >= 2 && words.slice(0, 2).every(w => /^[A-Z][A-Za-z.'’-]*$/.test(w)) && !hasVehicleCueIgnoringNameParticles(words.slice(0, 2).join(' ')) && !words.slice(0, 2).some(w => NON_NAME_TOKENS.test(w));
    if (hinted === 'clothing' || allGarmentish || !headName) {
      return done({ type: 'clothing', confidence: hinted ? 'medium' : 'medium', reason: 'Looks like a garment, outfit, or clothing query', isUrl: false });
    }
  }
  if (/^@[\w.]+/.test(typeSource) || /\b(instagram|tiktok|onlyfans|twitter|linkedin)\b/i.test(typeSource)) {
    return done({ type: 'social', confidence: 'medium', reason: 'Looks like a social handle or profile query', isUrl: false });
  }
  if (/\b(reddit|r\/[a-z0-9_]+)/i.test(typeSource)) {
    return done({ type: hinted || 'reddit', confidence: 'medium', reason: 'Reddit/community query', isUrl: false });
  }
  if (/\b(inc|llc|corp|company|university|hospital|foundation)\b/i.test(typeSource)) {
    return done({ type: 'organization', confidence: 'medium', reason: 'Organization language in the query', isUrl: false });
  }
  if (/\b(19|20)\d{2}\b/.test(typeSource) && /\b(toyota|honda|ford|chevy|chevrolet|nissan|bmw|runner|civic|f-?150|mustang|iphone|ipad)\b/i.test(typeSource)) {
    return done({ type: 'vehicle', confidence: 'medium', reason: 'Year + vehicle/product tokens', isUrl: false });
  }
  if (/\b(iphone|ipad|pixel \d|playstation|xbox|macbook)\b/i.test(typeSource)) {
    return done({ type: 'product', confidence: 'medium', reason: 'Product-like query', isUrl: false });
  }
  const known = resolveKnownEntity(raw) || resolveKnownEntity(typeSource);
  if (known && known.type === 'website') {
    return done({ type: 'website', confidence: 'high', reason: 'Resolved known site/entity (' + (known.aliases[0] || known.domain) + ' → ' + known.domain + ')', isUrl: false, resolvedDomain: known.domain, resolvedEntity: known.id });
  }
  const words = typeSource.split(/\s+/);
  const nameLike = looksLikePersonName(typeSource);
  const looksLikeProductPhrase = words.some(w => NON_NAME_TOKENS.test(w));
  if (nameLike && looksLikeProductPhrase && !hinted) {
    return done({ type: 'topic', confidence: 'low', reason: 'Phrase looks like a product/topic, not a personal name', isUrl: false });
  }
  if (nameLike && (!hinted || hinted === 'person') && !looksLikeProductPhrase) {
    if (!hinted && hasVehicleCueIgnoringNameParticles(typeSource)) {
      return done({ type: 'vehicle', confidence: 'medium', reason: 'Vehicle cues in the query', isUrl: false });
    }
    const last = words[words.length - 1];
    const familyCue = STRUCTURAL_FAMILIES.some(f => f.re.test(last));
    if (familyCue && words.length === 2 && !hinted) {
      return done({ type: 'topic', confidence: 'low', reason: 'Unknown subject with a conceptual context', isUrl: false });
    }
    return done({ type: 'person', confidence: words.length === 1 ? 'low' : 'medium', reason: 'Name-like query — treating as a person candidate search', isUrl: false });
  }
  if (words.length === 1 && /^[A-Za-z]{2,}$/.test(typeSource)) {
    return done({ type: hinted || 'ambiguous', confidence: 'low', reason: 'Single token — many people/entities could match', isUrl: false });
  }
  if (hinted) return done({ type: hinted, confidence: 'medium', reason: 'Using the selected subject type as a search hint', isUrl: false });
  return done({ type: 'topic', confidence: 'low', reason: 'Treated as a topic/query, not a specific named entity', isUrl: false });
}

function researchPaths(type, classification) {
  const t = String(type || 'topic');
  const paths = {
    person: [
      { id: 'identity', label: 'Identity & aliases' },
      { id: 'images', label: 'Images & visual sources' },
      { id: 'videos', label: 'Videos' },
      { id: 'presence', label: 'Public web presence' },
      { id: 'premium', label: 'Premium Content' },
      { id: 'timeline', label: 'Timeline' },
      { id: 'related', label: 'Related people' },
      { id: 'entities', label: 'Related entities' },
      { id: 'sources', label: 'Sources' },
      { id: 'evidence', label: 'Evidence' },
      { id: 'leads', label: 'Leads' },
      { id: 'questions', label: 'Questions to investigate' },
    ],
    product: [
      { id: 'overview', label: 'Overview' },
      { id: 'specs', label: 'Specifications' },
      { id: 'variants', label: 'Models & variants' },
      { id: 'images', label: 'Images' },
      { id: 'videos', label: 'Videos' },
      { id: 'reviews', label: 'Reviews' },
      { id: 'pricing', label: 'Pricing & history' },
      { id: 'manuals', label: 'Manuals & documents' },
      { id: 'alternatives', label: 'Alternatives' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'Questions' },
    ],
    vehicle: [
      { id: 'overview', label: 'Overview' },
      { id: 'specs', label: 'Specifications' },
      { id: 'variants', label: 'Years & generations' },
      { id: 'images', label: 'Images' },
      { id: 'videos', label: 'Videos' },
      { id: 'issues', label: 'Common issues' },
      { id: 'reviews', label: 'Reviews' },
      { id: 'manuals', label: 'Manuals' },
      { id: 'maintenance', label: 'Maintenance & parts' },
      { id: 'alternatives', label: 'Alternatives' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'Questions' },
    ],
    technique: [
      { id: 'what', label: 'What this is' },
      { id: 'terms', label: 'Terminology' },
      { id: 'visuals', label: 'Visual references' },
      { id: 'variations', label: 'Variations' },
      { id: 'tutorials', label: 'Tutorials' },
      { id: 'videos', label: 'Videos' },
      { id: 'sources', label: 'Sources' },
      { id: 'related', label: 'Related techniques' },
      { id: 'questions', label: 'Questions' },
    ],
    skill: [
      { id: 'goal', label: 'What you are trying to accomplish' },
      { id: 'concepts', label: 'Concepts' },
      { id: 'materials', label: 'Materials' },
      { id: 'tools', label: 'Tools' },
      { id: 'steps', label: 'Steps' },
      { id: 'measurements', label: 'Measurements' },
      { id: 'techniques', label: 'Techniques' },
      { id: 'videos', label: 'Videos' },
      { id: 'variations', label: 'Variations' },
      { id: 'safety', label: 'Safety considerations' },
      { id: 'trouble', label: 'Troubleshooting' },
      { id: 'tutorials', label: 'Tutorials' },
      { id: 'related', label: 'Related projects' },
      { id: 'sources', label: 'References' },
    ],
    project: [
      { id: 'goal', label: 'What you are trying to accomplish' },
      { id: 'concepts', label: 'Concepts' },
      { id: 'materials', label: 'Materials' },
      { id: 'tools', label: 'Tools' },
      { id: 'steps', label: 'Steps' },
      { id: 'measurements', label: 'Measurements' },
      { id: 'techniques', label: 'Techniques' },
      { id: 'videos', label: 'Videos' },
      { id: 'variations', label: 'Variations' },
      { id: 'safety', label: 'Safety considerations' },
      { id: 'trouble', label: 'Troubleshooting' },
      { id: 'tutorials', label: 'Tutorials' },
      { id: 'related', label: 'Related projects' },
      { id: 'sources', label: 'References' },
    ],
    place: [
      { id: 'overview', label: 'Overview' },
      { id: 'location', label: 'Location & context' },
      { id: 'images', label: 'Images' },
      { id: 'related', label: 'Related places & entities' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'Questions' },
    ],
    social: [
      { id: 'identity', label: 'Identity & handles' },
      { id: 'images', label: 'Images' },
      { id: 'videos', label: 'Videos' },
      { id: 'presence', label: 'Public presence' },
      { id: 'related', label: 'Related accounts & entities' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'Questions' },
    ],
    clothing: [
      { id: 'visuals', label: 'Visual references' },
      { id: 'identification', label: 'Garment identification' },
      { id: 'fit', label: 'Fit & sizing' },
      { id: 'measurements', label: 'Measurements' },
      { id: 'materials', label: 'Materials & construction' },
      { id: 'similar', label: 'Similar garments' },
      { id: 'videos', label: 'Videos' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'Questions' },
    ],
    organization: [
      { id: 'overview', label: 'Overview' },
      { id: 'official', label: 'Official presence' },
      { id: 'people', label: 'Public people & roles' },
      { id: 'history', label: 'History' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'Questions' },
    ],
    website: [
      { id: 'page', label: 'This page' },
      { id: 'site', label: 'Site context' },
      { id: 'images', label: 'Images' },
      { id: 'related', label: 'Related public pages' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'Questions' },
    ],
    reddit: [
      { id: 'thread', label: 'Thread context' },
      { id: 'claims', label: 'Claims in discussion' },
      { id: 'sources', label: 'Linked sources' },
      { id: 'questions', label: 'What still needs checking' },
    ],
    topic: [
      { id: 'overview', label: 'Overview' },
      { id: 'definitions', label: 'Definitions' },
      { id: 'history', label: 'History' },
      { id: 'evidence', label: 'Evidence' },
      { id: 'related', label: 'Related concepts' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'Questions' },
    ],
    ambiguous: [
      { id: 'interpretations', label: 'Possible interpretations' },
      { id: 'candidates', label: 'Candidate matches' },
      { id: 'sources', label: 'Sources' },
      { id: 'questions', label: 'How to disambiguate' },
    ],
  };
  let list = paths[t] || paths.topic;
  const extra = extraContext(classification);
  if (classification && (extra || classification.adultContent === 'on' || classification.adultContent === 'both')) {
    const have = new Set(list.map(p => p.id));
    const more = [];
    if (extra && !have.has('context')) more.push({ id: 'context', label: 'Requested context' });
    if (t === 'person') {
      if (!have.has('career')) more.push({ id: 'career', label: 'Career & credits' });
      if (!have.has('projects')) more.push({ id: 'projects', label: 'Projects & productions' });
      if (!have.has('interviews')) more.push({ id: 'interviews', label: 'Interviews & features' });
      if (!have.has('organizations')) more.push({ id: 'organizations', label: 'Organizations' });
      if (!have.has('premium')) more.push({ id: 'premium', label: 'Premium Content' });
    }
    if (more.length) list = list.concat(more);
  }
  return list;
}

function inferPathsFromQuestion(question, allPaths) {
  const t = String(question || '').toLowerCase();
  if (!t) return [];
  const available = new Set((allPaths || []).map(p => p.id));
  const out = [];
  const rules = [
    [/image|photo|visual|picture|gallery|pic\b|portrait/, ['images', 'visuals']],
    [/video|youtube|interview|clip|watch|footage/, ['videos']],
    [/timeline|history|when|chronolog|date/, ['timeline', 'history']],
    [/identity|alias|who is|real name|handle/, ['identity']],
    [/presence|website|profile|social|official/, ['presence', 'official']],
    [/related|other people|connected|associated|connecting|collaborat/, ['related', 'entities']],
    [/interview|podcast|discuss|talks about|q\s*&\s*a/, ['interviews', 'videos']],
    [/credit|filmography|production|photoset|scene/, ['projects', 'career']],
    [/tutorial|how to|learn|teach|instruct|procedure|steps/, ['tutorials', 'steps']],
    [/tool|material|part|supply/, ['tools', 'materials']],
    [/safety|hazard|ppe/, ['safety']],
    [/spec|measurement|dimension/, ['specs', 'measurements']],
    [/source|citation|evidence|reference/, ['sources', 'evidence']],
    [/variation|variant|model|generation/, ['variations', 'variants']],
    [/term|definition|what is this|meaning/, ['what', 'terms', 'definitions']],
    [/review|rating|complaint/, ['reviews']],
    [/price|pricing|cost|history of/, ['pricing']],
    [/issue|problem|common (fault|fail)/, ['issues', 'trouble']],
    [/concept|theory|explained/, ['concepts']],
    [/clothing|wearing|outfit|dress/, ['images', 'visuals']],
  ];
  for (const [re, ids] of rules) {
    if (!re.test(t)) continue;
    for (const id of ids) if (available.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

function parseInvestigativeQuestion(question, classification) {
  const raw = String(question || '').trim();
  const out = { topic: '', intent: '', paths: [], variants: [], why: '' };
  if (!raw) return out;
  const subject = String((classification && classification.subject) || '').trim();
  const restrictedDomain = extractRequestedSourceDomain(raw);
  const stripped = raw.replace(/\b[a-z0-9.-]+\.[a-z]{2,}\b/gi, ' ').replace(/\bsite\s*:/gi, ' ');
  const t = stripped.toLowerCase();
  let topic = '';
  const quoted = raw.match(/[“"]([^"”]{2,80})[”"]/);
  if (quoted) topic = quoted[1].trim();
  const extractors = [
    /(?:discuss(?:es|ed)?|talks?\s+about|speaking about|mentions?)\s+(.+)$/i,
    /(?:connecting(?:\s+this person|\s+them|\s+him|\s+her)?\s+to|connection to|involving|related to)\s+(.+)$/i,
    /(?:sources?\s+(?:on|about|involving|for)|everything\s+(?:on|about|connecting)|find\s+(?:everything|all|sources?))\s+(?:on |about |involving |connecting(?:\s+this person)?\s+to )?(.+)$/i,
    /(?:interviews?\s+(?:where|about|on|with))\s+(.+)$/i,
    /(?:show|find)\s+sources?\s+(?:involving|about|on)\s+(.+)$/i,
  ];
  if (!topic) {
    for (const re of extractors) {
      const m = stripped.match(re) || raw.match(re);
      if (m && m[1]) {
        topic = m[1].replace(/[.?!]+$/, '').replace(/^["“]|["”]$/g, '').trim();
        break;
      }
    }
  }
  if (subject && topic) {
    const esc = subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    topic = topic.replace(new RegExp(esc, 'ig'), ' ').replace(/\b(she|he|they|her|him|them|this person)\b/ig, ' ').replace(/\s+/g, ' ').trim();
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(topic) || (restrictedDomain && topic.toLowerCase().replace(/^www\./, '') === restrictedDomain)) {
    topic = '';
  }
  if (topic.length > 72) topic = topic.slice(0, 72).trim();
  topic = topic
    .replace(/^(?:what|how|why|when|where|who)\s+(?:are|is|were|was|do|does|did|can|the)?\s*/i, '')
    .replace(/^(?:the\s+)?(?:public\s+)?(?:facts?|information|info|details)\b(?:\s+(?:about|on|for))?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(?:public facts?|facts?|information|info|details?|everything|all|sources?|find|show|tell|give)$/i.test(topic)) topic = '';
  if (restrictedDomain && !/interview|podcast|discuss|photo|image|video|clip|connect|related/i.test(t)) {
    out.intent = 'sources';
    out.paths.push('sources', 'evidence');
  } else if (/interview|podcast|discuss|q\s*&\s*a|talks?\b/.test(t)) {
    out.intent = 'interviews';
    out.paths.push('interviews', 'videos');
  } else if (/photo|image|visual|picture|gallery|portrait/.test(t)) {
    out.intent = 'images';
    out.paths.push('images');
  } else if (/video|clip|watch|footage/.test(t)) {
    out.intent = 'videos';
    out.paths.push('videos');
  } else if (/connect|related|people|collaborat|network|who (?:else|worked)/.test(t)) {
    out.intent = 'relationships';
    out.paths.push('related', 'entities', 'organizations');
  } else if (/source|citation|evidence|document/.test(t)) {
    out.intent = 'sources';
    out.paths.push('sources', 'evidence');
  } else if (/credit|filmography|production|work|title/.test(t)) {
    out.intent = 'work';
    out.paths.push('projects', 'career');
  } else {
    out.intent = 'directed';
    out.paths.push('context', 'sources');
  }
  out.topic = topic;
  const sub = subject.replace(/"/g, '');
  const quotedSub = sub ? '"' + sub + '"' : '';
  const add = (q, why) => { if (q && !out.variants.some(v => v.q === q)) out.variants.push({ q, why }); };
  if (quotedSub && topic) {
    if (out.intent === 'interviews') {
      add(quotedSub + ' interview "' + topic + '"', 'interviews about the requested topic');
      add(quotedSub + ' "' + topic + '" (interview OR podcast OR feature)', 'features discussing the topic');
    } else if (out.intent === 'relationships') {
      add(quotedSub + ' "' + topic + '" (with OR and OR collaboration)', 'connection to the requested topic');
    } else if (out.intent === 'images') {
      add(quotedSub + ' "' + topic + '" (photo OR image OR gallery)', 'visuals for the requested topic');
    } else if (out.intent === 'videos') {
      add(quotedSub + ' "' + topic + '" (video OR clip)', 'videos for the requested topic');
    } else {
      add(quotedSub + ' "' + topic + '"', 'directed research on the requested topic');
      add(quotedSub + ' ' + topic + ' (source OR article OR feature)', 'sources involving the topic');
    }
  } else if (quotedSub && out.intent === 'interviews') {
    add(quotedSub + ' interview OR podcast OR feature', 'interview sources');
  } else if (quotedSub && topic) {
    add(quotedSub + ' "' + topic + '"', 'directed research on the requested topic');
  }
  if (quotedSub && restrictedDomain) add(quotedSub + ' site:' + restrictedDomain, 'user-requested source domain');
  out.why = out.intent + (topic ? (': ' + topic) : (restrictedDomain ? (': site:' + restrictedDomain) : ''));
  return out;
}

function visualCandidatesFor(ranked, classification) {
  if (!classification || classification.type !== 'person') return [];
  const pri = (k) => ({ VISUAL_ENTITY_MATCH: 6, ENTITY_MATCH: 5, INTERSECTION_MATCH: 4, INTERVIEW_MATCH: 4, MEDIA_MATCH: 3, RELATIONSHIP_MATCH: 2 }[k] || 0);
  const out = [];
  const seen = new Set();
  const subject = classification.subject || '';
  for (const r of ranked || []) {
    if (!r) continue;
    if (r.resultKind === 'AGGREGATOR' || r.resultKind === 'JUNK' || r.resultKind === 'WEAK_MATCH') continue;
    if (GENERIC_BIO_HOST_RE.test(hostOf(r.url))) continue;
    const grade = visualIdentityGrade(r, subject, { identityFeedback: classification.identityFeedback || {} });
    if (grade.excludeFromPrimaryCorpus || grade.collision || grade.firstNameOnly) continue;
    const imgs = [...new Set([r.image, ...(r.images || [])].filter(Boolean))];
    if (!imgs.length) continue;
    const key = (r.domain || '') + '|' + imgs[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, identityGrade: grade.grade, identityConfidence: grade.identityConfidence || grade.grade });
  }
  out.sort((a, b) => pri(b.resultKind) - pri(a.resultKind) || (b.score || 0) - (a.score || 0));
  return out.slice(0, 6);
}


function entityIdFor(type, name) {
  const t = String(type || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return n ? ('entity:' + (t || 'unknown') + ':' + n) : '';
}

function discoveryEvidenceFrom(item) {
  if (!item || typeof item !== 'object') return null;
  const url = String(item.url || item.pageUrl || '').trim();
  const image = item.image || ((item.images || [])[0]) || '';
  if (!url && !image) return null;
  return {
    url,
    domain: item.domain || hostOf(url),
    title: String(item.title || ''),
    snippet: String(item.snippet || ''),
    source: String(item.source || ''),
    image,
    images: [...new Set([item.image, ...(item.images || [])].filter(Boolean))].slice(0, 8),
    resultKind: item.resultKind || '',
    provenance: item.provenance || 'DISCOVERED',
    reason: item.reason || '',
    observedAt: item.observedAt || '',
  };
}

function extractRequestedSourceDomain(question) {
  const q = String(question || '').trim();
  if (!q) return '';
  const site = q.match(/\bsite\s*:\s*([a-z0-9.-]+\.[a-z]{2,})\b/i);
  if (site) return site[1].toLowerCase().replace(/^www\./, '');
  const patterns = [
    /\bonly\s+look\s+at\s+sources?\s+(?:on|from|at)\s+([a-z0-9.-]+\.[a-z]{2,})\b/i,
    /\bonly\s+use\s+sources?\s+(?:on|from|at)\s+([a-z0-9.-]+\.[a-z]{2,})\b/i,
    /\bsearch\s+only\s+(?:on\s+|from\s+|at\s+)?([a-z0-9.-]+\.[a-z]{2,})\b/i,
    /\brestrict(?:\s+results)?\s+to\s+([a-z0-9.-]+\.[a-z]{2,})\b/i,
    /\bonly\s+search\s+(?:this\s+domain:?\s+)?([a-z0-9.-]+\.[a-z]{2,})\b/i,
    /\buse\s+only\s+([a-z0-9.-]+\.[a-z]{2,})\b/i,
    /\bsources?\s+(?:on|from|at)\s+([a-z0-9.-]+\.[a-z]{2,})\s+only\b/i,
    /\bonly\s+(?:on|from|at)\s+([a-z0-9.-]+\.[a-z]{2,})\b/i,
    /\bonly\s+this\s+domain:?\s+([a-z0-9.-]+\.[a-z]{2,})\b/i,
  ];
  for (const re of patterns) {
    const m = q.match(re);
    if (m && m[1]) return m[1].toLowerCase().replace(/^www\./, '');
  }
  return '';
}

function splitSourceRestriction(q) {
  const raw = String(q || '').trim();
  const domain = extractRequestedSourceDomain(raw);
  if (!domain) return { text: raw, domain: '' };
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let text = raw
    .replace(new RegExp('\\bsite\\s*:\\s*(?:www\\.)?' + escaped + '\\b', 'ig'), ' ')
    .replace(new RegExp('\\bonly\\s+look\\s+at\\s+sources?\\s+(?:on|from|at)\\s+(?:www\\.)?' + escaped + '\\b', 'ig'), ' ')
    .replace(new RegExp('\\bonly\\s+use\\s+sources?\\s+(?:on|from|at)\\s+(?:www\\.)?' + escaped + '\\b', 'ig'), ' ')
    .replace(new RegExp('\\bsearch\\s+only\\s+(?:on\\s+|from\\s+|at\\s+)?(?:www\\.)?' + escaped + '\\b', 'ig'), ' ')
    .replace(new RegExp('\\brestrict(?:\\s+results)?\\s+to\\s+(?:www\\.)?' + escaped + '\\b', 'ig'), ' ')
    .replace(new RegExp('\\bonly\\s+search\\s+(?:this\\s+domain:?\\s+)?(?:www\\.)?' + escaped + '\\b', 'ig'), ' ')
    .replace(new RegExp('\\buse\\s+only\\s+(?:www\\.)?' + escaped + '\\b', 'ig'), ' ')
    .replace(new RegExp('\\bsources?\\s+(?:on|from|at)\\s+(?:www\\.)?' + escaped + '\\s+only\\b', 'ig'), ' ')
    .replace(new RegExp('\\bonly\\s+(?:on|from|at)\\s+(?:www\\.)?' + escaped + '\\b', 'ig'), ' ')
    .replace(new RegExp('\\bonly\\s+this\\s+domain:?\\s+(?:www\\.)?' + escaped + '\\b', 'ig'), ' ')
    .replace(new RegExp('\\b(?:www\\.)?' + escaped + '\\b', 'ig'), ' ')
    .replace(/[.,;:]+$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { text: text || raw, domain };
}

function userAskedForSourceRestriction(question) {
  return !!extractRequestedSourceDomain(question);
}

function diveSeedQuery(classification, originalQuery, canonical, fallbackQuery) {
  const name = String(canonical || (classification && classification.subject) || '').trim();
  const orig = String(originalQuery || '').trim();
  const fb = String(fallbackQuery || '').trim();
  const ctx = extraContext(classification);
  const isUrl = (s) => /^https?:\/\//i.test(s);
  // Never seed Deep Dive with an identifying URL or a page-title fallback.
  // Entity × topic must survive: a bare person name still carries the topic.
  const base = (orig && !isUrl(orig))
    ? orig
    : ((fb && !isUrl(fb) && !/\s\|\s/.test(fb)) ? fb : name);
  if (!base || isUrl(base)) return name || orig || fb;
  return composeInvestigationQuery(base, name, ctx) || name || base;
}

function diveExpansionQueries(opts) {
  opts = opts || {};
  const classification = opts.classification || {};
  const seed = String(opts.seed || classification.subject || '').trim();
  const extra = [];
  const add = (q) => {
    const t = String(q || '').trim();
    if (t && extra.indexOf(t) < 0) extra.push(t);
  };
  const subject = String(classification.subject || seed || '').replace(/"/g, '');
  const quoted = subject ? ('"' + subject + '"') : '';
  const instruction = opts.instruction || { variants: [] };
  const adult = classification.adultContent || opts.adult || 'off';
  const adultOnPerson = (adult === 'on' || adult === 'both') && classification.type === 'person';
  const selectedPaths = opts.selectedPaths || [];
  const selectedIds = opts.selectedIds instanceof Set ? opts.selectedIds : new Set((selectedPaths || []).map(p => p && p.id).filter(Boolean));
  const resolvedAll = opts.resolvedAll === true;
  const expanded = opts.expanded === true;
  const identifiers = opts.identifiers || { handles: [] };
  const evidenceHost = String(opts.evidenceHost || '').replace(/^www\./, '');
  const customQuestion = opts.customQuestion || '';
  const extraCtx = extraContext(classification);

  if (adultOnPerson) {
    for (const v of adultSemanticVariants(subject, extraCtx)) add(v.q);
  }
  for (const v of instruction.variants || []) add(v.q);
  if (!adultOnPerson && quoted) add(quoted);
  if (classification.type === 'person' && quoted && !adultOnPerson) add(quoted + ' (profile OR official OR website)');
  if (classification.context) {
    add(quoted + ' ' + classification.context);
    const syn = contextualSynonyms(classification.context, classification.relation);
    if (syn) add(quoted + ' ' + syn);
  }
  if (classification.type === 'technique') add(seed + ' tutorial OR diagram');
  if (classification.type === 'technique' || classification.type === 'object' || classification.intentClass === 'OBJECT') {
    for (const v of conceptDiscoveryQueries(classification.subject || seed, classification, extra, { force: true })) add(v.q);
  }
  if (classification.type === 'person') {
    for (const v of identityVariantQueries(classification, { canonicalName: subject, aliases: identifiers.handles || [] }, extraCtx, extra)) add(v.q);
    for (const v of visualInvestigationQueries(classification, [], extra, { identity: { canonicalName: subject } })) add(v.q);
  }
  if (classification.type === 'skill' || classification.type === 'project') add(seed + ' procedure OR safety');
  if (classification.type === 'clothing') {
    add(quoted + ' (lookbook OR outfit OR fabric OR fit OR sizing)');
    add(imageSearchQuery(classification.subject || seed, classification));
  }
  if (classification.type === 'product' || classification.type === 'vehicle') add(quoted + ' (official OR spec OR manual OR review)');
  if (classification.type === 'organization') add(quoted + ' (official OR about OR website)');
  for (const v of pathSearchVariants(seed, selectedPaths, classification)) add(v.q);
  const graph = discoveryLanes(classification, opts.depth || classification.researchDepth);
  for (const lane of graph.lanes) {
    if (lane.kind === 'web') {
      for (const q of lane.queries || []) add(q);
    }
  }
  add(seed + ' reddit');
  if (expanded || selectedIds.has('images') || selectedIds.has('visuals') || resolvedAll) {
    add(imageSearchQuery(classification.subject || seed, classification));
  }
  if (expanded || selectedIds.has('videos') || resolvedAll) {
    add((classification.subject || seed) + (adultOnPerson ? ' video OR scene OR clip' : ' youtube OR video OR interview'));
  }
  for (const h of (identifiers.handles || []).slice(0, 2)) add(h);
  const requestedDomain = extractRequestedSourceDomain(customQuestion);
  if (requestedDomain) {
    add(quoted + ' site:' + requestedDomain);
  }
  if (adultOnPerson && quoted) add(quoted);
  return extra;
}

function retrieveBatchPlan(opts) {
  opts = opts || {};
  const prior = Array.isArray(opts.priorRetrieved) ? opts.priorRetrieved : [];
  const seen = new Set();
  for (const x of prior) {
    const u = typeof x === 'string' ? x : (x && (x.url || x.finalUrl));
    if (u) seen.add(u);
  }
  (opts.seenUrls || []).forEach(u => { if (u) seen.add(u); });
  const cap = Math.max(1, Number(opts.batchCap) || 6);
  const queue = [...new Set([...(opts.pendingUrls || []), ...(opts.queue || [])])].filter(u => u && !seen.has(u));
  return { next: queue.slice(0, cap), remaining: queue.slice(cap), skip: [...seen], batchCap: cap };
}

function nameOnIdentitySurface(item, nameTokens) {
  const title = String((item && item.title) || '').toLowerCase();
  const url = String((item && item.url) || '').toLowerCase();
  const toks = (nameTokens || []).filter(t => String(t).length > 2);
  if (!toks.length) return false;
  return toks.every(t => title.includes(String(t).toLowerCase()) || url.includes(String(t).toLowerCase()));
}

function pickIdentityCandidate(ranked, classification) {
  const rows = ranked || [];
  const nameTokens = String((classification && classification.subject) || '').toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const usable = rows.filter(r => r && r.resultKind !== 'JUNK' && r.resultKind !== 'AGGREGATOR');
  const full = usable.filter(r => nameOnIdentitySurface(r, nameTokens));
  if (full.length) return full[0];
  return usable[0] || rows[0] || null;
}

function identityIsAmbiguous(ranked, classification, extras) {
  const verdict = competingIdentityCandidates(ranked, classification, extras || {});
  return !!verdict.ambiguous;
}

function diveRetrievalQueue(opts) {
  opts = opts || {};
  const cap = opts.retrieveCap || 6;
  const overflow = Math.max(Number(cap) * 3, 18);
  const adult = opts.adult || 'off';
  const evidenceUrl = opts.evidenceUrl || '';
  const evidenceHost = hostOf(evidenceUrl).replace(/^www\./, '');
  const out = [];
  const seen = new Set();
  const push = (url) => {
    if (!url || seen.has(url) || out.length >= overflow) return;
    seen.add(url);
    out.push(url);
  };
  push(evidenceUrl);
  const pri = (r) => {
    const k = String((r && r.resultKind) || '');
    if (k === 'INTERSECTION_MATCH' || k === 'INTERVIEW_MATCH') return 0;
    if (r && r.intersection) return 1;
    if (k === 'MEDIA_MATCH' || (r && isSpecialistSource(r))) return 2;
    if (k === 'AGGREGATOR' || k === 'GENERIC_BACKGROUND' || k === 'WEAK_MATCH') return 8;
    return 4;
  };
  const rows = [...(opts.discoveryResults || [])].sort((a, b) => pri(a) - pri(b) || (b.score || 0) - (a.score || 0));
  for (const r of rows) {
    if (out.length >= overflow) break;
    if (!r || !r.url) continue;
    const h = hostOf(r.url).replace(/^www\./, '');
    if ((TUBE_INDEX_RE.test(h) || isAggregatorPage(r)) && r.url !== evidenceUrl && adult === 'off') continue;
    if (evidenceHost && h === evidenceHost) continue;
    push(r.url);
  }
  for (const r of rows) {
    if (out.length >= overflow) break;
    if (!r || !r.url) continue;
    const h = hostOf(r.url).replace(/^www\./, '');
    if ((TUBE_INDEX_RE.test(h) || isAggregatorPage(r)) && r.url !== evidenceUrl && adult === 'off') continue;
    push(r.url);
  }
  for (const p of (opts.profileUrls || []).slice(0, 3)) push(p);
  for (const g of (opts.galleryUrls || []).slice(0, 2)) push(g);
  return out;
}

function buildSelectedEntity(classification, candidate, identity, extras) {
  extras = extras || {};
  const c = classification || {};
  const r = candidate || {};
  const id = identity || {};
  const name = String(extras.canonicalName || id.canonicalName || c.subject || '').trim();
  const type = c.type || r.entityType || '';
  const evidence = extras.discoveryEvidence || discoveryEvidenceFrom(r);
  return {
    entityId: extras.entityId || entityIdFor(type, name),
    canonicalName: name,
    type,
    aliases: id.aliases || r.aliases || [],
    handles: id.handles || [],
    confidence: extras.identityAmbiguous ? 'low' : (r.confidence || extras.confidence || 'low'),
    identityAmbiguous: !!extras.identityAmbiguous,
    identityCandidates: extras.identityCandidates || [],
    discoveryEvidence: evidence,
    sourceRefs: evidence && evidence.url ? [evidence.url] : [],
    url: (evidence && evidence.url) || r.url || '',
    image: (evidence && evidence.image) || r.image || ((r.images || [])[0]) || '',
    images: (evidence && evidence.images) || [...new Set([r.image, ...(r.images || [])].filter(Boolean))].slice(0, 8),
    provenance: (evidence && evidence.provenance) || r.provenance || 'DISCOVERED',
    reason: r.reason || '',
    sourceUrls: evidence && evidence.url ? [evidence.url] : [r.url].filter(Boolean),
    domains: id.domains || (evidence && evidence.domain ? [evidence.domain] : (r.domain ? [r.domain] : [])),
    originalQuery: extras.originalQuery || '',
    context: extraContext(c) || extras.context || '',
    adultContent: c.adultContent || extras.adultContent || 'off',
    lens: extras.lens || '',
    depth: extras.depth || c.researchDepth || '',
    selectedAt: new Date().toISOString(),
    visualLikenessIsNotIdentityProof: true,
  };
}

function resolveDivePaths(type, body = {}, classification) {
  const all = researchPaths(type, classification);
  const requestedRaw = Array.isArray(body.paths) ? body.paths : (Array.isArray(body.pathIds) ? body.pathIds : []);
  const requested = requestedRaw.map(x => (typeof x === 'string' ? x : x && x.id)).filter(Boolean);
  const investigationId = String(body.investigation || body.investigationId || '').trim();
  if (investigationId && investigationId !== 'everything' && investigationId !== 'all' && investigationId !== 'question') {
    const choice = investigationChoices(type, classification).find(c => c && c.id === investigationId);
    if (choice && Array.isArray(choice.paths)) {
      for (const p of choice.paths) {
        if (p && requested.indexOf(p) < 0) requested.push(p);
      }
    }
  }
  const custom = String(body.customQuestion || body.question || '').trim();
  const inferred = inferPathsFromQuestion(custom, all);
  const wantAll = body.all === true || body.all === 'true' || requested.includes('all') || investigationId === 'everything' || investigationId === 'all' || (!requested.length && !inferred.length && investigationId !== 'question');
  if (wantAll) return { all: true, selected: all, inferred, custom, investigation: investigationId || 'everything' };
  const ids = new Set(requested.filter(id => id !== 'all'));
  for (const id of inferred) ids.add(id);
  const extras = [];
  if (ids.has('videos') && !all.some(p => p.id === 'videos')) extras.push({ id: 'videos', label: 'Videos' });
  if (ids.has('images') && !all.some(p => p.id === 'images') && !all.some(p => p.id === 'visuals')) extras.push({ id: 'images', label: 'Images' });
  let selected = all.filter(p => ids.has(p.id)).concat(extras);
  if (!selected.length) selected = all;
  return { all: extras.length ? false : selected.length === all.length, selected, inferred, custom, investigation: investigationId || '' };
}

function pathSearchVariants(seed, selectedPaths, classification) {
  const extra = [];
  const ids = new Set((selectedPaths || []).map(p => p.id));
  const add = (q, why) => {
    const t = String(q || '').trim();
    if (!t || extra.some(x => x.q === t)) return;
    extra.push({ q: t, why });
  };
  const subject = (classification && classification.subject) || seed;
  const adult = (classification && classification.adultContent) || 'off';
  const ctx = (classification && classification.context) || '';
  if (ids.has('images') || ids.has('visuals')) {
    if (adult === 'on' || adult === 'both') add(imageSearchQuery(subject, classification || {}), 'contextual visual evidence');
    else add(seed + ' photos OR images OR gallery OR portrait', 'visual evidence');
  }
  if (ids.has('videos')) {
    if ((adult === 'on' || adult === 'both') && classification && (classification.type === 'person' || classification.type === 'social' || classification.type === 'ambiguous') || (ctx && (detectRelation(ctx) === 'bondage' || detectRelation(ctx) === 'video'))) {
      add('"' + subject.replace(/"/g, '') + '" ' + (ctx && !/adult content/i.test(ctx) ? ctx + ' ' : '') + 'video OR scene OR clip', 'contextual video sources');
    } else add(seed + ' video OR youtube OR interview', 'video sources');
  }
  if (ids.has('timeline') || ids.has('history')) add(seed + ' timeline OR history', 'chronology');
  if (ids.has('presence') || ids.has('official')) add(seed + ' official OR profile OR website', 'public presence');
  if (ids.has('tutorials') || ids.has('steps')) add(seed + ' tutorial OR procedure OR how to', 'instructional sources');
  if (ids.has('safety')) add(seed + ' safety', 'safety context');
  if (ids.has('identity')) {
    if (adult === 'on') add('"' + subject.replace(/"/g, '') + '" (performer OR profile OR "official site" OR models)', 'identity in the active research context');
    else add(seed + ' biography OR profile OR "who is"', 'identity sources');
  }
  if (ids.has('reviews')) add(seed + ' review OR reviews', 'reviews');
  if (ids.has('pricing')) add(seed + ' price OR pricing OR history', 'pricing history');
  if (ids.has('issues') || ids.has('trouble')) add(seed + ' problems OR issues OR common problems', 'known issues');
  if (ids.has('related') || ids.has('entities')) add(seed + ' related OR associated', 'related entities');
  if (ids.has('context') && ctx && !/adult content/i.test(ctx)) add('"' + subject.replace(/"/g, '') + '" ' + ctx, 'requested context intersection');
  if (ids.has('career')) add('"' + subject.replace(/"/g, '') + '" (credits OR filmography OR career)', 'career and credits');
  if (ids.has('projects') || ids.has('productions')) add('"' + subject.replace(/"/g, '') + '" ' + (ctx && !/adult content/i.test(ctx) ? ctx + ' ' : '') + '(scene OR title OR production)', 'projects and productions');
  if (ids.has('interviews')) add('"' + subject.replace(/"/g, '') + '" interview OR podcast OR feature', 'interviews and features');
  if (ids.has('organizations')) add('"' + subject.replace(/"/g, '') + '" (studio OR production OR company)', 'associated organizations');
  if (ids.has('premium')) add('"' + String(subject || seed).replace(/"/g, '') + '" (subscription OR "members only" OR "official site" OR catalog OR preview)', 'premium/subscription public leads — Carmen does not bypass access');
  if (ids.has('fit') || ids.has('measurements')) add(seed + ' (fit OR sizing OR "size chart" OR measurements)', 'fit and sizing');
  if (ids.has('materials')) add(seed + ' (fabric OR material OR construction OR lining)', 'materials and construction');
  if (ids.has('similar')) add(seed + ' similar OR alternative OR "look alike" OR inspired', 'similar garments');
  if (ids.has('terms')) add(seed + ' (terminology OR "also called" OR synonym OR glossary)', 'terminology');
  if (ids.has('identification')) add(seed + ' (identify OR brand OR designer OR "what is this")', 'garment identification');
  if (ids.has('evidence')) add(seed + ' evidence OR documentation OR source', 'evidence');
  if (ids.has('concepts')) add(seed + ' explained OR concept OR overview', 'concepts');
  if (ids.has('variations') || ids.has('variants')) add(seed + ' variants OR generations OR versions', 'variants');
  if (ids.has('alternatives')) add(seed + ' alternative OR vs OR compared', 'alternatives');
  if ((adult === 'on' || adult === 'both') && (classification && (classification.type === 'person' || classification.type === 'social' || classification.type === 'ambiguous')) && (ids.has('presence') || ids.has('identity') || ids.has('images') || ids.has('videos'))) {
    for (const v of adultSemanticVariants(subject, /adult content/i.test(ctx) ? '' : ctx)) add(v.q, v.why);
  }
  return extra.slice(0, 12);
}

function youtubeId(url) {
  const raw = String(url || '');
  const compact = raw.match(/^yt:([\w-]{6,})$/i);
  if (compact) return compact[1];
  try {
    const u = new URL(raw);
    const h = u.hostname.replace(/^www\./, '').toLowerCase();
    if (h === 'youtu.be') return u.pathname.replace(/^\//, '').split('/')[0] || '';
    if (h === 'youtube.com' || h === 'm.youtube.com' || h.endsWith('.youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/\/(?:embed|shorts|live)\/([^/?]+)/);
      if (m) return m[1];
    }
  } catch {}
  return '';
}

function vimeoId(url) {
  const raw = String(url || '');
  const compact = raw.match(/^vm:(\d{6,})$/i);
  if (compact) return compact[1];
  try {
    const u = new URL(raw);
    if (!/(^|\.)vimeo\.com$/i.test(u.hostname.replace(/^www\./, ''))) return '';
    const m = u.pathname.match(/\/(?:video\/)?(\d+)/);
    return m ? m[1] : '';
  } catch { return ''; }
}

function isVideoUrl(url) {
  const raw = String(url || '');
  if (youtubeId(raw) || vimeoId(raw)) return true;
  if (/\.(mp4|webm|mov)(\?|$)/i.test(raw)) return true;
  if (/\/embed\//i.test(raw)) return true;
  try {
    const u = new URL(raw);
    const path = u.pathname || '';
    if (/\/(watch|view_video|video|videos|clip|player|embed)\b/i.test(path)) return true;
    if (u.searchParams.get('v') && /[\w-]{6,}/.test(u.searchParams.get('v'))) return true;
    if (u.searchParams.get('viewkey')) return true;
  } catch {}
  return false;
}

function isVideoHost(url) {
  return isVideoUrl(url);
}

function expandVideoUrl(url) {
  const raw = String(url || '');
  const yt = youtubeId(raw);
  if (yt && !/^https?:/i.test(raw)) return 'https://www.youtube.com/watch?v=' + yt;
  const vim = vimeoId(raw);
  if (vim && !/^https?:/i.test(raw)) return 'https://vimeo.com/' + vim;
  return raw;
}

function collectDiveVideos(retrieved, results, classification) {
  const out = [];
  const seen = new Set();
  const adult = (classification && classification.adultContent) || 'off';
  const extraCtx = String((classification && classification.context) || '').replace(/adult content/i, '').trim().toLowerCase();
  const add = (url, pageUrl, title, thumb) => {
    url = expandVideoUrl(url);
    const key = canonicalVideoKey(url) || (isVideoUrl(url) ? String(url).split('#')[0].toLowerCase() : '');
    if (!url || !key || seen.has(key)) return;
    if (!isVideoUrl(url) && !youtubeId(url) && !vimeoId(url)) return;
    seen.add(key);
    const yt = youtubeId(url);
    const vim = vimeoId(url);
    const host = hostOf(url).replace(/^www\./, '');
    const embedUrl = yt ? ('https://www.youtube.com/embed/' + yt) : (vim ? ('https://player.vimeo.com/video/' + vim) : '');
    const restrictedHost = /(onlyfans|patreon|substack)\.com/i.test(host);
    const playable = !!embedUrl && !restrictedHost;
    const blob = (String(title || '') + ' ' + url + ' ' + host + ' ' + String(pageUrl || '')).toLowerCase();
    const dur = classifyVideoDuration({ title, url, pageUrl, snippet: blob });
    let relevance = playable ? 3 : 1;
    let reason = playable ? 'Playable public embed. Not identity proof.' : 'Public video reference. Open the source to watch — Carmen does not invent playback.';
    let confidence = playable ? 'medium' : 'low';
    if (dur.class === 'full-length' || dur.class === 'extended' || dur.class === 'long') {
      relevance += 4;
      reason = 'Longer public video (' + dur.label + '). Open the source to watch.';
    } else if ((dur.class === 'short' || dur.class === 'very-short') && !/\b(clip|short|trailer|preview)\b/i.test(extraCtx)) {
      relevance -= 2;
    }
    if (adult === 'on' || adult === 'both') {
      if (ADULT_HOST_RE.test(host) || ADULT_PATH_RE.test(url) || ADULT_EVIDENCE_RE.test(blob)) {
        relevance += 5;
        reason = 'Public adult-context video from ' + host + '. Visual likeness is not identity proof.';
        confidence = 'medium';
      }
      if (GENERIC_BIO_HOST_RE.test(host) || /biography|wikipedia|interview highlight/i.test(blob)) {
        relevance -= 3;
      }
    }
    if (extraCtx && extraCtx.split(/\s+/).filter(t => t.length > 2).some(t => blob.includes(t))) {
      relevance += 5;
      reason = 'Video context matches “' + extraCtx + '”. Visual likeness is not identity proof.';
      confidence = 'medium';
    } else if (extraCtx && adult === 'on') {
      relevance -= 2;
    }
    out.push({
      url,
      pageUrl: pageUrl || url,
      title: title || host,
      domain: host,
      thumbnail: thumb || (yt ? ('https://i.ytimg.com/vi/' + yt + '/hqdefault.jpg') : ''),
      embedUrl: playable ? embedUrl : '',
      playable,
      accessState: restrictedHost ? 'PAYWALLED' : (playable ? 'DIRECTLY_RETRIEVED' : 'REFERENCED'),
      accessNote: restrictedHost
        ? 'Playback requires a paid or logged-in account. Carmen cannot retrieve it.'
        : (playable ? '' : 'No public embed is available. Open the source to watch — Carmen does not invent playback.'),
      retrievedAt: new Date().toISOString(),
      relevance,
      reason,
      confidence,
      durationClass: dur.class,
      durationLabel: dur.label,
      durationSeconds: dur.seconds,
      contextLane: (ADULT_HOST_RE.test(host) || ADULT_EVIDENCE_RE.test(blob)) ? 'adult' : 'general',
      videoId: key,
    });
  };
  for (const r of results || []) {
    const href = r.url || '';
    if (isVideoUrl(href) || r.videoId || /bing videos/i.test(r.source || '')) {
      add(href || r.videoId, href, r.title, r.image);
    }
  }
  for (const page of retrieved || []) {
    if (page.ogVideo) add(page.ogVideo, page.finalUrl || page.url, page.title, page.ogImage);
    for (const v of page.harvestedVideos || []) add(v.url, page.finalUrl || page.url, v.title || page.title, page.ogImage);
    for (const u of page.videoUrls || []) add(u, page.finalUrl || page.url, page.title, page.ogImage);
    const text = String(page.textExcerpt || page.text || page.description || '');
    const re = /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[\w-]{6,}|youtu\.be\/[\w-]{6,}|vimeo\.com\/\d+)/gi;
    let m;
    while ((m = re.exec(text)) && out.length < 36) add(m[0], page.finalUrl || page.url, page.title, page.ogImage);
  }
  out.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
  if (adult === 'on') {
    const contextual = out.filter(x => (x.relevance || 0) >= 5);
    const playable = out.filter(x => x.playable);
    if (contextual.length || playable.length) {
      const merged = [];
      const seenK = new Set();
      for (const v of [...contextual, ...playable, ...out]) {
        const k = v.videoId || v.url;
        if (!k || seenK.has(k)) continue;
        seenK.add(k);
        merged.push(v);
      }
      return merged.slice(0, 36);
    }
  }
  return out.slice(0, 36);
}

function relatedFromDiscovery(results, candidate) {
  const focus = (candidate && candidate.url) || '';
  const focusHost = hostOf(focus);
  const out = [];
  for (const r of results || []) {
    if (!r || r.url === focus) continue;
    if (r.confidence !== 'high' && r.confidence !== 'medium') continue;
    if (focusHost && hostOf(r.url) === focusHost) continue;
    out.push({
      kind: r.entityType || 'source',
      label: r.title,
      url: r.url,
      why: r.reason || 'Related public source',
      image: r.image || '',
      domain: r.domain || hostOf(r.url),
    });
    if (out.length >= 6) break;
  }
  return out;
}

function parseRelated(text) {
  const out = [];
  const raw = String(text || '');
  const idx = raw.search(/RELATED(?:_ENTITIES)?\b/i);
  if (idx < 0) return out;
  const block = raw.slice(idx).split(/\n(?:OBSERVED|INFERRED|UNKNOWN)\b/i)[0];
  const re = /^\s*[-*]\s*([A-Za-z][A-Za-z /]{2,24})\s*[:—\-]\s*(.+)$/gm;
  let m;
  while ((m = re.exec(block)) && out.length < 8) {
    const kind = m[1].trim().toLowerCase();
    const rest = m[2].trim();
    const parts = rest.split(/\s[—–-]\s/);
    out.push({ kind, label: (parts[0] || rest).trim(), why: parts.slice(1).join(' — ').trim() });
  }
  return out;
}

function buildSearchVariants(q, classification) {
  const clean = q.trim().replace(/\s+/g, ' ').slice(0, 200);
  const out = [];
  const add = (query, why) => {
    const t = String(query || '').trim();
    if (!t) return;
    if (!out.some(x => x.q === t)) out.push({ q: t, why });
  };
  if (classification.isUrl) {
    add(classification.url, 'inspect the submitted URL');
    return out.slice(0, 1);
  }
  add(clean, 'primary query');
  const subject = classification.subject || clean;
  const context = classification.context || '';
  const extraCtx = /adult content/i.test(context) ? '' : context;
  const adult = classification.adultContent || 'off';
  if (extraCtx && classification.type === 'person') {
    add('"' + subject.replace(/"/g, '') + '" ' + extraCtx, 'person + requested context');
    const syn = contextualSynonyms(extraCtx, classification.relation);
    if (syn) add('"' + subject.replace(/"/g, '') + '" ' + syn, 'contextual visual/source synonyms');
    if (adult === 'on' || adult === 'both') add('"' + subject.replace(/"/g, '') + '" (performer OR profile OR "official site")', 'identity in the adult research lens');
    else add(subject + ' official OR website OR profile', 'official/profile pages for the person');
  } else if (extraCtx) {
    add('"' + subject.replace(/"/g, '') + '" ' + extraCtx, 'entity + requested context');
    const syn = contextualSynonyms(extraCtx, classification.relation);
    if (syn) add('"' + subject.replace(/"/g, '') + '" ' + syn, 'contextual synonyms');
  } else if (classification.type === 'person' && /\s/.test(clean)) {
    add('"' + clean.replace(/"/g, '') + '"', 'exact name');
    if (adult === 'on' || adult === 'both') add('"' + clean.replace(/"/g, '') + '" (performer OR profile OR "official site")', 'identity in the adult research lens');
    else add(clean + ' official OR website OR profile', 'official/profile pages');
  } else if (classification.type === 'website') {
    add(clean.replace(/^https?:\/\//, ''), 'domain form');
  } else if (classification.type === 'product' || classification.type === 'vehicle') {
    add('"' + clean.replace(/"/g, '') + '"', 'exact product string');
  } else if (classification.type === 'technique') {
    add(clean + ' tutorial OR diagram OR how to', 'instructional / visual references');
    add('"' + clean.replace(/"/g, '') + '"', 'exact technique name');
  } else if (classification.type === 'skill') {
    add(clean + ' tutorial OR guide OR procedure', 'how-to / procedure sources');
    add(clean + ' tools materials safety', 'tools and safety context');
  } else if (classification.type === 'organization') {
    add(clean + ' official website', 'official organization pages');
  } else if (classification.type === 'reddit') {
    add(clean.replace(/^r\//, ''), 'community query');
  } else if (/\s/.test(clean) && !/^".*"$/.test(clean)) {
    add('"' + clean.replace(/"/g, '') + '"', 'exact phrase');
  }
  if ((adult === 'on' || adult === 'both') && (classification.type === 'person' || classification.type === 'social' || classification.type === 'ambiguous')) {
    for (const v of adultSemanticVariants(subject, extraCtx)) add(v.q, v.why);
  }
  if (adult === 'both' && extraCtx) {
    add('"' + subject.replace(/"/g, '') + '" biography OR profile OR interview', 'general-context lane');
  }
  return out.slice(0, adult === 'off' ? 5 : 6);
}

function buildExpandedVariants(q, classification) {
  const clean = String(q || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  const out = [];
  const add = (query, why) => {
    const t = String(query || '').trim();
    if (!t || t === clean) return;
    if (!out.some(x => x.q === t)) out.push({ q: t, why });
  };
  const subject = (classification && classification.subject) || clean;
  const context = (classification && classification.context) || '';
  const extraCtx = /adult content/i.test(context) ? '' : context;
  add('"' + subject.replace(/"/g, '') + '" interview OR feature OR "press"', 'public interviews and features as alternatives');
  add(clean + ' site:.org OR wikipedia OR "official site"', 'public indexes and official pages');
  add('"' + subject.replace(/"/g, '') + '" (cited OR according OR reported)', 'public citations and reporting');
  add('"' + subject.replace(/"/g, '') + '" photos OR images OR gallery', 'public image indexes as alternatives');
  add(clean + ' youtube OR video OR interview', 'public video indexes as alternatives');
  if (extraCtx) {
    add('"' + subject.replace(/"/g, '') + '" ' + extraCtx + ' interview OR feature OR review', 'contextual public alternatives');
    const syn = contextualSynonyms(extraCtx, classification && classification.relation);
    if (syn) add('"' + subject.replace(/"/g, '') + '" ' + syn, 'contextual synonyms');
  }
  if (classification && (classification.adultContent === 'on' || classification.adultContent === 'both') && (classification.type === 'person' || classification.type === 'social' || classification.type === 'ambiguous')) {
    for (const v of adultSemanticVariants(subject, extraCtx)) add(v.q, v.why);
  }
  add(clean + ' reddit OR forum OR discussion', 'public discussion alternatives');
  if (classification && classification.type === 'person') {
    add(subject + ' news OR press OR homepage', 'editorial and official coverage');
  }
  if (classification && (classification.type === 'technique' || classification.type === 'skill')) {
    add(clean + ' diagram OR tutorial OR demonstrated', 'instructional visual sources');
  }
  return out.slice(0, 10);
}

function scoreResult(query, item, classification) {
  const q = String(query || '').toLowerCase().replace(/['"]/g, '');
  const tokens = q.split(/\s+/).filter(t => t.length > 1);
  const title = String(item.title || '').toLowerCase();
  const url = String(item.url || '').toLowerCase();
  const host = hostOf(item.url).replace(/^www\./, '');
  const sld = host.split('.')[0] || '';
  const snip = String(item.snippet || '').toLowerCase();
  let score = 8;
  const bits = [];
  let intersection = false;
  const subjTokens = String((classification && classification.subject) || '').toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const nameTokens = subjTokens.length ? subjTokens : tokens.filter(t => t.length > 2).slice(0, 3);
  if (classification.isUrl && classification.url && (item.url === classification.url || item.url === classification.url.replace(/\/$/, ''))) {
    score += 50; bits.push('submitted URL');
  }
  const wantHost = String((classification && classification.requestedSourceDomain) || '').replace(/^www\./, '').toLowerCase();
  if (wantHost) {
    if (host === wantHost || host.endsWith('.' + wantHost)) { score += 28; bits.push('user-requested source domain'); }
    else { score -= 24; bits.push('outside the requested source domain'); }
  }
  const aggregator = isAggregatorPage(item);
  const specialist = isSpecialistSource(item);
  const specific = isSpecificEvidence(item, classification);
  if (q && title.includes(q)) {
    if (aggregator) { score += 8; bits.push('keyword overlap on an index page'); }
    else { score += 42; bits.push('exact query in title'); }
  } else if (tokens.length && tokens.every(t => title.includes(t))) {
    if (aggregator) { score += 6; bits.push('query tokens on an index page'); }
    else { score += 24; bits.push('all query tokens in title'); }
  } else if (nameTokens.length && nameTokens.every(t => title.includes(t))) { score += 24; bits.push('entity name in title'); }
  else if (tokens.some(t => title.includes(t))) { score += 8; bits.push('partial name match'); }
  if (!aggregator && tokens.length && tokens.every(t => host.includes(t) || url.includes(t))) { score += 20; bits.push('name tokens in URL/domain'); }
  const brandHit = tokens.find(t => t.length > 2 && (t === sld || host === t + '.com' || host.endsWith('.' + t + '.com')));
  if ((classification.type === 'product' || classification.type === 'organization' || classification.type === 'vehicle' || classification.type === 'website' || classification.type === 'topic') && brandHit) {
    score += 36; bits.push('official brand/domain match');
  } else if ((classification.type === 'product' || classification.type === 'organization' || classification.type === 'website') && tokens.some(t => t.length > 3 && host.includes(t))) {
    score += 16; bits.push('brand/domain match');
  }
  const resolvedDomain = String((classification && (classification.resolvedDomain || (classification.resolvedEntity && classification.resolvedEntity.domain))) || '').replace(/^www\./, '').toLowerCase();
  if (resolvedDomain) {
    if (host === resolvedDomain || host.endsWith('.' + resolvedDomain)) {
      score += 48; bits.push('resolved known site');
    } else {
      const sld = resolvedDomain.split('.')[0];
      const blob = title + ' ' + snip + ' ' + url;
      const nameBits = String((classification && classification.subject) || '').toLowerCase().split(/\s+/).filter(t => t.length > 2);
      const mentionsSite = (sld && blob.includes(sld)) || (nameBits.length && nameBits.every(t => blob.includes(t)));
      if (!mentionsSite) {
        score = Math.min(score - 40, 8);
        bits.push('unrelated to resolved known site');
      }
    }
  }
  if (/official site|official website/i.test(item.snippet || item.title || '') || /\/models\/|\/about|\/profile/i.test(url)) {
    score += 16; bits.push('likely official or profile page');
  }
  if (looksLikeFirstPartySource(item, (classification && classification.subject) || q)) {
    score += 28; bits.push('first-party / official source for the requested identity');
  }
  if (classification.type === 'person' && nameTokens.length >= 2) {
    const missingName = nameTokens.filter(t => t.length > 2 && !title.includes(t) && !url.includes(t));
    if (missingName.length) {
      score -= 28;
      bits.push('incomplete name tokens — possible different person');
    }
  }
  if (host.endsWith('wikipedia.org')) {
    const missing = nameTokens.filter(t => t.length > 2 && !title.includes(t) && !url.includes(t));
    const adultOnPerson = ((classification && classification.adultContent) === 'on' || (classification && classification.adultContent) === 'both') && classification.type === 'person';
    if (classification.type === 'person' && missing.length) { score -= 36; bits.push('encyclopedia hit missing name tokens'); }
    else if (tokens.length && tokens.every(t => !title.includes(t))) { score -= 40; bits.push('encyclopedia hit unrelated to query'); }
    else if (adultOnPerson && classification.adultContent === 'on') { bits.push('encyclopedia is secondary under adult lens'); }
    else { score += 16; bits.push('encyclopedia source'); }
  }
  if (PROFILE_HOST_RE.test(host)) { score += 14; bits.push('public profile host'); }
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) { score += 12; bits.push('Reddit thread'); }
  const hasVisual = !!(item.image || (item.images && item.images.length));
  if (hasVisual) { score += 6; bits.push('has visual evidence'); }
  if (classification.type === 'person' && hasVisual && !aggregator && nameTokens.length && nameTokens.every(t => title.includes(t) || url.includes(t) || snip.includes(t))) {
    score += 14; bits.push('public visual reference for the person');
  }
  if ((classification.type === 'technique' || classification.type === 'skill') && INSTRUCTIONAL_HOST_RE.test(host)) {
    score += 16; bits.push('instructional source');
  }
  if ((classification.type === 'technique' || classification.type === 'skill') && /tutorial|how to|guide|explained|diagram|procedure|safety/i.test(title + ' ' + snip)) {
    score += 12; bits.push('instructional title');
  }
  if (classification.type === 'technique' && (item.image || (item.images && item.images.length))) {
    score += 8; bits.push('visual reference');
  }
  let contextPenalized = false;
  if (classification.context) {
    const ctxTerms = contextTermsForScore(classification);
    const blob = title + ' ' + snip + ' ' + url;
    const hasEntity = nameTokens.length ? nameTokens.every(t => blob.includes(t)) : tokens.filter(t => t.length > 2).slice(0, 2).every(t => blob.includes(t));
    const matchedCtx = ctxTerms.filter(t => blob.includes(t));
    const hasContext = matchedCtx.length > 0;
    const ev = evidenceForResult(item, { subject: (classification && classification.subject) || '', topic: extraContext(classification) || classification.context || '', rawQuery: q }, classification);
    if (ev.echo) {
      score -= 36; bits.push('query-echo title is not evidence');
    }
    if (hasEntity && hasContext) {
      if (aggregator || ev.echo) {
        score += 4; bits.push('keyword co-occurrence is not verified intersection');
        intersection = false;
      } else if (ev.intersection === 'strong') {
        score += specific ? 44 : 36;
        bits.push('strong subject ∩ topic evidence (' + matchedCtx.slice(0, 3).join(', ') + ')');
        intersection = true;
        if (specialist) { score += 12; bits.push('specialist/public database for the intersection'); }
        else if (specific) { score += 10; bits.push('specific production/title/project evidence'); }
      } else if (ev.intersection === 'weak') {
        score += 12; bits.push('weak subject ∩ topic — not counted as strong intersection');
        intersection = false;
      } else {
        score += 6; bits.push('tokens co-occur but evidence does not independently support both');
        intersection = false;
      }
    } else if (ctxTerms.length && hasEntity && extraContext(classification)) {
      score -= 8; bits.push('subject evidence without topic intersection — kept, not discarded');
      contextPenalized = true;
    } else if (ctxTerms.length && hasContext && !hasEntity) {
      const personTopic = classification.type === 'person' && extraContext(classification);
      score -= personTopic ? 22 : 8;
      bits.push(personTopic
        ? 'generic topic result without the resolved person — not entity-specific evidence'
        : 'topic evidence without the subject — kept, not discarded');
    }
  }
  const disneyHit = fictionalNameCollision(title + ' ' + snip + ' ' + url, (classification && classification.subject) || '', host);
  if (disneyHit) {
    score -= 70;
    bits.push(disneyHit.reason);
    item.identityCollision = disneyHit.collision;
    item.matchQuality = 'unrelated';
  }
  const dis = identityDisambiguation((classification && classification.subject) || '');
  if (dis.must.length && classification && classification.type === 'person') {
    const missingMust = dis.must.filter(t => !title.includes(t) && !url.includes(t) && !snip.includes(t));
    if (missingMust.length && dis.mustNot.some(n => (title + ' ' + snip + ' ' + url).includes(n))) {
      score -= 36;
      bits.push('missing identity must-token while matching a known collision');
    }
  }
  const vis = classifyVisualRelevance({ url: item.url, title: item.title, snippet: item.snippet, pageUrl: item.pageUrl }, classification);
  if (vis.demote) {
    score -= 18;
    bits.push('visual class ' + vis.visualClass + ' demoted for this investigation');
  }
  if (socialShouldDeprioritize(item, classification, { identityHostHits: (classification && classification._identityHostHits) || 0, confirmed: (classification.identityFeedback && classification.identityFeedback.confirmed) || [] })) {
    score -= 16;
    bits.push('social media deprioritized after identity/link discovery');
  }
  const adult = (classification && classification.adultContent) || 'off';
  const adultish = isAdultishSource(item);
  const genericBio = GENERIC_BIO_HOST_RE.test(host);
  let contextLane = (adultish && !genericBio) ? 'adult' : 'general';
  if (adult === 'on' || adult === 'both') {
    if (adultish && !genericBio) {
      score += contextPenalized ? 8 : 24;
      bits.push(contextPenalized ? 'adult-context source, missing requested concept' : 'adult-context source');
      if (intersection) { score += 14; bits.push('adult-context intersection'); }
    }
    if (genericBio && adult === 'on') {
      score -= 28;
      bits.push('generic biography, weak for adult-context research');
    } else if (genericBio && adult === 'both') {
      score -= 6; bits.push('general biography lane');
    }
  }
  if (NAV_TITLE_RE.test(String(item.title || '').trim())) { score -= 45; bits.push('generic nav title'); }
  if (SEO_JUNK_RE.test(host) || SEO_JUNK_RE.test(url)) { score -= 30; bits.push('SEO/name-mill site'); }
  if (aggregator || TUBE_INDEX_RE.test(host) || (adult === 'off' && /\/pornstar\//i.test(url))) {
    const extra = extraContext(classification);
    const tubePen = (adult === 'on' || adult === 'both') ? (extra ? 34 : 8) : 22;
    score -= tubePen;
    bits.push('aggregator/index, not a primary source');
  }
  if (/\/(top|playlists?|search)\//i.test(url)) { score -= 14; bits.push('search/index page'); }
  if (classification.type === 'product' && RETAILER_RE.test(host)) {
    score -= 18; bits.push('retailer listing, not manufacturer');
  }
  if (/\/tag\/|\/tags\/|\/browse\//i.test(url)) { score -= 10; bits.push('tag/index page'); }
  if (host.endsWith('mojeek.com') || host.endsWith('startpage.com') || host.endsWith('bing.com')) { score -= 40; bits.push('search-engine chrome'); }
  if (classification.confidence === 'low' || classification.type === 'ambiguous') {
    score = Math.min(score, 48);
  }
  const confidence = score >= 55 ? 'high' : score >= 32 ? 'medium' : 'low';
  let reason;
  if (classification.type === 'ambiguous' || (classification.confidence === 'low' && tokens.length <= 1)) {
    reason = score >= 32
      ? 'Ambiguous query — ' + (bits[0] || 'name overlap') + '; many people/entities could match'
      : 'Low confidence — single-token overlap, many collisions possible';
  } else if (score >= 55) reason = 'Strong match — ' + bits.slice(0, 2).join(' + ');
  else if (score >= 32) reason = 'Possible match — ' + (bits[0] || 'name overlap') + ', limited corroborating evidence';
  else if (classification.type === 'person' && tokens.some(t => title.includes(t))) reason = 'Low confidence — name collision or thin context';
  else reason = 'Low confidence — weak overlap with the query';
  const hasEntityFlag = nameTokens.length ? nameTokens.every(tok => (title + ' ' + snip + ' ' + url).includes(tok)) : false;
  const hasContextFlag = extraContext(classification) ? contextTermsForScore(classification).some(term => (title + ' ' + snip + ' ' + url).includes(term)) : false;
  const resultKind = classifyResultKind(item, classification, {
    intersection,
    hasEntity: hasEntityFlag,
    hasContext: hasContextFlag,
    hasVisual,
    relationship: /follow-|production|title/.test(String(item.discoveryLane || '')),
  });
  if (resultKind === 'AGGREGATOR' && /Strong match/.test(reason)) {
    reason = 'Index page — keyword overlap, not a verified relationship';
  }
  return { score, confidence, reason, signals: bits, contextLane, intersection, resultKind };
}

function aliasesFor(item, query) {
  const out = [];
  const path = humanizePath(item.url);
  if (path && /[A-Za-z]{3,}/.test(path) && !/^\d/.test(path) && path.toLowerCase() !== String(query || '').toLowerCase()) out.push(path);
  const handle = (String(item.url || '').match(/(?:x\.com|twitter\.com|instagram\.com|onlyfans\.com)\/([A-Za-z0-9_.]+)/i) || [])[1];
  if (handle && !/^(intent|share|search|i|p|reel)$/i.test(handle) && !/\./.test(handle)) out.push('@' + handle);
  const snipAt = String(item.snippet || '').match(/@[\w.]{2,30}/g) || [];
  out.push(...snipAt.filter(x => !/\.(png|jpg|ico|json|xml|svg)$/i.test(x)).slice(0, 2));
  for (const a of item.aliases || []) {
    if (!a || /\.(png|jpg|ico|json|xml|svg)$/i.test(a) || /^@favicon/i.test(a)) continue;
    out.push(a);
  }
  return [...new Set(out.map(x => String(x).trim()).filter(Boolean))].slice(0, 4);
}

function rankResults(query, results, classification, opts = {}) {
  const resultCap = Math.max(8, Number(opts.cap || opts.maxResults) || MAX_RESULTS);
  if (classification && typeof classification === 'object') {
    classification._identityHostHits = (results || []).filter(item => {
      const h = hostOf(item && item.url).replace(/^www\./, '');
      return SOCIAL_IDENTITY_HOSTS.some(s => h === s || h.endsWith('.' + s));
    }).length;
    if (isTutorialIntent(query)) classification.tutorialIntent = true;
  }
  const ranked = results.map(item => {
    const s = scoreResult(query, item, classification);
    const host = hostOf(item.url);
    const sourceType = (host === 'reddit.com' || host.endsWith('.reddit.com')) ? 'reddit' : 'web';
    const sourceClass = classifySourceClass(item, classification);
    const ev = evidenceForResult(item, { subject: (classification && classification.subject) || '', topic: extraContext(classification) || '', rawQuery: query }, classification);
    const prov = annotateProvenance(item);
    const own = classifyAccountOwnership(item, (classification && classification.subject) || '');
    const mq = classifyMatchQuality(item, classification);
    const ct = classifyContentType(item, classification);
    const vis = classifyVisualRelevance(item, classification);
    const imp = detectImpersonator(item, (classification && classification.subject) || '');
    return {
      ...item,
      sourceType,
      domain: host.replace(/^www\./, ''),
      score: s.score,
      confidence: s.confidence,
      reason: s.reason,
      signals: s.signals,
      aliases: aliasesFor(item, query),
      entityType: classification.type,
      contextLane: s.contextLane || 'general',
      adultContent: classification.adultContent || 'off',
      intersection: !!s.intersection && ev.intersection === 'strong',
      evidence: ev,
      subjectEvidence: ev.subjectEvidence,
      topicEvidence: ev.topicEvidence,
      intersectionEvidence: ev.intersection,
      host: item.host || prov.host,
      publisher: item.publisher || prov.publisher,
      creator: item.creator || prov.creator,
      originalSource: item.originalSource || prov.originalSource,
      reposter: item.reposter || prov.reposter,
      mirror: item.mirror || prov.mirror,
      accountOwnership: own.kind,
      ownershipClass: own.ownershipClass || 'UNKNOWN',
      accountPlatform: own.platform,
      accountHandle: own.handle || 'UNKNOWN',
      role: ev.role || 'DISCOVERY_LEAD',
      evidenceClass: ev.evidenceClass || (ev.intersection === 'strong' || ev.intersection === 'weak' ? 'INTERSECTION_EVIDENCE' : (ev.role === 'SUBJECT_EVIDENCE' ? 'SUBJECT_EVIDENCE' : 'DISCOVERY')),
      isEvidenceItem: !!ev.isEvidence,
      isDiscoveryLead: !!ev.isDiscoveryLead,
      observationState: item.provenance === 'RETRIEVED' ? 'OBSERVED' : (item.accessState === 'BLOCKED' ? 'UNKNOWN' : 'INFERRED'),
      discoveryLane: item.discoveryLane || '',
      resultKind: s.resultKind || 'WEAK_MATCH',
      sourceClass,
      matchQuality: mq.matchQuality,
      matchQualityReason: mq.reason,
      contentType: ct.contentType,
      visualClass: vis.visualClass,
      impersonator: !!imp,
      rejectedReason: imp ? imp.reasons.join('; ') : '',
    };
  }).filter(r => {
    if (isRedditSearchPage(r.url, r.title)) return false;
    const reserved = r.retrievalLane === 'adult-identity' || r.sourceLane === 'adult-identity' || isAdultIdentityHost(hostOf(r.url)) || isActualRedditEvidence(r.url) || ['indexed-reddit', 'direct-reddit', 'pullpush', 'wayback'].includes(String(r.retrievalLane || ''));
    if (reserved) return true;
    return r.score > 10 && (r.signals || []).length;
  });
  ranked.sort((a, b) => b.score - a.score || String(a.domain).localeCompare(String(b.domain)));
  const seenHost = new Map();
  for (const r of ranked) {
    const n = seenHost.get(r.domain) || 0;
    if (n >= 3) r.score -= 12;
    seenHost.set(r.domain, n + 1);
  }
  const adultPerson = classification && (classification.adultContent === 'on' || classification.adultContent === 'both') && (classification.type === 'person' || classification.type === 'social');
  const hostCounts = {};
  for (const r of ranked) {
    hostCounts[r.domain] = (hostCounts[r.domain] || 0) + 1;
  }
  if (adultPerson) {
    for (const r of ranked) {
      if (r.sourceClass === 'DATABASE' || r.sourceClass === 'ADULT_PLATFORM' || r.sourceClass === 'PRIMARY') r.score += 12;
      else if (r.sourceClass === 'ENCYCLOPEDIA') r.score -= 10;
      else if (r.sourceClass === 'AGGREGATOR') r.score -= 4;
    }
  }
  for (const r of ranked) {
    const vol = sourceVolumePenalty(r, hostCounts);
    if (vol.penalty) {
      r.score -= vol.penalty;
      (r.signals || (r.signals = [])).push(vol.reason);
    }
    if (r.matchQuality === 'unrelated' && extraContext(classification)) r.score -= 10;
    if (r.matchQuality === 'exact') r.score += 8;
    if (r.contentType === 'account' && extraContext(classification)) r.score -= 4;
    if (r.impersonator) r.score -= 20;
    if ((classification && classification.tutorialIntent) || isTutorialIntent(query)) {
      if (r.contentType === 'tutorial') r.score += 18;
      else if (r.contentType === 'account' || r.contentType === 'visual') r.score -= 6;
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  const picked = [];
  const seenUrl = new Set();
  const take = (arr, n) => {
    for (const r of arr) {
      if (picked.length >= resultCap) break;
      if (n <= 0) break;
      const key = r.url || '';
      if (!key || seenUrl.has(key)) continue;
      seenUrl.add(key);
      picked.push(r);
      n--;
    }
  };
  const ident = ranked.filter(r => r.retrievalLane === 'adult-identity' || r.sourceLane === 'adult-identity' || isAdultIdentityHost(hostOf(r.url)));
  const reddit = ranked.filter(r => isRedditHost(hostOf(r.url)) || ['indexed-reddit', 'direct-reddit', 'pullpush', 'wayback'].includes(String(r.retrievalLane || '')));
  const bestInter = ranked.filter(r => r.intersection || r.role === 'INTERSECTION' || r.intersectionEvidence === 'strong');
  const bestSubject = ranked.filter(r => r.role === 'SUBJECT_EVIDENCE' || r.subjectEvidence === 'strong');
  const bestTopic = ranked.filter(r => r.role === 'TOPIC_EVIDENCE' || (r.topicEvidence === 'strong' && r.subjectEvidence === 'none'));
  const personTopic = classification && classification.type === 'person' && extraContext(classification);
  take(bestInter, Math.min(16, Math.max(6, Math.floor(resultCap / 3))));
  take(bestSubject, 6);
  take(bestTopic, personTopic ? 2 : 4);
  take(ident, 4);
  take(reddit, 3);
  take(ranked, resultCap - picked.length);
  picked.sort((a, b) => b.score - a.score);
  const fb = (classification && classification.identityFeedback) || {};
  return applyIdentityFeedback(picked.slice(0, resultCap), fb, classification);
}

function usableImage(url) {
  if (typeof url !== 'string' || !url.startsWith('http')) return '';
  if (SKIP_IMAGE_RE.test(url)) return '';
  if (url.startsWith('data:')) return '';
  return url;
}

function rankImages(urls, pageUrl) {
  const scored = [];
  for (const raw of urls || []) {
    let abs = String(raw || '');
    if (!abs) continue;
    try { if (pageUrl) abs = new URL(decodeEntities(abs), pageUrl).href; } catch {}
    const u = usableImage(abs);
    if (!u) continue;
    let p = 1;
    if (/\.(jpe?g|webp)(\?|$)/i.test(u) && /\/(content|uploads?|media|photos?|wp-content|images\/content)\//i.test(u)) p = 5;
    else if (/\.(jpe?g|webp)(\?|$)/i.test(u)) p = 3;
    else if (/\.png(\?|$)/i.test(u)) p = 2;
    scored.push({ u, p });
  }
  scored.sort((a, b) => b.p - a.p);
  const seen = new Set();
  const out = [];
  for (const { u } of scored) {
    const k = u.replace(/[?#].*$/, '');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
}

async function enrichTopResults(results, classification) {
  const take = classification.type === 'person' || classification.isUrl ? 6 : 3;
  const picked = results.slice(0, take);
  for (const r of results.slice(take, 14)) {
    if (picked.length >= take + 3) break;
    const host = (r.domain || hostOf(r.url)).replace(/^www\./, '');
    if ((PROFILE_HOST_RE.test(host) || r.image || ((classification.adultContent === 'on' || classification.adultContent === 'both') && isAdultishSource(r))) && !picked.includes(r)) picked.push(r);
  }
  const galleryExtra = [];
  await Promise.all(picked.map(async (item) => {
    if (item.retrievalStatus) return;
    if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) return;
    SEARCH_BUDGET.used++;
    try {
      const retrieved = await retrieveSource(item.url);
      item.retrievalStatus = retrieved.status;
      item.accessState = retrieved.accessState || (retrieved.status === 'RETRIEVED' ? 'DIRECTLY_RETRIEVED' : 'UNAVAILABLE');
      item.accessNote = retrieved.accessNote || retrieved.error || '';
      item.retrievedAt = retrieved.retrievedAt || null;
      if (retrieved.status === 'RETRIEVED') {
        if (retrieved.title && retrieved.title.length > 4 && (!item.title || item.title.length < retrieved.title.length)) {
          item.title = item.title || retrieved.title;
        }
        if ((!item.snippet || item.snippet.length < 40) && retrieved.description) item.snippet = retrieved.description;
        const imgs = rankImages([retrieved.ogImage, ...(retrieved.images || []), ...(item.images || [])], retrieved.finalUrl || item.url);
        item.images = imgs.slice(0, 12);
        item.image = item.images[0] || '';
        item.imageExtraction = retrieved.imageExtraction || describeImageExtraction('', item.url, retrieved);
        if (item.imageExtraction && item.imageExtraction.extractionFailed) {
          item.visualEvidence = 'UNKNOWN';
          item.accessNote = (item.accessNote ? item.accessNote + ' ' : '') + 'Source found, but images could not be extracted from this page.';
        }
        item.fingerprint = retrieved.fingerprint;
        item.textExcerpt = String(retrieved.textExcerpt || retrieved.text || '').slice(0, 1800);
        item.provenance = 'RETRIEVED';
        if (retrieved.identifiers) {
          item.aliases = [...new Set([...(item.aliases || []), ...(retrieved.identifiers.aliases || []), ...(retrieved.identifiers.handles || [])])].slice(0, 6);
          item.profiles = retrieved.identifiers.profiles;
        }
        if (retrieved.author) item.author = retrieved.author;
        if (retrieved.subreddit) item.subreddit = retrieved.subreddit;
        if (retrieved.published) item.published = retrieved.published;
        if (retrieved.galleryUrls && (classification.type === 'person' || classification.type === 'social' || extraContext(classification))) {
          for (const g of retrieved.galleryUrls) galleryExtra.push(g);
        }
        for (const g of retrieved.productionUrls || []) galleryExtra.push(g);
        if (retrieved.harvestedVideos && retrieved.harvestedVideos.length) {
          item.harvestedVideos = retrieved.harvestedVideos;
          item.videoUrls = retrieved.videoUrls || retrieved.harvestedVideos.map(v => v.url);
        }
        item.productionUrls = retrieved.productionUrls || [];
      } else {
        item.provenance = item.accessState === 'PAYWALLED' || item.accessState === 'AUTHENTICATION_REQUIRED' ? 'RETRIEVAL_FAILED' : (item.provenance || 'DISCOVERED');
        item.retrievalError = retrieved.error || 'retrieval failed';
        if (retrieved.ogImage || (retrieved.images && retrieved.images.length)) {
          const imgs = rankImages([retrieved.ogImage, ...(retrieved.images || []), ...(item.images || [])], item.url);
          item.images = imgs.slice(0, 6);
          item.image = item.image || imgs[0] || '';
          item.publicEvidence = retrieved.publicEvidence || 'Public thumbnail or snippet only — protected content was not retrieved.';
        }
      }
    } catch (e) {
      item.provenance = 'DISCOVERED';
      item.accessState = item.accessState || 'UNAVAILABLE';
      item.retrievalError = String(e?.message || e).slice(0, 160);
    }
    if (item.provenance === 'RETRIEVED' && /official|profile|models\//i.test(item.reason || item.url)) {
      item.score = (item.score || 0) + 4;
    }
  }));
  for (const g of galleryExtra.slice(0, 4)) {
    if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) break;
    if (results.some(r => r.url === g)) continue;
    SEARCH_BUDGET.used++;
    try {
      const retrieved = await retrieveSource(g);
      if (retrieved.status !== 'RETRIEVED') continue;
      const imgs = rankImages([retrieved.ogImage, ...(retrieved.images || [])], retrieved.finalUrl || g);
      const parent = results.find(r => hostOf(r.url) === hostOf(g)) || results.find(r => (r.productionUrls || []).includes(g) || (r.galleryUrls || []).includes(g));
      if (parent && imgs.length) {
        parent.images = rankImages([...(parent.images || []), ...imgs], parent.url).slice(0, 12);
        parent.image = parent.image || parent.images[0] || '';
      }
      if (retrieved.harvestedVideos && retrieved.harvestedVideos.length && parent) {
        parent.harvestedVideos = [...(parent.harvestedVideos || []), ...retrieved.harvestedVideos].slice(0, 12);
        parent.videoUrls = [...new Set([...(parent.videoUrls || []), ...(retrieved.videoUrls || [])])].slice(0, 12);
      }
      if (retrieved.status === 'RETRIEVED' && imgs.length && !results.some(r => r.url === (retrieved.finalUrl || g))) {
        results.push({
          title: retrieved.title || 'Source page',
          url: retrieved.finalUrl || g,
          source: 'Source-page traversal',
          snippet: retrieved.description || 'Public source page followed from a retrieved research node.',
          image: imgs[0] || '',
          images: imgs.slice(0, 8),
          provenance: 'RETRIEVED',
          retrievalStatus: 'RETRIEVED',
          accessState: retrieved.accessState || 'DIRECTLY_RETRIEVED',
          harvestedVideos: retrieved.harvestedVideos || [],
          videoUrls: retrieved.videoUrls || [],
          queryVariant: 'source-page',
        });
      }
    } catch {}
  }
  results.sort((a, b) => (b.score || 0) - (a.score || 0));
  return results;
}

async function inspectDirectUrl(classification, results, seen, diagnostics) {
  if (!classification.isUrl || !classification.url) return null;
  const identity = exactSourceIdentity(classification.url, { subject: classification.subject || '' });
  const retrieved = await retrieveExactSource(identity.canonicalUrl || classification.url, { identity });
  diagnostics.DirectURL = {
    status: retrieved.status === 'RETRIEVED' ? 200 : 422,
    ok: retrieved.status === 'RETRIEVED',
    error: retrieved.error,
    accessState: retrieved.accessState || '',
    canonicalUrl: identity.canonicalUrl,
    sourceId: identity.sourceId,
    sourceType: identity.sourceType,
    exactSource: true,
  };
  const imgs = rankImages([retrieved.ogImage, ...(retrieved.images || [])], retrieved.finalUrl || identity.canonicalUrl);
  const title = retrieved.title || identity.displayName || humanizePath(identity.canonicalUrl) || identity.canonicalUrl;
  const snippet = retrieved.description || retrieved.publicEvidence || String(retrieved.textExcerpt || retrieved.text || retrieved.accessNote || '').slice(0, 400);
  uniqueAdd(results, seen, {
    title,
    url: identity.canonicalUrl,
    source: 'Exact URL',
    snippet: snippet || (retrieved.status === 'RETRIEVED' ? '' : (identity.sourceType === 'reddit-post' ? 'Exact Reddit post could not be publicly retrieved.' : 'Exact URL was not retrieved.')),
    image: imgs[0] || '',
    images: imgs,
    queryVariant: identity.canonicalUrl,
    contentType: identity.sourceType.indexOf('-profile') >= 0 ? 'account' : (identity.sourceType === 'reddit-post' ? 'reddit' : 'webpage'),
  });
  const row = results.find(r => canonicalizeExactSourceUrl(r.url) === identity.canonicalUrl || r.url === classification.url || r.url === identity.canonicalUrl);
  if (row) {
    row.sourceId = identity.sourceId;
    row.canonicalUrl = identity.canonicalUrl;
    row.sourceType = identity.sourceType;
    row.handle = identity.handle;
    row.subreddit = identity.subreddit ? 'r/' + identity.subreddit : '';
    row.postId = identity.postId || '';
    row.provenance = retrieved.status === 'RETRIEVED' ? 'RETRIEVED' : 'FETCH_ATTEMPTED';
    row.retrievalStatus = retrieved.status;
    row.accessState = retrieved.accessState || (retrieved.status === 'RETRIEVED' ? 'DIRECTLY_RETRIEVED' : 'UNVERIFIED');
    row.accessNote = retrieved.accessNote || '';
    row.textExcerpt = String(retrieved.textExcerpt || retrieved.text || retrieved.publicEvidence || '').slice(0, 1800);
    row.images = imgs;
    row.image = imgs[0] || row.image;
    row.fingerprint = retrieved.fingerprint;
    row.exactSource = true;
    row.terminalState = retrieved.status === 'RETRIEVED' ? 'FETCHED' : ( /AUTHENTICATION_REQUIRED/i.test(retrieved.accessState || '') ? 'AUTHENTICATION_REQUIRED' : 'FETCH_FAILED');
    if (retrieved.identifiers) {
      row.aliases = [...new Set([...(row.aliases || []), ...(retrieved.identifiers.aliases || []), ...(retrieved.identifiers.handles || [])])].slice(0, 6);
      row.profiles = retrieved.identifiers.profiles;
    }
    if (retrieved.redditPost) {
      row.author = retrieved.redditPost.author;
      row.subreddit = retrieved.redditPost.subreddit || row.subreddit;
      row.postId = retrieved.redditPost.id || row.postId;
    }
  }
  return retrieved;
}

function humanizePath(url) {
  try {
    const p = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(p).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  } catch { return ''; }
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

async function runDiscovery(query, opts = {}) {
  const startedAt = Date.now();
  const expanded = opts.expanded === true || opts.expanded === 'true' || opts.expanded === 1;
  const visualMore = opts.visualMore === true || opts.visualMore === 'true' || opts.visualMore === 1;
  const further = opts.further === true || opts.investigateFurther === true;
  const visualMode = String(opts.visualMode || (visualMore ? 'more' : '') || '').toLowerCase();
  const visualOffset = Math.max(0, Number(opts.visualOffset) || 0);
  const videoMore = opts.videoMore === true || opts.videoMore === 'true' || opts.videoMore === 1;
  const excludeUrls = [].concat(opts.excludeUrls || opts.exclude || []).map(String).filter(Boolean);
  const excludeHosts = [].concat(opts.excludeHosts || []).map(String).filter(Boolean);
  const seedVisual = opts.seedVisual && typeof opts.seedVisual === 'object' ? opts.seedVisual : null;
  const attemptedQueries = parseAttemptedList(opts.attemptedQueries || opts.attempted || []);
  const knownMedia = parseAttemptedList(opts.knownMedia || []);
  const knownVideoIds = parseAttemptedList(opts.knownVideoIds || opts.knownVideos || []);
  const visualOnly = (visualMore || !!visualMode || videoMore) && !further && !expanded;
  const adult = normalizeAdult(opts.adult || opts.adultContent);
  const keepEntity = String(opts.entity || '').replace(/"/g, '').trim();
  const keepTopic = String(opts.topic || '').replace(/"/g, '').trim();
  const researchFocus = parseResearchFocus(opts.researchFocus || opts.focus || opts.hint || '', { type: opts.hint, tutorialIntent: !!opts.tutorialIntent, wantVisual: !!(opts.visualMore || opts.visualMode || opts.wantVisual) });
  const resumeQueue = opts.resumeQueue || opts.investigationQueue || (opts.investigationState && opts.investigationState.investigationQueue) || null;
  const resume = opts.resume === true || opts.resume === '1' || !!resumeQueue;
  let q = composeInvestigationQuery(String(query || '').trim().slice(0, 500), keepEntity, keepTopic);
  const hint = String(opts.hint || '').trim();
  const classification = applyResearchFilter(classifyQuery(q, hint), adult, q);
  if (keepEntity) {
    classification.subject = keepEntity;
    if (hint && hint !== 'ambiguous' && hint !== 'topic') classification.type = hint;
  }
  if (keepTopic) {
    classification.context = keepTopic;
    classification.relation = detectRelation(keepTopic) || classification.relation || 'context';
  }
  coupleEntityTopic(classification, keepEntity, keepTopic);
  const intent = parseInvestigationIntent(String(query || ''), {
    entity: keepEntity,
    topic: keepTopic,
    adult,
    hint,
    type: hint,
    findEverything: opts.findEverything,
    premiumAccounts: opts.premiumAccounts,
    mode: opts.mode || opts.intentMode,
    visualMode,
    findMore: opts.findMore,
    moreLikeThis: opts.moreLikeThis,
    findDifferent: opts.findDifferent,
    findSimilar: opts.findSimilar,
    searchThisVisual: opts.searchThisVisual,
    moreFromThisSource: opts.moreFromThisSource,
    moreFromThisPerson: opts.moreFromThisPerson,
    moreOnThisTopic: opts.moreOnThisTopic,
    seedVisual,
    excludeUrls,
    excludeHosts,
    priorResults: opts.priorResults || opts.prior || [],
    identityFeedback: opts.identityFeedback || {},
    researchFocus: opts.researchFocus || researchFocus,
    keepSubject: !!keepEntity,
    diveLens: opts.diveLens || '',
    attemptedQueries,
    graphLeads: opts.graphLeads || [],
  });

  if (intent.knownEntity) {
    if (!keepEntity) classification.subject = intent.knownEntity.aliases[0] || intent.knownEntity.domain;
    if (intent.knownEntity.type) classification.type = intent.knownEntity.type;
    classification.resolvedEntity = { id: intent.knownEntity.id, domain: intent.knownEntity.domain, name: intent.knownEntity.aliases[0] || intent.knownEntity.domain };
    if (intent.knownEntity.domain) classification.resolvedDomain = intent.knownEntity.domain;
    if (!keepTopic && intent.topic) {
      classification.context = intent.topic;
      classification.relation = detectRelation(intent.topic) || classification.relation || 'context';
    }
  }
  if (intent.subject && !classification.subject) classification.subject = intent.subject;
  if (intent.topic && !classification.context) {
    classification.context = intent.topic;
    classification.relation = detectRelation(intent.topic) || classification.relation || 'context';
  }
  if (intent.premiumAccounts && !classification.context) {
    classification.context = 'premium accounts';
    classification.relation = 'premium';
  }
  coupleEntityTopic(classification, classification.subject, extraContext(classification) || intent.topic);
  classification.tutorialIntent = !!intent.tutorialIntent;
  classification.retrievalIntents = intent.retrievalIntents || [];
  classification.identityFeedback = intent.identityFeedback || {};
  const topicMap = buildTopicMap(intent, classification);
  const depth = normalizeDepth(opts.depth, classification);
  classification.researchDepth = depth;
  // First-pass cap stays modest so the adaptive controller can actually run.
  // FETCH_HARD_CAP + the time guard are the resource rails — not this number.
  const adaptiveReserve = Math.min(16, Math.max(10, Math.floor(remainingFetches() * 0.35)));
  const firstPassCap = expanded || visualMore || further || visualMode ? 20 : (depth === 'deep' ? 16 : depth === 'contextual' ? 14 : 12);
  const cap = Math.min(opts.budget || firstPassCap, Math.max(8, remainingFetches() - adaptiveReserve));
  SEARCH_BUDGET = { used: FETCH_COUNT, max: FETCH_COUNT + cap, reserved: SEARCH_BUDGET.reserved || emptyReservedBudget() };
  const graph = discoveryLanes(classification, depth);
  const variants = [];
  const addVar = (qv, why, lane, kind, extra) => {
    const t = String(qv || '').trim();
    if (!t || variants.some(v => v.q === t)) return;
    if (attemptedQueries.some(a => String(a).toLowerCase() === t.toLowerCase())) return;
    variants.push({ q: t, why: why || '', lane: lane || '', kind: kind || 'web', sourceClass: (extra && extra.sourceClass) || '' });
  };
  const priorCorpus = opts.priorResults || intent.priorResults || [];
  const isDiveLens = intent.mode === 'dive-bondage' || intent.mode === 'dive-people' || intent.mode === 'dive-visuals' || intent.mode === 'dive-clothing' || !!intent.diveLens;
  const lensQs = isDiveLens ? buildLensQueries(intent, priorCorpus, attemptedQueries, { visuals: opts.knownVisuals || [], graphLeads: opts.graphLeads || [], relatedPeople: opts.relatedPeople || [] }) : [];
  const moreQs = intent.mode === 'find-more' ? findMoreQueries(intent, attemptedQueries, priorCorpus) : [];
  const chainFirst = [...lensQs, ...moreQs];
  if (chainFirst.length) {
    for (const x of chainFirst) addVar(x.q, x.why, x.lane || intent.mode, x.kind, { sourceClass: x.sourceClass });
  }
  const skipNaive = chainFirst.length > 0 && priorCorpus.length > 0;
  const allowPrimary = !(skipNaive && isNaiveLensQuery(q, intent));
  if (further && Array.isArray(opts.extraQueries) && opts.extraQueries.length) {
    for (const extra of opts.extraQueries) {
      const t = typeof extra === 'string' ? extra : extra && extra.q;
      addVar(t, (extra && extra.why) || 'investigate-further', 'further', 'web');
    }
    if (isVisualSubject(classification)) addVar(imageSearchQuery(classification.subject || q, classification), 'additional visual corpus', 'images', 'image');
  } else if (classification.isUrl) {
    for (const v of buildSearchVariants(opts.displayQuery || q, classification)) addVar(v.q, v.why, 'url', 'web');
  } else if (depth === 'broad') {
    for (const v of buildSearchVariants(q, classification)) addVar(v.q, v.why, 'identity', 'web');
  } else {
    const adultOnPerson = (adult === 'on' || adult === 'both') && classification.type === 'person';
    if (!adultOnPerson && allowPrimary) addVar(q, 'primary query', 'primary', 'web');
    for (const lane of graph.lanes) {
      for (const qv of lane.queries) {
        if (skipNaive && isNaiveLensQuery(qv, intent) && !/photoset|scene|gallery|interview|site:/i.test(qv)) continue;
        addVar(qv, lane.why, lane.id, lane.kind || 'web');
      }
    }
    if (adultOnPerson && allowPrimary) addVar(q, 'primary query', 'primary', 'web');
  }
  if (expanded) {
    for (const v of buildExpandedVariants(q, classification)) addVar(v.q, v.why, 'expanded', 'web');
  }
  if (Array.isArray(opts.extraQueries)) {
    for (const extra of opts.extraQueries) {
      const t = typeof extra === 'string' ? extra : extra && extra.q;
      addVar(t, (extra && extra.why) || 'deep-dive expansion', 'dive', 'web');
    }
  }
  if (classification.requestedSourceDomain) {
    const d = classification.requestedSourceDomain;
    const sub = String(classification.subject || q).replace(/"/g, '');
    addVar('"' + sub + '" site:' + d, 'user-requested source domain', 'restriction', 'web');
  }
  if (!classification.isUrl && !visualOnly) {
    for (const sc of sourceClassQueries(classification)) addVar(sc.q, sc.why, sc.lane, sc.kind);
    const concepts = splitContextConcepts(classification);
    if (concepts.length >= 2) {
      for (const lane of independentLaneQueries(classification)) addVar(lane.q, lane.why, lane.lane, 'web');
    }
  }
  {
    const plannerQs = plannerLaneQueries(topicMap, { attemptedQueries, limit: intent.findEverything || intent.premiumAccounts ? 22 : 14 });
    for (const pq of plannerQs) {
      if (skipNaive && isNaiveLensQuery(pq.q, intent) && !/photoset|scene|gallery|interview|site:/i.test(pq.q)) continue;
      addVar(pq.q, pq.why, pq.lane, pq.kind, { sourceClass: pq.sourceClass });
    }
    if (intent.mode === 'find-more') {
      const moreQs = findMoreQueries(intent, attemptedQueries, opts.priorResults || intent.priorResults || []);
      for (const x of moreQs) addVar(x.q, x.why, x.lane, x.kind, { sourceClass: x.sourceClass });
    }
    if (intent.mode === 'dive-bondage' || intent.mode === 'dive-people' || intent.mode === 'dive-visuals' || intent.mode === 'dive-clothing' || intent.diveLens) {
      const lensQs = buildLensQueries(intent, opts.priorResults || intent.priorResults || [], attemptedQueries, { visuals: opts.knownVisuals || [], graphLeads: opts.graphLeads || [] });
      for (const x of lensQs) addVar(x.q, x.why, x.lane || intent.mode, x.kind, { sourceClass: x.sourceClass });
    }

    if (intent.mode === 'more-like-this') for (const x of moreLikeThisQueries(intent, seedVisual || intent.seed)) addVar(x.q, x.why, x.lane, x.kind);
    if (intent.mode === 'find-different') for (const x of findDifferentQueries(intent, { excludeHosts })) addVar(x.q, x.why, x.lane, x.kind);
    if (intent.mode === 'find-similar') for (const x of findSimilarQueries(intent, seedVisual || intent.seed)) addVar(x.q, x.why, x.lane, x.kind);
    if (intent.mode === 'search-this-visual') for (const x of searchThisVisualQueries(intent, seedVisual || intent.seed)) addVar(x.q, x.why, x.lane, x.kind);
    if (intent.mode === 'more-from-this-source') for (const x of moreFromThisSourceQueries(intent, seedVisual || intent.seed)) addVar(x.q, x.why, x.lane, x.kind);
    if (intent.mode === 'more-from-this-person') for (const x of moreFromThisPersonQueries(intent)) addVar(x.q, x.why, x.lane, x.kind);
    if (intent.mode === 'more-on-this-topic') for (const x of moreOnThisTopicQueries(intent)) addVar(x.q, x.why, x.lane, x.kind);
    if (intent.knownEntity && intent.knownEntity.domain) {
      addVar('site:' + intent.knownEntity.domain, 'resolved known site', 'known-site', 'web');
      addVar((classification.subject || intent.knownEntity.domain) + ' site:' + intent.knownEntity.domain, 'known site × subject', 'known-site', 'web');
      if (classification.context) addVar('"' + classification.subject + '" ' + classification.context + ' site:' + intent.knownEntity.domain, 'known site × topic', 'known-site', 'web');
    }
    const identityAnchor = resolveIdentityAnchor(intent.identityFeedback, classification, { subject: classification.subject });
    if (identityAnchor.appliesToSubsequentRetrieval) {
      const follow = subsequentRetrievalFromFeedback(intent, intent.identityFeedback, {
        attemptedQueries,
        topic: classification.context || intent.topic,
      });
      for (const x of follow.queries) addVar(x.q, x.why, x.lane || 'identity', x.kind);
    }
    const coupledTopic = extraContext(classification) || intent.topic || keepTopic;
    if (classification.subject && coupledTopic && classification.type === 'person') {
      for (const x of keepEntityTopicQueries(classification.subject, coupledTopic, attemptedQueries.concat(variants.map(v => v.q)))) {
        if (skipNaive && isNaiveLensQuery(x.q, intent)) continue;
        addVar(x.q, x.why, x.lane, x.kind, { sourceClass: x.sourceClass || 'intersection' });
      }
    }
    if (intent.tutorialIntent || isTutorialIntent(q) || classification.type === 'skill' || (classification.type === 'technique' && isTutorialIntent(q))) {
      for (const x of tutorialQueries(classification.subject || q, coupledTopic, attemptedQueries)) {
        addVar(x.q, x.why, x.lane, x.kind, { sourceClass: x.sourceClass });
      }
    }
    if (classification.type === 'person') {
      for (const x of publicAccountQueries(classification.subject, attemptedQueries)) {
        addVar(x.q, x.why, x.lane, x.kind, { sourceClass: x.sourceClass });
      }
    }
    if (intent.premiumAccounts) {
      for (const x of premiumEscalationQueries(classification.subject, [], attemptedQueries)) {
        addVar(x.q, x.why, x.lane, x.kind, { sourceClass: x.sourceClass });
      }
    }
  }
  const adaptive = resumeQueue
    ? restoreAdaptiveController(resumeQueue, {
        query: q,
        classification,
        identity: { canonicalName: classification.subject, aliases: [], knownHandles: [], historicalHandles: [], accounts: [] },
        attempted: attemptedQueries,
        startedAt,
      })
    : createAdaptiveController({
        query: q,
        classification,
        identity: { canonicalName: classification.subject, aliases: [], knownHandles: [], historicalHandles: [], accounts: [] },
        attempted: attemptedQueries,
        startedAt,
      });
  const wantVisualBranch = isVisualSubject(classification) || visualMore || further || !!visualMode || classification.type === 'technique' || classification.type === 'object' || classification.type === 'person' || researchFocus.includes('visuals');
  const identityHold = identityPhaseShouldHoldExpansion(classification, intent.identityFeedback, {
    identityPhase: opts.identityPhase === true,
    confirmIdentity: opts.confirmIdentity || intent.mode === 'confirm-identity',
    findMore: !!opts.findMore,
    diveLens: opts.diveLens || intent.diveLens,
    premiumAccounts: !!intent.premiumAccounts,
    forceFullInvestigation: resume || !!keepTopic || opts.findMore || !!opts.diveLens || intent.mode === 'confirm-identity',
    mode: intent.mode,
  });
  enqueueAdaptiveFamilies(adaptive, {
    classification,
    identity: adaptive.identity,
    topic: extraContext(classification) || intent.topic || keepTopic,
    evidence: [],
    wantVisual: wantVisualBranch,
    premiumAccounts: !!intent.premiumAccounts,
    tutorialIntent: !!intent.tutorialIntent || isTutorialIntent(q) || classification.tutorialIntent,
    researchFocus,
    identityFeedback: intent.identityFeedback,
    identityPhase: identityHold,
  });
  for (const qv of adaptive.pending) {
    addVar(qv.q, qv.why, qv.lane || qv.family, qv.kind, { sourceClass: qv.sourceClass });
  }
  const results = [], seen = new Set(), diagnostics = {};
  const fixtureName = String(opts.fixture || opts.fixtureName || '').trim();
  const skipLive = !!fixtureName && !!fixtureItems(fixtureName);
  if (skipLive) {
    const fx = fixtureItems(fixtureName);
    Object.assign(diagnostics, fx.diagnostics);
    for (const it of fx.items) uniqueAdd(results, seen, { ...it, queryVariant: q, subject: classification.subject });
    if (fx.diagnostics && fx.diagnostics.KnownSite) {
      const domain = String(fx.diagnostics.KnownSite.domain || '').replace(/^www\./, '');
      const row = results.find(r => hostOf(r.url).replace(/^www\./, '') === domain);
      if (row) {
        const ks = knownSiteAccessStatus(fx.diagnostics.KnownSite);
        row.knownSiteStatus = row.knownSiteStatus || ks.label;
        row.accessState = row.accessState || 'BLOCKED';
        row.isDiscoveryLead = true;
        row.role = row.role || 'DISCOVERY_LEAD';
      }
    }
    diagnostics.Fixture = { name: fixtureName, note: 'Deterministic fixture — exercises the same ranking/evidence path. Not a live provider PASS.' };
  }
  if (!q) return { query: q, classification, variants, results, providers: diagnostics, count: 0, expanded, adultContent: adult, depth, lanes: graph.lanes, researchMetrics: buildResearchMetrics([], diagnostics) };

  if (!skipLive && intent.knownEntity && intent.knownEntity.domain) {
    const domain = String(intent.knownEntity.domain).replace(/^www\./, '');
    const siteUrl = 'https://' + domain + '/';
    uniqueAdd(results, seen, {
      title: (intent.knownEntity.aliases && intent.knownEntity.aliases[0]) || domain,
      url: siteUrl,
      source: 'Known site',
      snippet: 'Resolved known site/entity (' + domain + '). Public indexes may hide this domain — it is preserved as a lead.',
      discoveryLane: 'site',
      plannerSourceClass: 'related-sites',
      queryVariant: 'site:' + domain,
    });
    try {
      const retrieved = await Promise.race([
        retrieveSource(siteUrl),
        new Promise((_, reject) => setTimeout(() => reject(new Error('known-site retrieve timeout')), 4000)),
      ]);
      diagnostics.KnownSite = { domain, status: retrieved.status, ok: retrieved.status === 'RETRIEVED', accessState: retrieved.accessState };
      const row = results.find(r => hostOf(r.url).replace(/^www\./, '') === domain);
      if (retrieved.status === 'RETRIEVED' && row) {
        row.accessState = retrieved.accessState || 'DIRECTLY_RETRIEVED';
        row.retrievalStatus = 'RETRIEVED';
        row.snippet = retrieved.description || String(retrieved.textExcerpt || '').slice(0, 400) || row.snippet;
        row.title = retrieved.title || row.title;
      } else {
        diagnostics.KnownSite.inaccessible = retrieved.status !== 'RETRIEVED';
        diagnostics.KnownSite.note = 'Known site could not be fully retrieved. It remains a lead — not treated as nonexistent.';
        if (row) {
          row.accessState = retrieved.accessState || 'REFERENCED';
          const ks = knownSiteAccessStatus(retrieved);
          row.knownSiteStatus = ks.label;
          row.role = 'DISCOVERY_LEAD';
          row.isDiscoveryLead = true;
        }
      }
    } catch (e) {
      diagnostics.KnownSite = { domain, error: String(e.message || e).slice(0, 160), inaccessible: true, note: 'Known site could not be retrieved. It remains a lead — not treated as nonexistent.' };
      const row = results.find(r => hostOf(r.url).replace(/^www\./, '') === domain);
      if (row) {
        const ks = knownSiteAccessStatus({ error: e.message, inaccessible: true });
        row.knownSiteStatus = ks.label;
        row.accessState = 'BLOCKED';
        row.isDiscoveryLead = true;
      }
    }
  }

  async function runVariant(variant, includeSocial) {
    if (variant && variant.q) adaptive.attemptedSet.add(String(variant.q).toLowerCase());
    const jobs = [
      ddg(variant.q, results, seen, diagnostics),
      bing(variant.q, results, seen, diagnostics),
    ];
    if (includeSocial) {
      jobs.push(reddit(variant.q, results, seen, diagnostics));
      if (adult !== 'on') jobs.push(wikipedia(variant.q, results, seen, diagnostics, classification));
    }
    await Promise.all(jobs);
    for (const r of results) {
      if (r.queryVariant === variant.q && !r.discoveryLane) r.discoveryLane = variant.lane || '';
      if (r.queryVariant === variant.q && !r.plannerSourceClass && variant.sourceClass) r.plannerSourceClass = variant.sourceClass;
    }
  }

  if (skipLive) {
    diagnostics.LiveRetrieval = { skipped: true, reason: 'fixture mode — live providers not contacted' };
  } else if (classification.isUrl) {
    const direct = await inspectDirectUrl(classification, results, seen, diagnostics);
    if (direct && direct.status !== 'RETRIEVED') {
      diagnostics.ContinuedSearch = {
        skipped: true,
        reason: 'exact URL fetch did not retrieve the source — generic platform search is not a substitute',
      };
    }
    if (direct && Array.isArray(direct.relatedUrls) && remainingFetches() > 6) {
      for (const href of direct.relatedUrls.slice(0, 1)) {
        if (!href || isGenericPlatformDiscoveryQuery(href)) continue;
        try {
          const child = await retrieveExactSource(href, { identity: exactSourceIdentity(href, { subject: classification.subject || '' }) });
          uniqueAdd(results, seen, {
            title: child.title || href,
            url: canonicalizeExactSourceUrl(href) || href,
            source: 'Extracted from exact source',
            snippet: String(child.description || child.textExcerpt || '').slice(0, 300),
            queryVariant: classification.url,
            foundThrough: 'exact-source',
            parent: classification.url,
            sourceId: sourceIdFromCanonicalUrl(href),
            provenance: child.status === 'RETRIEVED' ? 'RETRIEVED' : 'FETCH_ATTEMPTED',
            retrievalStatus: child.status,
            accessState: child.accessState,
          });
        } catch {}
      }
    }
  } else if (!visualOnly) {
    const webVariants = retrievalExecutionOrder(
      variants.filter(v => (v.kind || 'web') === 'web'),
      { phases: ['identity', 'intersection', 'adult'] }
    );
    const cap = expanded || isDiveLens || intent.mode === 'find-more' ? 18 : (depth === 'deep' ? 14 : depth === 'contextual' ? 12 : 8);
    const extraActive = !!extraContext(classification);
    const adultOnPerson = (adult === 'on' || adult === 'both') && classification.type === 'person';
    if (adultOnPerson) {
      await reservedAdultIdentityLane(classification, results, seen, diagnostics);
    }
    const mustRun = extraActive
      ? new Set(['primary', 'identity', 'intersection', 'interviews', 'specialist', 'adult-identity', 'visual', 'accounts', 'identity-variants', 'tutorial', 'instructional'])
      : adultOnPerson
        ? new Set(['identity', 'intersection', 'adult', 'adult-identity', 'productions', 'interviews', 'primary', 'visual', 'accounts', 'identity-variants', 'premium'])
        : new Set(['primary', 'intersection', 'identity', 'visual', 'topic-variants', 'instructional', 'accounts']);
    const visualReserve = wantVisualBranch ? 3 : 0;
    const accountReserve = (classification.type === 'person' || intent.premiumAccounts) ? 2 : 0;
    let redditLaneDone = false;
    const redditQuery = String(classification.subject || q).replace(/"/g, '').trim() || q;
    for (let i = 0; i < Math.min(webVariants.length, cap); i++) {
      if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max - visualReserve - accountReserve) break;
      if (Date.now() - startedAt >= INVESTIGATION_TIME_GUARD_MS) break;
      await runVariant(webVariants[i], i === 0);
      if (i === 0) {
        await reservedRedditLane(redditQuery, results, seen, diagnostics);
        redditLaneDone = true;
      }
      const remainingMust = webVariants.slice(i + 1).some(v => mustRun.has(v.lane) || mustRun.has(v.family));
      if (depth === 'broad' && !expanded && !isDiveLens && intent.mode !== 'find-more' && results.length >= MAX_RESULTS && !remainingMust) break;
    }
    if (!redditLaneDone) await reservedRedditLane(redditQuery, results, seen, diagnostics);
    if (results.length < 6 && SEARCH_BUDGET.used < SEARCH_BUDGET.max) {
      await startpage(q, results, seen, diagnostics);
    }
  }

  const imgQ = imageSearchQuery(q, classification);
  const visualHits = [];
  const mediaVariants = variants.filter(v => v.kind === 'image' || v.kind === 'video');
  const wantVisual = isVisualSubject(classification) || visualMore || further || !!visualMode || videoMore;
  const mode = visualMode || (visualMore ? 'more' : (further ? 'different' : 'more'));
  if (skipLive) {
    // fixture path: no live image/video providers
  } else if (wantVisual && !classification.isUrl) {
    const vq = visualQueryVariants(classification, { mode, seedVisual, excludeHosts, attemptedQueries });
    const vidQ = videoQueryVariants(classification, { attemptedQueries });
    if (!videoMore) {
      for (const v of vq) addVar(v.q, v.why, 'images', 'image');
    }
    // Do not mark video classes as attempted during More Images / visual-only
    // passes — those classes belong to More Videos.
    if (videoMore || !(visualMore || visualMode === 'more' || visualMode === 'searchvisual' || visualMode === 'similar' || visualMode === 'different')) {
      for (const v of vidQ) addVar(v.q, v.why, 'videos', 'video');
    }
    const primary = (vq[0] && vq[0].q) || imgQ;
    const second = (vq[1] && vq[1].q) || '';
    const videoPrimary = (vidQ[0] && vidQ[0].q) || primary;
    const imgCap = visualOnly || visualMore || visualMode ? 32 : (expanded ? 28 : 24);
    const jobs = [];
    if (!videoMore && SEARCH_BUDGET.used < SEARCH_BUDGET.max) jobs.push(bingImages(primary, results, seen, diagnostics, imgCap, visualHits, visualOffset));
    if (!videoMore && SEARCH_BUDGET.used < SEARCH_BUDGET.max) jobs.push(yahooImages(second || primary, results, seen, diagnostics, visualOnly ? 24 : 18, visualHits));
    if (SEARCH_BUDGET.used < SEARCH_BUDGET.max && (videoMore || wantVisual)) jobs.push(bingVideos(videoPrimary, results, seen, diagnostics));
    if (videoMore && SEARCH_BUDGET.used < SEARCH_BUDGET.max && vidQ[1]) jobs.push(bingVideos(vidQ[1].q, results, seen, diagnostics));
    if (expanded && SEARCH_BUDGET.used < SEARCH_BUDGET.max) jobs.push(google(q, results, seen, diagnostics));
    if (expanded && SEARCH_BUDGET.used < SEARCH_BUDGET.max) jobs.push(mojeek(q, results, seen, diagnostics));
    if (jobs.length) await Promise.all(jobs);
    const bingEmpty = diagnostics['Bing Images'] && (diagnostics['Bing Images'].error || diagnostics['Bing Images'].added === 0);
    const yahooEmpty = diagnostics['Yahoo Images'] && (diagnostics['Yahoo Images'].error || diagnostics['Yahoo Images'].added === 0);
    if (!videoMore && SEARCH_BUDGET.used < SEARCH_BUDGET.max && vq[1] && (visualOnly || extraContext(classification) || further || expanded || bingEmpty)) {
      await bingImages(vq[1].q, results, seen, diagnostics, 20, visualHits, visualOffset ? visualOffset + 20 : 0);
    }
    if (!videoMore && SEARCH_BUDGET.used < SEARCH_BUDGET.max && (bingEmpty || yahooEmpty) && vq[2]) {
      diagnostics.ProviderPivot = { reason: 'image provider empty or failed — pivoting to the next query class, not retrying the dead path', from: bingEmpty ? 'Bing Images' : 'Yahoo Images', q: vq[2].q };
      await bingImages(vq[2].q, results, seen, diagnostics, 18, visualHits);
    }
    if (videoMore && SEARCH_BUDGET.used < SEARCH_BUDGET.max && vidQ[2]) {
      diagnostics.ProviderPivot = { reason: 'video index needed a new query class — pivoting rather than repeating the same media IDs', q: vidQ[2].q };
      await bingVideos(vidQ[2].q, results, seen, diagnostics);
    }
    if (adult === 'both' && SEARCH_BUDGET.used < SEARCH_BUDGET.max && !visualOnly && !videoMore) {
      await bingImages(quoteName(classification.subject || q) + ' (portrait OR headshot OR official)', results, seen, diagnostics, 12, visualHits);
    }
    if (mode === 'searchvisual' && seedVisual && seedVisual.pageUrl && SEARCH_BUDGET.used < SEARCH_BUDGET.max) {
      try {
        const page = await retrieveSource(seedVisual.pageUrl);
        if (page && page.status === 'RETRIEVED') {
          for (const im of page.images || []) pushVisualHit(visualHits, { image: im, pageUrl: page.finalUrl || seedVisual.pageUrl, title: page.title, query: 'source-page' }, 'Selected visual source page');
          for (const v of page.harvestedVideos || []) {
            uniqueAdd(results, seen, { title: v.title || page.title, url: v.url, source: 'Selected visual source page', snippet: 'Video harvested from the selected visual\'s source page.', queryVariant: 'searchvisual' });
          }
        }
      } catch {}
    }
  } else if (mediaVariants.length) {
    for (const m of mediaVariants) {
      if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) break;
      if (m.kind === 'image') await bingImages(m.q, results, seen, diagnostics, 14, visualHits);
      if (m.kind === 'video') await bingVideos(m.q, results, seen, diagnostics);
    }
  }

  let ranked = rankResults(classification.isUrl ? (humanizePath(classification.url) || q) : q, results, classification, { cap: (isDiveLens || intent.mode === 'find-more' || expanded) ? DIVE_RESULTS_CAP : MAX_RESULTS });
  if (opts.enrich !== false && !visualOnly && !skipLive) ranked = await enrichTopResults(ranked, classification);

  async function runAdaptiveQuery(qv) {
    if (!qv || !qv.q) return;
    addVar(qv.q, qv.why, qv.lane || qv.family, qv.kind, { sourceClass: qv.sourceClass });
    adaptive.attemptedSet.add(String(qv.q).toLowerCase());
    if (qv.kind === 'image') await bingImages(qv.q, results, seen, diagnostics, 16, visualHits);
    else if (qv.kind === 'video') await bingVideos(qv.q, results, seen, diagnostics);
    else await runVariant(qv, false);
  }

  let graphLeads = [];
  {
    // Adaptive continuation is the investigation loop. First-pass budget is not
    // the stop condition — FETCH_HARD_CAP + time guard are the rails.
    SEARCH_BUDGET.max = FETCH_HARD_CAP;
    const earlyIdentity = buildEntityIdentityRecord(classification, ranked, ranked.filter(r => r.provenance === 'RETRIEVED' || r.retrievalStatus === 'RETRIEVED'), graphLeads, {
      identityConfidence: 'medium',
    });
    adaptive.identity = earlyIdentity;
    classification.entityIdentity = earlyIdentity;
    adaptive.pending = adaptive.pending.filter(p => !adaptive.attemptedSet.has(String(p.q).toLowerCase()));
    const seedPack = extractInvestigationSeeds(ranked, classification, { identity: earlyIdentity });
    enqueueInvestigationPaths(adaptive, seedsToQueries(seedPack, classification, [...adaptive.attemptedSet]));
    enqueueAdaptiveFamilies(adaptive, {
      classification,
      identity: earlyIdentity,
      evidence: ranked,
      wantVisual: wantVisualBranch,
      premiumAccounts: !!intent.premiumAccounts,
      tutorialIntent: !!intent.tutorialIntent || isTutorialIntent(q) || classification.tutorialIntent,
      discoveredAccounts: earlyIdentity.accounts || [],
      researchFocus,
      identityFeedback: intent.identityFeedback,
      identityPhase: identityHold,
    });
    adaptive.pending = adaptive.pending.filter(p => !adaptive.attemptedSet.has(String(p.q).toLowerCase()));
    if (!skipLive && !visualOnly && !classification.isUrl) {
      const priorUrls = () => ranked.concat(results).map(r => r.url).filter(Boolean);
      const priorHosts = () => ranked.concat(results).map(r => hostOf(r.url).replace(/^www\./, '')).filter(Boolean);
      while (true) {
        const decision = decideInvestigationContinuation(adaptive, {
          remainingFetches: remainingFetches(),
          budgetLeft: remainingFetches() > 2,
          elapsedMs: Date.now() - startedAt,
          timeGuardMs: INVESTIGATION_TIME_GUARD_MS,
          maxIterations: ADAPTIVE_MAX_ITERATIONS,
          resourceExhausted: remainingFetches() <= 2,
        });
        if (!decision.continue) {
          diagnostics.AdaptiveInvestigation = { stopKind: decision.stopKind, stopClass: decision.stopClass, reason: decision.reason, remaining: decision.remaining, iterations: adaptive.iterations };
          break;
        }
        const batch = nextInvestigationBatch(adaptive, ADAPTIVE_BATCH_SIZE);
        if (!batch.length) {
          const stop = decideInvestigationContinuation(adaptive, { remainingFetches: remainingFetches(), budgetLeft: remainingFetches() > 2, elapsedMs: Date.now() - startedAt });
          diagnostics.AdaptiveInvestigation = { stopKind: stop.stopKind, stopClass: stop.stopClass, reason: stop.reason, remaining: 0, iterations: adaptive.iterations };
          break;
        }
        const urlSnap = new Set(priorUrls());
        const hostSnap = new Set(priorHosts());
        for (const qv of batch) {
          if (remainingFetches() <= 2) break;
          if (Date.now() - startedAt >= INVESTIGATION_TIME_GUARD_MS) break;
          await runAdaptiveQuery(qv);
        }
        const newItems = results.filter(r => r.url && !urlSnap.has(r.url));
        const novelty = evaluateNovelty({ items: newItems }, {
          urls: [...urlSnap],
          hosts: [...hostSnap],
          aliases: adaptive.aliases,
          accounts: adaptive.accounts,
        });
        recordInvestigationBatch(adaptive, batch, novelty);
        if (novelty.meaningful) {
          ranked = rankResults(classification.isUrl ? (humanizePath(classification.url) || q) : q, results, classification, { cap: (isDiveLens || intent.mode === 'find-more' || expanded) ? DIVE_RESULTS_CAP : MAX_RESULTS });
          if (opts.enrich !== false && remainingFetches() > 4) ranked = await enrichTopResults(ranked, classification);
          const moreSeeds = extractInvestigationSeeds(ranked, classification, { identity: adaptive.identity });
          enqueueInvestigationPaths(adaptive, seedsToQueries(moreSeeds, classification, [...adaptive.attemptedSet]));
          enqueueInvestigationPaths(adaptive, entityAssociatedVisualQueries(classification, newItems, [...adaptive.attemptedSet]));
          if ((adaptive.identity.aliases || []).length !== (earlyIdentity.aliases || []).length) {
            enqueueInvestigationPaths(adaptive, identityVariantQueries(classification, adaptive.identity, extraContext(classification) || keepTopic, [...adaptive.attemptedSet]));
          }
        }
      }
      ranked = rankResults(classification.isUrl ? (humanizePath(classification.url) || q) : q, results, classification, { cap: (isDiveLens || intent.mode === 'find-more' || expanded) ? DIVE_RESULTS_CAP : MAX_RESULTS });
      if (opts.enrich !== false && remainingFetches() > 3) ranked = await enrichTopResults(ranked, classification);
    } else {
      const novelty = evaluateNovelty({ items: ranked }, { urls: [], hosts: [] });
      recordInvestigationBatch(adaptive, [], novelty);
      const stop = decideInvestigationContinuation(adaptive, { remainingFetches: remainingFetches(), budgetLeft: true, elapsedMs: 0, maxIterations: ADAPTIVE_MAX_ITERATIONS });
      diagnostics.AdaptiveInvestigation = { stopKind: stop.stopKind, fixture: !!skipLive, reason: stop.reason, remaining: stop.remaining, iterations: adaptive.iterations };
    }
  }

  if (!skipLive && !visualOnly && !classification.isUrl && (classification.type === 'person' || classification.type === 'social' || classification.type === 'ambiguous') && remainingFetches() > 4 && Date.now() - startedAt < INVESTIGATION_TIME_GUARD_MS - 2000) {
    const hasIdentitySurface = ranked.some(r => {
      const sc = r.sourceClass || classifySourceClass(r, classification);
      if (sc === 'DATABASE' || sc === 'PRIMARY' || sc === 'PUBLIC_PROFILE') return true;
      if (adult === 'off' && sc === 'ENCYCLOPEDIA') return true;
      return false;
    });
    if (ranked.length < 5 || !hasIdentitySurface) {
      SEARCH_BUDGET.max = Math.min(FETCH_HARD_CAP, SEARCH_BUDGET.max + 8);
      diagnostics.IdentityExpansion = { reason: 'thin identity surface — expanding aliases, credits, and public profiles (generic, not a hardcoded name)' };
      const idq = identityExpansionQueries(classification);
      for (const v of idq.slice(0, 2)) {
        if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) break;
        addVar(v.q, v.why, 'identity-expand', 'web');
        await Promise.all([ddg(v.q, results, seen, diagnostics), bing(v.q, results, seen, diagnostics)]);
      }
      if (SEARCH_BUDGET.used < SEARCH_BUDGET.max) await bingImages((idq[0] && idq[0].q) || imgQ, results, seen, diagnostics, 18, visualHits);
      ranked = rankResults(classification.isUrl ? (humanizePath(classification.url) || q) : q, results, classification, { cap: (isDiveLens || intent.mode === 'find-more' || expanded) ? DIVE_RESULTS_CAP : MAX_RESULTS });
      if (opts.enrich !== false) ranked = await enrichTopResults(ranked, classification);
    }
  }

  const retrievedN = ranked.filter(r => r.retrievalStatus === 'RETRIEVED' || r.provenance === 'RETRIEVED').length;
  const restricted = ranked.filter(r => r.accessState === 'PAYWALLED' || r.accessState === 'AUTHENTICATION_REQUIRED' || r.accessState === 'AGE_RESTRICTED' || r.accessState === 'BLOCKED').length;
  const intersectionCountEarly = ranked.filter(r => r.intersection).length;
  const extraActive = extraContext(classification);
  if (!skipLive && !visualOnly && !expanded && extraActive && intersectionCountEarly === 0 && SEARCH_BUDGET.used < SEARCH_BUDGET.max - 4 && Date.now() - startedAt < INVESTIGATION_TIME_GUARD_MS - 2000) {
    diagnostics.ContinuedSearch = {
      reason: 'first-pass intersection was thin — broadening the entity ∩ context lane, not dumping biography',
      philosophy: 'Progressive intersection retrieval. Semantic variants are planning knowledge, not case evidence.',
    };
    const already = new Set(variants.map(v => v.q));
    const more = intersectionBroadenQueries(classification).filter(q2 => q2 && !already.has(q2)).slice(0, 4);
    for (const q2 of more) {
      if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) break;
      addVar(q2, 'broadened entity ∩ context', 'intersection', 'web');
      await Promise.all([ddg(q2, results, seen, diagnostics), bing(q2, results, seen, diagnostics)]);
    }
    if (SEARCH_BUDGET.used < SEARCH_BUDGET.max) await bingImages(imgQ, results, seen, diagnostics, 16, visualHits);
    ranked = rankResults(classification.isUrl ? (humanizePath(classification.url) || q) : q, results, classification, { cap: (isDiveLens || intent.mode === 'find-more' || expanded) ? DIVE_RESULTS_CAP : MAX_RESULTS });
    if (opts.enrich !== false) ranked = await enrichTopResults(ranked, classification);
  } else if (!skipLive && !visualOnly && !expanded && (ranked.length < 3 || retrievedN === 0 || restricted >= Math.max(2, ranked.length - 1)) && SEARCH_BUDGET.used < SEARCH_BUDGET.max - 4) {
    diagnostics.ContinuedSearch = {
      reason: ranked.length < 3 ? 'few public results on the first pass' : (restricted ? 'obvious sources were restricted' : 'obvious sources were not retrievable'),
      philosophy: 'Escalating to public alternatives — not retrying the same wall.',
    };
    const more = buildExpandedVariants(q, classification).slice(0, 3);
    for (const v of more) {
      if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) break;
      addVar(v.q, v.why, 'expanded', 'web');
      await Promise.all([ddg(v.q, results, seen, diagnostics), bing(v.q, results, seen, diagnostics)]);
    }
    if (SEARCH_BUDGET.used < SEARCH_BUDGET.max) await bingImages(imgQ, results, seen, diagnostics, 16, visualHits);
    ranked = rankResults(classification.isUrl ? (humanizePath(classification.url) || q) : q, results, classification, { cap: (isDiveLens || intent.mode === 'find-more' || expanded) ? DIVE_RESULTS_CAP : MAX_RESULTS });
    if (opts.enrich !== false) ranked = await enrichTopResults(ranked, classification);
  }

  if (!skipLive && !visualOnly && depth !== 'broad' && SEARCH_BUDGET.used < SEARCH_BUDGET.max - 4 && Date.now() - startedAt < INVESTIGATION_TIME_GUARD_MS - 2000) {
    graphLeads = extractGraphLeads(
      ranked.filter(r => r.provenance === 'RETRIEVED' || r.textExcerpt).map(r => ({
        title: r.title,
        url: r.url,
        textExcerpt: r.textExcerpt || r.snippet || '',
        identifiers: { aliases: r.aliases || [], handles: [], profiles: r.profiles || [] },
      })),
      ranked,
      classification
    );
    const follow = graphLeads.filter(l => {
      if (!(l.kind === 'production' || l.kind === 'title' || l.kind === 'alias')) return false;
      const lab = String(l.label || '').trim();
      const subj = String((classification && classification.subject) || '').trim();
      if (lab.split(/\s+/).length < 2 && l.kind !== 'alias') return false;
      if (l.kind === 'alias' && (/^(videos?|photos?|images?|gallery|search|model|performer|official|profile|porn|xxx|bondage|bdsm|clips?)$/i.test(lab.replace(/^@/, '')) || lab.replace(/^@/, '').length < 4)) return false;
      if (q && lab.toLowerCase() === q.toLowerCase()) return false;
      if (subj && lab.toLowerCase() === subj.toLowerCase()) return false;
      return true;
    }).slice(0, depth === 'deep' ? 4 : 2);
    if (follow.length) {
      diagnostics.RelationshipFollow = { followed: follow.map(l => l.label), reason: 'Following titles, productions, and aliases observed on retrieved sources.' };
      for (const l of follow) {
        if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) break;
        addVar(l.q, l.why, 'follow-' + l.kind, 'web');
        await Promise.all([ddg(l.q, results, seen, diagnostics), bing(l.q, results, seen, diagnostics)]);
      }
      ranked = rankResults(classification.isUrl ? (humanizePath(classification.url) || q) : q, results, classification, { cap: (isDiveLens || intent.mode === 'find-more' || expanded) ? DIVE_RESULTS_CAP : MAX_RESULTS });
      if (opts.enrich !== false) ranked = await enrichTopResults(ranked, classification);
    }
  }

  for (const r of ranked) {
    if (!r.provenance) r.provenance = r.retrievalStatus === 'RETRIEVED' ? 'RETRIEVED' : 'DISCOVERED';
    if (!r.accessState) {
      r.accessState = r.retrievalStatus === 'RETRIEVED' ? 'DIRECTLY_RETRIEVED' : (r.retrievalStatus === 'RETRIEVAL_FAILED' ? 'REFERENCED' : 'UNVERIFIED');
    }
    if (!r.images) r.images = r.image ? [r.image] : [];
    if (!r.sourceClass) r.sourceClass = classifySourceClass(r, classification);
    r.observedAt = r.observedAt || new Date().toISOString();
    r.adultContent = adult;
  }

  const diversity = sourceDiversityReport(ranked, { adultOn: adult === 'on' || adult === 'both' });
  if (!skipLive && !visualOnly && shouldOpenMoreAdultLanes(diversity) && SEARCH_BUDGET.used < SEARCH_BUDGET.max - 4 && Date.now() - startedAt < INVESTIGATION_TIME_GUARD_MS - 2000) {
    diagnostics.AdultSourceDiversity = {
      reason: 'Adult Lens ON but results were mostly generic indexes / YouTube / Pinterest / mirrors — opening additional adult source lanes',
      genericHeavy: diversity.genericHeavy,
      adultSourceCount: diversity.adultSourceCount,
    };
    const extraAdult = plannerLaneQueries(topicMap, { attemptedQueries: variants.map(v => v.q), limit: 8 })
      .filter(x => /platform|premium|publisher|store|identity-profile|fetish/i.test(x.sourceClass || x.lane));
    for (const x of extraAdult.slice(0, 4)) {
      if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) break;
      addVar(x.q, x.why, x.lane, x.kind);
      await Promise.all([ddg(x.q, results, seen, diagnostics), bing(x.q, results, seen, diagnostics)]);
    }
    ranked = rankResults(classification.isUrl ? (humanizePath(classification.url) || q) : q, results, classification, { cap: (isDiveLens || intent.mode === 'find-more' || expanded) ? DIVE_RESULTS_CAP : MAX_RESULTS });
    if (opts.enrich !== false) ranked = await enrichTopResults(ranked, classification);
  }
  let additive = {
    merged: ranked,
    newItems: ranked,
    genuinelyNew: ranked.length,
    duplicatesRemoved: 0,
    queryEchoesRemoved: 0,
    mirrorsRemoved: 0,
    nearDuplicatesRemoved: 0,
    exhausted: false,
    learnedSomething: ranked.length > 0,
    message: '',
    rejected: [],
  };
  if (Array.isArray(opts.priorResults) && opts.priorResults.length) {
    additive = additiveMerge(opts.priorResults, ranked, {
      intent,
      query: q,
      foundThrough: intent.mode || intent.diveLens || 'search',
      parent: (opts.priorResults[0] && opts.priorResults[0].url) || null,
      relatedTo: classification.subject,
    });
    ranked = additive.merged;
  }

  const lensMode = intent.mode === 'dive-bondage' || intent.mode === 'dive-people' || intent.mode === 'dive-visuals' || intent.mode === 'dive-clothing' || intent.mode === 'find-more' || !!intent.diveLens;
  if (!skipLive && lensMode && additive.genuinelyNew === 0 && SEARCH_BUDGET.used < SEARCH_BUDGET.max - 3) {
    const nextLane = nextFindMoreLane(intent, ranked, variants.map(v => v.q).concat(attemptedQueries), { visuals: visualHits });
    diagnostics.AdditiveExpansion = {
      reason: 'this angle added no new evidence — pivoting to the next unexplored retrieval lane rather than rewriting the same query',
      lane: nextLane.lane,
      exhausted: !!nextLane.exhausted,
    };
    if (!nextLane.exhausted) {
      for (const x of (nextLane.queries || []).slice(0, 3)) {
        if (SEARCH_BUDGET.used >= SEARCH_BUDGET.max) break;
        addVar(x.q, x.why, x.lane, x.kind);
        await Promise.all([ddg(x.q, results, seen, diagnostics), bing(x.q, results, seen, diagnostics)]);
      }
      ranked = rankResults(classification.isUrl ? (humanizePath(classification.url) || q) : q, results, classification, { cap: (isDiveLens || intent.mode === 'find-more' || expanded) ? DIVE_RESULTS_CAP : MAX_RESULTS });
      if (opts.enrich !== false) ranked = await enrichTopResults(ranked, classification);
      if (opts.priorResults && opts.priorResults.length) {
        additive = additiveMerge(opts.priorResults, ranked, { intent, query: q, foundThrough: nextLane.lane || intent.mode });
        ranked = additive.merged;
      }
    } else {
      additive.exhausted = true;
      additive.message = NO_NEW_SOURCES_MESSAGE;
    }
  }

  ranked = applyExclusions(ranked, { excludeUrls, excludeHosts });
  const knownImageSet = new Set(knownMedia.map(k => visualDedupeKey(k)).filter(Boolean));
  const knownVidSet = new Set(knownVideoIds.map(k => String(k).toLowerCase()).filter(Boolean));
  let duplicateMediaRejected = 0;
  const filteredHits = applyExclusions(visualHits, { excludeUrls, excludeHosts }).filter(h => {
    const key = visualDedupeKey(h && (h.url || h.image));
    if (key && knownImageSet.has(key)) { duplicateMediaRejected++; return false; }
    return true;
  });

  const identity = buildEntityIdentity(classification, [], ranked, graphLeads);
  const intersectionCount = ranked.filter(r => r.intersection).length;
  let visualCorpus = (wantVisualBranch || isVisualSubject(classification) || visualMore || further || !!visualMode)
    ? buildVisualCorpus(results, ranked.filter(r => r.provenance === 'RETRIEVED' || r.retrievalStatus === 'RETRIEVED'), classification, filteredHits)
    : [];
  visualCorpus = visualCorpus.filter(im => {
    const key = visualDedupeKey(im && (im.url || im.image));
    if (key && knownImageSet.has(key)) { duplicateMediaRejected++; return false; }
    return true;
  });
  const identityName = (classification.entityIdentity && classification.entityIdentity.canonicalName) || classification.subject;
  const visualIdentity = applyVisualIdentityFilter(visualCorpus, identityName, { identityFeedback: intent.identityFeedback, identityRecord: classification.entityIdentity });
  const classKept = [];
  for (const im of visualIdentity.kept || []) {
    const vis = classifyVisualRelevance(im, classification);
    im.visualClass = vis.visualClass;
    im.visualClassReason = vis.reason;
    if (vis.demote && (classification.type === 'person' || classification.type === 'technique' || classification.type === 'object' || classification.intentClass === 'OBJECT')) {
      visualIdentity.dropped.push({ ...im, primaryCorpus: false, reason: vis.reason || ('visual class ' + vis.visualClass + ' is not identity evidence') });
      continue;
    }
    classKept.push(im);
  }
  visualIdentity.kept = classKept;
  visualCorpus = visualIdentity.kept.concat(visualIdentity.dropped.map(im => ({ ...im, primaryCorpus: false })));
  {
    const known = (knownMedia || []).concat((opts.knownVisuals || []).map(v => v.url || v.image || v)).filter(Boolean);
    const deduped = dedupeVisualEvidence(visualIdentity.kept, known);
    const gated = applyVisualEvidenceGate(deduped.unique, classification, {
      identityFeedback: intent.identityFeedback,
      topic: extraContext(classification) || keepTopic || intent.topic,
      subject: classification.subject,
    });
    diagnostics.VisualEvidenceGate = {
      verified: gated.verified.length,
      unverified: gated.unverified.length,
      rejected: gated.rejected.length,
      duplicatesRemoved: deduped.duplicatesRemoved,
    };
    visualIdentity.kept = gated.verified;
    visualIdentity.dropped = (visualIdentity.dropped || []).concat(gated.rejected).concat(gated.unverified.map(im => ({ ...im, unverifiedVisual: true })));
    visualCorpus = gated.verified.concat(gated.unverified.map(im => ({ ...im, primaryCorpus: false, unverifiedVisual: true })));
    if ((visualMore || visualMode === 'more' || intent.mode === 'find-more') && gated.verified.length === 0) {
      diagnostics.NO_NEW_RELEVANT_VISUALS = {
        reason: 'Find More did not produce additional unique, relevant visual evidence after the visual evidence gate and dedupe.',
        rejected: gated.rejected.length,
        unverified: gated.unverified.length,
        duplicatesRemoved: deduped.duplicatesRemoved,
      };
    }
  }
  const primaryVisuals = visualIdentity.kept;
  const wrongPersonVisuals = visualIdentity.dropped.filter(im => im.identityCollision || im.identityGrade === 'unverified' && im.identityCollision);

  let videoCorpus = collectDiveVideos(ranked.filter(r => r.provenance === 'RETRIEVED' || r.retrievalStatus === 'RETRIEVED'), ranked, classification);
  const beforeVid = videoCorpus.length;
  videoCorpus = videoCorpus.filter(v => {
    const key = String(v.videoId || canonicalVideoKey(v.url) || '').toLowerCase();
    if (key && knownVidSet.has(key)) { duplicateMediaRejected++; return false; }
    return true;
  });
  const noNewRelevantVisuals = !!(diagnostics.NO_NEW_RELEVANT_VISUALS);
  const noNewMedia = ((visualMore || videoMore || visualMode === 'more') && visualIdentity.kept.length === 0 && videoCorpus.length === 0) || noNewRelevantVisuals;
  if (noNewMedia && !diagnostics.NO_NEW_MEDIA) {
    diagnostics.NO_NEW_MEDIA = { reason: noNewRelevantVisuals ? 'no additional unique relevant visual evidence after the visual evidence gate' : 'same media IDs returned — pivoting to the next query class', attempted: attemptedQueries.length };
  }
  const pivot = providerPivotReport(diagnostics);
  const sourceClassesReached = [...new Set(ranked.map(r => r.sourceClass).filter(Boolean))];
  const premiumContent = collectPremiumContent(ranked, ranked.filter(r => r.retrievalStatus === 'RETRIEVED' || r.accessState));
  const corpusScale = {
    images: visualCorpus.length,
    videos: videoCorpus.length,
    sources: ranked.length,
    moreAvailable: filteredHits.length >= 12 || visualCorpus.length >= 12 || !!visualMore || !!visualMode || variants.length > 0,
    label: visualCorpus.length + ' images · ' + videoCorpus.length + ' videos · ' + ranked.length + ' sources' + ((filteredHits.length >= 20 || visualCorpus.length >= 24) ? ' · more available' : ''),
    noNewMedia,
  };

  const buckets = evidenceBuckets(ranked);
  const identityCluster = competingIdentityCandidates(ranked, classification, { identityFeedback: intent.identityFeedback, subject: classification.subject });
  const identityVerification = buildIdentityVerificationPack(ranked, classification, { identityFeedback: intent.identityFeedback, subject: classification.subject });
  const diagnosis = corpusDiagnosis(ranked, diagnostics, intent);
  const providerStatuses = Object.fromEntries(Object.entries(diagnostics).map(([k, v]) => [k, { ...(v || {}), ...classifyProviderFailure(v) }]));
  const knownSiteStatus = diagnostics.KnownSite ? knownSiteAccessStatus(diagnostics.KnownSite) : null;
  const redditUnavailable = diagnostics.ReservedReddit && diagnostics.ReservedReddit.redditEvidence === 'unavailable';
  for (const b of topicMap.branches) {
    const n = ranked.filter(r => (r.discoveryLane === b.id || r.sourceClass === b.sourceClass || r.plannerSourceClass === b.id)).length;
    b.results = n;
    b.status = n > 0 ? 'ran' : (diagnosis.status === 'source_inaccessible' ? 'blocked' : 'thin');
  }
  const discoverySeeds = extractDiscoverySeeds(ranked, intent, { visuals: visualCorpus, graphLeads });
  Object.assign(topicMap, fillTopicMapFromEvidence(topicMap, ranked, { relatedPeople: discoverySeeds.people, visuals: visualCorpus }));
  const extractionFailures = ranked.filter(r => r.imageExtraction && r.imageExtraction.extractionFailed).map(r => ({
    url: r.url,
    title: r.title,
    domain: r.domain || hostOf(r.url),
    reason: (r.imageExtraction && r.imageExtraction.reason) || 'Source found, but images could not be extracted from this page.',
    pageAccessible: !!(r.imageExtraction && r.imageExtraction.pageAccessible),
    visualEvidence: 'UNKNOWN',
  }));
  const expansion = expansionReport(additive, {
    totalResults: ranked.length,
    lens: intent.diveLens || intent.mode || '',
    lane: (diagnostics.AdditiveExpansion && diagnostics.AdditiveExpansion.lane) || intent.mode,
    newEntitiesDiscovered: (discoverySeeds.people || []).length + (discoverySeeds.productions || []).length,
    newDomainsDiscovered: (discoverySeeds.domains || []).filter(d => !(opts.priorResults || []).some(r => (r.domain || hostOf(r.url)) === d)).length,
    wrongPersonCandidates: (visualIdentity.dropped || []).length,
    identityConfidence: identityCluster.ambiguous ? 'low' : (identityCluster.userConfirmed ? 'verified' : 'supported'),
    sourceQuality: diversity,
  });
  let warning = ranked.length || visualCorpus.length ? undefined : 'No public-web results were returned. Provider diagnostics are included for troubleshooting.';
  if (additive.exhausted && lensMode) {

    const note = NO_NEW_SOURCES_MESSAGE;
    warning = warning ? warning + ' ' + note : note;
  }

  if (diagnosis.status !== 'ok' && diagnosis.status !== 'thin_corpus') {
    const note = 'Retrieval status: ' + diagnosis.label + '. This is not automatically a thin public corpus.';
    warning = warning ? warning + ' ' + note : note;
  }
  if (redditUnavailable) {
    const note = 'Reddit evidence unavailable — no actual posts/comments/threads were retrieved. Search pages are not counted.';
    warning = warning ? warning + ' ' + note : note;
  }
  if (classification.isUrl && diagnostics.DirectURL && !diagnostics.DirectURL.ok) {
    const fail = (diagnostics.DirectURL.sourceType === 'reddit-post')
      ? 'Exact Reddit post could not be publicly retrieved. Generic Reddit search was not used as a substitute.'
      : 'Submitted URL could not be retrieved (' + (diagnostics.DirectURL.accessState ? accessLabel(diagnostics.DirectURL.accessState) : (diagnostics.DirectURL.error || 'blocked or failed')) + '). Generic platform search was not used as a substitute.';
    warning = warning ? fail + ' ' + warning : fail;
  }
  if (diagnostics.ContinuedSearch && !expanded) {
    const note = 'Restricted or incomplete sources triggered a public-alternative search. Carmen does not bypass paywalls or logins.';
    warning = warning ? warning + ' ' + note : note;
  }
  if (noNewRelevantVisuals) {
    const note = 'Carmen did not find additional unique, relevant visual evidence. Unrelated images were not appended.';
    warning = warning ? warning + ' ' + note : note;
  }

  const resourceStop = (adaptive.stopKind === 'E') ? honestResourceStop(adaptive, { iterations: adaptive.iterations, sourceClasses: sourceClassesReached }) : null;
  const investigationState = persistInvestigationQueue(createInvestigationState({
    query: q,
    subject: classification.subject,
    topic: keepTopic || extraContext(classification) || '',
    researchFocus,
    investigationId: opts.investigationId || (opts.investigationState && opts.investigationState.investigationId) || undefined,
  }), adaptive, {
    visualCandidates: visualCorpus,
    verifiedVisuals: visualIdentity.kept,
    rejectedVisuals: (visualIdentity.dropped || []).filter(im => im.visualGate === 'rejected' || im.identityCollision),
    stopKind: (resourceStop && resourceStop.stopKind) || adaptive.stopKind,
    headline: (resourceStop && resourceStop.headline) || adaptive.headline,
  });
  investigationState.identityFeedback = intent.identityFeedback || investigationState.identityFeedback;
  investigationState.identityVerification = identityVerification;
  investigationState.canonicalEntities = [...new Set([].concat((intent.identityFeedback && intent.identityFeedback.confirmed) || [], investigationState.canonicalEntities || []))].filter(Boolean);
  investigationState.resumable = !!(adaptive.pending && adaptive.pending.length);
  const queueSummary = queuedWorkSummary(adaptive);

  return {
    query: q,
    classification,
    investigationContext: {
      entity: keepEntity || classification.subject || '',
      topic: keepTopic || extraContext(classification) || '',
      keptSubject: !!keepEntity,
      mode: intent.mode,
      findEverything: !!intent.findEverything,
      premiumAccounts: !!intent.premiumAccounts,
      knownEntity: intent.knownEntity ? { id: intent.knownEntity.id, domain: intent.knownEntity.domain, name: intent.knownEntity.aliases[0] } : null,
    },
    intent: { mode: intent.mode, findEverything: !!intent.findEverything, premiumAccounts: !!intent.premiumAccounts, tutorialIntent: !!intent.tutorialIntent, retrievalIntents: intent.retrievalIntents || [] },
    topicMap,
    evidenceSummary: {
      subject: ranked.filter(r => r.subjectEvidence && r.subjectEvidence !== 'none').length,
      topic: ranked.filter(r => r.topicEvidence && r.topicEvidence !== 'none').length,
      intersection: ranked.filter(r => r.intersectionEvidence === 'strong' || r.intersection).length,
      bestSubjectEvidence: buckets.subject.slice(0, 5).map(r => ({ title: r.title, url: r.url, subjectEvidence: r.subjectEvidence, role: r.role })),
      bestTopicEvidence: buckets.topic.slice(0, 5).map(r => ({ title: r.title, url: r.url, topicEvidence: r.topicEvidence, role: r.role })),
      bestIntersection: buckets.intersection.slice(0, 8).map(r => ({ title: r.title, url: r.url, intersection: r.intersectionEvidence || r.role })),
      discoveryLeads: buckets.leads.slice(0, 5).map(r => ({ title: r.title, url: r.url, role: r.role })),
    },
    identityCandidates: identityCluster.candidates,
    identityAmbiguous: !!identityCluster.ambiguous,
    identityAmbiguousReason: identityCluster.reason || '',
    identityVerification,
    sourceDiversity: diversity,
    corpusDiagnosis: diagnosis,
    redditEvidence: redditUnavailable ? 'unavailable' : (redditResultCount(ranked) ? 'present' : 'none'),
    planner: PLANNER_BUILD,
    variants,
    results: ranked,
    providers: diagnostics,
    count: ranked.length,
    paths: researchPaths(classification.type, classification),
    warning,
    expanded,
    continued: !!diagnostics.ContinuedSearch,
    adultContent: adult,
    depth,
    lanes: graph.lanes,
    vocab: graph.vocab,
    identity,
    graphLeads,
    intersectionCount,
    lenses: interestLenses(classification.type, classification),
    investigationChoices: investigationChoices(classification.type, classification),
    visualCandidates: visualCandidatesFor(ranked, classification),
    visuals: visualCorpus,
    visualCorpus,
    videos: videoCorpus,
    videoCorpus,
    corpusScale,
    interpretations: ambiguousInterpretations(q, classification),
    visualMore: !!visualMore,
    visualMode: visualMode || '',
    visualOffset,
    further: !!further,
    selectedEntity: buildSelectedEntity(classification, pickIdentityCandidate(ranked, classification), identity, { originalQuery: q, depth, adultContent: adult, identityAmbiguous: identityCluster.ambiguous, identityCandidates: identityCluster.candidates, confidence: identityCluster.ambiguous ? 'low' : undefined }),
    concepts: enrichConceptsFromEvidence((graph.vocab && graph.vocab.concepts) || interpretRequest(classification).concepts, ranked),
    conceptGraph: interpretRequest(classification).graph,
    budget: budgetReport(),
    attemptedQueries: [...new Set([...(attemptedQueries || []), ...variants.map(v => v.q)])].slice(0, 80),
    queryClasses: variants.map(v => ({ q: v.q, why: v.why, lane: v.lane, kind: v.kind })),
    sourceClassesReached,
    providerFailures: pivot.failures,
    providerEmpty: pivot.empty,
    successfulPivots: (diagnostics.ProviderPivot ? 1 : 0) + (pivot.empty.length ? 1 : 0),
    duplicateMediaRejected,
    premiumContent,
    noNewMedia,
    noNewRelevantVisuals,
    noNewSources: !!(additive.exhausted && lensMode),
    noNewSourcesMessage: (additive.exhausted && lensMode) ? NO_NEW_SOURCES_MESSAGE : '',
    expansion,
    discoverySeeds,
    relatedPeople: discoverySeeds.people,
    clothingEvidence: discoverySeeds.clothing,
    firstPartySources: discoverySeeds.firstParty || [],
    extractionFailures,
    primaryVisuals,
    visualIdentityDropped: visualIdentity.dropped || [],
    primaryDiveLenses: primaryDiveLenses(),
    retrievalTrace: {

      queryClassesAttempted: variants.length,
      sourceClassesReached: sourceClassesReached.length,
      providerFailures: pivot.failures.length,
      successfulPivots: (diagnostics.ProviderPivot ? 1 : 0),
      duplicateMediaRejected,
      newEntities: (graphLeads || []).length + ((discoverySeeds.people || []).length),
      genuinelyNew: additive.genuinelyNew || 0,
      duplicatesRemoved: (additive.duplicatesRemoved || 0) + (additive.nearDuplicatesRemoved || 0),
      queryEchoesRemoved: additive.queryEchoesRemoved || 0,
      investigationIterations: adaptive.iterations || 0,
      pathsRemaining: (adaptive.pathsRemaining || []).length,
      identityVariants: [...new Set([classification.subject, ...(adaptive.aliases || [])])].filter(Boolean).length,
      visualPaths: (adaptive.visualPaths || []).length,
      accountPaths: (adaptive.accountPaths || []).length,
      linkChainDepth: adaptive.linkChainDepth || 0,
      stopKind: adaptive.stopKind || '',
    },

    researchMetrics: buildResearchMetrics(ranked, diagnostics, {
      queryClassCount: variants.length,
      sourceClassesReached: sourceClassesReached.length,
      elapsedMs: Date.now() - startedAt,
    }),
    structuredResults: ranked.map(r => serializeEvidenceItem(r, {
      subject: classification.subject,
      topic: extraContext(classification) || keepTopic,
      intent: intent.mode,
      foundThrough: r.discoveryLane || intent.mode,
    })),
    providerStatuses,
    knownSiteStatus,
    fixture: fixtureName || null,
    identityFeedbackApplied: !!(intent.identityFeedback && ((intent.identityFeedback.confirmed || []).length || (intent.identityFeedback.rejectedPeople || []).length)),
    entityIdentity: buildEntityIdentityRecord(classification, ranked, ranked.filter(r => r.provenance === 'RETRIEVED' || r.retrievalStatus === 'RETRIEVED'), graphLeads, {
      identityConfidence: identityCluster.ambiguous ? 'low' : (identityCluster.userConfirmed ? 'high' : 'medium'),
    }),
    variations: semanticVariations(
      keepTopic || extraContext(classification) || ((classification.type === 'technique' || classification.type === 'skill' || classification.type === 'object') ? classification.subject : ''),
      ranked,
      { excludeCurrent: true },
    ),
    accounts: (premiumContent || []).concat(ranked.filter(r => r.contentType === 'account').map(r => ({
      url: r.url, title: r.title, domain: r.domain, platform: r.accountPlatform, handle: r.accountHandle,
      ownership: r.accountOwnership, status: r.impersonator ? 'unverified' : 'current',
      impersonator: !!r.impersonator, rejectedReason: r.rejectedReason || '',
      contentType: 'account',
    }))).slice(0, 24),
    rejectedCandidates: [
      ...(visualIdentity.dropped || []).slice(0, 8).map(im => ({ kind: 'visual', url: im.url, title: im.title, reason: im.reason || im.collision || im.visualClassReason || '' })),
      ...ranked.filter(r => r.impersonator || r.matchQuality === 'unrelated').slice(0, 8).map(r => ({ kind: 'result', url: r.url, title: r.title, reason: r.rejectedReason || r.matchQualityReason || '' })),
    ],
    whatCarmenChecked: buildWhatCarmenChecked({
      variants,
      sourceClasses: sourceClassesReached,
      aliases: [...new Set([classification.subject, ...((identity && identity.aliases) || []), ...(adaptive.aliases || [])])].filter(Boolean),
      providers: diagnostics,
      topicMap,
      uniqueResults: ranked.length,
      duplicates: (additive.duplicatesRemoved || 0) + (additive.nearDuplicatesRemoved || 0),
      inaccessible: ranked.filter(r => /BLOCKED|UNAVAILABLE|AUTHENTICATION_REQUIRED|PAYWALLED/.test(r.accessState || '')).length,
      intents: intent.retrievalIntents,
      adaptive: adaptiveTrace(adaptive),
      iterations: adaptive.iterations,
      pathsRemaining: adaptive.pathsRemaining,
      visualPaths: adaptive.visualPaths,
      accountPaths: adaptive.accountPaths,
      topicVariants: adaptive.topicVariants,
      linkChainDepth: adaptive.linkChainDepth,
    }),
    whyDidYouStop: buildWhyDidYouStop({
      uniqueResults: ranked.length,
      duplicates: (additive.duplicatesRemoved || 0) + (additive.nearDuplicatesRemoved || 0),
      inaccessible: ranked.filter(r => /BLOCKED|UNAVAILABLE|AUTHENTICATION_REQUIRED|PAYWALLED/.test(r.accessState || '')).length,
      filtered: (visualIdentity.dropped || []).length + ranked.filter(r => r.impersonator).length,
      variants,
      sourceClasses: sourceClassesReached,
      aliases: [...new Set([classification.subject, ...((identity && identity.aliases) || []), ...(adaptive.aliases || [])])].filter(Boolean),
      exhausted: !!additive.exhausted || (adaptive.stopKind === 'A' || adaptive.stopKind === 'B'),
      budgetHit: adaptive.stopKind === 'E' || remainingFetches() <= 2 || SEARCH_BUDGET.used >= SEARCH_BUDGET.max,
      identityInsufficient: !!identityCluster.ambiguous && !(intent.identityFeedback && (intent.identityFeedback.confirmed || []).length),
      diminishingReturns: !!additive.exhausted || (additive.genuinelyNew === 0 && (opts.priorResults || []).length > 0) || adaptive.stopKind === 'C',
      unretrievable: ranked.some(r => r.retrievalStatus === 'RETRIEVAL_FAILED') && !ranked.some(r => r.provenance === 'RETRIEVED' || r.retrievalStatus === 'RETRIEVED'),
      adaptive,
      adaptiveStopKind: adaptive.stopKind,
      adaptiveHeadline: adaptive.headline,
      iterations: adaptive.iterations,
      pathsRemaining: adaptive.pathsRemaining,
      pathsRemainingCount: (adaptive.pending || []).length,
      zeroNoveltyStreak: adaptive.zeroNoveltyStreak,
      providerUnavailable: adaptive.stopKind === 'D',
    }),
    adaptiveInvestigation: adaptiveTrace(adaptive),
    negativeReport: negativeResultReport({
      sourceClasses: sourceClassesReached,
      variants,
      aliases: [...new Set([classification.subject])].filter(Boolean),
      found: ranked.slice(0, 8).map(r => ({ url: r.url, title: r.title })),
      notFound: [],
      inaccessible: ranked.filter(r => /BLOCKED|UNAVAILABLE|AUTHENTICATION_REQUIRED|PAYWALLED/.test(r.accessState || '')).map(r => ({ url: r.url, accessState: r.accessState })),
      identityInsufficient: !!identityCluster.ambiguous,
    }),
    researchFocus,
    investigationQueue: investigationState.investigationQueue,
    investigationState,
    remainingWork: investigationState.remainingWork || [],
    remainingQueue: queueSummary,
    resumable: !!investigationState.resumable,
    investigationComplete: adaptive.stopKind === 'A' || adaptive.stopKind === 'B' ? true : false,
    stopKind: (resourceStop && resourceStop.stopKind) || adaptive.stopKind || '',
    stopHeadline: (resourceStop && resourceStop.headline) || adaptive.headline || '',
    verifiedVisuals: visualIdentity.kept,
    rejectedVisuals: (visualIdentity.dropped || []).filter(im => im.visualGate === 'rejected'),
    unverifiedVisuals: (visualCorpus || []).filter(im => im.unverifiedVisual || im.visualGate === 'unverified'),
    adaptiveLenses: adaptiveLensesForFocus(researchFocus, classification),
    identityPhase: !!identityHold,
  };
}

function applyQuestionToClassification(classification, question) {
  const out = classification || {};
  const q = String(question || '').trim();
  if (!q) return out;
  const domain = extractRequestedSourceDomain(q);
  if (domain) out.requestedSourceDomain = domain;
  const ins = parseInvestigativeQuestion(q, out);
  const placeholder = !out.context || /^adult content$/i.test(out.context);
  if (ins.topic && placeholder) {
    out.context = ins.topic;
    out.relation = detectRelation(ins.topic) || out.relation || 'context';
  }
  return out;
}

function classifyHandler(req) {
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') || '').trim().slice(0, 500);
  const hint = (u.searchParams.get('type') || u.searchParams.get('subject') || '').trim();
  const adultRaw = u.searchParams.get('adult') || u.searchParams.get('adultContent');
  const adult = (adultRaw == null || adultRaw === '') ? 'on' : normalizeAdult(adultRaw);
  const classification = applyQuestionToClassification(applyResearchFilter(classifyQuery(q, hint), adult, q), u.searchParams.get('question') || '');
  const depth = normalizeDepth(u.searchParams.get('depth') || '', classification);
  const interpreted = interpretRequest(classification, u.searchParams.get('question') || '');
  const researchFocus = parseResearchFocus(u.searchParams.get('focus') || u.searchParams.get('researchFocus') || hint, { type: hint || classification.type, tutorialIntent: isTutorialIntent(q) });
  const adaptiveLenses = adaptiveLensesForFocus(researchFocus, classification);
  return json({
    classification,
    depth,
    researchFocus,
    lenses: adaptiveLenses.length ? adaptiveLenses : interestLenses(classification.type, classification),
    adaptiveLenses,
    investigationChoices: investigationChoices(classification.type, classification),
    paths: researchPaths(classification.type, classification),
    concepts: interpreted.concepts,
    conceptGraph: interpreted.graph,
    lanes: discoveryLanes(classification, depth).lanes,
    interpretations: ambiguousInterpretations(q, classification),
  }, 200, req);
}

async function searchWeb(req) {
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') || '').trim().slice(0, 500);
  const hint = (u.searchParams.get('type') || u.searchParams.get('subject') || '').trim();
  const expanded = u.searchParams.get('expanded') === '1' || u.searchParams.get('expanded') === 'true';
  const visualMore = u.searchParams.get('visualMore') === '1' || u.searchParams.get('visualMore') === 'true';
  const visualMode = (u.searchParams.get('visualMode') || '').trim();
  const visualOffset = u.searchParams.get('visualOffset') || '0';
  const videoMore = u.searchParams.get('videoMore') === '1' || u.searchParams.get('videoMore') === 'true';
  const attemptedQueries = parseAttemptedList(u.searchParams.get('attempted') || u.searchParams.get('attemptedQueries') || '');
  const knownMedia = parseAttemptedList(u.searchParams.get('knownMedia') || '');
  const knownVideoIds = parseAttemptedList(u.searchParams.get('knownVideos') || u.searchParams.get('knownVideoIds') || '');
  const excludeUrls = (u.searchParams.get('exclude') || u.searchParams.get('excludeUrls') || '').split(',').map(s => s.trim()).filter(Boolean);
  const excludeHosts = (u.searchParams.get('excludeHosts') || '').split(',').map(s => s.trim()).filter(Boolean);
  let seedVisual = null;
  try {
    if (u.searchParams.get('seedVisual')) seedVisual = JSON.parse(u.searchParams.get('seedVisual'));
  } catch {}
  const adultRaw = u.searchParams.get('adult') || u.searchParams.get('adultContent');
  const adult = (adultRaw == null || adultRaw === '') ? 'on' : normalizeAdult(adultRaw);
  const depth = u.searchParams.get('depth') || '';
  const entity = (u.searchParams.get('entity') || '').trim().slice(0, 200);
  const topic = (u.searchParams.get('topic') || u.searchParams.get('question') || '').trim().slice(0, 200);
  const findEverything = u.searchParams.get('findEverything') === '1' || u.searchParams.get('everything') === '1' || /find everything|everything related/i.test(q);
  const premiumAccounts = u.searchParams.get('premium') === '1' || u.searchParams.get('premiumAccounts') === '1' || /premium accounts?/i.test(q);
  const intentMode = (u.searchParams.get('mode') || u.searchParams.get('intent') || '').trim();
  const findMore = u.searchParams.get('findMore') === '1' || intentMode === 'find-more';
  const moreLikeThis = u.searchParams.get('moreLikeThis') === '1' || intentMode === 'more-like-this';
  const findDifferent = u.searchParams.get('findDifferent') === '1' || intentMode === 'find-different';
  const findSimilar = u.searchParams.get('findSimilar') === '1' || intentMode === 'find-similar';
  const searchThisVisual = u.searchParams.get('searchThisVisual') === '1' || intentMode === 'search-this-visual';
  const moreFromThisSource = u.searchParams.get('moreFromThisSource') === '1' || intentMode === 'more-from-this-source';
  const moreFromThisPerson = u.searchParams.get('moreFromThisPerson') === '1' || intentMode === 'more-from-this-person';
  const moreOnThisTopic = u.searchParams.get('moreOnThisTopic') === '1' || intentMode === 'more-on-this-topic';
  const diveLens = (u.searchParams.get('diveLens') || '').trim().toLowerCase();
  const resolvedMode = intentMode
    || (diveLens === 'bondage' || u.searchParams.get('diveBondage') === '1' ? 'dive-bondage' : '')
    || (diveLens === 'people' || u.searchParams.get('divePeople') === '1' ? 'dive-people' : '')
    || (diveLens === 'visuals' || diveLens === 'clothing' || u.searchParams.get('diveVisuals') === '1' || u.searchParams.get('diveClothing') === '1' ? 'dive-visuals' : '');

  const confirmed = (u.searchParams.get('confirmedIdentity') || '').split(',').map(x => x.trim()).filter(Boolean);
  const rejectedPeople = (u.searchParams.get('rejectedPeople') || '').split(',').map(x => x.trim()).filter(Boolean);
  const rejectedImages = (u.searchParams.get('rejectedImages') || '').split(',').map(x => x.trim()).filter(Boolean);
  const researchFocus = u.searchParams.get('focus') || u.searchParams.get('researchFocus') || '';
  const resume = u.searchParams.get('resume') === '1' || u.searchParams.get('resume') === 'true';
  const confirmIdentity = u.searchParams.get('confirmIdentity') === '1' || u.searchParams.get('confirmIdentity') === 'true' || intentMode === 'confirm-identity';
  const identityPhase = u.searchParams.get('identityPhase') === '1' || u.searchParams.get('identityPhase') === 'true';
  const pendingQueue = parseAttemptedList(u.searchParams.get('pendingQueue') || '');
  let resumeQueue = null;
  try {
    if (u.searchParams.get('investigationQueue')) resumeQueue = JSON.parse(u.searchParams.get('investigationQueue'));
  } catch {}
  if (!resumeQueue && pendingQueue.length) {
    resumeQueue = { pending: pendingQueue.map(q => ({ q, family: 'resume', why: 'resumed queued investigation path', lane: 'resume', kind: 'web' })), attemptedQueries: attemptedQueries };
  }
  const fixture = (u.searchParams.get('fixture') || '').trim();
  const diagnostic = u.searchParams.get('diagnostic') === '1' || u.searchParams.get('diagnostic') === 'true';
  let priorResults = [];
  try {
    const raw = u.searchParams.get('prior');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) priorResults = parsed.slice(0, 40);
    }
  } catch {}
  let graphLeads = [];
  try {
    const raw = u.searchParams.get('graphLeads');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) graphLeads = parsed.slice(0, 16);
    }
  } catch {}
  const photoInput = u.searchParams.get('photo') === '1' || u.searchParams.get('photoInput') === '1';
  if (!q && !seedVisual && !photoInput) return json({ results: [], query: '', count: 0, providers: {}, classification: applyResearchFilter(classifyQuery(''), adult, ''), expanded: false, adultContent: adult, depth: normalizeDepth(depth), researchMetrics: buildResearchMetrics([], {}) }, 200, req);
  const searchQ = q || (seedVisual && (seedVisual.title || seedVisual.caption)) || 'visual investigation';
  const searchHint = hint || ((photoInput || seedVisual) && !q ? 'visuals' : '');
  resetFetchBudget();
  const discovery = await runDiscovery(searchQ, {
    hint: searchHint, enrich: true, expanded, visualMore, visualMode: visualMode || (photoInput || seedVisual ? 'searchvisual' : ''), visualOffset, videoMore,
    excludeUrls, excludeHosts, seedVisual, adult, depth, attemptedQueries, knownMedia, knownVideoIds,
    entity, topic, findEverything, premiumAccounts, mode: resolvedMode, findMore, moreLikeThis, findDifferent,
    findSimilar, searchThisVisual, moreFromThisSource, moreFromThisPerson, moreOnThisTopic,
    identityFeedback: { confirmed, rejectedPeople, rejectedHosts: excludeHosts, rejectedImages },
    priorResults,
    diveLens: diveLens || (resolvedMode.startsWith('dive-') ? resolvedMode.replace(/^dive-/, '') : ''),
    graphLeads,
    fixture,
    diagnostic,
    researchFocus,
    resume,
    resumeQueue,
    confirmIdentity,
    identityPhase,
    wantVisual: researchFocus.split(/[,+|]/).map(s => s.trim().toLowerCase()).includes('visuals') || visualMore || !!visualMode,
  });
  return json(discovery, 200, req);
}

// --- AI provider --------------------------------------------------------------
// Carmen talks to OpenRouter's OpenAI-compatible Chat Completions API.
// There is no silent fallback to api.openai.com / gpt-4.1-mini.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'openrouter/free';
const OPENAI_HOST_RE = /(^|\.)openai\.com$/i;

/** Resolve AI secret: prefer API_KEY, fall back to Api_key (existing CF binding name). */
function getApiKey(env) {
  return env.API_KEY || env.Api_key || '';
}

function trimmedEnv(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function getAiConfig(env) {
  const apiKey = getApiKey(env);
  let apiUrl = trimmedEnv(env.API_URL) || OPENROUTER_URL;
  let model = trimmedEnv(env.MODEL) || OPENROUTER_MODEL;
  let host = '';
  try { host = new URL(apiUrl).hostname.toLowerCase(); } catch {
    apiUrl = OPENROUTER_URL;
    host = 'openrouter.ai';
  }
  // Leftover OpenAI env vars must not hijack the provider.
  if (OPENAI_HOST_RE.test(host) || /^gpt-4\.1-mini$/i.test(model)) {
    apiUrl = OPENROUTER_URL;
    model = OPENROUTER_MODEL;
    host = 'openrouter.ai';
  }
  const provider = (host === 'openrouter.ai' || host.endsWith('.openrouter.ai')) ? 'openrouter' : (host || 'openrouter');
  return { apiKey, apiUrl, model, provider, configured: !!apiKey };
}

function extractMessageContent(j) {
  const choice = j?.choices?.[0];
  const raw = choice?.message?.content ?? choice?.text ?? '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw.map(part => {
      if (typeof part === 'string') return part;
      if (part && typeof part.text === 'string') return part.text;
      if (part && typeof part.content === 'string') return part.content;
      return '';
    }).join('');
  }
  return '';
}

function isUnusableAnalysis(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (/^user safety:\s*safe\.?$/i.test(t)) return true;
  if (t.length < 48 && /user safety|^\s*safe\s*$/i.test(t) && !/\b(OBSERVED|INFERRED|UNKNOWN)\b/i.test(t)) return true;
  return false;
}

function analysisExcerpts(retrieved, discoveryResults, all) {
  const ok = (retrieved || []).filter(x => x && x.status === 'RETRIEVED' && !x.redirectToHomepage);
  const cap = all ? 4 : 3;
  const charCap = all ? 400 : 560;
  const pri = (x) => {
    const k = String(x.resultKind || '');
    if (k === 'INTERSECTION_MATCH' || k === 'INTERVIEW_MATCH' || x.intersection) return 0;
    return 4;
  };
  const ranked = [...ok].sort((a, b) => pri(a) - pri(b));
  return ranked.slice(0, cap).map(x => ({
    title: x.title,
    url: x.url,
    requestedUrl: x.requestedUrl || x.url,
    finalUrl: x.finalUrl || x.url,
    redirected: !!x.redirected,
    provenance: 'RETRIEVED',
    accessState: x.accessState || 'DIRECTLY_RETRIEVED',
    excerpt: String(x.textExcerpt || x.text || '').slice(0, charCap),
  }));
}

async function provider(env, messages, temperature = 0.2) {
  const cfg = getAiConfig(env);
  if (!cfg.apiKey) throw Error('AI provider is not configured. Add the API_KEY Worker secret before using Carmen AI.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    if (FETCH_COUNT >= FETCH_HARD_CAP) {
      const err = new Error('Research budget reached');
      err.name = 'BudgetExhausted';
      throw err;
    }
    FETCH_COUNT++;
    FETCH_KINDS.ai++;
    const r = await fetch(cfg.apiUrl, {
      method: 'POST', signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
        'HTTP-Referer': 'https://carmen-iphone-v25.94bwfd5grv.workers.dev/',
        'X-Title': 'Carmen',
      },
      body: JSON.stringify({ model: cfg.model, temperature, messages }),
    });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { throw Error(`AI provider returned HTTP ${r.status}`); }
    if (!r.ok) {
      const msg = (j && j.error && (j.error.message || j.error)) || `AI provider returned HTTP ${r.status}`;
      throw Error(typeof msg === 'string' ? msg : `AI provider returned HTTP ${r.status}`);
    }
    return j;
  } finally { clearTimeout(timer); }
}

const CARMEN_SYSTEM = 'You are Carmen, a conservative AI research assistant for adult users. Be concise and useful. Clearly distinguish OBSERVED (directly stated/visible), INFERRED (labeled interpretation), and UNKNOWN. Never invent facts, sources, URLs, dates, or evidence. Never claim something was saved or sent unless the user explicitly requested it. Never autonomously contact people, send messages, post, comment, submit forms, make purchases, create accounts, perform transactions, or take any external action. You may research, analyze, organize, and prepare information only. Never bypass, evade, or circumvent paywalls, logins, age gates, CAPTCHAs, DRM, robots, or other access controls. Never claim you retrieved paywalled, login-gated, age-gated, or blocked content. Public titles, search snippets, and thumbnails are not the protected content — label them as referenced public evidence only. If the original source cannot be accessed, say so honestly and look for legitimate public alternatives. If the only remaining relevant source is paywalled, say clearly: Absolutely cannot retrieve due to paywall. Adult Content is a research lens, not an entity type. When Adult content is ON, prioritize adult-industry career, productions, public media, interviews, and collaborators over generic celebrity trivia; general biography is secondary unless it identifies or explains the adult context. If a specific concept is present with Adult ON, research entity × concept × adult lens as one target. Adult context does not lower evidence discipline. For sexual or self-bondage topics, do not provide explicit step-by-step sexual or self-bondage instructions; you may organize public sources, terminology, visual references, and research questions. For general skills and crafts you may outline procedures only when they are grounded in retrieved sources. Visual likeness is not identity proof. For important claims distinguish KNOWN, PROBABLE, UNCERTAIN, CONTRADICTED, and NOT YET ESTABLISHED. For each meaningful conclusion preserve SOURCE SAYS / INFERENCE / UNVERIFIED. End with NEXT HIGH-VALUE STEP. Deep Dive discoveries are temporary research unless the user explicitly chooses Save or Keep.';

async function chat(req, env) {
  try {
    const b = await req.json();
    const subject = b.subject ? `Investigation subject: ${JSON.stringify(b.subject)}. ` : '';
    const messages = [{ role: 'system', content: CARMEN_SYSTEM + ' ' + subject + 'Context: ' + JSON.stringify(b.context || {}) }];
    for (const m of Array.isArray(b.messages) ? b.messages : []) {
      if (m && typeof m.content === 'string') messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.slice(0, 20000) });
    }
    const j = await provider(env, messages, 0.3);
    return json({ text: extractMessageContent(j) }, 200, req);
  } catch (e) { return json({ error: e?.name === 'AbortError' ? 'AI provider timed out.' : e?.message || String(e) }, 500, req); }
}

function validateImage(x) {
  if (typeof x !== 'string' || !x.startsWith('data:image/')) throw Error('imageDataUrl must be an image data URL');
  if (x.length > 16000000) throw Error('Image is too large. Use a smaller screenshot.');
}

function parseModelJson(raw) {
  const clean = String(raw || '').trim();
  if (!clean) throw Error('AI provider returned invalid JSON.');
  const candidates = [clean];
  const unfenced = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (unfenced && unfenced !== clean) candidates.push(unfenced);
  const fence = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) candidates.push(fence[1].trim());
  for (const c of candidates) {
    try { return JSON.parse(c); } catch {}
    const a = c.indexOf('{'), b = c.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(c.slice(a, b + 1)); } catch {} }
  }
  throw Error('AI provider returned invalid JSON.');
}

async function structuredVision(req, env, body, mode) {
  if (!getApiKey(env)) throw Error('AI provider is not configured. Add the API_KEY Worker secret before using Carmen AI.');
  let content;
  if (mode === 'analyze') {
    validateImage(body.imageDataUrl);
    content = [
      { type: 'text', text: 'You are Carmen, a conservative visual-evidence analyst. Return ONLY valid JSON with exactly these keys: title, observations, inferences, unknowns, relationships, candidatePatterns, signature, audit. Observations are directly visible only. Inferences are labeled interpretations. Never invent identity, intent, ownership, price, location, safety, authenticity, or obscured details. CandidatePatterns are hypotheses, not facts. Page URL: ' + String(body.pageUrl || '') + '\nSource type: ' + String(body.sourceType || 'web') + '\nSource name: ' + String(body.sourceName || '') + '\nContext: ' + String(body.pageContext || '') },
      { type: 'image_url', image_url: { url: body.imageDataUrl } },
    ];
  } else {
    const refs = Array.isArray(body.references) ? body.references : [];
    if (refs.length < 2) throw Error('Select at least 2 saved references to compare.');
    if (refs.length > 4) throw Error('Compare up to 4 references at once.');
    content = [{ type: 'text', text: 'You are Carmen performing conservative evidence synthesis. Return ONLY valid JSON with exactly these keys: summary, consistentFindings, differences, candidatePatterns, leads, unknowns, audit. Compare only visible or explicitly supplied evidence. Do not identify people or infer intent, ownership, price, location, authenticity, or hidden facts. User question: ' + String(body.question || 'Compare these references and identify useful similarities, differences, and patterns.') }];
    refs.forEach((r, i) => {
      content.push({ type: 'text', text: `REFERENCE ${i + 1}: ${String(r.title || 'Untitled')} | URL: ${String(r.url || '')} | Source type: ${String(r.sourceType || 'web')} | Source name: ${String(r.sourceName || '')} | Context: ${String(r.context || '')}` });
      if (typeof r.imageDataUrl === 'string' && r.imageDataUrl.startsWith('data:image/')) { validateImage(r.imageDataUrl); content.push({ type: 'image_url', image_url: { url: r.imageDataUrl } }); }
    });
  }
  const j = await provider(env, [{ role: 'user', content }], 0);
  return parseModelJson(extractMessageContent(j));
}

async function analyzeExactSource(req, env, body, context = {}) {
  resetFetchBudget();
  const pipeline = [];
  const mark = (state, note) => {
    pipeline.push({ state, note: note || EXACT_SOURCE_PIPELINE_LABELS[state] || state, at: new Date().toISOString() });
  };
  const evidence = body && body.evidence && typeof body.evidence === 'object' ? body.evidence : (body || {});
  const requestedUrl = String(evidence.url || evidence.pageUrl || (body && (body.pageUrl || body.url)) || context.url || '').trim();
  const subject = String((body && body.subject) || evidence.subject || context.subject || '').trim();
  const topic = String((body && body.topic) || evidence.topic || context.topic || '').trim();
  if (!requestedUrl) {
    const debug = buildSourceDebug({
      fetchAttempted: false,
      terminalState: 'FETCH_FAILED',
      whyStopped: 'No exact URL on the source card. Analyze does not reconstruct the investigation from a platform or person name.',
      whatRetrieved: 'nothing — exact URL missing',
      genericSearchUsedAsRetrieval: false,
    });
    return {
      kind: 'empty',
      ok: false,
      error: 'Exact URL is required. Analyze does not reconstruct an investigation from a platform name.',
      debug,
      sourceDebug: debug,
      terminalState: 'FETCH_FAILED',
      genericSearchUsedAsRetrieval: false,
      neverBypassAuth: true,
      seeds: [],
      pipeline,
    };
  }
  mark('DISCOVERED', 'Analyzing exact source ' + requestedUrl);
  const identity = exactSourceIdentity(requestedUrl, {
    subject,
    handle: (body && body.handle) || evidence.handle || evidence.accountHandle || '',
    displayName: (body && body.title) || evidence.title || '',
  });
  mark('URL_CANONICALIZED', identity.canonicalUrl);
  const kind = identity.sourceType === 'reddit-post' ? 'reddit'
    : (identity.sourceType.indexOf('onlyfans') === 0 || identity.sourceType.indexOf('-profile') >= 0 ? 'account'
      : analyzePayloadKind({ ...(body || {}), url: identity.canonicalUrl }));

  mark('FETCH_ATTEMPTED', 'Fetching exact source ' + identity.canonicalUrl);
  let retrieved = null;
  try {
    retrieved = await retrieveExactSource(identity.canonicalUrl, { identity, requestedUrl });
  } catch (e) {
    retrieved = {
      status: 'RETRIEVAL_FAILED',
      accessState: e?.name === 'AbortError' ? 'UNAVAILABLE' : 'UNAVAILABLE',
      error: String(e.message || e).slice(0, 200),
      url: identity.canonicalUrl,
    };
  }

  const access = (retrieved && retrieved.accessState) || '';
  const genericShell = !!(retrieved && (retrieved.genericPlatformShell || retrieved.redirectToHomepage && /onlyfans|fansly|loyalfans|manyvids|patreon/i.test(identity.host)));
  const platformOnlyTitle = /^(onlyfans|fansly|loyalfans|manyvids|patreon|reddit)$/i.test(String((retrieved && retrieved.title) || '').trim());
  const genericReddit = identity.sourceType === 'reddit-post' && (!retrieved || !retrieved.redditPost) && (platformOnlyTitle || !!(retrieved && retrieved.genericPlatformShell));
  const authRequired = genericShell
    || /AUTHENTICATION_REQUIRED|PAYWALLED|AGE_RESTRICTED/i.test(access)
    || (platformOnlyTitle && /onlyfans|fansly|loyalfans|manyvids/i.test(identity.host));
  const publicMeta = !!(retrieved && !genericShell && !genericReddit && (retrieved.title || retrieved.description || retrieved.publicEvidence || retrieved.ogImage || retrieved.author || retrieved.subreddit || (retrieved.identifiers && ((retrieved.identifiers.handles || []).length || (retrieved.identifiers.aliases || []).length))));
  const fetchSucceeded = !!(retrieved && retrieved.status === 'RETRIEVED' && !genericShell && !genericReddit && !authRequired);
  const publicContentRetrieved = fetchSucceeded || (!genericShell && !genericReddit && publicMeta && (authRequired || (retrieved && retrieved.status === 'RETRIEVAL_FAILED')));
  if ((genericShell || genericReddit) && retrieved) {
    retrieved.title = genericReddit ? (identity.displayName || ('Reddit post ' + (identity.postId || ''))) : (identity.displayName || identity.handle || retrieved.title);
    retrieved.genericPlatformShell = true;
    retrieved.accessState = retrieved.accessState || (genericReddit ? 'NOT_PUBLICLY_RETRIEVABLE' : 'AUTHENTICATION_REQUIRED');
    retrieved.status = 'RETRIEVAL_FAILED';
  }
  if (fetchSucceeded) mark('FETCHED', identity.canonicalUrl);
  else mark(authRequired ? 'AUTHENTICATION_REQUIRED' : 'FETCH_ATTEMPTED', (retrieved && (retrieved.accessNote || retrieved.error)) || 'exact URL fetch did not return public content');

  const excerpt = fetchSucceeded
    ? String(retrieved.textExcerpt || retrieved.description || retrieved.text || '').slice(0, 4000)
    : String((retrieved && (retrieved.publicEvidence || retrieved.description || retrieved.title)) || '').slice(0, 1200);

  let parsedReddit = retrieved && retrieved.redditPost ? { ok: true, post: retrieved.redditPost, comments: retrieved.comments || [], outboundLinks: retrieved.outboundLinks || [], media: retrieved.images || [] } : null;
  if (!parsedReddit && retrieved && retrieved.redditJson) {
    parsedReddit = parseRedditListing(retrieved.redditJson, identity.canonicalUrl);
  }

  mark('PARSED');
  const links = [];
  const media = [];
  if (parsedReddit && parsedReddit.ok) {
    for (const l of parsedReddit.outboundLinks || []) links.push(l);
    for (const m of parsedReddit.media || []) media.push(typeof m === 'string' ? m : m.url);
  }
  if (retrieved) {
    for (const l of extractOutboundLinks(excerpt + ' ' + String(retrieved.description || ''), identity.canonicalUrl)) links.push(l);
    for (const u of (retrieved.relatedUrls || [])) links.push({ url: u, canonicalUrl: canonicalizeExactSourceUrl(u), host: hostOf(u), parent: identity.canonicalUrl, kind: 'outbound-link', sourceId: sourceIdFromCanonicalUrl(u) });
    for (const u of (retrieved.galleryUrls || [])) links.push({ url: u, canonicalUrl: canonicalizeExactSourceUrl(u), host: hostOf(u), parent: identity.canonicalUrl, kind: 'gallery', sourceId: sourceIdFromCanonicalUrl(u) });
    if (retrieved.ogImage) media.push(retrieved.ogImage);
    for (const im of retrieved.images || []) media.push(im);
  }
  const uniqLinks = [];
  const seenL = new Set();
  for (const l of links) {
    const key = l.canonicalUrl || l.url;
    if (!key || seenL.has(key) || canonicalizeExactSourceUrl(key) === identity.canonicalUrl) continue;
    seenL.add(key);
    uniqLinks.push(l);
  }
  const uniqMedia = [...new Set(media.filter(Boolean))].slice(0, 12);
  mark('MEDIA_EXTRACTED');
  mark('LINKS_EXTRACTED');

  const entities = extractEntitiesFromExcerpt(
    [excerpt, retrieved && retrieved.title, parsedReddit && parsedReddit.post && parsedReddit.post.title, parsedReddit && parsedReddit.post && parsedReddit.post.body, subject].filter(Boolean).join('\n'),
    { subject, handle: identity.handle }
  );
  const topics = extractTopicsFromExcerpt(excerpt + ' ' + (retrieved && retrieved.title || '') + ' ' + topic, { topic });
  mark('ENTITIES_EXTRACTED');
  mark('TOPICS_EXTRACTED');

  const accounts = [];
  if (identity.sourceType.indexOf('-profile') >= 0 || identity.sourceType.indexOf('onlyfans') === 0) {
    accounts.push({ url: identity.canonicalUrl, handle: identity.handle, platform: identity.platform, domain: identity.host });
  }
  if (retrieved && retrieved.identifiers) {
    for (const p of retrieved.identifiers.profiles || []) accounts.push({ url: p, handle: '', platform: hostOf(p), domain: hostOf(p) });
  }
  const seeds = createExactSourceSeeds({
    links: uniqLinks,
    media: uniqMedia,
    entities,
    topics,
    accounts,
    domains: uniqLinks.map(l => ({ host: l.host, url: l.url })),
    referencedPosts: parsedReddit && parsedReddit.ok ? [] : [],
    aliases: entities.aliases,
  }, identity);
  mark('SEEDS_CREATED');

  const corroborationQueries = [];
  const chained = [];
  const hop = uniqLinks.filter(l => l.url && !/onlyfans|fansly|loyalfans/i.test(l.host || '') && !isGenericPlatformDiscoveryQuery(l.url)).slice(0, 2);
  for (const l of hop) {
    if (remainingFetches() < 4) break;
    corroborationQueries.push({ q: l.url, why: 'exact extracted outbound URL', family: 'exact-source-chain' });
    try {
      const child = await retrieveExactSource(l.url, { skipAlt: false, identity: exactSourceIdentity(l.url, { subject }) });
      chained.push({
        url: l.url,
        canonicalUrl: canonicalizeExactSourceUrl(l.url),
        sourceId: sourceIdFromCanonicalUrl(l.url),
        parent: identity.canonicalUrl,
        parentSourceId: identity.sourceId,
        fetchSucceeded: child && child.status === 'RETRIEVED',
        title: child && child.title || '',
        accessState: child && child.accessState || '',
        excerpt: child && String(child.textExcerpt || child.description || '').slice(0, 400),
        provenance: 'EXTRACTED',
        foundThrough: 'exact-source',
      });
    } catch {}
  }
  if (corroborationQueries.length) mark('CORROBORATION_SEARCHED', 'Corroborating extracted outbound URLs — not a platform search');

  const accountPlan = /onlyfans|fansly|loyalfans|manyvids|patreon/i.test(identity.host)
    ? { ...analyzePublicAccountPlan(identity.canonicalUrl, { subject, type: 'person' }, { handle: identity.handle, subject }), queries: [], usedAsRetrieval: false }
    : null;

  const terminalState = terminalStateForExactSource({
    fetchAttempted: true,
    fetchSucceeded,
    publicContentRetrieved,
    authRequired,
    parsed: true,
    seedsCreated: seeds.length > 0,
    accessState: access,
    error: retrieved && retrieved.error,
    providerUnavailable: /UNAVAILABLE|timeout|503/i.test(String((retrieved && retrieved.error) || '') + access),
  });
  if (terminalState === 'ANALYZED') mark('ANALYZED');
  else mark(terminalState);

  const sourceFacts = [];
  sourceFacts.push({ field: 'canonicalUrl', value: identity.canonicalUrl, provenance: 'SOURCE' });
  sourceFacts.push({ field: 'sourceId', value: identity.sourceId, provenance: 'SOURCE' });
  sourceFacts.push({ field: 'sourceType', value: identity.sourceType, provenance: 'SOURCE' });
  if (identity.platform) sourceFacts.push({ field: 'platform', value: identity.platform, provenance: 'SOURCE' });
  if (identity.handle) sourceFacts.push({ field: 'handle', value: identity.handle, provenance: 'SOURCE' });
  if (identity.displayName || (retrieved && retrieved.title)) sourceFacts.push({ field: 'title', value: (retrieved && retrieved.title) || identity.displayName, provenance: publicContentRetrieved ? 'RETRIEVED' : 'SOURCE' });
  if (identity.subreddit) sourceFacts.push({ field: 'subreddit', value: identity.subreddit, provenance: 'SOURCE' });
  if (identity.postId) sourceFacts.push({ field: 'postId', value: identity.postId, provenance: 'SOURCE' });
  if (parsedReddit && parsedReddit.ok && parsedReddit.post) {
    const p = parsedReddit.post;
    if (p.author) sourceFacts.push({ field: 'author', value: p.author, provenance: 'RETRIEVED' });
    if (p.body) sourceFacts.push({ field: 'body', value: p.body.slice(0, 600), provenance: 'RETRIEVED' });
    if (p.score != null) sourceFacts.push({ field: 'score', value: String(p.score), provenance: 'RETRIEVED' });
    if (p.created) sourceFacts.push({ field: 'timestamp', value: p.created, provenance: 'RETRIEVED' });
  }
  if (retrieved && retrieved.description && !sourceFacts.some(f => f.field === 'body')) {
    sourceFacts.push({ field: 'description', value: String(retrieved.description).slice(0, 400), provenance: publicContentRetrieved ? 'RETRIEVED' : 'PUBLIC_METADATA' });
  }
  if (excerpt && fetchSucceeded) sourceFacts.push({ field: 'excerpt', value: excerpt.slice(0, 400), provenance: 'RETRIEVED' });

  const supported = [];
  if (fetchSucceeded) supported.push({ field: 'exactUrlFetched', value: 'YES', provenance: 'RETRIEVED' });
  if (uniqMedia.length) supported.push({ field: 'media', value: String(uniqMedia.length), provenance: 'RETRIEVED' });
  if (uniqLinks.length) supported.push({ field: 'outboundLinks', value: String(uniqLinks.length), provenance: 'RETRIEVED' });
  if (parsedReddit && parsedReddit.comments && parsedReddit.comments.length) supported.push({ field: 'comments', value: String(parsedReddit.comments.length), provenance: 'RETRIEVED' });

  const unknowns = [];
  const inferences = [];
  if (!fetchSucceeded && !publicContentRetrieved) {
    if (identity.sourceType === 'reddit-post') unknowns.push('Exact Reddit post could not be publicly retrieved.');
    else unknowns.push('Exact URL could not be publicly retrieved. Generic platform search was not used as a substitute.');
  }
  if (authRequired) {
    unknowns.push('Authentication required for remaining content. Carmen does not bypass authentication, paywalls, DRM, or access controls.');
  }
  if (kind === 'video' || kind === 'video-url') unknowns.push(videoFrameHonesty().note);
  unknowns.push('Creator vs host vs original publisher are not assumed to be the same unless a source states it.');

  const lifecycle = sourceLifecycleState({
    url: identity.canonicalUrl,
    retrievalStatus: retrieved && retrieved.status,
    provenance: fetchSucceeded ? 'RETRIEVED' : 'FETCH_ATTEMPTED',
    accessState: access,
    terminalState,
  }, {
    analyzed: terminalState === 'ANALYZED',
    verified: fetchSucceeded,
    terminalState,
  });

  const whatRetrieved = fetchSucceeded
    ? ('Exact URL fetched. Title/body/media/links extracted from ' + identity.canonicalUrl)
    : (genericShell
      ? ('Exact URL was requested. The host returned a generic ' + (identity.platform || identity.host) + ' landing page, not this profile. Handle @' + (identity.handle || '') + ' is taken from the exact URL. Remaining content requires authentication.')
      : (publicContentRetrieved
        ? ('Public metadata from ' + identity.canonicalUrl + (authRequired ? ' — remaining content requires authentication.' : ''))
        : (identity.sourceType === 'reddit-post'
          ? 'Exact Reddit post could not be publicly retrieved.'
          : 'Exact URL was not retrieved. Nothing from a generic platform search is claimed as this source.')));

  const whyStopped = terminalState === 'ANALYZED'
    ? (authRequired ? 'Public profile/page analyzed. Authentication required for remaining content.' : 'Exact source analyzed.')
    : (terminalState === 'AUTHENTICATION_REQUIRED' || genericShell
      ? (genericShell
        ? ('The exact URL resolved to a generic ' + (identity.platform || 'platform') + ' page, not this profile. Authentication required for remaining content. Generic platform discovery was not used as a substitute.')
        : 'Authentication required for remaining content. Public metadata ' + (publicContentRetrieved ? 'was' : 'was not') + ' retrieved from the exact URL.')
      : (identity.sourceType === 'reddit-post'
        ? 'Exact Reddit post could not be publicly retrieved.'
        : 'Exact URL fetch did not succeed. Generic platform discovery is not a substitute.'));

  const debug = buildSourceDebug({
    canonicalUrl: identity.canonicalUrl,
    requestedUrl,
    sourceId: identity.sourceId,
    sourceType: identity.sourceType,
    fetchAttempted: true,
    fetchSucceeded,
    parseSucceeded: !!(fetchSucceeded || publicContentRetrieved || (parsedReddit && parsedReddit.ok)),
    publicContentRetrieved,
    mediaExtracted: uniqMedia.length > 0,
    linksExtracted: uniqLinks.length > 0,
    entitiesExtracted: (entities.people || []).length > 0 || (entities.aliases || []).length > 0,
    topicsExtracted: topics.length > 0,
    authRequired,
    seedsCreated: seeds.length,
    corroborationQueries,
    terminalState,
    provenance: fetchSucceeded ? 'RETRIEVED' : (publicContentRetrieved ? 'PUBLIC_METADATA' : 'FETCH_ATTEMPTED'),
    pipeline,
    genericSearchUsedAsRetrieval: false,
    parentReceivedSeeds: seeds.length > 0,
    whyStopped,
    whatRetrieved,
  });

  const redditBlock = identity.sourceType === 'reddit-post' || kind === 'reddit' ? {
    platform: 'Reddit',
    subreddit: (parsedReddit && parsedReddit.post && parsedReddit.post.subreddit) || (identity.subreddit ? 'r/' + identity.subreddit : ''),
    postId: (parsedReddit && parsedReddit.post && parsedReddit.post.id) || identity.postId || '',
    author: (parsedReddit && parsedReddit.post && parsedReddit.post.author) || '',
    title: (parsedReddit && parsedReddit.post && parsedReddit.post.title) || (retrieved && retrieved.title) || '',
    body: (parsedReddit && parsedReddit.post && parsedReddit.post.body) || '',
    timestamp: (parsedReddit && parsedReddit.post && parsedReddit.post.created) || '',
    score: parsedReddit && parsedReddit.post ? parsedReddit.post.score : null,
    comments: (parsedReddit && parsedReddit.comments) || [],
    permalink: identity.permalink || identity.canonicalUrl,
    exactUrlFetched: fetchSucceeded ? 'YES' : 'NO',
    postContentRetrieved: !!(parsedReddit && parsedReddit.ok && (parsedReddit.post.title || parsedReddit.post.body)) ? 'YES' : 'NO',
    commentsRetrieved: parsedReddit && parsedReddit.comments && parsedReddit.comments.length ? 'YES' : 'NO',
    mediaReferencesExtracted: uniqMedia.length ? 'YES' : 'NO',
    outboundLinks: uniqLinks.length,
  } : null;

  const profileBlock = /onlyfans|fansly|loyalfans|manyvids/i.test(identity.host) ? {
    platform: identity.platform,
    handle: identity.handle,
    displayName: (retrieved && retrieved.title) || identity.displayName || identity.handle,
    canonicalProfileUrl: identity.canonicalUrl,
    bio: (retrieved && (retrieved.description || retrieved.publicEvidence)) || '',
    publicLinks: uniqLinks.slice(0, 8),
    publicMedia: uniqMedia.slice(0, 8),
    linkedAccounts: accounts.slice(0, 8),
    timestamps: retrieved && retrieved.retrievedAt,
    exactUrlFetched: fetchSucceeded || publicContentRetrieved ? 'YES' : 'NO',
    publicMetadataRetrieved: publicContentRetrieved ? 'YES' : 'NO',
    authenticationRequired: authRequired,
  } : null;

  const safeTitle = (!platformOnlyTitle && !genericShell && retrieved && retrieved.title)
    ? retrieved.title
    : (identity.displayName || identity.handle || (kind + ' evidence'));
  const payload = {
    ok: true,
    kind,
    title: safeTitle,
    identity,
    sourceId: identity.sourceId,
    canonicalUrl: identity.canonicalUrl,
    requestedUrl,
    sourceType: identity.sourceType,
    observations: sourceFacts,
    sourceFacts,
    supportedFacts: supported,
    inferences,
    generalBackground: [],
    unknowns,
    reddit: redditBlock,
    profile: profileBlock,
    media: uniqMedia,
    links: uniqLinks,
    entities,
    topics,
    seeds,
    chainedSources: chained,
    videoFrames: kind === 'video' ? videoFrameHonesty() : undefined,
    retrieved: retrieved ? {
      status: retrieved.status,
      accessState: retrieved.accessState,
      url: retrieved.finalUrl || retrieved.url || identity.canonicalUrl,
      title: retrieved.title || '',
      author: retrieved.author || '',
      subreddit: retrieved.subreddit || '',
    } : null,
    audit: {
      inputKind: kind,
      usedVision: false,
      usedPageBody: fetchSucceeded,
      exactUrl: identity.canonicalUrl,
      genericSearchUsedAsRetrieval: false,
    },
    accountPlan,
    sourceLifecycle: lifecycle,
    publicReferences: [],
    neverBypassAuth: true,
    accessBoundary: lifecycle.accessBoundary,
    note: lifecycle.note,
    debug,
    sourceDebug: debug,
    pipeline,
    terminalState,
    fetchAttempted: true,
    fetchSucceeded,
    parseSucceeded: debug.parseSucceeded,
    publicContentRetrieved,
    authRequired,
    genericSearchUsedAsRetrieval: false,
    whyDidCarmenStop: whyStopped,
    whatCarmenActuallyRetrieved: whatRetrieved,
  };

  if (getApiKey(env) && excerpt && (fetchSucceeded || publicContentRetrieved)) {
    try {
      const j = await provider(env, [{
        role: 'user',
        content: 'You are Carmen. Analyze this retrieved public evidence from the EXACT URL. Return ONLY JSON with keys: sourceFacts, supportedFacts, inferences, generalBackground, unknowns, audit. Distinguish SOURCE FACTS, SUPPORTED FACTS, INFERENCES, GENERAL BACKGROUND, UNKNOWN. Never invent. Never treat a platform name as the source. Evidence kind: ' + kind + '\nCanonical URL: ' + identity.canonicalUrl + '\nSource id: ' + identity.sourceId + '\nTitle: ' + (retrieved && retrieved.title || '') + '\nExcerpt: ' + excerpt.slice(0, 1800),
      }], 0);
      const parsed = parseModelJson(extractMessageContent(j));
      return {
        ...payload,
        sourceFacts: parsed.sourceFacts || payload.sourceFacts,
        supportedFacts: parsed.supportedFacts || payload.supportedFacts,
        inferences: parsed.inferences || [],
        generalBackground: parsed.generalBackground || [],
        unknowns: parsed.unknowns || payload.unknowns,
        observations: parsed.sourceFacts || payload.sourceFacts,
        audit: { ...payload.audit, model: true },
      };
    } catch (e) {
      payload.analysisError = e?.name === 'AbortError' ? 'AI provider timed out.' : String(e.message || e).slice(0, 240);
    }
  }
  return payload;
}

async function analyzeEvidenceObject(req, env, body) {
  return analyzeExactSource(req, env, body || {});
}

async function analyze(req, env) {
  try {
    const body = await req.json();
    const kind = analyzePayloadKind(body);
    if (kind === 'image' || (body && typeof body.imageDataUrl === 'string' && body.imageDataUrl.startsWith('data:image/'))) {
      return json(await structuredVision(req, env, body, 'analyze'), 200, req);
    }
    return json(await analyzeEvidenceObject(req, env, body || {}), 200, req);
  } catch (e) {
    return json({ error: e?.name === 'AbortError' ? 'AI provider timed out.' : e?.message || String(e) }, 500, req);
  }
}
async function synthesize(req, env) { try { return json(await structuredVision(req, env, await req.json(), 'synthesize'), 200, req); } catch (e) { return json({ error: e?.name === 'AbortError' ? 'AI provider timed out.' : e?.message || String(e) }, 500, req); } }

async function imageProxy(req) {
  const target = new URL(req.url).searchParams.get('u') || '';
  if (!/^https?:\/\//i.test(target)) return new Response('Bad image URL', { status: 400, headers: cors(req) });
  let host = '';
  try { host = new URL(target).hostname; } catch { return new Response('Bad image URL', { status: 400, headers: cors(req) }); }
  if (PRIVATE_HOST_RE.test(host) || BLOCKED_HOSTS.has(host.toLowerCase())) {
    return new Response('Blocked host', { status: 403, headers: cors(req) });
  }
  try {
    const r = await fetchText(target, {
      headers: { ...BROWSER_HEADERS, accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', referer: new URL(target).origin + '/' },
      redirect: 'follow',
    }, 8000);
    if (!r.ok) return new Response('Upstream ' + r.status, { status: 502, headers: cors(req) });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct && !ct.startsWith('image/') && !ct.includes('octet-stream') && !ct.includes('binary')) {
      return new Response('Not an image', { status: 415, headers: cors(req) });
    }
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 2500000) return new Response('Too large', { status: 413, headers: cors(req) });
    return new Response(buf, {
      status: 200,
      headers: {
        ...cors(req),
        'content-type': ct.startsWith('image/') ? ct.split(';')[0] : 'image/jpeg',
        'cache-control': 'public, max-age=86400',
      },
    });
  } catch (e) {
    return new Response('Image fetch failed', { status: 502, headers: cors(req) });
  }
}

function collectDiveImages(retrieved, results, classification) {
  const out = [], seen = new Set();
  const adult = (classification && classification.adultContent) || 'off';
  const extraCtx = extraContext(classification).toLowerCase();
  const ctxTerms = contextTermsForScore(classification);
  const subject = String((classification && classification.subject) || '').toLowerCase();
  const add = (url, pageUrl, source, extra = {}) => {
    const u = usableImage(url);
    if (!u) return;
    const key = u.replace(/[?#].*$/, '');
    if (seen.has(key)) return;
    seen.add(key);
    const stock = isStockImage(u);
    const domain = hostOf(pageUrl || u).replace(/^www\./, '');
    const blob = ((pageUrl || '') + ' ' + domain + ' ' + (source || '') + ' ' + (extra.caption || '')).toLowerCase();
    let relevance = stock ? 0 : extra.kind === 'og' ? 4 : extra.kind === 'page' ? 3 : extra.kind === 'index' ? 2 : 1;
    let reason = extra.caption || (stock ? 'Possible stock/generic image — not identity proof' : 'Image keeps page provenance. Visual likeness is not identity proof.');
    let confidence = 'medium';
    const entityOnPage = !subject || subject.split(/\s+/).filter(t => t.length > 1).every(t => blob.includes(t));
    const matchedCtx = ctxTerms.filter(t => blob.includes(t));
    if (adult === 'on' || adult === 'both') {
      if (ADULT_HOST_RE.test(domain) || ADULT_PATH_RE.test(pageUrl || '') || ADULT_EVIDENCE_RE.test(blob)) {
        relevance += 5;
        reason = 'Public adult-context visual from ' + domain + '. Visual likeness is not identity proof.';
        confidence = 'medium';
      }
      if (GENERIC_BIO_HOST_RE.test(domain) || /portrait|headshot|wiki/i.test(blob)) {
        relevance -= 4;
        reason = 'Generic/biographical image — weak for the requested adult context. Not identity proof.';
        confidence = 'low';
      }
    }
    if (matchedCtx.length && entityOnPage) {
      relevance += 6;
      reason = 'Image from a page linking the entity to “' + matchedCtx.slice(0, 2).join(', ') + '”. Visual likeness is not identity proof.';
      confidence = 'medium';
    } else if (ctxTerms.length && extraCtx && (adult === 'on')) {
      relevance -= 3;
    }
    out.push({
      url: u,
      sourceUrl: u,
      pageUrl: pageUrl || '',
      domain,
      source: source || 'retrieved page',
      kind: extra.kind || (stock ? 'stock' : source === 'og:image' ? 'og' : 'page'),
      stock,
      caption: reason,
      reason,
      confidence,
      relevance,
      accessState: extra.accessState || 'DISCOVERED',
      provenance: extra.provenance || (extra.kind === 'page' ? 'RETRIEVED' : 'DISCOVERED'),
      retrievedAt: new Date().toISOString(),
      relationshipToEntity: entityOnPage ? 'page associates this image with the entity' : 'entity association not established',
      relationshipToContext: matchedCtx.length ? 'page associates this image with ' + matchedCtx.slice(0, 3).join(', ') : (extraCtx ? 'requested context not observed on the source page' : ''),
    });
  };
  for (const page of retrieved || []) {
    if (page.ogImage) add(page.ogImage, page.finalUrl || page.url, 'og:image', { kind: 'og', accessState: page.accessState, provenance: page.status });
    for (const img of page.images || []) add(img, page.finalUrl || page.url, page.accessState === 'DIRECTLY_RETRIEVED' ? 'retrieved page' : 'public preview', { kind: 'page', accessState: page.accessState, provenance: page.status });
  }
  for (const r of results || []) {
    if (r.image) add(r.image, r.url, r.source || 'search', { kind: r.imageOrigin === 'image-index' ? 'index' : 'search', accessState: r.accessState, provenance: r.provenance });
    for (const img of r.images || []) add(img, r.url, r.source || 'search', { kind: r.imageOrigin === 'image-index' ? 'index' : 'search', accessState: r.accessState, provenance: r.provenance });
  }
  out.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
  if (adult === 'on') {
    const contextual = out.filter(x => x.relevance >= 5);
    if (contextual.length) return contextual.slice(0, 48);
  }
  return out.slice(0, 48);
}

async function deepDiveHandler(req, env) {
  try {
    const b = await req.json().catch(() => ({}));
    const query = String(b.query || b.subjectQuery || '').trim().slice(0, 500);
    const candidate = b.candidate && typeof b.candidate === 'object' ? b.candidate : null;
    const hint = String(b.subject || b.type || '').trim();
    const selectedEntityIn = (b.selectedEntity && typeof b.selectedEntity === 'object') ? b.selectedEntity : null;
    const originalQuery = String(b.originalQuery || (selectedEntityIn && selectedEntityIn.originalQuery) || query || '').trim();
    const canonical = String((selectedEntityIn && selectedEntityIn.canonicalName) || '').trim();
    if (!query && !(candidate && candidate.url) && !canonical) {
      return json({ error: 'Select a candidate or enter a subject before running Deep Dive.' }, 400, req);
    }
    const evidenceIn = (selectedEntityIn && selectedEntityIn.discoveryEvidence) || discoveryEvidenceFrom(candidate) || discoveryEvidenceFrom(selectedEntityIn);
    const evidenceUrl = String((evidenceIn && evidenceIn.url) || (candidate && candidate.url) || '').trim();
    const adult = normalizeAdult(b.adult || b.adultContent || (selectedEntityIn && selectedEntityIn.adultContent));
    const typeHint = hint || (selectedEntityIn && selectedEntityIn.type) || '';
    const rawForClassify = originalQuery || query || canonical;
    const classifyInput = (/^https?:\/\//i.test(rawForClassify) && canonical) ? canonical : (rawForClassify || canonical);
    const classification = applyResearchFilter(classifyQuery(classifyInput, typeHint), adult, classifyInput);
    if (canonical) classification.subject = canonical;
    const carriedCtx = String((selectedEntityIn && selectedEntityIn.context) || b.context || b.topic || '').trim();
    if (carriedCtx && !extraContext(classification)) classification.context = carriedCtx;
    const seed = diveSeedQuery(classification, originalQuery, canonical, query);
    const expanded = b.expanded === true || b.expanded === 'true' || b.expanded === 1;
    const depth = normalizeDepth(b.all === true || b.all === 'true' || b.depth === 'deep' ? 'deep' : (b.depth || (selectedEntityIn && selectedEntityIn.depth) || 'contextual'), classification);
    classification.researchDepth = depth;
    const resolved = resolveDivePaths(classification.type, b, classification);
    const selectedPaths = resolved.selected;
    const selectedIds = new Set(selectedPaths.map(p => p.id));
    const customQuestion = resolved.custom || String(b.customQuestion || b.instructions || '').trim();
    const instruction = parseInvestigativeQuestion(customQuestion, classification);
    for (const id of instruction.paths) selectedIds.add(id);
    if (instruction.topic && !extraContext(classification)) {
      classification.context = instruction.topic;
      classification.relation = detectRelation(instruction.topic) || classification.relation || 'context';
    }
    const interpreted = interpretRequest(classification, customQuestion);
    classification.concepts = interpreted.concepts;
    const cont = (b.continueFrom && typeof b.continueFrom === 'object') ? b.continueFrom : null;
    const analysisOnly = b.analysisOnly === true || b.retryAnalysis === true;
    const further = b.further === true || b.investigateFurther === true;
    resetFetchBudget();
    const priorRetrieved = Array.isArray(b.priorRetrieved) ? b.priorRetrieved.slice() : [];
    const retrieved = priorRetrieved.slice();
    const batchStartCount = retrieved.length;
    const seenUrl = new Set(retrieved.map(x => x && (x.url || x.finalUrl)).filter(Boolean));
    if (cont && Array.isArray(cont.seenUrls)) cont.seenUrls.forEach(u => seenUrl.add(u));
    const retrieveCap = Math.min(expanded || resolved.all || depth === 'deep' ? 6 : 4, Math.max(2, remainingFetches() - 8));
    const pushRet = async (url) => {
      if (!url || seenUrl.has(url)) return;
      if ((retrieved.length - batchStartCount) >= retrieveCap) return;
      if (remainingFetches() < 2) return;
      seenUrl.add(url);
      try {
        retrieved.push(await retrieveSource(url));
      } catch (e) {
        if (e && e.name === 'BudgetExhausted') return;
        retrieved.push({ url, status: 'RETRIEVAL_FAILED', accessState: 'UNAVAILABLE', error: String(e && e.message || e).slice(0, 160) });
      }
    };
    const skipDiscover = analysisOnly || (!further && !!(cont && Array.isArray(b.priorResults) && b.priorResults.length));
    if (evidenceUrl && !skipDiscover && !analysisOnly) await pushRet(evidenceUrl);
    const focus = retrieved[0];
    const ids = (focus && focus.identifiers) || { profiles: [], handles: [], aliases: [] };
    const graph = discoveryLanes(classification, depth);
    const extra = diveExpansionQueries({
      classification,
      seed,
      instruction,
      selectedPaths,
      selectedIds,
      identifiers: ids,
      customQuestion,
      evidenceHost: hostOf(evidenceUrl),
      expanded,
      resolvedAll: resolved.all,
      adult,
      depth,
    });
    if (further) {
      extra.length = 0;
      const more = investigateFurtherQueries(classification, b.priorResults || [], (cont && cont.graphLeads) || b.graphLeads || []);
      for (const v of more) extra.push(v.q);
    }
    const focusBlocked = !!(focus && focus.status !== 'RETRIEVED');
    const plan = {
      subject: classification.subject || seed,
      type: classification.type,
      why: classification.reason,
      selectedEntity: buildSelectedEntity(classification, candidate || evidenceIn, { canonicalName: canonical || classification.subject, aliases: ids.aliases, handles: ids.handles }, {
        originalQuery,
        context: classification.context,
        adultContent: adult,
        depth,
        canonicalName: canonical || classification.subject,
        entityId: (selectedEntityIn && selectedEntityIn.entityId) || '',
        discoveryEvidence: evidenceIn,
        lens: (selectedEntityIn && selectedEntityIn.lens) || b.lens || '',
      }),
      discoveryEvidence: evidenceIn || null,
      instruction,
      focusUrl: evidenceUrl || '',
      all: resolved.all,
      selectedPaths: selectedPaths.map(p => p.id),
      customQuestion,
      expanded,
      adultContent: adult,
      context: classification.context || '',
      relation: classification.relation || '',
      depth,
      lanes: graph.lanes.map(l => l.id),
      concepts: interpreted.concepts,
      conceptGraph: interpreted.graph,
      progress: [
        'Planning research…',
        interpreted.concepts.length ? ('Understanding concepts: ' + interpreted.concepts.map(x => x.term + (x.family && x.family !== 'open' ? ' (' + x.family + ')' : '')).join(', ')) : 'Understanding concepts…',
        'Finding independent sources…',
        interpreted.concepts.some(x => (x.interview || []).length) ? 'Checking interviews…' : '',
        'Checking media…',
        'Expanding related concepts…',
        remainingFetches() < 8 ? 'Research budget is limited this round — more evidence can continue after this batch.' : 'Comparing evidence…',
        'Synthesizing findings…',
      ].filter(Boolean),
      investigating: [
        resolved.all ? 'Investigate ALL research paths for this entity type, active context, and question — including paths discovered for this investigation' : ('Investigate selected paths: ' + selectedPaths.map(p => p.label).join(', ')),
        customQuestion ? ('Investigative instruction (' + (instruction.intent || 'directed') + (instruction.topic ? ': ' + instruction.topic : '') + '): ' + customQuestion.slice(0, 180)) : 'No custom question — follow the selected paths',
        'Research depth: ' + depth + (depth === 'deep' ? ' — follow productions, people, organizations, and references discovered in the intersection' : (depth === 'contextual' ? ' — find material about the entity ∩ requested context, not name-only hits' : ' — identify the entity/domain')),
        adult === 'off' ? 'Adult content lens is OFF — general public research' : (adult === 'on' ? ((resolved.all || (b.investigation === 'everything')) ? 'Adult lens ON + Everything — adult-industry career, productions, media, interviews, and collaborators first; generic biography is secondary' : 'Adult lens ON — keep adult-industry public context through retrieval, media, and synthesis') : 'Adult content lens is BOTH — keep general and adult-context lanes distinguishable'),
        classification.context ? ('Requested context: ' + (classification.subject || seed) + ' in relation to “' + classification.context + '” (' + (classification.relation || 'context') + ')') : 'Subject-only research (no extra visual/contextual relation requested)',
        evidenceUrl ? (focusBlocked ? ('Identifying source is inaccessible (' + accessLabel(focus.accessState) + '). That page is provenance only — researching the canonical entity across other public sources.') : 'Identifying source kept as provenance/evidence, not as a research boundary. Investigating the canonical entity across public sources.') : 'Retrieve the strongest public sources for the canonical entity',
        'A Browse/Search result identifies the entity. Deep Dive does not restrict discovery to that source, domain, or result set.',
        selectedIds.has('images') || selectedIds.has('visuals') || resolved.all ? 'Collect images relevant to the entity AND the active context, with provenance. Visual likeness is not identity proof.' : 'Images collected only when they appear on retrieved pages',
        selectedIds.has('videos') || resolved.all ? 'Collect playable or openable public videos relevant to the active context. No fake playback.' : 'Video collection skipped unless a source page includes one',
        expanded ? 'Expanded Research is on — public alternatives for restricted/incomplete sources, not a bypass' : 'Normal research already searches multiple providers, variants, and public media.',
        interpreted.concepts.length ? ('Concepts: ' + interpreted.concepts.map(x => x.term + ' [' + x.family + '/' + x.provenance + '] related: ' + (x.related || []).slice(0, 4).join(', ')).join(' · ')) : 'No extra concept beyond the entity',
        'Separate OBSERVED / INFERRED / UNKNOWN — visual likeness is not identity proof',
        'Never treat paywalled or login-gated content as retrieved evidence. Never bypass access controls.',
      ],
      variants: extra.slice(0, resolved.all || expanded ? 12 : 8),
      identifiers: ids,
      safety: 'Read-only public research. Carmen will not contact anyone, send messages, post, log in, bypass paywalls, or take external actions.',
    };

    const extraLimit = remainingFetches() < 16 ? 4 : (further || resolved.all || expanded || depth === 'deep' || ((adult === 'on' || adult === 'both') && classification.type === 'person') ? 8 : 4);
    let discovery;
    if (skipDiscover) {
      const priorRows = b.priorResults || [];
      discovery = {
        results: priorRows,
        providers: {},
        graphLeads: [],
        intersectionCount: priorRows.filter(r => r && r.intersection).length,
        expanded: !!expanded,
        identity: null,
        lanes: graph.lanes,
        concepts: interpreted.concepts,
      };
    } else {
      discovery = await runDiscovery(seed, {
        hint: classification.type,
        extraQueries: extra.slice(0, extraLimit),
        enrich: remainingFetches() > 12,
        expanded: (expanded || focusBlocked) && remainingFetches() > 18,
        adult,
        depth,
        further,
        continueBudget: true,
        budget: Math.max(8, remainingFetches() - 8),
        entity: classification.subject || canonical || '',
        topic: extraContext(classification) || b.topic || b.context || '',
        keepSubject: true,
        diveLens: b.diveLens || b.lens || '',
        mode: b.mode || (b.diveLens ? 'dive-' + b.diveLens : ''),
        priorResults: b.priorResults || [],
        identityFeedback: b.identityFeedback || {},
      });
    }
    const rankedForRetrieve = [...discovery.results].sort((a, b) => {
      let sa = 0, sb = 0;
      if (selectedIds.has('videos') || resolved.all) { sa += isVideoHost(a.url) ? 10 : 0; sb += isVideoHost(b.url) ? 10 : 0; }
      if (selectedIds.has('images') || selectedIds.has('visuals') || resolved.all) { sa += a.image ? 3 : 0; sb += b.image ? 3 : 0; }
      if (classification.context) {
        const ctx = classification.context.toLowerCase();
        if (String(a.title || '').toLowerCase().includes(ctx) || String(a.snippet || '').toLowerCase().includes(ctx)) sa += 8;
        if (String(b.title || '').toLowerCase().includes(ctx) || String(b.snippet || '').toLowerCase().includes(ctx)) sb += 8;
      }
      if (a.resultKind === 'INTERSECTION_MATCH' || a.resultKind === 'INTERVIEW_MATCH') sa += 16;
      if (b.resultKind === 'INTERSECTION_MATCH' || b.resultKind === 'INTERVIEW_MATCH') sb += 16;
      if (a.resultKind === 'AGGREGATOR') sa -= 10;
      if (b.resultKind === 'AGGREGATOR') sb -= 10;
      if (a.resultKind === 'GENERIC_BACKGROUND') sa -= (adult === 'on' ? 14 : 10);
      if (b.resultKind === 'GENERIC_BACKGROUND') sb -= (adult === 'on' ? 14 : 10);
      if (adult === 'on' || adult === 'both') {
        if (a.contextLane === 'adult' || isAdultishSource(a)) sa += 18;
        if (b.contextLane === 'adult' || isAdultishSource(b)) sb += 18;
      }
      return sb - sa || (b.score || 0) - (a.score || 0);
    });
    const harvestedProductions = [];
    for (const r of rankedForRetrieve) {
      for (const u of [...(r.productionUrls || []), ...(r.galleryUrls || [])]) harvestedProductions.push(u);
    }
    const retrieveQueue = diveRetrievalQueue({
      evidenceUrl,
      discoveryResults: rankedForRetrieve,
      profileUrls: ids.profiles,
      galleryUrls: [...((focus && focus.galleryUrls) || []), ...harvestedProductions].slice(0, 8),
      retrieveCap,
      adult,
    });
    const pendingFirst = (cont && Array.isArray(cont.pendingUrls)) ? cont.pendingUrls : [];
    const queue = [...new Set([...pendingFirst, ...retrieveQueue])];
    const batch = retrieveBatchPlan({
      priorRetrieved: retrieved,
      seenUrls: [...seenUrl],
      pendingUrls: pendingFirst,
      queue: retrieveQueue,
      batchCap: retrieveCap,
    });
    if (!analysisOnly && !(cont && cont.stage === 'synthesize')) {
      for (const url of batch.next.length ? batch.next : queue) {
        if (remainingFetches() < 3) break;
        if ((retrieved.length - batchStartCount) >= retrieveCap) break;
        await pushRet(url);
      }
      for (const page of retrieved.slice()) {
        if (remainingFetches() < 4) break;
        if ((retrieved.length - batchStartCount) >= retrieveCap) break;
        for (const u of [...(page.productionUrls || []), ...(page.galleryUrls || []), ...(page.videoUrls || [])].slice(0, 3)) {
          if (remainingFetches() < 3) break;
          if ((retrieved.length - batchStartCount) >= retrieveCap) break;
          await pushRet(u);
        }
      }
    }
    const pendingUrls = queue.filter(u => u && !seenUrl.has(u));
    for (const page of retrieved) {
      for (const u of [...(page.productionUrls || []), ...(page.galleryUrls || [])]) {
        if (u && !seenUrl.has(u) && !pendingUrls.includes(u)) pendingUrls.push(u);
      }
    }
    const images = collectDiveImages(retrieved, discovery.results, classification);
    const videos = (resolved.all || selectedIds.has('videos') || isVisualSubject(classification)) ? collectDiveVideos(retrieved, discovery.results, classification) : [];
    const tutorials = videos.filter(v => /\b(tutorial|how to|howto|demonstration|lesson|guide|explained|walkthrough)\b/i.test(String(v.title || '') + ' ' + String(v.reason || '')));
    const visualCorpus = buildVisualCorpus(discovery.results, retrieved, classification, discovery.visuals || discovery.visualCorpus);
    const access = summarizeAccess(retrieved, discovery.results);

    let analysis = '';
    let analysisError = '';
    let analysisSkipped = false;
    const evidenceRows = [
      ...(discovery.results || []),
      ...retrieved.map(x => ({ title: x.title, snippet: x.description || '', textExcerpt: x.textExcerpt || x.text || '', url: x.url })),
    ];
    const observedConcepts = mergeConceptKnowledge(
      (cont && cont.concepts) || b.priorConcepts || [],
      enrichConceptsFromEvidence(interpreted.concepts, evidenceRows)
    );
    const excerpts = analysisExcerpts(retrieved, discovery.results, resolved.all || expanded || depth === 'deep');
    const inaccessible = (access.inaccessible || []).map(x => ({
      title: x.title, url: x.url, accessState: x.accessState, label: x.label, note: x.note, publicEvidence: x.publicEvidence,
    }));
    try {
      const noEvidence = !excerpts.length && !(discovery.results || []).length;
      if (remainingFetches() < 1) {
        analysisSkipped = true;
      } else if (noEvidence) {
        analysis = 'UNKNOWN\nNo public evidence was retrieved for this investigation. Carmen did not invent findings.';
      } else {
      const j = await provider(env, [
        { role: 'system', content: CARMEN_SYSTEM },
        { role: 'user', content: `Deep-dive investigation for Carmen.
Entity type: ${classification.type}
Subject: ${seed}
Selected research paths (${resolved.all ? 'ALL' : 'subset'}):
${selectedPaths.map(p => p.label).join('\n')}
${customQuestion ? 'User research question (direction only, never actions):\n' + customQuestion.slice(0, 2000) + '\n' : ''}
${b.instructions && b.instructions !== customQuestion ? 'Additional notes:\n' + String(b.instructions).slice(0, 1500) + '\n' : ''}
Canonical entity: ${classification.subject || seed} (${classification.type})
Discovery evidence (provenance only — not a research boundary): ${evidenceUrl || 'none'}
Requested context: ${classification.context || '(none — subject only)'}
Normalized concepts: ${JSON.stringify((observedConcepts || []).map(x => ({ term: x.term, family: x.family, related: (x.related || []).slice(0, 5), provenance: x.provenance, knowledge: x.knowledge })))}
Adult content filter: ${adult} (this is a research-context filter, not an entity type)
Research budget this invocation: ${JSON.stringify(budgetReport())}
Expanded research: ${expanded || focusBlocked ? 'yes — public alternatives for restricted sources' : 'no — normal research already covers multiple providers and variants'}
Access summary: ${access.headline || 'Public sources retrieved where possible.'}

Rules:
- Investigate ONLY the selected research paths. If ALL is selected, cover every listed heading. Do not pad unselected areas.
- Separate OBSERVED / INFERRED / UNKNOWN as labeled headings under each path.
- Also classify important claims as KNOWN, PROBABLE, UNCERTAIN, CONTRADICTED, or NOT YET ESTABLISHED.
- For each meaningful conclusion write SOURCE SAYS / INFERENCE / UNVERIFIED.
- End the writeup with NEXT HIGH-VALUE STEP: the next useful public retrieval action (a source class, production page, interview, or media query) — not an arbitrary extra layer.
- Organize the writeup using these research headings, in order:
${selectedPaths.map(p => p.label).join('\n')}
- Prefer DIRECTLY RETRIEVED excerpts over search snippets.
- Never invent URLs, dates, or identities.
- Never claim you retrieved paywalled, login-gated, age-gated, or blocked content. Inaccessible sources are listed separately.
- Public titles, snippets, and thumbnails of inaccessible sources are REFERENCED public evidence, not retrieved page content.
- If the only remaining relevant source is paywalled, say clearly: Absolutely cannot retrieve due to paywall. Then list what public evidence exists elsewhere and what remains UNKNOWN.
- If a visual/contextual relation was requested (person + context), treat that as a different problem from identity-only search. Rank and discuss sources that actually associate the person with the requested context — entity ∩ context, not entity results plus random context results.
- If Adult content = ON, do not silently fall back to generic biography. Keep adult-context public sources, images, and videos in the writeup, labeled honestly. Adult context does not lower OBSERVED/INFERRED/UNKNOWN discipline. When the investigation is Everything/ALL, prioritize adult-industry career, productions, public media, interviews, and collaborators; generic celebrity trivia is secondary. If a specific concept is present, treat entity × concept × adult lens as the first-class research target.
- If Adult content = BOTH, distinguish the general lane from the adult-context lane.
- Never bypass paywalls, logins, age gates, CAPTCHAs, or other access controls. Work around the information gap with public alternatives only.
- Images showing similar appearance across sources are OBSERVED visual consistency, NOT identity proof. Never say they are definitely the same person.
- List publicly visible handles, domains, and aliases only if they appear in the sources.
- Suggest research leads as questions/sources to review, never as actions to take.
- Do not generate explicit sexual instructional content. Ontology terms are for retrieval and organization.
- After the writeup, list related public aspects the user could investigate next as:
RELATED
- kind: label — why
Kinds: person, technique, object, place, source, product, video. Only from retrieved material. Never invent.

Retrieved sources:
${JSON.stringify(excerpts)}

Inaccessible sources (do not treat as retrieved evidence):
${JSON.stringify(inaccessible)}

Discovery results (may be snippets only):
${JSON.stringify(discovery.results.slice(0, 3).map(r => ({ title: r.title, url: r.url, snippet: String(r.snippet || '').slice(0, 160), resultKind: r.resultKind, intersection: !!r.intersection })))}
Planning vocabulary is INFERRED, not case evidence. Only treat retrieved co-occurrence as OBSERVED.` },
      ], 0.2);
        analysis = extractMessageContent(j);
        if (isUnusableAnalysis(analysis)) {
          analysisError = 'Analysis unavailable — the model returned a non-investigative response.';
          analysis = '';
        }
      }
    } catch (e) {
      if (e && e.name === 'BudgetExhausted') analysisSkipped = true;
      else analysisError = e?.name === 'AbortError' ? 'AI provider timed out.' : (e?.message || String(e));
    }

    const leads = [];
    for (const r of discovery.results.slice(0, 6)) {
      if (r.confidence === 'high' || r.confidence === 'medium') {
        leads.push({ text: `Review ${r.title} (${r.domain}) — ${r.reason}`, url: r.url, status: 'new' });
      }
    }
    const parsedRelated = parseRelated(analysis);
    const related = parsedRelated.length ? parsedRelated : relatedFromDiscovery(discovery.results, evidenceIn || candidate);
    for (const lead of (discovery.graphLeads || []).slice(0, 6)) {
      if (related.some(r => String(r.label || '').toLowerCase() === lead.label.toLowerCase())) continue;
      related.push({ kind: lead.kind, label: lead.label, why: lead.why, url: '' });
    }
    const suggestions = [];
    if (discovery.results.length) suggestions.push('Carmen found ' + discovery.results.length + ' public sources that may be relevant.');
    if (videos.length) suggestions.push(videos.length + ' public video source' + (videos.length === 1 ? '' : 's') + ' surfaced.');
    if (related.length) suggestions.push('Would you like to investigate a related entity without leaving this case?');
    if (access.headline) suggestions.push(access.headline);
    if (focusBlocked && !expanded) suggestions.push('The identifying source was inaccessible. That page is provenance only — Deep Dive continues across other public sources. Expanded Research can keep looking.');
    if (!expanded && (access.paywalled || access.authenticationRequired)) suggestions.push('Protected sources were not retrieved. Public alternatives and references are labeled honestly.');
    const graphSize = (retrieved.length || 0) + (discovery.graphLeads || []).length + images.length + videos.length;
    const stopReason = pendingUrls.length
      ? (remainingFetches() < 3 ? 'budget_this_round' : 'more_paths_available')
      : ((discovery.graphLeads || []).length === 0 && remainingFetches() >= 3 ? 'graph_exhausted' : 'batch_complete');
    if (stopReason === 'graph_exhausted') suggestions.push('Meaningful public research paths look exhausted for this round. Look Further will pivot to unused source classes rather than repeating the same path.');
    const paused = analysisSkipped || (!analysisOnly && pendingUrls.length > 0);
    if (paused) suggestions.push('Research paused — more evidence available to continue. Carmen reached a resource safeguard before all public paths were exhausted; this is not a failed analysis.');
    if (analysisError) suggestions.push('Research collected. Analysis unavailable — retry analysis. Retrieved sources, images, videos, and leads are kept.');
    const researchState = {
      stage: pendingUrls.length ? 'paused' : (analysisError ? 'analyze' : (paused ? 'paused' : (stopReason === 'graph_exhausted' ? 'exhausted' : 'complete'))),
      analysisStatus: analysisError ? 'failed' : (analysisSkipped ? 'skipped' : (analysis ? 'ok' : 'none')),
      budget: budgetReport(),
      pendingUrls: pendingUrls.slice(0, 12),
      seenUrls: [...seenUrl].slice(0, 40),
      extraQueriesDone: extra.slice(0, extraLimit),
      concepts: observedConcepts,
      conceptGraph: interpreted.graph,
      graphLeads: discovery.graphLeads || [],
      seed,
      originalQuery,
      customQuestion,
      adult,
      depth,
      further: !!further,
      stopReason,
      graphSize,
    };

    return json({
      plan,
      classification,
      results: discovery.results,
      retrieved,
      images,
      videos,
      tutorials,
      visuals: visualCorpus,
      visualCorpus,
      analysis,
      analysisError,
      leads,
      related,
      suggestions,
      access,
      paths: selectedPaths,
      availablePaths: researchPaths(classification.type, classification),
      selectedPathIds: selectedPaths.map(p => p.id),
      all: resolved.all,
      customQuestion,
      expanded: expanded || discovery.expanded || false,
      adultContent: adult,
      depth,
      identity: discovery.identity,
      graphLeads: discovery.graphLeads || [],
      intersectionCount: discovery.intersectionCount || 0,
      providers: discovery.providers,
      query: seed,
      concepts: observedConcepts,
      conceptGraph: interpreted.graph,
      researchState,
      budget: budgetReport(),
      analysisSkipped,
      paused,
      analysisOnly: !!analysisOnly,
      investigation: resolved.investigation || b.investigation || '',
      investigationChoices: investigationChoices(classification.type, classification),
      further: !!further,
      interpretations: ambiguousInterpretations(seed, classification),
      premiumContent: collectPremiumContent(discovery.results, retrieved),
      stopReason,
      graphSize,
      sourceClassesReached: discovery.sourceClassesReached || [],
      queryClasses: discovery.queryClasses || extra.map(q => ({ q, why: 'dive' })),
      providerFailures: discovery.providerFailures || [],
      successfulPivots: discovery.successfulPivots || 0,
      duplicateMediaRejected: discovery.duplicateMediaRejected || 0,
      retrievalTrace: discovery.retrievalTrace || {},
      researchMetrics: discovery.researchMetrics || buildResearchMetrics(discovery.results || [], discovery.providers || {}),
      autoSave: false,
    }, 200, req);
  } catch (e) {
    const msg = e?.message || String(e);
    if (e?.name === 'BudgetExhausted' || /Too many subrequests/i.test(msg)) {
      return json({
        error: '',
        paused: true,
        analysisSkipped: true,
        researchState: { stage: 'paused', budget: budgetReport(), reason: 'Research budget reached — continue for more evidence.' },
        budget: budgetReport(),
        suggestions: ['Research paused — more evidence available to continue.'],
        plan: { investigating: ['Research paused — more evidence available to continue.'] },
      }, 200, req);
    }
    return json({ error: e?.name === 'AbortError' ? 'Deep Dive timed out.' : msg }, 500, req);
  }
}

async function learnHandler(req, env) {
  try {
    const b = await req.json().catch(() => ({}));
    const query = String(b.query || b.subject || '').trim().slice(0, 500);
    if (!query) return json({ error: 'Enter something you want to learn or understand.' }, 400, req);
    const hint = String(b.type || b.subject || '').trim();
    const adult = normalizeAdult(b.adult || b.adultContent);
    const classification = applyResearchFilter(classifyQuery(query, hint), adult, query);
    const paths = researchPaths(classification.type, classification);
    const measurements = (b.measurements && typeof b.measurements === 'object') ? b.measurements : null;
    const visualUrl = String(b.visualUrl || b.imageUrl || '').trim();
    resetFetchBudget();
    const discovery = await runDiscovery(query, { hint: classification.type, enrich: true, adult });
    const retrieved = [];
    const seen = new Set();
    for (const r of discovery.results) {
      if (retrieved.length >= 5) break;
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      retrieved.push(await retrieveSource(r.url));
    }
    const images = collectDiveImages(retrieved, discovery.results, classification);
    const excerpts = retrieved.filter(x => x.status === 'RETRIEVED').map(x => ({
      title: x.title, url: x.url, provenance: 'RETRIEVED',
      excerpt: String(x.textExcerpt || x.text || '').slice(0, 1600),
    }));
    let lesson = '';
    let analysisError = '';
    try {
      const j = await provider(env, [
        { role: 'system', content: CARMEN_SYSTEM + ' You teach from public sources. Never instruct anyone to take external actions on other people. Safety notes are research, not a command to act.' },
        { role: 'user', content: `Turn this public-web research into a conservative learning brief for Carmen.

Entity type: ${classification.type}
Subject: ${query}
${visualUrl ? 'Selected visual URL (research seed, not identity proof): ' + visualUrl + '\n' : ''}
${measurements ? 'USER-PROVIDED MEASUREMENTS (not source-observed):\n' + JSON.stringify(measurements) + '\nLabel these USER-PROVIDED MEASUREMENT. Never treat them as a SOURCE-PROVIDED size chart. Fit conclusions are CALCULATED/INFERRED unless a retrieved source size chart supports them. UNKNOWN if insufficient.\n' : ''}
${b.instructions ? 'Learner notes (direction only):\n' + String(b.instructions).slice(0, 1500) + '\n' : ''}

Write using these headings:
${paths.map(p => p.label).join('\n')}

Rules:
- Separate OBSERVED / INFERRED / UNKNOWN inside headings.
- Ground claims in retrieved excerpts. Never invent steps, measurements, or part numbers.
- If user measurements are present, label them USER-PROVIDED MEASUREMENT. Source size charts are SOURCE-PROVIDED. Fit conclusions are CALCULATED/INFERRED. UNKNOWN if insufficient.
- If sources disagree, say so.
- For skills/projects, include safety as UNKNOWN where sources do not specify it.
- For sexual/self-restraint subject matter, research and organize public visual/source material but do not produce explicit actionable sexual/self-bondage instructions.
- Suggest next questions and public references, never actions that contact people or buy things.

Retrieved sources:
${JSON.stringify(excerpts)}

Discovery results:
${JSON.stringify(discovery.results.slice(0, 8).map(r => ({ title: r.title, url: r.url, snippet: r.snippet, reason: r.reason, provenance: r.provenance })))}` },
      ], 0.2);
      lesson = extractMessageContent(j);
    } catch (e) {
      analysisError = e?.name === 'AbortError' ? 'AI provider timed out.' : (e?.message || String(e));
    }
    return json({
      classification,
      paths,
      results: discovery.results,
      retrieved,
      images,
      lesson,
      analysis: lesson,
      analysisError,
      providers: discovery.providers,
      query,
      adultContent: adult,
      measurementsUsed: measurements ? { provenance: 'USER-PROVIDED', measurements } : null,
      visualUrl: visualUrl || '',
      safety: 'Read-only learning from public sources. Carmen will not contact anyone or take external actions.',
    }, 200, req);
  } catch (e) {
    return json({ error: e?.name === 'AbortError' ? 'Learn timed out.' : e?.message || String(e) }, 500, req);
  }
}

const INVESTIGATION_STORE = new Map();
const MAX_INVESTIGATIONS = 48;

function rememberInvestigation(state) {
  if (!state || !state.investigationId) return state;
  while (INVESTIGATION_STORE.size >= MAX_INVESTIGATIONS) {
    const oldest = INVESTIGATION_STORE.keys().next().value;
    INVESTIGATION_STORE.delete(oldest);
  }
  INVESTIGATION_STORE.set(state.investigationId, state);
  return state;
}

function loadInvestigation(id, fallback) {
  if (id && INVESTIGATION_STORE.has(id)) return INVESTIGATION_STORE.get(id);
  if (fallback && fallback.investigationId) return fallback;
  return null;
}

function apiDocsPayload() {
  return {
    name: 'Carmen machine-readable investigation API',
    version: PLANNER_VERSION,
    build: PLANNER_BUILD,
    samePipelineAsIphoneUi: true,
    safety: {
      noSecrets: true,
      noAutonomousExternalActions: true,
      noMessagingPostingFollowingPurchases: true,
      investigationsAreOpaqueIds: true,
    },
    cors: {
      allowMethods: 'GET,POST,OPTIONS',
      allowHeaders: 'content-type, x-carmen-client, x-carmen-test-key, x-carmen-api-key, authorization',
      notes: 'Same-origin, localhost, *.workers.dev, grok.app, chatgpt.com, and requests with no Origin (server-to-server) are allowed. Credentials are not used.',
    },
    auth: {
      default: 'none unless CARMEN_API_KEY is configured — investigation IDs are unguessable; do not publish private investigation JSON',
      machineKey: 'If CARMEN_API_KEY is configured, send X-Carmen-Api-Key or Authorization: Bearer <CARMEN_API_KEY>. Never send API_KEY / OpenRouter credentials.',
      optionalTestKey: 'If CARMEN_TEST_KEY is configured, send header X-Carmen-Test-Key. Never send OpenRouter/API keys to these routes.',
    },
    diagnostic: 'Pass diagnostic=1 or fixture=<name> to exercise ranking without treating a provider outage as a Carmen PASS.',
    fixtures: Object.keys(DETERMINISTIC_FIXTURES),
    actions: API_ACTION_CATALOG,
    resultFields: ['investigationId', 'subject', 'subjectId', 'topic', 'intent', 'sourceClass', 'sourceUrl', 'canonicalUrl', 'title', 'publisher', 'host', 'creator', 'originalSource', 'reposter', 'mirror', 'imageUrl', 'imageProvenance', 'identityEvidence', 'topicEvidence', 'confidence', 'observationState', 'foundThrough', 'parent', 'relatedTo', 'retrievalRun', 'timestamps', 'deduplicationStatus', 'rejectionReason', 'candidateIdentity', 'provider', 'latency', 'failureReason', 'isEvidenceItem', 'isDiscoveryLead', 'ownershipClass', 'accessState'],
    observationStates: ['OBSERVED', 'SUPPORTED', 'INFERRED', 'UNKNOWN'],
    ownershipClasses: ['CONFIRMED CREATOR-OWNED', 'LIKELY CREATOR-OWNED', 'DIRECTORY CLAIM', 'FAN/REPOSTER', 'MIRROR', 'UNVERIFIED', 'UNKNOWN'],
    diagnosisStatuses: ['ok', 'thin_corpus', 'search_failed', 'source_inaccessible', 'identity_unresolved', 'evidence_unavailable'],
    liveVsFixture: 'A live provider timeout/block is BLOCKED, never PASS. Use fixture=provider-blocked to verify Carmen reports search_failed.',
    browserTest: {
      available: true,
      sameUiAsIphone: true,
      samePipelineAsIphoneUi: true,
      primary: '/test',
      routes: ['/test', '/browser-test'],
      session: '/api/v1/browser-test-session',
      access: 'Open /test or /browser-test on this origin. Loads the real Carmen PWA and the real backend with no redirect and no extra auth unless CARMEN_TEST_KEY is configured.',
      capabilities: ['open Carmen', 'enter searches', 'new investigation', 'select subject', 'deep dive', 'bondage', 'people', 'clothing', 'find more', 'inspect result cards', 'inspect images and source URLs', 'follow discovered sources', 'save/keep results', 'branch investigations', 'identity confirmation/rejection', 'how I got here', 'repeat searches', 'observe loading/error states', 'inspect returned evidence'],
      forbidden: ['send messages', 'post', 'follow accounts', 'purchase', 'submit external forms', 'any other external action'],
    },
  };
}

const MACHINE_PUBLIC_PATHS = new Set([
  '/api', '/api/v1', '/api/v1/docs', '/api/v1/health', '/api/health',
  '/api/v1/openapi.json', '/api/v1/machine/capabilities', '/api/v1/capabilities',
  '/api/v1/browser-test-session', '/api/browser-test-session',
]);
const DENIED_EXTERNAL_SEGMENTS = new Set([
  'message', 'messages', 'messaging', 'dm', 'post', 'comment', 'comments',
  'follow', 'following', 'purchase', 'buy', 'checkout', 'transaction', 'transactions',
  'signup', 'sign-up', 'create-account', 'login', 'paywall', 'form', 'submit',
]);

function presentedMachineCredential(req) {
  const header = (req.headers.get('x-carmen-api-key') || '').trim();
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const test = (req.headers.get('x-carmen-test-key') || '').trim();
  return header || bearer || test;
}

function machineCapabilities(env) {
  const machineKeyConfigured = !!(env && String(env.CARMEN_API_KEY || '').trim());
  return {
    readOnly: true,
    pipelineFunction: 'runDiscovery',
    samePipelineAsIphoneUi: true,
    mock: false,
    browserTestSimulation: false,
    allowed: ['search', 'dive', 'analyze', 'inspect-investigation', 'inspect-results', 'confirm-identity', 'reject-identity', 'find-more', 'learn'],
    denied: ['external-action', 'messaging', 'posting', 'commenting', 'following', 'purchasing', 'submitting-forms', 'creating-accounts', 'transactions', 'login-bypass', 'paywall-bypass'],
    primaryDiveLenses: ['bondage', 'people', 'clothing'],
    findMore: 'additive expansion via the next unexplored retrieval lane',
    authentication: 'CARMEN_API_KEY via X-Carmen-Api-Key or Authorization Bearer. Never send API_KEY.',
    machineAuthConfigured: machineKeyConfigured,
    continuity: 'Worker memory is not durable. Echo investigationState (and investigationId) on every subsequent search, dive, analyze, or inspect call.',
    agentContract: {
      sequence: [
        'GET /api/v1/machine/capabilities',
        'POST /api/v1/machine/search',
        'save investigationId + investigationState',
        'POST /api/v1/machine/dive with both',
        'inspect results array',
        'POST /api/v1/machine/investigations/{id}/analyze with url + both',
        'POST /api/v1/machine/investigations/{id} with echoed state',
        'continue search/dive using the returned state',
      ],
      echo: ['investigationId', 'investigationState'],
      echoAlternate: 'investigationStateJson',
      readOnly: true,
      deniedExternalActions: true,
    },
  };
}

function machinePipeline() {
  return { function: 'runDiscovery', mock: false, browserTestSimulation: false, fixtureAllowed: true };
}

function identityStateFrom(state, discovery) {
  const fb = (state && state.identityFeedback) || {};
  return {
    confirmed: fb.confirmed || (state && state.confirmed) || [],
    rejected: fb.rejectedPeople || [],
    rejectedImages: fb.rejectedImages || [],
    rejectedHosts: fb.rejectedHosts || [],
    rejectedUrls: fb.rejectedUrls || [],
    candidates: (discovery && discovery.identityCandidates) || (state && state.candidates) || [],
    ambiguous: !!(discovery && discovery.identityAmbiguous),
    ambiguousReason: (discovery && discovery.identityAmbiguousReason) || null,
    subject: (state && state.subject) || (discovery && discovery.classification && discovery.classification.subject) || '',
    note: 'That’s the one confirms WHO the person is. It does not restrict retrieval to the selected website.',
  };
}

function relationshipsFrom(discovery, state) {
  const seeds = (discovery && discovery.discoverySeeds) || {};
  return {
    relatedPeople: (discovery && discovery.relatedPeople) || seeds.people || [],
    parent: (state && state.parentInvestigationId) || null,
    derivedFrom: (state && state.derivedFrom) || null,
    relatedTo: (state && state.relatedTo) || null,
    foundThrough: (state && state.foundThrough) || null,
    discoverySeeds: seeds,
    productions: seeds.productions || [],
    domains: seeds.domains || [],
    studios: seeds.studios || [],
  };
}

function retrievalLanesFrom(discovery) {
  return {
    variants: (discovery && (discovery.queryClasses || discovery.variants)) || [],
    queryClasses: (discovery && discovery.queryClasses) || [],
    topicMap: (discovery && discovery.topicMap) || null,
    expansion: (discovery && discovery.expansion) || null,
    diveLenses: (discovery && discovery.primaryDiveLenses) || PRIMARY_DIVE_LENSES,
    attemptedQueries: (discovery && discovery.attemptedQueries) || [],
  };
}

function isDeniedExternalAction(path, action) {
  const segs = String(path || '').split('/').filter(Boolean);
  if (segs.some(s => DENIED_EXTERNAL_SEGMENTS.has(String(s).toLowerCase()))) return true;
  const act = String(action || '').toLowerCase();
  if (DENIED_EXTERNAL_SEGMENTS.has(act)) return true;
  return /\b(external-action|send-message|create-account|login-bypass|paywall-bypass)\b/i.test(path + ' ' + act);
}

function coerceInvestigationState(body) {
  if (!body || typeof body !== 'object') return null;
  let raw = body.investigationState;
  if (raw == null && body.investigationStateJson != null) raw = body.investigationStateJson;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try { raw = JSON.parse(trimmed); } catch { return null; }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  return null;
}

function attachInvestigationStateEcho(payload, state) {
  if (!payload || !state) return payload;
  try {
    const encoded = JSON.stringify(state);
    if (encoded.length <= 40000) payload.investigationStateJson = encoded;
    else payload.investigationStateJsonOmitted = true;
  } catch (_) {}
  return payload;
}

function machineOpenApiSpec() {
  const origin = 'https://carmen-iphone-v25.94bwfd5grv.workers.dev';
  const bearerFirst = [{ BearerAuth: [] }, { CarmenApiKey: [] }];
  const json = (schema, desc) => ({ description: desc, content: { 'application/json': { schema } } });
  const errRef = { '$ref': '#/components/schemas/MachineError' };
  const envRef = { '$ref': '#/components/schemas/DiscoveryEnvelope' };
  const inspectRef = { '$ref': '#/components/schemas/InvestigationEnvelope' };
  const analyzeRef = { '$ref': '#/components/schemas/AnalyzeEnvelope' };
  const idParam = {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string' },
    description: 'investigationId from the previous search/dive response.',
  };
  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'Carmen machine-readable investigation API',
      version: PLANNER_VERSION,
      description: 'Read-only investigation API for ChatGPT Actions and other agents. Same runDiscovery pipeline as the iPhone PWA. Never messages, posts, purchases, or submits forms. Auth: Authorization Bearer CARMEN_API_KEY (preferred) or X-Carmen-Api-Key. Never send the provider API_KEY. Worker memory is not durable: echo investigationId plus investigationState on every continuation. Sequence: capabilities → search → save id+state → dive with both → inspect results → analyze a public URL → POST inspect with echoed state → continue.',
    },
    servers: [{ url: origin, description: 'Live Carmen Worker' }],
    security: bearerFirst,
    tags: [
      { name: 'machine', description: 'Read-only ChatGPT/tool investigation routes' },
      { name: 'meta', description: 'Health, capabilities, OpenAPI' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'CARMEN_API_KEY',
          description: 'Authorization: Bearer <CARMEN_API_KEY>. Preferred for ChatGPT Actions (Auth type: API Key → Bearer). Never send API_KEY.',
        },
        CarmenApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Carmen-Api-Key',
          description: 'Alternate header. ChatGPT Actions: API Key → Custom header name X-Carmen-Api-Key. Never send API_KEY.',
        },
      },
      schemas: {
        InvestigationState: {
          type: 'object',
          additionalProperties: true,
          description: 'Client-held snapshot. Echo this exact object on the next call. Worker memory is not durable.',
          properties: {
            investigationId: { type: 'string' },
            subject: { type: 'string' },
            topic: { type: 'string' },
            adultLens: { type: 'string' },
            confirmed: { type: 'array', items: { type: 'string' } },
            identityFeedback: { type: 'object', additionalProperties: true },
            trail: { type: 'array', items: { type: 'object', additionalProperties: true } },
            lastApiResults: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        EvidenceItem: {
          type: 'object',
          additionalProperties: true,
          properties: {
            investigationId: { type: 'string' },
            subject: { type: 'string' },
            topic: { type: 'string' },
            intent: { type: 'string' },
            sourceClass: { type: 'string' },
            sourceUrl: { type: 'string' },
            canonicalUrl: { type: 'string' },
            title: { type: 'string' },
            publisher: { type: 'string' },
            host: { type: 'string' },
            creator: { type: 'string' },
            originalSource: { type: 'string' },
            imageUrl: { type: 'string' },
            identityEvidence: { type: 'string' },
            topicEvidence: { type: 'string' },
            observationState: { type: 'string', enum: ['OBSERVED', 'SUPPORTED', 'INFERRED', 'UNKNOWN'] },
            foundThrough: { type: 'string' },
            parent: { type: 'object', additionalProperties: true, nullable: true },
            relatedTo: { type: 'object', additionalProperties: true, nullable: true },
            deduplicationStatus: { type: 'string' },
            rejectionReason: { type: 'string', nullable: true },
            candidateIdentity: { type: 'object', additionalProperties: true, nullable: true },
            ownershipClass: { type: 'string' },
            accessState: { type: 'string' },
            isEvidenceItem: { type: 'boolean' },
            isDiscoveryLead: { type: 'boolean' },
            url: { type: 'string' },
          },
        },
        IdentityState: {
          type: 'object',
          additionalProperties: true,
          properties: {
            confirmed: { type: 'array', items: { type: 'string' } },
            rejected: { type: 'array', items: { type: 'string' } },
            rejectedImages: { type: 'array', items: { type: 'string' } },
            rejectedHosts: { type: 'array', items: { type: 'string' } },
            rejectedUrls: { type: 'array', items: { type: 'string' } },
            candidates: { type: 'array', items: { type: 'object', additionalProperties: true } },
            ambiguous: { type: 'boolean' },
            ambiguousReason: { type: 'string', nullable: true },
            subject: { type: 'string' },
          },
        },
        CorpusDiagnosis: {
          type: 'object',
          additionalProperties: true,
          properties: {
            status: { type: 'string', enum: ['ok', 'thin_corpus', 'search_failed', 'source_inaccessible', 'identity_unresolved', 'evidence_unavailable'] },
          },
        },
        Expansion: { type: 'object', additionalProperties: true },
        DiscoveryEnvelope: {
          type: 'object',
          required: ['ok', 'investigationId', 'results', 'investigationState', 'readOnly'],
          properties: {
            ok: { type: 'boolean' },
            investigationId: { type: 'string' },
            version: { type: 'string' },
            build: { type: 'string' },
            action: { type: 'string' },
            subject: { type: 'string' },
            topic: { type: 'string' },
            results: { type: 'array', items: { '$ref': '#/components/schemas/EvidenceItem' } },
            identityState: { '$ref': '#/components/schemas/IdentityState' },
            corpusDiagnosis: { '$ref': '#/components/schemas/CorpusDiagnosis' },
            expansion: { '$ref': '#/components/schemas/Expansion' },
            investigationState: { '$ref': '#/components/schemas/InvestigationState' },
            investigationStateJson: { type: 'string', description: 'JSON string of investigationState for clients that cannot resend nested objects.' },
            readOnly: { type: 'boolean' },
            samePipelineAsIphoneUi: { type: 'boolean' },
            pipeline: { type: 'object', additionalProperties: true },
            capabilities: { type: 'object', additionalProperties: true },
            count: { type: 'integer' },
          },
        },
        InvestigationEnvelope: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            investigationId: { type: 'string' },
            subject: { type: 'string' },
            topic: { type: 'string' },
            identityState: { '$ref': '#/components/schemas/IdentityState' },
            results: { type: 'array', items: { '$ref': '#/components/schemas/EvidenceItem' } },
            investigationState: { '$ref': '#/components/schemas/InvestigationState' },
            investigationStateJson: { type: 'string' },
            trail: { type: 'array', items: { type: 'object', additionalProperties: true } },
            readOnly: { type: 'boolean' },
          },
        },
        AnalyzeEnvelope: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ok: { type: 'boolean' },
            investigationId: { type: 'string' },
            action: { type: 'string' },
            url: { type: 'string' },
            title: { type: 'string' },
            kind: { type: 'string' },
            analysis: { type: 'object', additionalProperties: true },
            investigationState: { '$ref': '#/components/schemas/InvestigationState' },
          },
        },
        MachineError: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            error: { type: 'string' },
            hint: { type: 'string' },
            readOnly: { type: 'boolean' },
          },
        },
        SearchRequest: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query. Provide query or subject.' },
            subject: { type: 'string', description: 'Person or entity name.' },
            topic: { type: 'string', description: 'Optional topic such as bondage.' },
            type: { type: 'string', description: 'Optional type hint, e.g. person.' },
            adult: { type: 'string', enum: ['on', 'off', 'both'], description: 'Adult lens. Default off.' },
            investigationId: { type: 'string', description: 'Echo from previous response to continue the same investigation.' },
            investigationState: { '$ref': '#/components/schemas/InvestigationState' },
            investigationStateJson: { type: 'string', description: 'Optional JSON string alternative to investigationState.' },
            fixture: { type: 'string', description: 'Optional deterministic fixture name for tests only.' },
          },
        },
        DiveRequest: {
          type: 'object',
          properties: {
            lens: { type: 'string', enum: ['bondage', 'people', 'clothing'], description: 'Deep Dive lens. Default bondage.' },
            query: { type: 'string' },
            subject: { type: 'string' },
            topic: { type: 'string' },
            type: { type: 'string' },
            adult: { type: 'string', enum: ['on', 'off', 'both'] },
            investigationId: { type: 'string', description: 'Required to continue. Echo previous investigationId.' },
            investigationState: { '$ref': '#/components/schemas/InvestigationState' },
            investigationStateJson: { type: 'string' },
            priorResults: { type: 'array', items: { type: 'object', additionalProperties: true } },
            graphLeads: { type: 'array', items: { type: 'object', additionalProperties: true } },
            fixture: { type: 'string' },
          },
        },
        InspectRequest: {
          type: 'object',
          properties: {
            investigationId: { type: 'string' },
            investigationState: { '$ref': '#/components/schemas/InvestigationState' },
            investigationStateJson: { type: 'string' },
          },
        },
        AnalyzeRequest: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'Public URL to analyze. Read-only retrieval.' },
            title: { type: 'string' },
            kind: { type: 'string', description: 'webpage, reddit, image, or video.' },
            investigationId: { type: 'string' },
            investigationState: { '$ref': '#/components/schemas/InvestigationState' },
            investigationStateJson: { type: 'string' },
          },
        },
        ConfirmIdentityRequest: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Confirmed person name.' },
            subject: { type: 'string' },
            query: { type: 'string' },
            type: { type: 'string' },
            adult: { type: 'string', enum: ['on', 'off', 'both'] },
            investigationId: { type: 'string' },
            investigationState: { '$ref': '#/components/schemas/InvestigationState' },
            investigationStateJson: { type: 'string' },
          },
        },
      },
    },
    paths: {
      '/api/v1/openapi.json': {
        get: {
          operationId: 'openapi',
          tags: ['meta'],
          summary: 'OpenAPI document',
          description: 'ChatGPT Actions schema. Import this URL. No auth.',
          security: [],
          'x-openai-isConsequential': false,
          responses: { 200: { description: 'OpenAPI 3.0.3 document' } },
        },
      },
      '/api/v1/machine/capabilities': {
        get: {
          operationId: 'capabilities',
          tags: ['meta'],
          summary: 'Read-only machine capabilities',
          description: 'Allowed vs denied actions, auth flag, and the required investigationState continuity contract.',
          security: [],
          'x-openai-isConsequential': false,
          responses: { 200: json({ type: 'object', additionalProperties: true }, 'Capabilities and agent contract') },
        },
      },
      '/api/v1/health': {
        get: {
          operationId: 'health',
          tags: ['meta'],
          summary: 'Worker health',
          description: 'Version, build, provider configured flag, machineAuthConfigured. Never returns secrets.',
          security: [],
          'x-openai-isConsequential': false,
          responses: { 200: json({ type: 'object', additionalProperties: true }, 'Health') },
        },
      },
      '/api/v1/machine/search': {
        post: {
          operationId: 'machineSearch',
          tags: ['machine'],
          summary: 'Search / start investigation',
          description: 'Runs runDiscovery. Save investigationId and investigationState from the JSON. Echo both on later dive/analyze/inspect. Read-only.',
          security: bearerFirst,
          'x-openai-isConsequential': false,
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/SearchRequest' } } } },
          responses: {
            200: json(envRef, 'Structured discovery results'),
            400: json(errRef, 'Missing query/subject'),
            401: json(errRef, 'Unauthorized'),
            403: json(errRef, 'External action denied'),
          },
        },
      },
      '/api/v1/machine/dive': {
        post: {
          operationId: 'machineDive',
          tags: ['machine'],
          summary: 'Deep Dive through discovered evidence',
          description: 'Lens bondage|people|clothing. Send investigationId and investigationState from search. Additive merge; not a query rewrite. Read-only.',
          security: bearerFirst,
          'x-openai-isConsequential': false,
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/DiveRequest' } } } },
          responses: {
            200: json(envRef, 'Expanded structured results'),
            400: json(errRef, 'Missing query/subject'),
            401: json(errRef, 'Unauthorized'),
            403: json(errRef, 'External action denied'),
          },
        },
      },
      '/api/v1/machine/investigations/{id}': {
        get: {
          operationId: 'machineInvestigation',
          tags: ['machine'],
          summary: 'Get investigation if this isolate still holds it',
          description: 'Best-effort only. Returns 404 if Worker memory dropped it. Prefer POST inspect with investigationState.',
          security: bearerFirst,
          'x-openai-isConsequential': false,
          parameters: [idParam],
          responses: {
            200: json(inspectRef, 'Investigation state'),
            401: json(errRef, 'Unauthorized'),
            404: json(errRef, 'Not in this Worker isolate'),
          },
        },
        post: {
          operationId: 'machineInvestigationInspect',
          tags: ['machine'],
          summary: 'Inspect investigation from echoed state',
          description: 'Durable inspect. POST investigationId plus investigationState from the last response. Required for ChatGPT continuity.',
          security: bearerFirst,
          'x-openai-isConsequential': false,
          parameters: [idParam],
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/InspectRequest' } } } },
          responses: {
            200: json(inspectRef, 'State reconstructed from client payload'),
            401: json(errRef, 'Unauthorized'),
            404: json(errRef, 'No state provided and not in memory'),
          },
        },
      },
      '/api/v1/machine/investigations/{id}/results': {
        get: {
          operationId: 'machineResults',
          tags: ['machine'],
          summary: 'Get results if isolate still holds them',
          description: 'Best-effort only. Prefer POST results inspect with investigationState.',
          security: bearerFirst,
          'x-openai-isConsequential': false,
          parameters: [idParam],
          responses: {
            200: json(inspectRef, 'Structured evidence items'),
            401: json(errRef, 'Unauthorized'),
            404: json(errRef, 'Not in this Worker isolate'),
          },
        },
        post: {
          operationId: 'machineResultsInspect',
          tags: ['machine'],
          summary: 'Inspect results from echoed state',
          description: 'Returns structured evidence items from client-held investigationState. No HTML parsing.',
          security: bearerFirst,
          'x-openai-isConsequential': false,
          parameters: [idParam],
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/InspectRequest' } } } },
          responses: {
            200: json(inspectRef, 'Structured evidence items'),
            401: json(errRef, 'Unauthorized'),
          },
        },
      },
      '/api/v1/machine/investigations/{id}/analyze': {
        post: {
          operationId: 'machineAnalyze',
          tags: ['machine'],
          summary: 'Analyze a public URL',
          description: 'Read-only analysis of a public page. Send url plus investigationId and investigationState. Never posts or messages.',
          security: bearerFirst,
          'x-openai-isConsequential': false,
          parameters: [idParam],
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/AnalyzeRequest' } } } },
          responses: {
            200: json(analyzeRef, 'Analysis JSON'),
            401: json(errRef, 'Unauthorized'),
            403: json(errRef, 'External action denied'),
          },
        },
      },
      '/api/v1/machine/investigations/{id}/confirm-identity': {
        post: {
          operationId: 'machineConfirmIdentity',
          tags: ['machine'],
          summary: 'Confirm the subject identity',
          description: 'That’s-the-one. Confirms WHO, not which website. Echo investigationState. Later dive/search use this identity.',
          security: bearerFirst,
          'x-openai-isConsequential': false,
          parameters: [idParam],
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/ConfirmIdentityRequest' } } } },
          responses: {
            200: json(envRef, 'Updated identityState plus investigationState'),
            401: json(errRef, 'Unauthorized'),
          },
        },
      },
    },
  };
  return spec;
}

function apiUnauthorized(req, env) {
  const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
  const presented = presentedMachineCredential(req);
  const providerKey = String((env && (env.API_KEY || env.Api_key)) || '').trim();
  const machineKey = String((env && env.CARMEN_API_KEY) || '').trim();
  const testKey = String((env && env.CARMEN_TEST_KEY) || '').trim();

  if (presented && providerKey && presented === providerKey && presented !== machineKey && presented !== testKey) {
    return json({
      error: 'Provider secret is not a Carmen machine credential',
      hint: 'Use CARMEN_API_KEY via X-Carmen-Api-Key or Authorization Bearer. Never send API_KEY.',
    }, 401, req);
  }

  const isPublic = MACHINE_PUBLIC_PATHS.has(path);
  if (isPublic) {
    if (!machineKey && testKey) {
      const got = (req.headers.get('x-carmen-test-key') || '').trim();
      if (got && got === testKey) return null;
      return json({ error: 'Unauthorized', hint: 'Set X-Carmen-Test-Key to the configured test key. Carmen API keys for OpenRouter are never accepted here.' }, 401, req);
    }
    return null;
  }

  if (machineKey) {
    if (presented && presented === machineKey) return null;
    if (testKey && presented && presented === testKey) return null;
    return json({
      error: 'Unauthorized',
      hint: 'Send X-Carmen-Api-Key or Authorization Bearer with CARMEN_API_KEY. Never send API_KEY.',
    }, 401, req);
  }

  if (testKey) {
    const got = (req.headers.get('x-carmen-test-key') || '').trim();
    if (got && got === testKey) return null;
    return json({ error: 'Unauthorized', hint: 'Set X-Carmen-Test-Key to the configured test key. Carmen API keys for OpenRouter are never accepted here.' }, 401, req);
  }
  return null;
}

function packApiDiscovery(discovery, state, action, req, extra = {}) {
  const subject = (discovery.classification && discovery.classification.subject) || state.subject || '';
  const topic = (discovery.investigationContext && discovery.investigationContext.topic) || state.topic || '';
  state.subject = subject || state.subject;
  state.topic = topic || state.topic;
  state.results = (discovery.results || []).map(r => ({ url: r.url, title: r.title, role: r.role, score: r.score })).slice(0, 40);
  state.candidates = discovery.identityCandidates || state.candidates;
  state.visuals = (discovery.visualCorpus || []).slice(0, 24);
  state.retrievalRuns = (state.retrievalRuns || 0) + 1;
  state.updatedAt = new Date().toISOString();
  state.graphLeads = discovery.graphLeads || discovery.relatedPeople || state.graphLeads || [];
  state.attemptedQueries = discovery.attemptedQueries || state.attemptedQueries || [];
  state.priorCorpus = (discovery.results || []).slice(0, 40).map(r => ({
    url: r.url, title: r.title, snippet: String(r.snippet || '').slice(0, 220),
    domain: r.domain || r.host, source: r.source, sourceClass: r.sourceClass || r.plannerSourceClass,
    discoveryLane: r.discoveryLane, provenance: r.provenance, retrievalStatus: r.retrievalStatus,
    accessState: r.accessState, textExcerpt: String(r.textExcerpt || r.snippet || '').slice(0, 280),
    subjectEvidence: r.subjectEvidence, topicEvidence: r.topicEvidence, intersection: r.intersection,
    foundThrough: r.foundThrough, parent: r.parent, relatedTo: r.relatedTo,
  }));
  rememberInvestigation(state);
  const items = (discovery.structuredResults || (discovery.results || []).map(r => serializeEvidenceItem(r, { investigationId: state.investigationId, subject, topic, intent: action })));
  state.lastApiResults = items;
  state.identityState = identityStateFrom(state, discovery);
  const payload = {
    ok: discovery.corpusDiagnosis && discovery.corpusDiagnosis.status === 'search_failed' ? false : true,
    investigationId: state.investigationId,
    version: PLANNER_VERSION,
    build: PLANNER_BUILD,
    action,
    subject,
    subjectId: (discovery.selectedEntity && discovery.selectedEntity.id) || null,
    topic,
    intent: (discovery.intent && discovery.intent.mode) || action,
    classification: discovery.classification,
    results: items,
    evidenceSummary: discovery.evidenceSummary,
    topicMap: discovery.topicMap,
    identityCandidates: discovery.identityCandidates,
    identityAmbiguous: discovery.identityAmbiguous,
    identityAmbiguousReason: discovery.identityAmbiguousReason,
    identityVerification: discovery.identityVerification,
    investigationQueue: discovery.investigationQueue,
    remainingWork: discovery.remainingWork,
    remainingQueue: discovery.remainingQueue,
    resumable: discovery.resumable,
    researchFocus: discovery.researchFocus,
    noNewRelevantVisuals: discovery.noNewRelevantVisuals,
    verifiedVisuals: discovery.verifiedVisuals,
    adaptiveLenses: discovery.adaptiveLenses,
    identityState: identityStateFrom(state, discovery),
    relationships: relationshipsFrom(discovery, state),
    retrievalLanes: retrievalLanesFrom(discovery),
    pipeline: machinePipeline(),
    capabilities: machineCapabilities(extra.env),
    readOnly: true,
    sourceDiversity: discovery.sourceDiversity,
    corpusDiagnosis: discovery.corpusDiagnosis,
    redditEvidence: discovery.redditEvidence,
    providers: discovery.providers,
    providerStatuses: discovery.providerStatuses,
    knownSiteStatus: discovery.knownSiteStatus,
    images: discovery.visualCorpus,
    videos: (discovery.videoCorpus || []).map(v => ({ ...v, frames: 'UNKNOWN', timestamps: 'UNKNOWN' })),
    trail: state.trail,
    savedEvidence: state.savedEvidence,
    identityFeedback: state.identityFeedback,
    warning: discovery.warning,
    fixture: discovery.fixture || null,
    expansion: discovery.expansion,
    relatedPeople: discovery.relatedPeople,
    clothingEvidence: discovery.clothingEvidence,
    noNewSources: discovery.noNewSources,
    noNewSourcesMessage: discovery.noNewSourcesMessage,
    discoverySeeds: discovery.discoverySeeds,
    primaryVisuals: discovery.primaryVisuals,
    primaryDiveLenses: discovery.primaryDiveLenses,
    diagnostic: extra.diagnostic ? { variants: discovery.variants, budget: discovery.budget, retrievalTrace: discovery.retrievalTrace, providerStatuses: discovery.providerStatuses } : undefined,
    investigationState: state,
    samePipelineAsIphoneUi: true,
    count: items.length,
  };
  return attachInvestigationStateEcho(payload, state);
}

async function handleCarmenApi(req, env) {
  const denied = apiUnauthorized(req, env);
  if (denied) return denied;
  const u = new URL(req.url);
  const path = u.pathname.replace(/\/+$/, '') || '/';
  if ((path === '/api' || path === '/api/v1' || path === '/api/v1/docs') && req.method === 'GET') {
    const payload = apiDocsPayload();
    const ai = getAiConfig(env);
    payload.environment = describeCarmenEnvironment(env, ai);
    payload.browserTest = browserTestDescriptor(env);
    payload.testRoutes = ['/test', '/browser-test', '/api/v1/browser-test-session'];
    return json(payload, 200, req);
  }
  if ((path === '/api/v1/health' || path === '/api/health') && req.method === 'GET') {
    const ai = getAiConfig(env);
    return json({
      ok: true,
      worker: 'carmen',
      version: PLANNER_VERSION,
      build: PLANNER_BUILD,
      configured: ai.configured,
      provider: ai.provider,
      model: ai.model,
      api: 'v1',
      secretsExposed: false,
      machineAuthConfigured: !!(env && String(env.CARMEN_API_KEY || '').trim()),
      machineAuth: !!(env && String(env.CARMEN_API_KEY || '').trim()) ? 'CARMEN_API_KEY required' : 'CARMEN_API_KEY not configured — machine routes are open',
      environment: describeCarmenEnvironment(env, ai),
      browserTest: browserTestDescriptor(env),
      testRoutes: ['/test', '/browser-test', '/api/v1/browser-test-session'],
    }, 200, req);
  }

  if ((path === '/api/v1/browser-test-session' || path === '/api/browser-test-session') && (req.method === 'GET' || req.method === 'POST')) {
    return issueBrowserTestSession(req, env);
  }

  if ((path === '/api/v1/openapi.json' || path === '/openapi.json') && req.method === 'GET') {
    return json(machineOpenApiSpec(env), 200, req);
  }
  if ((path === '/api/v1/machine/capabilities' || path === '/api/v1/capabilities') && req.method === 'GET') {
    return json({
      ok: true,
      version: PLANNER_VERSION,
      build: PLANNER_BUILD,
      samePipelineAsIphoneUi: true,
      readOnly: true,
      pipelineFunction: 'runDiscovery',
      machineAuthConfigured: !!(env && String(env.CARMEN_API_KEY || '').trim()),
      capabilities: machineCapabilities(env),
      pipeline: machinePipeline(),
    }, 200, req);
  }

  if (isDeniedExternalAction(path, '')) {
    return json({ error: 'External action denied', readOnly: true, capabilities: machineCapabilities(env) }, 403, req);
  }

  let body = {};
  if (req.method === 'POST') {
    try { body = await req.json(); } catch { body = {}; }
  }
  const coercedState = coerceInvestigationState(body);
  if (coercedState) body.investigationState = coercedState;
  const parts = path.split('/').filter(Boolean);
  // /api/v1/investigations/:id/...
  let investigationId = body.investigationId || u.searchParams.get('investigationId') || '';
  let action = body.action || u.searchParams.get('action') || '';
  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'machine') {
    const leaf = parts[3] || '';
    if (leaf === 'search') action = action || 'search';
    else if (leaf === 'dive') {
      const lens = String(body.lens || body.diveLens || 'bondage').toLowerCase();
      action = action || ('dive-' + (['bondage', 'people', 'visuals', 'clothing'].includes(lens) ? (lens === 'clothing' ? 'visuals' : lens) : 'bondage'));
    } else if (leaf === 'investigations') {
      investigationId = investigationId || parts[4] || '';
      const sub = parts[5] || '';
      if (!sub && (req.method === 'GET' || req.method === 'POST')) action = action || 'get';
      else if (sub) action = action || sub;
    }
  }
  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'investigations') {
    if (req.method === 'POST' && parts.length === 3) action = action || 'new-investigation';
    if (parts[3] && parts[3] !== 'search') investigationId = investigationId || parts[3];
    if (parts[3] && parts.length === 4 && req.method === 'GET') action = action || 'get';
    if (parts[4]) action = parts[4];
    if (parts.length === 4 && req.method === 'POST' && !parts[4]) action = action || 'search';
  }
  const actionAlias = {
    topic: 'topic-search',
    everything: 'find-everything',
    premium: 'premium-accounts',
    more: 'find-more',
    like: 'more-like-this',
    different: 'find-different',
    similar: 'find-similar',
    visual: 'search-this-visual',
    confirm: 'confirm-identity',
    reject: 'reject-identity',
    bondage: 'dive-bondage',
    people: 'dive-people',
    clothing: 'dive-visuals',
    visuals: 'dive-visuals',
  };
  if (actionAlias[action]) action = actionAlias[action];
  if (!action && req.method === 'POST' && (path === '/api/v1' || path === '/api/v1/search' || path === '/search')) action = body.action || 'search';

  const diagnostic = !!(body.diagnostic || u.searchParams.get('diagnostic'));
  const fixture = body.fixture || u.searchParams.get('fixture') || '';

  if (action === 'new-investigation' || action === 'reset' || action === 'new') {
    const incoming = loadInvestigation(investigationId, body.investigationState);
    const state = applyInvestigationAction(incoming || createInvestigationState(body), 'reset', body);
    rememberInvestigation(state);
    return json({
      ok: true,
      investigationId: state.investigationId,
      version: PLANNER_VERSION,
      build: PLANNER_BUILD,
      action: 'new-investigation',
      investigationState: state,
      trail: state.trail,
      savedEvidence: state.savedEvidence,
      note: 'Hard live-state reset. Explicitly saved collections were kept.',
    }, 200, req);
  }

  const loaded = loadInvestigation(investigationId, body.investigationState);
  if (action === 'get' || action === 'trail' || action === 'evidence' || action === 'results') {
    if (!loaded) {
      return json({
        ok: false,
        error: 'Investigation not in this Worker isolate',
        hint: 'Worker memory is not durable. POST this same path with the investigationState returned by search/dive, or continue via POST /api/v1/machine/search or /dive with that state.',
        investigationId: investigationId || null,
        action,
      }, 404, req);
    }
    const state = (body.investigationState && body.investigationState.investigationId)
      ? { ...createInvestigationState(), ...body.investigationState }
      : loaded;
    if (investigationId && state.investigationId && investigationId !== state.investigationId) {
      state.investigationId = investigationId;
    }
    rememberInvestigation(state);
    return json(attachInvestigationStateEcho({
      ok: true,
      investigationId: state.investigationId,
      action,
      subject: state.subject,
      topic: state.topic,
      trail: state.trail,
      savedEvidence: state.savedEvidence,
      identityFeedback: state.identityFeedback,
      identityState: identityStateFrom(state, null),
      relationships: relationshipsFrom(null, state),
      retrievalLanes: retrievalLanesFrom(null),
      candidates: state.candidates,
      results: action === 'results' || action === 'evidence' ? (state.lastApiResults || state.results || []) : undefined,
      investigationState: state,
      capabilities: machineCapabilities(env),
      pipeline: machinePipeline(),
      samePipelineAsIphoneUi: true,
      readOnly: true,
    }, state), 200, req);
  }

  let state = loaded || createInvestigationState({ ...body, investigationId: investigationId || undefined });
  if (body.investigationState && body.investigationState.investigationId) state = { ...createInvestigationState(), ...body.investigationState };
  if (!state.investigationId) state.investigationId = investigationId || newInvestigationId();
  if (investigationId && !state.investigationId) state.investigationId = investigationId;

  if (action === 'confirm-identity' || action === 'reject-identity' || action === 'reject-image' || action === 'branch' || action === 'save') {
    state = applyInvestigationAction(state, action, body);
    rememberInvestigation(state);
    if (action === 'branch') {
      return json({ ok: true, investigationId: state.investigationId, action: 'branch', parent: body.investigationId || investigationId, investigationState: state, trail: state.trail }, 200, req);
    }
    const shouldSearch = action === 'confirm-identity' || action === 'reject-identity' || action === 'reject-image';
    if (!shouldSearch) {
      return json({ ok: true, investigationId: state.investigationId, action, investigationState: state, identityFeedback: state.identityFeedback, trail: state.trail }, 200, req);
    }
  }

  const subject = body.subject || body.entity || state.subject || '';
  const topic = body.topic || state.topic || '';
  const query = String(body.query || body.q || [subject, topic].filter(Boolean).join(' ') || '').trim();
  const adult = body.adult || body.adultLens || state.adultLens || 'on';
  const type = body.type || body.hint || state.entityType || '';
  const seed = body.seed || body.seedVisual || null;
  const modeMap = {
    search: '',
    identify: 'identity',
    'topic-search': 'intersection',
    intersection: 'intersection',
    'find-everything': 'find-everything',
    'premium-accounts': 'premium-accounts',
    'find-more': 'find-more',
    'more-like-this': 'more-like-this',
    'find-different': 'find-different',
    'find-similar': 'find-similar',
    'search-this-visual': 'search-this-visual',
    'more-from-this-source': 'more-from-this-source',
    'more-from-this-person': 'more-from-this-person',
    'more-on-this-topic': 'more-on-this-topic',
    'dive-bondage': 'dive-bondage',
    'dive-people': 'dive-people',
    'dive-clothing': 'dive-visuals',
    'dive-visuals': 'dive-visuals',
    'confirm-identity': '',
    'reject-identity': 'find-different',
    'reject-image': 'find-different',
  };
  const intentMode = body.mode || modeMap[action] || '';

  if (action === 'retrieve' || action === 'source') {
    const target = body.url || u.searchParams.get('url') || '';
    if (!target) return json({ error: 'Missing url' }, 400, req);
    resetFetchBudget();
    const result = await retrieveSource(target);
    return json({ ok: result.status === 'RETRIEVED', investigationId: state.investigationId, action, retrieve: result, frames: action === 'analyze' ? undefined : undefined }, result.status === 'RETRIEVAL_FAILED' ? 422 : 200, req);
  }
  if (action === 'analyze') {
    const analyzed = await analyzeExactSource(req, env, body);
    state = attachExactSourceToInvestigation(state, analyzed);
    rememberInvestigation(state);
    return json(attachInvestigationStateEcho({
      ok: true,
      investigationId: state.investigationId,
      action: 'analyze',
      investigationState: state,
      identityState: identityStateFrom(state, null),
      readOnly: true,
      parentReceivedSeeds: Array.isArray(analyzed.seeds) && analyzed.seeds.length > 0,
      ...analyzed,
    }, state), 200, req);
  }
  if (action === 'learn') {
    return learnHandler(req, env);
  }
  if (action === 'images' || action === 'videos') {
    rememberInvestigation(state);
    return json({
      ok: true,
      investigationId: state.investigationId,
      action,
      images: action === 'images' ? state.visuals : undefined,
      videos: action === 'videos' ? { items: [], frames: 'UNKNOWN', timestamps: 'UNKNOWN' } : undefined,
      investigationState: state,
    }, 200, req);
  }

  if (!query && action !== 'health') {
    return json({ error: 'Missing query/subject', investigationId: state.investigationId, action }, 400, req);
  }

  state = applyInvestigationAction(state, action === 'confirm-identity' ? 'search' : action, { subject, topic, query });
  resetFetchBudget();
  const discovery = await runDiscovery(query || subject, {
    hint: type,
    entity: subject,
    topic,
    adult,
    findEverything: action === 'find-everything' || body.findEverything,
    premiumAccounts: action === 'premium-accounts' || body.premiumAccounts,
    mode: intentMode,
    findMore: action === 'find-more',
    moreLikeThis: action === 'more-like-this',
    findDifferent: action === 'find-different' || action === 'reject-identity' || action === 'reject-image',
    findSimilar: action === 'find-similar',
    searchThisVisual: action === 'search-this-visual',
    moreFromThisSource: action === 'more-from-this-source',
    moreFromThisPerson: action === 'more-from-this-person',
    moreOnThisTopic: action === 'more-on-this-topic',
    diveLens: action === 'dive-bondage' ? 'bondage' : (action === 'dive-people' ? 'people' : (action === 'dive-visuals' || action === 'dive-clothing' ? 'visuals' : (body.diveLens || ''))),
    seedVisual: seed,

    excludeUrls: [].concat(body.excludeUrls || [], state.identityFeedback.rejectedUrls || [], state.identityFeedback.rejectedImages || []),
    excludeHosts: [].concat(body.excludeHosts || [], state.identityFeedback.rejectedHosts || []),
    identityFeedback: state.identityFeedback,
    priorResults: body.priorResults || state.priorCorpus || state.lastApiResults || state.results || [],
    graphLeads: body.graphLeads || state.graphLeads || [],
    attemptedQueries: body.attemptedQueries || state.attemptedQueries || [],
    fixture,
    diagnostic,
    enrich: !fixture,
    researchFocus: body.researchFocus || body.focus || state.researchFocus || '',
    resume: body.resume === true || action === 'resume' || action === 'continue',
    resumeQueue: body.resumeQueue || body.investigationQueue || state.investigationQueue || null,
    confirmIdentity: action === 'confirm-identity' || body.confirmIdentity === true,
    identityPhase: body.identityPhase === true,
    investigationId: state.investigationId,
    investigationState: state,
  });
  const packed = packApiDiscovery(discovery, state, action || 'search', req, { diagnostic, env });
  return json(packed, 200, req);
}


function describeCarmenEnvironment(env, ai) {
  const testKeyRequired = !!(env && env.CARMEN_TEST_KEY);
  return {
    name: (env && (env.CARMEN_ENV || env.ENVIRONMENT)) || 'cloudflare-worker',
    worker: 'carmen',
    workerBinding: 'carmen-iphone-v25',
    assetsBound: !!(env && env.ASSETS && typeof env.ASSETS.fetch === 'function'),
    aiConfigured: !!(ai && ai.configured),
    machineAuthConfigured: !!(env && String(env.CARMEN_API_KEY || '').trim()),
    testKeyRequired,
    secretsExposed: false,
  };
}

function browserTestDescriptor(env) {
  return {
    available: true,
    sameUiAsIphone: true,
    samePipelineAsIphoneUi: true,
    primary: '/test',
    routes: ['/test', '/browser-test'],
    session: '/api/v1/browser-test-session',
    interaction: 'real-dom',
    selectors: {
      searchInput: '[data-testid="search-input"]',
      searchSubmit: '[data-testid="search-submit"]',
      newInvestigation: '[data-testid="new-investigation"]',
      deepDive: '[data-testid="deep-dive"]',
      diveBondage: '[data-testid="dive-bondage"]',
      divePeople: '[data-testid="dive-people"]',
      diveVisuals: '[data-testid="dive-visuals"]',
      photoInput: '[data-testid="photo-input"]',
      findMore: '[data-testid="find-more"]',
      save: '[data-testid="save"]',
      howIGotHere: '[data-testid="how-i-got-here"]',
      results: '[data-testid="results"]',
      status: '[data-testid="carmen-status"]',
    },
    wait: 'document.documentElement[data-carmen-status] and document.documentElement[data-carmen-busy]',
    testKeyRequired: !!(env && env.CARMEN_TEST_KEY),
    access: (env && env.CARMEN_TEST_KEY)
      ? 'Open /test. If API JSON routes require it, send X-Carmen-Test-Key. The UI itself uses the same /search /dive routes as the iPhone app.'
      : 'Open /test or /browser-test on this origin — no extra authentication. No redirect, no Continue click.',
  };
}

function issueBrowserTestSession(req, env) {
  const sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ('bt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
  return json({
    ok: true,
    mode: 'browser-test',
    sessionId,
    issuedAt: new Date().toISOString(),
    expiresInSeconds: 86400,
    ui: '/test',
    aliases: ['/test', '/browser-test'],
    sameUiAsIphone: true,
    samePipelineAsIphoneUi: true,
    testKeyRequired: !!(env && env.CARMEN_TEST_KEY),
    capabilities: ['research', 'retrieve', 'save internal investigation state', 'analyze', 'branch', 'click', 'type', 'wait for async state', 'inspect DOM'],
    forbidden: ['send messages', 'post', 'follow accounts', 'purchase', 'submit external forms'],
    note: 'Optional correlation id for a remote browser agent. Does not grant extra privileges. Never returns secrets or production credentials.',
  }, 200, req, {
    'set-cookie': 'carmen_browser_test=' + sessionId + '; Path=/; Max-Age=86400; SameSite=Lax',
  });
}

const BROWSER_TEST_UI = new Set(['/test', '/browser-test']);

function browserTestRewritePath(pathname) {
  const raw = String(pathname || '/');
  const trimmed = raw.replace(/\/+$/, '') || '/';
  if (BROWSER_TEST_UI.has(trimmed)) return '/index.html';
  for (const prefix of ['/test/', '/browser-test/']) {
    if (raw === prefix) return '/index.html';
    if (raw.startsWith(prefix)) {
      const rest = raw.slice(prefix.length);
      if (!rest || rest === 'index.html') return '/index.html';
      if (rest.includes('..') || rest.includes('\\')) return null;
      return '/' + rest.replace(/^\/+/, '');
    }
  }
  return null;
}

async function serveBrowserTestSurface(req, env) {
  const u = new URL(req.url);
  const rewrite = browserTestRewritePath(u.pathname);
  if (!rewrite) return null;
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    return new Response('Carmen static assets binding is missing. Set the ASSETS binding in wrangler.jsonc.', {
      status: 500,
      headers: { ...cors(req), 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  const assetUrl = new URL(req.url);
  assetUrl.pathname = rewrite;
  if (rewrite !== '/index.html') assetUrl.search = '';
  const assetReq = new Request(assetUrl.toString(), { method: 'GET', headers: req.headers });
  const res = await env.ASSETS.fetch(assetReq);
  const headers = new Headers(res.headers);
  headers.set('x-carmen-browser-test', '1');
  headers.set('x-carmen-version', PLANNER_VERSION);
  headers.set('x-carmen-build', PLANNER_BUILD);
  headers.set('cache-control', 'no-store');
  headers.delete('location');
  const corsHeaders = cors(req);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  if (rewrite === '/index.html') {
    let html = await res.text();
    if (/location\.replace\s*\(\s*["']\//i.test(html) || /http-equiv=["']refresh["']/i.test(html)) {
      const fallbackUrl = new URL(req.url);
      fallbackUrl.pathname = '/index.html';
      const fallback = await env.ASSETS.fetch(new Request(fallbackUrl.toString(), { method: 'GET', headers: req.headers }));
      html = await fallback.text();
    }
    if (!/name=["']carmen-browser-test["']/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, '<head$1>\n  <meta name="carmen-browser-test" content="1">');
    }
    if (!/<base\s/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, '<head$1>\n  <base href="/">');
    }
    html = html.replace(/<html([^>]*)>/i, (m, attrs) => {
      if (/data-carmen-browser-test=/i.test(attrs)) return m;
      return '<html' + attrs + ' data-carmen-browser-test="1">';
    });
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('set-cookie', 'carmen_browser_test=1; Path=/; Max-Age=86400; SameSite=Lax');
    return new Response(html, { status: 200, headers });
  }
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response('', { headers: cors(req) });
    if (u.pathname === '/health' && req.method === 'GET') {
      const ai = getAiConfig(env);
      return json({
        ok: true,
        worker: 'carmen',
        version: PLANNER_VERSION,
        build: PLANNER_BUILD,
        schemaVersion: 2,
        environment: describeCarmenEnvironment(env, ai),
        provider: ai.provider,
        model: ai.model,
        configured: ai.configured,
        browserTest: browserTestDescriptor(env),
        testRoutes: ['/test', '/browser-test', '/api/v1/browser-test-session'],
        routes: ['/health', '/search', '/classify', '/retrieve', '/source', '/img', '/dive', '/learn', '/chat', '/analyze', '/synthesize', '/api', '/api/v1', '/test', '/browser-test'],
        searchProviders: ['DuckDuckGo', 'Bing', 'Bing Images', 'Yahoo Images', 'Bing Videos', 'Reddit', 'Wikipedia', 'Startpage', 'Pullpush', 'Wayback'],
        assets: !!(env.ASSETS && typeof env.ASSETS.fetch === 'function'),
        api: { docs: '/api', version: 'v1', samePipelineAsIphoneUi: true },
        features: ['discovery', 'retrieve', 'provenance', 'ranking', 'images', 'videos', 'deep-dive', 'dive-select', 'learn', 'collections', 'adaptive-paths', 'branching', 'instructions', 'timeline', 'evidence', 'leads', 'expanded-research', 'access-states', 'adult-filter', 'adult-lens', 'research-context', 'discovery-graph', 'research-depth', 'relationship-follow', 'result-kinds', 'interest-lenses', 'investigation-choices', 'visual-identity', 'selected-entity', 'dive-workspace', 'entity-source-separation', 'semantic-concepts', 'staged-research', 'intersection-first', 'analysis-retry', 'bounded-analysis', 'continue-batch', 'source-restriction', 'visual-corpus', 'investigate-further', 'clothing', 'premium-content', 'tutorials', 'measurements', 'visual-mode', 'not-this', 'source-class', 'identity-expansion', 'video-corpus', 'corpus-scale', 'source-first', 'query-class-memory', 'knowledge-model', 'no-auto-save', 'v48-reddit-indexed-fallback', 'v48-reserved-reddit', 'v48-reserved-adult-identity', 'v48-visual-enrichment', 'v48-research-metrics', 'v48-focus-modes', 'v49-investigation-loop', 'v49-dive-context-search', 'v49-reddit-stream', 'v49-how-i-got-here', 'v49-surprise-me', 'v49-find-more', 'v49-teach-in-context', 'v49.2-topic-map-retrieval', 'v49.2-subject-topic-intersection', 'v49.2-adult-source-classes', 'v49.2-premium-accounts', 'v49.2-known-entity', 'v49.2-merge-not-replace', 'v49.2-reddit-posts-only', 'v49.2-identity-candidates', 'v49.2-analyze-any-evidence', 'v49.3-chatgpt-access', 'v49.3-machine-api', 'v49.3-adult-source-classes', 'v49.3-identity-feedback', 'v49.3-semantic-more-like-this', 'v49.3-ownership-classes', 'v49.3-known-site-blocked', 'v49.3-keep-subject-topic-evidence', 'v49.4-deep-dive-lenses', 'v49.4-bondage-people-clothing', 'v49.4-discovery-chains', 'v49.4-additive-expansion', 'v49.4-visual-identity', 'v49.5-adult-first-nl', 'v49.5-visuals-lens', 'v49.5-photo-input', 'v49.5-intent-class', 'v49.6-image-extraction', 'v49.6-first-party-source', 'v49.6-state-isolation', 'v49.6-semantic-adult', 'v49.7-retrieval-engine', 'v49.7-entity-topic-coupling', 'v49.7-visual-class', 'v49.7-match-quality', 'v49.7-what-carmen-checked', 'v49.7-why-did-you-stop', 'v49.7-premium-escalation', 'v49.7-public-accounts', 'v49.7-semantic-variations', 'v49.7-tutorial-routing', 'v49.8-adaptive-investigation', 'v49.8-novelty-continuation', 'v49.8-visual-branch', 'v49.8-account-investigation', 'v49.8-recursive-seeds', 'v49.8-identity-variants', 'v49.9-identity-verification', 'v49.9-persistent-queue', 'v49.9-visual-evidence-gate', 'v49.9-find-more-unique', 'v49.9-research-focus', 'v49.9-adaptive-lens-focus', 'v49.9-analyze-public-account', 'v49.11-exact-source-retrieval', 'v49.11-source-state-machine', 'v49.11-source-id-canonical-url'],
      }, 200, req);
    }
    if (u.pathname === '/search' && req.method === 'GET') return searchWeb(req);
    if (u.pathname === '/search' && req.method === 'POST') return handleCarmenApi(req, env);
    if (u.pathname === '/classify' && req.method === 'GET') return classifyHandler(req);
    if (u.pathname === '/img' && req.method === 'GET') return imageProxy(req);
    if (u.pathname === '/dive' && req.method === 'POST') return deepDiveHandler(req, env);
    if (u.pathname === '/learn' && req.method === 'POST') return learnHandler(req, env);
    if (u.pathname === '/chat' && req.method === 'POST') return chat(req, env);
    if (u.pathname === '/analyze' && req.method === 'POST') return analyze(req, env);
    if (u.pathname === '/synthesize' && req.method === 'POST') return synthesize(req, env);
    if ((u.pathname === '/retrieve' || u.pathname === '/source') && (req.method === 'GET' || req.method === 'POST')) return retrieveHandler(req);
    if (u.pathname === '/api' || u.pathname === '/api/' || u.pathname.startsWith('/api/')) return handleCarmenApi(req, env);
    // Browser-test surface: same PWA + same backend as /. No parallel UI. No redirect.
    const browserTestPage = await serveBrowserTestSurface(req, env);
    if (browserTestPage) return browserTestPage;
    // SPA fallback: serve static assets for everything else.
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(req);
    return new Response('Carmen static assets binding is missing. Set the ASSETS binding in wrangler.jsonc.', { status: 500, headers: { ...cors(req), 'content-type': 'text/plain; charset=utf-8' } });
  },
};

// --- Source retrieval layer (Phase 2) ---------------------------------------
const RETRIEVE_TIMEOUT_MS = 12000;
const MAX_RETRIEVE_BYTES = 1500000;
const MAX_TEXT_CHARS = 100000;
const MAX_IMAGES = 12;
const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\]|\[fd)/i;

function normalizeUrlForStore(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    if (!/^https?:$/i.test(u.protocol)) return '';
    u.hash = '';
    return u.href;
  } catch { return ''; }
}

function metaTagContent(html, prop) {
  const esc = String(prop || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!esc) return '';
  const tagRe = new RegExp('<meta\\b[^>]*(?:property|name)\\s*=\\s*(?:["\']' + esc + '["\']|' + esc + ')(?=[\\s>])[^>]*>', 'i');
  const tag = String(html || '').match(tagRe);
  if (!tag) return '';
  const quoted = tag[0].match(/content\s*=\s*["']([^"']*)["']/i);
  if (quoted) return decodeEntities(quoted[1]);
  const bare = tag[0].match(/content\s*=\s*([^\s>]+)/i);
  return bare ? decodeEntities(bare[1]) : '';
}

function extractMeta(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const desc = metaTagContent(html, 'description')
    || metaTagContent(html, 'og:description')
    || (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i) || [])[1] || '';
  const ogImage = metaTagContent(html, 'og:image')
    || metaTagContent(html, 'og:image:url')
    || metaTagContent(html, 'twitter:image')
    || (html.match(/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']*)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:image(?::url)?["']/i) ||
      html.match(/<meta[^>]+(?:name|property)=["']twitter:image(?::src)?["'][^>]+content=["']([^"']*)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']twitter:image/i) || [])[1] || '';
  const ogVideo = metaTagContent(html, 'og:video')
    || metaTagContent(html, 'og:video:url')
    || (html.match(/<meta[^>]+property=["']og:video(?::url)?["'][^>]+content=["']([^"']*)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:video(?::url)?["']/i) || [])[1] || '';
  const ogTitle = metaTagContent(html, 'og:title');
  const ogUrl = metaTagContent(html, 'og:url');
  return {
    title: cleanText(ogTitle || title).slice(0, 300),
    rawTitle: cleanText(title).slice(0, 300),
    ogTitle: cleanText(ogTitle).slice(0, 300),
    ogUrl: String(ogUrl || '').trim(),
    description: cleanText(desc).slice(0, 600),
    ogImage: decodeEntities(ogImage),
    ogVideo: decodeEntities(ogVideo),
  };
}

function extractPublicIdentifiers(html, pageUrl) {
  const profiles = [];
  const handles = [];
  const aliases = [];
  const seen = new Set();
  const addProfile = (href) => {
    try {
      const u = new URL(decodeEntities(href), pageUrl);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();
      if (!/^(x\.com|twitter\.com|instagram\.com|onlyfans\.com|linkedin\.com)$/.test(host)) return;
      const parts = u.pathname.split('/').filter(Boolean);
      let part = parts[0];
      if (host === 'linkedin.com') part = parts[0] === 'in' || parts[0] === 'company' ? parts[1] : '';
      if (!part || /^(intent|share|search|i|p|reel|explore|login|signup|cdn-cgi)$/i.test(part)) return;
      if (/\.(ico|png|jpe?g|gif|svg|xml|json|css|js|webp|woff2?)$/i.test(part)) return;
      const url = (host === 'linkedin.com' ? ('https://www.linkedin.com/in/' + part) : ('https://' + host + '/' + part));
      if (seen.has(url.toLowerCase())) return;
      seen.add(url.toLowerCase());
      profiles.push(url);
      handles.push('@' + part.replace(/^@/, ''));
    } catch {}
  };
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html || '')) && profiles.length < 8) addProfile(m[1]);
  const creator = (html || '').match(/twitter:creator["'][^>]*content=["']@?([^"'>\s]+)/i)
    || (html || '').match(/content=["']@?([^"'>\s]+)["'][^>]*twitter:creator/i);
  if (creator && creator[1]) handles.push('@' + creator[1].replace(/^@/, ''));
  const pathAlias = humanizePath(pageUrl);
  if (pathAlias && /[A-Za-z]/.test(pathAlias) && pathAlias.length >= 4) aliases.push(pathAlias);
  return {
    profiles: [...new Set(profiles)].slice(0, 6),
    handles: [...new Set(handles)].slice(0, 6),
    aliases: [...new Set(aliases)].slice(0, 4),
  };
}

function simpleFingerprint(text) {
  let h = 0;
  const s = String(text || '').slice(0, 50000);
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return 'fp_' + (h >>> 0).toString(16);
}

async function retrieveWayback(url) {
  try {
    const r = await fetchText('https://archive.org/wayback/available?url=' + encodeURIComponent(url), {
      headers: { accept: 'application/json', 'user-agent': 'CarmenResearch/41 (investigation workspace)' },
    }, 8000);
    if (!r.ok) return null;
    const j = await r.json();
    const snap = j?.archived_snapshots?.closest;
    if (!snap || !snap.available || !snap.url) return null;
    return snap.url;
  } catch { return null; }
}

function redirectMeta(requested, finalUrl) {
  const req = String(requested || '');
  const fin = String(finalUrl || req);
  let redirected = false;
  let toHomepage = false;
  try {
    const a = new URL(req);
    const b = new URL(fin);
    a.hash = ''; b.hash = '';
    redirected = a.href.replace(/\/$/, '') !== b.href.replace(/\/$/, '');
    const path = b.pathname || '/';
    toHomepage = redirected && (path === '/' || path === '') && !b.search;
  } catch {
    redirected = !!(req && fin && req !== fin);
  }
  return {
    requestedUrl: req,
    finalUrl: fin,
    redirected,
    redirectToHomepage: toHomepage,
    accessNote: toHomepage
      ? 'Requested URL redirected to a generic homepage. That page is not the originally requested resource.'
      : (redirected ? 'Retrieval followed a redirect. The original URL is preserved separately from the final URL.' : ''),
  };
}

function isProfileCollapsedToPlatformHome(requestedUrl, finalUrl, html, meta) {
  const identity = exactSourceIdentity(requestedUrl || '');
  const handle = String(identity.handle || '').replace(/^@/, '');
  const host = String(identity.host || hostOf(requestedUrl) || '').replace(/^www\./, '');
  if (!handle) return false;
  const premium = MEMBER_HOST_RE.test(host) || AUTH_HOST_RE.test(host) || /onlyfans|fansly|loyalfans|manyvids|patreon/i.test(host);
  if (!premium) return false;
  const blob = String(html || '').toLowerCase();
  const handlePresent = blob.includes(handle.toLowerCase());
  const title = String((meta && (meta.ogTitle || meta.title || meta.rawTitle)) || '').trim();
  const titleIsPlatform = /^(onlyfans|fansly|loyalfans|manyvids|patreon)$/i.test(title);
  let ogIsHome = false;
  const ogUrl = String((meta && meta.ogUrl) || '').trim();
  try {
    if (ogUrl) {
      const u = new URL(ogUrl);
      const p = (u.pathname || '/').replace(/\/+$/, '') || '/';
      ogIsHome = p === '/' && u.hostname.replace(/^www\./, '').toLowerCase() === host.toLowerCase();
    }
  } catch {}
  let finalIsHome = false;
  try {
    const u = new URL(finalUrl || requestedUrl);
    const p = (u.pathname || '/').replace(/\/+$/, '') || '/';
    const req = new URL(requestedUrl);
    const reqPath = (req.pathname || '/').replace(/\/+$/, '');
    finalIsHome = p === '/' && reqPath && reqPath !== '/' && u.hostname.replace(/^www\./, '').toLowerCase() === host.toLowerCase();
  } catch {}
  if ((ogIsHome || finalIsHome || titleIsPlatform) && !handlePresent) return true;
  if (titleIsPlatform && !new RegExp('\\b' + handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(title)) return true;
  return false;
}

function decorateAccess(base, access) {
  return {
    ...base,
    status: access.status || base.status,
    accessState: access.accessState,
    accessNote: access.note || base.accessNote || '',
    error: access.error || base.error,
  };
}

async function retrieveExactSource(targetUrl, opts = {}) {
  const identity = opts.identity || exactSourceIdentity(targetUrl, {});
  const url = identity.canonicalUrl || normalizeUrlForStore(targetUrl) || String(targetUrl || '');
  if (identity.sourceType === 'reddit-post' || identity.postId) {
    const reddit = await retrieveExactReddit(url, identity, opts);
    if (reddit) return reddit;
  }
  const retrieved = await retrieveSource(url, opts);
  if (retrieved && retrieved.status !== 'RETRIEVED') {
    const publicBits = [retrieved.title, retrieved.description, retrieved.ogImage, retrieved.publicEvidence].filter(Boolean).join(' · ').slice(0, 600);
    if (publicBits && !retrieved.publicEvidence) retrieved.publicEvidence = publicBits;
  }
  return retrieved;
}

async function retrieveExactReddit(targetUrl, identity, opts = {}) {
  const parsed = identity.postId ? identity : parseRedditPermalink(targetUrl);
  const postId = parsed.postId || identity.postId;
  const permalink = parsed.canonicalPermalink || identity.permalink || targetUrl;
  const path = (() => { try { return new URL(permalink.startsWith('http') ? permalink : 'https://' + permalink).pathname.replace(/\/+$/, ''); } catch { return pathOf(permalink); } })();
  const packFromListing = (listing, extra = {}) => {
    if (!listing || !listing.ok || !listing.post) return null;
    const p = listing.post;
    if (!p.id && !p.title && !p.body) return null;
    if (postId && p.id && String(p.id).replace(/^t3_/, '') !== String(postId).replace(/^t3_/, '')) return null;
    const text = cleanText((p.title || '') + ' ' + (p.body || '')).slice(0, MAX_TEXT_CHARS);
    return {
      status: 'RETRIEVED',
      accessState: extra.accessState || 'DIRECTLY_RETRIEVED',
      url: permalink,
      finalUrl: p.permalink || permalink,
      title: p.title || 'Reddit post',
      description: String(p.body || '').slice(0, 600),
      text,
      textExcerpt: text,
      ogImage: (listing.media || [])[0] || '',
      images: (listing.media || extra.images || []).slice(0, MAX_IMAGES),
      fingerprint: simpleFingerprint(text),
      retrievedAt: new Date().toISOString(),
      author: p.author || '',
      subreddit: p.subreddit || (identity.subreddit ? 'r/' + identity.subreddit : ''),
      published: p.created || '',
      contentType: extra.contentType || 'application/json',
      redditPost: p,
      comments: listing.comments || extra.comments || [],
      outboundLinks: listing.outboundLinks || extra.outboundLinks || [],
      redditJson: extra.redditJson,
      exactSource: true,
      alternativeSource: extra.alternativeSource || '',
      accessNote: extra.accessNote || '',
    };
  };
  const failed = (note, accessState = 'NOT_PUBLICLY_RETRIEVABLE') => ({
    status: 'RETRIEVAL_FAILED',
    accessState,
    url: permalink,
    error: 'Exact Reddit post could not be publicly retrieved.',
    accessNote: note || 'Exact Reddit post could not be publicly retrieved. Generic Reddit search was not used as a substitute.',
    exactSource: true,
    subreddit: identity.subreddit ? 'r/' + identity.subreddit : '',
    author: identity.author || '',
    title: '',
    genericPlatformShell: true,
  });
  const isGenericRedditPage = (retrieved) => {
    if (!retrieved) return true;
    if (retrieved.redditPost && (retrieved.redditPost.title || retrieved.redditPost.body || retrieved.redditPost.id)) return false;
    const title = String(retrieved.title || '').trim();
    const excerpt = String(retrieved.textExcerpt || retrieved.text || retrieved.description || '');
    if (postId && (excerpt.includes(postId) || title.includes(postId))) return false;
    if (/^(reddit|old reddit|blocked|just a moment.*|attention required)$/i.test(title)) return true;
    if (!title || title.length < 3) return true;
    if (identity.sourceType === 'reddit-post' && !retrieved.redditPost) return true;
    return false;
  };

  if (postId && remainingFetches() > 0) {
    const pullUrls = [
      'https://api.pullpush.io/reddit/search/submission/?ids=' + encodeURIComponent(postId),
      'https://api.pullpush.io/reddit/search/submission/?ids=' + encodeURIComponent('t3_' + postId),
    ];
    for (const pu of pullUrls) {
      try {
        const rr = await fetchText(pu, { headers: { accept: 'application/json', 'user-agent': 'CarmenResearch/49.11 (exact-source)' }, redirect: 'follow' }, RETRIEVE_TIMEOUT_MS);
        if (!rr.ok) continue;
        const j = await rr.json().catch(() => ({}));
        const rows = Array.isArray(j?.data) ? j.data : (Array.isArray(j) ? j : []);
        const d = rows.find(x => x && String(x.id || '').replace(/^t3_/, '') === String(postId).replace(/^t3_/, '')) || rows[0];
        if (d && (d.title || d.selftext || d.id)) {
          let comments = [];
          try {
            const cr = await fetchText('https://api.pullpush.io/reddit/search/comment/?link_id=' + encodeURIComponent(postId) + '&size=20', { headers: { accept: 'application/json', 'user-agent': 'CarmenResearch/49.11 (exact-source)' } }, RETRIEVE_TIMEOUT_MS);
            if (cr.ok) {
              const cj = await cr.json().catch(() => ({}));
              const crows = Array.isArray(cj?.data) ? cj.data : (Array.isArray(cj) ? cj : []);
              comments = crows.slice(0, 20).map(c => ({ author: c.author || '', body: String(c.body || '').slice(0, 800), score: c.score, created: c.created_utc ? new Date(c.created_utc * 1000).toISOString() : '' }));
            }
          } catch {}
          const media = [];
          if (typeof d.url === 'string' && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(d.url)) media.push(d.url);
          if (typeof d.url_overridden_by_dest === 'string' && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(d.url_overridden_by_dest)) media.push(d.url_overridden_by_dest);
          const listing = parseRedditListing([{ kind: 'Listing', data: { children: [{ kind: 't3', data: d }] } }, { kind: 'Listing', data: { children: comments.map(c => ({ kind: 't1', data: c })) } }], permalink);
          const packed = packFromListing(listing, {
            accessState: 'PUBLIC_ALTERNATIVE',
            alternativeSource: 'Pullpush',
            comments,
            images: media,
            accessNote: 'Exact Reddit post retrieved from the public Pullpush archive of this post ID. This is not a generic Reddit search.',
          });
          if (packed) {
            packed.images = [...new Set([...(packed.images || []), ...media])].slice(0, MAX_IMAGES);
            packed.ogImage = packed.ogImage || media[0] || '';
            return packed;
          }
        }
      } catch {}
    }
  }

  const jsonCandidates = [];
  const add = (u) => { if (u && !jsonCandidates.includes(u)) jsonCandidates.push(u); };
  if (postId) {
    add('https://old.reddit.com/comments/' + postId + '.json?raw_json=1');
    add('https://www.reddit.com/by_id/t3_' + postId + '.json?raw_json=1');
  }
  add('https://old.reddit.com' + path + '.json?raw_json=1');
  for (const jsonUrl of jsonCandidates) {
    try {
      const rr = await fetchText(jsonUrl, { headers: { ...BROWSER_HEADERS, accept: 'application/json' }, redirect: 'follow' }, Math.min(RETRIEVE_TIMEOUT_MS, 5000));
      if (!rr.ok) continue;
      const j = await rr.json();
      const packed = packFromListing(parseRedditListing(j, permalink), { redditJson: j });
      if (packed) return packed;
    } catch {}
  }

  if (!opts.skipAlt) {
    try {
      const snap = await retrieveWayback(permalink);
      if (snap) {
        const alt = await retrieveSource(snap, { skipAlt: true });
        if (alt && alt.status === 'RETRIEVED' && !isGenericRedditPage(alt)) {
          return {
            ...alt,
            url: permalink,
            accessState: 'PUBLIC_ALTERNATIVE',
            accessNote: 'Exact Reddit permalink was archived. Public snapshot retrieved. This is not a generic Reddit search.',
            alternativeOf: permalink,
            alternativeSource: 'Internet Archive',
            alternativeUrl: snap,
            exactSource: true,
          };
        }
      }
    } catch {}
  }

  try {
    const htmlTry = await retrieveSource(permalink, { skipAlt: true });
    if (htmlTry && htmlTry.status === 'RETRIEVED' && !isGenericRedditPage(htmlTry)) {
      return { ...htmlTry, exactSource: true, redditPost: htmlTry.redditPost };
    }
  } catch {}

  return failed('Exact Reddit post could not be publicly retrieved. Generic Reddit search was not used as a substitute.');
}

async function retrieveSource(targetUrl, opts = {}) {
  const url = normalizeUrlForStore(targetUrl);
  if (!url) return { status: 'RETRIEVAL_FAILED', accessState: 'UNVERIFIED', error: 'Invalid URL', url: targetUrl };
  let host = '';
  try { host = new URL(url).hostname; } catch { return { status: 'RETRIEVAL_FAILED', accessState: 'UNVERIFIED', error: 'Invalid URL', url }; }
  if (PRIVATE_HOST_RE.test(host) || BLOCKED_HOSTS.has(host.toLowerCase())) {
    return { status: 'RETRIEVAL_FAILED', accessState: 'BLOCKED', error: 'Private or blocked host', url, host, accessNote: 'Carmen does not retrieve private or blocked hosts.' };
  }
  if (/(^|\.)reddit\.com$/i.test(host)) {
    try {
      const jsonUrl = /\.json(\?|$)/i.test(url) ? url : url.replace(/\/?(\?.*)?$/, '') + '.json';
      const rr = await fetchText(jsonUrl, { headers: { ...BROWSER_HEADERS, accept: 'application/json' }, redirect: 'follow' }, RETRIEVE_TIMEOUT_MS);
      if (rr.ok) {
        const j = await rr.json();
        const post = Array.isArray(j) ? j[0]?.data?.children?.[0]?.data : j?.data?.children?.[0]?.data;
        if (post && (post.title || post.body || post.selftext)) {
          const text = cleanText((post.title || '') + ' ' + (post.selftext || post.body || '')).slice(0, MAX_TEXT_CHARS);
          const images = [];
          const preview = post.preview?.images?.[0]?.source?.url;
          if (preview) images.push(decodeEntities(preview));
          if (typeof post.thumbnail === 'string' && post.thumbnail.startsWith('http')) images.push(post.thumbnail);
          if (typeof post.url_overridden_by_dest === 'string' && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(post.url_overridden_by_dest)) images.push(post.url_overridden_by_dest);
          return {
            status: 'RETRIEVED',
            accessState: 'DIRECTLY_RETRIEVED',
            url,
            finalUrl: post.permalink ? ('https://www.reddit.com' + post.permalink) : url,
            title: post.title || 'Reddit post',
            description: String(post.selftext || post.body || '').slice(0, 600),
            text,
            textExcerpt: text,
            ogImage: images[0] || '',
            images: images.slice(0, MAX_IMAGES),
            fingerprint: simpleFingerprint(text),
            retrievedAt: new Date().toISOString(),
            author: post.author || '',
            subreddit: post.subreddit_name_prefixed || (post.subreddit ? 'r/' + post.subreddit : ''),
            published: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : '',
            contentType: 'application/json',
          };
        }
      }
    } catch {}
  }
  try {
    const r = await fetchText(url, { headers: BROWSER_HEADERS, redirect: 'follow' }, RETRIEVE_TIMEOUT_MS);
    if (!r.ok) {
      const access = classifyAccess({ httpStatus: r.status, html: '', url, host, error: 'HTTP ' + r.status });
      const failed = decorateAccess({ url, host, httpStatus: r.status, error: 'HTTP ' + r.status }, access);
      const canAlt = !opts.skipAlt && (access.accessState === 'BLOCKED' || access.accessState === 'UNAVAILABLE') && access.accessState !== 'PAYWALLED' && access.accessState !== 'AUTHENTICATION_REQUIRED' && access.accessState !== 'AGE_RESTRICTED';
      if (canAlt && (r.status === 404 || r.status === 410)) {
        const snap = await retrieveWayback(url);
        if (snap) {
          const alt = await retrieveSource(snap, { skipAlt: true });
          if (alt.status === 'RETRIEVED') {
            return {
              ...alt,
              url,
              accessState: 'PUBLIC_ALTERNATIVE',
              accessNote: 'Original page was unavailable. Public archived snapshot retrieved. This is not a paywall bypass.',
              alternativeOf: url,
              alternativeSource: 'Internet Archive',
              alternativeUrl: snap,
            };
          }
        }
      }
      return failed;
    }
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_RETRIEVE_BYTES) {
      return { status: 'RETRIEVAL_FAILED', accessState: 'BLOCKED', error: 'Response too large', url, bytes: buf.byteLength, accessNote: 'The response was too large to retrieve safely.' };
    }
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.startsWith('image/')) {
      return {
        status: 'RETRIEVED',
        accessState: 'DIRECTLY_RETRIEVED',
        url,
        finalUrl: r.url || url,
        title: humanizePath(url) || host,
        description: 'Direct image resource',
        text: '',
        textExcerpt: '',
        ogImage: r.url || url,
        images: [r.url || url],
        fingerprint: simpleFingerprint(url + buf.byteLength),
        retrievedAt: new Date().toISOString(),
        bytes: buf.byteLength,
        contentType: ct,
        identifiers: { profiles: [], handles: [], aliases: [] },
      };
    }
    const html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    const access = classifyAccess({ httpStatus: r.status, html, url, host });
    const meta = extractMeta(html);
    const text = cleanText(html).slice(0, MAX_TEXT_CHARS);
    const extraImgs = extractImagesFromHtml(html, r.url || url);
    const images = rankImages([meta.ogImage, ...extraImgs], r.url || url).slice(0, 18);
    const imageExtraction = describeImageExtraction(html, r.url || url, { status: 'RETRIEVED', accessState: access.accessState, images });
    const identifiers = extractPublicIdentifiers(html, r.url || url);
    const graph = harvestPageGraph(html, r.url || url);
    let ogAbs = meta.ogImage;
    try { if (ogAbs) ogAbs = new URL(decodeEntities(ogAbs), r.url || url).href; } catch {}
    let ogVideo = meta.ogVideo || '';
    try { if (ogVideo) ogVideo = new URL(decodeEntities(ogVideo), r.url || url).href; } catch {}
    const publicBits = [meta.title, meta.description, ogAbs].filter(Boolean).join(' · ').slice(0, 400);
    const redir = redirectMeta(url, r.url || url);
    const collapsed = isProfileCollapsedToPlatformHome(url, r.url || url, html, meta);
    const ident = collapsed ? exactSourceIdentity(url) : null;
    const base = {
      url,
      requestedUrl: redir.requestedUrl,
      finalUrl: redir.finalUrl,
      redirected: redir.redirected || collapsed,
      redirectToHomepage: redir.redirectToHomepage || collapsed,
      title: collapsed ? (ident.displayName || ident.handle || '') : meta.title,
      description: collapsed ? '' : meta.description,
      ogImage: collapsed ? '' : (ogAbs || images[0] || ''),
      ogVideo: collapsed ? '' : ogVideo,
      images: collapsed ? [] : images,
      imageExtraction,
      fingerprint: simpleFingerprint(text),
      retrievedAt: new Date().toISOString(),
      bytes: buf.byteLength,
      contentType: r.headers.get('content-type') || '',
      identifiers: collapsed
        ? { profiles: ident.canonicalUrl ? [ident.canonicalUrl] : [], handles: ident.handle ? [ident.handle] : [], aliases: ident.displayName ? [ident.displayName] : [] }
        : identifiers,
      galleryUrls: collapsed ? [] : [...new Set([...(graph.galleries || []), ...galleryLinks(html, r.url || url)])].slice(0, 6),
      videoUrls: collapsed ? [] : (graph.videos || []).map(v => v.url).slice(0, 12),
      harvestedVideos: collapsed ? [] : (graph.videos || []),
      productionUrls: collapsed ? [] : (graph.productions || []).map(x => x.url).slice(0, 8),
      relatedUrls: collapsed ? [] : (graph.related || []).map(x => x.url).slice(0, 8),
      genericPlatformShell: collapsed,
      ogUrl: meta.ogUrl || '',
    };
    if (collapsed) {
      return {
        ...base,
        status: 'RETRIEVAL_FAILED',
        accessState: 'AUTHENTICATION_REQUIRED',
        accessNote: 'The host returned a generic ' + (ident.platform || host) + ' landing page instead of this profile. Authentication required for remaining content. This is not a retrieval of ' + (ident.handle || 'the requested profile') + '.',
        error: 'generic platform landing page',
        httpStatus: r.status,
        publicEvidence: ident.handle ? ('Public profile identity from the exact URL: @' + ident.handle + ' · ' + ident.canonicalUrl) : '',
        text: '',
        textExcerpt: '',
        exactSource: true,
      };
    }
    if (redir.redirectToHomepage) {
      return {
        ...base,
        status: 'RETRIEVAL_FAILED',
        accessState: 'REFERENCED',
        accessNote: redir.accessNote,
        error: 'redirected to homepage',
        httpStatus: r.status,
        publicEvidence: publicBits,
        text: '',
        textExcerpt: '',
      };
    }
    if (access.status !== 'RETRIEVED') {
      return {
        ...base,
        status: 'RETRIEVAL_FAILED',
        accessState: access.accessState,
        accessNote: access.note,
        error: access.error || 'inaccessible',
        httpStatus: r.status,
        publicEvidence: publicBits,
        text: '',
        textExcerpt: '',
      };
    }
    return {
      ...base,
      status: 'RETRIEVED',
      accessState: access.accessState,
      accessNote: access.note,
      text,
      textExcerpt: text,
      publicEvidence: access.accessState === 'PARTIALLY_RETRIEVED' ? publicBits : '',
    };
  } catch (e) {
    const err = e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 300);
    const access = classifyAccess({ html: '', url, host, error: err });
    const failed = decorateAccess({ url, error: err }, access);
    if (!opts.skipAlt && err === 'timeout') {
      const snap = await retrieveWayback(url);
      if (snap) {
        const alt = await retrieveSource(snap, { skipAlt: true });
        if (alt.status === 'RETRIEVED') {
          return {
            ...alt,
            url,
            accessState: 'PUBLIC_ALTERNATIVE',
            accessNote: 'Original page timed out. Public archived snapshot retrieved. This is not a paywall bypass.',
            alternativeOf: url,
            alternativeSource: 'Internet Archive',
            alternativeUrl: snap,
          };
        }
      }
    }
    return failed;
  }
}

async function retrieveHandler(req) {
  try {
    let target = '';
    if (req.method === 'GET') {
      target = new URL(req.url).searchParams.get('url') || '';
    } else {
      const b = await req.json().catch(() => ({}));
      target = b.url || b.target || '';
    }
    if (!target) return json({ error: 'Missing url parameter' }, 400, req);
    resetFetchBudget();
    const result = await retrieveSource(target);
    return json(result, result.status === 'RETRIEVAL_FAILED' ? 422 : 200, req);
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500, req);
  }
}

export { classifyQuery, scoreResult, buildSearchVariants, buildExpandedVariants, decodeEntities, rankResults, humanizePath, researchPaths, resolveDivePaths, inferPathsFromQuestion, parseInvestigativeQuestion, pathSearchVariants, youtubeId, collectDiveVideos, collectDiveImages, parseRelated, classifyAccess, accessLabel, parseQueryContext, attachContext, applyResearchFilter, normalizeAdult, adultSemanticVariants, imageSearchQuery, isAdultishSource, extraContext, normalizeDepth, contextVocabulary, discoveryLanes, extractGraphLeads, contextTermsForScore, isAggregatorPage, isSpecificEvidence, classifyResultKind, interestLenses, investigationChoices, visualCandidatesFor, buildSelectedEntity, entityIdFor, discoveryEvidenceFrom, diveSeedQuery, diveExpansionQueries, diveRetrievalQueue, userAskedForSourceRestriction, extractRequestedSourceDomain, interpretConcept, interpretRequest, morphologicalNeighbors, inferFamily, enrichConceptsFromEvidence, mergeConceptKnowledge, intersectionFormulations, intersectionBroadenQueries, budgetReport, resetFetchBudget, remainingFetches, FETCH_HARD_CAP, retrieveBatchPlan, isUnusableAnalysis, analysisExcerpts, applyQuestionToClassification, isNameParticle, redirectMeta, pickIdentityCandidate, nameOnIdentitySurface, isVisualSubject, visualDedupeKey, buildVisualCorpus, classifyVideoDuration, investigateFurtherQueries, ambiguousInterpretations, splitContextConcepts, visualQueryVariants, classifySourceClass, identityExpansionQueries, applyExclusions, pushVisualHit, plusSplitQuery, canonicalVideoKey, sourceClassQueries, sourceClassCatalog, independentLaneQueries, harvestPageGraph, nextUnusedQueries, collectPremiumContent, knowledgeModelGuide, parseAttemptedList, uniqueAdd, videoQueryVariants, isVideoUrl, expandVideoUrl, isRedditHost, redditBlocked, redditResultCount, adultIdentityQueries, adultIdentityCombinedQuery, ADULT_IDENTITY_SITES, buildResearchMetrics, reservedRedditLane, reservedAdultIdentityLane, redditIndexedWeb, redditPullpush, redditWayback, unwrap, parseBing, composeInvestigationQuery, parseInvestigationIntent, resolveKnownEntity, buildTopicMap, plannerLaneQueries, evidenceForResult, isQueryEchoTitle, isRedditSearchPage, isActualRedditEvidence, annotateProvenance, classifyAccountOwnership, mergeInvestigationEvidence, sourceDiversityReport, competingIdentityCandidates, findMoreQueries, moreLikeThisQueries, findDifferentQueries, analyzePayloadKind, PLANNER_BUILD, PLANNER_VERSION, identityIsAmbiguous, applyIdentityFeedback, serializeEvidenceItem, createInvestigationState, applyInvestigationAction, evidenceBuckets, knownSiteAccessStatus, intentClassFor, routeNaturalLanguageResearch, extractImagesFromHtml, describeImageExtraction, looksLikeFirstPartySource, fillTopicMapFromEvidence, isObjectOrTechniquePhrase, isTutorialIntent, parseRetrievalIntents, fictionalNameCollision, semanticVariations, classifyVisualRelevance, classifyMatchQuality, classifyContentType, socialShouldDeprioritize, sourceVolumePenalty, premiumAccessClassification, premiumEscalationQueries, publicAccountQueries, tutorialQueries, detectImpersonator, buildEntityIdentityRecord, buildWhatCarmenChecked, buildWhyDidYouStop, coupleEntityTopic, keepEntityTopicQueries, negativeResultReport, identityDisambiguation, conceptOrthographyVariants, conceptDiscoveryQueries, identityVariantQueries, visualInvestigationQueries, entityAssociatedVisualQueries, accountInvestigationQueries, extractInvestigationSeeds, evaluateNovelty, createAdaptiveController, enqueueInvestigationPaths, nextInvestigationBatch, recordInvestigationBatch, decideInvestigationContinuation, enqueueAdaptiveFamilies, seedsToQueries, adaptiveTrace, ADAPTIVE_TIME_GUARD_MS, ADAPTIVE_MAX_ITERATIONS, ADAPTIVE_BATCH_SIZE, conceptVisualSearchQuery, isRestraintTechnique, analyzeExactSource, retrieveExactSource, sourceIdFromCanonicalUrl, canonicalizeExactSourceUrl, exactSourceIdentity, parseRedditPermalink, parseRedditListing, buildSourceDebug, identifyExactSourceType };
