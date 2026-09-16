
// ---------------------------------------------------------------------------
// v49.9 identity verification + persistent queue + visual evidence gate
// Extends the v49.8 adaptive controller. Does not replace retrieval.
// ---------------------------------------------------------------------------

export const RESEARCH_FOCUS_IDS = ['person', 'visuals', 'tutorial', 'clothing', 'position', 'url', 'topic'];
export const IDENTITY_VERIFY_MAX = 6;
export const IDENTITY_VERIFY_PREFERRED = 4;
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
  if (!f.size) return INVESTIGATION_PATH_FAMILIES.slice();
  families.push('source-classes', 'link-chain', 'corroboration');
  return [...new Set(families)];
}

export function adaptiveLensesForFocus(focuses, classification) {
  const f = new Set(parseResearchFocus(focuses, { type: classification && classification.type }));
  const person = f.has('person') || (classification && classification.type === 'person');
  const visuals = f.has('visuals');
  const tutorial = f.has('tutorial');
  const topic = f.has('topic') || !!(classification && (classification.context || classification.topic));
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
      { id: 'credits', label: 'Credits and public work', context: 'credits filmography' },
      { id: 'career', label: 'Career', context: 'career' },
      { id: 'interviews', label: 'Interviews', context: 'interviews' },
      { id: 'projects', label: 'Projects', context: 'projects' },
      { id: 'collaborations', label: 'Collaborations', context: 'collaborations' },
      { id: 'appearances', label: 'Public appearances', context: 'appearances' },
    );
  } else if (visuals || clothing || position) {
    out.push(
      { id: 'visuals', label: 'Visual references', context: 'photos gallery video' },
      { id: 'tutorials', label: 'Instructional / reference', context: 'tutorial' },
      { id: 'variations', label: 'Variations', context: 'variations' },
    );
  } else if (tutorial) {
    out.push(
      { id: 'tutorials', label: 'Tutorials', context: 'tutorial' },
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
    if (host && rejectedHosts.has(host)) continue;
    const name = candidateDisplayName(sample, c.name || subject);
    if (rejectedPeople.some(p => p && (norm(name).includes(p) || p.includes(norm(name))))) continue;
    const images = [...new Set((c.images || []).concat(sample && sample.image ? [sample.image] : []).concat(sample && sample.images ? sample.images : []))].filter(Boolean).slice(0, 6);
    const sources = [...new Set((c.sourceDomains || []).concat(host ? [host] : []))].slice(0, 8);
    const corroborating = (c.evidence || []).slice(0, 6).map(e => ({
      title: e.title || '',
      url: e.url || '',
      sourceClass: e.sourceClass || '',
      subjectEvidence: e.subjectEvidence || 'UNKNOWN',
    }));
    const aliases = [...new Set((sample.aliases || []).concat(c.aliases || []))].filter(a => a && norm(a) !== norm(name)).slice(0, 6);
    const handles = [...new Set((sample.knownHandles || sample.handles || []).concat(c.handles || []).concat(sample.accountHandle ? [sample.accountHandle] : []))].slice(0, 6);
    const reasonsFor = [];
    const reasonsAgainst = [];
    const identityHost = /(iafd|adultfilmdatabase|babepedia|wikipedia|imdb|indexxx|freeones|loyalfans|onlyfans)/i.test(sources.join(' '));
    const fullName = tokens(subject).length >= 2 && includesAll((sample.title || '') + ' ' + (sample.url || ''), tokens(subject));
    if (identityHost) reasonsFor.push('Appears on an identity/profile source');
    if (fullName) reasonsFor.push('Full name present on the source');
    if (images.length) reasonsFor.push('Representative public image available');
    if (corroborating.length >= 2) reasonsFor.push('Corroborated across ' + corroborating.length + ' sources');
    if (handles.length) reasonsFor.push('Public username/handle: ' + handles[0]);
    const collision = fictionalNameCollision((sample.title || '') + ' ' + (sample.snippet || ''), subject, host);
    if (collision) reasonsAgainst.push(collision.reason || 'Possible identity collision');
    const competing = competingFullNameInText((sample.title || '') + ' ' + (sample.snippet || ''), subject);
    if (competing) reasonsAgainst.push('Competing full name in evidence (“' + competing + '”)');
    if (!fullName && tokens(subject).length >= 2) reasonsAgainst.push('Full requested name is not on this source');
    if (STOCK_NOISE_HOSTS.some(h => host === h || host.endsWith('.' + h))) reasonsAgainst.push('Generic image-index host — not identity evidence');
    let confidence = 'low';
    if (confirmed.some(x => x === norm(name) || x === norm(subject))) confidence = 'verified';
    else if (identityHost && fullName && !reasonsAgainst.length) confidence = 'high';
    else if (identityHost || (fullName && corroborating.length >= 2)) confidence = 'medium';
    else if (fullName) confidence = 'low';
    const userConfirmed = confirmed.some(x => x === norm(name) || x === norm(subject));
    candidates.push({
      candidateId: c.candidateId || ('cand_' + (candidates.length + 1) + '_' + (host || 'unk').replace(/[^a-z0-9]+/g, '').slice(0, 16)),
      name,
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
  const host = hostOf(url || imageUrl).replace(/^www\./, '');
  const blob = String((item && (item.title || '')) + ' ' + ((item && (item.snippet || item.caption || item.reason || '')) || '') + ' ' + url);
  const nblob = norm(blob);
  const type = (classification && classification.type) || '';
  const subject = String((classification && classification.subject) || opts.subject || '').trim();
  const topic = String((opts.topic != null ? opts.topic : (classification && (classification.context || classification.topic))) || '').replace(/adult content/ig, '').trim();
  const subjToks = tokens(subject).filter(t => t.length > 1);
  const topicToks = tokens(topic).filter(t => t.length > 2 && !/^(the|and|with|from)$/.test(t));
  const vis = classifyVisualRelevance(item, classification);
  const grade = visualIdentityGrade(item, subject, opts);
  const feedback = opts.identityFeedback || opts.feedback || {};
  const rejectedImages = new Set((feedback.rejectedImages || []).concat(feedback.rejectedUrls || []).map(u => canonicalizeUrl(u)).filter(Boolean));
  const key = canonicalizeUrl(url || imageUrl);

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
  const animalLang = /\b(amphibian|tree frog|bullfrog|wildlife|red-eyed tree frog|common frog|kitten|puppy)\b/i.test(blob);
  const sculpture = /\b(sculpture|statue|bronze|marble bust|artwork|oil painting)\b/i.test(blob) && !/\b(photoset|photograph|photos? of)\b/i.test(blob);
  const boat = /\b(sailboat|yacht|boat hull|marina)\b/i.test(blob);

  const reasons = [];
  let verdict = 'unverified';
  let label = 'UNVERIFIED VISUAL';

  if (key && rejectedImages.has(key)) {
    return { verdict: 'rejected', label: 'REJECTED VISUAL', entityMatch, topicMatch, visualRelevance: 'rejected', reason: 'user-rejected visual', demote: true, gate: 'user-rejected' };
  }
  if (vis.demote && vis.visualClass === 'unrelated') {
    return { verdict: 'rejected', label: 'REJECTED VISUAL', entityMatch, topicMatch, visualRelevance: vis.visualClass, reason: vis.reason, demote: true, gate: 'unrelated-class' };
  }
  if (grade.excludeFromPrimaryCorpus && (grade.collision || grade.firstNameOnly)) {
    return { verdict: 'rejected', label: 'REJECTED VISUAL', entityMatch, topicMatch, visualRelevance: 'unrelated', reason: grade.reason, demote: true, gate: 'identity-collision' };
  }
  if ((type === 'person' || (classification && classification.intentClass === 'PERSON')) && entityMatch !== 'full') {
    reasons.push(entityMatch === 'partial' ? 'first-name or partial name is not identity evidence' : 'no entity match on this visual');
    return { verdict: 'rejected', label: 'REJECTED VISUAL', entityMatch, topicMatch, visualRelevance: vis.visualClass || 'unverified', reason: reasons.join('; '), demote: true, gate: 'entity-mismatch' };
  }
  if ((wildlife || animalLang) && isRestraintTechnique(subject || topic)) {
    return { verdict: 'rejected', label: 'REJECTED VISUAL', entityMatch, topicMatch, visualRelevance: 'unrelated', reason: 'wildlife/animal image is not the classified technique', demote: true, gate: 'wildlife' };
  }
  if (stock && (type === 'person' || topicToks.length)) {
    reasons.push('generic stock/image-index host is not entity-specific visual evidence');
    verdict = 'rejected';
    label = 'REJECTED VISUAL';
    return { verdict, label, entityMatch, topicMatch, visualRelevance: 'stock', reason: reasons.join('; '), demote: true, gate: 'stock' };
  }
  if ((sculpture || boat) && type === 'person') {
    return { verdict: 'rejected', label: 'REJECTED VISUAL', entityMatch, topicMatch, visualRelevance: 'unrelated', reason: 'unrelated art/object is not entity-specific visual evidence', demote: true, gate: 'unrelated-object' };
  }

  const visualOk = vis.visualClass === 'real-person' || vis.visualClass === 'real-world-technique' || vis.visualClass === 'unknown';
  if (type === 'person' && topicToks.length && entityMatch === 'full' && (topicMatch === 'none')) {
    reasons.push('image of the person is not automatically evidence of “' + topic + '”');
    return { verdict: 'unverified', label: 'UNVERIFIED VISUAL', entityMatch, topicMatch, visualRelevance: vis.visualClass || 'unknown', reason: reasons.join('; '), demote: false, gate: 'topic-missing' };
  }
  if (topicToks.length && topicMatch !== 'none' && entityMatch !== 'full' && type === 'person') {
    reasons.push('topic imagery without the resolved person is not entity-specific evidence');
    return { verdict: 'unverified', label: 'UNVERIFIED VISUAL', entityMatch, topicMatch, visualRelevance: vis.visualClass || 'unknown', reason: reasons.join('; '), demote: true, gate: 'entity-missing' };
  }
  if (entityMatch === 'full' && (topicMatch === 'full' || topicMatch === 'related' || topicMatch === 'n/a') && visualOk) {
    return { verdict: 'verified', label: 'VERIFIED VISUAL', entityMatch, topicMatch, visualRelevance: vis.visualClass, reason: 'entity match + query/topic match + visual relevance', demote: false, gate: 'pass' };
  }
  if (entityMatch === 'full' && visualOk && !topicToks.length) {
    return { verdict: 'verified', label: 'VERIFIED VISUAL', entityMatch, topicMatch, visualRelevance: vis.visualClass, reason: 'entity-associated visual (no topic requested)', demote: false, gate: 'entity-only' };
  }
  if ((type === 'technique' || type === 'object' || type === 'skill') && visualOk && (topicMatch === 'full' || topicMatch === 'related' || entityMatch === 'full')) {
    return { verdict: 'verified', label: 'VERIFIED VISUAL', entityMatch, topicMatch, visualRelevance: vis.visualClass, reason: vis.reason || 'technique visual reference', demote: false, gate: 'technique' };
  }
  reasons.push(vis.reason || grade.reason || 'Carmen cannot verify that this visual depicts the requested entity/topic intersection');
  return { verdict: 'unverified', label: 'UNVERIFIED VISUAL', entityMatch, topicMatch, visualRelevance: vis.visualClass || 'unknown', reason: reasons.join('; '), demote: false, gate: 'unverified' };
}

export function applyVisualEvidenceGate(visuals, classification, opts = {}) {
  const kept = [];
  const unverified = [];
  const rejected = [];
  for (const im of visuals || []) {
    const gate = visualEvidenceGate(im, classification, opts);
    const row = { ...im, visualGate: gate.verdict, visualGateLabel: gate.label, visualGateReason: gate.reason, entityMatch: gate.entityMatch, topicMatch: gate.topicMatch, visualRelevance: gate.visualRelevance };
    if (gate.verdict === 'verified') { row.primaryCorpus = true; kept.push(row); }
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
  if (opts.forceFullInvestigation) return false;
  if (opts.confirmIdentity || (opts.mode && String(opts.mode).indexOf('confirm') >= 0)) return false;
  if (opts.findMore || opts.diveLens || opts.premiumAccounts) return false;
  const confirmed = (identityFeedback && identityFeedback.confirmed) || [];
  if (confirmed.length) return false;
  if (opts.keepTopic && classification && (classification.context || classification.topic) && confirmed.length) return false;
  return true;
}

export function suppressionFromRejection(identityFeedback) {
  const f = identityFeedback || {};
  return {
    people: [...new Set(f.rejectedPeople || [])],
    hosts: [...new Set(f.rejectedHosts || [])],
    urls: [...new Set((f.rejectedUrls || []).concat(f.rejectedImages || []))],
    queryNegatives: [...new Set((f.rejectedPeople || []).slice(0, 6).map(n => {
      const t = String(n || '').replace(/"/g, '').trim();
      return t ? '-"' + t + '"' : '';
    }).filter(Boolean))],
  };
}

export function sourceLifecycleState(item, extras = {}) {
  const discovered = !!(item && (item.url || item.pageUrl));
  const verified = !!(item && (item.retrievalStatus === 'RETRIEVED' || item.provenance === 'RETRIEVED' || item.accessState === 'DIRECTLY_RETRIEVED' || extras.verified));
  const opened = !!(extras.opened || (item && item.opened === true));
  const analyzed = !!(extras.analyzed || (item && item.analyzed === true));
  const access = (item && (item.accessState || item.premiumAccess)) || '';
  const privateish = /AUTHENTICATION_REQUIRED|PAYWALLED|AGE_RESTRICTED|authorized_access_required|inaccessible/i.test(access);
  return {
    discovered,
    verified,
    opened,
    analyzed,
    retrievedContent: verified && !privateish,
    accessBoundary: privateish,
    label: analyzed ? 'source analyzed' : (opened ? 'source opened' : (verified ? 'source verified' : (discovered ? 'source discovered' : 'unknown'))),
    note: opened && !verified
      ? 'Carmen opened a public URL. Opening a page is not the same as retrieving or verifying its contents.'
      : (privateish ? 'Remaining material requires authentication. Carmen did not bypass the access control.' : ''),
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
    headline: 'Carmen reached the current resource safeguard. Additional public investigation paths remain queued.',
    detail: 'Completed ' + iterations + ' investigation iteration' + (iterations === 1 ? '' : 's')
      + '. Source classes checked: ' + (classes.length ? classes.join(', ') : 'see What Carmen checked')
      + '. Remaining investigation families: ' + (summary.remainingFamilies.join(', ') || 'none listed')
      + '. ' + summary.remainingCount + ' queued quer' + (summary.remainingCount === 1 ? 'y' : 'ies') + ' were persisted so a later continuation can resume rather than restart.',
    remainingQueue: summary,
  };
}
