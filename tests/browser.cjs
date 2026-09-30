// Run with Node.js and Playwright available via NODE_PATH. No app dependencies.
const { startApp } = require('./support.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const app = await startApp();
  const { browser } = app;
  try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const loggingUrl = 'https://script.google.com/macros/s/AKfycbxssCIHsD-N97SHxNC_GN0ihYeC0qy-lb-EY0KmSs6Gnztaph1sITMerLVEnNWOGkYc/exec?app=seat-shuffle';
  let loggingRequests = 0, pageLoads = 0;
  page.on('domcontentloaded', () => pageLoads++);
  // Intercept logging so tests never add visits to the production record.
  await page.route(loggingUrl, async route => {
    loggingRequests++;
    assert.equal(route.request().method(), 'GET');
    if (loggingRequests === 1) await route.fulfill({ status: 200, body: 'ok' });
    else await route.abort('failed');
  });
  await page.addInitScript(() => {
    window.visitRequests = [];
    const originalFetch = window.fetch;
    window.fetch = (...args) => {
      window.visitRequests.push({ url: args[0], options: args[1] });
      return originalFetch(...args);
    };
  });
  async function checkLogging() {
    assert.deepEqual(await page.evaluate(() => window.visitRequests), [{
      url: loggingUrl,
      options: { method: 'GET', mode: 'no-cors', cache: 'no-store', credentials: 'omit', keepalive: true },
    }]);
    assert.equal(loggingRequests, pageLoads, 'one request per load, none from user actions or retries');
  }
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(app.url);
  await checkLogging();
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
  assert(await page.locator('#shuffle-all').isEnabled());
  assert.match(await page.locator('#names-error').textContent(), /参加者が座席数を超えています/);
  await page.locator('#shuffle-all').click();
  assert.equal(await page.locator('.seat.has-name').count(), 18);
  assert.equal(await page.locator('#name-buttons button:disabled').count(), 19);
  assert.match(await page.locator('#names-status').textContent(), /未配置 1人.*満席/);
  await page.locator('#reset-draw').click();
  await page.locator('#number-tab').click();
  await page.locator('#reset-draw').click();
  await page.locator('#name-tab').click();
  await page.locator('#rebuild-layout').click();
  await page.locator('#column-count').fill('3');
  for (const [index, count] of [2, 3, 1].entries()) await page.locator('#column-fields input').nth(index).fill(String(count));
  await page.locator('#layout-form button[type="submit"]').click();
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
  await checkLogging();
  await page.reload();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('#rebuild-layout').click();
    await page.locator('#column-count').fill('4');
    await page.getByRole('button', { name: '列数を1増やす', exact: true }).click();
    assert.equal(await page.locator('#column-count').inputValue(), '5');
    assert.equal(await page.locator('#column-fields input').count(), 5);
    await page.getByRole('button', { name: '列数を1減らす', exact: true }).click();
    assert.equal(await page.locator('#column-count').inputValue(), '4');
    const firstCount = page.locator('#column-fields input').first();
    await firstCount.fill('7');
    await page.getByRole('button', { name: '1列目の座席数を1増やす', exact: true }).click();
    assert.equal(await firstCount.inputValue(), '8');
    await page.getByRole('button', { name: '1列目の座席数を1減らす', exact: true }).click();
    assert.equal(await firstCount.inputValue(), '7');
    await firstCount.fill('1');
    assert(await page.getByRole('button', { name: '1列目の座席数を1減らす', exact: true }).isDisabled());
    await firstCount.fill('100');
    assert(await page.getByRole('button', { name: '1列目の座席数を1増やす', exact: true }).isDisabled());
    await firstCount.fill('7');
    for (const count of [5, 6, 20]) {
      await page.locator('#column-count').fill(String(count));
      assert.equal(await firstCount.inputValue(), '7');
      if (count === 20) assert(await page.getByRole('button', { name: '列数を1増やす', exact: true }).isDisabled());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `settings overflow at ${width}`);
      const expected = await page.locator('#column-fields input').evaluateAll(inputs => inputs.reduce((sum, input) => sum + Number(input.value), 0));
      await page.locator('#layout-form button[type="submit"]').click();
      assert.equal(await page.locator('.seat').count(), expected);
      const geometry = await page.locator('.board-scroll').evaluate(scroll => {
        const board = scroll.firstElementChild;
        const columns = [...board.children].map(c => c.getBoundingClientRect());
        return { tops: columns.map(c => c.top), widths: columns.map(c => c.width), scrolls: scroll.scrollWidth > scroll.clientWidth + 1, viewport: scroll.clientWidth };
      });
      assert.equal(new Set(geometry.tops).size, 1, `${count} columns must stay on one row at ${width}`);
      assert(geometry.widths.every(w => w >= 44));
      if (count === 5 || (count === 6 && width !== 320)) assert(!geometry.scrolls, `unnecessary scroll: ${width}/${count}`);
      if (count === 6 && [390, 1280].includes(width)) {
        await page.locator('#layout-settings summary').click();
        await page.locator('.layout-section').screenshot({ path: path.resolve(__dirname, `layout-${width}.png`) });
        await page.locator('#layout-settings summary').click();
      }
      if (count === 20) {
        assert(geometry.scrolls);
        await page.locator('.board-scroll').evaluate(el => { el.scrollLeft = el.scrollWidth; });
        await page.locator('#edit-position').click();
        const last = page.locator('.seat-column').last().locator('.seat').first();
        await last.focus();
        await page.keyboard.press('ArrowLeft');
        assert.match(await last.getAttribute('style'), /translate\(-5px, 0px\)/);
        await page.locator('#edit-position').click();
      }
      await page.locator('#draw-number').click();
      await page.locator('#dialog-action').click();
      assert.equal(await page.locator('.seat.assigned').count(), 1);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}/${count}`);
      await page.locator('#reset-draw').click();
      await page.locator('#rebuild-layout').click();
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
  }
  await checkLogging();
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.resolve(__dirname, 'mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await checkLogging();
  console.log('PASS: matching logging settings; one GET per page load; no extra requests during draws, shuffles, layout changes or simulated network failures.');
  console.log('PASS: layout, numbering, 18 unique draws, names, individual draw, repeat prevention, 12 shuffles, empty seats, capacity overflow, mouse/touch drag, 320–1280px overflow, no browser errors.');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
