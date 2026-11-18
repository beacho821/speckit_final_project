import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../backend/src/config.js';
import { createActivity } from '../../backend/src/activity.js';
import { addGroup } from '../../backend/src/roster.js';
import { endRound, prepareRound, startRound, submitAnswers } from '../../backend/src/rounds.js';
import { identifyWorksheet } from '../../backend/src/worksheet/identify.js';
import { writebackToGoogle } from '../../backend/src/worksheet/writeback.js';
import type ExcelJS from 'exceljs';
import { makeMixedWorksheet, makeSimpleWorksheet } from '../fixtures/guided-notes.js';

const googleMock = vi.hoisted(() => ({ get: vi.fn(), export: vi.fn(), batchUpdate: vi.fn() }));
vi.mock('googleapis', () => ({ google: {
  auth: { GoogleAuth: class { constructor(_options: unknown) {} } },
  sheets: () => ({ spreadsheets: { get: googleMock.get, batchUpdate: googleMock.batchUpdate } }),
  drive: () => ({ files: { export: googleMock.export } }),
} }));

const config: AppConfig = { teacherPassword: 'teacher-runtime-only', googleServiceAccount: { client_email: 'test@example.invalid', private_key: 'runtime-key' }, port: 3000 };
beforeEach(() => vi.resetAllMocks());

describe('Google 原稿身分回填整合', () => {
  it('移動作答欄後依題號重辨，單次批次以文字寫入並保留原備註、樣式與非目標格', async () => {
    const importedFixture = await makeSimpleWorksheet();
    importedFixture.sheet.getCell(4, 2).value = { formula: '1+1', result: 2 } as ExcelJS.CellValue;
    const original = { source: { kind: 'google' as const, documentId: 'document-fixture', sheetId: 7, sheetTitle: importedFixture.sheet.name, importedAt: 1 }, ...identifyWorksheet(importedFixture.sheet) };
    const activity = createActivity();
    activity.worksheet = original;
    const group = addGroup(activity, '甲組', config.teacherPassword, () => 'ABCD2345');
    const ended = [];
    const targetUnits = original.units;
    for (const [index, unit] of targetUnits.entries()) {
      const round = prepareRound(activity, unit.id);
      startRound(activity, round.id, index * 100);
      submitAnswers(activity, round.id, group.id, unit.questionIds.map((questionId, answerIndex) => ({ questionId, text: index === 0 && answerIndex === 0 ? '答案：原有標記／1' : `勝組答案-${questionId}` })), index * 100);
      ended.push(endRound(activity, round.id));
    }

    const currentFixture = await makeSimpleWorksheet();
    currentFixture.sheet.getCell(4, 2).value = { formula: '1+1', result: 2 } as ExcelJS.CellValue;
    currentFixture.sheet.mergeCells('F1:G1'); currentFixture.sheet.getCell('F1').value = '版面標記';
    currentFixture.sheet.getCell(2, 1).style = { font: { bold: true, color: { argb: 'FFFF0000' } } };
    for (let row = 1; row <= currentFixture.sheet.rowCount; row += 1) {
      const answerColumn = currentFixture.sheet.getCell(row, 2), movedColumn = currentFixture.sheet.getCell(row, 4);
      movedColumn.value = answerColumn.value;
      movedColumn.style = structuredClone(answerColumn.style);
      answerColumn.value = null;
    }
    const movedTarget = currentFixture.sheet.getCell(2, 4);
    const originalStyle = structuredClone(movedTarget.style);
    const noteByAddress = new Map<string, string>([['4:4', '共編者備註']]);
    const gridData = () => ({ data: { sheets: [{ properties: { sheetId: 7, title: currentFixture.sheet.name }, data: [{ startRow: 1, startColumn: 3, rowData: [
      { values: [{ note: noteByAddress.get('2:4') }] }, { values: [] }, { values: [{ note: noteByAddress.get('4:4') }] },
    ] }] }] } });
    googleMock.get.mockImplementation(async () => gridData());
    googleMock.export.mockImplementation(async () => ({ data: Buffer.from(await currentFixture.workbook.xlsx.writeBuffer()) }));
    googleMock.batchUpdate.mockImplementation(async ({ requestBody }: { requestBody: { requests: Array<{ updateCells: { range: { startRowIndex: number; startColumnIndex: number }; rows: Array<{ values: Array<{ userEnteredValue: { stringValue: string }; note?: string }> }> } }> } }) => {
      for (const request of requestBody.requests) {
        const update = request.updateCells;
        const row = update.range.startRowIndex + 1, column = update.range.startColumnIndex + 1;
        const value = update.rows[0].values[0];
        currentFixture.sheet.getCell(row, column).value = value.userEnteredValue.stringValue;
        if (value.note) noteByAddress.set(`${row}:${column}`, value.note);
      }
      return { data: {} };
    });

    const result = await writebackToGoogle(activity, config, ended);
    expect(result.written).toEqual(targetUnits.flatMap(unit => unit.questionIds));
    expect(googleMock.batchUpdate).toHaveBeenCalledOnce();
    const requests = googleMock.batchUpdate.mock.calls[0][0].requestBody.requests;
    expect(requests).toHaveLength(6);
    expect(requests.every(request => request.updateCells.rows[0].values[0].userEnteredValue.stringValue.startsWith('答案：') || request.updateCells.rows[0].values[0].userEnteredValue.stringValue.startsWith('勝組答案-'))).toBe(true);
    expect(requests.some(request => request.updateCells.fields === 'userEnteredValue,note')).toBe(true);
    expect(requests.some(request => request.updateCells.fields === 'userEnteredValue')).toBe(true);
    expect(currentFixture.sheet.getCell(2, 4).value).toBe('答案：原有標記／1');
    expect(currentFixture.sheet.getCell(2, 4).note).toBeUndefined();
    expect(noteByAddress.get('4:4')).toContain('共編者備註');
    expect(noteByAddress.get('2:4')).toContain('課堂搶答：1／1');
    expect(currentFixture.sheet.getCell(2, 1).value).toBe(1);
    expect(currentFixture.sheet.getCell(2, 1).style).toEqual({ font: { bold: true, color: { argb: 'FFFF0000' } } });
    expect(currentFixture.sheet.getCell(4, 4).value).toBe('勝組答案-3');
    expect(currentFixture.sheet.getCell(4, 4).style).toEqual(originalStyle);
    expect(currentFixture.sheet.getCell('F1').value).toBe('版面標記');
    expect(currentFixture.sheet.model.merges).toContain('F1:G1');
  });

  it('任何已改目標格都在提交前整批拒絕，不呼叫 batchUpdate', async () => {
    const imported = await makeMixedWorksheet();
    const sourceWorksheet = { source: { kind: 'google' as const, documentId: 'conflict-doc', sheetId: 7, sheetTitle: imported.sheet.name, importedAt: 1 }, ...identifyWorksheet(imported.sheet) };
    const activity = createActivity(); activity.worksheet = sourceWorksheet;
    const group = addGroup(activity, '甲組', config.teacherPassword, () => 'ABCD2345');
    const unit = sourceWorksheet.units[0], round = prepareRound(activity, unit.id); startRound(activity, round.id, 0);
    submitAnswers(activity, round.id, group.id, unit.questionIds.map(questionId => ({ questionId, text: `答案-${questionId}` })), 0); endRound(activity, round.id);
    const current = await makeMixedWorksheet(); current.sheet.getCell(3, 2).value = '教師手動更改';
    googleMock.get.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 7, title: current.sheet.name }, data: [] }] } });
    googleMock.export.mockResolvedValue({ data: Buffer.from(await current.workbook.xlsx.writeBuffer()) });
    googleMock.batchUpdate.mockReset();
    await expect(writebackToGoogle(activity, config)).rejects.toMatchObject({ code: 'WRITEBACK_CONFLICT', status: 409 });
    expect(googleMock.batchUpdate).not.toHaveBeenCalled();
  });

  it('混合版六格經一次回填後仍可用識別備註重讀，重試全部視為已相符', async () => {
    const fixture = await makeMixedWorksheet();
    const source = { source: { kind: 'google' as const, documentId: 'mixed-doc', sheetId: 7, sheetTitle: fixture.sheet.name, importedAt: 1 }, ...identifyWorksheet(fixture.sheet) };
    expect(source.fills).toHaveLength(6);
    const activity = createActivity(); activity.worksheet = source;
    const group = addGroup(activity, '甲組', config.teacherPassword, () => 'ABCD2345');
    const ended = [];
    for (const [index, unit] of source.units.entries()) {
      const round = prepareRound(activity, unit.id); startRound(activity, round.id, index * 100);
      submitAnswers(activity, round.id, group.id, unit.questionIds.map(questionId => ({ questionId, text: `答案-${questionId}` })), index * 100);
      ended.push(endRound(activity, round.id));
    }
    const currentFixture = await makeMixedWorksheet();
    for (let row = 1; row <= currentFixture.sheet.rowCount; row += 1) {
      const answerColumn = currentFixture.sheet.getCell(row, 2), movedColumn = currentFixture.sheet.getCell(row, 4);
      movedColumn.value = answerColumn.value;
      movedColumn.style = structuredClone(answerColumn.style);
      answerColumn.value = null;
    }
    const notes = new Map<string, string>([['3:4', '共編者備註']]);
    const googleGrid = () => {
      const rowData = Array.from({ length: currentFixture.sheet.rowCount }, (_, rowIndex) => ({ values: Array.from({ length: currentFixture.sheet.columnCount }, (_, columnIndex) => ({ ...(notes.has(`${rowIndex + 1}:${columnIndex + 1}`) ? { note: notes.get(`${rowIndex + 1}:${columnIndex + 1}`) } : {}) })) }));
      return { data: { sheets: [{ properties: { sheetId: 7, title: currentFixture.sheet.name }, data: [{ rowData }] }] } };
    };
    googleMock.get.mockImplementation(async () => googleGrid());
    googleMock.export.mockImplementation(async () => ({ data: Buffer.from(await currentFixture.workbook.xlsx.writeBuffer()) }));
    googleMock.batchUpdate.mockImplementation(async (input: any) => {
      for (const request of input.requestBody.requests) {
        const update = request.updateCells, row = update.range.startRowIndex + 1, column = update.range.startColumnIndex + 1;
        const value = update.rows[0].values[0];
        currentFixture.sheet.getCell(row, column).value = value.userEnteredValue.stringValue;
        if (value.note) notes.set(`${row}:${column}`, value.note);
      }
      return { data: {} };
    });
    const written = await writebackToGoogle(activity, config, ended);
    expect(written.written).toHaveLength(6);
    expect(googleMock.batchUpdate).toHaveBeenCalledOnce();
    expect(googleMock.batchUpdate.mock.calls[0][0].requestBody.requests).toHaveLength(6);
    expect(googleMock.batchUpdate.mock.calls[0][0].requestBody.requests.every((request: any) => request.updateCells.range.startColumnIndex === 3)).toBe(true);
    expect(notes.get('3:4')).toContain('共編者備註');
    expect(notes.get('3:4')).toContain('課堂搶答：1／1（1）');
    const retried = await writebackToGoogle(activity, config, ended);
    expect(retried.written).toEqual([]);
    expect(retried.alreadyMatched).toHaveLength(6);
    expect(googleMock.batchUpdate).toHaveBeenCalledOnce();
  });

  it('批次已生效但回應遺失時回報待確認，重試辨認已相符而不重複寫入', async () => {
    const fixture = await makeSimpleWorksheet();
    const source = { source: { kind: 'google' as const, documentId: 'retry-doc', sheetId: 7, sheetTitle: fixture.sheet.name, importedAt: 1 }, ...identifyWorksheet(fixture.sheet) };
    const activity = createActivity(); activity.worksheet = source;
    const group = addGroup(activity, '甲組', config.teacherPassword, () => 'ABCD2345');
    const unit = source.units[0], round = prepareRound(activity, unit.id); startRound(activity, round.id, 0);
    submitAnswers(activity, round.id, group.id, [{ questionId: '1', text: '=原文答案' }], 0); endRound(activity, round.id);
    googleMock.get.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 7, title: fixture.sheet.name }, data: [] }] } });
    googleMock.export.mockImplementation(async () => ({ data: Buffer.from(await fixture.workbook.xlsx.writeBuffer()) }));
    googleMock.batchUpdate.mockImplementationOnce(async (input: any) => {
      for (const request of input.requestBody.requests) {
        const range = request.updateCells.range, value = request.updateCells.rows[0].values[0].userEnteredValue.stringValue;
        fixture.sheet.getCell(range.startRowIndex + 1, range.startColumnIndex + 1).value = value;
      }
      throw new Error('模擬回應遺失');
    });
    await expect(writebackToGoogle(activity, config)).rejects.toMatchObject({ code: 'WRITEBACK_UNCONFIRMED', status: 502 });
    expect(googleMock.batchUpdate).toHaveBeenCalledOnce();
    const retry = await writebackToGoogle(activity, config);
    expect(retry.alreadyMatched).toEqual(['1']);
    expect(retry.written).toEqual([]);
    expect(googleMock.batchUpdate).toHaveBeenCalledOnce();
  });
});
