import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from '../dist/backend/src/app.js';

if (!process.argv[2]) throw Error('請提供安裝 playwright-core 的資料夾。');
const { chromium } = await import(pathToFileURL(resolve(process.argv[2], 'node_modules/playwright-core/index.mjs')).href);
const password = randomUUID();
const { app, classrooms } = createApp({ teacherPassword: password, port: 0 });
const room = await classrooms.create('冷卻驗收教室');
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = 'http://127.0.0.1:' + server.address().port;
const headers = { Authorization: 'Basic ' + Buffer.from('teacher:' + password).toString('base64'),
  'X-Classroom-Id': room.id, 'X-Activity-Id': room.activity.id, 'X-Activity-Epoch': classrooms.runtime, 'Content-Type': 'application/json' };
let browser;
async function post(path, body = {}) {
  const response = await fetch(base + '/api' + path, { method: 'POST', headers, body: JSON.stringify(body) });
  assert(response.ok, path + '：' + response.status);
  return response.json();
}
async function student(name) {
  const roster = await post('/groups', { name });
  const page = await browser.newPage();
  await page.goto(base);
  await page.getByRole('tab', { name: '學生' }).click();
  await page.getByLabel('加入碼', { exact: true }).fill(roster.groups.find(g => g.name === name).joinCode);
  await page.getByLabel('名稱', { exact: true }).fill('測試學生');
  await page.getByRole('button', { name: '加入活動' }).click();
  await page.getByText(name + ' · 測試學生', { exact: true }).waitFor();
  return page;
}
async function open(prompt) {
  const q = await post('/questions', { prompt, acceptedAnswersText: '答對', catalogRevision: room.activity.catalogRevision });
  return post('/rounds/open-next', { unitId: q.unitId, catalogRevision: room.activity.catalogRevision });
}
async function finish(round) {
  await post('/rounds/' + round.id + '/end');
  await post('/rounds/' + round.id + '/publish', { reviewRevision: 0 });
}
const submit = page => page.getByRole('button', { name: '送出本組答案' });
async function send(page) {
  const receipt = page.waitForResponse(r => r.url().endsWith('/submissions'));
  await submit(page).click();
  assert.equal((await receipt).status(), 201);
}
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const alpha = await student('甲組'), beta = await student('乙組');
  const teacher = await browser.newPage();
  await teacher.goto(base);
  await teacher.getByLabel('教師密碼').fill(password);
  await teacher.getByRole('button', { name: '登入活動' }).click();
  await teacher.getByRole('button', { name: /恢復主持|繼續主持/ }).click();
  await teacher.getByRole('link', { name: '老師控制台', exact: true }).click();
  const popup = teacher.waitForEvent('popup');
  await teacher.getByRole('link', { name: /開啟教室投影/ }).click();
  const projection = await popup;
  const teacherAlpha = teacher.locator('.progress-card').filter({ hasText: '甲組' });
  const projectedAlpha = projection.locator('.standings-list li').filter({ hasText: '甲組' });
  const first = await open('第一題');
  await alpha.getByRole('textbox').fill('答對');
  await send(alpha);
  await finish(first);
  const second = await open('第二題');
  await alpha.getByText('本組本回合冷卻 8 秒', { exact: true }).waitFor();
  for (const row of [teacherAlpha, projectedAlpha]) await row.getByText(/冷卻中 · 剩/).waitFor();
  assert(await alpha.getByRole('textbox').isDisabled());
  assert(await alpha.getByText('第二題', { exact: true }).isVisible());
  assert(await submit(alpha).isDisabled());
  await beta.getByText('第二題', { exact: true }).waitFor();
  await beta.getByRole('textbox').fill('答對');
  assert(await submit(beta).isEnabled());
  await send(beta);
  await alpha.getByText('冷卻已結束，現在可以填答與送出。').waitFor();
  for (const row of [teacherAlpha, projectedAlpha]) await row.getByText('可搶答', { exact: true }).waitFor();
  assert(await alpha.getByRole('textbox').isEnabled());
  await alpha.getByRole('textbox').fill('未答對');
  await send(alpha);
  assert.deepEqual(room.activity.rounds.at(-1).submissions.map(s => s.groupId), [room.activity.groups[1].id, room.activity.groups[0].id]);
  await finish(second);
  await open('第三題');
  for (const [page, seconds] of [[alpha, 3.45], [beta, 5.75]]) {
    await page.getByText(`本組本回合冷卻 ${seconds} 秒`, { exact: true }).waitFor();
    assert(await page.getByRole('textbox').isDisabled());
    assert(await submit(page).isDisabled());
  }
  console.log('Edge 驗收通過：冷卻中可讀題，期滿才開放填答與送出。兩組輪流得標後分別等待 3.45 秒與 5.75 秒。');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
