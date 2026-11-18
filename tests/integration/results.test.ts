import { describe, expect, it } from 'vitest';
import type { Worksheet } from '../../shared/api.js';
import { classroom } from '../helpers/classroom.js';

function reportWorksheet(): Worksheet {
  const groups = [
    { unitId: 'topic-1', unitName: '第 1 題組', questionIds: ['1（1）', '1（2）'] },
    { unitId: 'topic-2', unitName: '第 2 題組', questionIds: ['2（1）', '2（2）'] },
    { unitId: 'single-3', unitName: '第 3 題', questionIds: ['3'] },
  ];
  const fills = groups.flatMap(group => group.questionIds.map((questionId, index) => ({
    id: `fill-${questionId}`, questionId, mainQuestionId: questionId.split('（')[0], unitId: group.unitId,
    row: fillsRow++, column: 2, originalValue: null, originalType: 'blank' as const, identitySource: 'header' as const,
    ...(questionId.includes('（') ? { subQuestionId: questionId.slice(-2, -1) } : {}),
  })));
  return {
    source: { kind: 'google', documentId: 'results-fixture', sheetId: 9, sheetTitle: '結果測試', importedAt: 1 },
    fills,
    units: groups.map(group => ({ id: group.unitId, name: group.unitName, questionIds: group.questionIds, fillBlankIds: group.questionIds.map(questionId => `fill-${questionId}`) })),
  };
}
let fillsRow = 2;

describe('結果與回填端點整合', () => {
  it('混合匯入與手動回合，回填只取已公布勝組，CSV 含兩種來源', async () => {
    const worksheet = reportWorksheet();
    const c = await classroom({ importWorksheet: async () => ({ worksheet: structuredClone(worksheet) }), writeback: async rounds => {
      expect(rounds).toHaveLength(3);
      expect(rounds[0].submissions.find(s => s.groupId === rounds[0].winnerGroupId)?.rank).toBe(2);
      expect(rounds.every(round => worksheet.units.some(unit => unit.id === round.unitId))).toBe(true);
      const written = rounds.flatMap(round => round.submissions.find(submission => submission.groupId === round.winnerGroupId)?.answers.map(answer => answer.questionId) ?? []);
      return { written, alreadyMatched: [], noWinner: ['3'] };
    } });
    try {
      const groups = await Promise.all(['甲組', '乙組', '丙組'].map(name => c.group(name)));
      const students = await Promise.all(groups.map(group => c.student(group.joinCode)));
      expect((await c.request('/worksheet/import', c.teacher, { url: 'fixture' }, 'POST')).status).toBe(200);
      const units = c.activity.worksheet!.units;
      for (const [index, unit] of units.entries()) {
        const round = await (await c.request('/rounds', c.teacher, { unitId: unit.id }, 'POST')).json();
        await c.startConfiguredRound(round.id, questionId => index === 0 ? '=答案,保留\n"引號"內容' : `勝組-${questionId}`);
        const winnerIndex = index === 0 ? 1 : index === 1 ? 0 : -1;
        if (index === 0) {
          const wrong = unit.questionIds.map(questionId => ({ questionId, text: '未列出的答案' }));
          expect((await c.request(`/rounds/${round.id}/submissions`, students[0].headers, { answers: wrong }, 'POST')).status).toBe(201);
        }
        if (winnerIndex >= 0) {
          const answers = unit.questionIds.map((questionId, answerIndex) => ({ questionId, text: index === 0 && answerIndex === 0 ? '=答案,保留' : index === 0 ? '"引號"內容' : `勝組-${questionId}` }));
          expect((await c.request(`/rounds/${round.id}/submissions`, students[winnerIndex].headers, { answers }, 'POST')).status).toBe(201);
        } else {
          const answers = unit.questionIds.map(questionId => ({ questionId, text: '未列出的答案' }));
          expect((await c.request(`/rounds/${round.id}/submissions`, students[2].headers, { answers }, 'POST')).status).toBe(201);
        }
        await c.finishRound(round.id);
      }
      const manual = await (await c.request('/questions', c.teacher, { questionId:'M1', prompt:'請填手動題的答案。' }, 'POST')).json();
      const manualRound = await (await c.request('/rounds', c.teacher, { unitId: manual.unitId }, 'POST')).json();
      expect((await c.startConfiguredRound(manualRound.id)).status).toBe(200);
      await c.finishRound(manualRound.id);
      const writeback = await c.request('/worksheet/writeback', c.teacher, {}, 'POST');
      expect(writeback.status).toBe(200);
      expect(await writeback.json()).toEqual({ written: ['1（1）', '1（2）', '2（1）', '2（2）'], alreadyMatched: [], noWinner: ['3'] });
      const response = await c.request('/results.csv');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/csv; charset=utf-8');
      const csv = await response.text();
      const rows = csv.trim().split(/\r?\n/);
      expect(rows).toHaveLength(21);
      expect(rows[0]).toBe('題號,組別,答案,搶答順位,作答狀態,正誤');
      expect(csv).toContain('=答案,保留');
      expect(csv).toContain('""引號""內容"');
      expect(rows.filter(row => row.startsWith('3,')).length).toBe(4);
      expect(rows.filter(row => row.startsWith('3,') && row.endsWith(',,,未送出,'))).toHaveLength(2);
      expect(rows).toContain('3,丙組,未列出的答案,1,已送出,答錯');
      expect(rows).toContain('3,,測試補答,,老師補答,');
      expect(rows).toContain('M1,,測試補答,,老師補答,');
      expect(c.activity.rounds.filter(round => round.phase === 'ended')).toHaveLength(4);
    } finally { fillsRow = 2; await c.close(); }
  });
});
