import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSpreadsheetUrl, importGoogleWorksheet } from '../../backend/src/worksheet/google-source.js';
import type { AppConfig } from '../../backend/src/config.js';
import { makeMarkedWorksheet, makeSimpleWorksheet } from '../fixtures/guided-notes.js';

const googleMock = vi.hoisted(() => ({ get: vi.fn(), export: vi.fn(), batchUpdate: vi.fn(), authOptions: [] as unknown[] }));
vi.mock('googleapis', () => ({ google: {
  auth: { GoogleAuth: class { constructor(options: unknown) { googleMock.authOptions.push(options); } } },
  sheets: () => ({ spreadsheets: { get: googleMock.get, batchUpdate: googleMock.batchUpdate } }),
  drive: () => ({ files: { export: googleMock.export } }),
} }));

const config: AppConfig = { teacherPassword: 'test-teacher-secret', googleServiceAccount: { client_email: 'test@example.invalid', private_key: 'runtime-test-key' }, port: 3000 };
afterEach(() => { vi.resetAllMocks(); googleMock.authOptions.length = 0; });

describe('Google 試算表來源驗證', () => {
  it('解析網址中的文件識別碼及查詢或片段 gid', () => {
    expect(parseSpreadsheetUrl('https://docs.google.com/spreadsheets/d/abc_123/edit?gid=42#gid=9')).toEqual({ documentId: 'abc_123', sheetId: 42 });
    expect(parseSpreadsheetUrl('https://docs.google.com/spreadsheets/d/abc_123/edit#gid=9')).toEqual({ documentId: 'abc_123', sheetId: 9 });
  });
  it('拒絕任意網址、錯誤 Google 路徑與無效 gid', () => {
    expect(() => parseSpreadsheetUrl('https://example.com/spreadsheets/d/abc')).toThrow('僅支援 Google');
    expect(() => parseSpreadsheetUrl('https://docs.google.com/document/d/abc')).toThrow('找不到試算表識別碼');
    expect(() => parseSpreadsheetUrl('https://docs.google.com/spreadsheets/d/abc/edit?gid=-1')).toThrow('非負整數');
  });
  it('Google 帳戶未設定時提供可修正提示，不嘗試讀取輸入網路位址', async () => {
    const config: AppConfig = { teacherPassword: 'test-teacher-secret', port: 3000 };
    await expect(importGoogleWorksheet(config, 'https://docs.google.com/spreadsheets/d/abc/edit')).rejects.toMatchObject({ status: 503, code: 'GOOGLE_NOT_CONFIGURED' });
  });

  it('多分頁回傳 metadata 候選，不匯出或發布未選分頁', async () => {
    googleMock.get.mockResolvedValueOnce({ data: { sheets: [
      { properties: { sheetId: 12, title: '第一頁' } },
      { properties: { sheetId: 13, title: '第二頁' } },
      { properties: { title: '不完整資料' } },
    ] } });
    const result = await importGoogleWorksheet(config, 'https://docs.google.com/spreadsheets/d/doc-test/edit');
    expect(result).toEqual({ candidates: [{ sheetId: 12, title: '第一頁' }, { sheetId: 13, title: '第二頁' }] });
    expect(googleMock.export).not.toHaveBeenCalled();
    expect(googleMock.get).toHaveBeenCalledOnce();
  });

  it('單一 Google 分頁未提供 gid 時自動選用唯一分頁', async () => {
    const fixture = await makeSimpleWorksheet();
    const xlsx = Buffer.from(await fixture.workbook.xlsx.writeBuffer());
    googleMock.get
      .mockResolvedValueOnce({ data: { sheets: [{ properties: { sheetId: 12, title: '單題範本' } }] } })
      .mockResolvedValueOnce({ data: { sheets: [{ properties: { sheetId: 12, title: '單題範本' }, data: [] }] } });
    googleMock.export.mockResolvedValue({ data: xlsx });
    const result = await importGoogleWorksheet(config, 'https://docs.google.com/spreadsheets/d/doc-test/edit');
    expect('worksheet' in result).toBe(true);
    if ('worksheet' in result) expect(result.worksheet.source).toMatchObject({ documentId: 'doc-test', sheetId: 12, sheetTitle: '單題範本' });
    expect(googleMock.export).toHaveBeenCalledOnce();
  });

  it('依指定 gid 解析 XLSX、套用分頁偏移備註，並核對 Google 格值快照', async () => {
    const fixture = await makeMarkedWorksheet();
    const xlsx = Buffer.from(await fixture.workbook.xlsx.writeBuffer());
    googleMock.get
      .mockResolvedValueOnce({ data: { sheets: [{ properties: { sheetId: 12, title: '移位範本' } }, { properties: { sheetId: 13, title: '其他頁' } }] } })
      .mockResolvedValueOnce({ data: { sheets: [{ properties: { sheetId: 12, title: '移位範本' }, data: [{ startRow: 1, startColumn: 0, rowData: [{ values: [{ note: '教師備註' }] }] }] }] } });
    googleMock.export.mockResolvedValue({ data: xlsx });
    const result = await importGoogleWorksheet(config, 'https://docs.google.com/spreadsheets/d/doc-test/edit', 12);
    expect('worksheet' in result).toBe(true);
    if (!('worksheet' in result)) throw new Error('預期匯入工作表');
    expect(result.worksheet.units.map(unit => unit.questionIds)).toEqual([['5', '8'], ['9'], ['10', '11'], ['12']]);
    expect(result.worksheet.fills[0].note).toBe('教師備註');
    expect(googleMock.export).toHaveBeenCalledWith({ fileId: 'doc-test', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { responseType: 'arraybuffer' });
    expect(googleMock.authOptions[0]).toMatchObject({ credentials: config.googleServiceAccount, scopes: expect.arrayContaining(['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/spreadsheets.readonly']) });
  });

  it('拒絕不同步快照、讀取權限錯誤、無效匯出及超過 10 MB 的檔案', async () => {
    const fixture = await makeSimpleWorksheet();
    const xlsx = Buffer.from(await fixture.workbook.xlsx.writeBuffer());
    googleMock.get
      .mockResolvedValueOnce({ data: { sheets: [{ properties: { sheetId: 12, title: '單題範本' } }] } })
      .mockResolvedValueOnce({ data: { sheets: [{ properties: { sheetId: 12, title: '單題範本' }, data: [{ startRow: 1, startColumn: 0, rowData: [{ values: [{ userEnteredValue: { stringValue: '已修改' } }] }] }] }] } });
    googleMock.export.mockResolvedValue({ data: xlsx });
    await expect(importGoogleWorksheet(config, 'https://docs.google.com/spreadsheets/d/doc-test/edit', 12)).rejects.toMatchObject({ code: 'SHEET_CHANGED', status: 409 });

    googleMock.get.mockRejectedValueOnce(new Error('private test detail'));
    await expect(importGoogleWorksheet(config, 'https://docs.google.com/spreadsheets/d/doc-test/edit', 12)).rejects.toMatchObject({ code: 'GOOGLE_READ_FAILED', status: 502 });

    googleMock.get.mockResolvedValueOnce({ data: { sheets: [{ properties: { sheetId: 12, title: '單題範本' } }] } }).mockResolvedValueOnce({ data: { sheets: [{ properties: { sheetId: 12, title: '單題範本' } }] } });
    googleMock.export.mockResolvedValueOnce({ data: Buffer.from('not an xlsx') });
    await expect(importGoogleWorksheet(config, 'https://docs.google.com/spreadsheets/d/doc-test/edit', 12)).rejects.toMatchObject({ code: 'INVALID_XLSX', status: 422 });

    googleMock.get.mockResolvedValueOnce({ data: { sheets: [{ properties: { sheetId: 12, title: '單題範本' } }] } }).mockResolvedValueOnce({ data: { sheets: [{ properties: { sheetId: 12, title: '單題範本' } }] } });
    googleMock.export.mockResolvedValueOnce({ data: Buffer.alloc(10 * 1024 * 1024 + 1) });
    await expect(importGoogleWorksheet(config, 'https://docs.google.com/spreadsheets/d/doc-test/edit', 12)).rejects.toMatchObject({ code: 'SHEET_TOO_LARGE', status: 413 });
  });
});
