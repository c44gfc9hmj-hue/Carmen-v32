// v49.4 surgical retrieval / identity fixes.
// UNIT/REGRESSION — fixtures and planner execution order. Not live production.
import {
  parseInvestigationIntent,
  buildTopicMap,
  plannerLaneQueries,
  plannedWebExecutionSequence,
  retrievalExecutionOrder,
  resolveIdentityAnchor,
  subsequentRetrievalFromFeedback,
  applyIdentityFeedback,
  applyInvestigationAction,
  createInvestigationState,
  extractClothingEvidence,
  isClothingColorFalsePositive,
  nextFindMoreLane,
  findMoreQueries,
  additiveMerge,
  evidenceForResult,
  evidenceBuckets,
  annotateProvenance,
  auditStructuredResults,
  fixtureItems,
  ADULT_SOURCE_CLASSES,
  PRIMARY_DIVE_LENSES,
  NO_NEW_SOURCES_MESSAGE,
  competingFullNameInText,
  isRedditSearchPage,
  isQueryEchoTitle,
  canonicalizeUrl,
} from './investigation-planner.js';
import worker from './worker.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}
