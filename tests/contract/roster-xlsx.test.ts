import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { classroom } from '../helpers/classroom';

let c: Awaited<ReturnType<typeof classroom>>;
beforeEach(async () => { c = await classroom(); });
afterEach(async () => { await c?.close(); });
const sample = () => readFile('frontend/public/組別名單範例.xlsx');
const upload = (body: Buffer, headers: Record<string, string> = c.teacher) => fetch(c.base + '/api/roster/import/xlsx', {
  method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(body),
});

it('可回匯範例，合併既有組別並以座號區分同名，重送不重複新增', async () => {
  const group = await c.group('第一組');
  const participant = await c.student(group.joinCode, '01 王小明');
  const bytes = await sample();
  const result = await (await upload(bytes)).json();
  expect(result).toMatchObject({ added: 3, skipped: 1 });
  expect(result.roster.groups).toHaveLength(2);
  expect(result.roster.groups[0]).toMatchObject({ id: group.id, joinCode: group.joinCode, members: [
    { name: '01 王小明', id: participant.session.memberId }, { name: '12 王小明' },
  ] });
  expect(await (await upload(bytes)).json()).toMatchObject({ added: 0, skipped: 4, roster: result.roster });
  expect((await c.student(group.joinCode, '12 王小明')).session.memberId).toBe(result.roster.groups[0].members[1].id);
  expect((await upload(bytes, participant.headers)).status).toBe(403);
});

it('收件中手動與 Excel 補組即時生效，停止收件與公布後保留回合和頒獎名單', async () => {
  await c.group('原組');
  const question = await (await c.request('/questions', c.teacher, { prompt: '填一個字' }, 'POST')).json();
  const round = await (await c.request('/rounds/open-next', c.teacher, {
    unitId: question.unitId, catalogRevision: c.activity.catalogRevision,
  }, 'POST')).json();
  const view = await (await c.request('/view')).json();
  const pending = c.request('/view?after=' + view.version);
  const manual = await c.group('第一組');
  expect((await (await pending).json()).rosterVersion).toBeGreaterThan(view.rosterVersion);
  const imported = await (await upload(await sample())).json();
  expect(imported.added).toBe(4);
  expect(imported.roster.groups[1].id).toBe(manual.id);
  const added = imported.roster.groups[2];
  const student = await c.student(added.joinCode, added.members[0].name);
  const active = await (await c.request('/view', student.headers)).json();
  expect(active).toMatchObject({ phase: 'active', cooldownMs: 0 });
  expect((await c.request('/rounds/' + round.id + '/submissions', student.headers, {
    answers: [{ questionId: active.unit.questionIds[0], text: '答案' }],
  }, 'POST')).status).toBe(201);
  await c.request('/rounds/' + round.id + '/end', c.teacher, undefined, 'POST');
  const later = await c.group('收件後新組');
  await c.publishReviewedRound(round.id);
  const rows = await (await c.request('/rounds/' + round.id + '/results')).json();
  expect(rows[0].groups.map((g: { groupId: string }) => g.groupId)).toContain(added.id);
  expect(rows[0].groups.map((g: { groupId: string }) => g.groupId)).not.toContain(later.id);
  await c.request('/settlement/publish', c.teacher, {}, 'POST');
  const before = await (await c.request('/view')).json();
  await c.group('頒獎後新組');
  expect((await (await c.request('/view')).json()).settlement).toEqual(before.settlement);
});

it.each([
  [['甲組', '小明'], '座號'],
  [['甲組', ''], '名字'],
  [['甲組', '小華', '多餘'], '兩欄'],
])('第 3 列不合規時整批取消 %j', async (badRow, reason) => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('名單').addRows([['組別', '名字'], ['甲組', '小明'], badRow]);
  const response = await upload(Buffer.from(await book.xlsx.writeBuffer()));
  expect(response.status).toBe(422);
  const { message } = await response.json();
  expect(message).toContain('第 3 列');
  expect(message).toContain(reason);
  expect((await (await c.request('/roster')).json()).groups).toEqual([]);
});
