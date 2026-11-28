import { configureWorksheet, finishRound } from '../helpers/worksheet.js';
import { describe, expect, it } from 'vitest';
import { createActivity } from '../../backend/src/activity.js';
import { endRound, prepareRound, publishRound, reviewFor, startRound, submitAnswers, updateReview } from '../../backend/src/rounds.js';
import type { FillBlank } from '../../shared/api.js';

function setup() {
  const activity = createActivity();
  activity.groups = [{ id: 'a', name: '甲組' }, { id: 'b', name: '乙組' }];
  activity.worksheet = { source: { kind: 'google', documentId: 'local-test', sheetId: 1, sheetTitle: '樣本', importedAt: Date.now() }, fills: [], units: [{ id: 'unit', name: '題組', questionIds: ['1（1）', '1（2）'], fillBlankIds: ['f1', 'f2'] }] };
  activity.worksheet.fills = ['1（1）', '1（2）'].map((questionId, index): FillBlank => ({ id: `f${index + 1}`, questionId, mainQuestionId: '1', subQuestionId: `${index + 1}`, unitId: 'unit', row: index + 1, column: 2, originalValue: null, originalType: 'blank', identitySource: 'header' }));
  configureWorksheet(activity, id => id.endsWith('1）') ? ['CPU', '甲'] : ['中央處理器', '乙']);
  const round = prepareRound(activity, 'unit');
  return { activity, round };
}

describe('回合與整組收件', () => {
  it('題組只在完整答案時收件，按先後給一個共用順位', () => {
    const { activity, round } = setup(); startRound(activity, round.id, 100);
    expect(() => submitAnswers(activity, round.id, 'a', [{ questionId: '1（1）', text: 'CPU' }], 101)).toThrow('第 1 題，第 2 部分尚未填答');
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
    finishRound(activity, round.id);
    expect(round.winnerGroupId).toBe('b');
    expect(() => submitAnswers(activity, round.id, 'a', [{ questionId: '1（1）', text: '丙' }, { questionId: '1（2）', text: '丁' }], 101)).toThrow('已更新');
  });
  it('沒有名單時不得開始，單位不能重複開題', () => {
    const { activity, round } = setup(); activity.groups = [];
    expect(() => startRound(activity, round.id, 100)).toThrow('尚未加入任何組別');
    activity.groups = [{ id: 'a', name: '甲組' }]; startRound(activity, round.id, 100); finishRound(activity, round.id);
    expect(() => prepareRound(activity, 'unit')).toThrow('已開過回合');
  });
});

it.each([
  ['CPU', ' cPu ', true],
  ['維生素C', '維生素c', true],
  ['維生素C', '維生素Ｃ', false],
  ['維生素 C。', '維生素c', false],
  ['中央處理器', '中央處理器', true],
  ['中央處理器', '中央處理機', false],
])('自動判分比對 %s 與 %s，預期為 %s，並保留原文', (standard, text, correct) => {
  const { activity, round } = setup();
  configureWorksheet(activity, id => id.endsWith('1）') ? ['其他答案', standard] : ['乙']);
  startRound(activity, round.id, 0);
  const submission = submitAnswers(activity, round.id, 'a', [
    { questionId: '1（1）', text },
    { questionId: '1（2）', text: '乙' },
  ], 0);

  endRound(activity, round.id);

  expect(submission.answers[0]).toMatchObject({ text, autoCorrect: correct });
  expect(round.questions?.[0].acceptedAnswers).toEqual(['其他答案', standard]);
});

it('兩組分別答對不同子題時，兩題都無須補答，且整個題組無勝組', () => {
  const { activity, round } = setup();
  startRound(activity, round.id, 0);
  submitAnswers(activity, round.id, 'a', [{questionId:'1（1）',text:'CPU'},{questionId:'1（2）',text:'錯誤'}], 0);
  submitAnswers(activity, round.id, 'b', [{questionId:'1（1）',text:'錯誤'},{questionId:'1（2）',text:'乙'}], 1);
  finishRound(activity, round.id);
  expect(round.winnerGroupId).toBeUndefined();
  expect(round.supplements).toEqual([]);
});

it('只有無組答對的子題需要補答，晚到的送答不會改變判分', () => {
  const { activity, round } = setup();
  startRound(activity, round.id, 0);
  submitAnswers(activity, round.id, 'a', [{ questionId: '1（1）', text: ' CPU ' }, { questionId: '1（2）', text: '錯誤' }], 0);
  endRound(activity, round.id);
  expect(reviewFor(round).supplements).toEqual([{ questionId: '1（2）', text: '中央處理器' }]);
  expect(reviewFor(round).supplementCandidates).toHaveLength(2);
  expect(() => submitAnswers(activity, round.id, 'b', [], 1)).toThrow('已停止收件');
  expect(publishRound(activity, round.id, 0, reviewFor(round).supplements)).toMatchObject({ phase: 'ended', winnerGroupId: null });
  expect(round.supplements).toEqual([{ questionId: '1（2）', text: '中央處理器' }]);
});

it('無人送答且一題無可引用來源時仍可定案，保留第一個有效答案的原文', () => {
  const { activity, round } = setup();
  startRound(activity, round.id, 0);
  endRound(activity, round.id);
  round.questions![0].acceptedAnswers = [' \t ', '  標準答案  ', '另一個答案'];
  round.questions![1].acceptedAnswers = ['\n'];
  expect(reviewFor(round)).toMatchObject({
    supplements: [{ questionId: '1（1）', text: '  標準答案  ' }], missingSupplementQuestionIds: ['1（2）'],
  });
  publishRound(activity, round.id, 0, reviewFor(round).supplements);
  expect(round.supplements).toEqual([{ questionId: '1（1）', text: '  標準答案  ' }]);
});

it('舊人工補答優先，改判或取消資格後依有效判分重算，定案只封存適用補答', () => {
  const { activity, round } = setup();
  startRound(activity, round.id, 0);
  submitAnswers(activity, round.id, 'a', [{ questionId: '1（1）', text: 'CPU' }, { questionId: '1（2）', text: '合理答案' }], 0);
  endRound(activity, round.id);
  delete round.optionalSupplements;
  const legacy = { questionId: '1（2）', text: '  已存人工原文  ' };
  round.supplements = [legacy];
  const grade = { groupId: 'a', questionId: '1（2）', correct: true };
  const old = structuredClone(round);
  expect(() => updateReview(activity, round.id, { reviewRevision: 0, grades: [grade], supplements: [{ ...legacy, text: '不可覆蓋' }] })).toThrow();
  expect(round).toEqual(old);
  expect(updateReview(activity, round.id, { reviewRevision: 0, grades: [grade], supplements: [] }).supplements).toEqual([]);
  expect(round.supplements).toEqual([legacy]);
  expect(updateReview(activity, round.id, { reviewRevision: 1, eligibility: [{ groupId: 'a', disqualified: true }] }).supplements)
    .toEqual([{ questionId: '1（1）', text: 'CPU' }, legacy]);
  updateReview(activity, round.id, { reviewRevision: 2, eligibility: [{ groupId: 'a', disqualified: false }] });
  expect(publishRound(activity, round.id, 3).winnerGroupId).toBe('a');
  expect(round.supplements).toEqual([]);
  expect(round.submissions[0].answers[1]).toMatchObject({ text: '合理答案', autoCorrect: false, overrideCorrect: true });
});

it('同一筆改回錯誤後恢復舊人工補答原文，只封存仍欠答的子題', () => {
  const { activity, round } = setup();
  startRound(activity, round.id, 0);
  const first = { questionId: '1（1）', text: 'CPU' };
  const second = { questionId: '1（2）', text: '同義原答' };
  submitAnswers(activity, round.id, 'a', [first, second], 0);
  endRound(activity, round.id);
  delete round.optionalSupplements;
  const legacy = { questionId: second.questionId, text: '  舊人工補答\n原文  ' };
  round.supplements = [{ questionId: first.questionId, text: '另一筆舊補答' }, legacy];
  expect(reviewFor(round).supplements).toEqual([legacy]);
  const grades = (correct: boolean) => [{ groupId: 'a', questionId: second.questionId, correct }];
  expect(updateReview(activity, round.id, { reviewRevision: 0, grades: grades(true) }).supplements).toEqual([]);
  expect(updateReview(activity, round.id, { reviewRevision: 1, grades: grades(false) }).supplements).toEqual([legacy]);
  expect(publishRound(activity, round.id, 2).winnerGroupId).toBeNull();
  expect(round.supplements).toEqual([legacy]);
});
