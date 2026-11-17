import ExcelJS from 'exceljs';
import { google } from 'googleapis';
import type { AppConfig } from '../config.js';
import type { Worksheet, WorksheetSource } from '../../../shared/api.js';
import { identifyWorksheet } from './identify.js';
import { DomainError } from '../rounds.js';

export interface ParsedSheetUrl { documentId: string; sheetId?: number }
export interface SheetCandidate { sheetId: number; title: string }
export type ImportResult = { candidates: SheetCandidate[]; worksheet?: never } | { worksheet: Worksheet; candidates?: never };

export function parseSpreadsheetUrl(input: unknown): ParsedSheetUrl {
  if (typeof input !== 'string') throw new DomainError(422, 'INVALID_SHEET_URL', '請貼上有效的 Google 試算表網址。');
  let url: URL;
  try { url = new URL(input); } catch { throw new DomainError(422, 'INVALID_SHEET_URL', '網址格式錯誤，請貼上 Google 試算表連結。'); }
  if (url.protocol !== 'https:' || !['docs.google.com', 'drive.google.com'].includes(url.hostname)) throw new DomainError(422, 'INVALID_SHEET_URL', '僅支援 Google 試算表網址，請確認連結後重試。');
  const match = url.pathname.match(/\/spreadsheets\/d\/([\w-]+)/);
  if (!match) throw new DomainError(422, 'INVALID_SHEET_URL', '找不到試算表識別碼，請複製完整的 Google 試算表網址。');
  const rawGid = url.searchParams.get('gid') ?? new URLSearchParams(url.hash.replace(/^#/, '').replace(/^.*\?/, '')).get('gid');
  if (rawGid !== null && !/^\d+$/.test(rawGid)) throw new DomainError(422, 'INVALID_GID', '工作表 gid 必須是非負整數，請修正網址。');
  return { documentId: match[1], ...(rawGid === null ? {} : { sheetId: Number(rawGid) }) };
}

export async function importGoogleWorksheet(config: AppConfig, input: unknown, selectSheetId?: number): Promise<ImportResult> {
  const { documentId, sheetId } = parseSpreadsheetUrl(input);
  const selectedSheetId = selectSheetId ?? sheetId;
  if (selectedSheetId !== undefined && (!Number.isSafeInteger(selectedSheetId) || selectedSheetId < 0)) throw new DomainError(422, 'INVALID_GID', '工作表 gid 必須是非負整數，請重新選擇。');
  if (!config.googleServiceAccount) throw new DomainError(503, 'GOOGLE_NOT_CONFIGURED', '尚未設定 GOOGLE_SERVICE_ACCOUNT_JSON，請設定 Google 服務帳戶後再匯入。');
  const auth = new google.auth.GoogleAuth({ credentials: config.googleServiceAccount as never, scopes: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheetsApi = google.sheets({ version: 'v4', auth });
  const driveApi = google.drive({ version: 'v3', auth });
  let metadata;
  try { metadata = await sheetsApi.spreadsheets.get({ spreadsheetId: documentId, fields: 'sheets(properties(sheetId,title))' }); }
  catch { throw new DomainError(502, 'GOOGLE_READ_FAILED', '無法讀取試算表，請確認服務帳戶已取得檢視權限。'); }
  const candidates = (metadata.data.sheets ?? []).flatMap(sheet => {
    const properties = sheet.properties;
    return typeof properties?.sheetId === 'number' && typeof properties.title === 'string' ? [{ sheetId: properties.sheetId, title: properties.title }] : [];
  });
  if (!candidates.length) throw new DomainError(422, 'EMPTY_SPREADSHEET', '試算表中沒有可用的工作表，請檢查來源。');
  if (selectedSheetId === undefined && candidates.length > 1) return { candidates };
  const selected = candidates.find(candidate => candidate.sheetId === (selectedSheetId ?? candidates[0].sheetId));
  if (!selected) throw new DomainError(422, 'SHEET_NOT_FOUND', '網址中的 gid 不存在，請選擇有效工作表。');
  let exported: Buffer;
  let googleSheet;
  try {
    const [exportResponse, sheetResponse] = await Promise.all([
      driveApi.files.export({ fileId: documentId, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { responseType: 'arraybuffer' }),
      sheetsApi.spreadsheets.get({ spreadsheetId: documentId, ranges: [selected.title], includeGridData: true, fields: 'sheets(properties(sheetId,title),data(rowData(values(userEnteredValue,note))))' }),
    ]);
    exported = Buffer.from(exportResponse.data as ArrayBuffer);
    if (exported.byteLength > 10 * 1024 * 1024) throw new DomainError(413, 'SHEET_TOO_LARGE', '試算表匯出超過 10 MB，請複製需要的工作表到較小的課堂副本。');
    googleSheet = sheetResponse.data.sheets?.find(sheet => sheet.properties?.sheetId === selected.sheetId);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(502, 'GOOGLE_EXPORT_FAILED', '無法匯出工作表，請確認服務帳戶權限與網路連線。');
  }
  const notes = new Map<string, string>();
  googleSheet?.data?.forEach((grid, gridIndex) => grid.rowData?.forEach((row, rowIndex) => row.values?.forEach((cell, columnIndex) => {
    if (cell.note) notes.set(`${(grid.startRow ?? 0) + rowIndex + 1}:${(grid.startColumn ?? 0) + columnIndex + 1}`, cell.note);
  })));
  const workbook = new ExcelJS.Workbook();
  const xlsxBuffer = Buffer.from(new Uint8Array(exported)) as unknown as Parameters<typeof workbook.xlsx.load>[0];
  try { await workbook.xlsx.load(xlsxBuffer); }
  catch { throw new DomainError(422, 'INVALID_XLSX', '試算表匯出格式無法讀取，請重新匯入或製作副本。'); }
  const worksheet = workbook.worksheets.find(candidate => candidate.name === selected.title);
  if (!worksheet) throw new DomainError(409, 'SHEET_CHANGED', '學習單已變更，請重新匯入。');
  for (const grid of googleSheet?.data ?? []) grid.rowData?.forEach((row, rowIndex) => row.values?.forEach((cell, columnIndex) => {
    const raw = cell.userEnteredValue;
    if (!raw) return;
    const rowNumber = (grid.startRow ?? 0) + rowIndex + 1, columnNumber = (grid.startColumn ?? 0) + columnIndex + 1;
    const xlsxValue = worksheet.getCell(rowNumber, columnNumber).value;
    let equal = false;
    if (typeof raw.formulaValue === 'string') {
      const formula = xlsxValue && typeof xlsxValue === 'object' && 'formula' in xlsxValue ? String(xlsxValue.formula) : xlsxValue && typeof xlsxValue === 'object' && 'sharedFormula' in xlsxValue ? String(xlsxValue.sharedFormula) : '';
      equal = formula.replace(/^=/, '') === raw.formulaValue.replace(/^=/, '');
    } else if (typeof raw.stringValue === 'string') {
      const cellText = xlsxValue && typeof xlsxValue === 'object' && 'richText' in xlsxValue ? xlsxValue.richText.map(part => part.text).join('') : xlsxValue;
      equal = cellText === raw.stringValue;
    } else if (raw.numberValue !== undefined) equal = xlsxValue === raw.numberValue;
    else if (raw.boolValue !== undefined) equal = xlsxValue === raw.boolValue;
    if (!equal) throw new DomainError(409, 'SHEET_CHANGED', '學習單已變更或 Google 與 XLSX 快照不一致，請重新匯入。', { row: rowNumber, column: columnNumber });
  }));
  const identified = identifyWorksheet(worksheet, notes);
  const source: WorksheetSource = { documentId, sheetId: selected.sheetId, sheetTitle: selected.title, importedAt: Date.now() };
  return { worksheet: { source, ...identified } };
}
