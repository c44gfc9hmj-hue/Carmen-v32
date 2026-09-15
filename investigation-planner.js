// Carmen v49.2 — investigation / topic-map planner.
// Query-centric retrieval is the fallback. The planner independently
// establishes subject evidence, topic evidence, and intersection evidence,
// then opens source-class lanes (especially adult) instead of stuffing
// tokens into one search string.
//
// This module is self-contained: no import from worker.js (avoids cycles).
// worker.js imports it.

export const PLANNER_VERSION = '49.2';
export const PLANNER_BUILD = '49.2-topic-map-retrieval';

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}
function pathOf(url) {
  try { return new URL(url).pathname || ''; } catch { return ''; }
}
function norm(s) {
  return String(s || '').toLowerCase().replace(/['’"]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function tokens(s) {
  return norm(s).split(/\s+/).filter(t => t.length > 1);
}
function includesAll(hay, parts) {
  const h = norm(hay);
  return (parts || []).length > 0 && parts.every(p => h.includes(norm(p)));
}
function includesAny(hay, parts) {
  const h = norm(hay);
  return (parts || []).some(p => p && h.includes(norm(p)));
}
function quote(s) {
  const t = String(s || '').replace(/"/g, '').trim();
  return t ? '"' + t + '"' : '';
}

// ---------------------------------------------------------------------------
// Known-entity registry (sites / organizations — never a hardcoded person list)
// ---------------------------------------------------------------------------
export const KNOWN_SITE_ENTITIES = [
  {
    id: 'house-of-gord',
    names: ['house of gord', 'houseofgord', 'hog site', 'gord studio'],
    aliases: ['House of Gord', 'HoG', 'houseofgord.com'],
    type: 'website',
    domain: 'houseofgord.com',
    topics: ['bondage', 'bdsm', 'fetish', 'metal bondage', 'cinch straps'],
    ecosystem: ['site', 'related-pages', 'products-content', 'people', 'studios-publishers', 'historical', 'other-public'],
    relatedDomains: ['houseofgord.com'],
  },
];

export function resolveKnownEntity(text) {
  const n = norm(text);
  if (!n) return null;
  for (const ent of KNOWN_SITE_ENTITIES) {
    if (n.includes(norm(ent.domain).replace(/\./g, ' ')) || n.includes(ent.domain.replace(/\./g, ''))) return { ...ent, matchedOn: 'domain' };
    for (const name of ent.names || []) {
      if (n.includes(norm(name)) || norm(name).includes(n)) return { ...ent, matchedOn: 'name' };
    }
    for (const a of ent.aliases || []) {
      if (n === norm(a) || n.includes(norm(a))) return { ...ent, matchedOn: 'alias' };
    }
  }
  // Bare domain-shaped token without scheme.
  const m = String(text || '').match(/\b([a-z0-9-]+\.[a-z]{2,})(?:\/|\b)/i);
  if (m) {
    const domain = m[1].toLowerCase();
    const named = KNOWN_SITE_ENTITIES.find(e => e.domain === domain);
    if (named) return { ...named, matchedOn: 'domain-token' };
    return {
      id: 'site:' + domain,
      names: [domain],
      aliases: [domain],
      type: 'website',
      domain,
      topics: [],
      ecosystem: ['site', 'related-pages', 'products-content', 'people', 'other-public'],
      relatedDomains: [domain],
      matchedOn: 'domain-token',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Adult source-class catalog (seeds + discovery, not a finite internet dump)
// ---------------------------------------------------------------------------
export const ADULT_SOURCE_CLASSES = [
  { id: 'identity-profile', label: 'identity/profile sources', kind: 'identity', seeds: ['iafd.com', 'adultfilmdatabase.com', 'babepedia.com', 'indexxx.com', 'freeones.com', 'thenude.com', 'boobpedia.com', 'data18.com', 'adultdvdtalk.com'], queries: ['profile', 'bio', 'database'] },
  { id: 'creator-owned', label: 'creator-owned sources', kind: 'identity', seeds: [], queries: ['official site', 'official website', 'linktree'] },
  { id: 'major-platform', label: 'major adult platforms', kind: 'platform', seeds: ['onlyfans.com', 'fansly.com', 'loyalfans.com', 'manyvids.com', 'fancentro.com', 'clips4sale.com', 'iwantclips.com', 'justfor.fans'], queries: [] },
  { id: 'premium-subscription', label: 'premium/subscription accounts', kind: 'premium', seeds: ['onlyfans.com', 'fansly.com', 'loyalfans.com', 'patreon.com', 'fancentro.com', 'manyvids.com', 'clips4sale.com'], queries: ['onlyfans', 'fansly', 'loyalfans', 'patreon'] },
  { id: 'creator-store', label: 'creator stores', kind: 'store', seeds: ['manyvids.com', 'clips4sale.com', 'iwantclips.com', 'fancentro.com'], queries: ['store', 'clips', 'videos for sale'] },
  { id: 'fetish-publisher', label: 'specialist BDSM/fetish publishers', kind: 'publisher', seeds: ['houseofgord.com', 'kink.com', 'devicebondage.com', 'hogtied.com', 'sexandsubmission.com', 'thetrainingofo.com', 'whippedass.com', 'waterbondage.com', 'ultimatum-bondage.com'], queries: ['bondage studio', 'fetish publisher', 'bdsm production'] },
  { id: 'studio-producer', label: 'studios/producers', kind: 'studio', seeds: [], queries: ['studio', 'production', 'directed by', 'filmography'] },
  { id: 'video', label: 'video', kind: 'video', seeds: [], queries: ['video', 'clip', 'scene', 'trailer'] },
  { id: 'images-galleries', label: 'images/galleries', kind: 'image', seeds: [], queries: ['gallery', 'photoset', 'stills', 'photos'] },
  { id: 'community-social', label: 'community/social sources', kind: 'social', seeds: ['x.com', 'twitter.com', 'instagram.com'], queries: [] },
  { id: 'reddit', label: 'Reddit', kind: 'reddit', seeds: ['reddit.com'], queries: [] },
  { id: 'directories', label: 'directories', kind: 'directory', seeds: ['indexxx.com', 'linktr.ee', 'allmylinks.com'], queries: ['directory', 'links'] },
  { id: 'interviews', label: 'interviews/articles/events', kind: 'interview', seeds: [], queries: ['interview', 'podcast', 'feature', 'q&a', 'article'] },
  { id: 'collaborators', label: 'collaborators/related people', kind: 'people', seeds: [], queries: ['with', 'and', 'co-star', 'studio'] },
  { id: 'related-sites', label: 'related websites/domains', kind: 'site', seeds: [], queries: ['official site', 'website', 'homepage'] },
];

export const PREMIUM_PLATFORM_SEEDS = [
  { host: 'onlyfans.com', label: 'OnlyFans' },
  { host: 'fansly.com', label: 'Fansly' },
  { host: 'loyalfans.com', label: 'LoyalFans' },
  { host: 'manyvids.com', label: 'ManyVids' },
  { host: 'fancentro.com', label: 'FanCentro' },
  { host: 'clips4sale.com', label: 'Clips4Sale' },
  { host: 'iwantclips.com', label: 'IWantClips' },
  { host: 'patreon.com', label: 'Patreon' },
  { host: 'justfor.fans', label: 'JustForFans' },
  { host: 'fanvue.com', label: 'Fanvue' },
];

export const GENERIC_INDEX_HOSTS = [
  'pinterest.com', 'youtube.com', 'youtu.be', 'bing.com', 'google.com',
  'duckduckgo.com', 'yahoo.com', 'startpage.com', 'mojeek.com',
];

export const TOPIC_VOCAB = {
  bondage: ['bondage', 'bdsm', 'fetish', 'kink', 'restrained', 'bound', 'rope bondage', 'metal bondage', 'gag', 'gagged', 'cinch', 'hogtie'],
};

export function topicTerms(topic) {
  const t = norm(topic);
  if (!t) return [];
  const extra = [];
  for (const [k, vals] of Object.entries(TOPIC_VOCAB)) {
    if (t.includes(k) || vals.some(v => t.includes(norm(v)))) extra.push(...vals);
  }
  return [...new Set([t, ...tokens(topic), ...extra.map(norm)])].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------
const FIND_EVERYTHING_RE = /\b(find everything|everything related|everything about|all sources|full investigation|map (?:the )?topic|investigate everything)\b/i;
const PREMIUM_RE = /\b(premium accounts?|subscription accounts?|paid accounts?|onlyfans|fansly|loyalfans|patreon|manyvids|all (?:her|his|their) (?:premium|paid|subscription) (?:accounts?|pages?))\b/i;
const FIND_MORE_RE = /\b(find more|more evidence|more sources|expand (?:the )?investigation|keep looking)\b/i;
const MORE_LIKE_RE = /\b(more like this|similar (?:to this|sources?|results?))\b/i;
const FIND_DIFFERENT_RE = /\b(find different|something else|alternative sources?|different sources?|not (?:these|this))\b/i;
const NEW_INVESTIGATION_RE = /\b(new investigation|start over|clear investigation|hard reset)\b/i;

export function parseInvestigationIntent(query, opts = {}) {
  const raw = String(query || '').trim();
  const entity = String(opts.entity || '').replace(/"/g, '').trim();
  const topicIn = String(opts.topic || '').replace(/"/g, '').trim();
  const adult = String(opts.adult || opts.adultContent || 'off').toLowerCase();
  const known = resolveKnownEntity(raw) || (entity ? resolveKnownEntity(entity) : null) || (topicIn ? resolveKnownEntity(topicIn) : null);

  let mode = 'search';
  if (opts.mode) mode = String(opts.mode);
  else if (FIND_EVERYTHING_RE.test(raw) || opts.findEverything) mode = 'find-everything';
  else if (PREMIUM_RE.test(raw) || opts.premiumAccounts) mode = 'premium-accounts';
  else if (MORE_LIKE_RE.test(raw) || opts.visualMode === 'similar' || opts.moreLikeThis) mode = 'more-like-this';
  else if (FIND_DIFFERENT_RE.test(raw) || opts.visualMode === 'different' || opts.findDifferent) mode = 'find-different';
  else if (FIND_MORE_RE.test(raw) || opts.visualMode === 'more' || opts.findMore) mode = 'find-more';
  else if (known && (topicIn || /\bbondage|bdsm|fetish\b/i.test(raw))) mode = 'known-site-topic';
  else if (known) mode = 'known-site';
  else if ((entity && topicIn) || (opts.keepSubject && topicIn)) mode = 'intersection';
  else if (entity) mode = 'identity';

  let subject = entity || (known && (known.names && known.names[0])) || '';
  let topic = topicIn;
  if (!subject && known) subject = known.aliases?.[0] || known.domain;
  if (!topic && known && raw) {
    const stripped = raw.replace(new RegExp(known.names.concat(known.aliases || []).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'ig'), ' ').replace(FIND_EVERYTHING_RE, ' ').replace(PREMIUM_RE, ' ');
    topic = stripped.replace(/\s+/g, ' ').trim();
  }
  if (!subject && !known) {
    // "Drea Morgan bondage" → subject + topic when trailing known investigative context
    const trail = raw.match(/^(.+?)\s+(bondage|bdsm|fetish|kink|lawsuits?|transmission problems?|premium accounts?)\s*$/i);
    if (trail) {
      subject = trail[1].trim();
      topic = topic || trail[2].trim();
      if (mode === 'search') mode = 'intersection';
    }
  }

  if (mode === 'search' && (FIND_EVERYTHING_RE.test(raw))) mode = 'find-everything';
  if (PREMIUM_RE.test(raw) && mode !== 'premium-accounts') {
    if (!topic) topic = 'premium accounts';
  }

  const findEverything = mode === 'find-everything' || FIND_EVERYTHING_RE.test(raw) || opts.findEverything === true;
  const premiumAccounts = mode === 'premium-accounts' || PREMIUM_RE.test(raw) || opts.premiumAccounts === true;

  let entityTypeHint = String(opts.hint || opts.type || '').trim();
  if (known && !entityTypeHint) entityTypeHint = known.type || 'website';

  return {
    rawQuery: raw,
    subject: subject || entity,
    topic: topic,
    entityTypeHint,
    adultLens: adult === 'on' || adult === 'both' || adult === 'off' ? adult : 'off',
    mode,
    findEverything,
    premiumAccounts,
    knownEntity: known,
    expansionHints: [],
    priorResults: Array.isArray(opts.priorResults) ? opts.priorResults : [],
    identityFeedback: opts.identityFeedback || { confirmed: [], rejectedPeople: [], rejectedImages: [], rejectedHosts: [] },
    seed: opts.seedVisual || opts.seed || null,
    excludeUrls: [].concat(opts.excludeUrls || []),
    excludeHosts: [].concat(opts.excludeHosts || []),
  };
}

export function isPremiumAccountIntent(query, opts) {
  return parseInvestigationIntent(query, opts).premiumAccounts;
}

export function isFindEverythingIntent(query, opts) {
  return parseInvestigationIntent(query, opts).findEverything;
}

export function isNewInvestigationIntent(query) {
  return NEW_INVESTIGATION_RE.test(String(query || ''));
}

// ---------------------------------------------------------------------------
// Topic map
// ---------------------------------------------------------------------------
function branch(id, label, sourceClass, queries, priority) {
  return {
    id,
    label,
    sourceClass,
    queries: [...new Set((queries || []).map(q => String(q || '').trim()).filter(Boolean))],
    priority: priority == null ? 50 : priority,
    status: 'pending',
    results: 0,
  };
}

export function buildTopicMap(intent, classification) {
  const subject = String((intent && intent.subject) || (classification && classification.subject) || '').replace(/"/g, '').trim();
  const topic = String((intent && intent.topic) || (classification && classification.context) || '').replace(/"/g, '').trim();
  const adultOn = (intent && (intent.adultLens === 'on' || intent.adultLens === 'both')) || (classification && (classification.adultContent === 'on' || classification.adultContent === 'both'));
  const type = (intent && intent.entityTypeHint) || (classification && classification.type) || '';
  const person = type === 'person' || type === 'social' || type === 'ambiguous' || (!type && subject && /^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/.test(subject));
  const known = intent && intent.knownEntity;
  const qSub = quote(subject) || subject;
  const branches = [];
  const add = (...args) => {
    const b = branch(...args);
    if (b.queries.length) branches.push(b);
  };

  if (known) {
    add('site', 'site', 'related-sites', [
      'site:' + known.domain,
      qSub + ' site:' + known.domain,
      known.domain,
    ], 0);
    add('related-pages', 'related pages', 'related-sites', [
      qSub + ' (page OR gallery OR model OR feature)',
      '"' + known.domain + '" (archive OR history OR about)',
    ], 1);
    add('products-content', 'products/content', 'fetish-publisher', [
      qSub + ' ' + (topic || 'bondage') + ' (feature OR photoset OR video OR scene)',
      'site:' + known.domain + ' ' + (topic || 'bondage'),
    ], 2);
    add('people', 'people', 'collaborators', [
      qSub + ' (model OR performer OR featuring)',
    ], 3);
    add('studios-publishers', 'studios/publishers', 'studio-producer', [
      qSub + ' (studio OR publisher OR production OR "house of")',
    ], 4);
    add('historical', 'historical references', 'interviews', [
      qSub + ' (history OR interview OR article OR archive OR founded)',
    ], 5);
    add('other-public', 'other relevant public sources', 'community-social', [
      qSub + ' site:reddit.com',
      qSub + ' (review OR wiki OR fandom)',
    ], 6);
  }

  add('identity', 'identity/profile sources', 'identity-profile', person
    ? [qSub + ' (profile OR bio OR "official site" OR database)', qSub]
    : [qSub + ' (official OR about OR homepage)', qSub], 10);

  if (person && adultOn) {
    for (const cls of ADULT_SOURCE_CLASSES) {
      const qs = [];
      for (const seed of cls.seeds.slice(0, 4)) qs.push(qSub + ' site:' + seed);
      for (const t of cls.queries.slice(0, 2)) qs.push(qSub + ' ' + t + (topic ? ' ' + topic : ''));
      add(cls.id, cls.label, cls.id, qs, 20 + ADULT_SOURCE_CLASSES.indexOf(cls));
    }
  } else if (adultOn && topic) {
    add('fetish-publisher', 'specialist BDSM/fetish publishers', 'fetish-publisher', [
      qSub + ' ' + topic + ' (studio OR publisher OR production)',
      topic + ' site:houseofgord.com',
      qSub + ' site:kink.com',
    ], 22);
  }

  if (topic) {
    add('intersection', 'subject × topic intersection', 'intersection', [
      qSub + ' ' + topic,
      qSub + ' "' + topic + '"',
      qSub + ' ' + topic + ' (scene OR photoset OR interview OR feature)',
    ], 8);
    add('topic-only', 'topic evidence (not counted as intersection)', 'topic', [
      topic + ' (glossary OR meaning OR studio OR publisher)',
    ], 40);
  }

  if (intent && intent.premiumAccounts) {
    for (const p of PREMIUM_PLATFORM_SEEDS) {
      add('premium-' + p.host.split('.')[0], p.label + ' account', 'premium-subscription', [
        qSub + ' site:' + p.host,
        qSub + ' "' + p.label + '"',
      ], 12);
    }
    add('premium-verify', 'ownership verification', 'directories', [
      qSub + ' (onlyfans OR fansly OR loyalfans OR patreon OR manyvids) (official OR verified OR linktree)',
    ], 13);
  }

  if (intent && intent.findEverything && person) {
    add('reddit', 'Reddit', 'reddit', [qSub + (topic ? ' ' + topic : '') + ' site:reddit.com'], 30);
    add('interviews', 'interviews/articles/events', 'interviews', [qSub + ' (interview OR podcast OR feature OR article)'], 31);
    add('collaborators', 'collaborators/related people', 'collaborators', [qSub + ' (with OR "co-star" OR studio OR directed)'], 32);
  }

  if (intent && intent.mode === 'find-more') {
    add('find-more', 'additional evidence within the investigation', 'identity-profile', [
      qSub + (topic ? ' ' + topic : '') + ' (interview OR credits OR gallery OR profile)',
    ], 7);
  }
  if (intent && intent.mode === 'more-like-this' && intent.seed) {
    const seed = intent.seed;
    const domain = seed.domain || hostOf(seed.url || seed.pageUrl || '');
    add('more-like-this', 'semantic/feature similarity', domain ? 'related-sites' : 'images-galleries', [
      qSub + (topic ? ' ' + topic : '') + (seed.title ? ' ' + String(seed.title).slice(0, 40) : ''),
      domain ? qSub + ' site:' + domain.replace(/^www\./, '') : '',
    ], 7);
  }
  if (intent && intent.mode === 'find-different') {
    const neg = (intent.excludeHosts || []).slice(0, 4).map(h => '-site:' + String(h).replace(/^www\./, '')).join(' ');
    add('find-different', 'alternative sources', 'related-sites', [
      qSub + (topic ? ' ' + topic : '') + ' (gallery OR interview OR database) ' + neg,
    ], 7);
  }

  branches.sort((a, b) => a.priority - b.priority);
  return {
    subject,
    topic,
    knownEntity: known || null,
    findEverything: !!(intent && intent.findEverything),
    premiumAccounts: !!(intent && intent.premiumAccounts),
    adultLens: (intent && intent.adultLens) || 'off',
    organizeBy: 'source-class',
    branches,
  };
}

export function plannerLaneQueries(topicMap, opts = {}) {
  const attempted = new Set((opts.attemptedQueries || []).map(s => String(s).toLowerCase()));
  const out = [];
  const cap = Math.max(4, Number(opts.limit) || 18);
  for (const b of (topicMap && topicMap.branches) || []) {
    for (const q of b.queries) {
      if (!q || attempted.has(q.toLowerCase())) continue;
      out.push({
        q,
        why: b.label,
        lane: b.id,
        kind: b.sourceClass === 'images-galleries' ? 'image' : (b.sourceClass === 'video' ? 'video' : 'web'),
        sourceClass: b.sourceClass,
        branchId: b.id,
      });
      if (out.length >= cap) return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Evidence model — subject / topic / intersection independently
// ---------------------------------------------------------------------------
export function isQueryEchoTitle(title, query) {
  const t = norm(title);
  const q = norm(query);
  if (!t || !q) return false;
  const suffix = t.startsWith(q) ? t.slice(q.length).trim() : '';
  const chrome = /^(search|results?|images?|videos?|google|bing|duckduckgo)$/.test(suffix) && (t.length - q.length) < 16;
  const exact = t === q || t.replace(/\s+/g, '') === q.replace(/\s+/g, '');
  if (!exact && !chrome) return false;
  if (chrome) return true;
  // Exact title==query is echo only when the query looks like a stuffed
  // subject+topic search, not a legitimate identity page titled with the name.
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length >= 4) return true;
  if (/\b(bondage|bdsm|fetish|kink|lawsuits?|premium|accounts?|transmission|repair|towing|interview|photoset|find everything)\b/.test(q)) return true;
  return false;
}

export function isRedditSearchPage(url, title) {
  const u = String(url || '');
  const host = hostOf(u);
  if (!(host === 'reddit.com' || host.endsWith('.reddit.com'))) return false;
  const path = pathOf(u).replace(/\/+$/, '');
  if (/^\/search$/i.test(path) || /\/search\/?$/i.test(path)) return true;
  if (/[?&]q=/i.test(u) && /\/search/i.test(u)) return true;
  if (/reddit public search/i.test(String(title || ''))) return true;
  return false;
}

export function isActualRedditEvidence(url) {
  const u = String(url || '');
  const host = hostOf(u);
  if (!(host === 'reddit.com' || host.endsWith('.reddit.com'))) return false;
  if (isRedditSearchPage(u)) return false;
  const path = pathOf(u);
  return /\/comments\//i.test(path) || /\/r\/[^/]+\/comments\//i.test(path) || /\/r\/[^/]+\/s\//i.test(path) || /\/user\/[^/]+\/comments\//i.test(path);
}

export function evidenceForResult(item, intent, classification) {
  const subject = String((intent && intent.subject) || (classification && classification.subject) || '').trim();
  const topic = String((intent && intent.topic) || (classification && classification.context) || '').trim();
  const title = String((item && item.title) || '');
  const snip = String((item && (item.snippet || item.textExcerpt || item.description)) || '');
  const url = String((item && item.url) || '');
  const blob = title + ' ' + snip + ' ' + url;
  const subjToks = tokens(subject).filter(t => t.length > 2);
  const topicToks = topicTerms(topic);
  const query = String((intent && intent.rawQuery) || [subject, topic].filter(Boolean).join(' '));

  const echo = isQueryEchoTitle(title, query) || isQueryEchoTitle(title, subject + ' ' + topic);
  const host = hostOf(url).replace(/^www\./, '');

  let subjectEvidence = 'none';
  if (subjToks.length && includesAll(blob, subjToks)) {
    const identityHost = /(iafd|adultfilmdatabase|babepedia|indexxx|freeones|wikipedia|imdb|linkedin|instagram|onlyfans|houseofgord)/i.test(host)
      || /\/(model|performer|pornstar|profile|person)\b/i.test(url);
    subjectEvidence = identityHost || includesAll(title, subjToks) ? 'strong' : 'weak';
  } else if (subjToks.length && includesAny(blob, subjToks)) {
    subjectEvidence = 'weak';
  }

  let topicEvidence = 'none';
  if (topicToks.length) {
    const hit = topicToks.filter(t => t.length > 2 && norm(blob).includes(t));
    if (hit.length) {
      // Query-echo titles are not topic evidence.
      if (echo && hit.length <= tokens(topic).length) topicEvidence = 'none';
      else topicEvidence = (hit.length >= 2 || includesAny(title + ' ' + snip, topicToks.filter(t => t.length > 4))) ? 'strong' : 'weak';
    }
  }

  let intersection = 'none';
  if (subjectEvidence !== 'none' && topicEvidence !== 'none') {
    // Strong intersection requires BOTH independently — a profile page that
    // merely contains the query string in the title is not enough.
    if (echo) intersection = 'none';
    else if (subjectEvidence === 'strong' && topicEvidence === 'strong') intersection = 'strong';
    else intersection = 'weak';
  }

  const reasons = [];
  if (subjectEvidence !== 'none') reasons.push('subject:' + subjectEvidence);
  if (topicEvidence !== 'none') reasons.push('topic:' + topicEvidence);
  if (intersection !== 'none') reasons.push('intersection:' + intersection);
  if (echo) reasons.push('query-echo');
  if (isRedditSearchPage(url, title)) reasons.push('reddit-search-page');

  return { subjectEvidence, topicEvidence, intersection, echo, reasons };
}

export function isStrongIntersection(ev) {
  return ev && ev.intersection === 'strong';
}

// ---------------------------------------------------------------------------
// Provenance: host / publisher / creator / originalSource / reposter / mirror
// ---------------------------------------------------------------------------
export function annotateProvenance(item) {
  const url = String((item && item.url) || '');
  const host = hostOf(url).replace(/^www\./, '') || 'UNKNOWN';
  const path = pathOf(url);
  const title = String((item && item.title) || '');
  let publisher = 'UNKNOWN';
  let creator = 'UNKNOWN';
  let originalSource = 'UNKNOWN';
  let reposter = 'UNKNOWN';
  let mirror = 'UNKNOWN';

  if (/wikipedia\.org|britannica\.com|imdb\.com|iafd\.com|adultfilmdatabase\.com/.test(host)) {
    publisher = host;
  }
  if (/reddit\.com/.test(host)) {
    publisher = 'reddit.com';
    const m = path.match(/\/r\/([^/]+)/i);
    if (m) publisher = 'r/' + m[1];
  }
  if (/pinterest\.com|tumblr\.com|blogger\.com/.test(host)) {
    publisher = host;
    reposter = host;
  }
  if (/(archive\.org|web\.archive\.org)/.test(host)) {
    mirror = host;
    originalSource = 'UNKNOWN';
  }
  // Never infer creator merely because a host contains the material.
  if (/\/user\/|\/u\/|\/model\/|\/performers?\//i.test(path) && /official|verified/i.test(title)) {
    creator = 'INFERRED';
  }

  return {
    host: host || 'UNKNOWN',
    publisher,
    creator,
    originalSource,
    reposter,
    mirror,
  };
}

export function classifyAccountOwnership(item, subject) {
  const url = String((item && item.url) || '');
  const host = hostOf(url).replace(/^www\./, '');
  const path = pathOf(url);
  const title = String((item && item.title) || '');
  const snip = String((item && item.snippet) || '');
  const blob = norm(title + ' ' + snip + ' ' + path);
  const subj = tokens(subject);
  const platform = PREMIUM_PLATFORM_SEEDS.find(p => host === p.host || host.endsWith('.' + p.host));
  const isDir = /(indexxx|freeones|thenude|linktr\.ee|allmylinks|babepedia)/i.test(host);
  const isMirror = /(archive\.org|mirror)/i.test(host);
  const handle = (path.match(/^\/+([A-Za-z0-9._-]{2,40})\/?$/) || [])[1] || '';
  const nameInHandle = handle && subj.length && subj.every(t => norm(handle).includes(t.slice(0, 4)));
  const verifiedish = /verified|official account|official page/i.test(title + ' ' + snip);

  if (isMirror) return { kind: 'mirror', platform: platform ? platform.label : host, confidence: 'low', handle: handle || 'UNKNOWN' };
  if (isDir) return { kind: 'directory listing', platform: platform ? platform.label : host, confidence: 'low', handle: handle || 'UNKNOWN' };
  if (platform && (nameInHandle || verifiedish) && includesAll(blob, subj)) {
    return { kind: verifiedish ? 'official account' : 'creator-owned account', platform: platform.label, confidence: verifiedish ? 'medium' : 'low', handle: handle || 'UNKNOWN' };
  }
  if (platform && /fan|leaks|repost|unofficial/i.test(blob)) {
    return { kind: 'fan/reposter', platform: platform.label, confidence: 'medium', handle: handle || 'UNKNOWN' };
  }
  if (platform) return { kind: 'unknown', platform: platform.label, confidence: 'low', handle: handle || 'UNKNOWN' };
  return { kind: 'unknown', platform: 'UNKNOWN', confidence: 'low', handle: handle || 'UNKNOWN' };
}

// ---------------------------------------------------------------------------
// Merge, diversity, corpus diagnosis
// ---------------------------------------------------------------------------
export function canonicalizeUrl(url) {
  try {
    const u = new URL(String(url));
    u.hash = '';
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    u.hostname = u.hostname.replace(/^www\./, '').toLowerCase();
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach(k => u.searchParams.delete(k));
    return u.href;
  } catch {
    return String(url || '').replace(/#.*$/, '').replace(/\/+$/, '');
  }
}

export function mergeInvestigationEvidence(prior, next) {
  const out = [];
  const seen = new Set();
  for (const r of [...(prior || []), ...(next || [])]) {
    if (!r || !r.url) continue;
    const key = canonicalizeUrl(r.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, url: r.url });
  }
  return out;
}

export function sourceDiversityReport(results, opts = {}) {
  const adultOn = !!(opts.adultOn);
  const classes = {};
  const hosts = {};
  let generic = 0;
  let adult = 0;
  let redditPosts = 0;
  let redditSearch = 0;
  for (const r of results || []) {
    const host = (r.domain || hostOf(r.url)).replace(/^www\./, '');
    hosts[host] = (hosts[host] || 0) + 1;
    const sc = r.sourceClass || r.plannerSourceClass || 'UNKNOWN';
    classes[sc] = (classes[sc] || 0) + 1;
    if (GENERIC_INDEX_HOSTS.some(g => host === g || host.endsWith('.' + g))) generic++;
    if (ADULT_SOURCE_CLASSES.some(c => (c.seeds || []).some(s => host === s || host.endsWith('.' + s)))) adult++;
    if (isRedditSearchPage(r.url, r.title)) redditSearch++;
    else if (isActualRedditEvidence(r.url)) redditPosts++;
  }
  const genericHeavy = (results || []).length >= 4 && generic / Math.max(1, results.length) >= 0.5;
  const adultThin = adultOn && adult < 2 && (results || []).length >= 3;
  return {
    classes,
    hosts,
    genericCount: generic,
    adultSourceCount: adult,
    redditPosts,
    redditSearchPages: redditSearch,
    genericHeavy,
    adultThin,
    shouldOpenMoreAdultLanes: adultOn && (adultThin || genericHeavy),
  };
}

export function shouldOpenMoreAdultLanes(report) {
  return !!(report && report.shouldOpenMoreAdultLanes);
}

export function corpusDiagnosis(results, diagnostics, intent) {
  const n = (results || []).length;
  const diags = diagnostics || {};
  const providerFails = Object.values(diags).filter(d => d && typeof d === 'object' && (d.error || (d.status >= 400 && d.ok === false)));
  const providerOk = Object.values(diags).filter(d => d && typeof d === 'object' && (d.ok === true || (typeof d.added === 'number' && d.added > 0)));
  if (!n && providerFails.length && !providerOk.length) return { status: 'search_failed', label: 'search failed' };
  if (!n && Object.values(diags).some(d => d && (d.accessState === 'BLOCKED' || d.status === 403))) {
    return { status: 'source_inaccessible', label: 'source inaccessible' };
  }
  const subj = (intent && intent.subject) || '';
  const hasSubject = (results || []).some(r => r.evidence && r.evidence.subjectEvidence !== 'none');
  if (subj && n && !hasSubject) return { status: 'identity_unresolved', label: 'identity unresolved' };
  if (intent && intent.topic && n && !(results || []).some(r => r.evidence && r.evidence.intersection !== 'none')) {
    const anyTopic = (results || []).some(r => r.evidence && r.evidence.topicEvidence !== 'none');
    if (!anyTopic) return { status: 'evidence_unavailable', label: 'evidence unavailable' };
  }
  if (n > 0 && n < 3) return { status: 'thin_corpus', label: 'genuinely thin public corpus' };
  if (!n) return { status: 'evidence_unavailable', label: 'evidence unavailable' };
  return { status: 'ok', label: 'ok' };
}

export const EMPTY_INVESTIGATION_STATE = {
  subject: '',
  topic: '',
  candidates: [],
  visualCorpus: [],
  rejections: { urls: [], hosts: [], images: [] },
  trail: [],
  inFlight: null,
  temporarySearch: {},
  results: [],
  identityVerdict: null,
  selectedEntity: null,
  selectedCandidate: null,
};

// ---------------------------------------------------------------------------
// Identity candidates
// ---------------------------------------------------------------------------
export function competingIdentityCandidates(ranked, classification, opts = {}) {
  const subject = String((classification && classification.subject) || (opts.subject) || '').trim();
  const type = (classification && classification.type) || '';
  if (type && type !== 'person' && type !== 'social' && type !== 'ambiguous') {
    return { ambiguous: false, reason: 'not a person search', candidates: [] };
  }
  const nameToks = tokens(subject).filter(t => t.length > 1);
  if (nameToks.length < 2) {
    return { ambiguous: true, reason: 'single-token or incomplete name', candidates: clusterByHost(ranked).slice(0, 6) };
  }
  const usable = (ranked || []).filter(r => r && r.resultKind !== 'JUNK');
  const onName = usable.filter(r => includesAll((r.title || '') + ' ' + (r.url || ''), nameToks));
  const strongId = onName.filter(r => {
    const sc = r.sourceClass || '';
    return sc === 'DATABASE' || sc === 'PRIMARY' || sc === 'PUBLIC_PROFILE' || sc === 'ENCYCLOPEDIA' || (r.evidence && r.evidence.subjectEvidence === 'strong');
  });
  const clusters = clusterByIdentity(onName.length ? onName : usable);
  const confirmed = (opts.identityFeedback && opts.identityFeedback.confirmed) || [];
  if (confirmed.length) {
    return { ambiguous: false, reason: 'user confirmed identity', candidates: clusters.slice(0, 6), userConfirmed: true };
  }
  if (strongId.length >= 1 && clusters.length <= 1) {
    return { ambiguous: false, reason: 'strong corroborating identity evidence', candidates: clusters.slice(0, 3) };
  }
  if (clusters.length >= 2) {
    return { ambiguous: true, reason: 'competing identity candidates', candidates: clusters.slice(0, 6) };
  }
  return { ambiguous: false, reason: 'single identity cluster', candidates: clusters.slice(0, 3) };
}

function clusterByHost(ranked) {
  const by = new Map();
  for (const r of ranked || []) {
    const h = (r.domain || hostOf(r.url)).replace(/^www\./, '') || 'unknown';
    if (!by.has(h)) by.set(h, { id: h, label: r.title || h, sample: r, urls: [] });
    by.get(h).urls.push(r.url);
  }
  return [...by.values()];
}

function clusterByIdentity(rows) {
  const clusters = [];
  for (const r of rows || []) {
    const host = (r.domain || hostOf(r.url)).replace(/^www\./, '');
    const pathHead = pathOf(r.url).split('/').filter(Boolean).slice(0, 2).join('/');
    const key = host + '|' + pathHead.split(/[-_]/).slice(0, 2).join('-');
    let c = clusters.find(x => x.key === key || x.host === host);
    if (!c) {
      c = { key, host, label: r.title || host, sample: r, urls: [], sourceClass: r.sourceClass || '' };
      clusters.push(c);
    }
    c.urls.push(r.url);
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// Distinct expansion intents
// ---------------------------------------------------------------------------
export function findMoreQueries(intent, attempted) {
  const subject = quote(intent.subject) || intent.subject;
  const topic = intent.topic || '';
  const out = [];
  const add = (q, why) => {
    const t = String(q || '').trim();
    if (!t) return;
    if ((attempted || []).some(a => String(a).toLowerCase() === t.toLowerCase())) return;
    out.push({ q: t, why, lane: 'find-more', kind: 'web' });
  };
  add(subject + (topic ? ' ' + topic : '') + ' (interview OR feature OR credits)', 'additional evidence in this investigation');
  add(subject + ' (profile OR "official site" OR database)', 'more identity evidence');
  if (topic) add(subject + ' "' + topic + '" (photoset OR scene OR article)', 'more intersection evidence');
  return out;
}

export function moreLikeThisQueries(intent, seed) {
  const subject = quote(intent.subject) || intent.subject;
  const topic = intent.topic || '';
  const domain = (seed && (seed.domain || hostOf(seed.url || seed.pageUrl || ''))) || '';
  const title = String((seed && (seed.title || seed.caption)) || '').replace(/"/g, '').slice(0, 48);
  const out = [];
  const add = (q, why) => { if (q && q.trim()) out.push({ q: q.trim(), why, lane: 'more-like-this', kind: 'web' }); };
  if (domain) add(subject + ' site:' + domain.replace(/^www\./, ''), 'same source class / host');
  if (title) add(subject + ' ' + title, 'similar title/features');
  add(subject + (topic ? ' ' + topic : '') + ' (gallery OR interview OR production)', 'same subject + topic + media type');
  return out;
}

export function findDifferentQueries(intent, opts = {}) {
  const subject = quote(intent.subject) || intent.subject;
  const topic = intent.topic || '';
  const neg = (opts.excludeHosts || intent.excludeHosts || []).slice(0, 5).map(h => '-site:' + String(h).replace(/^www\./, '')).join(' ');
  const out = [];
  const add = (q, why) => { if (q && q.trim()) out.push({ q: q.trim(), why, lane: 'find-different', kind: 'web' }); };
  add(subject + (topic ? ' ' + topic : '') + ' (database OR interview OR official) ' + neg, 'alternative sources, avoiding duplicates');
  add(subject + ' (site:reddit.com OR site:iafd.com OR site:babepedia.com) ' + neg, 'pivot to unused source classes');
  return out;
}

export function surpriseHeuristic(interactions) {
  const items = (interactions || []).filter(x => x && (x.kind === 'save' || x.kind === 'select' || x.kind === 'more-like-this' || x.kind === 'deep-dive' || x.kind === 'teach'));
  if (!items.length) {
    return { pick: null, reason: 'No explicit saves, searches, or “more like this” yet — Surprise me stays empty rather than inventing a hidden preference model.' };
  }
  const last = items[items.length - 1];
  return {
    pick: last,
    reason: 'Surprise me is a bounded heuristic: it prefers something you already saved, selected, or asked to expand — not a hidden preference model. Picked “' + (last.label || last.title || last.query || 'recent interaction') + '”.',
  };
}

export function imageQueryInherits(intent, classification, feedback) {
  const subject = String((intent && intent.subject) || (classification && classification.subject) || '').trim();
  const topic = String((intent && intent.topic) || (classification && classification.context) || '').trim();
  const adult = (intent && intent.adultLens) || (classification && classification.adultContent) || 'off';
  const confirmed = (feedback && feedback.confirmed) || [];
  const rejected = (feedback && (feedback.rejectedPeople || feedback.rejectedImages)) || [];
  const rejectedHosts = (feedback && feedback.rejectedHosts) || [];
  const parts = [];
  if (subject) parts.push(quote(subject));
  if (topic) parts.push(topic);
  if (adult === 'on' && topic) parts.push(topic);
  const neg = rejectedHosts.slice(0, 3).map(h => '-site:' + String(h).replace(/^www\./, '')).join(' ');
  return {
    q: (parts.join(' ') + (neg ? ' ' + neg : '')).trim(),
    subject,
    topic,
    adultLens: adult,
    identityConfirmed: confirmed.length > 0,
    rejectedCount: rejected.length + rejectedHosts.length,
    inherit: { subject: true, topic: !!topic, identityConfirmation: confirmed.length > 0, adultLens: adult !== 'off', negativeFeedback: rejected.length > 0 || rejectedHosts.length > 0, positiveIdentityFeedback: confirmed.length > 0 },
  };
}

export function analyzePayloadKind(body) {
  if (!body || typeof body !== 'object') return 'empty';
  if (body.imageDataUrl && String(body.imageDataUrl).startsWith('data:image/')) return 'image';
  const url = String(body.url || body.pageUrl || (body.evidence && (body.evidence.url || body.evidence.pageUrl)) || '');
  const host = hostOf(url);
  if (/reddit\.com/.test(host)) return isActualRedditEvidence(url) ? 'reddit' : 'webpage';
  if (/\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(url)) return 'image-url';
  if (body.kind === 'video' || body.mediaKind === 'video' || /youtube|vimeo|\.mp4/i.test(url)) return 'video';
  if (url || body.title || body.snippet || body.textExcerpt || body.evidence) return 'webpage';
  return 'unknown';
}

export function videoFrameHonesty() {
  return {
    framesInspected: false,
    timestamps: 'UNKNOWN',
    note: 'Carmen cannot currently inspect the actual video frames. Timestamps are UNKNOWN until real frame analysis is available.',
  };
}
