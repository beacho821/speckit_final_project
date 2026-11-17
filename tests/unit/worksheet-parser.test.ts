import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { identifyWorksheet } from '../../backend/src/worksheet/identify.js';
import { makeMarkedWorksheet, makeMixedWorksheet, makeSimpleWorksheet } from '../fixtures/guided-notes.js';

describe('學習單動態辨識', () => {
  it('辨識單題表頭與空白填空', async () => {
    const { sheet } = await makeSimpleWorksheet();
    const result = identifyWorksheet(sheet);
    expect(result.units.map(unit => unit.questionIds)).toEqual([['1'], ['2'], ['3'], ['4'], ['5'], ['6']]);
    expect(result.fills).toHaveLength(6);
    expect(result.fills[0].originalType).toBe('blank');
  });
  it('保留合併主題的子題，空白行不借用上一題子題', async () => {
    const { sheet } = await makeMixedWorksheet();
    const result = identifyWorksheet(sheet);
    expect(result.units.map(unit => unit.questionIds)).toEqual([['1（1）', '1（2）'], ['2（1）', '2（2）'], ['3'], ['4']]);
    expect(result.fills).toHaveLength(6);
  });
  it('用題號標記辨識分散填空，並按單位合併送出', async () => {
    const { sheet } = await makeMarkedWorksheet();
    const result = identifyWorksheet(sheet);
    expect(result.units.map(unit => unit.questionIds)).toEqual([['5', '8'], ['9'], ['10', '11'], ['12']]);
    expect(result.fills).toHaveLength(6);
  });
  it('重複題號或零填空時拒絕整份工作表', async () => {
    const { sheet } = await makeSimpleWorksheet(); sheet.addRow([1, '重複']);
    expect(() => identifyWorksheet(sheet)).toThrow('重複出現');
    const empty = new (await import('exceljs')).default.Workbook().addWorksheet('空白');
    expect(() => identifyWorksheet(empty)).toThrow('找不到可辨識的填空');
  });
  it('子題不得跨空白列沿用主題號，且同列多個標記視為歧義', async () => {
    const sheet = new ExcelJS.Workbook().addWorksheet('跨空白列');
    sheet.addRow(['題號', '作答']); sheet.addRow([1, '(1)']); sheet.addRow([null, null]); sheet.addRow([null, '(2)']);
    const result = identifyWorksheet(sheet);
    expect(result.fills.map(fill => fill.questionId)).toEqual(['1（1）']);
    const marked = (await makeMarkedWorksheet()).sheet;
    marked.getCell(2, 2).value = '答案：其他／6';
    expect(() => identifyWorksheet(marked)).toThrow('多個題號標記');
  });
});
