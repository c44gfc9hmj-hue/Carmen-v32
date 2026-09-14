#!/usr/bin/env python3
from pathlib import Path
root = Path(__file__).resolve().parents[1]
def sub(rel, old, new):
    p = root / rel
    s = p.read_text()
    if old in s:
        p.write_text(s.replace(old, new, 1))
        print('patched', rel, old[:48])
    else:
        print('skip', rel, old[:48])

sub('worker.js',
"  SEARCH_BUDGET = { used: 0, max: Math.min(max || 28, FETCH_HARD_CAP) };",
"  SEARCH_BUDGET = { used: 0, max: Math.min(max || 28, FETCH_HARD_CAP), reserved: { reddit: 0, adultIdentity: 0, visual: 0 } };")
sub('worker.js',
"""  if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
    // Reddit results come from the JSON API; skip any stray anchor links.
    if (!item.source || !item.source.startsWith('Reddit')) return false;
  }""",
"""  if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
    const src = String(item.source || '');
    if (!/^Reddit/i.test(src)) {
      item.source = 'Reddit (indexed)';
      item.accessState = item.accessState || 'PUBLIC_ALTERNATIVE';
    }
  }""")
sub('worker.js', "version: '47.8'", "version: '48.1'")
sub('worker.js', "build: '47.8-source-first'", "build: '48.1-reserved-retrieval'")
sub('worker.js', "'no-auto-save']",
"'no-auto-save', 'v48-reddit-indexed-fallback', 'v48-reserved-reddit', 'v48-reserved-adult-identity', 'v48-visual-enrichment', 'v48-research-metrics', 'v48-focus-modes']")
w = (root/'worker.js').read_text().replace("version: '47.8'", "version: '48.1'")
(root/'worker.js').write_text(w)
sub('public/app.js', "const VERSION = '47.8';", "const VERSION = '48.1';")
sub('public/app.js', "const SESSION_KEY = 'carmen_session_v47';",
    "const SESSION_KEY = 'carmen_session_v48';\nconst SESSION_KEY_LEGACY = 'carmen_session_v47';")
sub('public/app.js', "sessionStorage.getItem(SESSION_KEY);",
    "sessionStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY_LEGACY);")
sub('public/index.html', '<title>Carmen</title>', '<title>Carmen</title>\n<meta name="carmen-build" content="48.1">')
sub('public/index.html', '<h1>Carmen</h1>', '<h1>Carmen <span class="kicker" style="letter-spacing:.08em">v48.1</span></h1>')
sub('public/index.html', 'A person, product, clothing, technique, place, or URL',
    'A person, visuals, position, tutorial, clothing, URL, or topic')
html = (root/'public/index.html').read_text()
old = '''      <div class="chips" id="subjectChips" style="margin-top:8px">
        <button class="chip active" data-subject="">Auto</button>
        <button class="chip" data-subject="person">Person</button>
        <button class="chip" data-subject="product">Product</button>
        <button class="chip" data-subject="vehicle">Vehicle</button>
        <button class="chip" data-subject="technique">Technique</button>
        <button class="chip" data-subject="clothing">Clothing</button>
        <button class="chip" data-subject="skill">Skill / project</button>
        <button class="chip" data-subject="organization">Organization</button>
        <button class="chip" data-subject="place">Place</button>
        <button class="chip" data-subject="topic">Topic</button>
        <button class="chip" data-subject="website">URL</button>
      </div>'''
new = '''    <div class="filter-block" id="focusBlock">
      <p class="flabel">Research Focus</p>
      <div class="chips" id="subjectChips" style="margin-top:0">
        <button class="chip" data-subject="person">Person</button>
        <button class="chip" data-subject="visuals">Visuals</button>
        <button class="chip" data-subject="position">Position</button>
        <button class="chip" data-subject="tutorial">Tutorial</button>
        <button class="chip" data-subject="clothing">Clothing</button>
        <button class="chip" data-subject="website">URL</button>
        <button class="chip" data-subject="topic">Topic</button>
      </div>
    </div>
'''
if 'id="focusBlock"' not in html and old in html:
    html = html.replace(old, '')
    html = html.replace('    <details class="adv">', new + '    <details class="adv">', 1)
    html = html.replace('<h3>Research focus</h3>', '<h3>Adaptive lenses</h3>')
    (root/'public/index.html').write_text(html)
    print('patched focus chips')
print('core done')
