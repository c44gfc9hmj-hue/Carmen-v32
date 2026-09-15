// Carmen v49.3 — investigation / topic-map planner + ChatGPT-access helpers.
// Query-centric retrieval is the fallback. The planner independently
// establishes subject evidence, topic evidence, and intersection evidence,
// then opens source-class lanes (especially adult) instead of stuffing
// tokens into one search string.
//
// This module is self-contained: no import from worker.js (avoids cycles).
// worker.js imports it. The machine-readable API uses these same functions.

export const PLANNER_VERSION = '49.3';
export const PLANNER_BUILD = '49.3-chatgpt-access';

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
  { id: 'premium-subscription', label: 'premium/subscription accounts', kind: 'premium', seeds: ['onlyfans.com', 'fansly.com', 'loyalfans.com', 'patreon.com', 'fancentro.com', 'justfor.fans', 'fanvue.com'], queries: ['onlyfans', 'fansly', 'loyalfans', 'patreon'] },
  { id: 'creator-store', label: 'creator clip stores', kind: 'store', seeds: ['manyvids.com', 'clips4sale.com', 'iwantclips.com', 'fancentro.com'], queries: ['store', 'clips', 'videos for sale'] },
  { id: 'major-video-platform', label: 'major adult video platforms', kind: 'video', seeds: ['pornhub.com', 'xvideos.com', 'xhamster.com', 'xnxx.com', 'youporn.com', 'spankbang.com', 'eporner.com'], queries: ['video', 'scene', 'trailer'] },
  { id: 'fetish-publisher', label: 'adult/fetish specialty sites', kind: 'publisher', seeds: ['houseofgord.com', 'kink.com', 'devicebondage.com', 'hogtied.com', 'sexandsubmission.com', 'thetrainingofo.com', 'whippedass.com', 'waterbondage.com', 'ultimatum-bondage.com'], queries: ['bondage studio', 'fetish publisher', 'bdsm production'] },
  { id: 'studio-producer', label: 'studios/publishers', kind: 'studio', seeds: [], queries: ['studio', 'production', 'directed by', 'filmography'] },
  { id: 'video', label: 'video sources', kind: 'video', seeds: [], queries: ['video', 'clip', 'scene', 'trailer'] },
  { id: 'images-galleries', label: 'image sources', kind: 'image', seeds: [], queries: ['gallery', 'photoset', 'stills', 'photos'] },
  { id: 'community-social', label: 'social/community platforms', kind: 'social', seeds: ['fetlife.com', 'x.com', 'twitter.com', 'instagram.com'], queries: [] },
  { id: 'reddit', label: 'Reddit', kind: 'reddit', seeds: ['reddit.com'], queries: [] },
  { id: 'directories', label: 'directories/indexes', kind: 'directory', seeds: ['indexxx.com', 'linktr.ee', 'allmylinks.com'], queries: ['directory', 'links'] },
  { id: 'interviews', label: 'interviews/articles', kind: 'interview', seeds: [], queries: ['interview', 'podcast', 'feature', 'q&a', 'article'] },
  { id: 'collaborators', label: 'related collaborators', kind: 'people', seeds: [], queries: ['with', 'co-star', 'photographer', 'studio'] },
  { id: 'events', label: 'event/production pages', kind: 'event', seeds: [], queries: ['convention', 'expo', 'awards', 'event'] },
  { id: 'archival', label: 'archival/historical sources', kind: 'archive', seeds: ['web.archive.org', 'archive.org'], queries: ['archive', 'historical', 'wayback'] },
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
  { host: 'fetlife.com', label: 'FetLife' },
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
const FIND_SIMILAR_RE = /\b(find similar|visually similar|similar (?:images?|visuals?|photos?))\b/i;
const SEARCH_VISUAL_RE = /\b(search this visual|this visual|search (?:this|the) (?:image|photo|picture))\b/i;
const MORE_SOURCE_RE = /\b(more from this source|more from this (?:host|site|domain|publisher))\b/i;
const MORE_PERSON_RE = /\b(more from this person|more from this (?:creator|performer|model))\b/i;
const MORE_TOPIC_RE = /\b(more on this topic|more about this topic|same topic)\b/i;
const NEW_INVESTIGATION_RE = /\b(new investigation|start over|clear investigation|hard reset)\b/i;
const CONFIRM_IDENTITY_RE = /\b(that(?:'|’)s the one|this is the (?:person|one)|positive identity|confirm(?:ed)? identity)\b/i;
const REJECT_IDENTITY_RE = /\b(not this person|not this one|wrong person|negative identity)\b/i;
const REJECT_IMAGE_RE = /\b(not this image|wrong image|reject(?:ed)? image)\b/i;

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
  else if (SEARCH_VISUAL_RE.test(raw) || opts.visualMode === 'searchvisual' || opts.searchThisVisual) mode = 'search-this-visual';
  else if (FIND_SIMILAR_RE.test(raw) || opts.visualMode === 'similar' || opts.findSimilar) mode = 'find-similar';
  else if (MORE_SOURCE_RE.test(raw) || opts.moreFromThisSource) mode = 'more-from-this-source';
  else if (MORE_PERSON_RE.test(raw) || opts.moreFromThisPerson) mode = 'more-from-this-person';
  else if (MORE_TOPIC_RE.test(raw) || opts.moreOnThisTopic) mode = 'more-on-this-topic';
  else if (MORE_LIKE_RE.test(raw) || opts.visualMode === 'similar' || opts.moreLikeThis) mode = 'more-like-this';
  else if (FIND_DIFFERENT_RE.test(raw) || opts.visualMode === 'different' || opts.findDifferent) mode = 'find-different';
  else if (FIND_MORE_RE.test(raw) || opts.visualMode === 'more' || opts.findMore) mode = 'find-more';
  else if (CONFIRM_IDENTITY_RE.test(raw) || opts.confirmIdentity) mode = 'confirm-identity';
  else if (REJECT_IDENTITY_RE.test(raw) || opts.rejectIdentity) mode = 'reject-identity';
  else if (REJECT_IMAGE_RE.test(raw) || opts.rejectImage) mode = 'reject-image';
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
    const usedSeeds = new Set();
    for (const cls of ADULT_SOURCE_CLASSES) {
      const qs = [];
      for (const seed of cls.seeds.slice(0, 3)) {
        if (usedSeeds.has(seed)) continue;
        usedSeeds.add(seed);
        qs.push(qSub + ' site:' + seed);
      }
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
    add('collaborators', 'collaborators/related people', 'collaborators', [qSub + ' (with OR "co-star" OR photographer OR studio)'], 32);
    add('aliases', 'aliases/usernames', 'identity-profile', [qSub + ' (aka OR "also known as" OR username OR handle)'], 33);
    add('unverified-leads', 'unknown/unverified leads', 'directories', [qSub + ' (claimed OR alleged OR directory OR "all links")'], 34);
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

  if (intent && intent.mode === 'find-similar' && intent.seed) {
    const seed = intent.seed;
    add('find-similar', 'visual/source-class similarity', 'images-galleries', [
      qSub + (topic ? ' ' + topic : '') + ' (photoset OR gallery OR stills)',
      seed.domain ? qSub + ' site:' + String(seed.domain).replace(/^www\./, '') : '',
    ], 7);
  }
  if (intent && intent.mode === 'search-this-visual' && intent.seed) {
    const seed = intent.seed;
    const domain = seed.domain || hostOf(seed.url || seed.pageUrl || '');
    add('search-this-visual', 'source page of the selected visual', domain ? 'related-sites' : 'images-galleries', [
      domain ? qSub + ' site:' + domain.replace(/^www\./, '') : '',
      qSub + (topic ? ' ' + topic : '') + ' (source OR credits OR page)',
    ], 7);
  }
  if (intent && intent.mode === 'more-from-this-source' && intent.seed) {
    const domain = intent.seed.domain || hostOf(intent.seed.url || '');
    add('more-from-this-source', 'more from this host (host ≠ creator)', 'related-sites', [
      domain ? qSub + ' site:' + String(domain).replace(/^www\./, '') : qSub,
    ], 7);
  }
  if (intent && intent.mode === 'more-from-this-person') {
    add('more-from-this-person', 'more from this person', 'identity-profile', [
      qSub + ' (profile OR credits OR gallery OR interview)',
    ], 7);
  }
  if (intent && intent.mode === 'more-on-this-topic' && topic) {
    add('more-on-this-topic', 'more on this topic', 'intersection', [
      qSub + ' ' + topic + ' (article OR feature OR glossary OR production)',
    ], 7);
  }

  branches.sort((a, b) => a.priority - b.priority);
  const seenQ = new Set();
  for (const b of branches) {
    b.queries = b.queries.filter(q => {
      const k = String(q).toLowerCase();
      if (seenQ.has(k)) return false;
      seenQ.add(k);
      return true;
    });
  }
  const deduped = branches.filter(b => b.queries.length > 0);
  return {
    subject,
    topic,
    knownEntity: known || null,
    findEverything: !!(intent && intent.findEverything),
    premiumAccounts: !!(intent && intent.premiumAccounts),
    adultLens: (intent && intent.adultLens) || 'off',
    organizeBy: 'source-class',
    branches: deduped,
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
export function isQueryEchoTitle(title, query, opts = {}) {
  const t = norm(title);
  const q = norm(query);
  if (!t || !q) return false;
  const subject = norm(opts.subject || '');
  // A legitimate identity page titled with the person's own name is never query echo.
  if (subject && t === subject) return false;
  const suffix = t.startsWith(q) ? t.slice(q.length).trim() : '';
  const chrome = /^(search|results?|images?|videos?|google|bing|duckduckgo)$/.test(suffix) && (t.length - q.length) < 16;
  const exact = t === q || t.replace(/\s+/g, '') === q.replace(/\s+/g, '');
  if (!exact && !chrome) return false;
  if (chrome) return true;
  // Exact title==query is echo only when the query looks like a stuffed
  // subject+topic search, not a legitimate identity page titled with the name.
  const words = q.split(/\s+/).filter(Boolean);
  if (subject && words.length <= 3 && !/\b(bondage|bdsm|fetish|kink|lawsuits?|premium|accounts?|transmission|repair|towing|interview|photoset|find everything)\b/.test(q) && (t === subject || t === q)) return false;
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

  const echo = isQueryEchoTitle(title, query, { subject }) || isQueryEchoTitle(title, subject + ' ' + topic, { subject });
  const host = hostOf(url).replace(/^www\./, '');
  const searchPage = isRedditSearchPage(url, title) || /\/search\/?\?/i.test(url) || /[?&]q=/.test(url) && /(google|bing|duckduckgo|yahoo|startpage|mojeek)\./i.test(host);

  let subjectEvidence = 'none';
  if (subjToks.length && includesAll(blob, subjToks)) {
    const identityHost = /(iafd|adultfilmdatabase|babepedia|indexxx|freeones|wikipedia|imdb|linkedin|instagram|onlyfans|loyalfans|houseofgord|clips4sale)/i.test(host)
      || /\/(model|performer|pornstar|profile|person)\b/i.test(url);
    subjectEvidence = identityHost || includesAll(title, subjToks) ? 'strong' : 'weak';
  } else if (subjToks.length && includesAny(blob, subjToks)) {
    subjectEvidence = 'weak';
  }

  let topicEvidence = 'none';
  if (topicToks.length) {
    const hit = topicToks.filter(t => t.length > 2 && norm(blob).includes(t));
    if (hit.length) {
      // Query-echo titles and search pages are not topic evidence.
      if ((echo || searchPage) && hit.length <= tokens(topic).length) topicEvidence = 'none';
      else topicEvidence = (hit.length >= 2 || includesAny(title + ' ' + snip, topicToks.filter(t => t.length > 4))) ? 'strong' : 'weak';
    }
  }

  let intersection = 'none';
  if (subjectEvidence !== 'none' && topicEvidence !== 'none') {
    // Strong intersection requires BOTH independently — a profile page that
    // merely contains the query string in the title is not enough.
    if (echo || searchPage) intersection = 'none';
    else if (subjectEvidence === 'strong' && topicEvidence === 'strong') intersection = 'strong';
    else intersection = 'weak';
  }

  let role = 'DISCOVERY_LEAD';
  if (echo || searchPage) role = echo ? 'QUERY_ECHO' : 'DISCOVERY_PAGE';
  else if (intersection === 'strong') role = 'INTERSECTION';
  else if (intersection === 'weak') role = 'WEAK_INTERSECTION';
  else if (subjectEvidence !== 'none' && topicEvidence === 'none') role = 'SUBJECT_EVIDENCE';
  else if (topicEvidence !== 'none' && subjectEvidence === 'none') role = 'TOPIC_EVIDENCE';
  else if (subjectEvidence !== 'none') role = 'SUBJECT_EVIDENCE';

  const reasons = [];
  if (subjectEvidence !== 'none') reasons.push('subject:' + subjectEvidence);
  if (topicEvidence !== 'none') reasons.push('topic:' + topicEvidence);
  if (intersection !== 'none') reasons.push('intersection:' + intersection);
  if (echo) reasons.push('query-echo');
  if (isRedditSearchPage(url, title)) reasons.push('reddit-search-page');
  reasons.push('role:' + role);

  return {
    subjectEvidence,
    topicEvidence,
    intersection,
    echo,
    reasons,
    role,
    isEvidence: role === 'INTERSECTION' || role === 'WEAK_INTERSECTION' || role === 'SUBJECT_EVIDENCE' || role === 'TOPIC_EVIDENCE',
    isDiscoveryLead: role === 'DISCOVERY_LEAD' || role === 'DISCOVERY_PAGE',
  };
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

export const OWNERSHIP_CLASSES = [
  'CONFIRMED CREATOR-OWNED',
  'LIKELY CREATOR-OWNED',
  'DIRECTORY CLAIM',
  'FAN/REPOSTER',
  'MIRROR',
  'UNVERIFIED',
  'UNKNOWN',
];

function ownershipFromKind(kind) {
  if (kind === 'official account' || kind === 'creator-owned account') {
    return kind === 'official account' ? 'CONFIRMED CREATOR-OWNED' : 'LIKELY CREATOR-OWNED';
  }
  if (kind === 'directory listing') return 'DIRECTORY CLAIM';
  if (kind === 'fan/reposter') return 'FAN/REPOSTER';
  if (kind === 'mirror') return 'MIRROR';
  if (kind === 'unverified') return 'UNVERIFIED';
  return 'UNKNOWN';
}

export function classifyAccountOwnership(item, subject, opts = {}) {
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
  const identityGrade = !!(opts.identityGrade || opts.userConfirmed || (opts.identityFeedback && (opts.identityFeedback.confirmed || []).length));
  const pack = (kind, confidence) => ({
    kind,
    ownershipClass: ownershipFromKind(kind),
    platform: platform ? platform.label : (isDir ? host : (isMirror ? host : (platform ? platform.label : 'UNKNOWN'))),
    confidence,
    handle: handle || 'UNKNOWN',
    identityGrade: !!identityGrade,
  });

  if (isMirror) return pack('mirror', 'low');
  // A directory mention is never proof of ownership — even if it names OnlyFans.
  if (isDir) return pack('directory listing', 'low');
  if (platform && /\b(fan[ -]?page|fan account|leaked?|leaks|repost(?:er|s|ed)?|unofficial|not official)\b/i.test(title + ' ' + snip)) {
    return pack('fan/reposter', 'medium');
  }
  // Explicit identity confirmation on a real platform URL is CONFIRMED.
  // Handle tokens do not have to contain the legal last name (@servedrea).
  if (platform && identityGrade && (handle || includesAll(blob, subj))) {
    return pack('official account', 'high');
  }
  if (platform && (nameInHandle || verifiedish) && includesAll(blob, subj)) {
    // Title-only "official" is LIKELY, never silently CONFIRMED.
    return pack('creator-owned account', 'low');
  }
  if (platform && handle && includesAll(blob, subj)) {
    return pack('creator-owned account', 'low');
  }
  if (platform) return { ...pack('unknown', 'low'), kind: 'unknown', ownershipClass: 'UNVERIFIED' };

  return pack('unknown', 'low');
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
    return sc === 'DATABASE' || sc === 'PRIMARY' || sc === 'PUBLIC_PROFILE' || sc === 'ENCYCLOPEDIA' || (r.evidence && r.evidence.subjectEvidence === 'strong') || r.subjectEvidence === 'strong';
  });
  const clusters = clusterByIdentity(onName.length ? onName : usable);
  const confirmed = (opts.identityFeedback && opts.identityFeedback.confirmed) || (classification && classification.identityFeedback && classification.identityFeedback.confirmed) || [];
  if (confirmed.length) {
    return { ambiguous: false, reason: 'user confirmed identity', candidates: clusters.slice(0, 6), userConfirmed: true };
  }
  const roleful = clusters.filter(c => c.role && c.role !== 'unspecified');
  if (strongId.length >= 1 && roleful.length <= 1) {
    return { ambiguous: false, reason: 'strong corroborating identity evidence', candidates: clusters.slice(0, 3) };
  }
  if (roleful.length >= 2) {
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

const IDENTITY_ROLE_FAMILIES = [
  ['realtor', 'real estate', 'realty', 'broker'],
  ['politician', 'senator', 'congress', 'governor', 'mayor'],
  ['athlete', 'footballer', 'olympian', 'nba', 'nfl', 'soccer'],
  ['scientist', 'professor', 'researcher', 'physicist', 'chemist'],
  ['doctor', 'physician', 'surgeon', 'nurse'],
  ['lawyer', 'attorney', 'esquire'],
  ['journalist', 'reporter', 'newscaster'],
  ['chef', 'restaurateur'],
  ['pastor', 'minister', 'priest', 'rabbi'],
  ['engineer'],
  ['ceo', 'founder', 'entrepreneur'],
  ['author', 'novelist', 'writer'],
  ['actress', 'actor', 'performer', 'model', 'pornstar', 'director', 'producer', 'singer', 'musician'],
];

function identityRoleFamily(row) {
  const blob = ' ' + norm((row && (row.title || '')) + ' ' + ((row && row.snippet) || '') + ' ' + pathOf((row && row.url) || '')) + ' ';
  for (const family of IDENTITY_ROLE_FAMILIES) {
    if (family.some(w => blob.includes(' ' + norm(w) + ' '))) return family[0];
  }
  return '';
}

function emptyIdentityCluster(r, role, idx) {
  const host = (r.domain || hostOf(r.url)).replace(/^www\./, '');
  return {
    candidateId: 'cand_' + (idx + 1) + '_' + (host || 'unknown').replace(/[^a-z0-9]+/g, '').slice(0, 18),
    name: r.title || host,
    role: role || 'unspecified',
    host,
    label: r.title || host,
    sample: r,
    urls: [],
    evidence: [],
    images: [],
    sourceDomains: [],
    distinguishingSignals: role && role !== 'unspecified' ? [role] : [],
    confidence: r.confidence || (r.evidence && r.evidence.subjectEvidence === 'strong' ? 'medium' : 'low'),
    relationships: [],
    sourceClass: r.sourceClass || '',
  };
}

function addToIdentityCluster(c, r) {
  const host = (r.domain || hostOf(r.url)).replace(/^www\./, '');
  c.urls.push(r.url);
  c.evidence.push({ url: r.url, title: r.title, sourceClass: r.sourceClass || '', subjectEvidence: (r.evidence && r.evidence.subjectEvidence) || r.subjectEvidence || 'UNKNOWN' });
  if (r.image) c.images.push(r.image);
  if (Array.isArray(r.images)) c.images.push(...r.images.slice(0, 3));
  if (host && !c.sourceDomains.includes(host)) c.sourceDomains.push(host);
  const sig = [r.sourceClass, r.resultKind, identityRoleFamily(r)].filter(Boolean);
  for (const s of sig) if (s && !c.distinguishingSignals.includes(s)) c.distinguishingSignals.push(s);
  c.images = [...new Set(c.images.filter(Boolean))].slice(0, 6);
  c.distinguishingSignals = c.distinguishingSignals.slice(0, 6);
  c.evidence = c.evidence.slice(0, 8);
}

function clusterByIdentity(rows) {
  const clusters = [];
  for (const r of rows || []) {
    const role = identityRoleFamily(r) || 'unspecified';
    let c = clusters.find(x => x.role === role);
    if (!c && role === 'unspecified' && clusters.length === 1) c = clusters[0];
    if (!c) {
      c = emptyIdentityCluster(r, role, clusters.length);
      clusters.push(c);
    }
    addToIdentityCluster(c, r);
  }
  const roleful = clusters.filter(c => c.role && c.role !== 'unspecified');
  const unspecified = clusters.filter(c => c.role === 'unspecified');
  if (roleful.length === 1 && unspecified.length) {
    for (const u of unspecified) {
      for (const rowUrl of u.urls) {
        const row = u.evidence.find(e => e.url === rowUrl) || u.sample;
        addToIdentityCluster(roleful[0], { ...u.sample, ...row, url: rowUrl, domain: u.host });
      }
      for (const d of u.sourceDomains) if (!roleful[0].sourceDomains.includes(d)) roleful[0].sourceDomains.push(d);
    }
    return roleful;
  }
  if (roleful.length === 0 && clusters.length > 1) {
    const merged = clusters[0];
    for (const extra of clusters.slice(1)) {
      for (const url of extra.urls) addToIdentityCluster(merged, { ...extra.sample, url, domain: extra.host, title: extra.name });
      for (const d of extra.sourceDomains) if (!merged.sourceDomains.includes(d)) merged.sourceDomains.push(d);
    }
    merged.role = 'unspecified';
    return [merged];
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
  const media = inferMediaHint(seed);
  const sourceClass = (seed && (seed.sourceClass || seed.plannerSourceClass || seed.kind)) || '';
  const out = [];
  const add = (q, why) => { if (q && q.trim()) out.push({ q: q.trim(), why, lane: 'more-like-this', kind: media === 'image' ? 'image' : 'web' }); };
  add(subject + (topic ? ' ' + topic : '') + (media ? ' ' + media : '') + ' (gallery OR interview OR production)', 'same subject + topic + media type');
  if (sourceClass) add(subject + (topic ? ' ' + topic : '') + ' ' + String(sourceClass).replace(/[-_]/g, ' '), 'same source class');
  if (domain) add(subject + ' site:' + domain.replace(/^www\./, ''), 'same source/host characteristics — host is not assumed creator');
  if (topic) {
    const fam = topicTerms(topic).filter(t => t.length > 3).slice(0, 3);
    if (fam.length) add(subject + ' (' + fam.join(' OR ') + ')', 'semantic topic family, not title-token stuffing');
  }
  const confirmed = (intent.identityFeedback && intent.identityFeedback.confirmed) || [];
  if (confirmed.length) add(quote(confirmed[0]) + (topic ? ' ' + topic : '') + (media ? ' ' + media : ''), 'confirmed-identity visual/source follow-up');
  return out;
}

function inferMediaHint(seed) {
  if (!seed) return '';
  if (seed.mediaKind === 'video' || seed.kind === 'video' || /\.(mp4|webm)$/i.test(seed.url || '')) return '(video OR clip OR scene)';
  if (seed.mediaKind === 'image' || seed.image || seed.kind === 'image' || /\.(jpg|jpeg|png|webp)$/i.test(seed.url || '')) return '(photoset OR gallery OR stills)';
  const blob = String((seed.title || '') + ' ' + (seed.snippet || '')).toLowerCase();
  if (/\b(video|clip|scene|watch)\b/.test(blob)) return '(video OR clip)';
  if (/\b(photo|gallery|photoset|image)\b/.test(blob)) return '(gallery OR photoset)';
  if (/\b(interview|podcast|article)\b/.test(blob)) return '(interview OR feature)';
  return '';
}

export function findSimilarQueries(intent, seed) {
  const subject = quote(intent.subject) || intent.subject;
  const topic = intent.topic || '';
  const domain = (seed && (seed.domain || hostOf(seed.url || seed.pageUrl || ''))) || '';
  const out = [];
  const add = (q, why) => { if (q && q.trim()) out.push({ q: q.trim(), why, lane: 'find-similar', kind: 'image' }); };
  add(subject + (topic ? ' ' + topic : '') + ' (photoset OR gallery OR stills OR "looks like")', 'visual similarity around confirmed subject + topic');
  if (domain) add(subject + ' site:' + domain.replace(/^www\./, ''), 'same visual source class');
  return out;
}

export function searchThisVisualQueries(intent, seed) {
  const subject = quote(intent.subject) || intent.subject;
  const topic = intent.topic || '';
  const domain = (seed && (seed.domain || hostOf(seed.url || seed.pageUrl || ''))) || '';
  const page = (seed && (seed.pageUrl || seed.url)) || '';
  const out = [];
  const add = (q, why) => { if (q && q.trim()) out.push({ q: q.trim(), why, lane: 'search-this-visual', kind: 'web' }); };
  if (domain) add(subject + ' site:' + domain.replace(/^www\./, ''), 'host of the selected visual');
  add(subject + (topic ? ' ' + topic : '') + ' (source OR credits OR "photo page")', 'find the source page of this visual');
  if (page) add(page, 'retrieve the visual source page itself');
  return out;
}

export function moreFromThisSourceQueries(intent, seed) {
  const subject = quote(intent.subject) || intent.subject;
  const domain = (seed && (seed.domain || hostOf(seed.url || seed.pageUrl || ''))) || '';
  const out = [];
  const add = (q, why) => { if (q && q.trim()) out.push({ q: q.trim(), why, lane: 'more-from-this-source', kind: 'web' }); };
  if (domain) add(subject + ' site:' + domain.replace(/^www\./, ''), 'more from this host — host is not the creator unless proven');
  return out;
}

export function moreFromThisPersonQueries(intent) {
  const subject = quote(intent.subject) || intent.subject;
  const out = [];
  const add = (q, why) => { if (q && q.trim()) out.push({ q: q.trim(), why, lane: 'more-from-this-person', kind: 'web' }); };
  add(subject + ' (profile OR credits OR gallery OR interview OR filmography)', 'more from this person');
  return out;
}

export function moreOnThisTopicQueries(intent) {
  const subject = quote(intent.subject) || intent.subject;
  const topic = intent.topic || '';
  const out = [];
  const add = (q, why) => { if (q && q.trim()) out.push({ q: q.trim(), why, lane: 'more-on-this-topic', kind: 'web' }); };
  if (topic) add(subject + ' ' + topic + ' (article OR feature OR production OR glossary)', 'more on this topic with the current subject');
  else add(subject + ' (topic OR subject OR coverage)', 'topic expansion without a named topic');
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

// ---------------------------------------------------------------------------
// Identity feedback actually changes subsequent retrieval
// ---------------------------------------------------------------------------
export function mergeIdentityFeedback(prior, patch) {
  const a = prior || {};
  const b = patch || {};
  const uniq = (arr) => [...new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean))];
  return {
    confirmed: uniq([].concat(a.confirmed || [], b.confirmed || [])).slice(-8),
    rejectedPeople: uniq([].concat(a.rejectedPeople || [], b.rejectedPeople || [])).slice(-16),
    rejectedImages: uniq([].concat(a.rejectedImages || [], b.rejectedImages || [])).slice(-24),
    rejectedHosts: uniq([].concat(a.rejectedHosts || [], b.rejectedHosts || [])).slice(-16),
    rejectedUrls: uniq([].concat(a.rejectedUrls || [], b.rejectedUrls || [])).slice(-24),
  };
}

export function applyIdentityFeedback(results, feedback, classification) {
  const fb = feedback || {};
  const confirmed = (fb.confirmed || []).map(norm).filter(Boolean);
  const rejectedPeople = (fb.rejectedPeople || []).map(norm).filter(Boolean);
  const rejectedHosts = new Set((fb.rejectedHosts || []).map(h => String(h).replace(/^www\./, '').toLowerCase()).filter(Boolean));
  const rejectedUrls = new Set((fb.rejectedUrls || []).concat(fb.rejectedImages || []).map(u => canonicalizeUrl(u)).filter(Boolean));
  const subject = String((classification && classification.subject) || '').trim();
  const out = [];
  for (const r of results || []) {
    const row = { ...r };
    const host = String(row.domain || hostOf(row.url) || '').replace(/^www\./, '').toLowerCase();
    const key = canonicalizeUrl(row.url || row.image || '');
    const blob = norm((row.title || '') + ' ' + (row.snippet || '') + ' ' + (row.url || ''));
    let weight = 0;
    let note = '';
    if (key && rejectedUrls.has(key)) {
      row.suppressed = true;
      row.rejectionReason = 'negatively confirmed visual/url';
      continue;
    }
    if (host && rejectedHosts.has(host)) {
      row.suppressed = true;
      row.rejectionReason = 'rejected identity/host';
      continue;
    }
    if (rejectedPeople.some(p => p && (blob.includes(p) || norm(row.title || '').includes(p)))) {
      weight -= 40;
      note = 'negatively weighted — rejected identity';
      row.suppressed = weight <= -40;
      row.rejectionReason = note;
      if (row.suppressed) continue;
    }
    if (confirmed.length) {
      const hit = confirmed.some(c => c && (blob.includes(c) || (subject && c === norm(subject) && includesAll(blob, tokens(subject)))));
      if (hit) {
        weight += 22;
        note = 'strengthened by positive identity confirmation';
      } else if (subject && !includesAll(blob, tokens(subject).filter(t => t.length > 2))) {
        weight -= 10;
        note = note || 'does not match confirmed identity';
      }
    }
    row.score = (Number(row.score) || 0) + weight;
    if (note) row.feedbackNote = note;
    row.identityFeedbackApplied = !!(confirmed.length || rejectedPeople.length || rejectedHosts.size);
    out.push(row);
  }
  return out;
}

export function knownSiteAccessStatus(retrieveLike) {
  const r = retrieveLike || {};
  const blocked = r.accessState === 'BLOCKED' || r.accessState === 'UNAVAILABLE' || r.status === 403 || r.status === 'RETRIEVAL_FAILED' || r.inaccessible || /timeout|blocked|403/i.test(String(r.error || r.failureReason || ''));
  const retrieved = r.ok === true || r.status === 'RETRIEVED' || r.accessState === 'DIRECTLY_RETRIEVED';
  if (retrieved) return { code: 'KNOWN_DOMAIN_RETRIEVED', label: 'KNOWN DOMAIN / SOURCE EVIDENCE AVAILABLE' };
  if (blocked) return { code: 'KNOWN_DOMAIN_BLOCKED', label: 'KNOWN DOMAIN / ACCESS BLOCKED / SOURCE EVIDENCE AVAILABLE' };
  return { code: 'KNOWN_DOMAIN_LEAD', label: 'KNOWN DOMAIN / SOURCE EVIDENCE AVAILABLE' };
}

export function classifyProviderFailure(entry) {
  if (!entry || typeof entry !== 'object') return { ok: false, failureReason: 'UNKNOWN' };
  if (entry.ok === true || (typeof entry.added === 'number' && entry.added > 0)) {
    return { ok: true, failureReason: null, latencyMs: entry.latencyMs || entry.ms || null };
  }
  const err = String(entry.error || entry.failureReason || '');
  const status = Number(entry.status) || 0;
  let failureReason = 'UNKNOWN';
  if (/timeout|abort/i.test(err) || entry.timedOut) failureReason = 'timeout';
  else if (status === 403 || status === 429 || /block|captcha|forbidden/i.test(err) || entry.accessState === 'BLOCKED') failureReason = 'blocked';
  else if (status >= 500) failureReason = 'http_error';
  else if (status >= 400) failureReason = 'http_error';
  else if (entry.empty || (typeof entry.added === 'number' && entry.added === 0 && !entry.error)) failureReason = 'empty';
  else if (err) failureReason = /timeout/i.test(err) ? 'timeout' : 'http_error';
  return { ok: false, failureReason, latencyMs: entry.latencyMs || entry.ms || null, status: status || entry.status || null };
}

export function evidenceBuckets(results) {
  const subject = [];
  const topic = [];
  const intersection = [];
  const leads = [];
  for (const r of results || []) {
    const ev = r.evidence || {};
    const role = ev.role || r.role || '';
    if (role === 'INTERSECTION' || ev.intersection === 'strong' || r.intersection) intersection.push(r);
    else if (role === 'SUBJECT_EVIDENCE' || (ev.subjectEvidence && ev.subjectEvidence !== 'none' && ev.topicEvidence === 'none')) subject.push(r);
    else if (role === 'TOPIC_EVIDENCE' || (ev.topicEvidence && ev.topicEvidence !== 'none' && ev.subjectEvidence === 'none')) topic.push(r);
    else if (role === 'WEAK_INTERSECTION') intersection.push(r);
    else leads.push(r);
  }
  const byScore = (a, b) => (Number(b.score) || 0) - (Number(a.score) || 0);
  return {
    subject: subject.sort(byScore),
    topic: topic.sort(byScore),
    intersection: intersection.sort(byScore),
    leads: leads.sort(byScore),
  };
}

export function serializeEvidenceItem(item, extras = {}) {
  const ev = (item && item.evidence) || {};
  const own = item && (item.accountOwnership || item.ownershipClass);
  return {
    investigationId: extras.investigationId || item.investigationId || null,
    subject: extras.subject || item.subject || '',
    subjectId: extras.subjectId || item.subjectId || extras.canonicalIdentity || null,
    topic: extras.topic || item.topic || '',
    intent: extras.intent || item.intent || '',
    sourceClass: item.sourceClass || item.plannerSourceClass || 'UNKNOWN',
    sourceUrl: item.url || '',
    canonicalUrl: item.canonicalUrl || canonicalizeUrl(item.url || ''),
    title: item.title || '',
    publisher: item.publisher || 'UNKNOWN',
    host: item.host || item.domain || hostOf(item.url || ''),
    creator: item.creator || 'UNKNOWN',
    originalSource: item.originalSource || 'UNKNOWN',
    reposter: item.reposter || 'UNKNOWN',
    mirror: item.mirror || 'UNKNOWN',
    imageUrl: item.image || (item.images && item.images[0]) || '',
    imageProvenance: item.image ? (item.host || hostOf(item.url || '')) : 'UNKNOWN',
    identityEvidence: ev.subjectEvidence || item.subjectEvidence || 'none',
    topicEvidence: ev.topicEvidence || item.topicEvidence || 'none',
    confidence: item.confidence || 'UNKNOWN',
    observationState: item.observationState || (item.provenance === 'RETRIEVED' ? 'OBSERVED' : (item.provenance === 'DISCOVERED' ? 'INFERRED' : 'UNKNOWN')),
    foundThrough: item.foundThrough || extras.foundThrough || item.discoveryLane || 'search',
    parent: item.parent || extras.parent || null,
    relatedTo: item.relatedTo || extras.relatedTo || null,
    retrievalRun: extras.retrievalRun || item.retrievalRun || null,
    timestamps: { observedAt: item.observedAt || null, retrievedAt: item.retrievedAt || null },
    deduplicationStatus: item.canonicalUrl && item.url && item.canonicalUrl !== item.url ? 'canonicalized' : 'unique',
    rejectionReason: item.rejectionReason || null,
    candidateIdentity: extras.candidateIdentity || item.candidateIdentity || null,
    provider: item.source || 'UNKNOWN',
    latency: extras.latency || null,
    failureReason: item.failureReason || null,
    isEvidenceItem: !!(ev.isEvidence || (ev.role && ev.role !== 'DISCOVERY_LEAD' && ev.role !== 'DISCOVERY_PAGE' && ev.role !== 'QUERY_ECHO')),
    isDiscoveryLead: !!(ev.isDiscoveryLead || ev.role === 'DISCOVERY_LEAD'),
    role: ev.role || item.role || 'DISCOVERY_LEAD',
    intersection: ev.intersection || item.intersectionEvidence || 'none',
    accountOwnership: typeof own === 'string' ? own : (own && own.kind) || 'UNKNOWN',
    ownershipClass: (item.ownershipClass) || (typeof own === 'object' && own && own.ownershipClass) || 'UNKNOWN',
    accessState: item.accessState || 'UNKNOWN',
    knownSiteStatus: item.knownSiteStatus || null,
    score: item.score,
    snippet: item.snippet || '',
    url: item.url || '',
  };
}

export function newInvestigationId() {
  return 'inv_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

export function createInvestigationState(opts = {}) {
  return {
    investigationId: opts.investigationId || newInvestigationId(),
    subject: opts.subject || '',
    topic: opts.topic || '',
    adultLens: opts.adultLens || opts.adult || 'off',
    entityType: opts.entityType || opts.type || '',
    candidates: [],
    visuals: [],
    rejected: { urls: [], hosts: [], images: [], people: [] },
    confirmed: [],
    trail: [{ kind: 'new', label: 'New investigation', at: new Date().toISOString() }],
    results: [],
    savedEvidence: [],
    parentInvestigationId: opts.parentInvestigationId || null,
    derivedFrom: opts.derivedFrom || null,
    foundThrough: opts.foundThrough || 'new',
    relatedTo: opts.relatedTo || null,
    retrievalRuns: 0,
    identityFeedback: { confirmed: [], rejectedPeople: [], rejectedImages: [], rejectedHosts: [], rejectedUrls: [] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function applyInvestigationAction(state, action, payload = {}) {
  const s = { ...(state || createInvestigationState()), identityFeedback: { ...((state && state.identityFeedback) || {}) } };
  s.updatedAt = new Date().toISOString();
  const act = String(action || '').toLowerCase();
  const pushTrail = (kind, label) => {
    s.trail = [...(s.trail || []), { kind, label, at: new Date().toISOString(), subject: s.subject, topic: s.topic }].slice(-32);
  };
  if (act === 'new' || act === 'reset' || act === 'new-investigation') {
    const keptSaved = s.savedEvidence || [];
    const next = createInvestigationState({ adultLens: s.adultLens });
    next.savedEvidence = keptSaved;
    next.trail = [{ kind: 'new', label: 'Hard live-state reset — saved collections kept', at: next.createdAt }];
    return next;
  }
  if (act === 'search' || act === 'identify' || act === 'topic-search' || act === 'intersection' || act === 'find-everything') {
    if (payload.subject) s.subject = payload.subject;
    if (payload.topic) s.topic = payload.topic;
    s.retrievalRuns = (s.retrievalRuns || 0) + 1;
    pushTrail(act, (payload.query || [s.subject, s.topic].filter(Boolean).join(' + ') || act));
  }
  if (act === 'confirm-identity' || act === 'confirm') {
    const name = payload.name || payload.subject || s.subject;
    s.confirmed = [...new Set([...(s.confirmed || []), name])].slice(-8);
    s.identityFeedback = mergeIdentityFeedback(s.identityFeedback, { confirmed: [name] });
    s.subject = name || s.subject;
    pushTrail('confirm-identity', 'That’s the one · ' + name);
  }
  if (act === 'reject-identity' || act === 'reject-person') {
    const name = payload.name || payload.title || payload.url || '';
    s.rejected = s.rejected || { urls: [], hosts: [], images: [], people: [] };
    if (name) s.rejected.people = [...new Set([...(s.rejected.people || []), name])].slice(-16);
    if (payload.host) s.rejected.hosts = [...new Set([...(s.rejected.hosts || []), payload.host])].slice(-16);
    if (payload.url) s.rejected.urls = [...new Set([...(s.rejected.urls || []), payload.url])].slice(-24);
    s.identityFeedback = mergeIdentityFeedback(s.identityFeedback, {
      rejectedPeople: name ? [name] : [],
      rejectedHosts: payload.host ? [payload.host] : [],
      rejectedUrls: payload.url ? [payload.url] : [],
    });
    pushTrail('reject-identity', 'Not this person · ' + name);
  }
  if (act === 'reject-image') {
    const url = payload.imageUrl || payload.url || '';
    s.rejected = s.rejected || { urls: [], hosts: [], images: [], people: [] };
    if (url) s.rejected.images = [...new Set([...(s.rejected.images || []), url])].slice(-24);
    s.identityFeedback = mergeIdentityFeedback(s.identityFeedback, { rejectedImages: url ? [url] : [] });
    pushTrail('reject-image', 'Not this image');
  }
  if (act === 'branch') {
    const child = createInvestigationState({
      subject: payload.subject || s.subject,
      topic: payload.topic || s.topic,
      adultLens: s.adultLens,
      parentInvestigationId: s.investigationId,
      derivedFrom: s.investigationId,
      foundThrough: payload.foundThrough || 'branch',
      relatedTo: s.investigationId,
    });
    child.identityFeedback = { ...s.identityFeedback };
    child.confirmed = [...(s.confirmed || [])];
    child.trail = [...(s.trail || []), { kind: 'branch', label: 'Branched from ' + s.investigationId, at: child.createdAt }];
    return child;
  }
  if (act === 'save' && payload.item) {
    s.savedEvidence = [...(s.savedEvidence || []), { ...payload.item, savedAt: new Date().toISOString(), foundThrough: payload.foundThrough || s.foundThrough || 'save' }].slice(-80);
    pushTrail('save', 'Saved evidence');
  }
  return s;
}

export const API_ACTION_CATALOG = [
  { action: 'health', method: 'GET', path: '/api/v1/health', description: 'Version, features, provider status. Never returns secrets.' },
  { action: 'new-investigation', method: 'POST', path: '/api/v1/investigations', description: 'Hard live-state reset. Saved collections stay.' },
  { action: 'search', method: 'POST', path: '/api/v1/investigations/:id/search', description: 'Same /search pipeline as the iPhone UI.' },
  { action: 'identify', method: 'POST', path: '/api/v1/investigations/:id/identify', description: 'Subject identification search.' },
  { action: 'topic-search', method: 'POST', path: '/api/v1/investigations/:id/topic', description: 'Topic search keeping the current subject.' },
  { action: 'intersection', method: 'POST', path: '/api/v1/investigations/:id/intersection', description: 'Subject × topic intersection retrieval.' },
  { action: 'find-everything', method: 'POST', path: '/api/v1/investigations/:id/find-everything', description: 'Topic-map retrieval grouped by source class.' },
  { action: 'premium-accounts', method: 'POST', path: '/api/v1/investigations/:id/premium-accounts', description: 'Premium/creator account discovery with ownership classes.' },
  { action: 'find-more', method: 'POST', path: '/api/v1/investigations/:id/find-more', description: 'Expand within the current investigation.' },
  { action: 'more-like-this', method: 'POST', path: '/api/v1/investigations/:id/more-like-this', description: 'Semantic similarity — not title-token stuffing.' },
  { action: 'find-different', method: 'POST', path: '/api/v1/investigations/:id/find-different', description: 'Alternative sources, excluding seen hosts.' },
  { action: 'find-similar', method: 'POST', path: '/api/v1/investigations/:id/find-similar', description: 'Visual/source-class similarity.' },
  { action: 'search-this-visual', method: 'POST', path: '/api/v1/investigations/:id/search-this-visual', description: 'Search the source of a selected visual.' },
  { action: 'more-from-this-source', method: 'POST', path: '/api/v1/investigations/:id/more-from-this-source', description: 'More from this host (host ≠ creator).' },
  { action: 'more-from-this-person', method: 'POST', path: '/api/v1/investigations/:id/more-from-this-person', description: 'More from the confirmed person.' },
  { action: 'more-on-this-topic', method: 'POST', path: '/api/v1/investigations/:id/more-on-this-topic', description: 'More on the current topic.' },
  { action: 'confirm-identity', method: 'POST', path: '/api/v1/investigations/:id/confirm-identity', description: 'That’s the one — persistent retrieval state.' },
  { action: 'reject-identity', method: 'POST', path: '/api/v1/investigations/:id/reject-identity', description: 'Not this person — negative weight on later retrieval.' },
  { action: 'reject-image', method: 'POST', path: '/api/v1/investigations/:id/reject-image', description: 'Not this image — suppress the visual.' },
  { action: 'retrieve', method: 'POST', path: '/api/v1/investigations/:id/retrieve', description: 'Same /retrieve pipeline.' },
  { action: 'source', method: 'POST', path: '/api/v1/investigations/:id/source', description: 'Provenance for a URL.' },
  { action: 'analyze', method: 'POST', path: '/api/v1/investigations/:id/analyze', description: 'Analyze webpage/reddit/image/video evidence objects.' },
  { action: 'learn', method: 'POST', path: '/api/v1/investigations/:id/learn', description: 'Teach Me grounded in retrieved evidence.' },
  { action: 'trail', method: 'GET', path: '/api/v1/investigations/:id/trail', description: 'How I Got Here.' },
  { action: 'evidence', method: 'GET', path: '/api/v1/investigations/:id/evidence', description: 'Saved evidence for this investigation.' },
  { action: 'branch', method: 'POST', path: '/api/v1/investigations/:id/branch', description: 'Branch the investigation; parent stays.' },
  { action: 'images', method: 'GET', path: '/api/v1/investigations/:id/images', description: 'Visual corpus with provenance.' },
  { action: 'videos', method: 'GET', path: '/api/v1/investigations/:id/videos', description: 'Video metadata; frames remain UNKNOWN.' },
];

export const DETERMINISTIC_FIXTURES = {
  'provider-blocked': {
    items: [],
    diagnostics: {
      DuckDuckGo: { error: 'timeout', status: 0, ok: false, timedOut: true, failureReason: 'timeout', latencyMs: 8000 },
      Bing: { error: 'blocked', status: 403, ok: false, accessState: 'BLOCKED', failureReason: 'blocked', latencyMs: 220 },
    },
  },
  'site-blocked': {
    items: [
      { title: 'House of Gord', url: 'https://www.houseofgord.com/', snippet: 'Resolved known site. Retrieval blocked.', accessState: 'BLOCKED', source: 'Known site', knownSiteStatus: 'KNOWN DOMAIN / ACCESS BLOCKED / SOURCE EVIDENCE AVAILABLE', isDiscoveryLead: true, role: 'DISCOVERY_LEAD' },
    ],
    diagnostics: {
      KnownSite: { domain: 'houseofgord.com', status: 403, ok: false, inaccessible: true, accessState: 'BLOCKED', note: 'Known site could not be fully retrieved. It remains a lead — not treated as nonexistent.' },
      DuckDuckGo: { error: 'timeout', ok: false, timedOut: true, failureReason: 'timeout' },
    },
  },
  'drea-intersection': {
    items: [
      { title: 'Drea Morgan - IAFD', url: 'https://www.iafd.com/person.rme/perfid=dreamorgan', snippet: 'Performer bio and filmography.', source: 'IAFD' },
      { title: 'Drea Morgan metal bondage photoset at House of Gord', url: 'https://www.houseofgord.com/dreamorgan-cinch', snippet: 'Drea Morgan in a metal bondage feature with cinch straps.', source: 'DuckDuckGo' },
      { title: 'Drea Morgan bondage', url: 'https://example.com/search?q=drea+morgan+bondage', snippet: 'Search results for Drea Morgan bondage', source: 'Bing' },
      { title: 'Reddit public search', url: 'https://www.reddit.com/search/?q=drea', snippet: 'search', source: 'DuckDuckGo' },
      { title: 'Bondage (BDSM)', url: 'https://en.wikipedia.org/wiki/Bondage_BDSM', snippet: 'Bondage is a practice of consensual restraint.', source: 'Wikipedia' },
    ],
    diagnostics: { DuckDuckGo: { ok: true, added: 3 }, Bing: { ok: true, added: 2 } },
  },
  'premium-accounts': {
    items: [
      { title: 'Drea Morgan | LoyalFans', url: 'https://www.loyalfans.com/servedrea', snippet: 'LoyalFans creator page @servedrea', source: 'DuckDuckGo' },
      { title: "Drea Morgan's Paraphilias", url: 'https://www.clips4sale.com/studio/123/drea-morgans-paraphilias', snippet: 'Historical clip store studio page', source: 'Bing' },
      { title: 'Drea Morgan links — OnlyFans listed', url: 'https://www.indexxx.com/m/drea-morgan', snippet: 'Directory lists an OnlyFans claim', source: 'DuckDuckGo' },
    ],
    diagnostics: { DuckDuckGo: { ok: true, added: 2 }, Bing: { ok: true, added: 1 } },
  },
  'ashley-anderson': {
    items: [
      { title: 'Ashley Anderson actress', url: 'https://en.wikipedia.org/wiki/Ashley_Anderson', snippet: 'American actress biography', source: 'Wikipedia' },
      { title: 'Ashley Anderson realtor', url: 'https://example-realtor.com/ashley-anderson', snippet: 'Real estate agent profile', source: 'Bing' },
    ],
    diagnostics: { DuckDuckGo: { ok: true, added: 2 } },
  },
};

export function fixtureItems(name) {
  const f = DETERMINISTIC_FIXTURES[name];
  return f ? { items: f.items.slice(), diagnostics: { ...f.diagnostics } } : null;
}

export function distinctFindMoreIntents() {
  return ['find-more', 'more-like-this', 'find-different', 'find-similar', 'search-this-visual', 'more-from-this-source', 'more-from-this-person', 'more-on-this-topic'];
}

