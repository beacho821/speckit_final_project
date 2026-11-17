import { describe, expect, it } from 'vitest';
import { createActivity } from '../../backend/src/activity.js';
import { endRound, prepareRound, startRound, submitAnswers } from '../../backend/src/rounds.js';
import type { FillBlank } from '../../shared/api.js';

function setup() {
  const activity = createActivity();
  activity.groups = [{ id: 'a', name: '甲組' }, { id: 'b', name: '乙組' }];
  activity.worksheet = { source: { kind: 'google', documentId: 'local-test', sheetId: 1, sheetTitle: '樣本', importedAt: Date.now() }, fills: [], units: [{ id: 'unit', name: '題組', questionIds: ['1（1）', '1（2）'], fillBlankIds: ['f1', 'f2'] }] };
  activity.worksheet.fills = ['1（1）', '1（2）'].map((questionId, index): FillBlank => ({ id: `f${index + 1}`, questionId, mainQuestionId: '1', subQuestionId: `${index + 1}`, unitId: 'unit', row: index + 1, column: 2, originalValue: null, originalType: 'blank', identitySource: 'header' }));
  const round = prepareRound(activity, 'unit');
  return { activity, round };
}

describe('回合與整組收件', () => {
  it('題組只在完整答案時收件，按先後給一個共用順位', () => {
    const { activity, round } = setup(); startRound(activity, round.id, 100);
    expect(() => submitAnswers(activity, round.id, 'a', [{ questionId: '1（1）', text: 'CPU' }], 101)).toThrow('1（2）');
    expect(round.submissions).toHaveLength(0);
    const first = submitAnswers(activity, round.id, 'a', [{ questionId: '1（1）', text: ' CPU ' }, { questionId: '1（2）', text: '中央處理器' }], 102);
    const second = submitAnswers(activity, round.id, 'b', [{ questionId: '1（1）', text: 'A' }, { questionId: '1（2）', text: 'B' }], 103);
    expect(first.rank).toBe(1); expect(second.rank).toBe(2); expect(first.answers[0].text).toBe(' CPU ');
    expect(() => submitAnswers(activity, round.id, 'a', [], 104)).toThrow('已收件');
    expect(round.submissions).toHaveLength(2);
  });
  it('結束後凍結勝組並拒絕晚到答案', () => {
    const { activity, round } = setup(); startRound(activity, round.id, 100);
    submitAnswers(activity, round.id, 'b', [{ questionId: '1（1）', text: '甲' }, { questionId: '1（2）', text: '乙' }], 100);
    endRound(activity, round.id);
    expect(round.winnerGroupId).toBe('b');
    expect(() => submitAnswers(activity, round.id, 'a', [{ questionId: '1（1）', text: '丙' }, { questionId: '1（2）', text: '丁' }], 101)).toThrow('已更新');
  });
  it('沒有名單時不得開始，單位不能重複開題', () => {
    const { activity, round } = setup(); activity.groups = [];
    expect(() => startRound(activity, round.id, 100)).toThrow('尚未加入任何組別');
    activity.groups = [{ id: 'a', name: '甲組' }]; startRound(activity, round.id, 100); endRound(activity, round.id);
    expect(() => prepareRound(activity, 'unit')).toThrow('已開過回合');
  });
});
