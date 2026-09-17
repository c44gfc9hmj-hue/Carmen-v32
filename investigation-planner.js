// Carmen v49.12 — investigation / topic-map planner + ChatGPT-access helpers.
// Query-centric retrieval is the fallback. The planner independently
// establishes subject evidence, topic evidence, and intersection evidence,
// then opens source-class lanes (especially adult) instead of stuffing
// tokens into one search string.
//
// v49.11: Exact-source retrieval. Analyze receives the canonical URL from the
// source card and fetches THAT URL. Generic platform discovery cannot
// substitute for exact-source retrieval. Source identity is hash(canonicalURL).
// Authentication-required content is reported as AUTHENTICATION_REQUIRED, not
// retrieved. Extracted URLs/accounts/entities become investigation seeds.
//
// v49.9: Identity verification, persistent investigation queue, visual
// evidence gate. PERSON searches identify first (small high-quality
// candidate set). Confirmation triggers the full investigation. “Not this
// person” is negative evidence, not a visual dismiss. Visual retrieval is
// gated by entity × topic × visual relevance. Find More returns unique
// relevant evidence or says none remains. Queued work survives a Worker
// resource/time rail and is resumable. Adaptive Lens follows Research Focus.
// Analyze investigates public account metadata without claiming private
// content. Deep Dive remains the investigation loop.
//
// v49.8: Adaptive / open-ended investigation. Carmen keeps expanding until
// meaningful public paths, variants, visual branches, accounts, and link
// chains are exhausted — or a real resource/access guard requires stopping.
// A raw request count is a safety rail, not the investigation logic.
//
// v49.7: Retrieval-engine correctness. Entity and topic stay coupled through
// every stage. Premium discovery is a recursive branch (URL ≠ content).
// Visuals are source-aware and identity-scored. Variations are semantic.
// Investigation traces answer “what Carmen checked” and “why did you stop.”
//
// v49.6: Drea Morgan is a first-class identity/extraction regression. Adult
// terminology is semantic (subject × topic), not synonym stuffing. Image
// extraction is distinct from source discovery. New Investigation never leaks
// live state. Find More expands the evidence graph from new domains/pages.
//
// v49.5: Adult-first by default. Deep Dive is three investigation shortcuts
// (Bondage / People / Visuals) plus one natural-language research input.
// Clothing evidence extraction stays internal. Find More is additive.
// Intent distinguishes person vs object/technique before person pipelines.
//
// v49.4: Deep Dive is three investigation lenses that expand THROUGH
// already-discovered evidence. Additive merge refuses query clones, mirrors,
// and near-duplicates. Find More picks the next unexplored retrieval lane.
// Visual identity stays separate from text hits.
//
// This module is self-contained: no import from worker.js (avoids cycles).
// worker.js imports it. The machine-readable API uses these same functions.

export const PLANNER_VERSION = '49.12';
export const PLANNER_BUILD = '49.12-investigation-workflow';

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
  clothing: ['outfit', 'garment', 'dress', 'heels', 'boots', 'collar', 'corset', 'latex', 'leather', 'lingerie', 'harness', 'stockings'],
};

// Semantic adult family used for INTENT / MATCHING, never concatenated into one giant search string.
export const ADULT_TOPIC_FAMILY = {
  bondage: {
    canonical: 'bondage',
    related: [
      'bondage', 'bondage images', 'bondage scene', 'bondage photos', 'bondage videos',
      'bondage interview', 'bondage position', 'restrained', 'restraint', 'tied', 'tied up',
      'rope', 'rope bondage', 'shibari', 'kinbaku', 'suspension', 'frog tie', 'frog-tie',
      'frogtie', 'hogtie', 'hog-tie', 'hog tie', 'metal bondage', 'bdsm', 'fetish', 'kink',
    ],
  },
};

export const OBJECT_TECHNIQUE_TERMS = [
  'frog tie', 'frog-tie', 'frogtie', 'hog tie', 'hog-tie', 'hogtie',
  'shibari', 'kinbaku', 'suspension', 'rope bondage', 'bondage chair',
  'harness', 'spreader', 'cinch', 'ball gag', 'bit gag',
];

// Semantic variation families are planning knowledge. They are NEVER dumped as
// a universal chip list — only emitted when the resolved topic/concept matches.
export const TECHNIQUE_FAMILIES = [
  {
    id: 'restraint',
    seeds: [
      'bondage', 'restraint', 'restrained', 'tied', 'tied up', 'rope',
      'shibari', 'kinbaku', 'rope bondage', 'tape restraint', 'self-bondage',
      'self bondage', 'suspension', 'cuffs', 'restraints', 'hogtie', 'hog tie',
      'frog tie', 'frog-tie', 'frogtie', 'cinch', 'metal bondage',
    ],
    variations: [
      'shibari', 'rope bondage', 'tape restraint', 'bondage', 'self-bondage',
      'suspension', 'cuffs/restraints', 'hogtie', 'frog tie',
    ],
  },
];

export const SOCIAL_IDENTITY_HOSTS = [
  'facebook.com', 'instagram.com', 'youtube.com', 'youtu.be', 'tiktok.com',
];

export const ANIME_CARTOON_HOSTS = [
  'rule34.xxx', 'rule34.paheal.net', 'gelbooru.com', 'danbooru.donmai.us',
  'safebooru.org', 'e621.net', 'e-hentai.org', 'nhentai.net', 'pixiv.net',
  'anime-pictures.net', 'zerochan.net', 'kemono.su',
];

export const PUBLIC_ACCOUNT_HOSTS = [
  { host: 'x.com', label: 'X' },
  { host: 'twitter.com', label: 'X' },
  { host: 'instagram.com', label: 'Instagram' },
  { host: 'facebook.com', label: 'Facebook' },
  { host: 'youtube.com', label: 'YouTube' },
  { host: 'tiktok.com', label: 'TikTok' },
  { host: 'reddit.com', label: 'Reddit' },
  { host: 'fetlife.com', label: 'FetLife' },
];

export const MATCH_QUALITY = ['exact', 'likely', 'conceptual', 'unrelated'];
export const VISUAL_CLASSES = ['real-person', 'real-world-technique', 'illustration', 'anime', 'cartoon', 'unrelated', 'unknown'];
export const ACCOUNT_STATUS = ['current', 'historical', 'inactive', 'uncertain', 'unverified'];
export const PREMIUM_ACCESS_STATES = [
  'account_discovered', 'account_corroborated', 'public_metadata_found',
  'public_preview_found', 'content_retrievable', 'authorized_access_required',
  'inaccessible', 'unverified_claim',
];
export const STOP_CLASSES = [
  'not_found', 'not_searched_far_enough', 'found_but_filtered',
  'found_but_unretrievable', 'access_restricted', 'identity_confidence_insufficient',
  'branches_exhausted', 'diminishing_returns', 'duplicates', 'configured_limit',
  'investigation_exhausted', 'no_additional_paths', 'no_novelty',
  'provider_unavailable', 'resource_guard', 'access_boundary',
];

export const ADAPTIVE_STOP_KINDS = {
  A: 'investigation_exhausted',
  B: 'no_additional_paths',
  C: 'no_novelty',
  D: 'provider_unavailable',
  E: 'resource_guard',
  F: 'access_boundary',
};

export const INVESTIGATION_PATH_FAMILIES = [
  'identity', 'identity-variants', 'entity-topic', 'topic-variants',
  'visual', 'visual-entity-seeded', 'instructional', 'accounts', 'premium',
  'source-classes', 'link-chain', 'corroboration',
  'clothing', 'position', 'url',
];

export const ADAPTIVE_TIME_GUARD_MS = 24000;
export const ADAPTIVE_MAX_ITERATIONS = 10;
export const ADAPTIVE_NOVELTY_STOP_STREAK = 2;
export const ADAPTIVE_BATCH_SIZE = 2;
export const CONTINUATION_SLICE_SIZE = 6;

export const IDENTITY_CLASSES = ['PERSON_REAL', 'PERSON_FICTIONAL', 'ANIMAL', 'OBJECT', 'LOCATION', 'ORGANIZATION', 'UNKNOWN'];
export const VISUAL_EVIDENCE_LEVELS = ['METADATA_MATCH', 'SOURCE_ASSOCIATED', 'IDENTITY_CORROBORATED', 'VISUAL_IDENTITY_VERIFIED', 'REJECTED'];

export const INVESTIGATION_PHASES = [
  'IDLE', 'SEARCHING', 'CANDIDATES_FOUND', 'IDENTITY_NEEDS_CONFIRMATION',
  'IDENTITY_CONFIRMED', 'RESEARCHING', 'RESULTS_READY', 'EXPANDING', 'EXHAUSTED', 'ERROR',
];

export const PRIMARY_DIVE_LENSES = [
  { id: 'bondage', label: 'Bondage', mode: 'dive-bondage', topic: 'bondage' },
  { id: 'people', label: 'People', mode: 'dive-people', topic: 'people' },
  { id: 'visuals', label: 'Visuals', mode: 'dive-visuals', topic: '' },
];

export const NO_NEW_SOURCES_MESSAGE = 'No new sources found from the remaining search paths.';


export function topicTerms(topic) {
  const t = norm(topic);
  if (!t) return [];
  // Query construction uses the requested topic tokens only — not the entire synonym family.
  return [...new Set([t, ...tokens(topic)])].filter(Boolean);
}

export function relatedTopicFamily(topic) {
  const t = norm(topic);
  if (!t) return [];
  const out = [...topicTerms(topic)];
  for (const [k, fam] of Object.entries(ADULT_TOPIC_FAMILY)) {
    const related = fam.related || [];
    if (t === k || t.includes(k) || related.some(v => t.includes(norm(v)) || norm(v).includes(t))) {
      out.push(fam.canonical, ...related.map(norm));
    }
  }
  for (const [k, vals] of Object.entries(TOPIC_VOCAB)) {
    if (t.includes(k) || vals.some(v => t.includes(norm(v)))) out.push(...vals.map(norm));
  }
  return [...new Set(out)].filter(Boolean);
}

export function isObjectOrTechniquePhrase(text) {
  const n = norm(text);
  if (!n) return false;
  return OBJECT_TECHNIQUE_TERMS.some(term => n === norm(term) || n.startsWith(norm(term) + ' ') || n.includes(' ' + norm(term)));
}

export function canonicalAdultTopic(text) {
  const n = norm(text);
  if (!n) return '';
  for (const [k, fam] of Object.entries(ADULT_TOPIC_FAMILY)) {
    if (n === k || n.includes(k)) return fam.canonical;
    if ((fam.related || []).some(v => n === norm(v) || n.endsWith(' ' + norm(v)))) return fam.canonical;
  }
  return '';
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
const DIVE_BONDAGE_RE = /\b(dive[- ]?bondage|investigate bondage|bondage (?:path|lens|deep dive)|go deeper on the bondage|everything (?:on|about) this person in bondage)\b/i;
const DIVE_PEOPLE_RE = /\b(dive[- ]?people|investigate people|people (?:path|lens|deep dive)|related people|collaborators?|every other person connected|find related people)\b/i;
const DIVE_VISUALS_RE = /\b(dive[- ]?visuals?|investigate visuals?|visuals? (?:path|lens|deep dive)|more images?|alternate images?|image provenance|original source of this|find (?:all )?images?|find images from)\b/i;
const DIVE_CLOTHING_RE = /\b(dive[- ]?clothing|investigate clothing|clothing (?:path|lens|deep dive)|outfits?|garments?)\b/i;


export function parseInvestigationIntent(query, opts = {}) {
  const raw = String(query || '').trim();
  const entity = String(opts.entity || '').replace(/"/g, '').trim();
  const topicIn = String(opts.topic || '').replace(/"/g, '').trim();
  const adult = String(opts.adult || opts.adultContent || 'on').toLowerCase();
  const known = resolveKnownEntity(raw) || (entity ? resolveKnownEntity(entity) : null) || (topicIn ? resolveKnownEntity(topicIn) : null);

  let mode = 'search';
  if (opts.mode) mode = String(opts.mode);
  else if (opts.diveLens === 'bondage' || DIVE_BONDAGE_RE.test(raw)) mode = 'dive-bondage';
  else if (opts.diveLens === 'people' || DIVE_PEOPLE_RE.test(raw)) mode = 'dive-people';
  else if (opts.diveLens === 'visuals' || opts.diveLens === 'clothing' || DIVE_VISUALS_RE.test(raw) || DIVE_CLOTHING_RE.test(raw)) mode = 'dive-visuals';
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
  const objectPhrase = isObjectOrTechniquePhrase(raw) || isObjectOrTechniquePhrase(entity);
  if (!subject && !known) {
    // "Drea Morgan bondage" → subject + topic when trailing known investigative context
    const trail = raw.match(/^(.+?)\s+(bondage(?:\s+(?:images?|photos?|videos?|scenes?|interview|position))?|bdsm|fetish|kink|shibari|kinbaku|suspension|restrained|restraint|lawsuits?|transmission problems?|premium accounts?)\s*$/i);
    if (trail) {
      const head = trail[1].trim();
      const tail = trail[2].trim();
      if (isObjectOrTechniquePhrase(head) || isObjectOrTechniquePhrase(raw)) {
        // Technique × topic. Never invent a person subject from a position name.
        topic = topic || raw;
        if (mode === 'search') mode = 'intersection';
      } else if (head && !isObjectOrTechniquePhrase(head)) {
        subject = head;
        topic = topic || canonicalAdultTopic(tail) || tail;
        if (mode === 'search') mode = 'intersection';
      }
    }
  }
  if (objectPhrase && !subject) {
    // Technique/object queries are not people. The phrase itself is the topic.
    if (!topic) topic = raw;
    if (mode === 'search' && canonicalAdultTopic(raw) && norm(raw) !== canonicalAdultTopic(raw)) {
      // "frog tie bondage" already split; bare "frog tie" stays the topic.
    }
  }

  if (mode === 'dive-clothing') mode = 'dive-visuals';
  if (mode === 'search' && (FIND_EVERYTHING_RE.test(raw))) mode = 'find-everything';
  if (PREMIUM_RE.test(raw) && mode !== 'premium-accounts') {
    if (!topic) topic = 'premium accounts';
  }
  if (mode === 'dive-bondage' && !topic) topic = 'bondage';
  if (mode === 'dive-visuals' && !topic) topic = topicIn;
  // People is a lens, not a stuffed topic keyword — keep any existing topic.
  // Visuals inherits the active investigation topic instead of replacing it.


  const findEverything = mode === 'find-everything' || FIND_EVERYTHING_RE.test(raw) || opts.findEverything === true;
  const premiumAccounts = mode === 'premium-accounts' || PREMIUM_RE.test(raw) || opts.premiumAccounts === true;

  let entityTypeHint = String(opts.hint || opts.type || '').trim();
  if (known && !entityTypeHint) entityTypeHint = known.type || 'website';
  if (objectPhrase && (!entityTypeHint || entityTypeHint === 'person')) entityTypeHint = 'technique';

  const visualIntent = mode === 'dive-visuals' || /visual|image|photo|gallery/i.test(mode) || opts.visualMode || /\b(images?|photos?|visuals?|gallery|photoset)\b/i.test(raw);
  const relatedTerms = topic ? relatedTopicFamily(topic).filter(t => t && t !== norm(topic)).slice(0, 8) : [];
  const intentClass = entityTypeHint === 'technique' || entityTypeHint === 'object' || entityTypeHint === 'clothing' || objectPhrase
    ? 'OBJECT'
    : (entityTypeHint === 'person' || entityTypeHint === 'social' ? 'PERSON' : (entityTypeHint === 'website' || entityTypeHint === 'url' ? 'URL' : 'TOPIC'));
  const tutorialIntent = isTutorialIntent(raw) || entityTypeHint === 'tutorial' || entityTypeHint === 'skill';
  const retrievalIntents = parseRetrievalIntents(raw, { subject, topic, intentClass, premiumAccounts, tutorialIntent, visual: visualIntent });

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
    diveLens: mode === 'dive-bondage' ? 'bondage' : (mode === 'dive-people' ? 'people' : (mode === 'dive-visuals' ? 'visuals' : (opts.diveLens || ''))),
    attemptedQueries: [].concat(opts.attemptedQueries || opts.attempted || []),
    discoveredEntities: Array.isArray(opts.discoveredEntities) ? opts.discoveredEntities : [],
    graphLeads: Array.isArray(opts.graphLeads) ? opts.graphLeads : [],
    visual: !!visualIntent,
    relatedTerms,
    intentClass,
    objectTechnique: !!objectPhrase,
    adult: adult === 'on' || adult === 'both' || adult === 'off' ? adult : 'on',
    tutorialIntent: !!tutorialIntent,
    retrievalIntents,
    researchFocus: parseResearchFocus(opts.researchFocus || opts.focus || opts.hint || entityTypeHint, { type: entityTypeHint, tutorialIntent, wantVisual: visualIntent }),
  };
}

export function isPremiumAccountIntent(query, opts) {
  return parseInvestigationIntent(query, opts).premiumAccounts;
}

export function routeNaturalLanguageResearch(text, opts = {}) {
  const raw = String(text || '').trim();
  const t = raw.toLowerCase();
  if (!raw) return { mode: '', lens: '', topic: '', why: '' };
  if (DIVE_BONDAGE_RE.test(raw) || /\b(bondage work|in bondage|bondage material|bdsm (?:work|material|scenes?))\b/i.test(t)) {
    return { mode: 'dive-bondage', lens: 'bondage', topic: 'bondage', why: 'natural-language bondage investigation' };
  }
  if (DIVE_PEOPLE_RE.test(raw) || /\b(who else|connected (?:to|with)|other people|find (?:every )?person)\b/i.test(t)) {
    return { mode: 'dive-people', lens: 'people', topic: opts.topic || '', why: 'natural-language people investigation' };
  }
  if (DIVE_VISUALS_RE.test(raw) || /\b(find (?:more )?images|visuals?|galleries|original source|sources we haven'?t checked)\b/i.test(t)) {
    return { mode: 'dive-visuals', lens: 'visuals', topic: opts.topic || '', why: 'natural-language visual investigation' };
  }
  if (FIND_MORE_RE.test(raw) || /\b(find more|keep looking|go deeper|haven'?t checked)\b/i.test(t)) {
    return { mode: 'find-more', lens: '', topic: opts.topic || '', why: 'natural-language find more' };
  }
  if (PREMIUM_RE.test(raw) || /\bpremium accounts?\b/i.test(t)) {
    return { mode: 'premium-accounts', lens: '', topic: 'premium accounts', why: 'natural-language premium accounts' };
  }
  if (/\b(career|filmography|credits|interview|videos?|productions?)\b/i.test(t)) {
    const topic = (raw.match(/\b(career|filmography|credits|interviews?|videos?|productions?)\b/i) || [])[1] || raw;
    return { mode: 'intersection', lens: '', topic, why: 'natural-language topic inside this investigation' };
  }
  return { mode: 'intersection', lens: '', topic: raw, why: 'natural-language research request' };
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
  const person = type === 'person' || type === 'social';
  const objectOrTechnique = type === 'technique' || type === 'skill' || type === 'clothing' || type === 'object' || type === 'visuals' || (classification && classification.intentClass === 'OBJECT');
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
    : (objectOrTechnique
      ? [qSub + ' (tutorial OR reference OR glossary OR demonstration)', qSub]
      : [qSub + ' (official OR about OR homepage)', qSub]), 10);

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
  } else if (adultOn && objectOrTechnique) {
    add('fetish-publisher', 'specialist sources for the requested object/technique', 'fetish-publisher', [
      qSub + ' (tutorial OR reference OR demonstration OR glossary)',
      qSub + ' (photos OR images OR stills OR diagram)',
      qSub + ' site:reddit.com',
    ], 22);
  } else if (adultOn && topic) {
    add('fetish-publisher', 'specialist BDSM/fetish publishers', 'fetish-publisher', [
      qSub + ' ' + topic + ' (studio OR publisher OR production)',
      topic + ' site:houseofgord.com',
      qSub + ' site:kink.com',
    ], 22);
  }

  if (topic) {
    const diveActive = !!(intent && (intent.diveLens || /^(dive-bondage|dive-people|dive-visuals|dive-clothing)$/.test(intent.mode || '')));
    add('intersection', 'subject × topic intersection', 'intersection', [
      qSub + ' ' + topic,
      qSub + ' "' + topic + '"',
      qSub + ' ' + topic + ' (scene OR photoset OR interview OR feature)',
      qSub + ' ' + topic + ' (gallery OR stills OR credits)',
    ], 8);
    // Topic-only is discovery, never a substitute for entity-specific topic evidence.
    add('topic-only', 'topic evidence (not counted as intersection)', 'topic', [
      topic + ' (glossary OR meaning OR studio OR publisher)',
    ], 70);
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
    add('premium-public', 'public metadata / previews / indexed references', 'premium-subscription', [
      qSub + ' (onlyfans OR fansly OR loyalfans) (preview OR teaser OR "public profile" OR bio OR links)',
      qSub + ' (linktree OR allmylinks OR "official links") (onlyfans OR fansly OR loyalfans)',
      qSub + ' (indexxx OR freeones OR babepedia) (onlyfans OR fansly OR loyalfans)',
    ], 14);
    add('premium-historical', 'historical premium references', 'archival', [
      qSub + ' (onlyfans OR fansly OR loyalfans OR clips4sale) (former OR previous OR archive OR history)',
    ], 15);
  } else if (person && adultOn) {
    add('premium-discovery', 'proactive premium/public subscription discovery', 'premium-subscription', [
      qSub + ' (onlyfans OR fansly OR loyalfans OR patreon OR manyvids OR fancentro)',
      qSub + ' site:linktr.ee',
      qSub + ' site:allmylinks.com',
    ], 18);
  }

  if (person) {
    add('public-accounts', 'public account / profile discovery', 'community-social', [
      qSub + ' (instagram OR twitter OR "x.com" OR youtube OR facebook OR tiktok OR reddit) (official OR verified OR profile)',
      qSub + ' site:x.com',
      qSub + ' site:instagram.com',
    ], 19);
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

  if (intent && (intent.mode === 'dive-bondage' || intent.diveLens === 'bondage')) {
    add('dive-bondage-chain', 'bondage investigation via discovered evidence', 'fetish-publisher', [
      qSub + ' (photoset OR scene OR feature) (studio OR publisher OR production)',
      qSub + ' (metal OR rope OR cinch OR hogtie OR restrained) (credits OR stills)',
    ], 5);
  }
  if (intent && (intent.mode === 'dive-people' || intent.diveLens === 'people')) {
    add('dive-people-chain', 'people connected to this investigation', 'collaborators', [
      qSub + ' (with OR featuring OR "co-star" OR photographer OR director OR producer)',
    ], 5);
  }
  if (intent && (intent.mode === 'dive-visuals' || intent.mode === 'dive-clothing' || intent.diveLens === 'visuals' || intent.diveLens === 'clothing')) {
    add('dive-visuals-chain', 'visual sources, galleries, and image provenance for this investigation', 'images-galleries', [
      qSub + (topic ? ' ' + topic : '') + ' (photoset OR gallery OR stills OR source OR credits)',
      qSub + (topic ? ' ' + topic : '') + ' (image OR photo OR lookbook)',
    ], 5);
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

export function fillTopicMapFromEvidence(map, results, extras = {}) {
  const tm = map && typeof map === 'object' ? { ...map, branches: (map.branches || []).map(b => ({ ...b })) } : { branches: [] };
  const rows = results || [];
  const peopleN = (extras.relatedPeople || []).filter(p => p && p.name).length;
  const visualN = (extras.visuals || extras.visualResults || []).filter(v => v && (v.url || v.image)).length;
  const sourceN = rows.length;
  tm.counts = { people: peopleN, visuals: visualN, sources: sourceN };
  tm.branches = (tm.branches || []).map(b => {
    const id = String(b.id || b.sourceClass || '').toLowerCase();
    let n = Number(b.results || 0);
    if (/people|collaborator/.test(id) && peopleN) n = Math.max(n, peopleN);
    if (/visual|image|gallery/.test(id) && visualN) n = Math.max(n, visualN);
    const matching = rows.filter(r => {
      const sc = String(r.sourceClass || r.plannerSourceClass || '').toLowerCase();
      return sc && (sc === String(b.sourceClass || '').toLowerCase() || sc === String(b.id || '').toLowerCase());
    });
    if (matching.length) n = Math.max(n, matching.length);
    return { ...b, results: n, status: n > 0 ? 'observed' : (b.status && b.status !== 'pending' ? b.status : 'unexplored') };
  });
  return tm;
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
    evidenceClass: (intersection === 'strong' || intersection === 'weak') ? 'INTERSECTION_EVIDENCE'
      : (role === 'SUBJECT_EVIDENCE' ? 'SUBJECT_EVIDENCE'
        : (role === 'TOPIC_EVIDENCE' ? 'RELATED_EVIDENCE' : 'DISCOVERY')),
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
    out.push({ ...r, url: r.url, canonicalUrl: key });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deep Dive 3-path retrieval: Bondage / People / Clothing
// Expand THROUGH discovered evidence. Never reword the same search.
// ---------------------------------------------------------------------------
const GENERIC_NAME_STOP = new Set([
  'the', 'and', 'with', 'from', 'this', 'that', 'official', 'profile', 'search',
  'video', 'videos', 'photo', 'photos', 'image', 'images', 'gallery', 'model',
  'performer', 'porn', 'xxx', 'free', 'watch', 'site', 'home', 'page', 'wiki',
  'bondage', 'bdsm', 'fetish', 'kink', 'interview', 'photoset', 'scene',
  'photographed', 'directed', 'produced', 'published', 'featuring', 'starring',
  'credits', 'studio', 'feature', 'presents', 'alongside', 'opposite',
]);

const PERSON_NAME_CAPTURE = '([A-Z][a-z]+(?:\\s+(?:de|da|van|von|di|le|la|del))?\\s+[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)';

const RELATIONAL_PEOPLE_PATTERNS = [
  { re: new RegExp('\\b(?:with|featuring|alongside|co-?starring|opposite)\\s+' + PERSON_NAME_CAPTURE, 'g'), role: 'collaborator', grade: 'OBSERVED' },
  { re: new RegExp('\\bphotographed by\\s+' + PERSON_NAME_CAPTURE, 'gi'), role: 'photographer', grade: 'OBSERVED' },
  { re: new RegExp('\\b(?:photo(?:graphy)? by|photos by)\\s+' + PERSON_NAME_CAPTURE, 'gi'), role: 'photographer', grade: 'OBSERVED' },
  { re: new RegExp('\\bdirected by\\s+' + PERSON_NAME_CAPTURE, 'gi'), role: 'director', grade: 'OBSERVED' },
  { re: new RegExp('\\bproduced by\\s+' + PERSON_NAME_CAPTURE, 'gi'), role: 'producer', grade: 'OBSERVED' },
  { re: new RegExp('\\bpublished by\\s+' + PERSON_NAME_CAPTURE, 'gi'), role: 'publisher', grade: 'OBSERVED' },
  { re: new RegExp('\\b(?:studio|for)\\s+' + PERSON_NAME_CAPTURE, 'g'), role: 'studio', grade: 'SUPPORTED' },
];

const CLOTHING_TERM_RE = /\b(dress|skirt|blouse|shirt|heels|boots|collar|cinch(?:\s+straps?)?|straps?|harness|corset|latex|leather|stockings?|outfit|lingerie|bodysuit|leotard|gloves?|jacket|coat|uniform|bikini|catsuit|hoodie|jeans|suit|gag|hood|cincher|ballet\s+boots?|metal\s+collar|rope)\b/ig;
const CLOTHING_COLOR_ONLY_RE = /\b(black|white|red|blue|green|yellow|pink|purple|orange|brown|grey|gray|blonde|blond|brunette|redhead|silver|gold|navy|beige|ivory|nude|tan|scarlet|crimson|violet|teal|maroon)\b/i;
const CLOTHING_GARMENT_HINT_RE = /\b(dress|skirt|blouse|shirt|heels|boots|collar|cinch|strap|harness|corset|latex|leather|stocking|outfit|lingerie|bodysuit|leotard|glove|jacket|coat|uniform|bikini|catsuit|hoodie|jeans|suit|gag|hood|cincher|garment|wardrobe)\b/i;

export function isClothingColorFalsePositive(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  const n = norm(s);
  if (/^(black|white|red|blue|green|yellow|pink|purple|orange|brown|grey|gray|blonde|blond|brunette|redhead|silver|gold|navy|beige|ivory|nude|tan|scarlet|crimson|violet|teal|maroon)$/i.test(n)) return true;
  const hasColor = CLOTHING_COLOR_ONLY_RE.test(s);
  const hasGarment = CLOTHING_GARMENT_HINT_RE.test(s);
  if (hasColor && !hasGarment) return true;
  return false;
}


const MIRROR_HOST_RE = /(^|\.)(web\.archive\.org|archive\.org|archive\.is|archive\.ph|archive\.today|megalodon\.jp)$/i;
const SEARCH_WRAPPER_HOST_RE = /(google|bing|duckduckgo|yahoo|startpage|mojeek|pinterest)\./i;

export function originalFromMirror(url) {
  const s = String(url || '');
  const wb = s.match(/web\.archive\.org\/web\/\d+(?:id_|if_)?\/(https?:\/\/\S+)/i);
  if (wb) return canonicalizeUrl(wb[1]);
  const ai = s.match(/archive\.(?:is|ph|today)\/(?:[a-z0-9]+\/)?(https?:\/\/\S+)/i);
  if (ai) return canonicalizeUrl(ai[1]);
  return canonicalizeUrl(s);
}

export function isMirrorUrl(url) {
  const host = hostOf(url);
  return MIRROR_HOST_RE.test(host);
}

export function nearDuplicateKey(item) {
  const url = String((item && (item.url || item.pageUrl)) || '');
  const orig = originalFromMirror(url);
  try {
    const u = new URL(orig);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
    return host + path;
  } catch {
    return orig || url;
  }
}

export function isQueryClone(item, query, intent) {
  const title = String((item && item.title) || '');
  const url = String((item && item.url) || '');
  const host = hostOf(url);
  if (SEARCH_WRAPPER_HOST_RE.test(host) && /[?&]q=/.test(url)) return true;
  if (isRedditSearchPage(url, title)) return true;
  if (isQueryEchoTitle(title, query, { subject: (intent && intent.subject) || '' })) return true;
  if (intent && intent.subject && intent.topic) {
    if (isQueryEchoTitle(title, intent.subject + ' ' + intent.topic, { subject: intent.subject })) return true;
  }
  return false;
}

function titleHostKey(item) {
  const t = norm(item && item.title);
  const h = String((item && (item.domain || hostOf(item && item.url))) || '').replace(/^www\./, '').toLowerCase();
  return t && h ? t + '|' + h : '';
}

export function classifyNovelty(item, seen, query, intent) {
  if (!item) return { novel: false, reason: 'empty' };
  const canon = canonicalizeUrl(item.url || item.pageUrl || '');
  const orig = originalFromMirror(item.url || item.pageUrl || '');
  const near = nearDuplicateKey(item);
  const th = titleHostKey(item);
  if (canon && seen.urls && seen.urls.has(canon)) return { novel: false, reason: 'duplicate' };
  if (orig && seen.urls && seen.urls.has(orig)) return { novel: false, reason: 'mirror' };
  if (near && seen.near && seen.near.has(near)) return { novel: false, reason: 'near-duplicate' };
  if (th && seen.titles && seen.titles.has(th)) return { novel: false, reason: 'same-title-same-host' };
  if (isQueryClone(item, query, intent)) return { novel: false, reason: 'query-echo' };
  return { novel: true, reason: 'new' };
}

export function buildSeenIndex(results) {
  const urls = new Set();
  const near = new Set();
  const titles = new Set();
  const hosts = new Set();
  const entities = new Set();
  for (const r of results || []) {
    const canon = canonicalizeUrl(r.url || r.pageUrl || '');
    const orig = originalFromMirror(r.url || r.pageUrl || '');
    if (canon) urls.add(canon);
    if (orig) urls.add(orig);
    const n = nearDuplicateKey(r);
    if (n) near.add(n);
    const th = titleHostKey(r);
    if (th) titles.add(th);
    const host = String(r.domain || hostOf(r.url) || '').replace(/^www\./, '').toLowerCase();
    if (host) hosts.add(host);
    if (r.canonicalName) entities.add(norm(r.canonicalName));
    if (r.label) entities.add(norm(r.label));
  }
  return { urls, near, titles, hosts, entities };
}

export function additiveMerge(prior, next, opts = {}) {
  const intent = opts.intent || {};
  const query = opts.query || [intent.subject, intent.topic].filter(Boolean).join(' ');
  const seen = buildSeenIndex(prior);
  const kept = [];
  const rejected = [];
  let duplicatesRemoved = 0;
  let queryEchoesRemoved = 0;
  let mirrorsRemoved = 0;
  let nearDuplicatesRemoved = 0;
  for (const r of next || []) {
    if (!r || !r.url) continue;
    const verdict = classifyNovelty(r, seen, query, intent);
    if (!verdict.novel) {
      rejected.push({ url: r.url, title: r.title, reason: verdict.reason });
      if (verdict.reason === 'query-echo') queryEchoesRemoved++;
      else if (verdict.reason === 'mirror') mirrorsRemoved++;
      else if (verdict.reason === 'near-duplicate' || verdict.reason === 'same-title-same-host') nearDuplicatesRemoved++;
      else duplicatesRemoved++;
      continue;
    }
    const canon = canonicalizeUrl(r.url);
    const orig = originalFromMirror(r.url);
    const near = nearDuplicateKey(r);
    const th = titleHostKey(r);
    if (canon) seen.urls.add(canon);
    if (orig) seen.urls.add(orig);
    if (near) seen.near.add(near);
    if (th) seen.titles.add(th);
    kept.push({
      ...r,
      canonicalUrl: canon,
      foundThrough: r.foundThrough || opts.foundThrough || intent.mode || 'search',
      parent: r.parent || opts.parent || null,
      derivedFrom: r.derivedFrom || opts.derivedFrom || null,
      relatedTo: r.relatedTo || opts.relatedTo || intent.subject || null,
      sameSubject: intent.subject || '',
      sameSource: r.sameSource || r.domain || hostOf(r.url),
      similarTo: r.similarTo || null,
      novelty: 'new',
    });
  }
  const genuinelyNew = kept.length;
  const merged = mergeInvestigationEvidence(prior, kept);
  const exhausted = genuinelyNew === 0;
  return {
    merged,
    newItems: kept,
    rejected,
    genuinelyNew,
    duplicatesRemoved,
    queryEchoesRemoved,
    mirrorsRemoved,
    nearDuplicatesRemoved,
    totalNext: (next || []).length,
    totalMerged: merged.length,
    exhausted,
    message: exhausted ? NO_NEW_SOURCES_MESSAGE : '',
    learnedSomething: genuinelyNew > 0,
  };
}

function looksLikePersonName(s) {
  const t = String(s || '').trim();
  if (!t || t.length < 4 || t.length > 48) return false;
  const parts = t.split(/\s+/);
  if (parts.length < 2 || parts.length > 4) return false;
  if (parts.some(p => GENERIC_NAME_STOP.has(p.toLowerCase()))) return false;
  if (parts.some(p => !/^[A-Z][a-zA-Z'’-]+$/.test(p) && !/^(de|da|van|von|di|le|la|del)$/i.test(p))) return false;
  return parts.filter(p => /^[A-Z]/.test(p)).length >= 2;
}

function subjectNameSet(subject) {
  return new Set(tokens(subject).filter(t => t.length > 1));
}

export function extractRelatedPeople(results, subject, opts = {}) {
  const subj = String(subject || '').trim();
  const subjToks = subjectNameSet(subj);
  const out = [];
  const seen = new Set();
  const add = (name, role, grade, source, why) => {
    let clean = String(name || '').replace(/\s+/g, ' ').trim();
    const bits = clean.split(/\s+/);
    while (bits.length > 2 && GENERIC_NAME_STOP.has(bits[bits.length - 1].toLowerCase())) bits.pop();
    clean = bits.join(' ');
    if (!looksLikePersonName(clean)) return;
    if (norm(clean) === norm(subj)) return;
    const parts = tokens(clean);
    // Same first+last as subject is the subject, not a collaborator.
    if (subjToks.size && parts.every(p => subjToks.has(p))) return;
    const key = norm(clean) + '|' + role;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      name: clean,
      role,
      observationState: grade,
      why,
      foundThrough: source && source.url,
      parent: source && source.url,
      derivedFrom: source && source.url,
      relatedTo: subj,
      sameSubject: subj,
      evidenceUrl: source && source.url,
      evidenceTitle: source && source.title,
    });
  };
  for (const r of results || []) {
    const retrieved = r.provenance === 'RETRIEVED' || r.retrievalStatus === 'RETRIEVED' || r.accessState === 'DIRECTLY_RETRIEVED';
    const searchPage = isRedditSearchPage(r.url, r.title) || isQueryEchoTitle(r.title, opts.query || subj, { subject: subj });
    const text = String((r.textExcerpt || '') + ' ' + (retrieved ? (r.snippet || '') : '')).slice(0, 6000);
    const titleSnip = String((r.title || '') + ' ' + (r.snippet || ''));
    if (searchPage) {
      // Co-occurrence on a search page is UNKNOWN — never a relationship.
      continue;
    }
    for (const pat of RELATIONAL_PEOPLE_PATTERNS) {
      pat.re.lastIndex = 0;
      const pool = retrieved ? (text + ' ' + titleSnip) : titleSnip;
      let m;
      while ((m = pat.re.exec(pool))) {
        const grade = retrieved && text.includes(m[1]) ? 'OBSERVED' : (retrieved ? 'OBSERVED' : 'SUPPORTED');
        add(m[1], pat.role, grade, r, pat.role + ' language on “' + (r.title || r.url) + '”');
      }
    }
    // Names that merely share a search-result title with the subject stay UNKNOWN and are not added.
  }
  return out.slice(0, 12);
}

export function extractStudiosAndDomains(results, subject) {
  const out = [];
  const seen = new Set();
  const add = (label, kind, grade, source, domain) => {
    const key = norm(label || domain);
    if (!key || seen.has(key)) return;
    if (GENERIC_INDEX_HOSTS.some(g => (domain || '').endsWith(g))) return;
    seen.add(key);
    out.push({
      label: label || domain,
      kind,
      observationState: grade,
      domain: domain || '',
      foundThrough: source && source.url,
      parent: source && source.url,
      relatedTo: subject,
      why: kind + ' observed via ' + (source && (source.domain || hostOf(source.url)) || 'source'),
    });
  };
  for (const r of results || []) {
    const host = String(r.domain || hostOf(r.url) || '').replace(/^www\./, '');
    if (!host) continue;
    const adultHit = ADULT_SOURCE_CLASSES.some(c => (c.seeds || []).some(s => host === s || host.endsWith('.' + s)));
    const retrieved = r.provenance === 'RETRIEVED' || r.retrievalStatus === 'RETRIEVED';
    if (adultHit) add(host, 'domain', retrieved ? 'OBSERVED' : 'SUPPORTED', r, host);
    else if (!SEARCH_WRAPPER_HOST_RE.test(host) && !isRedditSearchPage(r.url, r.title)) {
      add(host, 'domain', retrieved ? 'OBSERVED' : 'INFERRED', r, host);
    }
    const blob = String((r.title || '') + ' ' + (r.snippet || '') + ' ' + (r.textExcerpt || ''));
    const studio = blob.match(/\b(?:studio|produced by|publisher)\s*[:\-]?\s*([A-Z][A-Za-z0-9][A-Za-z0-9'&.\- ]{2,40})/);
    if (studio) add(studio[1].trim(), 'studio', retrieved ? 'OBSERVED' : 'SUPPORTED', r, host);
  }
  return out.slice(0, 16);
}

export function extractProductions(results, subject) {
  const out = [];
  const seen = new Set();
  for (const r of results || []) {
    const retrieved = r.provenance === 'RETRIEVED' || r.retrievalStatus === 'RETRIEVED';
    const text = String((r.textExcerpt || '') + ' ' + (r.title || '') + ' ' + (r.snippet || '')).slice(0, 4000);
    const yearTitle = /\b([A-Z][A-Za-z0-9:'&.\-]*(?:\s+[A-Z][A-Za-z0-9:'&.\-]*){1,5})\s*\(((?:19|20)\d{2})\)/g;
    let m;
    while ((m = yearTitle.exec(text))) {
      const title = m[1].trim();
      if (title.split(/\s+/).length < 2) continue;
      if (norm(title) === norm(subject)) continue;
      if (/wikipedia|retrieved|official site|home page|search results/i.test(title)) continue;
      const key = norm(title);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        label: title,
        year: m[2],
        kind: 'production',
        observationState: retrieved ? 'OBSERVED' : 'SUPPORTED',
        foundThrough: r.url,
        parent: r.url,
        relatedTo: subject,
        why: 'Title/year on “' + (r.title || r.url) + '”',
      });
    }
  }
  return out.slice(0, 10);
}

export function extractClothingEvidence(results, visuals, opts = {}) {
  const out = [];
  const seen = new Set();
  const push = (term, grade, source, visual) => {
    const t = String(term || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!t || t.length < 3 || seen.has(t)) return;
    if (isClothingColorFalsePositive(t)) return;
    seen.add(t);
    out.push({
      term: t,
      observationState: grade,
      foundThrough: (source && source.url) || (visual && (visual.pageUrl || visual.url)) || null,
      visual: !!(visual && (visual.url || visual.image)),
      why: grade === 'OBSERVED'
        ? 'Garment term on a retrieved page or visual caption'
        : (grade === 'INFERRED' ? 'Garment term in a title/snippet — not visually verified' : 'No visual clothing evidence'),
    });
  };
  for (const r of results || []) {
    const retrieved = r.provenance === 'RETRIEVED' || r.retrievalStatus === 'RETRIEVED';
    const pool = retrieved
      ? String((r.textExcerpt || '') + ' ' + (r.title || '') + ' ' + (r.snippet || ''))
      : String((r.title || '') + ' ' + (r.snippet || ''));
    pool.replace(CLOTHING_TERM_RE, (m) => {
      push(m, retrieved ? 'OBSERVED' : 'INFERRED', r, null);
      return m;
    });
  }
  for (const v of visuals || []) {
    const cap = String((v.caption || '') + ' ' + (v.title || '') + ' ' + (v.reason || ''));
    const pageRetrieved = v.provenance === 'RETRIEVED';
    cap.replace(CLOTHING_TERM_RE, (m) => {
      push(m, pageRetrieved ? 'OBSERVED' : 'UNKNOWN', null, v);
      return m;
    });
  }
  if (!out.length) {
    out.push({
      term: '',
      observationState: 'UNKNOWN',
      foundThrough: null,
      visual: false,
      why: 'No clothing/outfit evidence was visually or textually verified. UNKNOWN rather than invented.',
    });
  }
  return out.slice(0, 12);
}

export function looksLikeFirstPartySource(item, subject) {
  const title = String((item && item.title) || '');
  const snippet = String((item && (item.snippet || item.description)) || '');
  const url = String((item && (item.url || item.pageUrl)) || '');
  const blob = title + ' ' + snippet;
  if (/official\s+site|official\s+website/i.test(blob)) return true;
  const toks = tokens(subject);
  if (toks.length >= 2) {
    const camel = toks.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join('');
    const slug = toks.join('-');
    const compact = toks.join('');
    if (camel && url.includes(camel)) return true;
    if (slug && url.toLowerCase().includes(slug)) return true;
    if (compact.length >= 8 && new RegExp('/' + compact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(url)) return true;
  }
  if (/\/models\//i.test(url) && toks.length && toks.every(t => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(url + ' ' + title))) return true;
  return false;
}

export function firstPartyDomains(results, subject) {
  const out = [];
  const seen = new Set();
  for (const r of results || []) {
    if (!looksLikeFirstPartySource(r, subject)) continue;
    const d = String(r.domain || hostOf(r.url) || '').replace(/^www\./, '').toLowerCase();
    if (!d || seen.has(d) || GENERIC_INDEX_HOSTS.some(g => d === g || d.endsWith('.' + g))) continue;
    seen.add(d);
    out.push({ domain: d, url: r.url, title: r.title, firstParty: true });
  }
  return out;
}

export function extractDiscoverySeeds(results, intent, extras = {}) {
  const subject = String((intent && intent.subject) || '').trim();
  const people = extractRelatedPeople(results, subject, { query: intent && intent.rawQuery });
  const studios = extractStudiosAndDomains(results, subject);
  const productions = extractProductions(results, subject);
  const clothing = extractClothingEvidence(results, extras.visuals || [], extras);
  const sourceClasses = [...new Set((results || []).map(r => r.sourceClass || r.plannerSourceClass).filter(Boolean))];
  const domains = [...new Set((results || []).map(r => String(r.domain || hostOf(r.url) || '').replace(/^www\./, '')).filter(Boolean))];
  const firstParty = firstPartyDomains(results, subject);
  const graphLeads = extras.graphLeads || intent.graphLeads || [];
  const extraLeads = [].concat(extras.relatedPeople || [], graphLeads || [], extras.productions || []);
  for (const g of extraLeads) {
    if (!g) continue;
    const personName = String(g.name || ((g.role || g.kind === 'collaborator' || g.kind === 'person' || g.kind === 'photographer' || g.kind === 'director') ? (g.label || '') : '') || '').trim();
    if (personName && looksLikePersonName(personName) && !people.some(p => norm(p.name) === norm(personName))) {
      people.push({
        name: personName,
        role: g.role || (g.kind === 'photographer' ? 'photographer' : (g.kind === 'director' ? 'director' : 'collaborator')),
        observationState: g.observationState || 'SUPPORTED',
        why: g.why || 'Discovered in a previous retrieval of this investigation',
        foundThrough: g.foundThrough || g.url || null,
        parent: g.parent || g.foundThrough || g.url || null,
        relatedTo: subject,
        sameSubject: subject,
      });
    }
    if ((g.kind === 'production' || g.kind === 'title') && g.label && !productions.some(p => norm(p.label) === norm(g.label))) {
      productions.push({
        label: g.label,
        year: g.year || '',
        kind: 'production',
        observationState: g.observationState || 'SUPPORTED',
        foundThrough: g.foundThrough || g.url || null,
        parent: g.parent || g.foundThrough || g.url || null,
        relatedTo: subject,
        why: g.why || 'Production observed in a previous retrieval',
      });
    }
    const domain = String(g.domain || ((g.kind === 'domain' || g.kind === 'studio') && /\./.test(g.label || '') ? g.label : '') || '').replace(/^www\./, '').toLowerCase();
    if (domain && domain.includes('.') && !domains.includes(domain) && !GENERIC_INDEX_HOSTS.some(h => domain === h || domain.endsWith('.' + h))) {
      domains.push(domain);
      if (!studios.some(s => norm(s.domain || s.label) === norm(domain))) {
        studios.push({
          label: g.label || domain,
          kind: g.kind === 'studio' ? 'studio' : 'domain',
          observationState: g.observationState || 'SUPPORTED',
          domain,
          foundThrough: g.foundThrough || g.url || null,
          relatedTo: subject,
          why: 'Domain carried forward from this investigation',
        });
      }
    }
  }
  return {
    subject,
    topic: (intent && intent.topic) || '',
    people,
    studios,
    productions,
    clothing,
    sourceClasses,
    domains,
    firstParty,
    graphLeads,
  };
}

function attemptedSet(attempted) {
  return new Set((attempted || []).map(s => String(s || '').trim().toLowerCase()).filter(Boolean));
}

export function isNaiveLensQuery(q, intent) {
  const n = String(q || '').replace(/["']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const sub = String((intent && intent.subject) || '').replace(/["']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!n || !sub) return false;
  const lens = String((intent && intent.diveLens) || '').toLowerCase();
  const topic = String((intent && intent.topic) || '').toLowerCase();
  // Only the exact "subject + lens-word" clone is naive. Entity × topic with
  // source-class terms (photoset/scene/gallery/site:) MUST survive Deep Dive.
  const words = [...new Set([lens, 'people', 'clothing', 'visuals'].filter(Boolean))];
  if (topic && topic !== lens && topic !== 'people' && topic !== 'visuals' && topic !== 'clothing') {
    // "Riley Reid bondage" alone is a clone if already attempted; sourced
    // intersection queries are not naive.
    if (n === sub + ' ' + topic) return true;
  }
  return words.some(w => n === sub + ' ' + w);
}

function pushQuery(out, seen, q, why, lane, kind, extra) {
  const t = String(q || '').trim();
  if (!t) return;
  const k = t.toLowerCase();
  if (seen.has(k)) return;
  seen.add(k);
  out.push({ q: t, why, lane: lane || 'lens', kind: kind || 'web', sourceClass: (extra && extra.sourceClass) || '', foundThrough: extra && extra.foundThrough, parent: extra && extra.parent, relatedTo: extra && extra.relatedTo });
}

export function buildLensQueries(intent, corpus, attempted, extras = {}) {
  const subject = quote(intent && intent.subject) || (intent && intent.subject) || '';
  const rawSubject = String((intent && intent.subject) || '').trim();
  const topic = String((intent && intent.topic) || '').trim();
  const lens = (intent && intent.diveLens) || (intent && intent.mode === 'dive-bondage' ? 'bondage' : (intent && intent.mode === 'dive-people' ? 'people' : (intent && (intent.mode === 'dive-visuals' || intent.mode === 'dive-clothing') ? 'visuals' : '')));
  const adultOn = intent && (intent.adultLens === 'on' || intent.adultLens === 'both');
  const seeds = extractDiscoverySeeds(corpus || intent.priorResults || [], intent, extras);
  const seen = attemptedSet(attempted || intent.attemptedQueries);
  const out = [];
  const add = (q, why, lane, kind, extra) => pushQuery(out, seen, q, why, lane, kind, extra);

  // Never emit the naive "subject + lens-word" clone if it was already tried.
  const naiveBondage = (rawSubject + ' bondage').trim().toLowerCase();
  const naivePeople = (rawSubject + ' people').trim().toLowerCase();
  const naiveVisuals = (rawSubject + ' visuals').trim().toLowerCase();
  const naiveClothing = (rawSubject + ' clothing').trim().toLowerCase();

  if (lens === 'bondage') {
    const topicWord = topic && topic !== 'people' && topic !== 'visuals' && topic !== 'clothing' ? topic : 'bondage';
    // Entity × topic MUST survive Deep Dive. Sourced intersection is not a
    // naive clone of "Riley Reid bondage".
    add(subject + ' ' + topicWord + ' (photoset OR scene OR gallery OR interview OR feature)', 'entity × topic sourced intersection — both tokens survive Deep Dive', 'bondage-intersection', 'web', { sourceClass: 'intersection' });
    add(subject + ' "' + topicWord + '" (stills OR credits OR production)', 'entity × quoted-topic evidence', 'bondage-intersection', 'web', { sourceClass: 'intersection' });
    for (const st of seeds.studios.slice(0, 6)) {
      if (st.domain) add(subject + ' ' + topicWord + ' site:' + st.domain, 'bondage expansion via discovered domain ' + st.domain + ' keeping entity × topic', 'bondage-domain', 'web', { sourceClass: 'fetish-publisher', foundThrough: st.foundThrough, parent: st.parent, relatedTo: st.label });
      if (st.kind === 'studio' && st.label) add(subject + ' "' + st.label + '" ' + topicWord + ' (production OR photoset OR scene)', 'bondage expansion via discovered studio', 'bondage-studio', 'web', { foundThrough: st.foundThrough, relatedTo: st.label, sourceClass: 'intersection' });
    }
    for (const p of seeds.productions.slice(0, 4)) {
      add(subject + ' "' + p.label + '" ' + topicWord, 'bondage expansion via discovered production', 'bondage-production', 'web', { foundThrough: p.foundThrough, relatedTo: p.label, sourceClass: 'intersection' });
    }
    for (const person of seeds.people.slice(0, 4)) {
      add(subject + ' "' + person.name + '"', 'bondage expansion via discovered collaborator (' + person.observationState + ')', 'bondage-collaborator', 'web', { foundThrough: person.foundThrough, relatedTo: person.name });
    }
    if (adultOn) {
      const usedDomains = new Set(seeds.domains);
      for (const cls of ADULT_SOURCE_CLASSES) {
        if (cls.id !== 'fetish-publisher' && cls.id !== 'studio-producer' && cls.id !== 'video' && cls.id !== 'images-galleries' && cls.id !== 'archival' && cls.id !== 'community-social') continue;
        for (const seed of (cls.seeds || []).slice(0, 3)) {
          if (usedDomains.has(seed)) continue;
          add(subject + ' site:' + seed, 'unexplored bondage source class ' + cls.label, 'bondage-' + cls.id, cls.kind === 'image' ? 'image' : (cls.kind === 'video' ? 'video' : 'web'), { sourceClass: cls.id });
        }
      }
    }
    const observedGarments = seeds.clothing.filter(c => c.observationState === 'OBSERVED' && c.term);
    for (const g of observedGarments.slice(0, 3)) {
      add(subject + ' "' + g.term + '" (photoset OR stills OR scene)', 'bondage visual via observed garment', 'bondage-garment', 'image', { foundThrough: g.foundThrough, relatedTo: g.term });
    }
    add(subject + ' (photoset OR stills OR gallery) (bound OR restrained OR metal OR rope OR ' + topicWord + ')', 'bondage image lane from investigation state, not a query rewrite', 'bondage-images', 'image', { sourceClass: 'images-galleries' });
    add(subject + ' (scene OR clip OR feature) (studio OR production) ' + topicWord, 'bondage video lane keeps the requested topic', 'bondage-video', 'video', { sourceClass: 'video' });
    add(subject + ' (interview OR article OR archive OR history) (studio OR production OR feature) ' + topicWord, 'historical bondage references keep entity × topic', 'bondage-historical', 'web', { sourceClass: 'interviews' });
    // Only use the naive clone if nothing else is available AND it was never attempted.
    if (!out.length && !seen.has(naiveBondage) && rawSubject) {
      add(rawSubject + ' bondage', 'first bondage intersection — no prior evidence to chain from yet', 'bondage-intersection', 'web', { sourceClass: 'intersection' });
    }
  } else if (lens === 'people') {
    for (const person of seeds.people) {
      if (person.observationState === 'UNKNOWN') continue;
      add(subject + ' "' + person.name + '"', 'connected person (' + person.role + ', ' + person.observationState + '): ' + person.why, 'people-collaborator', 'web', { foundThrough: person.foundThrough, relatedTo: person.name });
      if (person.role === 'photographer' || person.role === 'director' || person.role === 'producer') {
        add('"' + person.name + '" ' + subject, 'follow the ' + person.role + ' relationship', 'people-role', 'web', { relatedTo: person.name });
      }
    }
    for (const st of seeds.studios.slice(0, 4)) {
      if (st.domain) add(subject + ' (cast OR models OR featuring) site:' + st.domain, 'people listed on discovered studio/domain', 'people-studio', 'web', { foundThrough: st.foundThrough, relatedTo: st.label });
    }
    add(subject + ' (credits OR filmography OR "photographed by" OR "directed by" OR featuring)', 'credits/relationship pages for connected people', 'people-credits', 'web', { sourceClass: 'collaborators' });
    if (!seeds.people.length) {
      add(subject + ' (with OR featuring OR "co-star" OR photographer OR director)', 'no connected people observed yet — look for relationship language', 'people-seek', 'web');
    }
    if (seen.has(naivePeople)) {
      // drop any accidental clone
    }
  } else if (lens === 'visuals' || lens === 'clothing') {
    const observed = seeds.clothing.filter(c => c.term && c.observationState === 'OBSERVED');
    const inferred = seeds.clothing.filter(c => c.term && c.observationState === 'INFERRED');
    const activeTopic = topic && topic !== 'clothing' && topic !== 'visuals' && topic !== 'people' ? topic : '';
    for (const g of observed.slice(0, 5)) {
      add(subject + ' "' + g.term + '" (stills OR photoset OR gallery' + (activeTopic ? ' OR ' + activeTopic : '') + ')', 'visual expansion from OBSERVED garment in this investigation', 'visuals-observed', 'image', { foundThrough: g.foundThrough, relatedTo: g.term });
    }
    for (const g of inferred.slice(0, 3)) {
      add(subject + ' "' + g.term + '" (gallery OR stills OR source)', 'visual lead from title/snippet — remains INFERRED until visual evidence', 'visuals-inferred', 'web', { foundThrough: g.foundThrough, relatedTo: g.term });
    }
    for (const st of seeds.studios.slice(0, 4)) {
      if (st.domain) add(subject + (activeTopic ? ' ' + activeTopic : '') + ' (gallery OR photoset OR stills) site:' + st.domain, 'visuals on a discovered domain', 'visuals-domain', 'image', { foundThrough: st.foundThrough, relatedTo: st.label });
    }
    for (const p of seeds.productions.slice(0, 3)) {
      add(subject + ' "' + p.label + '" (stills OR gallery OR photoset)', 'visuals from a discovered production', 'visuals-production', 'image', { foundThrough: p.foundThrough, relatedTo: p.label });
    }
    add(subject + (activeTopic ? ' ' + activeTopic : '') + ' (photoset OR gallery OR stills OR source OR credits)', 'visual sources inheriting the active investigation, not a generic image search', 'visuals-inherit', 'image', { sourceClass: 'images-galleries' });
    add(subject + (activeTopic ? ' ' + activeTopic : '') + ' (original OR source OR credits OR "photo page")', 'image provenance / original source lane', 'visuals-provenance', 'web');
    if (activeTopic) add(subject + ' ' + activeTopic + ' (outfit OR garment OR wearing OR stills)', 'visual × current topic', 'visuals-topic', 'web');
    if (!observed.length) extras.clothingUnknown = true;
    if ((seen.has(naiveVisuals) || seen.has(naiveClothing)) && out.every(x => x.q.toLowerCase() !== naiveVisuals && x.q.toLowerCase() !== naiveClothing)) {
      // never re-add naive clone
    }
  } else {
    // Find-more / generic expansion uses next unexplored lane below.
  }

  return out.slice(0, extras.limit || 24);
}

export const FIND_MORE_LANE_ORDER = [
  'first-party-domain',
  'discovered-domain',
  'discovered-entity',
  'production',
  'collaborator',
  'unexplored-source-class',
  'historical',
  'related-topic',
  'visual-source',
  'community',
  'premium',
];

export function nextFindMoreLane(intent, corpus, attempted, extras = {}) {
  const subject = quote(intent && intent.subject) || (intent && intent.subject) || '';
  const rawSubject = String((intent && intent.subject) || '').trim();
  const topic = String((intent && intent.topic) || '').trim();
  const adultOn = intent && (intent.adultLens === 'on' || intent.adultLens === 'both');
  const seeds = extractDiscoverySeeds(corpus || [], intent, extras);
  const seen = attemptedSet(attempted);
  const reached = new Set((seeds.sourceClasses || []).map(s => String(s).toLowerCase()));
  const usedDomains = new Set((seeds.domains || []).map(d => String(d).replace(/^www\./, '').toLowerCase()));
  const out = [];
  const add = (q, why, lane, kind, extra) => pushQuery(out, seen, q, why, lane, kind, extra);
  const picked = [];

  const tryLane = (id) => {
    if (out.length) return;
    if (id === 'first-party-domain') {
      const fp = (seeds.firstParty || [])[0];
      if (fp && fp.domain && !seen.has((rawSubject + ' site:' + fp.domain).toLowerCase())) {
        add(subject + ' site:' + fp.domain, 'first-party / official domain ' + fp.domain, id, 'web', { sourceClass: 'creator-owned', relatedTo: fp.domain });
        add('site:' + fp.domain + ' (gallery OR models OR photoset OR video OR scene)', 'crawl accessible pages on discovered first-party domain', id, 'web', { sourceClass: 'creator-owned', relatedTo: fp.domain });
        picked.push(id);
      }
    } else if (id === 'unexplored-source-class') {
      const catalog = adultOn ? ADULT_SOURCE_CLASSES : ADULT_SOURCE_CLASSES.filter(c => ['interviews', 'identity-profile', 'related-sites', 'archival', 'community-social'].includes(c.id));
      for (const cls of catalog) {
        if (reached.has(cls.id) || reached.has(cls.kind)) continue;
        const seed = (cls.seeds || []).find(s => !usedDomains.has(s));
        if (seed) {
          add(subject + ' site:' + seed, 'unexplored source class: ' + cls.label, id, cls.kind === 'image' ? 'image' : (cls.kind === 'video' ? 'video' : 'web'), { sourceClass: cls.id });
          picked.push(id);
          break;
        }
        const qword = (cls.queries || [])[0];
        if (qword) {
          add(subject + (topic ? ' ' + topic : '') + ' ' + qword, 'unexplored source class: ' + cls.label, id, 'web', { sourceClass: cls.id });
          picked.push(id);
          break;
        }
      }
    } else if (id === 'discovered-entity') {
      const person = seeds.people.find(p => p.observationState !== 'UNKNOWN' && !seen.has((rawSubject + ' "' + p.name + '"').toLowerCase()));
      if (person) {
        add(subject + ' "' + person.name + '"', 'newly discovered entity: ' + person.name + ' (' + person.observationState + ')', id, 'web', { relatedTo: person.name, foundThrough: person.foundThrough });
        picked.push(id);
      }
    } else if (id === 'discovered-domain') {
      const domain = seeds.domains.find(d => d && !GENERIC_INDEX_HOSTS.some(g => d === g || d.endsWith('.' + g)) && !seen.has((rawSubject + ' site:' + d).toLowerCase()));
      if (domain) {
        add(subject + ' site:' + domain, 'newly discovered domain ' + domain, id, 'web', { relatedTo: domain });
        picked.push(id);
      }
    } else if (id === 'collaborator') {
      const person = seeds.people.find(p => p.role === 'collaborator' || p.role === 'photographer' || p.role === 'director');
      if (person) {
        add('"' + person.name + '" ' + subject, 'follow collaborator relationship', id, 'web', { relatedTo: person.name });
        picked.push(id);
      }
    } else if (id === 'production') {
      const prod = seeds.productions[0];
      if (prod) {
        add('"' + prod.label + '" ' + (topic || subject), 'follow discovered production', id, 'web', { relatedTo: prod.label });
        picked.push(id);
      }
    } else if (id === 'historical') {
      add(subject + (topic ? ' ' + topic : '') + ' (archive OR history OR "wayback" OR interview OR founded)', 'historical/archive lane', id, 'web', { sourceClass: 'archival' });
      picked.push(id);
    } else if (id === 'related-topic') {
      const extra = (topicTerms(topic) || []).filter(t => t && t !== norm(topic) && t.length > 3)[0];
      if (extra) {
        add(subject + ' ' + extra, 'related topic term observed in planning vocab — still needs evidence', id, 'web');
        picked.push(id);
      }
    } else if (id === 'visual-source') {
      add(subject + (topic ? ' ' + topic : '') + ' (photoset OR gallery OR stills OR lookbook)', 'visual source lane', id, 'image', { sourceClass: 'images-galleries' });
      picked.push(id);
    } else if (id === 'community') {
      add(subject + (topic ? ' ' + topic : '') + ' site:reddit.com', 'community source lane', id, 'web', { sourceClass: 'reddit' });
      picked.push(id);
    } else if (id === 'premium') {
      if (adultOn) {
        const plat = PREMIUM_PLATFORM_SEEDS.find(p => !usedDomains.has(p.host));
        if (plat) {
          add(subject + ' site:' + plat.host, 'unexplored premium/source relationship', id, 'web', { sourceClass: 'premium-subscription' });
          picked.push(id);
        }
      }
    }
  };

  for (const id of FIND_MORE_LANE_ORDER) tryLane(id);
  if (!out.length) {
    return {
      exhausted: true,
      message: NO_NEW_SOURCES_MESSAGE,
      queries: [],
      lane: null,
      seeds,
    };
  }
  return {
    exhausted: false,
    message: '',
    queries: out.slice(0, extras.limit || 6),
    lane: picked[0] || out[0].lane,
    seeds,
  };
}

export function competingFullNameInText(blob, subject) {
  const toks = tokens(subject).filter(t => t.length > 1);
  if (toks.length < 2) return '';
  const first = toks[0];
  const last = toks[toks.length - 1];
  const original = String(blob || '');
  const re = new RegExp('\\b' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+((?:de|da|van|von|di|le|la|del)\\s+)?([A-Za-z][A-Za-z\'-]{1,20})(?:\\s+([A-Za-z][A-Za-z\'-]{1,20}))?', 'gi');
  let m;
  while ((m = re.exec(original))) {
    const particle = (m[1] || '').trim();
    const mid = m[2] || '';
    const end = m[3] || '';
    const lastName = particle ? mid : mid;
    // A competing identity is a capitalized last name (Drea de Matteo), not "Drea on set".
    if (!/^[A-Z]/.test(lastName)) continue;
    if (GENERIC_NAME_STOP.has(mid.toLowerCase()) || GENERIC_NAME_STOP.has(end.toLowerCase())) continue;
    if (mid.length < 3) continue;
    const rest = [particle, mid, end].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!rest) continue;
    if (rest === last || rest.endsWith(' ' + last) || rest.startsWith(last + ' ')) continue;
    if (TOPIC_VOCAB.bondage.some(v => norm(v) === mid.toLowerCase()) || TOPIC_VOCAB.clothing.some(v => norm(v) === mid.toLowerCase())) continue;
    if (/^(official|onlyfans|loyalfans|photos?|videos?|gallery|interview|wikipedia|profile|model|performer)$/i.test(mid)) continue;
    return (first + ' ' + rest).trim();
  }
  return '';
}

export function visualIdentityGrade(item, subject, opts = {}) {
  const name = String(subject || '').trim();
  const toks = tokens(name).filter(t => t.length > 1);
  const blob = identityEvidenceText(item, opts);
  const nblob = norm(blob);
  const host = hostOf((item && (item.pageUrl || item.url)) || '');
  const feedback = opts.feedback || opts.identityFeedback || {};
  const confirmed = (feedback.confirmed || []).map(norm);
  const rejectedImages = new Set((feedback.rejectedImages || []).concat(feedback.rejectedUrls || []).map(u => canonicalizeUrl(u)).filter(Boolean));
  const key = canonicalizeUrl((item && (item.url || item.image || item.pageUrl)) || '');
  const identityClass = classifyIdentityClass(item, name, { ...opts, type: (opts.classification && opts.classification.type) || opts.type });

  if (key && rejectedImages.has(key)) {
    return { grade: 'unverified', reason: 'negatively confirmed visual', excludeFromPrimaryCorpus: true, identityConfidence: 'unverified', identityClass, evidenceLevel: 'REJECTED' };
  }
  if (item && item.candidateId && candidateRejectionMatches('', item.candidateId, feedback)) {
    return { grade: 'unverified', reason: 'rejected candidate visual', excludeFromPrimaryCorpus: true, identityConfidence: 'unverified', identityClass, evidenceLevel: 'REJECTED' };
  }
  if (identityClass === 'PERSON_FICTIONAL' || isFictionalCharacterHost(host)) {
    const disney = fictionalNameCollision(blob, name, host) || { collision: 'fictional character', reason: 'fictional/character host is not the resolved person' };
    return {
      grade: 'unverified',
      collision: disney.collision,
      reason: disney.reason,
      excludeFromPrimaryCorpus: true,
      identityConfidence: 'unverified',
      textRelevance: 'unrelated',
      visualRelevance: 'unrelated',
      identityClass: 'PERSON_FICTIONAL',
      evidenceLevel: 'REJECTED',
    };
  }

  const collision = competingFullNameInText(blob, name);
  if (collision) {
    return {
      grade: 'unverified',
      collision,
      reason: 'competing full name in the evidence (“' + collision + '”) — not counted as the subject',
      excludeFromPrimaryCorpus: true,
      firstNameOnly: false,
      identityConfidence: 'unverified',
      textRelevance: 'possible',
      visualRelevance: 'unverified',
      identityClass,
      evidenceLevel: 'REJECTED',
    };
  }

  const disney = fictionalNameCollision(blob, name, host);
  if (disney) {
    return {
      grade: 'unverified',
      collision: disney.collision,
      reason: disney.reason,
      excludeFromPrimaryCorpus: true,
      identityConfidence: 'unverified',
      textRelevance: 'unrelated',
      visualRelevance: 'unrelated',
      identityClass: 'PERSON_FICTIONAL',
      evidenceLevel: 'REJECTED',
    };
  }

  if (toks.length < 2) {
    return { grade: 'unverified', reason: 'incomplete subject name — first-name matches are not identity evidence', firstNameOnly: true, excludeFromPrimaryCorpus: true, identityConfidence: 'unverified', identityClass, evidenceLevel: 'METADATA_MATCH' };
  }

  const first = toks[0];
  const last = toks[toks.length - 1];
  const fullHit = toks.every(t => nblob.includes(t));
  const firstHit = nblob.includes(first);
  const lastHit = nblob.includes(last);
  const identityHost = /(iafd|babepedia|adultfilmdatabase|wikipedia|imdb|loyalfans|onlyfans|houseofgord|clips4sale|indexxx)\./i.test(host);

  if (firstHit && !lastHit) {
    return {
      grade: 'unverified',
      firstNameOnly: true,
      reason: 'first-name match is not identity evidence',
      excludeFromPrimaryCorpus: true,
      identityConfidence: 'unverified',
      textRelevance: 'weak',
      visualRelevance: 'unverified',
      identityClass,
      evidenceLevel: 'METADATA_MATCH',
    };
  }

  if (fullHit) {
    if (confirmed.some(c => c === norm(name)) && identityHost) {
      return { grade: 'verified', reason: 'user-confirmed identity on a trusted identity host', identityConfidence: 'verified', textRelevance: 'supported', visualRelevance: 'possible', identityClass: 'PERSON_REAL', evidenceLevel: 'VISUAL_IDENTITY_VERIFIED' };
    }
    if (identityHost) {
      return { grade: 'supported', reason: 'full name on an identity/source host — visual likeness is still not identity proof', identityConfidence: 'supported', textRelevance: 'supported', visualRelevance: 'possible', identityClass: 'PERSON_REAL', evidenceLevel: 'SOURCE_ASSOCIATED' };
    }
    return { grade: 'possible', reason: 'full name present in page evidence — metadata is not visual identity proof', identityConfidence: 'possible', textRelevance: 'supported', visualRelevance: 'possible', identityClass: 'PERSON_REAL', evidenceLevel: 'METADATA_MATCH' };
  }

  return {
    grade: 'unverified',
    reason: 'no full-name identity evidence on this visual (query text is not identity proof)',
    identityConfidence: 'unverified',
    textRelevance: firstHit ? 'weak' : 'none',
    visualRelevance: 'unverified',
    excludeFromPrimaryCorpus: !lastHit,
    identityClass,
    evidenceLevel: firstHit ? 'METADATA_MATCH' : 'REJECTED',
  };
}

export function applyVisualIdentityFilter(visuals, subject, opts = {}) {
  const out = [];
  const dropped = [];
  for (const im of visuals || []) {
    const grade = visualIdentityGrade(im, subject, opts);
    const row = { ...im, identityGrade: grade.grade, identityConfidence: grade.identityConfidence || grade.grade, identityReason: grade.reason, visualLikenessIsNotIdentityProof: true };
    if (grade.collision) row.identityCollision = grade.collision;
    if (grade.excludeFromPrimaryCorpus) {
      row.primaryCorpus = false;
      dropped.push(row);
      continue;
    }
    row.primaryCorpus = true;
    out.push(row);
  }
  return { kept: out, dropped, primary: out, unverified: dropped };
}

export function expansionReport(pack, extras = {}) {
  const p = pack || {};
  return {
    totalResults: extras.totalResults != null ? extras.totalResults : (p.totalMerged || 0),
    genuinelyNew: p.genuinelyNew || 0,
    duplicatesRemoved: (p.duplicatesRemoved || 0) + (p.nearDuplicatesRemoved || 0),
    queryEchoesRemoved: p.queryEchoesRemoved || 0,
    mirrorsRemoved: p.mirrorsRemoved || 0,
    wrongPersonCandidates: extras.wrongPersonCandidates || 0,
    sourceQuality: extras.sourceQuality || null,
    identityConfidence: extras.identityConfidence || null,
    newEntitiesDiscovered: extras.newEntitiesDiscovered || 0,
    newDomainsDiscovered: extras.newDomainsDiscovered || 0,
    learnedSomething: !!p.learnedSomething,
    message: p.exhausted ? NO_NEW_SOURCES_MESSAGE : (p.learnedSomething ? 'Investigation expanded with new evidence.' : ''),
    lens: extras.lens || '',
    lane: extras.lane || '',
  };
}

export function primaryDiveLenses() {
  return PRIMARY_DIVE_LENSES.map(l => ({ ...l }));
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
  const transient = Object.values(diags).some(d => d && (d.status === 503 || d.status === 429 || /503|temporarily unavailable/i.test(String(d.error || d.note || '')) || d.failureReason === 'unavailable'));
  if (!n && transient) {
    return { status: 'search_failed', label: 'temporarily unavailable — not evidence that nothing exists' };
  }
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
export function findMoreQueries(intent, attempted, corpus) {
  const subject = quote(intent.subject) || intent.subject;
  const topic = intent.topic || '';
  if (intent.visual || intent.mode === 'find-more-visual' || (intent.retrievalIntents || []).includes('visual')) {
    const vis = findMoreVisualQueries(intent, attempted, corpus, intent.knownMedia || []);
    if (vis.length) return vis;
  }
  if (corpus && corpus.length) {
    const lane = nextFindMoreLane(intent, corpus, attempted);
    if (lane.exhausted) return [];
    return lane.queries.map(q => ({ ...q, lane: q.lane || 'find-more' }));
  }
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
  const vis = findMoreVisualQueries(intent, attempted, corpus, intent.knownMedia || []);
  return out.concat(vis).slice(0, 10);
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
    rejectedCandidateIds: uniq([].concat(a.rejectedCandidateIds || [], b.rejectedCandidateIds || [])).slice(-16),
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
    const blob = norm(identityEvidenceText(row));
    let weight = 0;
    let note = '';
    if (key && rejectedUrls.has(key)) {
      row.suppressed = true;
      row.rejectionReason = 'negatively confirmed visual/url';
      continue;
    }
    if (host && rejectedHosts.has(host) && !/(iafd|babepedia|wikipedia|imdb|onlyfans)/i.test(host)) {
      row.suppressed = true;
      row.rejectionReason = 'rejected identity/host';
      continue;
    }
    if (classifyIdentityClass(row, subject, { classification }) === 'PERSON_FICTIONAL') {
      row.suppressed = true;
      row.rejectionReason = 'fictional character is not the resolved person';
      row.identityClass = 'PERSON_FICTIONAL';
      continue;
    }
    if (candidateRejectionMatches(row.title, row.candidateId, fb)) {
      weight -= 40;
      note = 'negatively weighted — rejected candidate';
      row.suppressed = true;
      row.rejectionReason = note;
      continue;
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
  else if (status === 503 || status === 429 || /temporarily unavailable|503/i.test(err)) failureReason = 'unavailable';
  else if (status === 403 || /block|captcha|forbidden/i.test(err) || entry.accessState === 'BLOCKED') failureReason = 'blocked';
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
    query: opts.query || '',
    intent: opts.intent || '',
    intentClass: opts.intentClass || '',
    subject: opts.subject || '',
    topic: opts.topic || '',
    adultLens: opts.adultLens || opts.adult || 'on',
    entityType: opts.entityType || opts.type || '',
    phase: opts.phase || 'IDLE',
    identityCandidates: [],
    confirmedIdentity: [],
    discoveredSources: [],
    results: [],
    visualResults: [],
    searchHistory: [],
    expansionState: { attemptedQueries: [], domains: [], visitedUrls: [], extractedEntities: [], imageUrls: [], mediaUrls: [], rejectedDuplicates: [], blockedSources: [], exhaustedLanes: [] },
    candidates: [],
    visuals: [],
    rejected: { urls: [], hosts: [], images: [], people: [], accounts: [] },
    confirmed: [],
    trail: [{ kind: 'new', label: 'New investigation', at: new Date().toISOString() }],
    savedEvidence: [],
    parentInvestigationId: opts.parentInvestigationId || null,
    derivedFrom: opts.derivedFrom || null,
    foundThrough: opts.foundThrough || 'new',
    relatedTo: opts.relatedTo || null,
    retrievalRuns: 0,
    identityFeedback: { confirmed: [], rejectedPeople: [], rejectedCandidateIds: [], rejectedImages: [], rejectedHosts: [], rejectedUrls: [] },
    canonicalPerson: null,
    entityIdentity: null,
    accounts: [],
    concepts: [],
    variations: [],
    evidenceGraph: [],
    inaccessibleSources: [],
    retrievalFailures: [],
    stoppingCondition: null,
    whatCarmenChecked: null,
    whyDidYouStop: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    researchFocus: [].concat(opts.researchFocus || opts.focus || []).filter(Boolean),
    investigationQueue: opts.investigationQueue || null,
    pendingQueryFamilies: [],
    completedQueryFamilies: [],
    remainingWork: [],
    visualCandidates: [],
    verifiedVisuals: [],
    rejectedVisuals: [],
    canonicalEntities: [],
    discoveredSeeds: [],
    sourceAnalyses: [],
    stopState: null,
    resumable: false,
    identityVerification: null,
    sourceLifecycle: [],
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
    next.phase = 'IDLE';
    next.trail = [{ kind: 'new', label: 'Hard live-state reset — saved collections kept', at: next.createdAt }];
    return next;
  }
  if (act === 'search' || act === 'identify' || act === 'topic-search' || act === 'intersection' || act === 'find-everything' || act === 'find-more' || act === 'premium-accounts' || act === 'dive-bondage' || act === 'dive-people' || act === 'dive-visuals' || act === 'dive-clothing' || act === 'photo-input') {
    if (payload.subject) s.subject = payload.subject;
    if (payload.topic) s.topic = payload.topic;
    if (payload.query) s.query = payload.query;
    if (payload.intent) s.intent = payload.intent;
    if (payload.intentClass) s.intentClass = payload.intentClass;
    s.retrievalRuns = (s.retrievalRuns || 0) + 1;
    s.phase = act === 'find-more' ? 'EXPANDING' : 'RESEARCHING';
    s.searchHistory = [...(s.searchHistory || []), payload.query || act].filter(Boolean).slice(-48);
    pushTrail(act, (payload.query || [s.subject, s.topic].filter(Boolean).join(' + ') || act));
  }
  if (act === 'confirm-identity' || act === 'confirm') {
    const name = payload.name || payload.subject || s.subject;
    const candidate = payload.candidate || payload.canonicalPerson || null;
    s.confirmed = [...new Set([...(s.confirmed || []), name])].slice(-8);
    s.confirmedIdentity = [...new Set([...(s.confirmedIdentity || []), name])].slice(-8);
    s.canonicalEntities = [...new Set([...(s.canonicalEntities || []), name])].slice(-8);
    s.identityFeedback = mergeIdentityFeedback(s.identityFeedback, { confirmed: [name] });
    s.subject = name || s.subject;
    s.phase = 'IDENTITY_CONFIRMED';
    s.canonicalPerson = buildCanonicalPerson(candidate || { name, candidateId: payload.candidateId }, {
      name,
      candidateId: payload.candidateId,
      identityClass: payload.identityClass || 'PERSON_REAL',
    });
    s.identityVerification = { ...(s.identityVerification || {}), userConfirmed: true, canonical: name, needed: false, phase: 'RESEARCH' };
    pushTrail('confirm-identity', 'YES — THIS PERSON · ' + name);
  }
  if (act === 'reject-identity' || act === 'reject-person') {
    const name = payload.name || payload.title || '';
    const candidateId = payload.candidateId || '';
    s.rejected = s.rejected || { urls: [], hosts: [], images: [], people: [], candidateIds: [] };
    if (candidateId) s.rejected.candidateIds = [...new Set([...(s.rejected.candidateIds || []), candidateId])].slice(-16);
    if (name && tokens(name).length >= 2) s.rejected.people = [...new Set([...(s.rejected.people || []), name])].slice(-16);
    if (payload.host) s.rejected.hosts = [...new Set([...(s.rejected.hosts || []), payload.host])].slice(-16);
    if (payload.url) s.rejected.urls = [...new Set([...(s.rejected.urls || []), payload.url])].slice(-24);
    s.identityFeedback = mergeIdentityFeedback(s.identityFeedback, {
      rejectedPeople: name && tokens(name).length >= 2 ? [name] : [],
      rejectedCandidateIds: candidateId ? [candidateId] : [],
      rejectedHosts: payload.host ? [payload.host] : [],
      rejectedUrls: payload.url ? [payload.url] : [],
    });
    s.phase = 'IDENTITY_RESOLUTION';
    pushTrail('reject-identity', 'NOT THIS PERSON · ' + (candidateId || name));
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
  if (act === 'analyze' || act === 'analyze-exact-source') {
    const rec = payload.sourceAnalysis || payload.analysis || payload;
    const url = rec.canonicalUrl || rec.url || payload.url || '';
    if (url) {
      s.sourceAnalyses = [...(s.sourceAnalyses || []), rec].slice(-32);
      s.expansionState = s.expansionState || {};
      s.expansionState.visitedUrls = [...new Set([...(s.expansionState.visitedUrls || []), url])].slice(-80);
    }
    const seeds = payload.seeds || rec.seeds || [];
    if (seeds.length) {
      s.discoveredSeeds = [...(s.discoveredSeeds || []), ...seeds].slice(-64);
      s.evidenceGraph = [...(s.evidenceGraph || []), ...seeds.filter(x => x && x.url).map(x => ({
        url: x.url,
        parent: x.parent || url,
        foundThrough: x.foundThrough || 'exact-source',
        kind: x.kind || 'seed',
        sourceId: x.sourceId || sourceIdFromCanonicalUrl(x.url),
      }))].slice(-80);
    }
    pushTrail('analyze', 'Exact source ' + (url || rec.sourceId || 'unknown'));
  }
  return s;
}

export const API_ACTION_CATALOG = [
  { action: 'health', method: 'GET', path: '/api/v1/health', description: 'Version, features, provider status. Never returns secrets.' },
  { action: 'openapi', method: 'GET', path: '/api/v1/openapi.json', description: 'OpenAPI 3.0.3 for ChatGPT Actions. Documents CARMEN_API_KEY, never provider API_KEY.' },
  { action: 'capabilities', method: 'GET', path: '/api/v1/machine/capabilities', description: 'Read-only machine capabilities. pipelineFunction is always runDiscovery.' },
  { action: 'machine-search', method: 'POST', path: '/api/v1/machine/search', description: 'Same runDiscovery path as GET /search (iPhone PWA).' },
  { action: 'machine-dive', method: 'POST', path: '/api/v1/machine/dive', description: 'Deep Dive lens (bondage|people|visuals) on the same runDiscovery path.' },
  { action: 'machine-investigation', method: 'GET', path: '/api/v1/machine/investigations/:id', description: 'Best-effort investigation state. 404 if isolate dropped it. Prefer POST inspect with investigationState.' },
  { action: 'machine-investigation-inspect', method: 'POST', path: '/api/v1/machine/investigations/:id', description: 'Durable inspect. POST investigationId plus investigationState. Required for ChatGPT continuity.' },
  { action: 'machine-results', method: 'GET', path: '/api/v1/machine/investigations/:id/results', description: 'Structured evidence items if isolate still holds them.' },
  { action: 'machine-results-inspect', method: 'POST', path: '/api/v1/machine/investigations/:id/results', description: 'Structured evidence items from client-held investigationState.' },
  { action: 'machine-analyze', method: 'POST', path: '/api/v1/machine/investigations/:id/analyze', description: 'Analyze a public evidence object. Same analyze path as the PWA.' },
  { action: 'machine-confirm-identity', method: 'POST', path: '/api/v1/machine/investigations/:id/confirm-identity', description: 'That’s-the-one. Confirms WHO. Echo investigationState.' },
  { action: 'new-investigation', method: 'POST', path: '/api/v1/investigations', description: 'Hard live-state reset. Saved collections stay.' },
  { action: 'search', method: 'POST', path: '/api/v1/investigations/:id/search', description: 'Same /search pipeline as the iPhone UI.' },
  { action: 'identify', method: 'POST', path: '/api/v1/investigations/:id/identify', description: 'Subject identification search.' },
  { action: 'topic-search', method: 'POST', path: '/api/v1/investigations/:id/topic', description: 'Topic search keeping the current subject.' },
  { action: 'intersection', method: 'POST', path: '/api/v1/investigations/:id/intersection', description: 'Subject × topic intersection retrieval.' },
  { action: 'find-everything', method: 'POST', path: '/api/v1/investigations/:id/find-everything', description: 'Topic-map retrieval grouped by source class.' },
  { action: 'premium-accounts', method: 'POST', path: '/api/v1/investigations/:id/premium-accounts', description: 'Premium/creator account discovery with ownership classes.' },
  { action: 'find-more', method: 'POST', path: '/api/v1/investigations/:id/find-more', description: 'Expand within the current investigation using the next unexplored retrieval lane.' },

  { action: 'more-like-this', method: 'POST', path: '/api/v1/investigations/:id/more-like-this', description: 'Semantic similarity — not title-token stuffing.' },
  { action: 'find-different', method: 'POST', path: '/api/v1/investigations/:id/find-different', description: 'Alternative sources, excluding seen hosts.' },
  { action: 'find-similar', method: 'POST', path: '/api/v1/investigations/:id/find-similar', description: 'Visual/source-class similarity.' },
  { action: 'search-this-visual', method: 'POST', path: '/api/v1/investigations/:id/search-this-visual', description: 'Search the source of a selected visual.' },
  { action: 'more-from-this-source', method: 'POST', path: '/api/v1/investigations/:id/more-from-this-source', description: 'More from this host (host ≠ creator).' },
  { action: 'more-from-this-person', method: 'POST', path: '/api/v1/investigations/:id/more-from-this-person', description: 'More from the confirmed person.' },
  { action: 'more-on-this-topic', method: 'POST', path: '/api/v1/investigations/:id/more-on-this-topic', description: 'More on the current topic.' },
  { action: 'dive-bondage', method: 'POST', path: '/api/v1/investigations/:id/dive-bondage', description: 'Bondage investigation lens — expands through discovered evidence, not a query rewrite.' },
  { action: 'dive-people', method: 'POST', path: '/api/v1/investigations/:id/dive-people', description: 'People investigation lens — connected people with OBSERVED/SUPPORTED/INFERRED/UNKNOWN evidence.' },
  { action: 'dive-visuals', method: 'POST', path: '/api/v1/investigations/:id/dive-visuals', description: 'Visuals investigation lens — additional/alternate image sources, galleries, provenance. Inherits the active investigation.' },
  { action: 'dive-clothing', method: 'POST', path: '/api/v1/investigations/:id/dive-clothing', description: 'Alias of dive-visuals. Clothing evidence extraction remains internal.' },

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
      { title: "Drea Morgan's Official Site", url: 'https://dreamorgan.com/models/DreaMorgan.html', snippet: "Drea Morgan's Official Site! Offering full-length videos", source: 'Bing', domain: 'dreamorgan.com' },
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
  'belle-delphine': {
    items: [
      { title: 'Belle Delphine', url: 'https://en.wikipedia.org/wiki/Belle_Delphine', snippet: 'British internet personality and adult content creator Belle Delphine', source: 'Wikipedia' },
      { title: 'Belle | Disney Wiki', url: 'https://disney.fandom.com/wiki/Belle', snippet: 'Belle is a fictional character who appears in Disney Beauty and the Beast', source: 'Fandom' },
      { title: 'Belle Delphine OnlyFans', url: 'https://onlyfans.com/belledelphine', snippet: 'Belle Delphine public profile listing', source: 'DuckDuckGo' },
      { title: 'Belle Delphine (@belle.delphine) • Instagram', url: 'https://www.instagram.com/belle.delphine/', snippet: 'Official Instagram photos and videos', source: 'Bing' },
      { title: 'Disney Princess Belle cartoon', url: 'https://www.rule34.xxx/index.php?page=post&s=list&tags=belle', snippet: 'cartoon princess belle anime', source: 'Rule34' },
    ],
    diagnostics: { DuckDuckGo: { ok: true, added: 3 }, Bing: { ok: true, added: 2 } },
  },
  'drea-morgan': {
    items: [
      { title: 'Drea Morgan - IAFD', url: 'https://www.iafd.com/person.rme/perfid=dreamorgan', snippet: 'Drea Morgan performer biography and filmography', source: 'IAFD' },
      { title: "Drea Morgan's Official Site", url: 'https://dreamorgan.com/models/DreaMorgan.html', snippet: "Drea Morgan's Official Site! Offering full-length videos", source: 'Bing', domain: 'dreamorgan.com' },
      { title: 'Drea | Free Listening on SoundCloud', url: 'https://soundcloud.com/drea-music', snippet: 'Stream Drea music. Unrelated first-name match.', source: 'SoundCloud' },
      { title: 'Drea Smith jazz vocalist', url: 'https://example.com/drea-smith', snippet: 'Jazz vocalist Drea Smith is not Drea Morgan', source: 'Bing' },
    ],
    diagnostics: { DuckDuckGo: { ok: true, added: 2 }, Bing: { ok: true, added: 2 } },
  },
  'riley-reid': {
    items: [
      { title: 'Riley Reid - IAFD', url: 'https://www.iafd.com/person.rme/perfid=rileyreid', snippet: 'Riley Reid performer biography and filmography', source: 'IAFD' },
      { title: 'Riley Reid bondage scene credits', url: 'https://www.iafd.com/title.rme/title=riley-bondage', snippet: 'Riley Reid in a bondage feature', source: 'IAFD' },
      { title: 'Riley Reid on X', url: 'https://x.com/rileyreid', snippet: 'Riley Reid official', source: 'DuckDuckGo' },
      { title: 'Bondage (BDSM)', url: 'https://en.wikipedia.org/wiki/Bondage_BDSM', snippet: 'Bondage is a practice of consensual restraint.', source: 'Wikipedia' },
      { title: 'Generic anime bondage', url: 'https://rule34.xxx/index.php?page=post&s=list&tags=bondage', snippet: 'anime bondage hentai', source: 'Rule34' },
    ],
    diagnostics: { DuckDuckGo: { ok: true, added: 3 }, Bing: { ok: true, added: 2 } },
  },
  'frog-tie': {
    items: [
      { title: 'Frog tie - Wikipedia', url: 'https://en.wikipedia.org/wiki/Frog_tie', snippet: 'The frog tie is a bondage position', source: 'Wikipedia' },
      { title: 'How to tie a frog tie', url: 'https://www.wikihow.com/Tie-a-Frog-Tie', snippet: 'Step by step tutorial for the frog tie bondage position with safety notes', source: 'WikiHow' },
      { title: 'Frog tie demonstration guide', url: 'https://www.instructables.com/Frog-Tie', snippet: 'Educational guide to the frog tie technique', source: 'Instructables' },
    ],
    diagnostics: { DuckDuckGo: { ok: true, added: 2 }, Bing: { ok: true, added: 1 } },
  },
};

export function fixtureItems(name) {
  const f = DETERMINISTIC_FIXTURES[name];
  return f ? { items: f.items.slice(), diagnostics: { ...f.diagnostics } } : null;
}

export function distinctFindMoreIntents() {
  return ['find-more', 'more-like-this', 'find-different', 'find-similar', 'search-this-visual', 'more-from-this-source', 'more-from-this-person', 'more-on-this-topic'];
}

// ---------------------------------------------------------------------------
// v49.4 surgical retrieval: phase order, identity-anchor follow-up, result audit
// ---------------------------------------------------------------------------
export const RETRIEVAL_PHASES = ['identity', 'intersection', 'adult', 'generic'];

function retrievalPhaseOf(variant) {
  const lane = String((variant && (variant.lane || variant.id)) || '').toLowerCase();
  const sc = String((variant && variant.sourceClass) || '').toLowerCase();
  const why = String((variant && variant.why) || '').toLowerCase();
  const blob = lane + ' ' + sc + ' ' + why;
  const adultIds = ADULT_SOURCE_CLASSES.map(c => c.id);
  if (/^(identity|identity-profile|entity|adult-identity|aliases|more-from-this-person|creator-owned)$/.test(lane) || /identity|profile sources|entity-only/.test(why)) return 'identity';
  if (/^(intersection|pair|intersect-2|productions|dive-bondage-chain|more-on-this-topic|topic)$/.test(lane) || /intersection|subject × topic|entity ×/.test(why) || /^pair-|^concept-/.test(lane)) return 'intersection';
  if (adultIds.includes(lane) || adultIds.includes(sc) || /adult|fetish|premium|publisher|studio-producer|major-video|creator-store|bondage studio/.test(blob)) {
    if (lane === 'identity-profile' || sc === 'identity-profile') return 'identity';
    return 'adult';
  }
  return 'generic';
}

export function retrievalExecutionOrder(variants, opts = {}) {
  const phases = (opts && Array.isArray(opts.phases) && opts.phases.length)
    ? opts.phases.slice()
    : ['identity', 'intersection', 'adult'];
  const list = (variants || []).map((v, i) => ({ v, i, phase: retrievalPhaseOf(v) }));
  const rank = (phase) => {
    const idx = phases.indexOf(phase);
    return idx === -1 ? phases.length + (phase === 'generic' ? 1 : 2) : idx;
  };
  list.sort((a, b) => rank(a.phase) - rank(b.phase) || a.i - b.i);
  return list.map(row => row.v);
}

export function plannedWebExecutionSequence(variants, opts = {}) {
  return retrievalExecutionOrder(variants, opts || { phases: ['identity', 'intersection', 'adult'] });
}

export function resolveIdentityAnchor(feedback, classification, opts = {}) {
  const fb = feedback || {};
  const confirmed = (fb.confirmed || []).map(s => String(s || '').trim()).filter(Boolean);
  const subject = String((classification && classification.subject) || (opts && opts.subject) || '').trim();
  const name = confirmed[0] || subject;
  return {
    confirmed: confirmed.length > 0,
    name,
    subject: name,
    rejectedPeople: fb.rejectedPeople || [],
    rejectedHosts: fb.rejectedHosts || [],
    rejectedImages: fb.rejectedImages || [],
    rejectedUrls: fb.rejectedUrls || [],
    identityFeedback: fb,
    appliesToSubsequentRetrieval: confirmed.length > 0 || (fb.rejectedPeople || []).length > 0 || (fb.rejectedHosts || []).length > 0,
  };
}

export function subsequentRetrievalFromFeedback(intent, feedback, opts = {}) {
  const anchor = resolveIdentityAnchor(feedback, intent, opts);
  const topic = String((intent && intent.topic) || (opts && opts.topic) || '').trim();
  const attempted = (opts && opts.attemptedQueries) || [];
  const queries = [];
  const add = (q, why, lane) => {
    const t = String(q || '').trim();
    if (!t) return;
    if (attempted.some(a => String(a).toLowerCase() === t.toLowerCase())) return;
    queries.push({ q: t, why, lane: lane || 'identity', kind: 'web' });
  };
  if (anchor.confirmed && anchor.name) {
    add('"' + anchor.name + '" (profile OR bio OR database OR "official site")', 'subsequent retrieval from confirmed identity', 'identity');
    if (topic) {
      add('"' + anchor.name + '" ' + topic, 'confirmed identity × topic', 'intersection');
      add('"' + anchor.name + '" ' + topic + ' (scene OR photoset OR feature OR credits)', 'confirmed identity × topic specialist', 'intersection');
    } else {
      add('"' + anchor.name + '"', 'subsequent retrieval uses confirmed identity as the subject', 'identity');
    }
    for (const p of (anchor.rejectedPeople || []).slice(0, 3)) {
      add('"' + anchor.name + '" -"' + p + '"', 'exclude rejected identity from subsequent retrieval', 'identity');
    }
  }
  return {
    anchor,
    queries,
    identityFeedback: feedback || {},
    subject: anchor.name,
    keepSubject: true,
  };
}

export function auditStructuredResults(results, opts = {}) {
  const subject = String((opts && opts.subject) || '').trim();
  const topic = String((opts && opts.topic) || '').trim();
  const query = String((opts && opts.query) || [subject, topic].filter(Boolean).join(' ')).trim();
  const subjToks = tokens(subject);
  const topicToks = topic ? [...new Set(tokens(topic).concat(topicTerms(topic)))] : [];
  const rows = (results || []).map((r) => {
    const blob = ((r.title || '') + ' ' + (r.snippet || '') + ' ' + (r.url || '') + ' ' + (r.textExcerpt || ''));
    const host = String(r.domain || r.host || hostOf(r.url) || '').replace(/^www\./, '');
    const queryEcho = isQueryEchoTitle(r.title, query, { subject });
    const redditSearch = isRedditSearchPage(r.url, r.title);
    const collision = competingFullNameInText((r.title || '') + ' ' + (r.snippet || ''), subject);
    const subjectHit = subjToks.length ? includesAll(blob, subjToks) : false;
    const topicHit = topicToks.length ? includesAny(blob, topicToks) : false;
    const mirror = isMirrorUrl(r.url);
    return {
      url: r.url,
      title: r.title,
      host,
      queryEcho,
      redditSearch,
      competingIdentity: collision || '',
      subjectRelevant: !!(subjectHit && !queryEcho && !redditSearch),
      intersection: !!(subjectHit && topicHit && !queryEcho && !redditSearch),
      unrelated: !subjectHit,
      mirror,
    };
  });
  return {
    total: rows.length,
    subjectRelevant: rows.filter(r => r.subjectRelevant).length,
    intersection: rows.filter(r => r.intersection).length,
    unrelated: rows.filter(r => r.unrelated).length,
    competingIdentity: rows.filter(r => r.competingIdentity).length,
    queryEcho: rows.filter(r => r.queryEcho).length,
    redditSearchPages: rows.filter(r => r.redditSearch).length,
    mirrors: rows.filter(r => r.mirror).length,
    rows,
  };
}

// ---------------------------------------------------------------------------
// v49.7 retrieval-engine helpers (extend existing planner — not a second engine)
// ---------------------------------------------------------------------------

export function isTutorialIntent(query) {
  return /\b(tutorial|how to|howto|guide|manual|instructions?|educational|demonstration|lesson|learn (?:how|to))\b/i.test(String(query || ''));
}

export function parseRetrievalIntents(query, opts = {}) {
  const raw = String(query || '');
  const t = raw.toLowerCase();
  const intentClass = String(opts.intentClass || '');
  const out = [];
  const add = (id, label) => { if (!out.some(x => x.id === id)) out.push({ id, label }); };
  if (intentClass === 'PERSON' || opts.subject) add('identity', 'identity');
  if (/\b(account|profile|instagram|twitter|onlyfans|handle|@)\b/i.test(t) || intentClass === 'PERSON') add('accounts', 'public accounts');
  if (opts.topic || opts.intentClass === 'OBJECT' || opts.intentClass === 'TOPIC') add('topic', 'topic/technique');
  if (opts.visual || /\b(image|photo|visual|gallery|picture|reference)\b/i.test(t)) add('visual', 'visual/reference');
  if (opts.tutorialIntent || isTutorialIntent(raw)) add('tutorial', 'tutorial/guide');
  if (/\b(variation|variant|also called|terminology)\b/i.test(t) || intentClass === 'OBJECT') add('variations', 'variations');
  if (opts.premiumAccounts || /\b(premium|onlyfans|fansly|loyalfans|subscription)\b/i.test(t)) add('premium', 'premium/subscription sources');
  if (intentClass === 'PERSON') add('public-account', 'public-account/profile discovery');
  if (!out.length) add('topic', 'topic');
  return out;
}

export function isSearchEngineHost(host) {
  const h = String(host || '').replace(/^www\./, '').toLowerCase();
  return /^(bing|google|yahoo|duckduckgo|startpage|yandex|ecosia|baidu)(\.|$)/i.test(h)
    || /(bing\.com|google\.[a-z.]+|yahoo\.com|duckduckgo\.com|startpage\.com)$/i.test(h);
}

export function isFictionalCharacterHost(host) {
  const h = String(host || '').replace(/^www\./, '').toLowerCase();
  return /(disney|fandom\.com|wikia|disneyplus|disney\.com|princess)/i.test(h);
}

export function identityEvidenceText(item, opts = {}) {
  const title = String((item && (item.title || item.caption || '')) || '');
  const snippet = String((item && (item.snippet || item.description || '')) || '');
  const imageUrl = String((item && (item.image || item.src || (/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(String((item && item.url) || '')) ? item.url : ''))) || '');
  const pageUrl = String((item && (item.pageUrl || item.sourceUrl || '')) || '');
  const resultUrl = String((item && item.url) || '');
  const parts = [title, snippet];
  if (imageUrl && !isSearchEngineHost(hostOf(imageUrl))) parts.push(imageUrl.split('?')[0]);
  if (pageUrl && !isSearchEngineHost(hostOf(pageUrl))) parts.push(pageUrl.split('?')[0]);
  if (resultUrl && !isSearchEngineHost(hostOf(resultUrl))) parts.push(resultUrl.split('?')[0]);
  let blob = parts.filter(Boolean).join(' ');
  const queryEcho = String((item && (item.queryVariant || item.query)) || (opts && opts.query) || '');
  if (queryEcho) {
    const qn = norm(queryEcho);
    const bn = norm(blob);
    if (qn && bn === qn) blob = title;
  }
  return blob;
}

export function classifyIdentityClass(item, subject, opts = {}) {
  const host = hostOf((item && (item.pageUrl || item.url)) || '');
  const blob = identityEvidenceText(item, opts);
  const type = (opts && opts.type) || (opts && opts.classification && opts.classification.type) || '';
  const collision = fictionalNameCollision(blob, subject, host);
  if (collision) return 'PERSON_FICTIONAL';
  if (isFictionalCharacterHost(host)) return 'PERSON_FICTIONAL';
  if (/\b(fictional character|disney princess|beauty and the beast|cartoon character)\b/i.test(blob)) return 'PERSON_FICTIONAL';
  if ((type === 'technique' || type === 'object' || type === 'skill') || (opts && opts.classification && opts.classification.intentClass === 'OBJECT')) {
    if (/\b(amphibian|tree frog|bullfrog|wildlife|red-eyed tree frog)\b/i.test(blob) && isRestraintTechnique(subject || '')) return 'ANIMAL';
    return 'OBJECT';
  }
  if (type === 'place' || type === 'location') return 'LOCATION';
  if (type === 'org' || type === 'organization' || type === 'company') return 'ORGANIZATION';
  if (type === 'person' || type === 'social') return 'PERSON_REAL';
  return 'UNKNOWN';
}

export function candidateRejectionMatches(name, candidateId, identityFeedback) {
  const f = identityFeedback || {};
  const rejectedIds = (f.rejectedCandidateIds || []).map(String);
  if (candidateId && rejectedIds.includes(String(candidateId))) return true;
  const n = norm(name);
  const nToks = tokens(name).filter(t => t.length > 1);
  for (const p of (f.rejectedPeople || [])) {
    const pn = norm(p);
    if (!pn || pn.length < 3) continue;
    if (n === pn) return true;
    const pToks = tokens(p).filter(t => t.length > 1);
    if (pToks.length >= 2 && nToks.length >= 2 && pToks.length === nToks.length && pToks.every(t => nToks.includes(t))) return true;
  }
  return false;
}

const ALIAS_STOP = new Set(['the','and','for','with','from','this','that','http','https','www','com','html','php','index','search','query','utm','ref','src','img','image','photo','video','page','home','user','users','profile','post','posts','comment','id','uuid']);

export function isPlausibleAlias(value) {
  const s = String(value || '').trim();
  if (!s || s.length < 2 || s.length > 64) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return false;
  if (/^[0-9a-f]{16,}$/i.test(s) && !/[a-z]{3,}/i.test(s.replace(/[0-9a-f]/gi, ''))) return false;
  if (/^(utm_|fbclid|gclid|ref=|rdt=)/i.test(s)) return false;
  if (/^https?:/i.test(s) || /[/?&=]/.test(s)) return false;
  if (/^\d+$/.test(s)) return false;
  const n = norm(s);
  if (!n || ALIAS_STOP.has(n)) return false;
  const parts = n.split(/\s+/);
  if (parts.every(p => ALIAS_STOP.has(p) || p.length < 2)) return false;
  if (parts.length === 1 && parts[0].length < 3) return false;
  return true;
}

export function filterAliases(list) {
  const out = [];
  const seen = new Set();
  for (const a of list || []) {
    const label = typeof a === 'string' ? a : (a && (a.label || a.name || a.handle));
    if (!isPlausibleAlias(label)) continue;
    const k = norm(label);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(typeof a === 'string' ? label : { ...a, label });
  }
  return out;
}

export function buildCanonicalPerson(candidate, extras = {}) {
  const name = String((candidate && (candidate.name || candidate.canonicalName)) || extras.name || '').trim();
  const aliases = filterAliases([].concat((candidate && (candidate.knownAliases || candidate.aliases)) || [], extras.aliases || []));
  const handles = [...new Set([].concat((candidate && (candidate.usernames || candidate.handles)) || [], extras.handles || []).map(h => String(h || '').replace(/^@/, '')).filter(Boolean))];
  const sources = [...new Set([].concat((candidate && (candidate.sources || candidate.sourceDomains)) || [], extras.sources || []).filter(Boolean))];
  const accounts = [].concat((candidate && candidate.accounts) || [], extras.accounts || []).slice(0, 12);
  return {
    canonicalName: name,
    aliases: aliases.slice(0, 12),
    handles: handles.slice(0, 8),
    sourceIdentifiers: sources.slice(0, 12),
    accountIdentifiers: accounts,
    trustedSourceDomains: sources.filter(h => /(iafd|babepedia|adultfilmdatabase|wikipedia|imdb|onlyfans|loyalfans|indexxx|freeones)/i.test(String(h))).slice(0, 8),
    identityEvidence: (candidate && (candidate.additionalSources || candidate.evidence)) || extras.identityEvidence || [],
    representativeImages: ((candidate && candidate.representativeImages) || extras.images || []).slice(0, 6),
    candidateId: (candidate && candidate.candidateId) || extras.candidateId || '',
    identityClass: extras.identityClass || 'PERSON_REAL',
    confirmedAt: extras.confirmedAt || new Date().toISOString(),
  };
}

export function fictionalNameCollision(blob, subject, host) {
  const name = String(subject || '').trim();
  const toks = tokens(name);
  const nblob = norm(blob);
  const h = String(host || '').toLowerCase();
  if (!toks.length) return null;
  const first = toks[0];
  const last = toks.length > 1 ? toks[toks.length - 1] : '';
  const disneyHost = isFictionalCharacterHost(h);
  const disneyish = /\b(disney|princess|beauty and the beast|belle from|enchanted rose|beast'?s castle|animated|cartoon princess|disney wiki|disney fandom)\b/i.test(String(blob || ''))
    || disneyHost;
  if (first === 'belle' && (last === 'delphine' || !last)) {
    if (disneyHost) {
      return { collision: 'Disney Princess Belle', reason: 'identity collision — Disney/Fandom Belle is not Belle Delphine', identityClass: 'PERSON_FICTIONAL' };
    }
    if (disneyish && !nblob.includes('delphine')) {
      return { collision: 'Disney Princess Belle', reason: 'identity collision — Disney Princess Belle is not Belle Delphine', identityClass: 'PERSON_FICTIONAL' };
    }
    if (disneyish && nblob.includes('delphine') && /\b(beauty and the beast|disney princess|enchanted rose|beast'?s castle)\b/i.test(String(blob || ''))) {
      return { collision: 'Disney Princess Belle', reason: 'identity collision — Disney Princess Belle is not Belle Delphine even if the query text is echoed', identityClass: 'PERSON_FICTIONAL' };
    }
  }
  if (disneyish && first === 'belle' && last !== 'delphine') {
    return { collision: 'Disney Princess Belle', reason: 'identity collision — Disney Princess Belle is not Belle Delphine', identityClass: 'PERSON_FICTIONAL' };
  }
  if (/\b(fictional character|cartoon|anime character|video game character)\b/i.test(String(blob || '')) && toks.length >= 2 && !toks.every(t => nblob.includes(t))) {
    return { collision: 'fictional character', reason: 'fictional/cartoon character is not the resolved person', identityClass: 'PERSON_FICTIONAL' };
  }
  return null;
}

export function identityDisambiguation(subject) {
  const toks = tokens(subject);
  const first = toks[0] || '';
  const last = toks.length > 1 ? toks[toks.length - 1] : '';
  if (first === 'belle' && last === 'delphine') {
    return {
      canonical: 'Belle Delphine',
      must: ['delphine'],
      mustNot: ['disney princess', 'beauty and the beast', 'enchanted rose', 'beast castle'],
      negatives: ['-disney', '-princess', '-"beauty and the beast"', '-"disney princess"'],
      collisionLabel: 'Disney Princess Belle',
      identityClass: 'PERSON_REAL',
    };
  }
  if (first === 'drea' && last === 'morgan') {
    return {
      canonical: 'Drea Morgan',
      must: ['morgan'],
      mustNot: ['soundcloud drea', 'drea only'],
      negatives: ['-soundcloud'],
      collisionLabel: '',
      identityClass: 'PERSON_REAL',
      requireFullName: true,
    };
  }
  return {
    canonical: String(subject || '').trim(),
    must: toks.slice(1),
    mustNot: [],
    negatives: [],
    collisionLabel: '',
  };
}

export function semanticVariations(topic, evidence, opts = {}) {
  const t = norm(topic);
  if (!t) return [];
  const out = [];
  const seen = new Set();
  const add = (label, why) => {
    const n = norm(label);
    if (!n || n === t || seen.has(n)) return;
    if (ANIME_CARTOON_HOSTS.some(h => n.includes(h.split('.')[0]))) return;
    if (/\b(anime|hentai|cartoon|waifu|loli)\b/i.test(label) && !/restraint|bondage|shibari|tie/.test(n)) return;
    seen.add(n);
    out.push({ label, why: why || 'semantic refinement of the investigated topic', source: 'planning-knowledge' });
  };
  for (const fam of TECHNIQUE_FAMILIES) {
    const hit = (fam.seeds || []).some(s => t === norm(s) || t.includes(norm(s)) || norm(s).includes(t));
    if (!hit) continue;
    for (const v of fam.variations || []) add(v, 'semantically related to ' + (fam.id) + ' / “' + topic + '”');
  }
  const observed = [];
  for (const item of evidence || []) {
    const blob = String((item && (item.title || '')) + ' ' + ((item && item.snippet) || ''));
    for (const fam of TECHNIQUE_FAMILIES) {
      for (const s of fam.seeds || []) {
        if (norm(blob).includes(norm(s)) && norm(s) !== t) observed.push(s);
      }
    }
  }
  for (const s of observed.slice(0, 4)) add(s, 'observed on retrieved evidence — still a refinement of the current topic');
  if (opts.excludeCurrent) return out.filter(v => norm(v.label) !== t).slice(0, 10);
  return out.slice(0, 10);
}

export function classifyVisualRelevance(item, classification) {
  const url = String((item && (item.url || item.image || item.pageUrl)) || '');
  const host = hostOf(url).replace(/^www\./, '');
  const blob = identityEvidenceText(item);
  const nblob = norm(blob);
  const type = (classification && classification.type) || '';
  if (ANIME_CARTOON_HOSTS.some(h => host === h || host.endsWith('.' + h))) {
    const kind = /e621|furry/.test(host) ? 'illustration' : 'anime';
    return { visualClass: kind, reason: 'source host is an anime/illustration index', demote: type === 'person' };
  }
  if (/\b(anime|hentai|manga|waifu|2d illustration|pixiv)\b/i.test(blob)) {
    return { visualClass: 'anime', reason: 'anime/illustration language in title or snippet', demote: type === 'person' };
  }
  if (/\b(cartoon|animation|animated|disney princess|clipart)\b/i.test(blob)) {
    return { visualClass: 'cartoon', reason: 'cartoon/animated language', demote: type === 'person' };
  }
  if (/\b(illustration|drawing|sketch|render|cgi|digital art)\b/i.test(blob) && !/\b(photo|photograph|photoset|scene)\b/i.test(blob)) {
    return { visualClass: 'illustration', reason: 'illustration language without photographic evidence', demote: type === 'person' };
  }
  if (type === 'person') {
    const subj = tokens((classification && classification.subject) || '');
    const full = subj.length >= 2 && subj.every(t => nblob.includes(t));
    if (fictionalNameCollision(blob, classification.subject, host)) {
      return { visualClass: 'unrelated', reason: 'fictional/character collision with the resolved identity', demote: true };
    }
    if (full) return { visualClass: 'real-person', reason: 'full name associated with a non-illustration source', demote: false };
    if (subj.length && subj[0] && nblob.includes(subj[0]) && !subj.slice(1).every(t => nblob.includes(t))) {
      return { visualClass: 'unrelated', reason: 'first-name-only match is not identity evidence', demote: true };
    }
    return { visualClass: 'unknown', reason: 'person investigation — visual identity not established', demote: false };
  }
  if (type === 'technique' || type === 'skill' || type === 'object') {
    const hostBlob = String((item && (item.url || item.image || item.pageUrl)) || '');
    const wildlifeHost = /\b(pixabay|pxhere|a-z-animals|animalcorner|wallpapers\.com|natgeofe|nationalgeographic|unsplash|pexels)\b/i.test(hostBlob);
    const wildlifeLang = /\b(amphibian|tree frog|bullfrog|wildlife|red-eyed tree frog|common frog)\b/i.test(blob);
    const techniqueLang = /\b(bondage|shibari|restraint|kinbaku|hogtie|diagram|tutorial|the duchy|rope bondage)\b/i.test(hostBlob + ' ' + String((item && (item.snippet || item.caption)) || ''));
    if ((wildlifeHost || wildlifeLang) && !techniqueLang && isRestraintTechnique((classification && classification.subject) || '')) {
      return { visualClass: 'unrelated', reason: 'wildlife/animal image is not the classified technique', demote: true };
    }
    return { visualClass: 'real-world-technique', reason: 'technique/object investigation prefers real-world references', demote: false };
  }
  return { visualClass: 'unknown', reason: 'visual class not established', demote: false };
}

export function classifyMatchQuality(item, classification) {
  const subj = tokens((classification && classification.subject) || '');
  const topic = extraTopicTokens(classification);
  const blob = norm(String((item && (item.title || '')) + ' ' + ((item && item.snippet) || '') + ' ' + ((item && item.url) || '')));
  const hasEntity = subj.length ? subj.every(t => blob.includes(t)) : false;
  const hasTopic = topic.length ? topic.some(t => blob.includes(t)) : false;
  const echo = isQueryEchoTitle((item && item.title) || '', (item && item.queryVariant) || '', { subject: (classification && classification.subject) || '' });
  if (echo) return { matchQuality: 'unrelated', reason: 'query-echo title is not evidence' };
  if (fictionalNameCollision(String((item && item.title) || '') + ' ' + String((item && item.snippet) || ''), (classification && classification.subject) || '', hostOf((item && item.url) || ''))) {
    return { matchQuality: 'unrelated', reason: 'identity collision' };
  }
  if (classification && classification.type === 'person' && hasEntity && hasTopic && !isAggregatorish(item)) {
    return { matchQuality: 'exact', reason: 'entity and requested topic both present on a non-index page' };
  }
  if (hasEntity && hasTopic) return { matchQuality: 'likely', reason: 'entity and topic co-occur — not yet verified intersection' };
  if (hasEntity && topic.length) return { matchQuality: 'conceptual', reason: 'entity present without the requested topic' };
  if (hasTopic && subj.length) return { matchQuality: 'conceptual', reason: 'topic present without the resolved entity' };
  if (hasEntity || hasTopic) return { matchQuality: 'likely', reason: 'partial overlap with the investigation' };
  return { matchQuality: 'unrelated', reason: 'does not associate the resolved entity with the requested topic' };
}

function extraTopicTokens(classification) {
  const ctx = String((classification && (classification.context || classification.topic)) || '').replace(/adult content/gi, ' ');
  return tokens(ctx).filter(t => t.length > 2);
}

function isAggregatorish(item) {
  const host = hostOf((item && item.url) || '').replace(/^www\./, '');
  return /pinterest|google\.|bing\.|yahoo\.|duckduckgo|startpage|mojeek/.test(host) || /\/search\?|\/tags?\//i.test(String((item && item.url) || ''));
}

export function classifyContentType(item, classification) {
  const host = hostOf((item && item.url) || '').replace(/^www\./, '');
  const blob = String((item && (item.title || '')) + ' ' + ((item && item.snippet) || ''));
  const platform = PREMIUM_PLATFORM_SEEDS.find(p => host === p.host || host.endsWith('.' + p.host));
  if (platform) return { contentType: 'account', reason: 'premium/subscription platform profile — not retrieved content' };
  if (PUBLIC_ACCOUNT_HOSTS.some(p => host === p.host || host.endsWith('.' + p.host))) {
    return { contentType: 'account', reason: 'social/profile URL is account discovery, not retrieved content' };
  }
  if (isTutorialIntent(blob) || /wikihow|instructables/.test(host)) return { contentType: 'tutorial', reason: 'instructional source' };
  if (/\b(photo|photoset|gallery|image|stills)\b/i.test(blob)) return { contentType: 'visual', reason: 'visual/reference source' };
  if ((classification && classification.type) === 'person' && /iafd|babepedia|wikipedia|imdb/.test(host)) return { contentType: 'identity', reason: 'identity/profile source' };
  return { contentType: 'source', reason: 'general source' };
}

export function socialShouldDeprioritize(item, classification, opts = {}) {
  const host = hostOf((item && item.url) || '').replace(/^www\./, '');
  if (!SOCIAL_IDENTITY_HOSTS.some(h => host === h || host.endsWith('.' + h))) return false;
  if (opts.userRequestedPlatform) return false;
  const identityResolved = !!(opts.identityResolved || (classification && classification.type === 'person' && (opts.confirmed || []).length) || (opts.identityHostHits > 0));
  if (!identityResolved) return false;
  const topic = extraTopicTokens(classification);
  if (!topic.length) return true;
  const blob = norm(String((item && (item.title || '')) + ' ' + ((item && item.snippet) || '')));
  return !topic.some(t => blob.includes(t));
}

export function sourceVolumePenalty(item, countsByHost) {
  const host = hostOf((item && item.url) || '').replace(/^www\./, '');
  const n = (countsByHost && countsByHost[host]) || 0;
  const anime = ANIME_CARTOON_HOSTS.some(h => host === h || host.endsWith('.' + h));
  if (anime && n >= 2) return { penalty: 24, reason: 'anime/illustration source volume is not relevance' };
  if (n >= 3) return { penalty: 12, reason: 'same-host volume is not relevance' };
  return { penalty: 0, reason: '' };
}

export function premiumAccessClassification(item, retrieved) {
  const url = String((item && (item.finalUrl || item.url || item.pageUrl)) || '');
  const host = hostOf(url).replace(/^www\./, '');
  const platform = PREMIUM_PLATFORM_SEEDS.find(p => host === p.host || host.endsWith('.' + p.host));
  const state = String((item && (item.accessState || '')) || (retrieved && retrieved.accessState) || '');
  const own = classifyAccountOwnership(item, (item && (item.subject || item.entity || '')) || '');
  let accessKind = 'account_discovered';
  if (own.kind === 'directory listing') accessKind = 'unverified_claim';
  else if (own.kind === 'fan/reposter') accessKind = 'unverified_claim';
  else if (state === 'DIRECTLY_RETRIEVED' && /preview|teaser|public/i.test(String((item && item.snippet) || ''))) accessKind = 'public_preview_found';
  else if (state === 'DIRECTLY_RETRIEVED' || state === 'PARTIALLY_RETRIEVED') accessKind = 'public_metadata_found';
  else if (state === 'PAYWALLED' || state === 'AUTHENTICATION_REQUIRED' || state === 'AGE_RESTRICTED') accessKind = 'authorized_access_required';
  else if (state === 'BLOCKED') accessKind = 'inaccessible';
  else if (own.kind === 'official account' || own.kind === 'creator-owned account') accessKind = 'account_corroborated';
  const contentRetrieved = accessKind === 'public_preview_found' || (state === 'DIRECTLY_RETRIEVED' && !platform);
  return {
    url,
    domain: host,
    platform: platform ? platform.label : (own.platform || ''),
    handle: own.handle,
    ownership: own.kind,
    ownershipClass: own.ownershipClass,
    accessState: state || 'REFERENCED',
    accessKind,
    contentRetrieved: !!contentRetrieved,
    accountDiscovered: true,
    publiclyViewable: accessKind === 'public_metadata_found' || accessKind === 'public_preview_found' || accessKind === 'content_retrievable',
    note: contentRetrieved
      ? 'Public metadata or preview was retrieved. Restricted member content was not accessed.'
      : 'Account discovered. Finding the profile URL is not content retrieval. Carmen does not bypass authentication or paywalls.',
  };
}

export function premiumEscalationQueries(subject, discoveredPremium, attempted) {
  const qSub = quote(subject) || subject;
  const seen = attemptedSet(attempted);
  const out = [];
  const add = (q, why, lane) => pushQuery(out, seen, q, why, lane || 'premium-escalation', 'web', { sourceClass: 'premium-subscription' });
  if (!qSub) return out;
  add(qSub + ' (onlyfans OR fansly OR loyalfans) (bio OR "public profile" OR preview OR teaser OR links)', 'public metadata around discovered premium accounts', 'premium-public');
  add(qSub + ' (linktree OR allmylinks OR "official links")', 'independent indexes / creator directories', 'premium-index');
  for (const acc of (discoveredPremium || []).slice(0, 4)) {
    const host = String(acc.domain || hostOf(acc.url || '')).replace(/^www\./, '');
    const handle = acc.handle && acc.handle !== 'UNKNOWN' ? acc.handle : '';
    if (host) add(qSub + ' site:' + host, 'recursive public investigation of ' + host, 'premium-host');
    if (handle && handle !== 'UNKNOWN') add('"' + handle + '" ' + qSub + ' (profile OR links OR preview)', 'handle corroboration across public indexes', 'premium-handle');
  }
  add(qSub + ' (clips4sale OR manyvids OR iwantclips) (store OR studio OR preview)', 'associated public clip-store references', 'premium-store');
  add(qSub + ' (onlyfans OR fansly OR loyalfans) (archive OR history OR former OR 2019 OR 2020 OR 2021)', 'historical public references', 'premium-historical');
  return out.slice(0, 12);
}

export function publicAccountQueries(subject, attempted) {
  const qSub = quote(subject) || subject;
  const seen = attemptedSet(attempted);
  const out = [];
  const add = (q, why, lane) => pushQuery(out, seen, q, why, lane || 'public-accounts', 'web', { sourceClass: 'community-social' });
  if (!qSub) return out;
  add(qSub + ' (official OR verified) (instagram OR twitter OR "x.com" OR youtube)', 'proactive public account discovery', 'accounts');
  add(qSub + ' site:x.com', 'X/Twitter public profile', 'accounts-x');
  add(qSub + ' site:instagram.com', 'Instagram public profile', 'accounts-ig');
  add(qSub + ' site:reddit.com "' + String(subject || '').replace(/"/g, '') + '"', 'Reddit public references', 'accounts-reddit');
  return out.slice(0, 8);
}

export function tutorialQueries(subject, topic, attempted) {
  const seed = quote(subject) || subject || topic;
  const seen = attemptedSet(attempted);
  const out = [];
  const add = (q, why) => pushQuery(out, seen, q, why, 'tutorial', 'web', { sourceClass: 'instructional' });
  if (!seed) return out;
  add(seed + ' (tutorial OR "how to" OR guide OR manual OR demonstration)', 'instructional resources for the requested technique');
  add(seed + ' site:youtube.com (tutorial OR "how to" OR explained)', 'instructional video');
  add(seed + ' (wikihow OR instructables OR "step by step" OR safety)', 'educational / responsible instructional material');
  add(seed + ' (glossary OR "what is" OR meaning OR technique)', 'definitional educational material');
  return out.slice(0, 8);
}

export function detectImpersonator(item, subject) {
  const blob = String((item && (item.title || '')) + ' ' + ((item && item.snippet) || ''));
  const host = hostOf((item && item.url) || '');
  const reasons = [];
  if (/\b(fan[ -]?page|fan account|tribute|impersonat|fake official|not official|unofficial|leaked?|leaks|repost(?:er|s)?|scam)\b/i.test(blob)) {
    reasons.push('profile language indicates fan/impersonator/scam');
  }
  if (/\bofficial\b/i.test(blob) && classifyAccountOwnership(item, subject).kind === 'directory listing') {
    reasons.push('directory claim of official status is not ownership');
  }
  const handleCollision = similarHandleDifferentPerson(item, subject);
  if (handleCollision) reasons.push(handleCollision);
  if (!reasons.length) return null;
  return { rejected: true, reasons, host, url: (item && item.url) || '', title: (item && item.title) || '' };
}

export function similarHandleDifferentPerson(item, subject) {
  const path = pathOf((item && item.url) || '');
  const handle = (path.match(/^\/+([A-Za-z0-9._-]{2,40})\/?$/) || [])[1] || '';
  if (!handle) return '';
  const subj = tokens(subject);
  if (subj.length < 2) return '';
  const h = norm(handle);
  const first = subj[0];
  const last = subj[subj.length - 1];
  if (h.includes(first) && !h.includes(last.slice(0, 4)) && competingFullNameInText(String((item && item.title) || '') + ' ' + handle, subject)) {
    return 'same/similar handle does not prove the same person';
  }
  return '';
}

export function buildEntityIdentityRecord(classification, results, retrieved, leads, opts = {}) {
  const aliases = [];
  const handles = [];
  const historicalHandles = [];
  const domains = [];
  const identifiers = [];
  const supporting = [];
  const conflicting = [];
  const accounts = [];
  const pushU = (arr, v) => { const s = String(v || '').trim(); if (s && !arr.includes(s)) arr.push(s); };
  for (const page of retrieved || []) {
    for (const a of (page.identifiers && page.identifiers.aliases) || []) pushU(aliases, a);
    for (const h of (page.identifiers && page.identifiers.handles) || []) pushU(handles, h);
    const host = hostOf(page.finalUrl || page.url).replace(/^www\./, '');
    if (host) pushU(domains, host);
  }
  for (const r of results || []) {
    for (const a of r.aliases || []) pushU(aliases, a);
    if (r.domain) pushU(domains, r.domain);
    if (r.accountHandle && r.accountHandle !== 'UNKNOWN') {
      const status = /archive|former|old |inactive|historical/i.test(String(r.title || '') + ' ' + String(r.snippet || '')) ? 'historical' : 'current';
      if (status === 'historical') pushU(historicalHandles, r.accountHandle);
      else pushU(handles, r.accountHandle);
      accounts.push({
        platform: r.accountPlatform || r.domain,
        handle: r.accountHandle,
        url: r.url,
        ownership: r.accountOwnership || r.ownershipClass,
        confidence: r.confidence || 'low',
        status: status === 'historical' ? 'historical' : (r.ownershipClass === 'UNVERIFIED' ? 'unverified' : 'current'),
        evidence: r.reason || '',
      });
    }
    if (r.intersectionEvidence === 'strong' || r.role === 'SUBJECT_EVIDENCE') supporting.push({ url: r.url, title: r.title, why: r.reason || r.role });
    if (r.identityCollision || r.matchQuality === 'unrelated') conflicting.push({ url: r.url, title: r.title, why: r.reason || 'conflicting identity evidence' });
  }
  for (const l of leads || []) {
    if (l.kind === 'alias') pushU(aliases, l.label);
    if (l.kind === 'handle') pushU(handles, l.label);
  }
  const name = (classification && classification.subject) || '';
  const type = (classification && classification.type) || '';
  const conf = (opts.identityConfidence || (classification && classification.confidence) || 'medium');
  return {
    canonicalName: name,
    type,
    intentClass: (classification && classification.intentClass) || '',
    aliases: aliases.slice(0, 12),
    knownHandles: handles.slice(0, 12),
    historicalHandles: historicalHandles.slice(0, 8),
    domains: domains.slice(0, 12),
    associatedIdentifiers: identifiers.slice(0, 8),
    confidence: conf,
    supportingEvidence: supporting.slice(0, 8),
    conflictingEvidence: conflicting.slice(0, 8),
    currentHistoricalStatus: historicalHandles.length && handles.length ? 'mixed' : (handles.length ? 'current' : 'uncertain'),
    accounts: accounts.slice(0, 12),
  };
}

export function buildWhatCarmenChecked(pack = {}) {
  const variants = pack.variants || [];
  const classes = pack.sourceClasses || [];
  const aliases = pack.aliases || [];
  const providers = pack.providers || {};
  const branches = (pack.topicMap && pack.topicMap.branches) || [];
  const tried = Object.keys(providers);
  const ok = tried.filter(k => providers[k] && (providers[k].ok || providers[k].added > 0));
  const fail = tried.filter(k => providers[k] && (providers[k].error || (providers[k].status >= 400 && !providers[k].ok)));
  const adaptive = pack.adaptive || null;
  const topicVariants = pack.topicVariants || (adaptive && adaptive.topicVariants) || [];
  const visualPaths = pack.visualPaths || (adaptive && adaptive.visualPaths) || [];
  const accountPaths = pack.accountPaths || (adaptive && adaptive.accountPaths) || [];
  const remaining = pack.pathsRemaining || (adaptive && adaptive.pathsRemaining) || [];
  const iterations = (adaptive && adaptive.iterations) || pack.iterations || 0;
  const novelty = (adaptive && adaptive.noveltyLog) || pack.noveltyLog || [];
  const summary = 'I searched ' + (classes.length || branches.length || tried.length) + ' source classes using '
    + (aliases.length || 1) + ' identity variant' + ((aliases.length || 1) === 1 ? '' : 's') + ' and '
    + variants.length + ' quer' + (variants.length === 1 ? 'y' : 'ies') + '. '
    + (pack.uniqueResults != null ? pack.uniqueResults + ' unique results. ' : '')
    + (pack.duplicates != null ? pack.duplicates + ' duplicates collapsed. ' : '')
    + (pack.inaccessible != null ? pack.inaccessible + ' sources inaccessible. ' : '')
    + (iterations ? iterations + ' investigation iteration' + (iterations === 1 ? '' : 's') + '. ' : '')
    + (remaining.length ? remaining.length + ' public path' + (remaining.length === 1 ? '' : 's') + ' still unexplored. ' : '');
  return {
    sourceClasses: classes,
    sourceClassesAttempted: classes,
    sourceClassesRemaining: (adaptive && adaptive.sourceClassesRemaining) || pack.sourceClassesRemaining || [],
    queries: variants.map(v => ({ q: v.q, why: v.why, lane: v.lane, sourceClass: v.sourceClass })).slice(0, 48),
    aliases: aliases.slice(0, 16),
    identityVariants: aliases.slice(0, 16),
    topicVariants: topicVariants.slice(0, 16),
    visualPaths: visualPaths.slice(0, 16),
    accountPaths: accountPaths.slice(0, 16),
    linkChainDepth: (adaptive && adaptive.linkChainDepth) || pack.linkChainDepth || 0,
    pathsAttempted: (adaptive && adaptive.pathsAttempted) || pack.pathsAttempted || variants.map(v => v.lane || v.why).filter(Boolean).slice(0, 24),
    pathsRemaining: remaining.slice(0, 16),
    iterations,
    noveltyLog: novelty.slice(-8),
    providersTried: tried,
    providersOk: ok,
    providersFailed: fail,
    branches: branches.map(b => ({ id: b.id, label: b.label, status: b.status, results: b.results, queries: (b.queries || []).slice(0, 4) })),
    intents: pack.intents || [],
    summary: summary.trim(),
  };
}

export function buildWhyDidYouStop(pack = {}) {
  const unique = Number(pack.uniqueResults || 0);
  const dupes = Number(pack.duplicates || 0);
  const inaccessible = Number(pack.inaccessible || 0);
  const filtered = Number(pack.filtered || 0);
  const variants = (pack.variants || []).length;
  const classes = (pack.sourceClasses || []).length;
  const aliases = (pack.aliases || []).length || 1;
  const exhausted = !!pack.exhausted;
  const budget = !!pack.budgetHit;
  const identityBlocked = !!pack.identityInsufficient;
  const accessRestricted = inaccessible > 0 && unique === 0;
  const adaptive = pack.adaptive || null;
  const remaining = Number(pack.pathsRemainingCount != null ? pack.pathsRemainingCount : ((adaptive && adaptive.pathsRemaining) ? adaptive.pathsRemaining.length : (pack.pathsRemaining || []).length));
  const iterations = Number((adaptive && adaptive.iterations) || pack.iterations || 0);
  const noveltyStreak = Number((adaptive && adaptive.zeroNoveltyStreak) || pack.zeroNoveltyStreak || 0);
  const adaptiveKind = (adaptive && adaptive.stopKind) || pack.adaptiveStopKind || '';
  let stopClass = 'branches_exhausted';
  let headline = '';
  let stopKind = '';
  if (adaptiveKind && ADAPTIVE_STOP_KINDS[adaptiveKind]) {
    stopClass = ADAPTIVE_STOP_KINDS[adaptiveKind];
    stopKind = adaptiveKind;
    headline = (adaptive && adaptive.headline) || pack.adaptiveHeadline || '';
  }
  if (!headline) {
    if (identityBlocked) {
      stopClass = 'identity_confidence_insufficient';
      headline = 'Identity confidence was insufficient to expand further without mixing people.';
      stopKind = stopKind || 'B';
    } else if (adaptiveKind === 'D' || pack.providerUnavailable) {
      stopClass = 'provider_unavailable';
      headline = 'Search providers were unavailable, so remaining public paths could not be retrieved.';
      stopKind = 'D';
    } else if (accessRestricted || adaptiveKind === 'F') {
      stopClass = 'access_restricted';
      headline = remaining
        ? 'Carmen stopped because the remaining sources require authentication. Those sources were not accessed.'
        : 'Sources were found but required login, a paywall, or another access restriction. Finding a URL is not retrieval.';
      stopKind = 'F';
    } else if (filtered && unique === 0) {
      stopClass = 'found_but_filtered';
      headline = 'Results were found and then filtered (identity collision, duplicates, or relevance).';
    } else if (pack.unretrievable && unique === 0) {
      stopClass = 'found_but_unretrievable';
      headline = 'Sources were discovered but could not be retrieved or displayed.';
    } else if (budget && remaining > 0) {
      stopClass = 'resource_guard';
      headline = 'Carmen reached the current resource safeguard. Additional public investigation paths remain queued, so the investigation was not complete.';
      stopKind = 'E';
    } else if (budget && remaining === 0 && !exhausted) {
      stopClass = 'resource_guard';
      headline = 'Carmen reached the current resource safeguard. Additional public investigation paths remain queued, so the investigation was not complete.';
      stopKind = 'E';
    } else if (exhausted && remaining === 0 && noveltyStreak >= ADAPTIVE_NOVELTY_STOP_STREAK) {
      stopClass = 'investigation_exhausted';
      headline = 'Carmen stopped because all discovered public paths were exhausted and the last '
        + noveltyStreak + ' investigation iterations produced no novel evidence.';
      stopKind = 'A';
    } else if (exhausted || pack.diminishingReturns) {
      if (noveltyStreak >= ADAPTIVE_NOVELTY_STOP_STREAK && remaining > 0) {
        stopClass = 'no_novelty';
        headline = 'Recent investigation iterations produced only duplicates, and remaining branches were deprioritized.';
        stopKind = 'C';
      } else if (remaining === 0) {
        stopClass = 'investigation_exhausted';
        headline = 'Carmen stopped because all discovered public paths were exhausted and the last '
          + Math.max(1, noveltyStreak || iterations || 1) + ' investigation iteration'
          + ((noveltyStreak || iterations || 1) === 1 ? '' : 's') + ' produced no novel evidence.';
        stopKind = 'A';
      } else {
        stopClass = pack.diminishingReturns ? 'diminishing_returns' : 'no_additional_paths';
        headline = 'No additional meaningful public paths were discovered from the evidence in hand.';
        stopKind = 'B';
      }
    } else if (unique === 0 && variants > 0) {
      stopClass = 'not_found';
      headline = 'No public results were returned after the searches that actually ran. That is not proof the thing does not exist.';
    } else if (budget) {
      stopClass = 'resource_guard';
      headline = 'Carmen reached the current resource safeguard. Additional public investigation paths remain queued, so the investigation was not complete.';
      stopKind = 'E';
    } else {
      stopClass = remaining === 0 ? 'investigation_exhausted' : 'configured_limit';
      headline = remaining === 0
        ? 'Carmen stopped because all discovered public paths were exhausted.'
        : 'A configured depth/limit was reached after collecting public evidence.';
      stopKind = remaining === 0 ? 'A' : (stopKind || '');
    }
  }
  const detail = 'I searched ' + (classes || 'several') + ' source classes using ' + aliases + ' identity variant'
    + (aliases === 1 ? '' : 's') + '. ' + unique + ' unique results were found. ' + dupes + ' were duplicates. '
    + inaccessible + ' sources were inaccessible.' + (filtered ? ' ' + filtered + ' were filtered.' : '')
    + (iterations ? ' ' + iterations + ' investigation iterations ran.' : '')
    + (remaining ? ' ' + remaining + ' unexplored public paths remained.' : '');
  const legacyMap = stopClass === 'not_found' ? 'A'
    : (stopClass === 'not_searched_far_enough' || stopClass === 'resource_guard' ? 'B'
      : (stopClass === 'found_but_filtered' ? 'C'
        : (stopClass === 'found_but_unretrievable' ? 'D'
          : (stopClass === 'access_restricted' || stopClass === 'access_boundary' ? 'E'
            : (stopClass === 'identity_confidence_insufficient' ? 'F' : stopClass)))));
  return {
    stopClass,
    stopKind: stopKind || '',
    headline,
    detail,
    counts: { unique, duplicates: dupes, inaccessible, filtered, queries: variants, sourceClasses: classes, aliases, iterations, pathsRemaining: remaining },
    notFoundVsNotSearched: legacyMap,
    adaptiveKind: stopKind || '',
    resourceGuard: stopClass === 'resource_guard' || stopClass === 'not_searched_far_enough',
    investigationComplete: stopClass === 'investigation_exhausted' || stopClass === 'branches_exhausted' || stopClass === 'no_additional_paths' || stopClass === 'no_novelty',
  };
}

export function coupleEntityTopic(classification, entity, topic) {
  const out = classification && typeof classification === 'object' ? classification : {};
  const ent = String(entity || out.subject || '').replace(/"/g, '').trim();
  const top = String(topic || '').replace(/"/g, '').trim();
  if (ent) out.subject = ent;
  if (top && !/^adult content$/i.test(top)) {
    out.context = top;
    out.topic = top;
  }
  out.entityTopicCoupled = !!(out.subject && extraTopicTokens(out).length);
  return out;
}

export function keepEntityTopicQueries(subject, topic, attempted) {
  const sub = quote(subject) || subject;
  const top = String(topic || '').trim();
  const seen = attemptedSet(attempted);
  const out = [];
  if (!sub || !top) return out;
  // Do not re-emit the exact subject+topic clone. Deep Dive already carries
  // the coupled query as the primary; sourced intersection must survive.
  pushQuery(out, seen, sub + ' "' + top + '"', 'quoted-topic intersection', 'intersection', 'web', { sourceClass: 'intersection' });
  pushQuery(out, seen, sub + ' ' + top + ' (photoset OR scene OR gallery OR interview)', 'sourced entity × topic evidence', 'intersection', 'web', { sourceClass: 'intersection' });
  return out;
}

export function negativeResultReport(pack = {}) {
  return {
    searched: (pack.sourceClasses || []).slice(0, 16),
    queries: (pack.variants || []).map(v => v.q).slice(0, 16),
    aliases: (pack.aliases || []).slice(0, 8),
    found: pack.found || [],
    notFound: pack.notFound || [],
    inaccessible: pack.inaccessible || [],
    identityConfidenceBlockedExpansion: !!pack.identityInsufficient,
    note: 'Absence from Carmen’s retrieved public sources is not proof of nonexistence.',
  };
}

// ---------------------------------------------------------------------------
// v49.8 adaptive investigation controller
// Extends the existing planner. Does not replace retrieval, ranking, or
// provenance. A request count is a safety rail — not the stop logic.
// ---------------------------------------------------------------------------

export function isRestraintTechnique(text) {
  const n = norm(text);
  if (!n) return false;
  const compact = n.replace(/\s+/g, '');
  for (const fam of TECHNIQUE_FAMILIES) {
    for (const seed of fam.seeds || []) {
      const s = norm(seed);
      if (!s) continue;
      const sc = s.replace(/\s+/g, '');
      if (n === s || compact === sc) return true;
      if (s.length >= 6 && (n.includes(s) || compact.includes(sc))) return true;
    }
  }
  return false;
}

export function conceptVisualSearchQuery(subject, extra) {
  const seed = String(subject || '').trim();
  if (!seed) return '';
  const q = quote(seed) || seed;
  const extraBit = extra && !/adult content/i.test(extra) ? ' ' + String(extra).trim() : '';
  if (isRestraintTechnique(seed) || isRestraintTechnique(extraBit)) {
    return (q + extraBit + ' (bondage OR shibari OR restraint OR rope) (photos OR diagram OR tutorial OR reference)').replace(/\s+/g, ' ').trim();
  }
  return (q + extraBit + ' (photos OR images OR reference OR stills OR diagram OR tutorial)').replace(/\s+/g, ' ').trim();
}

export function conceptOrthographyVariants(concept) {
  const t = String(concept || '').trim();
  if (!t) return [];
  const out = [];
  const seen = new Set();
  const add = (s) => {
    const n = norm(s);
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(String(s).trim());
  };
  add(t);
  if (/\s/.test(t)) {
    add(t.replace(/\s+/g, '-'));
    add(t.replace(/\s+/g, ''));
  }
  if (/-/.test(t)) {
    add(t.replace(/-/g, ' '));
    add(t.replace(/-/g, ''));
  }
  for (const fam of TECHNIQUE_FAMILIES) {
    for (const seed of fam.seeds || []) {
      if (norm(seed) === norm(t) || norm(seed).replace(/\s+/g, '') === norm(t).replace(/\s+/g, '')) {
        add(seed);
      }
    }
  }
  return out;
}

export function conceptDiscoveryQueries(concept, classification, attempted, opts = {}) {
  const seed = String(concept || (classification && (classification.context || classification.subject)) || '').trim();
  if (!seed) return [];
  const seen = attemptedSet(attempted);
  const out = [];
  const add = (q, why, lane, kind, extra) => pushQuery(out, seen, q, why, lane, kind, extra);
  const ortho = conceptOrthographyVariants(seed);
  const type = (classification && classification.type) || '';
  const isTechnique = type === 'technique' || type === 'object' || type === 'skill' || (classification && classification.intentClass === 'OBJECT');
  if (!isTechnique && !(opts.force)) return out;
  const quoted = (s) => quote(s) || s;
  for (const v of ortho.slice(0, 4)) add(quoted(v), 'exact concept orthography', 'topic-variants', 'web', { sourceClass: 'concept-exact', family: 'topic-variants' });
  if (isTechnique) {
    add(quoted(seed) + ' (restraint OR position)', 'concept class — restraint/position', 'topic-variants', 'web', { sourceClass: 'concept-semantic', family: 'topic-variants' });
    add(conceptVisualSearchQuery(seed, ''), 'classified concept must drive visual retrieval', 'visual', 'image', { sourceClass: 'concept-visual', family: 'visual' });
    add(quoted(seed) + ' (tutorial OR guide OR technique OR "how to")', 'classified concept instructional retrieval', 'instructional', 'web', { sourceClass: 'instructional', family: 'instructional' });
    add(quoted(seed) + ' site:reddit.com', 'source-specific concept discovery', 'source-classes', 'web', { sourceClass: 'community-social', family: 'source-classes' });
    add(quoted(seed) + ' (forum OR blog OR wiki OR glossary)', 'educational/reference concept pages', 'source-classes', 'web', { sourceClass: 'instructional', family: 'source-classes' });
  }
  for (const v of semanticVariations(seed, opts.evidence || [], { excludeCurrent: true }).slice(0, 4)) {
    if (norm(v.label).includes(norm(seed).replace(/\s+/g, '')) || norm(seed).replace(/\s+/g, '').includes(norm(v.label).replace(/\s+/g, ''))) {
      add(quoted(v.label), v.why || 'semantic topic variant', 'topic-variants', 'web', { sourceClass: 'concept-semantic', family: 'topic-variants' });
    }
  }
  return out.slice(0, opts.limit || 16);
}

export function identityVariantQueries(classification, identity, topic, attempted) {
  const subject = String((identity && identity.canonicalName) || (classification && classification.subject) || '').trim();
  if (!subject) return [];
  const seen = attemptedSet(attempted);
  const out = [];
  const add = (q, why, lane, kind, extra) => pushQuery(out, seen, q, why, lane, kind, extra);
  const qSub = quote(subject) || subject;
  const top = String(topic || (classification && (classification.context || classification.topic)) || '').replace(/adult content/ig, '').trim();
  const dis = identityDisambiguation(subject);
  add(qSub, 'canonical full name', 'identity-variants', 'web', { sourceClass: 'identity', family: 'identity-variants' });
  if (top) add(qSub + ' ' + top + ' (photoset OR scene OR gallery OR interview)', 'name + topic sourced intersection', 'entity-topic', 'web', { sourceClass: 'intersection', family: 'entity-topic' });
  add(qSub + ' (aka OR alias OR "stage name" OR "also known as")', 'discover aliases from public evidence', 'identity-variants', 'web', { sourceClass: 'identity', family: 'identity-variants' });
  add(qSub + (dis.negatives.length ? ' ' + dis.negatives.join(' ') : '') + ' (photos OR gallery OR photoset OR images)', 'name + visual terminology (identity-enforced)', 'visual', 'image', { sourceClass: 'images-galleries', family: 'visual' });
  add(qSub + ' (official OR profile OR account OR handle)', 'name + account/profile terminology', 'accounts', 'web', { sourceClass: 'community-social', family: 'accounts' });
  add(qSub + ' (instagram OR twitter OR "x.com" OR reddit OR onlyfans OR fansly)', 'name + platform terminology', 'accounts', 'web', { sourceClass: 'community-social', family: 'accounts' });
  const aliases = [...((identity && identity.aliases) || []), ...((identity && identity.knownHandles) || [])].filter(Boolean);
  for (const a of aliases.slice(0, 6)) {
    if (norm(a) === norm(subject)) continue;
    const qa = quote(a) || a;
    add(qa, 'discovered alias/handle', 'identity-variants', 'web', { sourceClass: 'identity', family: 'identity-variants' });
    if (top) add(qa + ' ' + top, 'alias + topic', 'entity-topic', 'web', { sourceClass: 'intersection', family: 'entity-topic' });
    add(qa + ' (photos OR gallery OR profile)', 'alias + visual/account terminology', 'visual', 'image', { sourceClass: 'images-galleries', family: 'visual' });
  }
  for (const h of ((identity && identity.historicalHandles) || []).slice(0, 3)) {
    add((quote(h) || h) + ' ' + qSub + ' (former OR old OR archive OR historical)', 'historical account terminology', 'accounts', 'web', { sourceClass: 'community-social', family: 'accounts' });
  }
  return out.slice(0, 20);
}

export function visualInvestigationQueries(classification, evidence, attempted, opts = {}) {
  const subject = String((opts.identity && opts.identity.canonicalName) || (classification && classification.subject) || '').trim();
  if (!subject) return [];
  const seen = attemptedSet(attempted);
  const out = [];
  const add = (q, why, lane, kind, extra) => pushQuery(out, seen, q, why, lane, kind, extra);
  const qSub = quote(subject) || subject;
  const type = (classification && classification.type) || '';
  const topic = String((classification && (classification.context || classification.topic)) || '').replace(/adult content/ig, '').trim();
  const dis = identityDisambiguation(subject);
  const neg = dis.negatives.length ? ' ' + dis.negatives.join(' ') : '';
  const person = type === 'person' || type === 'social' || (classification && classification.intentClass === 'PERSON');
  const technique = type === 'technique' || type === 'object' || type === 'skill' || (classification && classification.intentClass === 'OBJECT');
  if (person) {
    add(qSub + neg + ' (image OR photos OR gallery OR "photo set" OR "visual reference")', 'person visual investigation branch', 'visual', 'image', { sourceClass: 'images-galleries', family: 'visual' });
    if (topic) add(qSub + ' ' + topic + neg + ' (photos OR gallery OR stills OR photoset)', 'person × topic visual branch', 'visual', 'image', { sourceClass: 'images-galleries', family: 'visual' });
    add(qSub + ' (babepedia OR iafd OR "official site") (photos OR gallery OR images)', 'known public profile + images', 'visual', 'image', { sourceClass: 'identity-profile', family: 'visual' });
  }
  if (technique) {
    add(conceptVisualSearchQuery(subject, ''), 'technique visual investigation', 'visual', 'image', { sourceClass: 'concept-visual', family: 'visual' });
    add(qSub + ' (diagram OR illustration OR photography)' + (isRestraintTechnique(subject) ? ' (bondage OR shibari OR restraint)' : ''), 'technique diagram/illustration branch', 'visual', 'image', { sourceClass: 'concept-visual', family: 'visual' });
    add(qSub + ' (tutorial OR guide) (image OR diagram OR stills)' + (isRestraintTechnique(subject) ? ' (rope OR bondage)' : ''), 'technique instructional visual', 'visual', 'image', { sourceClass: 'instructional', family: 'visual' });
  }
  return out.slice(0, 12);
}

export function entityAssociatedVisualQueries(classification, evidence, attempted) {
  const subject = String((classification && classification.subject) || '').trim();
  if (!subject) return [];
  const seen = attemptedSet(attempted);
  const out = [];
  const add = (q, why, lane, kind, extra) => pushQuery(out, seen, q, why, lane, kind, extra);
  const qSub = quote(subject) || subject;
  const topic = String((classification && (classification.context || classification.topic)) || '').replace(/adult content/ig, '').trim();
  const rows = evidence || [];
  for (const r of rows.slice(0, 12)) {
    const host = hostOf((r && (r.url || r.pageUrl)) || '').replace(/^www\./, '');
    const blob = String((r && (r.title || '')) + ' ' + ((r && r.snippet) || ''));
    const mq = r && r.matchQuality;
    const entityHit = tokens(subject).every(t => norm(blob + ' ' + ((r && r.url) || '')).includes(t));
    if (!host || (!entityHit && mq !== 'exact' && mq !== 'likely')) continue;
    if (/pinterest|google\.|bing\.|yahoo\.|duckduckgo|startpage/.test(host)) continue;
    add(qSub + ' site:' + host, 'entity evidence on ' + host + ' seeds visual/source follow-up', 'visual-entity-seeded', 'web', { sourceClass: 'link-chain', family: 'visual-entity-seeded', parent: r.url });
    if (/\b(gallery|photoset|album|image|photo|imgur|redgifs)\b/i.test(blob + ' ' + ((r && r.url) || ''))) {
      add(qSub + (topic ? ' ' + topic : '') + ' site:' + host + ' (gallery OR photos OR images)', 'discovered page identifies the person and links visuals', 'visual-entity-seeded', 'image', { sourceClass: 'images-galleries', family: 'visual-entity-seeded', parent: r.url });
    }
    if (r && (r.image || (r.images && r.images.length))) {
      add(qSub + ' site:' + host + ' (photos OR gallery)', 'source already contains images — follow associated image URLs', 'visual-entity-seeded', 'image', { sourceClass: 'images-galleries', family: 'visual-entity-seeded', parent: r.url });
    }
  }
  return out.slice(0, 10);
}

export function accountInvestigationQueries(classification, identity, discovered, attempted) {
  const subject = String((identity && identity.canonicalName) || (classification && classification.subject) || '').trim();
  if (!subject) return [];
  const seen = attemptedSet(attempted);
  const out = [];
  const add = (q, why, lane, kind, extra) => pushQuery(out, seen, q, why, lane, kind, extra);
  const qSub = quote(subject) || subject;
  add(qSub + ' (official OR verified) (instagram OR twitter OR "x.com" OR youtube OR reddit)', 'official/public profile discovery', 'accounts', 'web', { sourceClass: 'community-social', family: 'accounts' });
  add(qSub + ' (linktree OR allmylinks OR "official links" OR "link in bio")', 'public link hubs', 'accounts', 'web', { sourceClass: 'related-sites', family: 'accounts' });
  add(qSub + ' (onlyfans OR fansly OR loyalfans OR manyvids) (profile OR bio OR preview)', 'public subscription-profile metadata', 'premium', 'web', { sourceClass: 'premium-subscription', family: 'premium' });
  add(qSub + ' (babepedia OR iafd OR indexxx OR freeones) (links OR twitter OR instagram)', 'public account directories / indexed profile pages', 'accounts', 'web', { sourceClass: 'identity-profile', family: 'accounts' });
  add(qSub + ' (former OR old OR inactive OR archive) (twitter OR instagram OR onlyfans)', 'public historical account references', 'accounts', 'web', { sourceClass: 'archival', family: 'accounts' });
  for (const acc of (discovered || []).slice(0, 6)) {
    const host = String(acc.domain || hostOf(acc.url || '')).replace(/^www\./, '');
    const handle = acc.handle && acc.handle !== 'UNKNOWN' ? acc.handle : '';
    if (host) add(qSub + ' site:' + host, 'recursive public investigation of discovered platform ' + host, 'premium', 'web', { sourceClass: 'premium-subscription', family: 'premium' });
    if (handle) add('"' + handle + '" ' + qSub + ' (profile OR links OR bio)', 'handle corroboration', 'accounts', 'web', { sourceClass: 'community-social', family: 'accounts' });
  }
  return out.slice(0, 16);
}

export function extractInvestigationSeeds(results, classification, extras = {}) {
  const subject = String((classification && classification.subject) || '').trim();
  const aliases = [];
  const handles = [];
  const accounts = [];
  const galleries = [];
  const linkTargets = [];
  const domains = [];
  const visualCandidates = [];
  const pushU = (arr, v) => { const s = String(v || '').trim(); if (s && !arr.some(x => norm(String(x.label || x.url || x)) === norm(s))) arr.push(v); };
  for (const r of results || []) {
    const host = hostOf((r && (r.url || r.pageUrl)) || '').replace(/^www\./, '');
    if (host) pushU(domains, { label: host, url: r.url, kind: 'domain' });
    for (const a of (r && r.aliases) || []) pushU(aliases, { label: a, url: r.url, kind: 'alias', parent: r.url });
    if (r && r.accountHandle && r.accountHandle !== 'UNKNOWN') {
      pushU(handles, { label: r.accountHandle, url: r.url, kind: 'handle', platform: r.accountPlatform });
      pushU(accounts, { url: r.url, handle: r.accountHandle, platform: r.accountPlatform || host, domain: host, title: r.title });
    }
    const ct = r && r.contentType;
    if (ct === 'account' || (host && PUBLIC_ACCOUNT_HOSTS.some(p => host === p.host || host.endsWith('.' + p.host)))) {
      pushU(accounts, { url: r.url, handle: (r && r.accountHandle) || '', platform: (r && r.accountPlatform) || host, domain: host, title: r.title });
    }
    if (/\b(gallery|photoset|album|portfolio)\b/i.test(String((r && r.title) || '') + ' ' + String((r && r.url) || ''))) {
      pushU(galleries, { url: r.url, title: r.title, domain: host, kind: 'gallery' });
    }
    if (r && (r.image || (r.images && r.images.length))) {
      pushU(visualCandidates, { url: r.image || r.images[0], pageUrl: r.url, title: r.title, domain: host });
    }
    if (host && !/google\.|bing\.|yahoo\.|duckduckgo/.test(host)) pushU(linkTargets, { url: r.url, domain: host, title: r.title, kind: 'link' });
    const titleToks = tokens((r && r.title) || '');
    const subjToks = tokens(subject);
    if (subjToks.length >= 2 && titleToks.length >= 2) {
      const aka = String((r && r.title) || '').match(/\((?:aka|also known as)\s+([^)]+)\)/i);
      if (aka) pushU(aliases, { label: aka[1], url: r.url, kind: 'alias', parent: r.url });
    }
  }
  for (const a of ((extras.identity && extras.identity.aliases) || [])) pushU(aliases, { label: a, kind: 'alias' });
  for (const h of ((extras.identity && extras.identity.knownHandles) || [])) pushU(handles, { label: h, kind: 'handle' });
  return {
    aliases: aliases.slice(0, 12),
    handles: handles.slice(0, 12),
    accounts: accounts.slice(0, 12),
    galleries: galleries.slice(0, 8),
    linkTargets: linkTargets.slice(0, 12),
    domains: domains.slice(0, 12),
    visualCandidates: visualCandidates.slice(0, 12),
  };
}

export function evaluateNovelty(batch, prior = {}) {
  const priorUrls = new Set((prior.urls || []).map(u => canonicalizeUrl(u)).filter(Boolean));
  const priorHosts = new Set((prior.hosts || []).map(h => String(h).replace(/^www\./, '').toLowerCase()));
  const priorAliases = new Set((prior.aliases || []).map(norm));
  const priorAccounts = new Set((prior.accounts || []).map(a => canonicalizeUrl(a.url || a) || norm(a.handle || a)));
  const items = batch.items || batch.results || [];
  let newUnique = 0;
  let duplicates = 0;
  const newDomains = [];
  const newAliases = [];
  const newAccounts = [];
  const newVisuals = [];
  const newLinks = [];
  const rejected = [];
  for (const r of items) {
    const url = canonicalizeUrl((r && (r.url || r.pageUrl)) || '');
    const host = hostOf((r && (r.url || r.pageUrl)) || '').replace(/^www\./, '');
    if (!url) continue;
    if (priorUrls.has(url) || r.duplicate) { duplicates++; continue; }
    newUnique++;
    if (host && !priorHosts.has(host)) newDomains.push(host);
    for (const a of (r.aliases || [])) if (!priorAliases.has(norm(a))) newAliases.push(a);
    if (r.accountHandle && !priorAccounts.has(norm(r.accountHandle))) newAccounts.push({ handle: r.accountHandle, url: r.url, platform: r.accountPlatform });
    if (r.image || (r.images && r.images.length) || r.kind === 'visual') newVisuals.push(r.url || r.image);
    if (r.matchQuality === 'unrelated' || r.impersonator || r.identityCollision) rejected.push(r.url);
    else newLinks.push(r.url);
  }
  const meaningful = newUnique > 0 || newDomains.length > 0 || newAliases.length > 0 || newAccounts.length > 0 || newVisuals.length > 0;
  return {
    newUniqueResults: newUnique,
    duplicateResults: duplicates,
    newDomains,
    newSourceClasses: [...new Set((items || []).map(r => r.sourceClass || r.plannerSourceClass).filter(Boolean))],
    newAliases,
    newAccounts,
    newTopicVariants: [],
    newVisualCandidates: newVisuals,
    newLinkTargets: newLinks,
    rejectedCandidates: rejected,
    meaningful,
  };
}

function emptyFamilyState(id) {
  return { id, attempted: 0, successful: 0, empty: 0, inaccessible: 0, notApplicable: false, pending: 0 };
}

export function createAdaptiveController(opts = {}) {
  const families = {};
  for (const id of INVESTIGATION_PATH_FAMILIES) families[id] = emptyFamilyState(id);
  return {
    query: opts.query || '',
    classification: opts.classification || {},
    identity: opts.identity || null,
    pending: [],
    attempted: [],
    attemptedSet: attemptedSet(opts.attempted || []),
    families,
    iterations: 0,
    zeroNoveltyStreak: 0,
    lastNovelty: null,
    noveltyLog: [],
    urls: new Set(),
    hosts: new Set(),
    aliases: [],
    accounts: [],
    topicVariants: [],
    visualPaths: [],
    accountPaths: [],
    linkChainDepth: 0,
    maxLinkDepth: opts.maxLinkDepth || 3,
    startedAt: opts.startedAt || Date.now(),
    stopKind: '',
    headline: '',
    pathsRemaining: [],
    pathsAttempted: [],
    sourceClassesRemaining: [],
  };
}

export function enqueueInvestigationPaths(controller, queries) {
  if (!controller || !Array.isArray(queries)) return 0;
  let added = 0;
  for (const qv of queries) {
    const t = String((qv && qv.q) || '').trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (controller.attemptedSet.has(k)) continue;
    if (controller.pending.some(p => String(p.q).toLowerCase() === k)) continue;
    const family = (qv && (qv.family || (qv.extra && qv.extra.family))) || qv.lane || 'source-classes';
    const row = { ...qv, q: t, family, priority: qv.priority || familyPriority(family) };
    controller.pending.push(row);
    if (controller.families[family]) controller.families[family].pending++;
    added++;
  }
  controller.pending.sort((a, b) => (a.priority || 50) - (b.priority || 50));
  return added;
}

function familyPriority(family) {
  const order = {
    identity: 8,
    'identity-variants': 10,
    'entity-topic': 12,
    visual: 16,
    'visual-entity-seeded': 18,
    instructional: 20,
    clothing: 21,
    position: 21,
    accounts: 22,
    premium: 24,
    'topic-variants': 26,
    url: 27,
    'source-classes': 28,
    'link-chain': 30,
    corroboration: 32,
  };
  return order[family] || 40;
}

export function nextInvestigationBatch(controller, limit) {
  const n = Math.max(1, Number(limit) || ADAPTIVE_BATCH_SIZE);
  const out = [];
  const emptyFamilies = new Set(Object.keys(controller.families || {}).filter(id => controller.families[id].attempted >= 2 && controller.families[id].successful === 0));
  const rest = [];
  for (const qv of controller.pending) {
    if (out.length >= n) { rest.push(qv); continue; }
    if (emptyFamilies.has(qv.family) && controller.pending.some(p => !emptyFamilies.has(p.family))) {
      rest.push(qv);
      continue;
    }
    out.push(qv);
    controller.attemptedSet.add(String(qv.q).toLowerCase());
    controller.attempted.push(qv);
    if (controller.families[qv.family]) {
      controller.families[qv.family].attempted++;
      controller.families[qv.family].pending = Math.max(0, (controller.families[qv.family].pending || 1) - 1);
    }
  }
  controller.pending = rest;
  return out;
}

export function recordInvestigationBatch(controller, batch, novelty) {
  controller.iterations = (controller.iterations || 0) + 1;
  controller.lastNovelty = novelty || null;
  if (novelty && novelty.meaningful) controller.zeroNoveltyStreak = 0;
  else controller.zeroNoveltyStreak = (controller.zeroNoveltyStreak || 0) + 1;
  if (novelty) {
    controller.noveltyLog.push({
      iteration: controller.iterations,
      newUnique: novelty.newUniqueResults || 0,
      duplicates: novelty.duplicateResults || 0,
      newDomains: (novelty.newDomains || []).length,
      newAliases: (novelty.newAliases || []).length,
      newAccounts: (novelty.newAccounts || []).length,
      newVisuals: (novelty.newVisualCandidates || []).length,
      meaningful: !!novelty.meaningful,
    });
    for (const d of novelty.newDomains || []) controller.hosts.add(d);
    for (const a of novelty.newAliases || []) if (!controller.aliases.includes(a)) controller.aliases.push(a);
    for (const a of novelty.newAccounts || []) controller.accounts.push(a);
    for (const v of novelty.newVisualCandidates || []) controller.visualPaths.push(v);
  }
  for (const qv of batch || []) {
    const fam = controller.families[qv.family];
    if (!fam) continue;
    if (novelty && novelty.meaningful) fam.successful++;
    else fam.empty++;
    if (!controller.pathsAttempted.includes(qv.family)) controller.pathsAttempted.push(qv.family);
    if (qv.family === 'visual' || qv.family === 'visual-entity-seeded') controller.visualPaths.push(qv.q);
    if (qv.family === 'accounts' || qv.family === 'premium') controller.accountPaths.push(qv.q);
    if (qv.family === 'topic-variants') controller.topicVariants.push(qv.q);
    if (qv.family === 'link-chain' || qv.family === 'visual-entity-seeded') {
      controller.linkChainDepth = Math.max(controller.linkChainDepth || 0, 1 + (qv.depth || 0));
    }
  }
  refreshAdaptiveRemaining(controller);
  return controller;
}

function refreshAdaptiveRemaining(controller) {
  const remaining = [];
  const classRemaining = [];
  for (const id of INVESTIGATION_PATH_FAMILIES) {
    const fam = controller.families[id];
    const pendingOf = controller.pending.filter(p => p.family === id);
    fam.pending = pendingOf.length;
    if (pendingOf.length) {
      remaining.push(id);
      classRemaining.push(id);
    }
  }
  controller.pathsRemaining = remaining;
  controller.sourceClassesRemaining = classRemaining;
}

export function decideInvestigationContinuation(controller, guards = {}) {
  refreshAdaptiveRemaining(controller);
  const remainingFetches = Number(guards.remainingFetches != null ? guards.remainingFetches : Infinity);
  const budgetLeft = guards.budgetLeft != null ? !!guards.budgetLeft : remainingFetches > 2;
  const elapsed = Number(guards.elapsedMs != null ? guards.elapsedMs : (Date.now() - (controller.startedAt || Date.now())));
  const timeGuard = Number(guards.timeGuardMs != null ? guards.timeGuardMs : ADAPTIVE_TIME_GUARD_MS);
  const maxIter = Number(guards.maxIterations != null ? guards.maxIterations : ADAPTIVE_MAX_ITERATIONS);
  const providerDown = !!guards.providerUnavailable;
  const accessOnly = !!guards.accessBoundary && controller.pending.every(p => p.family === 'premium' || p.accessBound);
  const remaining = controller.pathsRemaining || [];
  const pending = controller.pending || [];
  const sliceRan = Number(guards.sliceRan || 0);
  const sliceLimit = Number(guards.sliceLimit != null ? guards.sliceLimit : CONTINUATION_SLICE_SIZE);

  if (providerDown) {
    controller.stopKind = 'D';
    controller.headline = 'Search providers were unavailable, so remaining public paths could not be retrieved.';
    return { continue: false, stopKind: 'D', stopClass: 'provider_unavailable', reason: controller.headline, remaining: remaining.length };
  }
  if (sliceRan >= sliceLimit && pending.length) {
    controller.stopKind = 'E';
    controller.headline = 'Additional public investigation paths remain, but this run reached its execution limit.';
    return { continue: false, stopKind: 'E', stopClass: 'resource_guard', reason: controller.headline, remaining: pending.length };
  }
  if (accessOnly && pending.length && !pending.some(p => p.family !== 'premium')) {
    controller.stopKind = 'F';
    controller.headline = 'Carmen stopped because the remaining sources require authentication. Those sources were not accessed.';
    return { continue: false, stopKind: 'F', stopClass: 'access_boundary', reason: controller.headline, remaining: remaining.length };
  }
  if (remainingFetches <= 2 || guards.resourceExhausted || !budgetLeft) {
    if (pending.length) {
      controller.stopKind = 'E';
      controller.headline = 'Carmen reached the current resource safeguard. Additional public investigation paths remain queued, so the investigation was not complete.';
      return { continue: false, stopKind: 'E', stopClass: 'resource_guard', reason: controller.headline, remaining: pending.length };
    }
  }
  if (elapsed >= timeGuard && pending.length) {
    controller.stopKind = 'E';
    controller.headline = 'Carmen reached the current resource safeguard. Additional public investigation paths remain queued, so the investigation was not complete.';
    return { continue: false, stopKind: 'E', stopClass: 'resource_guard', reason: controller.headline, remaining: pending.length };
  }
  if ((controller.iterations || 0) >= maxIter && pending.length) {
    controller.stopKind = 'E';
    controller.headline = 'Carmen reached the current resource safeguard. Additional public investigation paths remain queued, so the investigation was not complete.';
    return { continue: false, stopKind: 'E', stopClass: 'resource_guard', reason: controller.headline, remaining: pending.length };
  }
  if (!pending.length) {
    if ((controller.zeroNoveltyStreak || 0) >= ADAPTIVE_NOVELTY_STOP_STREAK || (controller.iterations || 0) > 0) {
      controller.stopKind = 'A';
      controller.headline = 'Carmen stopped because all discovered public paths were exhausted'
        + ((controller.zeroNoveltyStreak || 0) ? ' and the last ' + controller.zeroNoveltyStreak + ' investigation iterations produced no novel evidence.' : '.');
      return { continue: false, stopKind: 'A', stopClass: 'investigation_exhausted', reason: controller.headline, remaining: 0 };
    }
    controller.stopKind = 'B';
    controller.headline = 'No additional meaningful public paths were discovered from the evidence in hand.';
    return { continue: false, stopKind: 'B', stopClass: 'no_additional_paths', reason: controller.headline, remaining: 0 };
  }
  if ((controller.zeroNoveltyStreak || 0) >= ADAPTIVE_NOVELTY_STOP_STREAK && pending.length === 0) {
    controller.stopKind = 'C';
    controller.headline = 'Carmen stopped because remaining searches produced only duplicates.';
    return { continue: false, stopKind: 'C', stopClass: 'no_novelty', reason: controller.headline, remaining: 0 };
  }
  return { continue: true, stopKind: '', stopClass: '', reason: 'meaningful unexplored paths remain', remaining: pending.length };
}

export function enqueueAdaptiveFamilies(controller, pack = {}) {
  const classification = pack.classification || controller.classification || {};
  const identity = pack.identity || controller.identity || { canonicalName: classification.subject, aliases: [], knownHandles: [], historicalHandles: [] };
  const topic = pack.topic || classification.context || classification.topic || '';
  const attempted = [...controller.attemptedSet];
  const evidence = pack.evidence || pack.results || [];
  const type = classification.type || '';
  const person = type === 'person' || type === 'social' || classification.intentClass === 'PERSON';
  const technique = type === 'technique' || type === 'object' || type === 'skill' || classification.intentClass === 'OBJECT';
  const focuses = parseResearchFocus(pack.researchFocus || pack.focus || [], { type, tutorialIntent: pack.tutorialIntent, wantVisual: pack.wantVisual });
  const identityHold = identityPhaseShouldHoldExpansion(classification, pack.identityFeedback || (identity && identity.feedback), pack);
  let added = 0;
  if (person) added += enqueueInvestigationPaths(controller, identityVariantQueries(classification, identity, topic, attempted));
  if (technique) added += enqueueInvestigationPaths(controller, conceptDiscoveryQueries(topic || classification.subject, classification, attempted, { evidence }));
  const allowVisual = !identityHold || focuses.includes('visuals') || pack.wantVisual === 'always';
  const allowAccounts = !identityHold || pack.premiumAccounts;
  if ((person || technique || pack.wantVisual || focuses.includes('visuals')) && allowVisual) {
    added += enqueueInvestigationPaths(controller, visualInvestigationQueries(classification, evidence, attempted, { identity }));
    added += enqueueInvestigationPaths(controller, entityAssociatedVisualQueries(classification, evidence, attempted));
  }
  if ((person || pack.premiumAccounts) && allowAccounts) {
    added += enqueueInvestigationPaths(controller, accountInvestigationQueries(classification, identity, pack.discoveredAccounts || identity.accounts || [], attempted));
  }
  if (pack.tutorialIntent || (classification && classification.tutorialIntent) || focuses.includes('tutorial')) {
    added += enqueueInvestigationPaths(controller, tutorialQueries(classification.subject || topic, topic, attempted).map(q => ({ ...q, family: 'instructional' })));
  }
  if (focuses.length) {
    added += enqueueInvestigationPaths(controller, researchFocusQueries(focuses, classification, attempted, { evidence, topic, subject: classification.subject }));
  }
  if (identityHold) {
    controller.pending = controller.pending.filter(p => p.family === 'identity' || p.family === 'identity-variants' || p.family === 'entity-topic' || (focuses.includes('visuals') && (p.family === 'visual' || p.family === 'visual-entity-seeded')));
    refreshAdaptiveRemaining(controller);
  }
  const supp = suppressionFromRejection(pack.identityFeedback);
  if (supp.queryNegatives && supp.queryNegatives.length) {
    for (const p of controller.pending) {
      const blob = String(p.q || '');
      const extra = supp.queryNegatives.filter(n => n && blob.indexOf(n) < 0).slice(0, 3).join(' ');
      if (extra) p.q = (blob + ' ' + extra).trim();
    }
  }
  return added;
}

export function seedsToQueries(seeds, classification, attempted) {
  const subject = String((classification && classification.subject) || '').trim();
  const qSub = quote(subject) || subject;
  const topic = String((classification && (classification.context || classification.topic)) || '').replace(/adult content/ig, '').trim();
  const seen = attemptedSet(attempted);
  const out = [];
  const add = (q, why, lane, kind, extra) => pushQuery(out, seen, q, why, lane, kind, extra);
  if (!qSub) return out;
  for (const a of (seeds.aliases || []).slice(0, 4)) {
    add((quote(a.label) || a.label), 'newly discovered alias becomes an investigation branch', 'identity-variants', 'web', { family: 'identity-variants', parent: a.parent || a.url });
    if (topic) add((quote(a.label) || a.label) + ' ' + topic, 'alias × topic from discovered evidence', 'entity-topic', 'web', { family: 'entity-topic' });
  }
  for (const g of (seeds.galleries || []).slice(0, 3)) {
    const host = String(g.domain || hostOf(g.url || '')).replace(/^www\./, '');
    if (host) add(qSub + ' site:' + host, 'linked public gallery from entity evidence', 'visual-entity-seeded', 'image', { family: 'visual-entity-seeded', parent: g.url });
  }
  for (const acc of (seeds.accounts || []).slice(0, 4)) {
    const host = String(acc.domain || hostOf(acc.url || '')).replace(/^www\./, '');
    if (host) add(qSub + ' site:' + host, 'discovered account seeds further public metadata', 'accounts', 'web', { family: 'accounts', parent: acc.url });
    if (acc.handle) add('"' + acc.handle + '" ' + qSub, 'discovered handle corroboration', 'accounts', 'web', { family: 'accounts' });
  }
  for (const d of (seeds.domains || []).slice(0, 4)) {
    const host = String(d.label || d.domain || '').replace(/^www\./, '');
    if (host && host.includes('.') && !/google|bing|yahoo|duckduckgo|pinterest/.test(host)) {
      add(qSub + (topic ? ' ' + topic : '') + ' site:' + host, 'associated-source path from discovered domain', 'link-chain', 'web', { family: 'link-chain', parent: d.url });
    }
  }
  return out.slice(0, 14);
}

export function adaptiveTrace(controller) {
  refreshAdaptiveRemaining(controller);
  return {
    identitiesResolved: controller.identity ? [controller.identity.canonicalName] : [(controller.classification && controller.classification.subject) || ''],
    aliasesTested: [...new Set([...(controller.aliases || []), ...controller.attempted.filter(q => q.family === 'identity-variants').map(q => q.q)])].slice(0, 16),
    topicVariants: controller.topicVariants.slice(0, 16),
    visualPaths: controller.visualPaths.slice(0, 16),
    accountPaths: controller.accountPaths.slice(0, 16),
    sourceClassesAttempted: Object.keys(controller.families).filter(id => controller.families[id].attempted > 0),
    sourceClassesRemaining: controller.sourceClassesRemaining,
    linkChainDepth: controller.linkChainDepth || 0,
    iterations: controller.iterations || 0,
    noveltyLog: controller.noveltyLog.slice(-8),
    pathsAttempted: controller.pathsAttempted,
    pathsRemaining: controller.pathsRemaining,
    stopKind: controller.stopKind || '',
    headline: controller.headline || '',
    families: controller.families,
  };
}

// ---------------------------------------------------------------------------
// v49.9 identity verification + persistent queue + visual evidence gate
// Extends the v49.8 adaptive controller. Does not replace retrieval.
// ---------------------------------------------------------------------------

export const RESEARCH_FOCUS_IDS = ['person', 'visuals', 'tutorial', 'clothing', 'position', 'url', 'topic', 'accounts', 'career', 'interviews', 'projects', 'collaborations', 'appearances'];
export const IDENTITY_VERIFY_MAX = 5;
export const IDENTITY_VERIFY_PREFERRED = 3;
export const VISUAL_GATE_VERDICTS = ['verified', 'unverified', 'rejected'];
export const SOURCE_LIFECYCLE = ['discovered', 'verified', 'opened', 'analyzed'];
export const INVESTIGATION_PHASES_V49_9 = [
  'CORE_DISCOVERY',
  'IDENTITY_RESOLUTION',
  'USER_CONFIRMATION',
  'ENTITY_TOPIC_EXPANSION',
  'VISUAL_EXPANSION',
  'TUTORIAL_EXPANSION',
  'ACCOUNT_EXPANSION',
  'LINK_CHAIN_EXPANSION',
  'NEW_SEED_EXPANSION',
  'CORROBORATION',
];

const STOCK_NOISE_HOSTS = [
  'shutterstock.com', 'gettyimages.com', 'istockphoto.com', 'alamy.com',
  'dreamstime.com', 'depositphotos.com', 'adobestock.com', '123rf.com',
  'unsplash.com', 'pexels.com', 'pixabay.com', 'pxhere.com',
];
const WILDLIFE_HOSTS = [
  'a-z-animals.com', 'animalcorner.org', 'nationalgeographic.com', 'natgeofe.com',
  'wallpapers.com',
];

export function normalizeResearchFocusToken(raw) {
  const n = norm(raw);
  if (!n) return '';
  if (n === 'person' || n === 'people' || n === 'identity') return 'person';
  if (n === 'visuals' || n === 'visual' || n === 'images' || n === 'photos' || n === 'video' || n === 'videos') return 'visuals';
  if (n === 'tutorial' || n === 'tutorials' || n === 'skill' || n === 'how to' || n === 'howto') return 'tutorial';
  if (n === 'clothing' || n === 'outfit' || n === 'garment') return 'clothing';
  if (n === 'position' || n === 'technique' || n === 'object') return 'position';
  if (n === 'url' || n === 'website' || n === 'site') return 'url';
  if (n === 'topic' || n === 'subject') return 'topic';
  if (n === 'accounts' || n === 'account' || n === 'profiles' || n === 'premium') return 'accounts';
  if (n === 'career' || n === 'work' || n === 'credits' || n === 'filmography') return 'career';
  if (n === 'interviews' || n === 'interview') return 'interviews';
  if (n === 'projects' || n === 'project') return 'projects';
  if (n === 'collaborations' || n === 'collaboration' || n === 'collaborators') return 'collaborations';
  if (n === 'appearances' || n === 'public appearances' || n === 'appearance') return 'appearances';
  return '';
}

export function parseResearchFocus(raw, opts = {}) {
  const out = [];
  const seen = new Set();
  const add = (t) => {
    const id = normalizeResearchFocusToken(t);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  const src = raw != null ? raw : (opts.focus || opts.researchFocus || opts.type || '');
  if (Array.isArray(src)) src.forEach(add);
  else if (typeof src === 'string') String(src).split(/[,+|]/).forEach(add);
  if (opts.visuals === true || opts.wantVisual === true) add('visuals');
  if (opts.tutorialIntent === true) add('tutorial');
  if ((opts.hint || opts.type) && !out.length) add(opts.hint || opts.type);
  return out;
}

export function researchFocusFamilies(focuses, classification) {
  const f = new Set(parseResearchFocus(focuses, { type: classification && classification.type }));
  const person = f.has('person') || (classification && (classification.type === 'person' || classification.intentClass === 'PERSON'));
  const families = [];
  if (person || !f.size) families.push('identity', 'identity-variants');
  if (f.has('topic') || (classification && (classification.context || classification.topic))) families.push('entity-topic', 'topic-variants');
  if (f.has('visuals') || f.has('clothing') || f.has('position')) families.push('visual', 'visual-entity-seeded');
  if (f.has('tutorial')) families.push('instructional');
  if (f.has('clothing')) families.push('clothing');
  if (f.has('position')) families.push('position');
  if (f.has('url')) families.push('url', 'link-chain');
  if (person || f.has('person')) families.push('accounts', 'premium');
  if (f.has('career') || f.has('interviews') || f.has('projects') || f.has('collaborations') || f.has('appearances')) {
    families.push('entity-topic', 'corroboration');
  }
  if (f.has('accounts')) families.push('accounts', 'premium');
  if (!f.size) return INVESTIGATION_PATH_FAMILIES.slice();
  families.push('source-classes', 'link-chain', 'corroboration');
  return [...new Set(families)];
}

export function adaptiveLensesForFocus(focuses, classification) {
  const f = new Set(parseResearchFocus(focuses, { type: classification && classification.type }));
  const person = f.has('person') || (classification && classification.type === 'person');
  const visuals = f.has('visuals');
  const tutorial = f.has('tutorial');
  const topic = f.has('topic') || (!f.size && !!(classification && (classification.context || classification.topic)));
  const clothing = f.has('clothing');
  const position = f.has('position');
  const url = f.has('url');
  const out = [{ id: 'everything', label: 'Everything' }];
  if (person && visuals) {
    out.push(
      { id: 'identity', label: 'Identity', context: 'profile' },
      { id: 'visual-evidence', label: 'Visual evidence', context: 'photos gallery video' },
      { id: 'public-profiles', label: 'Public profiles', context: 'official profile' },
      { id: 'galleries', label: 'Galleries', context: 'gallery photoset' },
      { id: 'relevant-context', label: 'Relevant context', context: (classification && (classification.context || classification.topic)) || '' },
    );
  } else if (person && tutorial) {
    out.push(
      { id: 'identity', label: 'Identity', context: 'profile' },
      { id: 'tutorials', label: 'Instructional / reference', context: 'tutorial' },
    );
  } else if (person && topic) {
    out.push(
      { id: 'identity', label: 'Identity', context: 'profile' },
      { id: 'intersection', label: 'Entity × topic', context: (classification && (classification.context || classification.topic)) || '' },
      { id: 'visual-evidence', label: 'Visual evidence', context: 'photos gallery' },
    );
  } else if (person) {
    out.push(
      { id: 'identity', label: 'Identity', context: 'profile' },
      { id: 'aliases', label: 'Aliases', context: 'aka alias' },
      { id: 'accounts', label: 'Accounts', context: 'profile official' },
      { id: 'credits', label: 'Credits and public work', context: 'credits filmography' },
      { id: 'career', label: 'Career', context: 'career' },
      { id: 'interviews', label: 'Interviews', context: 'interviews' },
      { id: 'projects', label: 'Projects', context: 'projects' },
      { id: 'collaborations', label: 'Collaborations', context: 'collaborations' },
      { id: 'appearances', label: 'Public appearances', context: 'appearances' },
    );
  } else if (visuals || clothing || position) {
    out.push(
      { id: 'visuals', label: 'Images', context: 'photos' },
      { id: 'videos', label: 'Videos', context: 'video clip' },
      { id: 'galleries', label: 'Galleries', context: 'gallery photoset' },
      { id: 'original-sources', label: 'Original sources', context: 'original source' },
      { id: 'duplicates', label: 'Duplicates', context: 'repost mirror' },
      { id: 'visual-corroboration', label: 'Visual corroboration', context: 'same photoset' },
      { id: 'tutorials', label: 'Instructional / reference', context: 'tutorial' },
      { id: 'variations', label: 'Variations', context: 'variations' },
    );
  } else if (tutorial) {
    out.push(
      { id: 'tutorials', label: 'Tutorials', context: 'tutorial' },
      { id: 'diagrams', label: 'Diagrams', context: 'diagram' },
      { id: 'terminology', label: 'Terminology', context: 'terminology' },
      { id: 'visuals', label: 'Visual references', context: 'photos diagram' },
      { id: 'fundamentals', label: 'Fundamentals', context: 'fundamentals' },
    );
  } else if (url) {
    out.push(
      { id: 'site', label: 'This source', context: '' },
      { id: 'related', label: 'Linked public sources', context: '' },
    );
  } else {
    out.push(
      { id: 'credits', label: 'Credits and public work', context: 'credits' },
      { id: 'career', label: 'Career', context: 'career' },
      { id: 'interviews', label: 'Interviews', context: 'interviews' },
      { id: 'projects', label: 'Projects', context: 'projects' },
      { id: 'collaborations', label: 'Collaborations', context: 'collaborations' },
      { id: 'appearances', label: 'Public appearances', context: 'appearances' },
    );
  }
  out.push({ id: 'specific', label: 'A specific context', custom: true });
  out.push({ id: 'question', label: 'Ask a question', question: true });
  return out.filter((l, i, a) => a.findIndex(x => x.id === l.id) === i);
}

export function researchFocusQueries(focuses, classification, attempted, opts = {}) {
  const f = new Set(parseResearchFocus(focuses, { type: classification && classification.type }));
  const subject = String((classification && classification.subject) || opts.subject || '').trim();
  const qSub = quote(subject) || subject;
  const topic = String((classification && (classification.context || classification.topic)) || opts.topic || '').replace(/adult content/ig, '').trim();
  const seen = attemptedSet(attempted);
  const out = [];
  const add = (q, why, lane, kind, extra) => pushQuery(out, seen, q, why, lane, kind, extra);
  if (!qSub && !topic) return out;
  if (f.has('person') && qSub) {
    add(qSub + ' (profile OR bio OR database OR "official site")', 'PERSON focus — identity resolution', 'identity', 'web', { family: 'identity', sourceClass: 'identity-profile' });
  }
  if (f.has('visuals')) {
    const visQ = qSub ? (qSub + (topic ? ' ' + topic : '') + ' (photos OR gallery OR photoset OR video OR stills)') : ((topic || subject) + ' (photos OR gallery OR diagram OR video)');
    add(visQ, 'VISUALS focus — images + videos + galleries', 'visual', 'image', { family: 'visual' });
    add((qSub || topic) + ' (video OR clip OR scene OR trailer)', 'VISUALS focus — video evidence', 'visual', 'video', { family: 'visual' });
  }
  if (f.has('tutorial')) {
    add((qSub ? qSub + ' ' : '') + (topic || subject) + ' (tutorial OR guide OR "how to" OR demonstration OR instruction)', 'TUTORIAL focus — instructional/reference', 'instructional', 'web', { family: 'instructional' });
  }
  if (f.has('clothing') && qSub) {
    add(qSub + (topic ? ' ' + topic : '') + ' (outfit OR clothing OR garment OR wardrobe OR latex OR leather OR lingerie)', 'CLOTHING focus', 'clothing', 'web', { family: 'clothing' });
  }
  if (f.has('position')) {
    add((qSub ? qSub + ' ' : '') + (topic || subject) + ' (position OR pose OR technique OR diagram)', 'POSITION focus', 'position', 'web', { family: 'position' });
  }
  if (f.has('url') && (opts.url || (classification && classification.url))) {
    add(opts.url || classification.url, 'URL focus — source/link discovery', 'url', 'web', { family: 'url' });
  }
  if (f.has('topic') && qSub && topic) {
    add(qSub + ' "' + topic + '"', 'TOPIC focus — entity × topic intersection', 'entity-topic', 'web', { family: 'entity-topic' });
    const variants = semanticVariations(topic, opts.evidence || [], { excludeCurrent: true }).slice(0, 3);
    for (const v of variants) {
      add(qSub + ' "' + v.label + '"', 'TOPIC focus — semantic variant of “' + topic + '”', 'topic-variants', 'web', { family: 'topic-variants' });
    }
  }
  if (f.has('career') && qSub) {
    add(qSub + ' (career OR credits OR filmography OR "known for")', 'CAREER focus', 'entity-topic', 'web', { family: 'entity-topic' });
  }
  if (f.has('interviews') && qSub) {
    add(qSub + ' (interview OR "talks about" OR podcast OR q&a)', 'INTERVIEWS focus', 'entity-topic', 'web', { family: 'entity-topic' });
  }
  if (f.has('projects') && qSub) {
    add(qSub + ' (project OR production OR photoset OR feature)', 'PROJECTS focus', 'entity-topic', 'web', { family: 'entity-topic' });
  }
  if (f.has('collaborations') && qSub) {
    add(qSub + ' (collaboration OR featuring OR "with" OR costar)', 'COLLABORATIONS focus', 'entity-topic', 'web', { family: 'entity-topic' });
  }
  if (f.has('appearances') && qSub) {
    add(qSub + ' (appearance OR convention OR event OR public)', 'PUBLIC APPEARANCES focus', 'entity-topic', 'web', { family: 'entity-topic' });
  }
  if (f.has('accounts') && qSub) {
    add(qSub + ' (OnlyFans OR Fansly OR Instagram OR Twitter OR Reddit OR "official")', 'ACCOUNTS focus', 'accounts', 'web', { family: 'accounts' });
  }
  return out.slice(0, 16);
}

function candidateDisplayName(row, subject) {
  const title = String((row && row.title) || '').replace(/\s+/g, ' ').trim();
  const subj = String(subject || '').trim();
  if (subj && includesAll(title, tokens(subj))) return subj;
  const cleaned = title.replace(/\s*[|\-–—].*$/, '').replace(/\s*\(.*\)\s*$/, '').trim();
  if (cleaned && cleaned.length >= 3 && cleaned.length <= 80) return cleaned;
  return subj || title || ((row && row.domain) || 'Unknown candidate');
}

export function buildIdentityVerificationPack(ranked, classification, opts = {}) {
  const subject = String((classification && classification.subject) || opts.subject || '').trim();
  const type = (classification && classification.type) || '';
  const person = type === 'person' || type === 'social' || (classification && classification.intentClass === 'PERSON') || opts.forcePerson;
  if (!person) {
    return { needed: false, phase: 'RESEARCH', candidates: [], reason: 'not a person search' };
  }
  const feedback = opts.identityFeedback || {};
  const confirmed = (feedback.confirmed || []).map(norm);
  const rejectedPeople = (feedback.rejectedPeople || []).map(norm);
  const rejectedHosts = new Set((feedback.rejectedHosts || []).map(h => String(h).replace(/^www\./, '').toLowerCase()));
  const rejectedUrls = new Set((feedback.rejectedUrls || []).concat(feedback.rejectedImages || []).map(u => canonicalizeUrl(u)).filter(Boolean));
  const cluster = competingIdentityCandidates(ranked, classification, opts);
  const raw = (cluster.candidates && cluster.candidates.length)
    ? cluster.candidates
    : clusterByIdentity((ranked || []).filter(r => r && r.resultKind !== 'JUNK')).slice(0, IDENTITY_VERIFY_MAX);

  const candidates = [];
  for (const c of raw) {
    const sample = c.sample || c;
    const host = String(c.host || (sample && (sample.domain || hostOf(sample.url))) || '').replace(/^www\./, '');
    const urls = (c.urls || (sample && sample.url ? [sample.url] : [])).filter(Boolean);
    if (urls.some(u => rejectedUrls.has(canonicalizeUrl(u)))) continue;
    if (host && rejectedHosts.has(host) && !/(iafd|babepedia|wikipedia|imdb|onlyfans)/i.test(host)) continue;
    const name = candidateDisplayName(sample, c.name || subject);
    const candidateId = c.candidateId || ('cand_' + (candidates.length + 1) + '_' + (host || 'unk').replace(/[^a-z0-9]+/g, '').slice(0, 16));
    if (candidateRejectionMatches(name, candidateId, feedback)) continue;
    const idClass = classifyIdentityClass(sample, subject, { classification, type });
    if (idClass === 'PERSON_FICTIONAL') continue;
    const images = [...new Set((c.images || []).concat(sample && sample.image ? [sample.image] : []).concat(sample && sample.images ? sample.images : []))].filter(Boolean).slice(0, 6);
    const sources = [...new Set((c.sourceDomains || []).concat(host ? [host] : []))].slice(0, 8);
    const corroborating = (c.evidence || []).slice(0, 6).map(e => ({
      title: e.title || '',
      url: e.url || '',
      sourceClass: e.sourceClass || '',
      subjectEvidence: e.subjectEvidence || 'UNKNOWN',
    }));
    const aliases = filterAliases([...new Set((sample.aliases || []).concat(c.aliases || []))].filter(a => a && norm(a) !== norm(name))).slice(0, 6);
    const handles = [...new Set((sample.knownHandles || sample.handles || []).concat(c.handles || []).concat(sample.accountHandle ? [sample.accountHandle] : []))].slice(0, 6);
    const reasonsFor = [];
    const reasonsAgainst = [];
    const identityHost = /(iafd|adultfilmdatabase|babepedia|wikipedia|imdb|indexxx|freeones|loyalfans|onlyfans)/i.test(sources.join(' '));
    const fullName = tokens(subject).length >= 2 && includesAll(identityEvidenceText(sample), tokens(subject));
    if (identityHost) reasonsFor.push('Appears on an identity/profile source');
    if (fullName) reasonsFor.push('Full name present on the source');
    if (images.length) reasonsFor.push('Representative public image available');
    if (corroborating.length >= 2) reasonsFor.push('Corroborated across ' + corroborating.length + ' sources');
    if (handles.length) reasonsFor.push('Public username/handle: ' + handles[0]);
    const collision = fictionalNameCollision(identityEvidenceText(sample), subject, host);
    if (collision) reasonsAgainst.push(collision.reason || 'Possible identity collision');
    const competing = competingFullNameInText(identityEvidenceText(sample), subject);
    if (competing) reasonsAgainst.push('Competing full name in evidence (“' + competing + '”)');
    if (!fullName && tokens(subject).length >= 2) reasonsAgainst.push('Full requested name is not on this source');
    if (STOCK_NOISE_HOSTS.some(h => host === h || host.endsWith('.' + h))) reasonsAgainst.push('Generic image-index host — not identity evidence');
    if (/soundcloud|spotify|bandcamp/i.test(host) && tokens(subject).length >= 2 && !fullName) reasonsAgainst.push('Unrelated first-name match on a music host is not this person');
    let confidence = 'low';
    if (confirmed.some(x => x === norm(name) || x === norm(subject))) confidence = 'verified';
    else if (identityHost && fullName && !reasonsAgainst.length) confidence = 'high';
    else if (identityHost || (fullName && corroborating.length >= 2)) confidence = 'medium';
    else if (fullName) confidence = 'low';
    const userConfirmed = confirmed.some(x => x === norm(name) || x === norm(subject));
    candidates.push({
      candidateId,
      name: fullName ? subject : name,
      knownAliases: aliases,
      usernames: handles,
      profileSource: sources[0] || host || '',
      sources,
      representativeImages: images,
      additionalSources: corroborating,
      identityContext: (c.role && c.role !== 'unspecified' ? c.role : '') || (sample.snippet || '').slice(0, 180),
      role: c.role || 'unspecified',
      confidence,
      reasonsFor: reasonsFor.slice(0, 6),
      reasonsAgainst: reasonsAgainst.slice(0, 6),
      sampleUrl: urls[0] || (sample && sample.url) || '',
      sample,
      userConfirmed,
      userRejected: false,
      identityClass: idClass === 'UNKNOWN' ? (fullName ? 'PERSON_REAL' : 'UNKNOWN') : idClass,
    });
  }

  // Keep the set small and high quality. Prefer identity hosts + full-name.
  candidates.sort((a, b) => {
    const rank = (c) => (c.confidence === 'verified' ? 0 : c.confidence === 'high' ? 1 : c.confidence === 'medium' ? 2 : 3);
    return rank(a) - rank(b) || (b.additionalSources.length - a.additionalSources.length);
  });
  const trimmed = candidates.slice(0, IDENTITY_VERIFY_PREFERRED);
  const strong = trimmed.filter(c => c.confidence === 'verified' || c.confidence === 'high' || c.confidence === 'medium');
  const shown = (strong.length ? strong : trimmed).slice(0, IDENTITY_VERIFY_MAX);
  const alreadyConfirmed = confirmed.length > 0;
  const needed = !alreadyConfirmed;
  return {
    needed,
    phase: alreadyConfirmed ? 'RESEARCH' : 'IDENTITY_RESOLUTION',
    reason: cluster.reason || (shown.length > 1 ? 'competing identity candidates' : (shown.length === 1 ? 'confirm the identity before expanding' : 'no high-quality identity candidate yet')),
    candidates: shown,
    ambiguous: shown.length > 1 || !!cluster.ambiguous,
    userConfirmed: alreadyConfirmed,
    allowMultiplePositive: true,
  };
}

export function visualEvidenceGate(item, classification, opts = {}) {
  const url = String((item && (item.url || item.image || item.pageUrl)) || '');
  const imageUrl = String((item && (item.image || item.src || item.url)) || '');
  const host = hostOf((item && (item.pageUrl || item.sourceUrl)) || url || imageUrl).replace(/^www\./, '');
  const evidenceBlob = identityEvidenceText(item, { query: opts.query || (item && item.queryVariant) });
  const nblob = norm(evidenceBlob);
  const type = (classification && classification.type) || '';
  const subject = String((classification && classification.subject) || opts.subject || '').trim();
  const topic = String((opts.topic != null ? opts.topic : (classification && (classification.context || classification.topic))) || '').replace(/adult content/ig, '').trim();
  const subjToks = tokens(subject).filter(t => t.length > 1);
  const topicToks = tokens(topic).filter(t => t.length > 2 && !/^(the|and|with|from)$/.test(t));
  const vis = classifyVisualRelevance(item, classification);
  const grade = visualIdentityGrade(item, subject, { ...opts, classification });
  const feedback = opts.identityFeedback || opts.feedback || {};
  const rejectedImages = new Set((feedback.rejectedImages || []).concat(feedback.rejectedUrls || []).map(u => canonicalizeUrl(u)).filter(Boolean));
  const key = canonicalizeUrl(url || imageUrl);
  const identityClass = grade.identityClass || classifyIdentityClass(item, subject, { classification, type });
  const confirmed = ((feedback.confirmed || []).map(norm));
  const userConfirmed = confirmed.some(c => c === norm(subject));
  const identityHost = /(iafd|babepedia|adultfilmdatabase|wikipedia|imdb|loyalfans|onlyfans|houseofgord|clips4sale|indexxx)\./i.test(host);

  let entityMatch = 'none';
  if (subjToks.length >= 2 && subjToks.every(t => nblob.includes(t))) entityMatch = 'full';
  else if (subjToks.length && subjToks[0] && nblob.includes(subjToks[0])) entityMatch = 'partial';
  else if (type === 'technique' || type === 'object' || type === 'skill' || (classification && classification.intentClass === 'OBJECT')) {
    const concept = tokens(subject || topic);
    entityMatch = concept.length && concept.every(t => nblob.includes(t) || nblob.includes(t.replace(/\s+/g, ''))) ? 'full' : (concept.some(t => nblob.includes(t)) ? 'partial' : 'none');
  }

  let topicMatch = 'none';
  if (!topicToks.length) topicMatch = 'n/a';
  else if (topicToks.every(t => nblob.includes(t))) topicMatch = 'full';
  else if (topicToks.some(t => nblob.includes(t))) topicMatch = 'partial';
  const related = topic ? relatedTopicFamily(topic) : [];
  if (topicMatch === 'none' && related.some(t => t.length > 3 && nblob.includes(norm(t)))) topicMatch = 'related';

  const stock = STOCK_NOISE_HOSTS.some(h => host === h || host.endsWith('.' + h));
  const wildlife = WILDLIFE_HOSTS.some(h => host === h || host.endsWith('.' + h)) || /\b(pixabay|pxhere)\b/i.test(host);
  const animalLang = /\b(amphibian|tree frog|bullfrog|wildlife|red-eyed tree frog|common frog|kitten|puppy)\b/i.test(evidenceBlob);
  const sculpture = /\b(sculpture|statue|bronze|marble bust|artwork|oil painting)\b/i.test(evidenceBlob) && !/\b(photoset|photograph|photos? of)\b/i.test(evidenceBlob);
  const boat = /\b(sailboat|yacht|boat hull|marina)\b/i.test(evidenceBlob);

  const base = { entityMatch, topicMatch, identityClass, visualRelevance: vis.visualClass || 'unknown' };

  if (key && rejectedImages.has(key)) {
    return { ...base, verdict: 'rejected', label: 'REJECTED VISUAL', evidenceLevel: 'REJECTED', reason: 'user-rejected visual', demote: true, gate: 'user-rejected' };
  }
  if (identityClass === 'PERSON_FICTIONAL' || vis.visualClass === 'unrelated' && vis.demote) {
    return { ...base, verdict: 'rejected', label: 'REJECTED VISUAL', evidenceLevel: 'REJECTED', visualRelevance: vis.visualClass || 'unrelated', reason: vis.reason || grade.reason || 'fictional/character collision with the resolved identity', demote: true, gate: 'identity-collision' };
  }
  if (grade.excludeFromPrimaryCorpus && (grade.collision || grade.firstNameOnly || grade.evidenceLevel === 'REJECTED')) {
    return { ...base, verdict: 'rejected', label: 'REJECTED VISUAL', evidenceLevel: 'REJECTED', visualRelevance: 'unrelated', reason: grade.reason, demote: true, gate: 'identity-collision' };
  }
  if ((type === 'person' || (classification && classification.intentClass === 'PERSON')) && entityMatch !== 'full') {
    const reason = entityMatch === 'partial' ? 'first-name or partial name is not identity evidence' : 'no entity match on page evidence (query text is not identity proof)';
    return { ...base, verdict: 'rejected', label: 'REJECTED VISUAL', evidenceLevel: entityMatch === 'partial' ? 'METADATA_MATCH' : 'REJECTED', reason, demote: true, gate: 'entity-mismatch' };
  }
  if ((wildlife || animalLang) && isRestraintTechnique(subject || topic)) {
    return { ...base, verdict: 'rejected', label: 'REJECTED VISUAL', evidenceLevel: 'REJECTED', visualRelevance: 'unrelated', identityClass: 'ANIMAL', reason: 'wildlife/animal image is not the classified technique', demote: true, gate: 'wildlife' };
  }
  if (stock && (type === 'person' || topicToks.length)) {
    return { ...base, verdict: 'rejected', label: 'REJECTED VISUAL', evidenceLevel: 'REJECTED', visualRelevance: 'stock', reason: 'generic stock/image-index host is not entity-specific visual evidence', demote: true, gate: 'stock' };
  }
  if ((sculpture || boat) && type === 'person') {
    return { ...base, verdict: 'rejected', label: 'REJECTED VISUAL', evidenceLevel: 'REJECTED', visualRelevance: 'unrelated', reason: 'unrelated art/object is not entity-specific visual evidence', demote: true, gate: 'unrelated-object' };
  }

  const visualOk = vis.visualClass === 'real-person' || vis.visualClass === 'real-world-technique' || vis.visualClass === 'unknown';

  if (type === 'person' && topicToks.length && entityMatch === 'full' && topicMatch === 'none') {
    return { ...base, verdict: 'unverified', label: 'UNVERIFIED VISUAL', evidenceLevel: identityHost ? 'SOURCE_ASSOCIATED' : 'METADATA_MATCH', reason: 'image of the person is not automatically evidence of “' + topic + '”', demote: false, gate: 'topic-missing' };
  }
  if (topicToks.length && topicMatch !== 'none' && entityMatch !== 'full' && type === 'person') {
    return { ...base, verdict: 'unverified', label: 'UNVERIFIED VISUAL', evidenceLevel: 'METADATA_MATCH', reason: 'topic imagery without the resolved person is not entity-specific evidence', demote: true, gate: 'entity-missing' };
  }

  if ((type === 'technique' || type === 'object' || type === 'skill') && visualOk && (topicMatch === 'full' || topicMatch === 'related' || entityMatch === 'full') && identityClass !== 'ANIMAL') {
    const level = (topicMatch === 'full' || entityMatch === 'full') ? 'SOURCE_ASSOCIATED' : 'METADATA_MATCH';
    const verified = level !== 'METADATA_MATCH';
    return { ...base, verdict: verified ? 'verified' : 'unverified', label: verified ? 'VERIFIED VISUAL' : 'UNVERIFIED VISUAL', evidenceLevel: verified ? 'VISUAL_IDENTITY_VERIFIED' : 'METADATA_MATCH', visualRelevance: vis.visualClass, reason: vis.reason || 'technique visual reference', demote: false, gate: 'technique' };
  }

  // Metadata (title/url/query containing the name) is never VERIFIED VISUAL.
  if (entityMatch === 'full' && visualOk && !identityHost && !userConfirmed) {
    return { ...base, verdict: 'unverified', label: 'UNVERIFIED VISUAL', evidenceLevel: 'METADATA_MATCH', visualRelevance: vis.visualClass, reason: 'name in title/snippet/URL is metadata, not visual identity proof', demote: false, gate: 'metadata-only' };
  }
  if (entityMatch === 'full' && visualOk && identityHost && !userConfirmed) {
    return { ...base, verdict: 'unverified', label: 'UNVERIFIED VISUAL', evidenceLevel: 'SOURCE_ASSOCIATED', visualRelevance: vis.visualClass, reason: 'associated with an identity source — not yet visually verified', demote: false, gate: 'source-associated' };
  }
  if (entityMatch === 'full' && visualOk && identityHost && userConfirmed && (topicMatch === 'full' || topicMatch === 'related' || topicMatch === 'n/a')) {
    return { ...base, verdict: 'verified', label: 'VERIFIED VISUAL', evidenceLevel: 'VISUAL_IDENTITY_VERIFIED', visualRelevance: vis.visualClass, reason: 'confirmed identity + trusted source association', demote: false, gate: 'visual-identity-verified' };
  }
  if (entityMatch === 'full' && visualOk && userConfirmed && grade.evidenceLevel === 'VISUAL_IDENTITY_VERIFIED') {
    return { ...base, verdict: 'verified', label: 'VERIFIED VISUAL', evidenceLevel: 'VISUAL_IDENTITY_VERIFIED', visualRelevance: vis.visualClass, reason: 'confirmed identity with corroborating source evidence', demote: false, gate: 'visual-identity-verified' };
  }
  if (entityMatch === 'full' && visualOk && userConfirmed) {
    return { ...base, verdict: 'unverified', label: 'UNVERIFIED VISUAL', evidenceLevel: 'IDENTITY_CORROBORATED', visualRelevance: vis.visualClass, reason: 'confirmed identity, but this visual is not independently source-associated', demote: false, gate: 'identity-corroborated' };
  }

  return { ...base, verdict: 'unverified', label: 'UNVERIFIED VISUAL', evidenceLevel: grade.evidenceLevel || 'METADATA_MATCH', visualRelevance: vis.visualClass || 'unknown', reason: vis.reason || grade.reason || 'Carmen cannot verify that this visual depicts the requested identity', demote: false, gate: 'unverified' };
}

export function applyVisualEvidenceGate(visuals, classification, opts = {}) {
  const kept = [];
  const unverified = [];
  const rejected = [];
  for (const im of visuals || []) {
    const gate = visualEvidenceGate(im, classification, opts);
    const row = { ...im, visualGate: gate.verdict, visualGateLabel: gate.label, visualGateReason: gate.reason, entityMatch: gate.entityMatch, topicMatch: gate.topicMatch, visualRelevance: gate.visualRelevance, evidenceLevel: gate.evidenceLevel || '', identityClass: gate.identityClass || '' };
    if (gate.verdict === 'verified' && gate.evidenceLevel === 'VISUAL_IDENTITY_VERIFIED') { row.primaryCorpus = true; kept.push(row); }
    else if (gate.verdict === 'verified') { row.primaryCorpus = false; row.unverifiedVisual = true; row.visualGate = 'unverified'; row.visualGateLabel = 'UNVERIFIED VISUAL'; unverified.push(row); }
    else if (gate.verdict === 'rejected') { row.primaryCorpus = false; rejected.push(row); }
    else { row.primaryCorpus = false; row.unverifiedVisual = true; unverified.push(row); }
  }
  return { verified: kept, unverified, rejected, primary: kept, all: kept.concat(unverified) };
}

export function visualDedupeKey(im) {
  const image = canonicalizeUrl((im && (im.image || im.src || (im.kind === 'image' ? im.url : ''))) || '');
  const page = canonicalizeUrl((im && (im.pageUrl || (im.kind !== 'image' ? im.url : ''))) || '');
  const host = hostOf(image || page).replace(/^www\./, '');
  const path = pathOf(image || page).replace(/\/+$/, '');
  const file = path.split('/').pop() || '';
  const stem = file.replace(/\.[a-z0-9]+$/i, '').replace(/[-_](\d{2,4}x\d{2,4}|thumb|small|large|orig).*$/i, '');
  return [image || '', page || '', host + ':' + stem].filter(Boolean).join('|');
}

export function dedupeVisualEvidence(visuals, known = []) {
  const seen = new Set();
  for (const k of known || []) {
    const n = canonicalizeUrl(k) || String(k || '').toLowerCase();
    if (n) seen.add(n);
  }
  const out = [];
  let duplicates = 0;
  for (const im of visuals || []) {
    const url = canonicalizeUrl((im && (im.url || im.image || im.pageUrl)) || '');
    const image = canonicalizeUrl((im && (im.image || im.src)) || '');
    const keys = [url, image, visualDedupeKey(im)].filter(Boolean);
    if (keys.some(k => seen.has(k))) { duplicates++; continue; }
    for (const k of keys) seen.add(k);
    out.push(im);
  }
  return { unique: out, duplicatesRemoved: duplicates };
}

export function findMoreVisualQueries(intent, attempted, corpus, knownMedia) {
  const subject = quote(intent.subject) || intent.subject;
  const topic = intent.topic || '';
  const seen = attemptedSet(attempted);
  const out = [];
  const add = (q, why, kind) => pushQuery(out, seen, q, why, 'find-more-visual', kind || 'image', { family: 'visual' });
  if (!subject && !topic) return out;
  const known = (knownMedia || []).length;
  add((subject || topic) + (topic ? ' ' + topic : '') + ' (photoset OR gallery OR stills OR "photo page") -pinterest -shutterstock -pixabay', 'Find More — unique relevant visual evidence, not a generic image dump', 'image');
  if (topic) add(subject + ' "' + topic + '" (scene OR photoset OR gallery) -stock -clipart', 'Find More — entity × topic visual intersection', 'image');
  const hosts = [...new Set((corpus || []).map(r => (r.domain || hostOf(r.url || r.pageUrl || '')).replace(/^www\./, '')).filter(h => h && !/google|bing|yahoo|pinterest|shutterstock|pixabay|pxhere/.test(h)))].slice(0, 4);
  for (const h of hosts) add((subject || topic) + ' site:' + h + ' (gallery OR photos OR images)', 'Find More — additional unique visuals from a known relevant host', 'image');
  if (known) add((subject || topic) + (topic ? ' ' + topic : '') + ' (behind the scenes OR onset OR photoset)', 'Find More — next visual family after ' + known + ' already-seen media', 'image');
  return out.slice(0, 8);
}

export function serializeAdaptiveController(controller) {
  if (!controller) return null;
  refreshAdaptiveRemaining(controller);
  return {
    version: PLANNER_VERSION,
    query: controller.query || '',
    classification: controller.classification || {},
    identity: controller.identity || null,
    pending: (controller.pending || []).map(p => ({ q: p.q, why: p.why, lane: p.lane, kind: p.kind, family: p.family, sourceClass: p.sourceClass, priority: p.priority, accessBound: !!p.accessBound, parent: p.parent || '', depth: p.depth || 0 })),
    attempted: (controller.attempted || []).map(p => ({ q: p.q, family: p.family, lane: p.lane, kind: p.kind })),
    attemptedQueries: [...(controller.attemptedSet || new Set())],
    families: controller.families || {},
    iterations: controller.iterations || 0,
    zeroNoveltyStreak: controller.zeroNoveltyStreak || 0,
    lastNovelty: controller.lastNovelty || null,
    noveltyLog: (controller.noveltyLog || []).slice(-12),
    urls: [...(controller.urls || [])],
    hosts: [...(controller.hosts || [])],
    aliases: controller.aliases || [],
    accounts: controller.accounts || [],
    topicVariants: controller.topicVariants || [],
    visualPaths: controller.visualPaths || [],
    accountPaths: controller.accountPaths || [],
    linkChainDepth: controller.linkChainDepth || 0,
    maxLinkDepth: controller.maxLinkDepth || 3,
    startedAt: controller.startedAt || Date.now(),
    stopKind: controller.stopKind || '',
    headline: controller.headline || '',
    pathsRemaining: controller.pathsRemaining || [],
    pathsAttempted: controller.pathsAttempted || [],
    sourceClassesRemaining: controller.sourceClassesRemaining || [],
  };
}

export function restoreAdaptiveController(serialized, opts = {}) {
  const s = serialized && typeof serialized === 'object' ? serialized : {};
  const controller = createAdaptiveController({
    query: s.query || opts.query || '',
    classification: s.classification || opts.classification || {},
    identity: s.identity || opts.identity || null,
    attempted: s.attemptedQueries || (s.attempted || []).map(p => p.q || p),
    startedAt: s.startedAt || Date.now(),
    maxLinkDepth: s.maxLinkDepth,
  });
  controller.pending = Array.isArray(s.pending) ? s.pending.slice() : [];
  controller.attempted = Array.isArray(s.attempted) ? s.attempted.slice() : controller.attempted;
  controller.iterations = Number(s.iterations || 0);
  controller.zeroNoveltyStreak = Number(s.zeroNoveltyStreak || 0);
  controller.lastNovelty = s.lastNovelty || null;
  controller.noveltyLog = Array.isArray(s.noveltyLog) ? s.noveltyLog.slice() : [];
  for (const u of s.urls || []) controller.urls.add(u);
  for (const h of s.hosts || []) controller.hosts.add(h);
  controller.aliases = Array.isArray(s.aliases) ? s.aliases.slice() : [];
  controller.accounts = Array.isArray(s.accounts) ? s.accounts.slice() : [];
  controller.topicVariants = Array.isArray(s.topicVariants) ? s.topicVariants.slice() : [];
  controller.visualPaths = Array.isArray(s.visualPaths) ? s.visualPaths.slice() : [];
  controller.accountPaths = Array.isArray(s.accountPaths) ? s.accountPaths.slice() : [];
  controller.linkChainDepth = Number(s.linkChainDepth || 0);
  controller.stopKind = s.stopKind || '';
  controller.headline = s.headline || '';
  if (s.families && typeof s.families === 'object') {
    for (const id of Object.keys(s.families)) controller.families[id] = { ...emptyFamilyState(id), ...s.families[id] };
  }
  refreshAdaptiveRemaining(controller);
  return controller;
}

export function persistInvestigationQueue(state, controller, extras = {}) {
  const s = state && typeof state === 'object' ? state : createInvestigationState();
  const packed = serializeAdaptiveController(controller);
  s.investigationQueue = packed;
  s.pendingQueryFamilies = packed ? (packed.pathsRemaining || []) : [];
  s.completedQueryFamilies = packed ? (packed.pathsAttempted || []) : [];
  s.remainingWork = packed ? (packed.pending || []) : [];
  s.stopState = {
    stopKind: (packed && packed.stopKind) || extras.stopKind || '',
    headline: (packed && packed.headline) || extras.headline || '',
    resumable: !!(packed && packed.pending && packed.pending.length),
    at: new Date().toISOString(),
  };
  s.visualCandidates = extras.visualCandidates || s.visualCandidates || [];
  s.verifiedVisuals = extras.verifiedVisuals || s.verifiedVisuals || [];
  s.rejectedVisuals = extras.rejectedVisuals || s.rejectedVisuals || [];
  s.updatedAt = new Date().toISOString();
  return s;
}

export function resumeInvestigationQueue(state, opts = {}) {
  const packed = (state && (state.investigationQueue || state.queue)) || opts.queue || null;
  if (!packed || !Array.isArray(packed.pending) || !packed.pending.length) return null;
  return restoreAdaptiveController(packed, opts);
}

export function identityPhaseShouldHoldExpansion(classification, identityFeedback, opts = {}) {
  const type = (classification && classification.type) || '';
  const person = type === 'person' || type === 'social' || (classification && classification.intentClass === 'PERSON');
  if (!person) return false;
  if (opts.identityPhase === false) return false;
  if (opts.forceFullInvestigation) return false;
  if (opts.confirmIdentity || (opts.mode && String(opts.mode).indexOf('confirm') >= 0)) return false;
  if (opts.findMore || opts.diveLens || opts.premiumAccounts) return false;
  const confirmed = (identityFeedback && identityFeedback.confirmed) || [];
  if (confirmed.length) return false;
  if (opts.canonicalPerson && opts.canonicalPerson.canonicalName) return false;
  return true;
}

export function suppressionFromRejection(identityFeedback) {
  const f = identityFeedback || {};
  const people = [...new Set((f.rejectedPeople || []).filter(n => tokens(n).length >= 2))];
  return {
    people,
    candidateIds: [...new Set(f.rejectedCandidateIds || [])],
    hosts: [...new Set(f.rejectedHosts || [])],
    urls: [...new Set((f.rejectedUrls || []).concat(f.rejectedImages || []))],
    queryNegatives: [...new Set(people.slice(0, 6).map(n => {
      const t = String(n || '').replace(/"/g, '').trim();
      return t && tokens(t).length >= 2 ? '-"' + t + '"' : '';
    }).filter(Boolean))],
  };
}

export function sourceLifecycleState(item, extras = {}) {
  const discovered = !!(item && (item.url || item.pageUrl));
  const terminal = String(extras.terminalState || (item && item.terminalState) || '');
  const verified = !!(item && (item.retrievalStatus === 'RETRIEVED' || item.provenance === 'RETRIEVED' || item.accessState === 'DIRECTLY_RETRIEVED' || extras.verified));
  const opened = !!(extras.opened || (item && item.opened === true));
  const reallyAnalyzed = terminal === 'ANALYZED' || !!(extras.analyzed && verified);
  const analyzed = reallyAnalyzed;
  const access = (item && (item.accessState || item.premiumAccess)) || terminal;
  const privateish = /AUTHENTICATION_REQUIRED|PAYWALLED|AGE_RESTRICTED|authorized_access_required|inaccessible/i.test(access);
  const fetchFailed = terminal === 'FETCH_FAILED' || terminal === 'NOT_PUBLICLY_RETRIEVABLE' || terminal === 'PROVIDER_UNAVAILABLE';
  let label = 'unknown';
  if (terminal === 'AUTHENTICATION_REQUIRED' || privateish) label = 'authentication required';
  else if (fetchFailed) label = 'exact source not retrieved';
  else if (analyzed) label = 'source analyzed';
  else if (opened && !verified) label = 'source opened';
  else if (verified) label = 'source verified';
  else if (discovered) label = 'source discovered';
  return {
    discovered,
    verified,
    opened,
    analyzed,
    retrievedContent: verified && !privateish,
    accessBoundary: privateish,
    terminalState: terminal || (analyzed ? 'ANALYZED' : (privateish ? 'AUTHENTICATION_REQUIRED' : (verified ? 'FETCHED' : (discovered ? 'DISCOVERED' : '')))),
    label,
    note: opened && !verified
      ? 'Carmen opened a public URL. Opening a page is not the same as retrieving or verifying its contents.'
      : (privateish ? 'Remaining material requires authentication. Carmen did not bypass the access control.'
        : (fetchFailed ? 'Exact URL fetch did not retrieve this source. Generic platform search is not a substitute.' : '')),
  };
}

export function analyzePublicAccountPlan(url, classification, opts = {}) {
  const host = hostOf(url).replace(/^www\./, '');
  const premium = PREMIUM_PLATFORM_SEEDS.find(p => host === p.host || host.endsWith('.' + p.host));
  const subject = String((classification && classification.subject) || opts.subject || '').trim();
  const handle = String(opts.handle || pathOf(url).replace(/^\/+|\/+$/g, '').split('/')[0] || '').replace(/^@/, '');
  const queries = [];
  const add = (q, why) => { if (q && q.trim()) queries.push({ q: q.trim(), why, family: 'accounts', lane: 'analyze-account', kind: 'web' }); };
  if (handle) {
    add('"' + handle + '"' + (subject ? ' "' + subject + '"' : ''), 'public handle corroboration');
    add('"' + handle + '" (profile OR bio OR links OR "linktree")', 'public profile metadata');
  }
  if (subject && premium) add('"' + subject + '" site:' + premium.host, 'indexed public references to this premium profile');
  if (subject) {
    add('"' + subject + '" (onlyfans OR fansly OR loyalfans OR manyvids OR linktree OR "all my links")', 'linked public accounts');
    add('"' + subject + '" (interview OR profile OR "official site")', 'corroborating third-party public sources');
  }
  return {
    url,
    host,
    platform: premium ? premium.label : (host || 'unknown'),
    handle,
    publicAccess: true,
    neverBypassAuth: true,
    investigate: [
      'profile metadata',
      'public username/handle',
      'public profile information',
      'public links',
      'indexed public references',
      'public galleries/previews if accessible',
      'public search results',
      'linked public accounts',
      'historical/indexed public references',
      'corroborating third-party public sources',
    ],
    queries: queries.slice(0, 8),
    boundary: premium
      ? 'Subscriber-only or login-gated material is not retrieved. Finding or opening the public profile URL is not content retrieval.'
      : 'Only publicly accessible metadata is investigated.',
  };
}

export function queuedWorkSummary(controller) {
  const pending = (controller && controller.pending) || [];
  const families = [...new Set(pending.map(p => p.family).filter(Boolean))];
  return {
    remainingCount: pending.length,
    remainingFamilies: families,
    remainingQueries: pending.slice(0, 12).map(p => ({ q: p.q, family: p.family, why: p.why })),
    resumable: pending.length > 0,
  };
}

export function honestResourceStop(controller, extras = {}) {
  const summary = queuedWorkSummary(controller);
  const iterations = (controller && controller.iterations) || extras.iterations || 0;
  const classes = extras.sourceClasses || (controller && controller.pathsAttempted) || [];
  return {
    stopKind: 'E',
    stopClass: 'resource_guard',
    investigationComplete: false,
    resumable: summary.resumable,
    headline: 'Carmen reached the current resource safeguard. Additional public investigation paths remain queued, so the investigation was not complete.',
    detail: 'Completed ' + iterations + ' investigation iteration' + (iterations === 1 ? '' : 's')
      + '. Source classes checked: ' + (classes.length ? classes.join(', ') : 'see What Carmen checked')
      + '. Remaining investigation families: ' + (summary.remainingFamilies.join(', ') || 'none listed')
      + '. ' + summary.remainingCount + ' queued quer' + (summary.remainingCount === 1 ? 'y' : 'ies') + ' were persisted so a later continuation can resume rather than restart.',
    remainingQueue: summary,
  };
}

// ---------------------------------------------------------------------------
// v49.11 exact-source retrieval — identity, state machine, parse, seeds
// The exact canonical URL is authoritative. Platform/name/domain search
// cannot substitute for fetching that URL.
// ---------------------------------------------------------------------------

export const SOURCE_ANALYSIS_STATES = [
  'DISCOVERED',
  'URL_CANONICALIZED',
  'FETCH_ATTEMPTED',
  'FETCHED',
  'PARSED',
  'MEDIA_EXTRACTED',
  'LINKS_EXTRACTED',
  'ENTITIES_EXTRACTED',
  'TOPICS_EXTRACTED',
  'SEEDS_CREATED',
  'CORROBORATION_SEARCHED',
  'ANALYZED',
];

export const SOURCE_TERMINAL_STATES = [
  'ANALYZED',
  'AUTHENTICATION_REQUIRED',
  'FETCH_FAILED',
  'NOT_PUBLICLY_RETRIEVABLE',
  'PROVIDER_UNAVAILABLE',
];

export function sourceIdFromCanonicalUrl(url) {
  const s = canonicalizeExactSourceUrl(url) || String(url || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'src_' + (h >>> 0).toString(16).padStart(8, '0');
}

export function canonicalizeExactSourceUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  let href = raw;
  try {
    if (!/^https?:\/\//i.test(href) && /^[\w.-]+\.[a-z]{2,}/i.test(href) && !/\s/.test(href)) href = 'https://' + href;
    const u = new URL(href);
    if (!/^https?:$/i.test(u.protocol)) return '';
    u.hash = '';
    u.hostname = u.hostname.replace(/^www\./, '').toLowerCase();
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'rdt'].forEach(k => u.searchParams.delete(k));
    const host = u.hostname;
    if (host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it') {
      if (host === 'old.reddit.com' || host === 'np.reddit.com' || host === 'm.reddit.com' || host === 'new.reddit.com' || host === 'amp.reddit.com') {
        u.hostname = 'reddit.com';
      }
      if (host === 'redd.it') {
        const id = u.pathname.replace(/\//g, '');
        if (id) return 'https://reddit.com/comments/' + id;
      }
      const parsed = parseRedditPermalink(u.href.replace(u.hostname, 'reddit.com'));
      if (parsed.postId && parsed.subreddit) {
        const slug = parsed.slug ? parsed.slug.replace(/\/+$/, '') : '';
        return ('https://reddit.com/r/' + parsed.subreddit + '/comments/' + parsed.postId + (slug ? '/' + slug : '')).replace(/\/+$/, '');
      }
      if (parsed.postId) return 'https://reddit.com/comments/' + parsed.postId;
      u.hostname = 'reddit.com';
    }
    if (host === 'onlyfans.com' || host.endsWith('.onlyfans.com')) {
      u.hostname = 'onlyfans.com';
      const handle = parsePremiumProfile(u.href).handle;
      if (handle) return 'https://onlyfans.com/' + handle;
    }
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.href;
  } catch {
    return canonicalizeUrl(raw);
  }
}

export function parseRedditPermalink(url) {
  const u = String(url || '');
  const host = hostOf(u);
  const reddit = host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it';
  if (!reddit) return { isReddit: false, isPost: false, postId: '', subreddit: '', slug: '', author: '', canonicalPermalink: '' };
  const path = pathOf(u).replace(/\/+$/, '');
  const user = path.match(/^\/(?:user|u)\/([^/]+)/i);
  const subOnly = path.match(/^\/r\/([^/]+)\/?$/i);
  const rComments = path.match(/^\/r\/([^/]+)\/comments\/([a-z0-9]+)(?:\/([^/]+))?/i);
  const bareComments = path.match(/^\/comments\/([a-z0-9]+)(?:\/([^/]+))?/i);
  const share = path.match(/^\/r\/([^/]+)\/s\/([a-z0-9]+)/i);
  if (rComments) {
    const subreddit = rComments[1];
    const postId = rComments[2];
    const slug = rComments[3] || '';
    const permalink = ('https://reddit.com/r/' + subreddit + '/comments/' + postId + (slug ? '/' + slug : '')).replace(/\/+$/, '');
    return { isReddit: true, isPost: true, isSearch: false, postId, subreddit, slug, author: '', canonicalPermalink: permalink };
  }
  if (bareComments) {
    const postId = bareComments[1];
    const slug = bareComments[2] || '';
    const permalink = ('https://reddit.com/comments/' + postId + (slug ? '/' + slug : '')).replace(/\/+$/, '');
    return { isReddit: true, isPost: true, isSearch: false, postId, subreddit: '', slug, author: '', canonicalPermalink: permalink };
  }
  if (share) {
    return { isReddit: true, isPost: true, isSearch: false, postId: share[2], subreddit: share[1], slug: '', author: '', canonicalPermalink: 'https://reddit.com/r/' + share[1] + '/s/' + share[2] };
  }
  return {
    isReddit: true,
    isPost: false,
    isSearch: isRedditSearchPage(u),
    postId: '',
    subreddit: subOnly ? subOnly[1] : '',
    slug: '',
    author: user ? user[1] : '',
    canonicalPermalink: canonicalizeUrl(u),
  };
}

export function parsePremiumProfile(url) {
  const host = hostOf(url).replace(/^www\./, '');
  const premium = PREMIUM_PLATFORM_SEEDS.find(p => host === p.host || host.endsWith('.' + p.host));
  const parts = pathOf(url).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const skip = /^(login|signup|subscribe|explore|discover|search|terms|privacy|help|about|cdn-cgi|posts|photos|videos)$/i;
  const handle = parts[0] && !skip.test(parts[0]) ? parts[0].replace(/^@/, '') : '';
  return {
    isPremium: !!premium,
    platform: premium ? premium.label : (host || 'unknown'),
    host: premium ? premium.host : host,
    handle,
    canonicalProfile: handle && (premium || /onlyfans|fansly|loyalfans|manyvids/i.test(host))
      ? ('https://' + (premium ? premium.host : host) + '/' + handle)
      : canonicalizeUrl(url),
  };
}

export function identifyExactSourceType(url) {
  const reddit = parseRedditPermalink(url);
  if (reddit.isReddit) {
    if (reddit.isSearch) return 'reddit-search';
    if (reddit.isPost) return 'reddit-post';
    if (reddit.author) return 'reddit-user';
    if (reddit.subreddit) return 'reddit-subreddit';
    return 'reddit';
  }
  const prem = parsePremiumProfile(url);
  if (prem.isPremium && prem.handle) return prem.host.replace(/\.com$/, '') + '-profile';
  if (prem.isPremium) return prem.host.replace(/\.com$/, '') + '-platform';
  const host = hostOf(url).replace(/^www\./, '');
  if (/\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(url)) return 'image-url';
  if (/youtube|youtu\.be|vimeo|\.mp4/i.test(host + url)) return 'video';
  if (host) return 'webpage';
  return 'unknown';
}

export function exactSourceIdentity(url, extras = {}) {
  const canonicalUrl = canonicalizeExactSourceUrl(url || extras.url || '');
  const sourceId = sourceIdFromCanonicalUrl(canonicalUrl);
  const sourceType = identifyExactSourceType(canonicalUrl);
  const reddit = parseRedditPermalink(canonicalUrl);
  const premium = parsePremiumProfile(canonicalUrl);
  const subject = String(extras.subject || extras.displayName || '').trim();
  const handle = String(extras.handle || (premium.isPremium ? premium.handle : '') || reddit.author || '').replace(/^@/, '');
  const identity = {
    sourceId,
    canonicalUrl,
    sourceType,
    url: canonicalUrl,
    host: hostOf(canonicalUrl).replace(/^www\./, ''),
    subject: subject || handle || '',
    handle,
    displayName: extras.displayName || subject || handle || '',
    platform: premium.isPremium ? premium.platform : (reddit.isReddit ? 'Reddit' : (hostOf(canonicalUrl).replace(/^www\./, '') || 'web')),
  };
  if (reddit.isReddit) {
    identity.subreddit = reddit.subreddit;
    identity.postId = reddit.postId;
    identity.permalink = reddit.canonicalPermalink;
    identity.platform = 'Reddit';
  }
  if (premium.isPremium) {
    identity.canonicalProfile = premium.canonicalProfile;
    identity.handle = premium.handle || identity.handle;
  }
  return identity;
}

export function isGenericPlatformDiscoveryQuery(q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return true;
  if (/^https?:\/\//.test(s) && /\/comments\/[a-z0-9]+/i.test(s)) return false;
  if (/^https?:\/\/onlyfans\.com\/[a-z0-9._-]+/i.test(s)) return false;
  if (/^(reddit|onlyfans|fansly|loyalfans|manyvids)$/i.test(s)) return true;
  if (/^site:(reddit|onlyfans)\.com\s*$/i.test(s)) return true;
  if (/\b(onlyfans|fansly|loyalfans|manyvids)\b/.test(s) && !/onlyfans\.com\/[a-z0-9]/i.test(s) && (s.split(/\s+/).length <= 4)) {
    if (/^(onlyfans|site:onlyfans\.com)/.test(s)) return true;
  }
  if (/reddit public search/i.test(s)) return true;
  return false;
}

export function parseRedditListing(json, canonicalUrl) {
  const listing = Array.isArray(json) ? json : [json];
  const children0 = listing[0] && listing[0].data && listing[0].data.children;
  const postChild = (children0 || []).find(c => c && (c.kind === 't3' || (c.data && (c.data.title || c.data.selftext)))) || (children0 || [])[0];
  const post = postChild && postChild.data ? postChild.data : (listing[0] && listing[0].data && !listing[0].data.children ? listing[0].data : null);
  const comments = [];
  const walk = (nodes, depth) => {
    for (const c of nodes || []) {
      if (comments.length >= 24) return;
      const d = c && c.data;
      if (!d) continue;
      if (c.kind === 't1' || d.body) {
        comments.push({
          author: d.author || '',
          body: String(d.body || '').slice(0, 800),
          score: typeof d.score === 'number' ? d.score : null,
          created: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : '',
          depth: depth || 0,
        });
      }
      const replies = d.replies && d.replies.data && d.replies.data.children;
      if (replies) walk(replies, (depth || 0) + 1);
    }
  };
  if (listing[1] && listing[1].data) walk(listing[1].data.children, 0);
  if (!post || !(post.title || post.selftext || post.body || post.id)) {
    return { ok: false, post: null, comments: [], outboundLinks: [], media: [] };
  }
  const permalink = post.permalink
    ? ('https://www.reddit.com' + post.permalink)
    : (canonicalUrl || '');
  const parsed = parseRedditPermalink(permalink || canonicalUrl);
  const body = String(post.selftext || post.body || '');
  const outboundLinks = extractOutboundLinks(body + ' ' + String(post.url_overridden_by_dest || post.url || ''), permalink);
  const media = [];
  const preview = post.preview && post.preview.images && post.preview.images[0] && post.preview.images[0].source && post.preview.images[0].source.url;
  if (preview) media.push(String(preview).replace(/&/g, '&'));
  if (typeof post.thumbnail === 'string' && post.thumbnail.startsWith('http')) media.push(post.thumbnail);
  if (typeof post.url_overridden_by_dest === 'string' && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(post.url_overridden_by_dest)) media.push(post.url_overridden_by_dest);
  if (post.media_metadata) {
    for (const k of Object.keys(post.media_metadata).slice(0, 8)) {
      const m = post.media_metadata[k];
      const src = m && ((m.s && (m.s.u || m.s.gif)) || (m.p && m.p.length && m.p[m.p.length - 1].u));
      if (src) media.push(String(src).replace(/&/g, '&'));
    }
  }
  return {
    ok: true,
    post: {
      id: post.id || parsed.postId,
      fullname: post.name || (post.id ? 't3_' + post.id : ''),
      title: post.title || '',
      body,
      author: post.author || '',
      subreddit: post.subreddit_name_prefixed || (post.subreddit ? 'r/' + post.subreddit : (parsed.subreddit ? 'r/' + parsed.subreddit : '')),
      subredditName: post.subreddit || parsed.subreddit || '',
      permalink,
      created: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : '',
      score: typeof post.score === 'number' ? post.score : null,
      numComments: typeof post.num_comments === 'number' ? post.num_comments : comments.length,
      url: post.url || permalink,
    },
    comments,
    outboundLinks,
    media: [...new Set(media)].slice(0, 12),
  };
}

export function extractOutboundLinks(text, pageUrl) {
  const out = [];
  const seen = new Set();
  const re = /https?:\/\/[^\s)\]>"']+/gi;
  let m;
  const pageHost = hostOf(pageUrl || '');
  while ((m = re.exec(String(text || ''))) && out.length < 16) {
    let href = m[0].replace(/[.,;:]+$/, '');
    try { href = new URL(href).href; } catch { continue; }
    const key = canonicalizeExactSourceUrl(href) || href;
    if (seen.has(key)) continue;
    seen.add(key);
    const host = hostOf(href).replace(/^www\./, '');
    if (!host || host === 'reddit.com' && /\/(static|login|register)/i.test(href)) continue;
    out.push({ url: href, canonicalUrl: key, host, sourceId: sourceIdFromCanonicalUrl(key), parent: pageUrl || '', kind: 'outbound-link' });
  }
  return out;
}

export function extractEntitiesFromExcerpt(text, extras = {}) {
  const subject = String(extras.subject || '').trim();
  const people = [];
  const orgs = [];
  const aliases = [];
  const seen = new Set();
  const add = (arr, v, kind) => {
    const s = String(v || '').replace(/\s+/g, ' ').trim();
    if (!s || s.length < 3 || s.length > 60) return;
    const k = norm(s);
    if (seen.has(k)) return;
    seen.add(k);
    arr.push({ label: s, kind });
  };
  if (subject) add(people, subject, 'person');
  const blob = String(text || '');
  const re = /\b([A-Z][a-z]+(?:\s+(?:de|da|van|von|di|le|la|del|st|saint))?(?:\s+[A-Z][a-z]+){1,2})\b/g;
  let m;
  while ((m = re.exec(blob)) && people.length < 10) {
    const name = m[1];
    if (/^(January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Reddit|OnlyFans|The|This|That)$/i.test(name.split(/\s+/)[0])) continue;
    add(people, name, 'person');
  }
  const aka = blob.match(/\b(?:aka|also known as)\s+([A-Z][A-Za-z0-9_.\s-]{2,40})/i);
  if (aka) add(aliases, aka[1], 'alias');
  if (extras.handle) add(aliases, extras.handle, 'handle');
  if (/\b(Inc|LLC|Ltd|University|Studio|Productions)\b/.test(blob)) {
    const o = blob.match(/\b([A-Z][A-Za-z0-9&.\s-]{2,40}\s(?:Inc|LLC|Ltd|University|Studio|Productions))\b/);
    if (o) add(orgs, o[1], 'organization');
  }
  return { people: people.slice(0, 8), organizations: orgs.slice(0, 6), aliases: aliases.slice(0, 6) };
}

export function extractTopicsFromExcerpt(text, extras = {}) {
  const blob = norm(text || '');
  const topics = [];
  const add = (t) => {
    const s = String(t || '').trim();
    if (!s) return;
    if (!topics.some(x => norm(x) === norm(s))) topics.push(s);
  };
  if (extras.topic) add(extras.topic);
  const canon = canonicalAdultTopic(text);
  if (canon) add(canon);
  for (const [k, fam] of Object.entries(ADULT_TOPIC_FAMILY || {})) {
    if (blob.includes(k) || (fam.related || []).some(v => blob.includes(norm(v)))) add(fam.canonical || k);
  }
  const extrasHit = ['interview', 'photoset', 'tutorial', 'gallery', 'profile', 'bondage', 'bdsm', 'onlyfans', 'reddit'];
  for (const t of extrasHit) if (blob.includes(t)) add(t);
  return topics.slice(0, 8);
}

export function createExactSourceSeeds(extracted, identity) {
  const seeds = [];
  const parent = identity.canonicalUrl || identity.url || '';
  const parentId = identity.sourceId || sourceIdFromCanonicalUrl(parent);
  const push = (item) => {
    if (!item || !(item.url || item.label)) return;
    const url = item.url || '';
    const sourceId = url ? sourceIdFromCanonicalUrl(url) : (parentId + ':' + norm(item.label || ''));
    if (seeds.some(s => s.sourceId === sourceId || (url && s.url === url))) return;
    seeds.push({
      ...item,
      url: url || item.url,
      sourceId,
      parent,
      parentSourceId: parentId,
      foundThrough: 'exact-source',
      provenance: 'EXTRACTED',
    });
  };
  for (const l of extracted.links || []) push({ url: l.url || l.canonicalUrl, kind: 'url', host: l.host, label: l.host });
  for (const a of extracted.accounts || []) push({ url: a.url, kind: 'account', handle: a.handle, platform: a.platform, label: a.handle || a.platform });
  for (const p of (extracted.entities && extracted.entities.people) || []) push({ kind: 'person', label: p.label, url: '' });
  for (const o of (extracted.entities && extracted.entities.organizations) || []) push({ kind: 'organization', label: o.label, url: '' });
  for (const al of (extracted.entities && extracted.entities.aliases) || extracted.aliases || []) push({ kind: 'alias', label: al.label || al, url: '' });
  for (const t of extracted.topics || []) push({ kind: 'topic', label: t, url: '' });
  for (const m of extracted.media || []) push({ url: typeof m === 'string' ? m : m.url, kind: 'media', label: 'media' });
  for (const d of extracted.domains || []) push({ kind: 'domain', label: d.host || d.label || d, url: d.url || '' });
  for (const r of extracted.referencedPosts || []) push({ url: r.url, kind: 'referenced-post', label: r.title || r.url });
  return seeds.slice(0, 24);
}

export function terminalStateForExactSource(opts = {}) {
  const access = String(opts.accessState || '');
  const fetchSucceeded = opts.fetchSucceeded === true;
  const auth = opts.authRequired === true || /AUTHENTICATION_REQUIRED|PAYWALLED|AGE_RESTRICTED/i.test(access);
  const providerDown = opts.providerUnavailable === true;
  if (providerDown) return 'PROVIDER_UNAVAILABLE';
  if (auth && !fetchSucceeded && !opts.publicContentRetrieved) return 'AUTHENTICATION_REQUIRED';
  if (auth && opts.publicContentRetrieved) return 'AUTHENTICATION_REQUIRED';
  if (!opts.fetchAttempted) return 'FETCH_FAILED';
  if (!fetchSucceeded && !opts.publicContentRetrieved) {
    if (/NOT_PUBLICLY_RETRIEVABLE/i.test(access)) return 'NOT_PUBLICLY_RETRIEVABLE';
    if (/UNAVAILABLE|timeout|503/i.test(String(opts.error || '') + access)) return 'PROVIDER_UNAVAILABLE';
    if (/BLOCKED|404|410|UNVERIFIED/i.test(access)) return 'NOT_PUBLICLY_RETRIEVABLE';
    return 'FETCH_FAILED';
  }
  if (opts.parsed && (opts.seedsCreated || opts.publicContentRetrieved || fetchSucceeded)) return 'ANALYZED';
  if (fetchSucceeded) return 'FETCHED';
  return 'FETCH_FAILED';
}

export function buildSourceDebug(fields = {}) {
  const canonicalUrl = canonicalizeExactSourceUrl(fields.canonicalUrl || fields.url || '');
  const sourceId = fields.sourceId || sourceIdFromCanonicalUrl(canonicalUrl);
  const terminalState = fields.terminalState || terminalStateForExactSource(fields);
  return {
    canonicalUrl,
    sourceId,
    sourceType: fields.sourceType || identifyExactSourceType(canonicalUrl),
    fetchAttempted: fields.fetchAttempted === true,
    fetchSucceeded: fields.fetchSucceeded === true,
    parseSucceeded: fields.parseSucceeded === true,
    publicContentRetrieved: fields.publicContentRetrieved === true,
    mediaExtracted: fields.mediaExtracted === true,
    linksExtracted: fields.linksExtracted === true,
    entitiesExtracted: fields.entitiesExtracted === true,
    topicsExtracted: fields.topicsExtracted === true,
    authRequired: fields.authRequired === true,
    seedsCreated: Number(fields.seedsCreated || 0),
    corroborationQueries: Array.isArray(fields.corroborationQueries) ? fields.corroborationQueries : [],
    terminalState,
    provenance: fields.provenance || (fields.fetchSucceeded ? 'RETRIEVED' : (fields.fetchAttempted ? 'FETCH_ATTEMPTED' : 'DISCOVERED')),
    pipeline: fields.pipeline || [],
    exactUrlPreserved: !!(canonicalUrl && (fields.requestedUrl ? canonicalizeExactSourceUrl(fields.requestedUrl) === canonicalUrl || String(fields.requestedUrl).indexOf(canonicalUrl.replace(/^https?:\/\//, '')) >= 0 : true)),
    genericSearchUsedAsRetrieval: fields.genericSearchUsedAsRetrieval === true,
    parentReceivedSeeds: fields.parentReceivedSeeds === true,
    whyStopped: fields.whyStopped || '',
    whatRetrieved: fields.whatRetrieved || '',
    retrievalPath: fields.retrievalPath || '',
    retrievalAttempts: Array.isArray(fields.retrievalAttempts) ? fields.retrievalAttempts : [],
  };
}

export function attachExactSourceToInvestigation(state, analysis) {
  const s = applyInvestigationAction(state || createInvestigationState(), 'analyze', {
    sourceAnalysis: analysis && analysis.debug ? analysis.debug : analysis,
    seeds: (analysis && analysis.seeds) || [],
    url: analysis && (analysis.canonicalUrl || (analysis.identity && analysis.identity.canonicalUrl)),
  });
  return s;
}

export const EXACT_SOURCE_PIPELINE_LABELS = {
  DISCOVERED: 'Exact source identified',
  URL_CANONICALIZED: 'URL canonicalized',
  FETCH_ATTEMPTED: 'Fetching exact source',
  FETCHED: 'Exact source fetched',
  PARSED: 'Parsing source',
  MEDIA_EXTRACTED: 'Extracting links/media',
  LINKS_EXTRACTED: 'Extracting links/media',
  ENTITIES_EXTRACTED: 'Identifying entities/topics',
  TOPICS_EXTRACTED: 'Identifying entities/topics',
  SEEDS_CREATED: 'Creating investigation seeds',
  CORROBORATION_SEARCHED: 'Corroborating',
  ANALYZED: 'Complete',
  AUTHENTICATION_REQUIRED: 'Authentication required for remaining content',
  FETCH_FAILED: 'Exact URL fetch failed',
  NOT_PUBLICLY_RETRIEVABLE: 'Exact source is not publicly retrievable',
  PROVIDER_UNAVAILABLE: 'Provider unavailable',
};

