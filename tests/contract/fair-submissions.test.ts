import { describe, expect, it, vi } from 'vitest';
import { classroom } from '../helpers/classroom.js';
import { worksheet as seed } from '../helpers/worksheet.js';

function fairnessWorksheet() {
  const result = structuredClone(seed);
  result.fills = [];
  result.units = [];
  for (let index = 0; index < 3; index += 1) {
    const unitId = `u${index + 1}`;
    const questionIds = [`${index + 1}（1）`, `${index + 1}（2）`];
    const fillBlankIds = questionIds.map((questionId, part) => {
      const id = `f${index + 1}-${part + 1}`;
      result.fills.push({ ...seed.fills[part], id, questionId, mainQuestionId: String(index + 1), subQuestionId: String(part + 1), unitId, row: index * 2 + part + 2 });
      return id;
    });
    result.units.push({ id: unitId, name: `題組 ${index + 1}`, questionIds, fillBlankIds });
  }
  return result;
}

const answers = (unit: { questionIds: string[] }) => unit.questionIds.map(questionId => ({ questionId, text: `${questionId}答案` }));

describe('公平送出 HTTP 契約', () => {
  it('曾勝組於 7,999 毫秒被拒、8,000 毫秒可送；客戶端時間不影響順位', async () => {
    let now = 100;
    const c = await classroom({ now: () => now, importWorksheet: async () => ({ worksheet: fairnessWorksheet() }) });
    try {
      const alpha = await c.group('甲組'), beta = await c.group('乙組');
      const alphaStudent = await c.student(alpha.joinCode), betaStudent = await c.student(beta.joinCode);
      expect((await c.request('/worksheet/import', c.teacher, { url: 'fixture' }, 'POST')).status).toBe(200);
      const firstUnit = c.activity.worksheet!.units[0];
      const firstRound = await (await c.request('/rounds', c.teacher, { unitId: firstUnit.id }, 'POST')).json();
      await c.startConfiguredRound(firstRound.id, questionId => `${questionId}答案`);
      expect((await c.request(`/rounds/${firstRound.id}/submissions`, alphaStudent.headers, { answers: answers(firstUnit) }, 'POST')).status).toBe(201);
      await c.finishRound(firstRound.id);

      now = 500;
      const secondUnit = c.activity.worksheet!.units[1];
      const secondRound = await (await c.request('/rounds', c.teacher, { unitId: secondUnit.id }, 'POST')).json();
      await c.startConfiguredRound(secondRound.id, questionId => `${questionId}答案`);
      const waiting = await (await c.request('/view', alphaStudent.headers)).json();
      expect(waiting.waitRemainingMs).toBe(8000);
      expect(waiting.cooldownMs).toBe(8000);
      expect(waiting.groups).toBeUndefined();
      expect(await (await c.request('/view', betaStudent.headers)).json()).toMatchObject({ waitRemainingMs: 0, cooldownMs: 0 });

      now = 8499;
      // 模擬請求到達時仍在冷卻，輪到教室寫入時剛好已經期滿。
      const mutate = c.classrooms.mutate.bind(c.classrooms);
      const queue = vi.spyOn(c.classrooms, 'mutate').mockImplementation((room, activity, change) => {
        now = 8500;
        return mutate(room, activity, change);
      });
      const tooEarly = await c.request(`/rounds/${secondRound.id}/submissions`, alphaStudent.headers, { answers: answers(secondUnit), receivedAt: Number.MAX_SAFE_INTEGER }, 'POST');
      expect(tooEarly.status).toBe(409);
      expect((await tooEarly.json()).details.waitRemainingMs).toBe(1);
      expect(c.activity.rounds[1].submissions).toHaveLength(0);

      const betaSubmission = await c.request(`/rounds/${secondRound.id}/submissions`, betaStudent.headers, { answers: answers(secondUnit), receivedAt: 0 }, 'POST');
      queue.mockRestore();
      expect(betaSubmission.status).toBe(201);
      now = 8500;
      const alphaSubmission = await c.request(`/rounds/${secondRound.id}/submissions`, alphaStudent.headers, { answers: answers(secondUnit), receivedAt: 0 }, 'POST');
      expect(alphaSubmission.status).toBe(201);
      expect(c.activity.rounds[1].submissions.map(item => item.rank)).toEqual([1, 2]);
      expect(c.activity.rounds[1].submissions.map(item => item.receivedAt)).toEqual([8499, 8500]);
      await c.finishRound(secondRound.id);
      const thirdUnit = c.activity.worksheet!.units[2];
      const thirdRound = await (await c.request('/rounds', c.teacher, { unitId: thirdUnit.id }, 'POST')).json();
      await c.startConfiguredRound(thirdRound.id, questionId => `${questionId}答案`);
      await c.request(`/rounds/${thirdRound.id}/end`, c.teacher, undefined, 'POST');
      now += 3000;
      expect((await c.request(`/rounds/${thirdRound.id}/submissions`, alphaStudent.headers, { answers: answers(thirdUnit) }, 'POST')).status).toBe(409);
      expect(c.activity.rounds[2].submissions).toHaveLength(0);
    } finally { await c.close(); }
  });

  it('兩組輪流得標後分別等待 3.45 與 5.75 秒，教師和投影顯示相同倒數', async () => {
    let now = 100;
    const c = await classroom({ now: () => now, importWorksheet: async () => ({ worksheet: fairnessWorksheet() }) });
    try {
      const alpha = await c.group('甲組'), beta = await c.group('乙組');
      const a = await c.student(alpha.joinCode), b = await c.student(beta.joinCode);
      await c.request('/worksheet/import', c.teacher, { url: 'fixture' }, 'POST');
      for (const [index, student] of [a, b].entries()) {
        const unit = c.activity.worksheet!.units[index];
        const round = await (await c.request('/rounds', c.teacher, { unitId: unit.id }, 'POST')).json();
        await c.startConfiguredRound(round.id, questionId => `${questionId}答案`);
        expect((await c.request(`/rounds/${round.id}/submissions`, student.headers, { answers: answers(unit) }, 'POST')).status).toBe(201);
        await c.finishRound(round.id);
        now += 100;
      }
      const unit = c.activity.worksheet!.units[2];
      const round = await (await c.request('/rounds', c.teacher, { unitId: unit.id }, 'POST')).json();
      await c.startConfiguredRound(round.id, questionId => `${questionId}答案`);
      expect(await (await c.request('/view', a.headers)).json()).toMatchObject({ waitRemainingMs: 3450 });
      expect(await (await c.request('/view', b.headers)).json()).toMatchObject({ waitRemainingMs: 5750 });
      now += 3449;
      const early = await c.request(`/rounds/${round.id}/submissions`, a.headers, { answers: answers(unit) }, 'POST');
      expect(await early.json()).toMatchObject({ code: 'WAIT_REQUIRED', details: { waitRemainingMs: 1 } });
      for (const path of ['/view', '/classrooms/' + c.room.id + '/projection']) {
        expect((await (await c.request(path)).json()).groups).toMatchObject([
          { id: alpha.id, waitRemainingMs: 1 }, { id: beta.id, waitRemainingMs: 2301 },
        ]);
      }
      now += 2301;
      const responses = await Promise.all([
        c.request(`/rounds/${round.id}/submissions`, a.headers, { answers: answers(unit) }, 'POST'),
        c.request(`/rounds/${round.id}/submissions`, b.headers, { answers: answers(unit) }, 'POST'),
      ]);
      expect(responses.map(response => response.status)).toEqual([201, 201]);
      expect(c.activity.rounds[2].submissions.map(item => item.rank).sort()).toEqual([1, 2]);
    } finally { await c.close(); }
  });
});
