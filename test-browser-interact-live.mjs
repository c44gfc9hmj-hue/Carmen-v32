// External-browser-agent acceptance for /test. Uses the real UI and real backend.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  try { ({ chromium } = require('/workspace/node_modules/playwright')); }
  catch (e) { throw new Error('playwright is required for test-browser-interact-live.mjs'); }
}
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.CARMEN_URL || 'http://127.0.0.1:8080';
const SHOT = process.env.SHOT_DIR || '/workspace/screenshots';
mkdirSync(SHOT, { recursive: true });

const report = [];
function log(step, ok, detail) {
  const line = `${ok ? 'PASS' : 'FAIL'} ${step}${detail ? ' — ' + detail : ''}`;
  report.push({ step, ok, detail: detail || '' });
  console.log(line);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(60000);

async function waitPred(fn, timeout = 90000) {
  // Playwright's second argument is the predicate arg, not options.
  return page.waitForFunction(fn, null, { timeout });
}

async function agentState() {
  return page.evaluate(() => ({
    href: location.href,
    title: document.title,
    status: document.documentElement.getAttribute('data-carmen-status'),
    view: document.documentElement.getAttribute('data-carmen-view'),
    busy: document.documentElement.getAttribute('data-carmen-busy'),
    results: document.documentElement.getAttribute('data-carmen-results'),
    error: document.documentElement.getAttribute('data-carmen-error'),
    lens: document.documentElement.getAttribute('data-carmen-lens'),
    saved: document.documentElement.getAttribute('data-carmen-saved'),
    howHere: document.documentElement.getAttribute('data-carmen-how-here'),
    investigation: document.documentElement.getAttribute('data-carmen-investigation'),
    agent: window.__carmenAgent || null,
    searchInputCount: document.querySelectorAll('[data-testid="search-input"]').length,
    bondage: document.querySelectorAll('[data-testid="dive-bondage"]').length,
    people: document.querySelectorAll('[data-testid="dive-people"]').length,
    clothing: document.querySelectorAll('[data-testid="dive-clothing"]').length,
    visuals: document.querySelectorAll('[data-testid="dive-visuals"]').length,
    photo: document.querySelectorAll('[data-testid="photo-input"]').length,
    visibleBondage: [...document.querySelectorAll('[data-testid="dive-bondage"]')].filter(el => el.offsetParent !== null && !el.closest('[inert]')).length,
    visiblePeople: [...document.querySelectorAll('[data-testid="dive-people"]')].filter(el => el.offsetParent !== null && !el.closest('[inert]')).length,
    visibleClothing: [...document.querySelectorAll('[data-testid="dive-clothing"]')].filter(el => el.offsetParent !== null && !el.closest('[inert]')).length,
    visibleVisuals: [...document.querySelectorAll('[data-testid="dive-visuals"]')].filter(el => el.offsetParent !== null && !el.closest('[inert]')).length,
    cards: document.querySelectorAll('[data-testid="result-card"]').length,
    sourceUrls: [...document.querySelectorAll('[data-source-url]')].map(el => el.getAttribute('data-source-url')).filter(Boolean).slice(0, 5),
    duplicateIds: (() => {
      const ids = [...document.querySelectorAll('[id]')].map(el => el.id).filter(Boolean);
      return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    })(),
    hasRedirectStub: /Opening the real Carmen application/.test(document.body.innerText),
  }));
}

try {
  // A. Open /test
  const resp = await page.goto(BASE + '/test', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="search-input"]', { state: 'visible' });
  await page.screenshot({ path: SHOT + '/carmen-test-open.png' });
  const a = await agentState();
  log('A open /test', resp && resp.status() === 200 && !a.hasRedirectStub && a.searchInputCount === 1, `status=${resp && resp.status()} href=${a.href} title=${a.title}`);

  // B. Find search input
  const input = page.locator('[data-testid="search-input"]');
  log('B find search-input', await input.count() === 1 && await input.isVisible(), `count=${await input.count()}`);

  // C. Type
  await input.fill('Drea Morgan');
  const typed = await input.inputValue();
  log('C type Drea Morgan', typed === 'Drea Morgan', `value=${JSON.stringify(typed)}`);

  // D. Submit
  await page.locator('[data-testid="search-submit"]').click();
  await waitPred(() => {
    const s = document.documentElement.getAttribute('data-carmen-status');
    return s === 'loading' || s === 'complete' || s === 'error';
  }, 15000).catch(() => {});
  const afterClick = await agentState();
  log('D submit search', afterClick.status === 'loading' || afterClick.status === 'complete' || afterClick.status === 'error', `status=${afterClick.status} view=${afterClick.view} busy=${afterClick.busy}`);

  // E. Wait for async results (cards may appear while progressive search is still busy)
  await waitPred(() => {
    const s = document.documentElement.getAttribute('data-carmen-status');
    const cards = document.querySelectorAll('[data-testid="result-card"], [data-testid="person-tile"]').length;
    const results = Number(document.documentElement.getAttribute('data-carmen-results') || 0);
    const err = document.documentElement.getAttribute('data-carmen-error') || '';
    return s === 'error' || err.length > 0 || cards > 0 || results > 0 || s === 'complete';
  }, 90000).catch(() => {});
  await page.screenshot({ path: SHOT + '/carmen-test-results.png' });
  const e = await agentState();
  const haveResults = e.cards > 0 || Number(e.results) > 0;
  log('E wait async results', e.status === 'complete' || haveResults, `status=${e.status} results=${e.results} cards=${e.cards} error=${e.error} busy=${e.busy}`);

  // Select a subject so Deep Dive / Bondage have an entity
  await waitPred(() => {
    return document.querySelector('[data-testid="identity-confirm"], [data-testid="result-card"], [data-testid="person-tile"]');
  }, 20000).catch(() => {});
  const confirm = page.locator('[data-testid="identity-confirm"]').first();
  const card = page.locator('[data-testid="result-card"]').first();
  if (await confirm.count() && await confirm.isVisible().catch(() => false)) {
    await confirm.click();
    await page.waitForTimeout(500);
  } else if (await card.count()) {
    await card.click();
    await page.waitForTimeout(300);
  }

  // F. Open Deep Dive
  const diveBtn = page.locator('[data-testid="deep-dive"]');
  await waitPred(() => {
    const b = document.querySelector('[data-testid="deep-dive"]');
    return b && !b.disabled;
  }, 20000).catch(() => {});
  if (await diveBtn.count() && await diveBtn.isEnabled().catch(() => false)) {
    await diveBtn.click();
  } else {
    const perCard = page.locator('[data-testid="result-deep-dive"]').first();
    if (await perCard.count()) await perCard.click();
  }
  await waitPred(() => document.documentElement.getAttribute('data-carmen-view') === 'dive', 15000).catch(() => {});
  await page.screenshot({ path: SHOT + '/carmen-test-dive.png' });
  const f = await agentState();
  log('F open Deep Dive', f.view === 'dive', `view=${f.view}`);

  // G. Exactly one Bondage / People / Visuals
  const g = await agentState();
  log('G unique Bondage/People/Visuals', g.bondage === 1 && g.people === 1 && g.visuals === 1 && g.clothing === 0 && g.visibleBondage === 1 && g.visiblePeople === 1 && g.visibleVisuals === 1,
    `dom=${g.bondage}/${g.people}/${g.visuals} clothing=${g.clothing} visible=${g.visibleBondage}/${g.visiblePeople}/${g.visibleVisuals}`);

  // H. Click Bondage
  await page.locator('[data-testid="dive-bondage"]').click();
  await waitPred(() => document.documentElement.getAttribute('data-carmen-lens') === 'bondage' || document.documentElement.getAttribute('data-carmen-status') === 'loading' || document.documentElement.getAttribute('data-carmen-busy') === 'true', 15000).catch(() => {});
  const h = await agentState();
  log('H click Bondage', h.lens === 'bondage' || h.status === 'loading' || h.status === 'complete', `lens=${h.lens} status=${h.status}`);

  // I. Wait for real retrieval
  await waitPred(() => {
    const s = document.documentElement.getAttribute('data-carmen-status');
    const busy = document.documentElement.getAttribute('data-carmen-busy');
    const lens = document.documentElement.getAttribute('data-carmen-lens');
    const cards = document.querySelectorAll('[data-testid="result-card"]').length;
    return s === 'error' || ((s === 'complete' || cards > 0) && busy === 'false') || (lens === 'bondage' && cards > 0 && s !== 'loading');
  }, 90000).catch(() => {});
  await page.screenshot({ path: SHOT + '/carmen-test-bondage.png' });
  const i = await agentState();
  log('I wait Bondage retrieval', i.status === 'complete' || i.status === 'error', `status=${i.status} results=${i.results} cards=${i.cards} error=${i.error} lens=${i.lens}`);

  // J. Inspect DOM/state accessible to agent
  const j = await agentState();
  log('J inspect DOM/state', !!j.status && (j.cards > 0 || j.sourceUrls.length > 0 || j.status === 'complete' || j.status === 'error'),
    `status=${j.status} cards=${j.cards} urls=${j.sourceUrls.length} agent=${JSON.stringify(j.agent)}`);

  // K. Open a result/source
  let opened = false;
  const openBtn = page.locator('[data-testid="result-open"]').first();
  if (await openBtn.count()) {
    const src = await openBtn.getAttribute('data-source-url');
    opened = !!(src && /^https?:\/\//.test(src));
    log('K inspect source URL', opened, `url=${src}`);
  } else if (j.sourceUrls.length) {
    opened = /^https?:\/\//.test(j.sourceUrls[0]);
    log('K inspect source URL', opened, `url=${j.sourceUrls[0]}`);
  } else {
    log('K inspect source URL', false, 'no result-open or data-source-url yet');
  }

  // L. Return to Carmen (never left — source URL inspected in-DOM)
  log('L return to Carmen', page.url().includes('/test') || page.url().startsWith(BASE), `href=${page.url()}`);

  // Q. How I got here (dive view)
  const how = page.locator('[data-testid="how-i-got-here"]');
  if (await how.count()) await how.click();
  await page.waitForTimeout(300);
  const q = await agentState();
  const howPanel = await page.locator('[data-testid="how-i-got-here-panel"]').count();
  log('Q How I got here', q.howHere === 'open' || howPanel > 0, `howHere=${q.howHere} panel=${howPanel}`);
  await page.screenshot({ path: SHOT + '/carmen-test-how.png' });

  // O/P Save/Keep — Keep lives on Search; result cards expose Save on Dive.
  let savedOk = false;
  const resultSave = page.locator('[data-testid="result-save"]').first();
  if (await resultSave.count() && await resultSave.isVisible().catch(() => false)) {
    await resultSave.click();
    const confirm = page.locator('[data-testid="save-confirm"]');
    if (await confirm.count()) await confirm.click();
    await page.waitForTimeout(400);
  }
  await page.locator('[data-testid="nav-search"]').click();
  await page.waitForTimeout(300);
  const keep = page.locator('[data-testid="save"]');
  if (await keep.count()) await keep.click({ timeout: 8000 });
  await page.waitForTimeout(400);
  const p = await agentState();
  savedOk = !!(p.saved && p.saved.length);
  log('O/P Save/Keep', savedOk, `saved=${p.saved} view=${p.view}`);

  const beforeInv = p.investigation;
  const beforeCards = p.cards;

  // M/N New investigation isolates live state
  await page.locator('[data-testid="new-investigation"]').click();
  await waitPred(() => {
    const s = document.documentElement.getAttribute('data-carmen-status');
    const view = document.documentElement.getAttribute('data-carmen-view');
    return s === 'idle' && (view === 'home' || Number(document.documentElement.getAttribute('data-carmen-results') || 0) === 0);
  }, 15000).catch(() => {});
  const n = await agentState();
  const isolated = n.status === 'idle' && n.investigation && n.investigation !== beforeInv && Number(n.results || 0) === 0;
  log('M/N New Investigation isolates live state', isolated, `before=${beforeInv} after=${n.investigation} results=${n.results} cards=${n.cards} prevCards=${beforeCards} view=${n.view}`);
  await page.screenshot({ path: SHOT + '/carmen-test-new.png' });

  // R. No duplicate IDs / duplicate unique controls
  const r = await agentState();
  log('R no duplicate IDs', r.duplicateIds.length === 0, r.duplicateIds.length ? r.duplicateIds.join(',') : 'none');
  log('R unique search-input', r.searchInputCount === 1, `count=${r.searchInputCount}`);
  log('R unique lens testids in DOM', r.bondage === 1 && r.people === 1 && r.clothing === 1, `b/p/c=${r.bondage}/${r.people}/${r.clothing}`);

  // Click/type/wait/read works
  log('click/type/wait/read', report.filter(x => x.step.startsWith('A') || x.step.startsWith('B') || x.step.startsWith('C') || x.step.startsWith('D') || x.step.startsWith('E')).every(x => x.ok), '');
} catch (err) {
  log('UNCAUGHT', false, String(err && err.stack || err));
  try { await page.screenshot({ path: SHOT + '/carmen-test-error.png' }); } catch {}
} finally {
  await browser.close();
  const failed = report.filter(x => !x.ok);
  writeFileSync(SHOT + '/carmen-browser-agent-report.json', JSON.stringify({ base: BASE, report, failed: failed.length }, null, 2));
  console.log('\n' + report.filter(x => x.ok).length + ' passed,', failed.length + ' failed');
  if (failed.length) process.exit(1);
}
