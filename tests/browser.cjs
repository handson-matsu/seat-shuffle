// Run with Node.js and Playwright available via NODE_PATH. No app dependencies.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
  assert.equal(await page.locator('.seat').count(), 18);
  assert.deepEqual(await page.locator('.seat-column').evaluateAll(cols => cols.map(c => c.querySelectorAll('.seat').length)), [4, 5, 5, 4]);
  assert.equal(new Set(await page.locator('.seat').evaluateAll(seats => seats.map(s => s.dataset.seat))).size, 18);
  const drawn = [];
  for (let i = 0; i < 18; i++) {
    await page.locator('#draw-number').click();
    drawn.push(await page.locator('#result-number').textContent());
    await page.locator('#dialog-action').click();
  }
  assert.equal(new Set(drawn).size, 18);
  assert(await page.locator('#draw-number').isDisabled());
  await page.locator('#name-tab').click();
  await page.locator('#names-input').fill('佐藤\n鈴木\n田中\n山田');
  await page.locator('#names-form button').click();
  assert.equal(await page.locator('#name-buttons button').count(), 4);
  await page.locator('#name-buttons button').first().click();
  assert.match(await page.locator('#result-person').textContent(), /佐藤/);
  assert.equal(await page.locator('.seat.has-name').count(), 0);
  await page.locator('#dialog-action').click();
  assert.equal(await page.locator('.seat.has-name').count(), 1);
  assert.equal(await page.locator('.seat-name').textContent(), '佐藤');
  assert(await page.locator('#name-buttons button').first().isDisabled());
  await page.locator('#dialog-action').click();
  for (let i = 0; i < 12; i++) {
    await page.locator('#shuffle-all').click();
    const assigned = await page.locator('.seat.has-name').evaluateAll(seats => seats.map(s => s.dataset.seat));
    assert.equal(assigned.length, 4);
    assert.equal(new Set(assigned).size, 4);
  }
  assert.equal(await page.locator('.seat:not(.assigned)').count(), 14);
  await page.locator('#change-names').click();
  await page.locator('#names-input').fill(Array.from({ length: 19 }, (_, i) => `参加者${i}`).join('\n'));
  await page.locator('#names-form button').click();
  assert(await page.locator('#shuffle-all').isDisabled());
  assert.equal(await page.locator('#name-buttons button:disabled').count(), 19);
  await page.locator('#rebuild-layout').click();
  await page.locator('#column-count').fill('3');
  for (const [index, count] of [2, 3, 1].entries()) await page.locator('#column-fields input').nth(index).fill(String(count));
  await page.locator('#layout-form button').click();
  assert.equal(await page.locator('.seat').count(), 6);
  assert.equal(await page.locator('#seat-total').textContent(), '6 席');
  await page.locator('#edit-position').click();
  const seat = page.locator('.seat').first();
  await seat.scrollIntoViewIfNeeded();
  let box = await seat.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 15); await page.mouse.up();
  assert.match(await seat.getAttribute('style'), /translate\(12px, 15px\)/);
  await page.locator('#reset-position').click();
  await seat.scrollIntoViewIfNeeded();
  box = await seat.boundingBox();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width / 2 + 18, y: box.y + box.height / 2 + 20 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.match(await seat.getAttribute('style'), /translate\(18px, 20px\)/);
  await page.reload();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.resolve(__dirname, 'mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: layout, numbering, 18 unique draws, names, individual draw, repeat prevention, 12 shuffles, empty seats, capacity block, mouse/touch drag, 320–1280px overflow, no browser errors.');
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
