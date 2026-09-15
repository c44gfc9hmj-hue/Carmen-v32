// v49.1 regression protections that v49.2 must keep.
import { readFileSync } from 'node:fs';
import {
  uniqueAdd,
  isQueryEchoTitle,
  isRedditSearchPage,
  competingIdentityCandidates,
  composeInvestigationQuery,
  classifyQuery,
  rankResults,
  extraContext,
  identityIsAmbiguous,
} from './worker.js';
import worker from './worker.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

const workerSrc = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
const appSrc = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');

console.log('--- v49.1 source contracts still present ---');
{
  assert(/identity-safe|person-rail|That’s the one/.test(appSrc), 'identity-safe image rail / That’s the one');
  assert(/isQueryEchoTitle/.test(workerSrc), 'query-echo rejection helper');
  assert(/competingIdentityCandidates/.test(workerSrc), 'competing identity candidates');
  assert(/confirmedIdentity/.test(appSrc) && /rejectedPeople/.test(appSrc), 'positive/negative identity feedback');
  assert(/homeImageBtn/.test(html) || /Inspect an image instead/.test(html), 'Home image investigation');
  assert(/subjectEvidence|intersection/.test(workerSrc), 'subject+topic intersection');
  assert(/isRedditSearchPage/.test(workerSrc), 'Reddit search-page rejection');
  assert(/mergeInvestigationEvidence/.test(workerSrc), 'merge-not-replace');
  assert(/annotateProvenance/.test(workerSrc) && /originalSource/.test(workerSrc), 'host/creator/origin separation');
  assert(/analyzeEvidenceObject/.test(workerSrc), 'Analyze URL/evidence handling');
  assert(/Teach me/.test(appSrc) && /runLearn/.test(appSrc), 'Teach Me grounding');
  assert(/hardNewInvestigation/.test(appSrc), 'hard New Investigation isolation');
  assert(/progressiveTimer/.test(appSrc), 'progressive retrieval');
  assert(/cannot currently inspect the actual video frames/.test(appSrc), 'video analysis honesty');
}

console.log('--- v49.1 query-echo rejection ---');
{
  assert(isQueryEchoTitle('Drea Morgan bondage', 'Drea Morgan bondage') === true, 'exact query-echo title rejected');
  assert(isQueryEchoTitle('Drea Morgan in a metal bondage scene', 'Drea Morgan bondage') === false, 'real title is not echo');
  const results = [], seen = new Set();
  const dropped = uniqueAdd(results, seen, {
    title: 'Drea Morgan bondage',
    url: 'https://example.com/search?q=drea',
    queryVariant: 'Drea Morgan bondage',
    snippet: 'search results',
  });
  assert(dropped === false, 'uniqueAdd drops query-echo titles');
}

console.log('--- v49.1 Reddit search pages are not evidence ---');
{
  assert(isRedditSearchPage('https://www.reddit.com/search/?q=drea', 'Reddit public search') === true, 'reddit /search is a search page');
  assert(isRedditSearchPage('https://www.reddit.com/r/example/comments/abc123/hello/', 'A real thread') === false, 'comment thread is not a search page');
  const results = [], seen = new Set();
  const dropped = uniqueAdd(results, seen, {
    title: 'Reddit public search',
    url: 'https://www.reddit.com/search/?q=drea+morgan',
    source: 'DuckDuckGo',
  });
  assert(dropped === false && results.length === 0, 'uniqueAdd drops Reddit search pages');
  const kept = uniqueAdd(results, seen, {
    title: 'Discussion thread',
    url: 'https://www.reddit.com/r/example/comments/abc123/hello/',
    source: 'DuckDuckGo',
  });
  assert(kept === true, 'actual Reddit thread is kept');
}

console.log('--- v49.1 competing identity candidates ---');
{
  const ranked = [
    { title: 'Ashley Anderson actress', url: 'https://en.wikipedia.org/wiki/Ashley_Anderson', sourceClass: 'ENCYCLOPEDIA', resultKind: 'IDENTITY_MATCH' },
    { title: 'Ashley Anderson realtor', url: 'https://example-realtor.com/ashley-anderson', sourceClass: 'PUBLIC_PROFILE', resultKind: 'WEAK_MATCH' },
  ];
  const c = competingIdentityCandidates(ranked, { type: 'person', subject: 'Ashley Anderson' });
  assert(c.ambiguous === true, 'two host clusters for a common name are ambiguous');
  const strong = competingIdentityCandidates([
    { title: 'Drea Morgan', url: 'https://www.iafd.com/person.rme/perfid=drea', sourceClass: 'DATABASE', evidence: { subjectEvidence: 'strong' }, resultKind: 'IDENTITY_MATCH' },
  ], { type: 'person', subject: 'Drea Morgan' });
  assert(strong.ambiguous === false, 'strong corroborating identity is not dumped as ambiguous');
  assert(identityIsAmbiguous(strong.candidates, { type: 'person', subject: 'Drea Morgan' }) === false || strong.ambiguous === false, 'identityIsAmbiguous uses competing candidates');
}

console.log('--- v49.1 compose still keeps subject ---');
{
  assert(composeInvestigationQuery('bondage', 'Drea Morgan', 'bondage') === 'Drea Morgan bondage', 'topic-only becomes entity + topic');
  const cls = classifyQuery('House of Gord');
  assert(cls.type === 'website', 'House of Gord classifies as website, not a person');
}

console.log('--- v49.1 frontend isolation ---');
{
  assert(/hardNewInvestigation/.test(appSrc) && /lastTopicMap = null/.test(appSrc), 'hard reset clears topic map');
  assert(/rejectedPeople = \[\]/.test(appSrc) && /confirmedIdentity = \[\]/.test(appSrc), 'hard reset clears identity feedback');
  assert(/inFlightController/.test(appSrc), 'in-flight cancellation exists');
  assert(/id="newInvestigationBtn"/.test(html), 'New investigation button in chrome');
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
