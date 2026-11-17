import { describe, expect, it } from 'vitest';
import { parseSpreadsheetUrl, importGoogleWorksheet } from '../../backend/src/worksheet/google-source.js';
import type { AppConfig } from '../../backend/src/config.js';

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
});
