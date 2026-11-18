import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Classrooms } from '../../backend/src/classrooms';
import { openClassroomStorage } from '../../backend/src/classroom-store';
import { basic, classroom } from '../helpers/classroom';

it('全班投影限教師，組別碼僅顯示該組，輪詢收到收件並可撤銷', async () => {
  const c = await classroom();
  try {
    const group = await c.group('甲組');
    await c.group('乙組');
    const student = await c.student(group.joinCode, '不顯示名稱');
    const code = await (await c.request('/groups/' + group.id + '/projection-code', c.teacher, undefined, 'POST')).json();
    const projection = { Authorization: basic('projection', code.code) };
    const full = '/classrooms/' + c.room.id + '/projection';
    expect((await c.request(full, projection)).status).toBe(401);
    expect((await c.request('/sessions', { Authorization: basic('student', code.code) }, { name: '測試' }, 'POST')).status).toBe(401);
    const question = await (await c.request('/questions', c.teacher, { questionId: '1', prompt: '準備中的私有題目' }, 'POST')).json();
    const round = await (await c.request('/rounds', c.teacher, { unitId: question.unitId }, 'POST')).json();
    const preparing = await (await c.request(full)).json();
    expect(preparing.questions).toEqual([]);
    expect(preparing.groups).toHaveLength(2);
    await c.startConfiguredRound(round.id);
    const initial = await (await c.request('/projections/group/session', projection, undefined, 'POST')).json();
    expect(initial.groups).toEqual([{ id: group.id, name: '甲組', received: false }]);
    expect(initial.questions[0].prompt).toBe('準備中的私有題目');
    const pending = c.request('/projections/group/view?after=' + initial.version, projection);
    await c.request('/rounds/' + round.id + '/submissions', student.headers, { answers: [{ questionId: '1', text: '不顯示答案' }] }, 'POST');
    const received = await (await pending).json();
    expect(received.groups[0].received).toBe(true);
    expect(JSON.stringify(received)).not.toMatch(/不顯示答案|不顯示名稱|乙組/);
    await c.finishRound(round.id);
    await c.request('/classrooms/' + c.room.id + '/activities', c.teacher, undefined, 'POST');
    expect((await c.request('/projections/group/view', projection)).status).toBe(401);
  } finally { await c.close(); }
});


it('重啟後拒絕舊組別投影碼，重新發出的投影碼可使用', async () => {
  const root = await mkdtemp(join(tmpdir(), 'projection-restart-'));
  const path = join(root, 'classrooms');
  const password = '測試密碼';
  const restore = async () => Classrooms.restore(await openClassroomStorage(path), password);
  try {
    const first = await classroom({}, await restore(), password);
    const roomId = first.room.id;
    let groupId: string;
    let oldCode: string;
    try {
      groupId = (await first.group('重啟組別')).id;
      const response = await first.request('/groups/' + groupId + '/projection-code', first.teacher, undefined, 'POST');
      expect(response.status).toBe(200);
      oldCode = (await response.json()).code;
    } finally { await first.close(); }
    const second = await classroom({}, await restore(), password);
    try {
      const headers = (code: string) => ({ Authorization: basic('projection', code) });
      expect((await second.request('/projections/group/session', headers(oldCode), undefined, 'POST')).status).toBe(401);
      const restored = second.classrooms.location(second.classrooms.get(roomId));
      const teacher = { ...second.teacher, 'X-Classroom-Id': roomId, 'X-Activity-Id': restored.activityId };
      const next = await second.request('/groups/' + groupId + '/projection-code', teacher, undefined, 'POST');
      expect(next.status).toBe(200);
      const newCode = (await next.json()).code;
      expect(newCode.split('-')[0]).not.toBe(oldCode.split('-')[0]);
      const view = await second.request('/projections/group/session', headers(newCode), undefined, 'POST');
      expect(view.status).toBe(200);
      expect(await view.json()).toMatchObject({ groupName: '重啟組別' });
    } finally { await second.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
