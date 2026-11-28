import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from '../dist/backend/src/app.js';
import { endRound, prepareRound, startRound, submitAnswers } from '../dist/backend/src/rounds.js';

const toolsDirectory = process.argv[2];
if (!toolsDirectory) throw new Error('請傳入安裝 Playwright Core 的資料夾路徑，詳見功能 008 驗收紀錄。');
const playwrightEntry = resolve(toolsDirectory, 'node_modules/playwright-core/index.mjs');
const { chromium } = await import(pathToFileURL(playwrightEntry).href);
const password = randomUUID();
let now = 100;
const { app, classrooms } = createApp({ teacherPassword: password, port: 0 }, { now: () => now });
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = 'http://127.0.0.1:' + server.address().port;
let browser;

function addUnit(activity, id) {
  const questions = ['一', '二'].map((label, i) => ({
    questionKey: id + '-key-' + i, unitId: id, questionId: id + '-part-' + (i + 1), origin: 'manual',
    prompt: '測試題幹 ' + label, missingPrompt: false, acceptedAnswers: ['標準答案' + label, '可接受答案' + label], questionRevision: 0,
  }));
  activity.units.push({ id, name: '測試題組 ' + id, questions });
  activity.queueUnitIds.push(id);
}

async function teacher(room) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
  await page.goto(base);
  await page.getByLabel('教師密碼').fill(password);
  await page.getByRole('button', { name: '登入活動' }).click();
  await page.getByRole('button', { name: '恢復主持' }).click();
  await page.getByRole('link', { name: '老師控制台' }).click();
  assert(page.url().includes(room.id));
  return page;
}

try {
  const executablePath = process.env.SPECKIT_EDGE_EXECUTABLE;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : { channel: 'msedge' }) });
  const room = await classrooms.create('獨立驗收教室');
  const location = classrooms.location(room);
  const scope = {
    'X-Classroom-Id': room.id, 'X-Activity-Id': location.activityId, 'X-Activity-Epoch': location.activityEpoch,
    'Content-Type': 'application/json',
  };
  const teacherHeaders = { ...scope, Authorization: 'Basic ' + Buffer.from('teacher:' + password).toString('base64') };
  const request = (path, options = {}) => fetch(base + '/api' + path, { headers: teacherHeaders, ...options });
  async function group(name) {
    const response = await request('/groups', { method: 'POST', body: JSON.stringify({ name }) });
    assert(response.ok);
    return (await response.json()).groups.find(row => row.name === name);
  }
  const alpha = await group('甲組');
  const beta = await group('乙組');
  const studentAuth = 'Basic ' + Buffer.from('student:' + room.activity.joinCodes.get(alpha.id)).toString('base64');
  const studentSession = await request('/sessions', {
    method: 'POST', headers: { Authorization: studentAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '測試學生' }),
  });
  assert(studentSession.ok);
  const studentHeaders = { ...scope, Authorization: studentAuth, 'X-Member-Id': (await studentSession.json()).memberId };
  const ids = ['legacy', 'allWrong', 'partial', 'noSource', 'graded', 'nextAfterGraded'];
  ids.forEach(id => addUnit(room.activity, id));
  const a = await teacher(room);
  let saves = 0;
  const publications = [];
  a.on('request', req => {
    if (req.method() === 'PATCH' && /\/review$/.test(req.url())) saves++;
    if (req.method() === 'POST' && /\/publish$/.test(req.url())) publications.push(new URL(req.url()).pathname);
  });
  const area = page => page.getByRole('complementary', { name: '審核操作' });
  const preview = (page, value) => page.getByRole('region', { name: '補答預覽' }).getByText(value, { exact: true });
  const publish = page => area(page).getByRole('button', { name: '確認定案' });
  const save = page => area(page).getByRole('button', { name: '儲存判分' });
  const legacy = '  舊人工補答原文  ';
  const storedRound = id => room.activity.rounds.find(item => item.id === id);
  function prepare(id, rows) {
    now += 4000;
    const round = prepareRound(room.activity, id);
    startRound(room.activity, round.id, now);
    // 此腳本重現 008 已開始回合的歷史相容情境。
    delete round.optionalSupplements;
    rows.forEach(([groupId, ...texts], index) => submitAnswers(room.activity, round.id, groupId,
      round.questions.map(({ questionId }, i) => ({ questionId, text: texts[i] })), Math.max(now + 2000, round.openAtByGroup[groupId]) + index));
    return round;
  }
  for (const [id, rows, expected] of [
    ['legacy', [], [legacy, '標準答案二']],
    ['allWrong', [[alpha.id, '錯一', '錯二']], ['標準答案一', '標準答案二']],
    ['partial', [[alpha.id, '可接受答案一', '錯二']], [undefined, '標準答案二']],
    ['noSource', [], ['標準答案一', undefined]],
  ]) {
    const round = prepare(id, rows);
    if (id === 'legacy' || id === 'noSource') {
      endRound(room.activity, round.id);
      if (id === 'legacy') round.supplements = [{ questionId: round.questions[0].questionId, text: legacy }];
      else round.questions[1].acceptedAnswers = [];
    } else {
      await a.getByRole('button', { name: '結束搶答' }).click();
    }
    if (expected[0]) await preview(a, expected[0].trim()).waitFor();
    else assert.equal(await preview(a, '標準答案一').count(), 0);
    if (expected[1]) await preview(a, expected[1]).waitFor();
    else await a.getByText('沒有可引用的答案', { exact: false }).waitFor();
    assert.equal(await a.locator('.review-layout textarea').count(), 0);
    assert.equal(await save(a).isDisabled(), true);
    assert.equal(storedRound(round.id).supplements.length, id === 'legacy' ? 1 : 0);
    await publish(a).click();
    await area(a).getByText('已定案。無勝組').waitFor();
    const teacherRows = await (await request('/rounds/' + round.id + '/results')).json();
    assert.deepEqual(teacherRows.map(row => row.teacherAnswer), expected);
    if (id === 'legacy') {
      const studentRows = await (await request('/rounds/' + round.id + '/results', { headers: studentHeaders })).json();
      assert.deepEqual(studentRows.map(row => row.publishedAnswer), expected);
      const csv = await (await request('/results.csv')).text();
      assert(csv.includes(legacy) && csv.includes('標準答案二'));
    }
  }
  assert.equal(saves, 0);
  console.log('SC-001 通過：四種情境均可定案，補答輸入與 PATCH 請求皆為零，舊人工補答在結果及 CSV 一致。');

  const graded = prepare('graded', [[alpha.id, '標準答案一', '  合理同義作答  '], [beta.id, '標準答案一', '乙組原答']]);
  await a.getByRole('button', { name: '結束搶答' }).click();
  const b = await teacher(room);
  const answers = a.locator('.review-group [role="group"]');
  const target = answers.nth(1);
  await target.waitFor();
  assert.equal(await answers.count(), 4);
  assert.deepEqual(await a.locator('.review-group h3').allTextContents(), ['甲組 · 第 1 順位', '乙組 · 第 2 順位']);
  const originals = await answers.locator('.question-prompt').allTextContents();
  assert.equal(originals[1], '  合理同義作答  ');
  const correct = row => row.getByRole('button', { name: '正確', exact: true });
  const wrong = row => row.getByRole('button', { name: '錯誤', exact: true });
  const selected = () => answers.locator('[aria-pressed="true"]').allTextContents();
  const initial = ['正確', '錯誤', '正確', '錯誤'];
  assert.deepEqual(await selected(), initial);
  await preview(a, '標準答案二').waitFor();
  await correct(target).click();
  assert.deepEqual(await selected(), ['正確', '正確', '正確', '錯誤']);
  await preview(a, '標準答案二').waitFor({ state: 'hidden' });
  await correct(target).focus();
  await a.keyboard.press('Shift+Tab');
  assert(await wrong(target).evaluate(node => node === document.activeElement && node.matches(':focus-visible')));
  await a.keyboard.press('Enter');
  assert.deepEqual(await selected(), initial);
  await preview(a, '標準答案二').waitFor();
  assert.deepEqual(await answers.locator('.question-prompt').allTextContents(), originals);
  await a.getByRole('button', { name: '甲組取消資格' }).click();
  await correct(target).click();
  await preview(a, '標準答案二').waitFor();
  await a.getByRole('button', { name: '甲組恢復資格' }).click();
  await preview(a, '標準答案二').waitFor({ state: 'hidden' });
  assert(await publish(a).isDisabled());
  for (const name of ['題目管理', '分組管理']) {
    await a.getByRole('link', { name, exact: true }).click();
    await target.waitFor({ state: 'hidden' });
    await a.getByRole('link', { name: '老師控制台', exact: true }).click();
    await target.waitFor();
    assert.equal(await correct(target).getAttribute('aria-pressed'), 'true');
    assert(await publish(a).isDisabled());
  }
  console.log('SC-002、SC-003 通過：逐筆按鈕、鍵盤焦點、原文、順位與資格切換均符合預期。');
  console.log('T026 通過：同分頁切換題目管理與分組管理後，草稿及定案限制仍在。');

  let release;
  const hold = new Promise(resolve => { release = resolve; });
  await a.route('**/api/rounds/*/review', async route => { await hold; await route.continue(); }, { times: 1 });
  await save(a).click();
  await area(a).getByText('儲存中…').waitFor();
  await b.getByRole('button', { name: '乙組取消資格' }).click();
  await save(b).click();
  await area(b).getByText('已儲存判分。').waitFor();
  const stale = a.waitForResponse(res => res.url().endsWith('/review') && res.status() === 409);
  release();
  await stale;
  await area(a).getByText('判分內容已更新', { exact: false }).waitFor();
  await area(a).getByText('請逐筆核對後再儲存', { exact: false }).waitFor();
  assert.equal(await correct(target).getAttribute('aria-pressed'), 'true');
  assert(await save(a).isDisabled());
  assert(await publish(a).isDisabled());
  assert.equal(storedRound(graded.id).reviewRevision, 1);
  assert.equal(storedRound(graded.id).submissions[0].answers[1].overrideCorrect, undefined);
  const path = '/rounds/' + graded.id + '/review';
  const edit = { method: 'PATCH', body: JSON.stringify({ reviewRevision: 1, grades: [
    { groupId: alpha.id, questionId: graded.questions[1].questionId, correct: true },
  ] }) };
  assert.equal((await request(path, { ...edit, headers: studentHeaders })).status, 403);
  await area(a).getByRole('button', { name: '保留草稿' }).click();
  await save(a).click();
  await area(a).getByText('已儲存判分。').waitFor();
  const gradedEndpoint = '**/api/rounds/' + graded.id;
  let releaseResult;
  const waitForNextPublish = new Promise(resolve => { releaseResult = resolve; });
  await a.route(gradedEndpoint + '/publish', async route => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.abort('failed');
  }, { times: 1 });
  await a.route(gradedEndpoint + '/results', async route => {
    await waitForNextPublish;
    await route.continue();
  }, { times: 1 });
  const previousResult = a.getByRole('complementary', { name: `第 ${graded.sequenceNumber} 題的定案結果` });
  try {
    await publish(a).click();
    await area(a).getByText('正在確認勝組', { exact: false }).waitFor();
    await a.getByRole('button', { name: '開放搶答' }).click();
    await a.getByRole('button', { name: '結束搶答' }).click();
    await previousResult.getByText('正在確認勝組', { exact: false }).waitFor();
    await publish(a).click();
    await area(a).getByText('已定案。無勝組').waitFor();
    await previousResult.getByText('正在確認勝組', { exact: false }).waitFor();
  } finally {
    releaseResult();
  }
  await previousResult.getByText('已定案。勝組：甲組').waitFor();
  const next = room.activity.rounds.at(-1);
  assert.equal(next.unitId, 'nextAfterGraded');
  assert.deepEqual(publications.slice(-2), [graded.id, next.id].map(id => '/api/rounds/' + id + '/publish'));
  assert.equal(publications.filter(endpoint => endpoint === '/api/rounds/' + graded.id + '/publish').length, 1);
  assert.equal(storedRound(graded.id).winnerGroupId, alpha.id);
  assert.deepEqual(storedRound(graded.id).supplements, []);
  assert.equal((await request(path, edit)).status, 409);
  console.log('SC-004 通過：過期儲存回傳 409，草稿保留至核對，勝組正確，學生及已定案改判遭拒。');
  console.log('T027 通過：後一回合先完成定案，前一回合隨後在自己的操作區顯示勝組。');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
