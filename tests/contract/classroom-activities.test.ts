import { expect, it } from 'vitest';
import { basic, classroom } from '../helpers/classroom';

it('新活動沿用備課與分組，保留歷史答案並撤銷舊碼', async () => {
  const c = await classroom();
  try {
    const group = await c.group();
    const student = await c.student(group.joinCode);
    const question = await (await c.request('/questions', c.teacher, { questionId: '1', prompt: '請填寫測試答案。' }, 'POST')).json();
    const round = await (await c.request('/rounds', c.teacher, { unitId: question.unitId }, 'POST')).json();
    expect((await c.startConfiguredRound(round.id)).status).toBe(200);
    const room = '/classrooms/' + c.room.id;
    expect((await c.request(room + '/activities', c.teacher, undefined, 'POST')).status).toBe(409);
    expect(await (await c.request(room)).json()).toMatchObject({ activityId: c.activity.id, phase: 'active' });
    expect((await c.request('/rounds/' + round.id + '/submissions', student.headers, { answers: [{ questionId: question.questionId, text: '答案' }] }, 'POST')).status).toBe(201);
    expect((await c.request('/rounds/' + round.id + '/end', c.teacher, undefined, 'POST')).status).toBe(200);
    expect((await c.request(room + '/activities', c.teacher, undefined, 'POST')).status).toBe(409);
    expect(await (await c.request(room)).json()).toMatchObject({ activityId: c.activity.id, phase: 'reviewing' });
    const history = room + '/activities/history';
    expect(await (await c.request(history)).json()).toEqual([]);
    expect((await c.request(history, student.headers)).status).toBe(403);
    expect((await c.request(history, { Authorization: basic('projection', '舊投影憑證') })).status).toBe(401);
    await c.publishReviewedRound(round.id);
    const next = await c.request(room + '/activities', c.teacher, undefined, 'POST');
    expect(next.status).toBe(201);
    const location = await next.json();
    const teacher = { ...c.teacher, 'X-Activity-Id': location.activityId };
    const roster = await (await c.request('/roster', teacher)).json();
    expect(roster.locked).toBe(false);
    expect(c.room.activity.queueUnitIds).toEqual([question.unitId]);
    expect(roster.groups[0].name).toBe(group.name);
    expect((await c.request('/groups/' + group.id, teacher, { name: '改名' }, 'PATCH')).status).toBe(200);
    const archived = await (await c.request(history, teacher)).json();
    expect(archived).toEqual([{
      activityId: c.activity.id, startedAt: expect.any(Number), archivedAt: expect.any(Number),
      groups: [{ id: group.id, name: group.name, members: [{ id: student.session.memberId, name: '小明' }] }],
    }]);
    const foreign = await c.classrooms.create('另一間教室');
    expect(await (await c.request('/classrooms/' + foreign.id + '/activities/history', teacher)).json()).toEqual([]);
    const old = await (await c.request(room + '/activities/' + c.activity.id + '/rounds/' + round.id + '/results', teacher)).json();
    expect(old[0]).toMatchObject({ questionNumber: 1, partNumber: null });
    expect(old[0].groups[0]).toMatchObject({ groupName: group.name, answer: '答案', correct: true });
    const oldLogin = await c.request('/sessions', { Authorization: basic('student', group.joinCode) }, { name: '小明' }, 'POST');
    expect(oldLogin.status).toBe(401);
  } finally { await c.close(); }
});

it('並行以同一場活動開始新場只會成功一次', async () => {
  const c = await classroom();
  try {
    const path = '/classrooms/' + c.room.id + '/activities';
    const [first, second] = await Promise.all([
      c.request(path, c.teacher, undefined, 'POST'),
      c.request(path, c.teacher, undefined, 'POST'),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const rejected = first.status === 409 ? first : second;
    expect(await rejected.json()).toMatchObject({ code: 'ACTIVITY_EXPIRED' });
    const history = await c.request(path + '/history');
    expect(await history.json()).toHaveLength(1);
  } finally { await c.close(); }
});
