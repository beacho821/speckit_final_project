import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Classrooms } from '../../backend/src/classrooms.js';
import { openClassroomStorage } from '../../backend/src/classroom-store.js';
import { projectionFor } from '../../backend/src/projection.js';
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
    expect((await c.request('/rounds/' + round.id + '/submissions', student.headers, { answers: [{ questionId: question.questionId, text: '答案' }] }, 'POST')).status).toBe(201);
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
        const answer = await c.request('/rounds/' + round.id + '/submissions', student.headers, { answers: [{ questionId: question.questionId, text: '答案' }] }, 'POST');
        expect(answer.status).toBe(201);
        await c.finishRound(round.id);
      }
      expect((await c.request('/settlement/publish', c.teacher, undefined, 'POST')).status).toBe(200);
      return group.joinCode;
    }
    const [oldCode] = await Promise.all([rounds(a), rounds(b)]);
    const restored = await Classrooms.restore(await openClassroomStorage(path), password);
    for (const id of [a.room.id, b.room.id]) {
      const room = restored.get(id);
      expect(room.activity.groups.map(group => group.name)).toEqual(['乙組', '甲組']);
      expect(restored.history(room).map(entry => entry.questionNumber)).toEqual([2, 1]);
      expect(room.activity.settlementPublished).toBe(true);
      expect(projectionFor(room).settlement).toMatchObject({ roundCount: 2, groups: [
        { name: '甲組', points: 6, rank: 1 },
        { name: '乙組', points: 0, rank: 2 },
      ] });
      for (const round of room.activity.rounds) expect(round.submissions[0]).toMatchObject({ rank: 1, answers: [{ text: '答案', autoCorrect: true }] });
    }
    expect(restored.lookup(oldCode)).toBeUndefined();
    await restored.remove(restored.get(a.room.id));
    const afterDelete = await Classrooms.restore(await openClassroomStorage(path), password);
    expect(afterDelete.list().map(room => room.id)).toEqual([b.room.id]);
    expect(afterDelete.history(afterDelete.get(b.room.id))).toHaveLength(2);
  } finally { await a.close(); await b.close(); await rm(directory, { recursive: true, force: true }); }
}, 10000);

it('刪除舊版準備題以單次存檔清除回合與題卡，失敗後可重試並重啟', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'classroom-prepared-delete-'));
  const password = randomUUID();
  let c: Awaited<ReturnType<typeof classroom>> | undefined;
  try {
    const storage = await openClassroomStorage(directory);
    let rejectUpdate = false;
    const initial = await Classrooms.restore({
      ...storage,
      async save(record) {
        if (rejectUpdate) throw new Error('故障');
        for (const entry of record.activities) delete entry.queueUnitIds;
        await storage.save(record);
      },
    }, password);
    c = await classroom({}, initial, password);
    await c.group();
    const create = async (prompt: string) =>
      (await c!.request('/questions', c!.teacher, { prompt, acceptedAnswersText: '答案' }, 'POST')).json();
    const first = await create('將刪除的舊準備題');
    const next = await create('下一題');
    await c.request('/rounds', c.teacher, { unitId: first.unitId }, 'POST');
    const roomId = c.room.id;
    await c.close();
    c = undefined;
    const loadedStorage = await openClassroomStorage(directory);
    rejectUpdate = true;
    const restored = await Classrooms.restore({
      ...loadedStorage,
      async save(record) {
        if (record.id === roomId && rejectUpdate) throw new Error('故障');
        await loadedStorage.save(record);
      },
    }, password);
    c = await classroom({}, restored, password);
    const old = restored.get(roomId).activity;
    const teacher = { ...c.teacher, 'X-Classroom-Id': roomId, 'X-Activity-Id': old.id };
    const remove = () => c!.rawRequest('/questions/units/' + first.unitId, teacher, { catalogRevision: 0 }, 'DELETE');
    expect((await remove()).status).toBe(503);
    expect(old.queueUnitIds).toEqual([first.unitId, next.unitId]);
    expect(old.rounds[0]?.unitId).toBe(first.unitId);
    expect((await remove().then(r => r.json())).code).toBe('CLASSROOM_SAVE_FAILED');
    rejectUpdate = false;
    expect((await remove()).status).toBe(200);
    expect(old.rounds).toEqual([]);
    const restarted = await Classrooms.restore(await openClassroomStorage(directory), password);
    const persisted = restarted.get(roomId).activity;
    expect(persisted.queueUnitIds).toEqual([next.unitId]);
    expect(persisted.rounds).toEqual([]);
    await c.close();
    c = await classroom({}, restarted, password);
    const scoped = { ...c.teacher, 'X-Classroom-Id': roomId, 'X-Activity-Id': persisted.id };
    const opened = await c.rawRequest('/rounds/open-next', scoped, { unitId: next.unitId, catalogRevision: 0 }, 'POST');
    expect(opened.status).toBe(201);
    expect(await opened.json()).toMatchObject({ sequenceNumber: 1, phase: 'active' });
  } finally { await c?.close(); await rm(directory, { recursive: true, force: true }); }
});

it('整卡保存失敗不改任何部分，成功後可從存檔復原', async () => {
  const { worksheet } = await import('../helpers/worksheet');
  const directory = await mkdtemp(join(tmpdir(), 'classroom-save-card-'));
  const password = randomUUID();
  const storage = await openClassroomStorage(directory);
  let rejectUpdate = false;
  const initial = await Classrooms.restore({
    ...storage,
    async save(record) {
      if (rejectUpdate) throw new Error('存檔失敗');
      await storage.save(record);
    },
  }, password);
  const c = await classroom({ importWorksheet: async () => ({ worksheet: structuredClone(worksheet) }) }, initial, password);
  try {
    expect((await c.request('/worksheet/import', c.teacher, { url: 'mock' }, 'POST')).status).toBe(200);
    const unit = c.activity.units.find(unit => unit.questions.length > 1)!;
    const catalogRevision = c.activity.catalogRevision;
    const before = structuredClone(unit.questions);
    const edit = {
      catalogRevision,
      questions: unit.questions.map((part, index) => ({
        questionKey: part.questionKey, questionRevision: part.questionRevision,
        prompt: `新題幹第 ${index + 1} 部分`, acceptedAnswersText: '新答案',
      })),
    };
    const patch = (body = edit) => c.request('/questions/units/' + unit.id, c.teacher, body, 'PATCH');
    rejectUpdate = true;
    expect((await patch()).status).toBe(503);
    expect(c.activity.units.find(candidate => candidate.id === unit.id)?.questions).toEqual(before);
    expect(c.activity.catalogRevision).toBe(catalogRevision);
    rejectUpdate = false;
    const competing = { ...edit, questions: edit.questions.map(part => ({ ...part, prompt: '另一頁的' + part.prompt })) };
    const results = await Promise.all([patch(edit), patch(competing)]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const written = results[0].status === 200 ? edit : competing;
    const restored = await Classrooms.restore(await openClassroomStorage(directory), password);
    expect(restored.get(c.room.id).activity.units.find(candidate => candidate.id === unit.id)?.questions)
      .toMatchObject(written.questions.map(part => ({
        questionKey: part.questionKey, prompt: part.prompt, acceptedAnswers: ['新答案'], questionRevision: part.questionRevision + 1,
      })));
  } finally { await c.close(); await rm(directory, { recursive: true, force: true }); }
});
