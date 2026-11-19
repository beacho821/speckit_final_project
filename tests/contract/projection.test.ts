import { expect, it } from 'vitest';
import { basic, classroom } from '../helpers/classroom';

it('全班投影限教師並隔離教室，已停止的組別投影路徑均找不到', async () => {
  const c = await classroom();
  try {
    const group = await c.group('甲組');
    await c.group('乙組');
    const student = await c.student(group.joinCode, '不顯示名稱');
    const retired = { Authorization: basic('projection', '舊投影碼') };
    const full = '/classrooms/' + c.room.id + '/projection';
    const other = await c.classrooms.create('另外一間');
    expect((await c.request('/classrooms/' + other.id + '/projection')).status).toBe(409);
    expect((await c.request(full, retired)).status).toBe(401);
    expect((await c.request(full, student.headers)).status).toBe(403);
    expect((await c.request('/groups/' + group.id + '/projection-code', c.teacher, undefined, 'POST')).status).toBe(404);
    expect((await c.request('/projections/group/session', retired, undefined, 'POST')).status).toBe(404);
    expect((await c.request('/projections/group/view', retired)).status).toBe(404);
    const question = await (await c.request('/questions', c.teacher, { prompt: '準備中的私有題目', acceptedAnswersText: '答案' }, 'POST')).json();
    const round = await (await c.request('/rounds', c.teacher, { unitId: question.unitId }, 'POST')).json();
    const preparing = await (await c.request(full)).json();
    expect(preparing.questions).toEqual([]);
    expect(preparing.groups).toHaveLength(2);
    expect((await c.startConfiguredRound(round.id)).status).toBe(200);
    const active = await (await c.request(full)).json();
    expect(active.questions[0].prompt).toBe('準備中的私有題目');
    const pending = c.request(full + '?after=' + active.version);
    await c.request('/rounds/' + round.id + '/submissions', student.headers, {
      answers: [{ questionId: question.questionId, text: '不顯示答案' }],
    }, 'POST');
    const received = await (await pending).json();
    expect(received.groups.map((item: { received: boolean }) => item.received)).toEqual([true, false]);
    expect(JSON.stringify(received)).not.toMatch(/不顯示答案|不顯示名稱/);
    await c.finishRound(round.id);
    await c.request('/classrooms/' + c.room.id + '/activities', c.teacher, undefined, 'POST');
    expect((await c.request(full)).status).toBe(409);
  } finally { await c.close(); }
});
