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

it('原始參考檔的獨立小題編號保留於 G，分列答案指向 H，合併作答格指向 G', async () => {
  const { reference } = await import('../fixtures/xlsx-variants');
  for (const kind of ['single', 'mixed'] as const) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await reference(kind) as never);
    const result = identifyWorksheet(book.worksheets[0]);
    expect(result.fills.map(fill => fill.column)).toEqual(kind === 'single' ? [7,7,7,7,7,7] : [8,8,8,8,7,7]);
    expect(result.fills.every(fill => fill.prompt?.trim())).toBe(true);
    expect(result.units).toHaveLength(kind === 'single' ? 6 : 4);
  }
});
it('富文字與超連結作題號、公式識別拒絕、答案公式保留',()=>{const s=new ExcelJS.Workbook().addWorksheet('文字');s.addRow([{richText:[{text:'題'},{text:'號'}]},'作答']);s.addRow([{text:'1',hyperlink:'https://example.com'}, {formula:'1+1',result:2}]);const r=identifyWorksheet(s);expect(r.fills[0].questionId).toBe('1');expect(r.fills[0].originalType).toBe('formula');s.getCell('A2').value={formula:'1',result:1};expect(()=>identifyWorksheet(s)).toThrow('公式');});
it('兩份原始範本各自移動欄列仍完整辨識且主格座標跟隨',async()=>{const {reference,movedReference}=await import('../fixtures/xlsx-variants');for(const kind of ['single','mixed'] as const){const a=new ExcelJS.Workbook(),b=new ExcelJS.Workbook();await a.xlsx.load(await reference(kind) as never);await b.xlsx.load(await movedReference(kind) as never);const old=identifyWorksheet(a.worksheets[0]),moved=identifyWorksheet(b.worksheets[0]);expect(moved.units.map(u=>u.questionIds)).toEqual(old.units.map(u=>u.questionIds));expect(moved.fills.map(f=>[f.row,f.column,f.prompt])).toEqual(old.fills.map(f=>[f.row+2,f.column+3,f.prompt]));}});
it('格式化備註標記與橫向合併儲存格只建立一次主格填空',()=>{const s=new ExcelJS.Workbook().addWorksheet('備註');s.mergeCells('C2:D2');s.getCell('C2').note={texts:[{text:'課堂搶答：'},{text:'題組／8'}]};s.getCell('C2').value={formula:'1+1',result:2};const r=identifyWorksheet(s);expect(r.fills).toHaveLength(1);expect(r.fills[0]).toMatchObject({questionId:'8',row:2,column:3,identitySource:'note',originalType:'formula'});});

it('題幹保留換行、可供同題組共用，且題幹文字不是填空標記', () => {
  const sheet = new ExcelJS.Workbook().addWorksheet('題幹');
  sheet.addRow(['題號', '題目', '作答']);
  sheet.addRow([1, '答案：請讀以下內容／5\n並依序作答', '（1）']);
  sheet.addRow([null, null, '（2）']);
  sheet.addRow([2, '2.', null]);
  sheet.addRow([3, '題幹跨到作答格', null]);
  sheet.mergeCells('A2:A3');
  sheet.mergeCells('B2:B3');
  sheet.mergeCells('B5:C5');
  expect(identifyWorksheet(sheet).fills.map(fill => [fill.questionId, fill.prompt])).toEqual([
    ['1（1）', '答案：請讀以下內容／5\n並依序作答'],
    ['1（2）', '答案：請讀以下內容／5\n並依序作答'],
    ['2', null],
    ['3', null],
  ]);
});

it('半形子題號和不可見字元皆標示為缺題幹，保留有效題幹原文', () => {
  const sheet = new ExcelJS.Workbook().addWorksheet('題幹驗證');
  sheet.addRow(['題號', '題目', '作答']);
  sheet.addRow([1, '1(1).', '（1）']);
  sheet.addRow([1, '\u200b\u200d', '（2）']);
  sheet.addRow([1, '  A\u200dB\n第二行  ', '（3）']);
  expect(identifyWorksheet(sheet).fills.map(({questionId, prompt}) => [questionId,prompt])).toEqual([
    ['1（1）',null],
    ['1（2）',null],
    ['1（3）','  A\u200dB\n第二行  '],
  ]);
});
