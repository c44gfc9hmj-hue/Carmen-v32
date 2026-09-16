// v49.6 iPhone-style browser acceptance against the local test-server.
import { createRequire } from 'node:module';
const require = createRequire('/workspace/package.json');
const { chromium } = require('playwright');

const ORIGIN = process.env.CARMEN_ORIGIN || 'http://127.0.0.1:8080';
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  OK', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
page.setDefaultTimeout(90000);

try {
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  const html = await page.content();
  assert(/carmen-build" content="49\.[678]"/.test(html), 'html build current');
  assert(await page.getByTestId('new-investigation').count() === 1, 'New investigation');
  await page.getByTestId('nav-dive').click({ force: true });
  assert(await page.getByTestId('dive-bondage').count() === 1, 'Bondage shortcut');
  assert(await page.getByTestId('dive-people').count() === 1, 'People shortcut');
  assert(await page.getByTestId('dive-visuals').count() === 1, 'Visuals shortcut');
  assert(await page.getByTestId('dive-nl-input').count() === 1, 'Ask Carmen anything');
  assert(await page.getByTestId('find-more').count() === 1, 'Find More');
  const diveText = await page.locator('#divePrimaryLenses').innerText();
  assert(/Ask Carmen anything/.test(diveText), 'NL label visible');
  assert(!/Clothing/.test(diveText), 'no Clothing shortcut in Deep Dive');

  await page.getByTestId('nav-home').click({ force: true });
  await page.getByTestId('search-input').fill('Riley Reid');
  await page.getByTestId('search-submit').click({ force: true });
  await page.waitForFunction(() => {
    const n = document.querySelectorAll('[data-testid="result-card"]').length;
    const empty = document.getElementById('resultsEmpty');
    const shown = empty && !empty.classList.contains('hidden');
    return n > 0 || shown;
  }, { timeout: 90000 });
  const rileyCards = await page.locator('[data-testid="result-card"]').count();
  const hint = await page.locator('#deepDiveHint').innerText();
  const suggest = await page.locator('#suggestBar').innerText().catch(() => '');
  if (rileyCards > 0) {
    assert(!/No public candidates yet/.test(hint), 'I no contradictory empty copy while Riley cards exist');
    assert(!(/No public candidates yet/.test(suggest) && /public candidates/.test(suggest)), 'I suggest bar is not contradictory');
  } else {
    assert(true, 'I Riley search returned empty this run (not a contradiction)');
  }
  console.log('  RECORD Riley cards=' + rileyCards + ' hint=' + JSON.stringify(hint.slice(0, 80)));

  await page.getByTestId('new-investigation').click({ force: true });
  await page.getByTestId('nav-home').click({ force: true });
  await page.getByTestId('search-input').fill('frog tie bondage');
  await page.getByTestId('search-submit').click({ force: true });
  await page.waitForFunction(() => {
    const n = document.querySelectorAll('[data-testid="result-card"]').length;
    const empty = document.getElementById('resultsEmpty');
    const shown = empty && !empty.classList.contains('hidden');
    return n > 0 || shown;
  }, { timeout: 90000 });
  const pageText = await page.locator('#results').innerText().catch(() => '');
  const classBar = await page.locator('#classBar').innerText().catch(() => '');
  const hint2 = await page.locator('#deepDiveHint').innerText();
  assert(!/Riley Reid/i.test(pageText + classBar), 'K zero Riley Reid state after New Investigation → frog tie');
  assert(!/No public candidates yet/.test(hint2) || !(await page.locator('[data-testid="result-card"]').count()), 'I frog-tie status is not contradictory');
  console.log('  RECORD frog cards=' + (await page.locator('[data-testid="result-card"]').count()) + ' classBar=' + JSON.stringify(classBar.slice(0, 120)));
} catch (e) {
  failed++;
  console.log('  FAIL browser flow', e && e.message);
} finally {
  await browser.close();
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
