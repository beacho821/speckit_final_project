import { describe, expect, it } from 'vitest';
import { createActivity } from '../../backend/src/activity.js';
import { FAIRNESS_DELAY_MS } from '../../backend/src/fairness.js';
import { endRound, prepareRound, startRound, submitAnswers } from '../../backend/src/rounds.js';
import type { FillBlank } from '../../shared/api.js';

function activityWithPreviousWinner() {
  const activity = createActivity(); activity.groups = [{ id: 'a', name: '甲組' }, { id: 'b', name: '乙組' }];
  const fill: FillBlank = { id: 'f', questionId: '1', mainQuestionId: '1', unitId: 'u1', row: 1, column: 2, originalValue: '', originalType: 'string', identitySource: 'header' };
  activity.worksheet = { source: { documentId: 'test', sheetId: 1, sheetTitle: '測試', importedAt: 0 }, fills: [fill, { ...fill, id: 'f2', questionId: '2', mainQuestionId: '2', unitId: 'u2' }, { ...fill, id: 'f3', questionId: '3', mainQuestionId: '3', unitId: 'u3' }], units: [{ id: 'u1', name: '1', questionIds: ['1'], fillBlankIds: ['f'] }, { id: 'u2', name: '2', questionIds: ['2'], fillBlankIds: ['f2'] }, { id: 'u3', name: '3', questionIds: ['3'], fillBlankIds: ['f3'] }] };
  const first = prepareRound(activity, 'u1'); startRound(activity, first.id, 0);
  submitAnswers(activity, first.id, 'a', [{ questionId: '1', text: '答' }], 0); endRound(activity, first.id);
  return activity;
}

describe('公平順位開放時間', () => {
  it('曾勝組在 2,999 毫秒被拒絕，滿 3,000 毫秒可收件', () => {
    const activity = activityWithPreviousWinner(); const round = prepareRound(activity, 'u2'); startRound(activity, round.id, 10_000);
    expect(() => submitAnswers(activity, round.id, 'a', [{ questionId: '2', text: '答' }], 12_999)).toThrow('尚須等待');
    expect(round.submissions).toHaveLength(0);
    expect(submitAnswers(activity, round.id, 'a', [{ questionId: '2', text: '答' }], 13_000).rank).toBe(1);
    expect(FAIRNESS_DELAY_MS).toBe(3_000);
  });
  it('未勝組立即開放；全組皆曾勝時曾勝組也立即開放', () => {
    const activity = activityWithPreviousWinner(); const round = prepareRound(activity, 'u2'); startRound(activity, round.id, 500);
    expect(submitAnswers(activity, round.id, 'b', [{ questionId: '2', text: '先答' }], 500).rank).toBe(1);
  });
  it('全組都曾勝後不再延遲，無人作答的回合不產生勝出紀錄', () => {
    const activity = activityWithPreviousWinner();
    const second = prepareRound(activity, 'u2'); startRound(activity, second.id, 5_000);
    submitAnswers(activity, second.id, 'b', [{ questionId: '2', text: '乙組答案' }], 5_000); endRound(activity, second.id);
    const third = prepareRound(activity, 'u3'); startRound(activity, third.id, 10_000);
    expect(third.openAtByGroup).toEqual({ a: 10_000, b: 10_000 });
    expect(submitAnswers(activity, third.id, 'a', [{ questionId: '3', text: '可立即送出' }], 10_000).rank).toBe(1);
  });
  it('第一回合無人作答時，下一回合仍讓所有組別立即送出', () => {
    const activity = createActivity(); activity.groups = [{ id: 'a', name: '甲組' }, { id: 'b', name: '乙組' }];
    const fill: FillBlank = { id: 'f1', questionId: '1', mainQuestionId: '1', unitId: 'u1', row: 1, column: 1, originalValue: '', originalType: 'blank', identitySource: 'header' };
    activity.worksheet = { source: { documentId: 'test', sheetId: 1, sheetTitle: '測試', importedAt: 0 }, fills: [fill, { ...fill, id: 'f2', questionId: '2', mainQuestionId: '2', unitId: 'u2' }], units: [{ id: 'u1', name: '1', questionIds: ['1'], fillBlankIds: ['f1'] }, { id: 'u2', name: '2', questionIds: ['2'], fillBlankIds: ['f2'] }] };
    const prior = prepareRound(activity, 'u1'); startRound(activity, prior.id, 0); endRound(activity, prior.id);
    const next = prepareRound(activity, 'u2'); startRound(activity, next.id, 700);
    expect(next.openAtByGroup).toEqual({ a: 700, b: 700 });
  });
});
