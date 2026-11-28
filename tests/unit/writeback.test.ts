import { configureWorksheet, finishRound } from '../helpers/worksheet.js';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createActivity } from '../../backend/src/activity.js';
import { prepareRound, startRound, submitAnswers } from '../../backend/src/rounds.js';
import { exportXlsx, planWriteback } from '../../backend/src/worksheet/writeback.js';
import { importXlsxWorksheet } from '../../backend/src/worksheet/xlsx-source.js';
import { reference } from '../fixtures/xlsx-variants.js';
import type { FillBlank, Worksheet } from '../../shared/api.js';

function completedActivity() {
  const activity = createActivity(); activity.groups = [{ id: 'a', name: '甲組' }, { id: 'b', name: '乙組' }];
  const fills: FillBlank[] = [1, 2].map((num, index) => ({ id: `f${num}`, questionId: `${num}`, mainQuestionId: `${num}`, unitId: 'u', row: index + 2, column: 3, originalValue: '', originalType: 'string', identitySource: 'header' }));
  activity.worksheet = { source: { kind: 'google', documentId: 'local', sheetId: 1, sheetTitle: '樣本', importedAt: 0 }, fills, units: [{ id: 'u', name: '題組', questionIds: ['1', '2'], fillBlankIds: ['f1', 'f2'] }] };
  configureWorksheet(activity, id => id === '1' ? ['=文字'] : ['答案,含逗號']);
  const round = prepareRound(activity, 'u'); startRound(activity, round.id, 0);
  submitAnswers(activity, round.id, 'b', [{ questionId: '1', text: '先送但答錯' }, { questionId: '2', text: '先送但答錯' }], 0);
  submitAnswers(activity, round.id, 'a', [{ questionId: '1', text: '=文字' }, { questionId: '2', text: '答案,含逗號' }], 0); finishRound(activity, round.id);
  return activity;
}

describe('原稿回填計畫', () => {
  it('舊活動可匯出到獨立的小題答案格，保留編號與合併格，並檢查新位置的編輯衝突', async () => {
    const bytes = await reference('mixed');
    const { worksheet } = await importXlsxWorksheet(bytes, '混合題.xlsx');
    const activity = createActivity();
    activity.worksheet = structuredClone(worksheet!);
    for (const fill of activity.worksheet.fills) {
      if (!fill.subLabelColumn) continue;
      fill.column = fill.subLabelColumn;
      delete fill.subLabelColumn;
      fill.originalValue = '（' + fill.subQuestionId + '）';
      fill.originalType = 'string';
    }
    activity.groups = [{ id: 'a', name: '甲組' }];
    configureWorksheet(activity, id => ['回填' + id]);
    for (const unit of activity.worksheet.units) {
      const round = prepareRound(activity, unit.id);
      startRound(activity, round.id);
      const answers = unit.questionIds.map(id => ({ questionId: id, text: '回填' + id }));
      submitAnswers(activity, round.id, 'a', answers, round.openAtByGroup.a);
      finishRound(activity, round.id);
    }
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await exportXlsx(activity, bytes) as never);
    const sheet = book.worksheets[0];
    for (const fill of worksheet!.fills) {
      const target = sheet.getCell(fill.row, fill.column);
      expect(target.value).toBe('回填' + fill.questionId);
      if (fill.subQuestionId) {
        expect(sheet.getCell(fill.row, 7).text).toMatch(new RegExp('[（(]' + fill.subQuestionId + '[）)]'));
      } else {
        expect(sheet.getCell(fill.row, 8).master.address).toBe(target.address);
      }
    }
    const first = worksheet!.fills[0];
    first.originalValue = '教師後來填入的答案';
    first.originalType = 'string';
    expect(() => planWriteback(activity, worksheet!)).toThrow('來源工作表已有變動');
  });
  it('以題號重辨移位後的格子，並保留有勝組原文', () => {
    const activity = completedActivity();
    const current: Worksheet = { ...activity.worksheet!, fills: activity.worksheet!.fills.map((fill, index) => ({ ...fill, row: 10 + index, column: 6 })) };
    const plan = planWriteback(activity, current);
    expect(plan.writes.map(item => item.fill.row)).toEqual([10, 11]);
    expect(plan.writes.map(item => item.text)).toEqual(['=文字', '答案,含逗號']);
    expect(plan.matched).toEqual([]);
  });
  it('任何一格有外部衝突時整批拒絕並列出勝組答案', () => {
    const activity = completedActivity();
    const current: Worksheet = { ...activity.worksheet!, fills: activity.worksheet!.fills.map((fill, index) => index ? { ...fill, originalValue: '人工編輯' } : fill) };
    try { planWriteback(activity, current); throw new Error('應拒絕衝突'); }
    catch (error) {
      expect((error as { code: string }).code).toBe('WRITEBACK_CONFLICT');
      expect((error as { details: Array<{ questionId: string; winningAnswer: string }> }).details).toEqual([{ questionId: '2', currentValue: '人工編輯', winningAnswer: '答案,含逗號' }]);
    }
  });
  it('原稿已與勝組相同時列為已相符，不再寫入', () => {
    const activity = completedActivity();
    const current: Worksheet = { ...activity.worksheet!, fills: activity.worksheet!.fills.map((fill, index) => ({ ...fill, originalValue: index ? '答案,含逗號' : '=文字' })) };
    const plan = planWriteback(activity, current);
    expect(plan.writes).toHaveLength(0); expect(plan.matched).toEqual(['1', '2']);
  });
});
