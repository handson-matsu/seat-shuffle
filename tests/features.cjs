// Regression tests for file import/export, compact attendance and safe layout changes.
const assert = require('node:assert/strict');
const { startApp } = require('./support.cjs');
const fs = require('node:fs');
(async () => {
  const app = await startApp();
  try {
    const context = await app.browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    let loads = 0, logs = 0;
    const errors = [], unexpectedRequests = [];
    await context.addInitScript(() => {
      window.browserStorageAccesses = 0;
      for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { window.browserStorageAccesses++; throw new Error('Browser storage must not be used'); } });
    });
    await context.route('**/*', route => {
      const request = route.request(), url = request.url();
      if (url.startsWith('https://script.google.com/')) { logs++; return route.abort(); }
      if (url.startsWith(app.url) && request.method() === 'GET' && !request.postData()) return route.continue();
      unexpectedRequests.push({ url, method: request.method(), body: request.postData() });
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('domcontentloaded', () => loads++);
    let downloadCount = 0;
    page.on('download', () => downloadCount++);
    let accept = true;
    const dialogs = [];
    page.on('dialog', dialog => { dialogs.push(dialog.message()); return accept ? dialog.accept() : dialog.dismiss(); });
    await page.goto(app.url);
    async function fresh() {
      assert.equal(await page.evaluate(() => window.browserStorageAccesses), 0);
      await page.reload();
    }
    async function layout(columns) {
      await page.locator('#rebuild-layout').click();
      await page.locator('#column-count').fill(String(columns.length));
      for (let i = 0; i < columns.length; i++) await page.locator('#column-fields input').nth(i).fill(String(columns[i]));
      await page.locator('#layout-form button[type=submit]').click();
    }
    async function names(text) {
      await page.locator('#name-tab').click();
      if (await page.locator('#names-form').isHidden()) await page.locator('#change-names').click();
      await page.locator('#names-input').fill(text);
      await page.locator('#names-form button').click();
    }
    async function rosterPanel() {
      if (!await page.locator('#roster-settings').evaluate(el => el.open)) await page.locator('#roster-settings summary').click();
    }
    async function saveRoster(name) {
      await rosterPanel();
      if (name !== undefined) await page.locator('#roster-name').fill(name);
      const waiting = page.waitForEvent('download');
      await page.locator('#save-roster').click();
      const download = await waiting;
      assert.equal(await download.failure(), null);
      const path = await download.path(), raw = fs.readFileSync(path, 'utf8');
      return { path, raw, data: JSON.parse(raw), filename: download.suggestedFilename() };
    }
    async function chooseFile(file) {
      await rosterPanel();
      const waiting = page.waitForEvent('filechooser');
      await page.locator('#open-roster').click();
      const chooser = await waiting;
      // Download.path() uses an internal temporary filename; retain the user's .json name.
      await chooser.setFiles(file.path ? { name: file.filename, mimeType: 'application/json', buffer: Buffer.from(file.raw) } : file);
    }
    async function importFile(file, restore = false) {
      await chooseFile(file);
      await page.locator('#roster-import').waitFor({ state: 'visible' });
      await page.locator(restore ? '#restore-arrangement' : '#load-roster').click();
    }
    async function attendance(open = true) {
      if (await page.locator('#edit-attendance').getAttribute('aria-expanded') !== String(open)) await page.locator('#edit-attendance').tap();
    }
    async function stateCopy() {
      return page.evaluate(() => ({ columns: state.columns, people: state.people, assignments: [...state.assignments], numbers: state.numberSeats, lastNumber: state.lastNumber, lastName: state.lastName, offsets: [...state.offsets], absent: [...state.absent], editing: state.editing }));
    }
    async function sequential() {
      assert.deepEqual(await page.locator('.seat').evaluateAll(seats => seats.map(seat => Number(seat.dataset.seat))), Array.from({ length: await page.locator('.seat').count() }, (_, i) => i + 1));
    }
    async function drawPerson(index) {
      await page.locator('.person-draw').nth(index).click();
      await page.locator('#dialog-action').click();
      await page.locator('#dialog-action').click();
    }
    async function moveFirst() {
      if (!await page.locator('#edit-position').evaluate(el => el.getAttribute('aria-pressed') === 'true')) await page.locator('#edit-position').click();
      await page.locator('.seat').first().focus(); await page.keyboard.press('ArrowRight');
    }

    // Duplicate names retain distinct IDs; capacity is based on attendance.
    await layout([1, 1]);
    await names('同名\n同名\n三郎\n欠席者');
    assert.equal(await page.locator('.person-item label:visible').count(), 0);
    const compactHeight = await page.locator('.person-item').first().evaluate(el => el.getBoundingClientRect().height);
    await attendance();
    assert.equal(await page.locator('.person-item label:visible').count(), 4);
    assert(await page.locator('.person-item').first().evaluate((el, height) => el.getBoundingClientRect().height >= height + 44, compactHeight));
    await page.locator('.person-item input').nth(3).check();
    await attendance(false);
    assert.equal(await page.locator('.person-item label:visible').count(), 0);
    assert.equal(await page.locator('#attendance-count').textContent(), '欠席 1人');
    assert.equal(await page.locator('.person-draw .absence-badge').textContent(), '欠席');
    assert(await page.locator('.person-draw').nth(3).isDisabled());
    await page.evaluate(() => selectPerson(state.people[3].id));
    assert.equal(await page.locator('#draw-dialog').evaluate(el => el.open), false);
    assert.match(await page.locator('#names-error').textContent(), /参加者が座席数を超えています/);
    for (let i = 0; i < 12; i++) {
      await page.locator('#shuffle-all').click();
      const snapshot = await stateCopy();
      assert.equal(snapshot.assignments.length, 2);
      assert.equal(new Set(snapshot.assignments.map(pair => pair[1])).size, 2);
      assert(snapshot.assignments.every(([id, seat]) => id !== snapshot.people[3].id && typeof seat === 'string'));
    }
    const eligibleThird = (await stateCopy()).people[2].id;
    // A known random sequence proves a later participant is eligible without a probabilistic assertion.
    await page.evaluate(() => { window.originalRandomInt = randomInt; randomInt = () => 0; });
    await page.locator('#shuffle-all').click();
    assert((await stateCopy()).assignments.some(([id]) => id === eligibleThird));
    await page.evaluate(() => { randomInt = window.originalRandomInt; delete window.originalRandomInt; });
    assert.match(await page.locator('#names-status').textContent(), /未配置 1人.*満席/);
    assert.equal(await page.locator('.person-draw:disabled').count(), 4);
    await page.locator('#reset-draw').click();
    await drawPerson(0); await drawPerson(1);
    const duplicateState = await stateCopy();
    assert.notEqual(duplicateState.people[0].id, duplicateState.people[1].id);
    assert.equal(new Set(duplicateState.assignments.map(pair => pair[1])).size, 2);
    assert(await page.locator('.person-draw').nth(2).isDisabled());
    await page.evaluate(() => selectPerson(state.people[2].id));
    assert.equal(await page.locator('#draw-dialog').evaluate(el => el.open), false);
    await attendance();
    accept = false;
    await page.locator('.person-item input').nth(0).click(); // Rejected check restores the original value.
    assert.deepEqual((await stateCopy()).assignments, duplicateState.assignments);
    assert.equal(await page.locator('.person-item input').nth(0).isChecked(), false);
    accept = true;
    await page.locator('.person-item input').nth(0).check();
    assert.equal((await stateCopy()).assignments.length, 1);
    assert(await page.locator('.person-draw').nth(2).isEnabled());
    await page.locator('.person-item input').nth(0).uncheck();
    await page.locator('#reset-draw').click();
    for (let i = 0; i < 4; i++) await page.locator('.person-item input').nth(i).check();
    assert(await page.locator('#shuffle-all').isDisabled());
    assert.equal(await page.locator('#names-error').textContent(), '');
    console.log('PASS: duplicate identities, overflow lottery, attendance, full seats and individual guards.');

    // Existing people stay in their column/row, even when display numbers change.
    await fresh(); await layout([2, 2]); await names('A\nB\nC\nD');
    await page.locator('#shuffle-all').click();
    await moveFirst();
    const before = await stateCopy();
    assert(before.offsets.some(([, p]) => p.x !== 0));
    await layout([3, 2]);
    const added = await stateCopy();
    assert.deepEqual(added.assignments, before.assignments);
    assert.equal(await page.locator('.seat.has-name').count(), 4);
    assert.equal(await page.locator('.seat:not(.has-name)').getAttribute('data-seat-id'), 'c0r2');
    assert(added.offsets.every(([, p]) => p.x === 0 && p.y === 0));
    await sequential();
    await moveFirst();
    const unchanged = await stateCopy();
    await layout([3, 2]);
    assert.deepEqual(await stateCopy(), unchanged, 'identical layout preserves offsets and all state');
    await layout([2, 2]);
    assert.deepEqual((await stateCopy()).assignments, before.assignments);
    await moveFirst();
    const rejected = await stateCopy();
    const boardBefore = await page.locator('#seat-board').innerHTML();
    await layout([1, 2]);
    assert.match(await page.locator('#layout-error').textContent(), /この座席は削除できません/);
    assert.deepEqual(await stateCopy(), rejected);
    assert.equal(await page.locator('#seat-board').innerHTML(), boardBefore);
    await layout([2]);
    assert.deepEqual(await stateCopy(), rejected, 'occupied last column cannot be removed');
    await layout([2, 2, 1]);
    assert.deepEqual((await stateCopy()).assignments, before.assignments);
    await layout([2, 2]);
    await sequential();
    console.log('PASS: seat additions, unused removal, occupied removal rejection, exact rollback, offsets and sequential numbers.');

    // Number draws can survive harmless additions, but require confirmation if their numbers move.
    await fresh(); await layout([1, 1]); await names('名前A\n名前B');
    await page.locator('#shuffle-all').click();
    const nameAssignments = (await stateCopy()).assignments;
    await page.locator('#number-tab').click();
    for (let i = 0; i < 2; i++) { await page.locator('#draw-number').click(); await page.locator('#dialog-action').click(); }
    await layout([1, 1, 1]);
    assert.equal((await stateCopy()).numbers.length, 2);
    await layout([1, 1]);
    const numberBefore = await stateCopy();
    accept = false; await layout([2, 1]);
    assert.deepEqual(await stateCopy(), numberBefore);
    assert.match(dialogs.at(-1), /番号くじの抽選結果だけ/);
    accept = true; await layout([2, 1]);
    assert.deepEqual((await stateCopy()).numbers, []);
    assert.deepEqual((await stateCopy()).assignments, nameAssignments);
    await sequential();
    await page.locator('#name-tab').click(); await page.locator('#reset-draw').click();
    await page.locator('#number-tab').click();
    for (let i = 0; i < 3; i++) { await page.locator('#draw-number').click(); await page.locator('#dialog-action').click(); }
    const usedNumbers = await stateCopy(); await layout([1, 1]);
    assert.deepEqual(await stateCopy(), usedNumbers, 'number-used seats cannot be removed');
    console.log('PASS: number-only reset on renumbering, cancellation and number-used removal rejection.');

    // Download real JSON, reopen it and preserve IDs/snapshots without saving attendance.
    await fresh(); await layout([2, 2]); await names('同名\n同名\n三郎');
    const initial = await saveRoster('  3年1組  ');
    assert.equal(initial.filename, '3年1組_席替え.json');
    assert.equal(initial.data.name, '3年1組');
    assert.equal(initial.data.format, 'seat-shuffle-roster');
    assert.equal(initial.data.version, 1);
    assert.equal(initial.data.people.length, 3);
    assert.equal(new Set(initial.data.people.map(p => p.id)).size, 3);
    assert.equal(initial.data.lastArrangement, null);
    await attendance(); await page.locator('.person-item input').nth(2).check(); await attendance(false);
    await page.locator('#shuffle-all').click(); await moveFirst();
    const drawnButNotCaptured = await saveRoster();
    assert.equal(drawnButNotCaptured.data.lastArrangement, null, 'draws do not automatically capture an arrangement');
    const downloadsBeforeCapture = downloadCount;
    await page.locator('#save-arrangement').click();
    assert.equal(downloadCount, downloadsBeforeCapture, 'capturing an arrangement never downloads or overwrites a file');
    assert.match(await page.locator('#notice').textContent(), /名簿データに反映.*端末に残すには/);
    const exported = await saveRoster();
    const arrangement = exported.data.lastArrangement;
    assert.equal(arrangement.assignments.length, 2);
    assert(arrangement.offsets.some(([, p]) => p.x !== 0));
    assert(!/absent|attendance/.test(exported.raw));
    assert.deepEqual(exported.data.people, initial.data.people);
    assert.equal(fs.readFileSync(initial.path, 'utf8'), initial.raw, 'existing downloaded files remain unchanged');
    await page.reload(); await page.locator('#name-tab').click();
    assert.equal(await page.locator('#names-input').inputValue(), '');
    await chooseFile(exported);
    await page.locator('#roster-import').waitFor({ state: 'visible' });
    assert.equal((await stateCopy()).people.length, 0, 'choosing a file is not applying it');
    assert(await page.locator('#load-roster').isVisible());
    assert(await page.locator('#restore-arrangement').isVisible());
    await page.locator('#restore-arrangement').click();
    assert.deepEqual((await stateCopy()).people, exported.data.people);
    assert.deepEqual((await stateCopy()).assignments, arrangement.assignments);
    assert.deepEqual((await stateCopy()).columns, arrangement.columns);
    assert.deepEqual((await stateCopy()).offsets, arrangement.offsets);
    assert.equal(await page.locator('.person-item input:checked').count(), 0);
    assert.equal(await page.locator('.person-item label:visible').count(), 0);
    await layout([3, 2]);
    await importFile(exported);
    assert.equal((await stateCopy()).assignments.length, 0);
    assert.deepEqual((await stateCopy()).columns, [3, 2]);
    const retained = await saveRoster();
    assert.deepEqual(retained.data.lastArrangement, arrangement, 'roster-only import retains the original explicit snapshot');
    await page.locator('#shuffle-all').click();
    await page.locator('#save-arrangement').click();
    const updated = await saveRoster();
    assert.equal(updated.data.lastArrangement.assignments.length, 3);
    assert.deepEqual(updated.data.lastArrangement.columns, [3, 2]);
    assert.equal(fs.readFileSync(exported.path, 'utf8'), exported.raw);
    const workBeforeCancel = await stateCopy();
    await chooseFile(exported); await page.locator('#roster-import').waitFor({ state: 'visible' });
    await page.locator('#cancel-import').click();
    assert.deepEqual(await stateCopy(), workBeforeCancel);
    await chooseFile(exported); await page.locator('#roster-import').waitFor({ state: 'visible' });
    accept = false; await page.locator('#load-roster').click();
    assert.deepEqual(await stateCopy(), workBeforeCancel);
    accept = true; await page.locator('#cancel-import').click();
    await page.locator('#change-names').click(); await page.locator('#names-input').fill('変更した名前');
    const beforeOmit = downloadCount;
    accept = false; await page.locator('#save-roster').click();
    assert.equal(downloadCount, beforeOmit);
    accept = true;
    const changed = await saveRoster();
    assert.equal(changed.data.lastArrangement, null);
    assert.equal(changed.data.people[0].name, '変更した名前');
    await page.locator('#names-form button').click();
    assert.deepEqual((await stateCopy()).people, changed.data.people);
    console.log('PASS: real JSON downloads, file chooser round-trip, identities, snapshot capture/update, no attendance export, cancellation and draft isolation.');

    // Safe filenames/literal text; compact and expanded layouts at desktop/mobile widths.
    await fresh(); await page.locator('#name-tab').click();
    await page.locator('#names-input').fill('<img src=x onerror=alert(1)>\n同名\n同名');
    const literal = await saveRoster('ゼミ:/授業?');
    assert.equal(literal.filename, 'ゼミ__授業__席替え.json');
    await importFile(literal);
    assert.equal(await page.locator('#name-buttons img').count(), 0);
    await page.locator('#shuffle-all').click(); await page.locator('#save-arrangement').click();
    assert.equal(await page.locator('.seat img').count(), 0);
    const valid = (await saveRoster()).data;
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await attendance(false);
      assert.equal(await page.locator('.person-item label:visible').count(), 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `compact overflow at ${width}`);
      await attendance();
      assert(await page.locator('.person-item label').first().evaluate(el => el.getBoundingClientRect().height >= 44));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `attendance overflow at ${width}`);
      await attendance(false);
    }
    console.log('PASS: escaped literal names, safe filenames, standard file chooser and compact/expanded 320–1280px layouts.');

    // Restoration retains the existing protections for number draws.
    await fresh(); await layout([1, 1]); await names('復元A\n復元B');
    await page.locator('#shuffle-all').click(); await page.locator('#save-arrangement').click();
    const restoreFile = await saveRoster('復元用');
    await layout([2, 1]); await page.locator('#number-tab').click();
    for (let i = 0; i < 3; i++) { await page.locator('#draw-number').click(); await page.locator('#dialog-action').click(); }
    await page.locator('#name-tab').click();
    const blockedRestore = await stateCopy();
    await importFile(restoreFile, true);
    assert.match(await page.locator('#file-error').textContent(), /使用済みの座席が削除/);
    assert.deepEqual(await stateCopy(), blockedRestore);
    await page.locator('#number-tab').click(); await page.locator('#reset-draw').click();
    await page.evaluate(() => { window.originalDrawOne = drawOne; drawOne = () => 'c1r0'; });
    await page.locator('#draw-number').click(); await page.locator('#dialog-action').click();
    await page.evaluate(() => { drawOne = window.originalDrawOne; delete window.originalDrawOne; });
    await page.locator('#name-tab').click();
    const cancelRestore = await stateCopy(); accept = false;
    await page.locator('#restore-arrangement').click();
    assert.deepEqual(await stateCopy(), cancelRestore);
    accept = true; await page.locator('#restore-arrangement').click();
    assert.equal((await stateCopy()).numbers.length, 0);
    assert.deepEqual((await stateCopy()).columns, [1, 1]);
    assert.deepEqual((await stateCopy()).assignments, restoreFile.data.lastArrangement.assignments);
    await sequential();
    console.log('PASS: file restoration protects number draws and cancellation retains the current state.');

    // Bad files must not change current work or the last captured snapshot.
    const invalidFixtures = ['{broken', JSON.stringify({ ...valid, version: 999 }), JSON.stringify({ version: 1, rosters: [] })];
    function invalid(mutate) { const copy = JSON.parse(JSON.stringify(valid)); mutate(copy); invalidFixtures.push(JSON.stringify(copy)); }
    invalid(r => r.lastArrangement.assignments[0][1] = 'c99r99');
    invalid(r => r.lastArrangement.assignments[1][1] = r.lastArrangement.assignments[0][1]);
    invalid(r => r.lastArrangement.assignments[1][0] = r.lastArrangement.assignments[0][0]);
    invalid(r => r.lastArrangement.columns = [201]);
    invalid(r => r.people[1].id = r.people[0].id);
    invalid(r => r.people[0].name = '');
    invalid(r => r.lastArrangement.assignments[0][0] = 'unknown-person');
    invalid(r => r.lastArrangement.offsets = [['c0r0', { x: 'bad', y: 0 }]]);
    invalid(r => r.lastArrangement.savedAt = 'bad-date');
    const beforeInvalid = await stateCopy();
    for (const raw of invalidFixtures) {
      await chooseFile({ name: '壊れた名簿.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
      await page.waitForFunction(() => document.getElementById('file-error').textContent !== '');
      assert.deepEqual(await stateCopy(), beforeInvalid);
      assert(await page.locator('#roster-import').isHidden());
    }
    const preserved = await saveRoster();
    assert.deepEqual(preserved.data, restoreFile.data);
    await chooseFile({ name: '名簿.txt', mimeType: 'text/plain', buffer: Buffer.from(JSON.stringify(valid)) });
    await page.waitForFunction(() => document.getElementById('file-error').textContent.includes('.json'));
    assert.deepEqual(await stateCopy(), beforeInvalid);
    await chooseFile({ name: '巨大.json', mimeType: 'application/json', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, ' ') });
    await page.waitForFunction(() => document.getElementById('file-error').textContent.includes('大きすぎ'));
    assert.deepEqual(await stateCopy(), beforeInvalid);
    await page.evaluate(() => { window.originalFileText = File.prototype.text; File.prototype.text = async () => { throw new Error('read failure'); }; });
    await chooseFile(initial);
    await page.waitForFunction(() => document.getElementById('file-error').textContent.includes('読み込めませんでした'));
    assert.deepEqual(await stateCopy(), beforeInvalid);
    await page.evaluate(() => { File.prototype.text = window.originalFileText; delete window.originalFileText; });
    const beforeFailureDownloads = downloadCount;
    await page.evaluate(() => { window.originalCreateURL = URL.createObjectURL; URL.createObjectURL = () => { throw new Error('download failure'); }; });
    await page.locator('#save-roster').click();
    assert.match(await page.locator('#file-error').textContent(), /書き出せませんでした/);
    assert.doesNotMatch(await page.locator('#notice').textContent(), /ダウンロードを開始|保存しました/);
    assert.equal(downloadCount, beforeFailureDownloads);
    await page.evaluate(() => { URL.createObjectURL = window.originalCreateURL; delete window.originalCreateURL; });
    await page.locator('#reset-draw').click(); await drawPerson(0);
    // A subsequent valid import remains usable; extra attendance fields are discarded.
    const withExtra = JSON.parse(initial.raw); withExtra.absent = [withExtra.people[0].id]; withExtra.people[0].absent = true;
    await importFile({ name: '名簿.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(withExtra)) });
    assert.deepEqual((await stateCopy()).absent, []);
    const sanitized = await saveRoster();
    assert(!/absent/.test(sanitized.raw));
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpectedRequests, [], 'only static app requests and the existing visit counter are allowed');
    assert.equal(logs, loads, 'one existing visit request per load, none from files or attendance');
    assert.equal(await page.evaluate(() => window.browserStorageAccesses), 0);
    console.log('PASS: corrupt/version/reference/duplicate validation, failed reads/downloads, recovery, no browser storage access or additional network traffic.');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
