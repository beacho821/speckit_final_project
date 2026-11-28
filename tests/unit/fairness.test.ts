import { configureWorksheet, finishRound } from '../helpers/worksheet.js';
import { describe, expect, it } from 'vitest';
import { createActivity } from '../../backend/src/activity.js';
import { FAIRNESS_DELAY_MS, hasWonBefore, openTimes } from '../../backend/src/fairness.js';
import { prepareRound, startRound, submitAnswers } from '../../backend/src/rounds.js';
import { addManualQuestion } from '../../backend/src/questions.js';
import type { FillBlank } from '../../shared/api.js';

function activityWithPreviousWinner() {
  const activity = createActivity(); activity.groups = [{ id: 'a', name: '甲組' }, { id: 'b', name: '乙組' }];
  const fill: FillBlank = { id: 'f', questionId: '1', mainQuestionId: '1', unitId: 'u1', row: 1, column: 2, originalValue: '', originalType: 'string', identitySource: 'header' };
  activity.worksheet = { source: { kind: 'google', documentId: 'test', sheetId: 1, sheetTitle: '測試', importedAt: 0 }, fills: [fill, { ...fill, id: 'f2', questionId: '2', mainQuestionId: '2', unitId: 'u2' }, { ...fill, id: 'f3', questionId: '3', mainQuestionId: '3', unitId: 'u3' }], units: [{ id: 'u1', name: '1', questionIds: ['1'], fillBlankIds: ['f'] }, { id: 'u2', name: '2', questionIds: ['2'], fillBlankIds: ['f2'] }, { id: 'u3', name: '3', questionIds: ['3'], fillBlankIds: ['f3'] }] };
  configureWorksheet(activity, id => id === '1' ? ['答'] : ['乙組答案']);
  const first = prepareRound(activity, 'u1'); startRound(activity, first.id, 0);
  submitAnswers(activity, first.id, 'a', [{ questionId: '1', text: '答' }], 0); finishRound(activity, first.id);
  return activity;
}

describe('公平順位開放時間', () => {
  it('曾勝組在 7,999 毫秒被拒絕，滿 8,000 毫秒可收件', () => {
    const activity = activityWithPreviousWinner(); const round = prepareRound(activity, 'u2'); startRound(activity, round.id, 10_000);
    expect(() => submitAnswers(activity, round.id, 'a', [{ questionId: '2', text: '答' }], 17_999)).toThrow('尚須等待');
    expect(round.submissions).toHaveLength(0);
    expect(submitAnswers(activity, round.id, 'a', [{ questionId: '2', text: '答' }], 18_000).rank).toBe(1);
    expect(FAIRNESS_DELAY_MS).toBe(5_000);
  });
  it('未勝組立即開放', () => {
    const activity = activityWithPreviousWinner(); const round = prepareRound(activity, 'u2'); startRound(activity, round.id, 500);
    expect(submitAnswers(activity, round.id, 'b', [{ questionId: '2', text: '先答' }], 500).rank).toBe(1);
  });
  it('無人得標仍佔一回合，得標滿兩題後立即開放', () => {
    const activity = activityWithPreviousWinner();
    for (const delay of [8000, 3450, 0, 0]) {
      const question = addManualQuestion(activity, { prompt: '請填寫答案', acceptedAnswersText: '答' });
      const round = prepareRound(activity, question.unitId);
      startRound(activity, round.id, 10000);
      expect(round.openAtByGroup).toEqual({ a: 10000 + delay, b: 10000 });
      finishRound(activity, round.id);
    }
  });
  it('兩組輪流得標且各答對一半，等待時間分別為 3.45 和 5.75 秒', () => {
    const activity = activityWithPreviousWinner();
    const second = prepareRound(activity, 'u2'); startRound(activity, second.id, 5_000);
    submitAnswers(activity, second.id, 'b', [{ questionId: '2', text: '乙組答案' }], 5_000); finishRound(activity, second.id);
    const third = prepareRound(activity, 'u3'); startRound(activity, third.id, 10_000);
    expect(third.openAtByGroup).toEqual({ a: 13_450, b: 15_750 });
    expect(submitAnswers(activity, third.id, 'a', [{ questionId: '3', text: '冷卻期滿送出' }], 13_450).rank).toBe(1);
  });
  it('只採最近五組的小題數與最終判分，連續得標不累加', () => {
    const activity = activityWithPreviousWinner();
    const first = activity.rounds[0];
    const entry = first.submissions[0];
    const makeRound = (parts: number, answers: typeof entry.answers, disqualified = false) => ({
      ...first, questions: Array.from({ length: parts }, () => first.questions![0]),
      winnerGroupId: undefined as string | undefined, submissions: [{ ...entry, answers, disqualified }],
    });
    const yes = { ...entry.answers[0], autoCorrect: true };
    activity.rounds = [
      first, makeRound(3, []), makeRound(1, [{ ...yes, autoCorrect: false, overrideCorrect: true }]),
      makeRound(1, [yes], true), makeRound(1, [yes]), makeRound(2, [yes, yes]),
    ];
    activity.rounds[4].winnerGroupId = 'a';
    activity.rounds[5].winnerGroupId = 'a';
    expect(openTimes(activity, first, 0)).toEqual({ a: 5750, b: 0 });
    activity.rounds[5].winnerGroupId = undefined;
    expect(openTimes(activity, first, 0)).toEqual({ a: 3450, b: 0 });
  });
  it('上上題得標且全對時，最多等待 4.8 秒', () => {
    const activity = activityWithPreviousWinner();
    const previous = activity.rounds[0];
    activity.rounds.push({ ...previous, winnerGroupId: 'b' });
    expect(openTimes(activity, previous, 0).a).toBe(4800);
  });
  it('第一回合無人作答時，下一回合仍讓所有組別立即送出', () => {
    const activity = createActivity(); activity.groups = [{ id: 'a', name: '甲組' }, { id: 'b', name: '乙組' }];
    const fill: FillBlank = { id: 'f1', questionId: '1', mainQuestionId: '1', unitId: 'u1', row: 1, column: 1, originalValue: '', originalType: 'blank', identitySource: 'header' };
    activity.worksheet = { source: { kind: 'google', documentId: 'test', sheetId: 1, sheetTitle: '測試', importedAt: 0 }, fills: [fill, { ...fill, id: 'f2', questionId: '2', mainQuestionId: '2', unitId: 'u2' }], units: [{ id: 'u1', name: '1', questionIds: ['1'], fillBlankIds: ['f1'] }, { id: 'u2', name: '2', questionIds: ['2'], fillBlankIds: ['f2'] }] };
    configureWorksheet(activity);
    const prior = prepareRound(activity, 'u1'); startRound(activity, prior.id, 0); finishRound(activity, prior.id);
    const next = prepareRound(activity, 'u2'); startRound(activity, next.id, 700);
    expect(next.openAtByGroup).toEqual({ a: 700, b: 700 });
  });
});

it('最終答對的第二順位才算成下一回合曾勝組', () => {
  const round = {
    id: 'r', unitId: 'u', phase: 'ended' as const, openAtByGroup: {}, roster: [],
    winnerGroupId: 'b', submissions: [{ groupId: 'a', receivedAt: 1, rank: 1, answers: [] }, { groupId: 'b', receivedAt: 2, rank: 2, answers: [] }],
  };
  expect(hasWonBefore([round], 'a')).toBe(false);
  expect(hasWonBefore([round], 'b')).toBe(true);
  expect(hasWonBefore([{ ...round, winnerGroupId: undefined }], 'a')).toBe(false);
});
