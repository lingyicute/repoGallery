'use strict';

// Run with: node tests/browser.cjs [--bench-only]
// Requires Playwright and its Chromium browser; no network access is needed.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const user = JSON.parse(html.match(/const USER = (\{[\s\S]*?\n\});/)[1]);
const snapshot = JSON.parse(html.match(/const SNAP = (\[[\s\S]*?\n\]);/)[1]);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6WQAAAABJRU5ErkJggg==', 'base64');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function ghRepo(r) {
  return {
    id: r.id, name: r.name, full_name: 'lingyicute/' + r.name,
    html_url: 'https://github.com/lingyicute/' + r.name,
    description: r.description, fork: r.fork, archived: r.archived,
    language: r.language, stargazers_count: r.stars, forks_count: r.forks,
    topics: r.topics, created_at: r.created_at, pushed_at: r.pushed_at,
    homepage: r.homepage, license: r.license ? { spdx_id: r.license } : null
  };
}

async function startServer() {
  const server = http.createServer((req, res) => {
    const files = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'] };
    const item = files[new URL(req.url, 'http://localhost').pathname];
    if (!item) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': item[1], 'cache-control': 'no-store' });
    fs.createReadStream(path.join(root, item[0])).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function newPage(browser, base, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: options.reducedMotion || 'reduce' });
  const page = await context.newPage();
  const errors = [], events = [];
  page.on('pageerror', e => errors.push(e.message));
  const live = snapshot.map(ghRepo);
  live.push({ ...ghRepo(snapshot[0]), id: 99999999999, name: 'fresh-live-item', full_name: 'lingyicute/fresh-live-item', html_url: 'https://github.com/lingyicute/fresh-live-item', fork: false });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    try {
      if (url.hostname === 'api.github.com') {
        const event = { path: url.pathname + url.search, start: Date.now() };
        events.push(event);
        await sleep(options.apiDelay ?? 600);
        event.end = Date.now();
        if (!options.live) return await route.fulfill({ status: 503, body: '{}' });
        if (url.pathname.endsWith('/repos')) {
          const p = Number(url.searchParams.get('page') || 1);
          return await route.fulfill({ json: live.slice((p - 1) * 100, p * 100) });
        }
        return await route.fulfill({ json: { ...user, public_repos: live.length } });
      }
      if (url.hostname === 'ungh.cc') {
        await sleep(options.apiDelay ?? 600);
        if (options.mirror) {
          const r = snapshot.find(item => item.fork === false);
          return await route.fulfill({ json: { repos: [
            { id: r.id, name: r.name, description: r.description, stars: r.stars, forks: r.forks, createdAt: r.created_at, pushedAt: r.pushed_at },
            { id: 99999999998, name: 'mirror-unknown', description: 'new', stars: 2, forks: 0, createdAt: r.created_at, pushedAt: r.pushed_at }
          ] } });
        }
        return await route.fulfill({ status: 503, body: '{}' });
      }
      if (url.hostname === 'fonts.googleapis.com') {
        await sleep(options.fontDelay ?? 0);
        return await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      }
      if (url.hostname === 'nebulove.92li.uk') {
        await sleep(options.fontDelay ?? 0);
        return await route.abort();
      }
      if (url.hostname === 'avatars.githubusercontent.com') {
        return await route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: png });
      }
      return await route.abort();
    } catch (e) {
      if (!/closed|Target|intercept|handled/i.test(String(e))) throw e;
    }
  });
  return { context, page, errors, events, live };
}

async function benchmark(page) {
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const before = await session.send('Performance.getMetrics');
  const result = await page.evaluate(() => {
    const original = DATA.repos;
    const many = Array.from({ length: 5 }, (_, n) => original.map(r => ({
      ...r, id: r.id + n * 10000000000, name: r.name + '-copy-' + n,
      full_name: r.full_name + '-copy-' + n
    }))).flat();
    let t = performance.now();
    DATA = { ...DATA, repos: many };
    computeStats(); renderAll();
    document.body.offsetHeight;
    const initialMs = performance.now() - t;
    const queries = ['nothing-matches-this', 'repo', '', 'copy-2', 'a', ''];
    const filterMs = [];
    for (const q of queries) {
      t = performance.now(); query = q; renderGrid(); document.body.offsetHeight;
      filterMs.push(performance.now() - t);
    }
    const sortMs = [];
    for (const key of ['stars', 'name', 'pushed']) {
      t = performance.now(); sortKey = key; renderGrid(); document.body.offsetHeight;
      sortMs.push(performance.now() - t);
    }
    return { repositories: many.length, initialMs, filterMs, sortMs, height: document.body.scrollHeight };
  });
  const after = await session.send('Performance.getMetrics');
  const metric = (metrics, name) => metrics.metrics.find(m => m.name === name)?.value ?? 0;
  result.layoutMs = (metric(after, 'LayoutDuration') - metric(before, 'LayoutDuration')) * 1000;
  result.styleMs = (metric(after, 'RecalcStyleDuration') - metric(before, 'RecalcStyleDuration')) * 1000;
  await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await session.detach();
  return result;
}

async function checkGrid(browser, base) {
  const run = await newPage(browser, base, { apiDelay: 500, reducedMotion: 'no-preference' });
  const page = run.page;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedText = text; } } });
  });
  await page.goto(base, { waitUntil: 'commit' });
  await page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
  const sample = snapshot.find(r => r.language && r.fork === false && snapshot.filter(x =>
    (x.name + ' ' + (x.description || '') + ' ' + x.topics.join(' ')).toLowerCase().includes(r.name.toLowerCase())
  ).length === 1);
  assert(sample, 'fixture needs a unique searchable source repository');
  await page.evaluate(name => {
    window.savedCard = Array.from(document.querySelectorAll('#grid > .rv-lite')).find(el => el.querySelector('.card-name').textContent === name);
  }, sample.name);
  const search = page.locator('#searchInput');
  await search.fill(sample.name);
  await page.waitForFunction(() => document.querySelector('#countLine').textContent.match(/显示\s*1\s*\//));
  assert.equal(await page.locator('#grid > .rv-lite:not([hidden])').count(), 1);
  assert(await page.evaluate(() => window.savedCard.isConnected && !window.savedCard.hidden));
  await search.fill('no-repository-matches-this-phrase');
  await page.waitForFunction(() => document.querySelector('#countLine').textContent.match(/显示\s*0\s*\//));
  assert.equal(await page.locator('#grid .empty:visible').count(), 1);
  assert(await page.evaluate(() => window.savedCard.isConnected && window.savedCard.hidden));
  await page.locator('#clearSearch').click();
  assert(await page.evaluate(() => window.savedCard.isConnected && !window.savedCard.hidden));

  // Moving a focused card during a sort must not lose keyboard focus.
  assert(await page.evaluate(() => {
    const card = window.savedCard.querySelector('.card');
    card.focus({ preventScroll: true });
    sortKey = 'name'; renderGrid();
    return document.activeElement === card;
  }));
  let names = await page.locator('#grid > .rv-lite:not([hidden]) .card-name').allTextContents();
  assert.deepEqual(names, snapshot.map(r => r.name).sort((a, b) => a.localeCompare(b)));
  await page.locator('#segSort button[data-v="stars"]').click();
  await page.locator('#segType button[data-v="source"]').click();
  await page.locator(`#langChips button[data-lang=${JSON.stringify(sample.language)}]`).click();
  names = await page.locator('#grid > .rv-lite:not([hidden]) .card-name').allTextContents();
  assert.deepEqual(names, snapshot.filter(r => r.fork === false && r.language === sample.language)
    .sort((a, b) => b.stars - a.stars).map(r => r.name));
  assert.equal(await page.locator('#segType button[data-v="source"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#resetBtn').click();
  assert.equal(await page.locator('#grid > .rv-lite:not([hidden])').count(), snapshot.length);

  // A far-off card remains discoverable and keyboard reachable with containment.
  const last = page.locator('#grid > .rv-lite .card').last();
  const lastName = await last.locator('.card-name').textContent();
  await page.evaluate(() => window.scrollTo(0, 0));
  assert(await page.evaluate(name => window.find(name), lastName));
  await last.focus();
  await page.waitForFunction(() => {
    const card = Array.from(document.querySelectorAll('#grid > .rv-lite .card')).at(-1);
    const box = card.getBoundingClientRect();
    return card.parentElement.classList.contains('in') && box.height > 80 && box.top < innerHeight && box.bottom > 0;
  });
  const dimensions = await last.evaluate(card => {
    const outer = card.getBoundingClientRect(), meta = card.querySelector('.card-meta').getBoundingClientRect();
    return { width: outer.width, height: outer.height, metaBottom: meta.bottom, cardBottom: outer.bottom, visibility: getComputedStyle(card).contentVisibility };
  });
  assert(dimensions.width > 200 && dimensions.height > 80);
  assert(dimensions.metaBottom <= dimensions.cardBottom + 1, 'card contents must not be clipped by the size estimate');
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.activeElement.closest('.card') === Array.from(document.querySelectorAll('#grid > .rv-lite .card')).at(-1)));
  await last.locator('[data-copy]').click();
  assert.match(await page.evaluate(() => window.copiedText), /^https:\/\/github\.com\/lingyicute\/.+\.git$/);
  assert.deepEqual(run.errors, []);
  await run.context.close();
}

async function checkMirror(browser, base) {
  const run = await newPage(browser, base, { mirror: true, apiDelay: 120 });
  const page = run.page;
  await page.goto(base, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.querySelector('#srcChip').textContent.includes('镜像'), null, { timeout: 5000 });
  assert.equal(await page.locator('#grid .card').count(), 2);
  assert.equal(await page.getByText('类型未知').count(), 1);
  await page.locator('#segType button[data-v="source"]').click();
  assert.equal(await page.locator('#grid > .rv-lite:not([hidden])').count(), 1);
  assert.match(await page.locator('#countLine').innerText(), /显示\s*1\s*\/\s*2/);
  assert.deepEqual(run.errors, []);
  await run.context.close();
}

async function checkMobile(browser, base) {
  const run = await newPage(browser, base, { apiDelay: 500 });
  const page = run.page;
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(base, { waitUntil: 'commit' });
  await page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
  const card = page.locator('#grid .card').first();
  await card.scrollIntoViewIfNeeded();
  const result = await card.evaluate(el => {
    const box = el.getBoundingClientRect(), meta = el.querySelector('.card-meta').getBoundingClientRect();
    return { scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, left: box.left, right: box.right, bottom: box.bottom, metaBottom: meta.bottom };
  });
  assert(result.scrollWidth <= result.viewportWidth + 1, 'mobile page must not overflow horizontally');
  assert(result.left >= 0 && result.right <= result.viewportWidth + 1);
  assert(result.metaBottom <= result.bottom + 1, 'mobile card content must not be clipped');
  assert.deepEqual(run.errors, []);
  await run.context.close();
}

async function main() {
  const { server, base } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const offline = await newPage(browser, base, { apiDelay: 1200, fontDelay: 1200 });
    const t0 = Date.now();
    await offline.page.goto(base, { waitUntil: 'commit' });
    await offline.page.waitForFunction(() => !document.body.hasAttribute('aria-busy'), null, { timeout: 15000 });
    const bootMs = Date.now() - t0;
    assert.equal(await offline.page.locator('#grid .card').count(), snapshot.length);
    console.log('offlineBootMs:', bootMs);
    console.log('benchmark:', JSON.stringify(await benchmark(offline.page)));
    if (!process.argv.includes('--bench-only')) {
      assert(bootMs < 1100, `Snapshot should be usable before slow external resources: ${bootMs}ms`);
      assert.match(await offline.page.locator('#srcChip').innerText(), /快照/);
      assert.deepEqual(offline.errors, []);
    }
    await offline.context.close();

    if (!process.argv.includes('--bench-only')) {
      const live = await newPage(browser, base, { live: true, apiDelay: 700 });
      await live.page.goto(base, { waitUntil: 'commit' });
      await live.page.waitForFunction(() => !document.body.hasAttribute('aria-busy'), null, { timeout: 3000 });
      await live.page.locator('#searchInput').fill('fresh-live-item');
      await live.page.waitForTimeout(200);
      assert.match(await live.page.locator('#countLine').innerText(), /显示\s*0/);
      await live.page.waitForFunction(() => document.querySelector('#srcChip').textContent.includes('实时数据'), null, { timeout: 6000 });
      assert.match(await live.page.locator('#countLine').innerText(), /显示\s*1/);
      assert.equal(await live.page.locator('#searchInput').inputValue(), 'fresh-live-item');
      assert.equal(await live.page.locator('#searchInput').evaluate(el => document.activeElement === el), true);
      assert.equal(await live.page.locator('#grid .card-name').filter({ hasText: 'fresh-live-item' }).count(), 1);
      const profile = live.events.find(e => e.path === '/users/lingyicute');
      const page1 = live.events.find(e => e.path.includes('/repos?') && e.path.includes('page=1'));
      assert(profile && page1 && page1.start < profile.end, 'Profile and first repository page must be fetched concurrently');
      assert.equal(live.events.filter(e => e.path.includes('/repos?')).length, Math.ceil(live.live.length / 100));
      assert.deepEqual(live.errors, []);
      await live.context.close();
      await checkGrid(browser, base);
      await checkMirror(browser, base);
      await checkMobile(browser, base);
      console.log('Browser regression tests passed.');
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
