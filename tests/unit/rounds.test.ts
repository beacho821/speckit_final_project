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
  submitAnswers(activity, round.id, 'a', [{questionId:'1（1）',text:' CPU '},{questionId:'1（2）',text:'錯誤'}], 0);
  endRound(activity, round.id);
  expect(reviewFor(round).missingSupplementQuestionIds).toEqual(['1（2）']);
  expect(() => submitAnswers(activity, round.id, 'b', [{questionId:'1（1）',text:'CPU'},{questionId:'1（2）',text:'乙'}], 1)).toThrow('已停止收件');
  expect(() => publishRound(activity, round.id, 0)).toThrow('請補答第 1（2） 題');
  expect(round.phase).toBe('reviewing');
  updateReview(activity, round.id, { reviewRevision:0, supplements:[{questionId:'1（2）',text:'老師補答'}] });
  expect(reviewFor(round).missingSupplementQuestionIds).toEqual([]);
  publishRound(activity, round.id, 1);
  expect(round.supplements).toEqual([{questionId:'1（2）',text:'老師補答'}]);
});

it('更正有組答對時移除先前補答，錯誤的混合修改不寫入', () => {
  const { activity, round } = setup();
  startRound(activity, round.id, 0);
  submitAnswers(activity, round.id, 'a', [{questionId:'1（1）',text:'CPU'},{questionId:'1（2）',text:'新寫法'}], 0);
  endRound(activity, round.id);
  updateReview(activity, round.id, {reviewRevision:0,supplements:[{questionId:'1（2）',text:'已儲存的補答'}]});
  const grade = {groupId:'a',questionId:'1（2）',correct:true};
  expect(() => updateReview(activity, round.id, {reviewRevision:1,grades:[grade],supplements:[{questionId:'1（2）',text:'不應保留'}]})).toThrow('已有組別答對');
  expect(round.reviewRevision).toBe(1);
  expect(round.submissions[0].answers[1].overrideCorrect).toBeUndefined();
  expect(round.supplements).toEqual([{questionId:'1（2）',text:'已儲存的補答'}]);
  updateReview(activity, round.id, {reviewRevision:1,grades:[grade]});
  expect(round.supplements).toEqual([]);
  expect(publishRound(activity, round.id, 2).winnerGroupId).toBe('a');
});
