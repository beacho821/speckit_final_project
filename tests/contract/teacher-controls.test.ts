import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { basic, classroom, worksheetHeaders } from '../helpers/classroom';
import { worksheet } from '../helpers/worksheet';

it('子帳號只能管理自己教室、改自己的密碼，改密後舊登入失效', async () => {
  const c = await classroom();
  const username = '林老師', password = randomUUID(), next = randomUUID();
  try {
    const login = (secret: string) => c.rawRequest('/sessions', { Authorization: basic('teacher', secret) }, { username }, 'POST');
    const displayName = '林思瑩';
    expect((await c.request('/teachers', c.teacher, { username, password, displayName }, 'POST')).status).toBe(201);
    expect((await c.request('/teachers', c.teacher, { username, password }, 'POST')).status).toBe(409);
    const session = await (await login(password)).json();
    expect(session.displayName).toBe(displayName);
    const auth = { ...c.scope, Authorization: 'Bearer ' + session.token };
    expect(await (await c.rawRequest('/classrooms', auth)).json()).toEqual([]);
    const mine = await (await c.rawRequest('/classrooms', auth, { name: '自己的教室' }, 'POST')).json();
    expect((await c.rawRequest('/classrooms/' + mine.id, auth)).status).toBe(200);
    expect((await c.request('/classrooms/' + mine.id)).status).toBe(404);
    expect((await c.rawRequest('/classrooms/' + c.room.id, auth, undefined, 'DELETE')).status).toBe(404);
    expect((await c.rawRequest('/view', auth)).status).toBe(409);
    expect((await c.rawRequest('/teachers', auth, { username: '第二位', password }, 'POST')).status).toBe(403);
    for (const currentPassword of [undefined, next]) {
      const rejected = await c.rawRequest('/teachers/me/password', auth, { currentPassword, password: next }, 'PATCH');
      expect(rejected.status).toBe(403);
      expect((await rejected.json()).code).toBe('CURRENT_PASSWORD_INCORRECT');
    }
    expect((await c.rawRequest('/classrooms', auth)).status).toBe(200);
    expect((await login(next)).status).toBe(401);
    const other = { Authorization: 'Bearer ' + (await (await login(password)).json()).token };
    expect((await c.rawRequest('/teachers/me/password', auth, { currentPassword: password, password: next }, 'PATCH')).status).toBe(204);
    expect((await c.rawRequest('/classrooms', auth)).status).toBe(401);
    expect((await c.rawRequest('/classrooms', other)).status).toBe(401);
    expect((await login(password)).status).toBe(401);
    expect(await (await login(next)).json()).toMatchObject({ displayName, master: false });
  } finally { await c.close(); }
});

it('目的組拒絕同名，移組後原分頁切換組別並可恢復，移除後撤銷登入', async () => {
  const c = await classroom();
  try {
    const a = await c.group('甲'), b = await c.group('乙');
    const old = await c.student(a.joinCode), duplicate = await c.student(b.joinCode);
    const tab = { ...old.headers, Authorization: basic('student', old.session.memberCredential) };
    const path = (group: string, member: string) => '/groups/' + group + '/members/' + member;
    const move = () => c.request(path(a.id, old.session.memberId), c.teacher, { targetGroupId: b.id }, 'PATCH');
    expect((await move()).status).toBe(409);
    expect((await c.request(path(b.id, duplicate.session.memberId), c.teacher, undefined, 'DELETE')).status).toBe(200);
    const before = await (await c.request('/view', tab)).json();
    const waiting = c.request('/view?after=' + before.version + '&group=' + a.id, tab);
    expect((await move()).status).toBe(200);
    expect(await (await waiting).json()).toMatchObject({ groupId: b.id, groupName: b.name });
    expect(await (await c.request('/sessions', tab, { name: old.session.studentName }, 'POST')).json()).toMatchObject({ groupId: b.id, memberId: old.session.memberId });
    expect((await c.request('/view', { ...tab, 'X-Member-Id': duplicate.session.memberId })).status).toBe(401);
    expect(await (await c.request('/view', old.headers)).json()).toMatchObject({ groupId: b.id });
    expect(await (await c.request('/sessions', old.headers, { name: old.session.studentName }, 'POST')).json())
      .toMatchObject({ memberId: old.session.memberId, groupId: b.id });
    const moved = await c.student(b.joinCode);
    expect(c.activity.members.size).toBe(1);
    expect((await c.request(path(b.id, moved.session.memberId), c.teacher, undefined, 'DELETE')).status).toBe(200);
    expect((await c.request('/view', moved.headers)).status).toBe(401);
    expect((await c.request('/view', old.headers)).status).toBe(401);
    expect((await c.request('/view', tab)).status).toBe(401);
  } finally { await c.close(); }
});

it.each(['個人憑證', '原組加入碼'])('移組並刪除原組後可用%s替新組作答', async credentialType => {
  const c = await classroom();
  try {
    const source = await c.group('甲'), target = await c.group('乙');
    const student = await c.student(source.joinCode), other = await c.student(target.joinCode, '小安');
    const tab = credentialType === '原組加入碼' ? student.headers : { ...student.headers, Authorization: basic('student', student.session.memberCredential) };
    expect((await c.request('/view', { ...tab, 'X-Member-Id': other.session.memberId })).status).toBe(401);
    expect((await c.request('/groups/' + source.id + '/members/' + student.session.memberId, c.teacher, { targetGroupId: target.id }, 'PATCH')).status).toBe(200);
    expect((await c.request('/groups/' + source.id, c.teacher, undefined, 'DELETE')).status).toBe(200);
    const question = await (await c.request('/questions', c.teacher, { prompt: '請填寫答案' }, 'POST')).json();
    const round = await (await c.request('/rounds', c.teacher, { unitId: question.unitId }, 'POST')).json();
    await c.startConfiguredRound(round.id);
    const sent = await c.request('/rounds/' + round.id + '/submissions', tab, { answers: [{ questionId: question.questionId, text: '答案' }] }, 'POST');
    expect(sent.status).toBe(201);
    expect(c.activity.rounds[0].submissions.map(row => row.groupId)).toEqual([target.id]);
  } finally { await c.close(); }
});

it('只帶版本號的舊分頁可連續移組，未登入過的舊組別無法延用成員身分', async () => {
  const c = await classroom();
  try {
    const a = await c.group('甲'), b = await c.group('乙'), d = await c.group('丙');
    const { headers, session } = await c.student(a.joinCode);
    for (const [from, to] of [[a, b], [b, d]]) {
      const { version } = await (await c.request('/view', headers)).json();
      const waiting = c.request('/view?after=' + version, headers);
      const path = '/groups/' + from.id + '/members/' + session.memberId;
      expect((await c.request(path, c.teacher, { targetGroupId: to.id }, 'PATCH')).status).toBe(200);
      const view = await (await waiting).json();
      expect(view.groupId).toBe(to.id);
      expect(view.version).toBeGreaterThan(version);
    }
    const neverUsed = { ...headers, Authorization: basic('student', b.joinCode) };
    expect((await c.request('/view', neverUsed)).status).toBe(401);
    await c.request('/groups/' + d.id + '/members/' + session.memberId, c.teacher, undefined, 'DELETE');
    const rejoined = await c.student(a.joinCode);
    expect(rejoined.session.memberId).not.toBe(session.memberId);
    expect((await c.request('/view', headers)).status).toBe(401);
  } finally { await c.close(); }
});

it('入列前選用 AI 的主要答案及同義答案；新版題庫拒絕重送確認', async () => {
  const suggestAnswers = vi.fn(async () => ['中央處理器', 'CPU']);
  const c = await classroom({ suggestAnswers, importWorksheet: async () => ({ worksheet: structuredClone(worksheet) }) });
  try {
    const headers = { ...c.teacher, ...worksheetHeaders(c.activity), 'X-Prepare-Answers': 'true' };
    const preview = await (await c.rawRequest('/worksheet/import', headers, { url: '隔離來源' }, 'POST')).json();
    expect(c.activity.queueUnitIds).toEqual([]);
    const answer = await (await c.request('/questions/suggest-answers', c.teacher, { prompt: '處理指令的元件？' }, 'POST')).json();
    expect(suggestAnswers).toHaveBeenCalledExactlyOnceWith('處理指令的元件？');
    expect(preview.questions[1].part).toContain('1（2）');
    expect(preview.units).toEqual(worksheet.units.map(({ id, name, fillBlankIds }) => ({ id, name, fillBlankIds })));
    await c.request('/questions/suggest-answers', c.teacher, { prompt: '處理指令的元件？', part: preview.questions[1].part }, 'POST');
    expect(suggestAnswers.mock.lastCall?.[0]).toContain(preview.questions[1].part);
    const body = { generation: preview.generation, answers: [{ id: preview.questions[0].id, text: answer.answers.join('\n') }] };
    expect((await c.rawRequest('/worksheet/confirm', headers, body, 'POST')).status).toBe(200);
    expect(c.activity.units[0].questions.map(q => q.acceptedAnswers)).toEqual([['中央處理器', 'CPU'], []]);
    expect((await c.rawRequest('/worksheet/confirm', headers, body, 'POST')).status).toBe(409);
    expect((await c.request('/questions/suggest-answers', c.teacher, { prompt: '  ' }, 'POST')).status).toBe(422);
  } finally { await c.close(); }
});
