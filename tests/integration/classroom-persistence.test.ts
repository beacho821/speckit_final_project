import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Classrooms } from '../../backend/src/classrooms.js';
import { openClassroomStorage } from '../../backend/src/classroom-store.js';
import { basic, classroom } from '../helpers/classroom';

it('收件保存後可由另一進程恢復審核，轉換存檔失敗時只停用該教室', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'classroom-restart-'));
  const path = join(directory, 'rooms');
  const password = randomUUID();
  const initial = await Classrooms.restore(await openClassroomStorage(path), password);
  const c = await classroom({}, initial, password);
  try {
    const group = await c.group();
    const student = await c.student(group.joinCode);
    const other = await initial.create('第二間');
    const question = await (await c.request('/questions', c.teacher, { questionId: '1', prompt: '請輸入本題答案。' }, 'POST')).json();
    const round = await (await c.request('/rounds', c.teacher, { unitId: question.unitId }, 'POST')).json();
    expect((await c.startConfiguredRound(round.id)).status).toBe(200);
    expect((await c.request('/rounds/' + round.id + '/submissions', student.headers, { answers: [{ questionId: '1', text: '答案' }] }, 'POST')).status).toBe(201);
    const savedFile = join(path, c.room.id + '.json');
    const before = await readFile(savedFile, 'utf8');
    const incomplete = await openClassroomStorage(path);
    const recovered = await Classrooms.restore({
      ...incomplete,
      async save(record) { if (record.id === c.room.id) throw new Error('故障'); await incomplete.save(record); },
    }, password);
    expect(recovered.list().find(room => room.id === c.room.id)?.unavailable).toBe(true);
    expect(recovered.get(other.id).name).toBe('第二間');
    expect(await readFile(savedFile, 'utf8')).toBe(before);

    const next = await Classrooms.restore(await openClassroomStorage(path), password);
    const reopened = next.get(c.room.id);
    expect(reopened.activity.rounds[0]).toMatchObject({ phase: 'reviewing', submissions: [{ rank: 1, answers: [{ text: '答案', autoCorrect: true }] }] });
    const server = await classroom({}, next, password);
    try {
      const login = (code: string) => server.request('/sessions', { Authorization: basic('student', code) }, { name: '小明' }, 'POST');
      expect((await login(group.joinCode)).status).toBe(401);
      const joined = await login(reopened.activity.joinCodes.get(group.id)!);
      expect(joined.status).toBe(200);
      expect(await joined.json()).toMatchObject({ classroomId: c.room.id, memberId: student.session.memberId });
      expect((await server.request('/classrooms/' + c.room.id, server.teacher, undefined, 'DELETE')).status).toBe(204);
      expect(() => next.get(c.room.id)).toThrow();
    } finally { await server.close(); }
  } finally {
    await c.close();
    await rm(directory, { force: true, recursive: true });
  }
});

it('兩間各兩組與兩筆定案在重啟後保留，刪除其中一間後另一間紀錄仍完整', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'classroom-history-'));
  const path = join(directory, 'rooms');
  const password = randomUUID();
  const initial = await Classrooms.restore(await openClassroomStorage(path), password);
  const a = await classroom({}, initial, password);
  const b = await classroom({}, initial, password);
  try {
    async function rounds(c: typeof a) {
      await c.group('乙組');
      const group = await c.group('甲組');
      const student = await c.student(group.joinCode);
      for (const questionId of ['1', '2']) {
        const question = await (await c.request('/questions', c.teacher, { questionId, prompt: '請作答。' }, 'POST')).json();
        const round = await (await c.request('/rounds', c.teacher, { unitId: question.unitId }, 'POST')).json();
        expect((await c.startConfiguredRound(round.id)).status).toBe(200);
        const delayed = c.activity.rounds.at(-1)?.openAtByGroup[group.id] ?? 0;
        await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.ceil(delayed - performance.now()))));
        const answer = await c.request('/rounds/' + round.id + '/submissions', student.headers, { answers: [{ questionId, text: '答案' }] }, 'POST');
        expect(answer.status).toBe(201);
        await c.finishRound(round.id);
      }
      return group.joinCode;
    }
    const [oldCode] = await Promise.all([rounds(a), rounds(b)]);
    const restored = await Classrooms.restore(await openClassroomStorage(path), password);
    for (const id of [a.room.id, b.room.id]) {
      const room = restored.get(id);
      expect(room.activity.groups.map(group => group.name)).toEqual(['乙組', '甲組']);
      expect(restored.history(room)).toHaveLength(2);
      for (const round of room.activity.rounds) expect(round.submissions[0]).toMatchObject({ rank: 1, answers: [{ text: '答案', autoCorrect: true }] });
    }
    expect(restored.lookup(oldCode)).toBeUndefined();
    await restored.remove(restored.get(a.room.id));
    const afterDelete = await Classrooms.restore(await openClassroomStorage(path), password);
    expect(afterDelete.list().map(room => room.id)).toEqual([b.room.id]);
    expect(afterDelete.history(afterDelete.get(b.room.id))).toHaveLength(2);
  } finally { await a.close(); await b.close(); await rm(directory, { recursive: true, force: true }); }
}, 10000);
