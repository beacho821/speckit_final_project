import { configureWorksheet, finishRound } from '../helpers/worksheet.js';
import { describe, expect, it } from 'vitest';
import { createActivity } from '../../backend/src/activity.js';
import { prepareRound, startRound, submitAnswers, endRound, publishRound, reviewFor } from '../../backend/src/rounds.js';
import { buildResultsCsv } from '../../backend/src/results-csv.js';
import type { FillBlank } from '../../shared/api.js';

describe('結果 CSV', () => {
  it('每題列出固定名單、按順位排序並正確跳脫文字', () => {
    const activity = createActivity(); activity.groups = [{ id: 'a', name: '甲組' }, { id: 'b', name: '乙組' }, { id: 'c', name: '丙組' }];
    const fill: FillBlank = { id: 'f', questionId: '1（1）', mainQuestionId: '1', subQuestionId: '1', unitId: 'u', row: 1, column: 2, originalValue: '', originalType: 'blank', identitySource: 'header' };
    activity.worksheet = { source: { kind: 'google', documentId: 'test', sheetId: 1, sheetTitle: '樣本', importedAt: 0 }, fills: [fill], units: [{ id: 'u', name: '題組', questionIds: [fill.questionId], fillBlankIds: ['f'] }] };
    configureWorksheet(activity, () => ['=公式文字']);
    const round = prepareRound(activity, 'u'); startRound(activity, round.id, 0);
    submitAnswers(activity, round.id, 'b', [{ questionId: fill.questionId, text: '答案,含"引號"\n第二行' }], 0);
    submitAnswers(activity, round.id, 'a', [{ questionId: fill.questionId, text: '=公式文字' }], 1);
    finishRound(activity, round.id);
    const csv = buildResultsCsv(activity);
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(4);
    expect(csv).toContain('"答案,含""引號""\n第二行"');
    expect(csv).toContain('=公式文字');
    expect(csv).toContain('丙組,,,未送出');
  });
  it('尚無已結束回合時不提供空 CSV', () => {
    const activity = createActivity();
    expect(() => buildResultsCsv(activity)).toThrow('NO_ENDED_ROUNDS');
  });
  it('五個已結束填空乘三組另有五筆老師補答，未送出答案與順位留白', () => {
    const activity = createActivity(); activity.groups = [{ id: 'a', name: '甲組' }, { id: 'b', name: '乙組' }, { id: 'c', name: '丙組' }];
    const fills: FillBlank[] = Array.from({ length: 5 }, (_, index) => ({ id: `f${index + 1}`, questionId: String(index + 1), mainQuestionId: String(index + 1), unitId: `u${index + 1}`, row: index + 1, column: 2, originalValue: '', originalType: 'blank', identitySource: 'header' }));
    activity.worksheet = { source: { kind: 'google', documentId: 'test', sheetId: 1, sheetTitle: '五題', importedAt: 0 }, fills, units: fills.map((fill, index) => ({ id: `u${index + 1}`, name: fill.questionId, questionIds: [fill.questionId], fillBlankIds: [fill.id] })) };
    configureWorksheet(activity);
    for (const unit of activity.worksheet.units) {
      const round = prepareRound(activity, unit.id);
      startRound(activity, round.id, 0); endRound(activity, round.id);
      publishRound(activity, round.id, 0, reviewFor(round).supplements);
    }
    const lines = buildResultsCsv(activity).split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(21);
    expect(lines.filter(line => line.endsWith(',,,未送出,'))).toHaveLength(15);
    expect(lines.filter(line => line.endsWith(',,老師補答,'))).toHaveLength(5);
  });
});
