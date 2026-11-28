import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../backend/src/rounds.js';
import { classroom } from '../helpers/classroom.js';
import { worksheet } from '../helpers/worksheet.js';

async function completedRound(c: Awaited<ReturnType<typeof classroom>>, includeSubmission = true) {
  const existingGroup = c.activity.groups[0];
  const group = existingGroup
    ? { ...existingGroup, joinCode: c.activity.joinCodes.get(existingGroup.id)! }
    : await c.group('甲組');
  const student = await c.student(group.joinCode);
  if (!c.activity.worksheet) await c.request('/worksheet/import', c.teacher, { url: 'fixture' }, 'POST');
  const unit = c.activity.worksheet!.units[0];
  const round = await (await c.request('/rounds', c.teacher, { unitId: unit.id }, 'POST')).json();
  await c.startConfiguredRound(round.id, questionId => `答案 ${questionId}`);
  if (includeSubmission) await c.request(`/rounds/${round.id}/submissions`, student.headers, { answers: unit.questionIds.map(questionId => ({ questionId, text: `答案 ${questionId}` })) }, 'POST');
  await c.finishRound(round.id);
  return { group, student, round };
}

describe('回填 HTTP 契約', () => {
  it('拒絕學生和無已結束回合的回填，成功呼叫只收到已封存回合快照', async () => {
    const writeback = vi.fn(async () => ({ written: ['1（1）'], alreadyMatched: [], noWinner: [] }));
    const c = await classroom({ importWorksheet: async () => ({ worksheet: structuredClone(worksheet) }), writeback });
    try {
      const group = await c.group('甲組'), student = await c.student(group.joinCode);
      expect((await c.request('/worksheet/import', c.teacher, { url: 'fixture' }, 'POST')).status).toBe(200);
      expect((await c.request('/worksheet/writeback', student.headers, {}, 'POST')).status).toBe(403);
      const none = await c.request('/worksheet/writeback', c.teacher, {}, 'POST');
      expect(none.status).toBe(409);
      expect((await none.json()).code).toBe('NO_ENDED_ROUNDS');
      const { round } = await completedRound(c);
      const result = await c.request('/worksheet/writeback', c.teacher, {}, 'POST');
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ written: ['1（1）'], alreadyMatched: [], noWinner: [] });
      expect(writeback).toHaveBeenCalledOnce();
      expect(writeback.mock.calls[0][0]).toMatchObject([{ id: round.id, phase: 'ended', submissions: [{ rank: 1 }] }]);
    } finally { await c.close(); }
  });

  it('回填期間拒絕並行請求；提交前衝突回報後鎖定仍會釋放', async () => {
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const writeback = vi.fn(async () => { entered?.(); await gate; return { written: [], alreadyMatched: [], noWinner: [] }; });
    const c = await classroom({ importWorksheet: async () => ({ worksheet: structuredClone(worksheet) }), writeback });
    try {
      await completedRound(c);
      const pending = c.request('/worksheet/writeback', c.teacher, {}, 'POST');
      await waiting;
      const busy = await c.request('/worksheet/writeback', c.teacher, {}, 'POST');
      expect(busy.status).toBe(409);
      expect((await busy.json()).code).toBe('WRITEBACK_BUSY');
      release?.();
      expect((await pending).status).toBe(200);

      const conflictC = await classroom({ importWorksheet: async () => ({ worksheet: structuredClone(worksheet) }), writeback: async () => { throw new DomainError(409, 'WRITEBACK_CONFLICT', '題號 1（1）有修改，請處理後重試。', [{ questionId: '1（1）' }]); } });
      try {
        await completedRound(conflictC);
        const conflict = await conflictC.request('/worksheet/writeback', conflictC.teacher, {}, 'POST');
        expect(conflict.status).toBe(409);
        expect((await conflict.json()).code).toBe('WRITEBACK_CONFLICT');
        expect(conflictC.activity.writebackInProgress).toBe(false);
      } finally { await conflictC.close(); }
    } finally { release?.(); await c.close(); }
  });

  it('無勝組時保留不回填結果；寫回待確認與無編輯權都可辨識並安全重試', async () => {
    const noWinnerService = vi.fn(async () => ({ written: [], alreadyMatched: [], noWinner: ['1（1）', '1（2）'] }));
    const c = await classroom({ importWorksheet: async () => ({ worksheet: structuredClone(worksheet) }), writeback: noWinnerService });
    try {
      await completedRound(c, false);
      const noWinner = await c.request('/worksheet/writeback', c.teacher, {}, 'POST');
      expect(noWinner.status).toBe(200);
      expect(await noWinner.json()).toMatchObject({ written: [], noWinner: ['1（1）', '1（2）'] });
    } finally { await c.close(); }

    const retryService = vi.fn()
      .mockRejectedValueOnce(new DomainError(502, 'WRITEBACK_UNCONFIRMED', '寫回結果待確認，請先檢查來源工作表後再試。', ['1（1）']))
      .mockResolvedValueOnce({ written: [], alreadyMatched: ['1（1）'], noWinner: [] });
    const retryC = await classroom({ importWorksheet: async () => ({ worksheet: structuredClone(worksheet) }), writeback: retryService });
    try {
      await completedRound(retryC);
      const pending = await retryC.request('/worksheet/writeback', retryC.teacher, {}, 'POST');
      expect(pending.status).toBe(502);
      expect((await pending.json()).code).toBe('WRITEBACK_UNCONFIRMED');
      const retried = await retryC.request('/worksheet/writeback', retryC.teacher, {}, 'POST');
      expect(retried.status).toBe(200);
      expect((await retried.json()).alreadyMatched).toEqual(['1（1）']);
      expect(retryService).toHaveBeenCalledTimes(2);
      expect(retryC.activity.writebackInProgress).toBe(false);
    } finally { await retryC.close(); }

    const deniedC = await classroom({ importWorksheet: async () => ({ worksheet: structuredClone(worksheet) }), writeback: async () => { throw new DomainError(403, 'NO_EDIT_PERMISSION', '服務帳戶沒有編輯權限，請分享教師副本後再試。'); } });
    try {
      await completedRound(deniedC);
      const denied = await deniedC.request('/worksheet/writeback', deniedC.teacher, {}, 'POST');
      expect(denied.status).toBe(403);
      expect((await denied.json()).code).toBe('NO_EDIT_PERMISSION');
      expect(deniedC.activity.writebackInProgress).toBe(false);
    } finally { await deniedC.close(); }
  });
});
