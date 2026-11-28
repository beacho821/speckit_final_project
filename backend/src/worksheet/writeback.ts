import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { google } from 'googleapis';
import type { AppConfig } from '../config.js';
import type { FillBlank, Worksheet } from '../../../shared/api.js';
import type { Activity } from '../activity.js';
import { DomainError } from '../rounds.js';
import { identifyWorksheet } from './identify.js';

export interface WritebackPlan {
  writes: Array<{ fill: FillBlank; text: string; note?: string }>;
  matched: string[];
  noWinner: string[];
  conflicts: Array<{ questionId: string; currentValue: unknown; winningAnswer: string }>;
}

const equivalent = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
const readableValue = (value: unknown) => value == null ? '(空白)' : typeof value === 'object' ? JSON.stringify(value) : String(value);

export function planWriteback(activity: Activity, current: Worksheet, rounds = activity.rounds): WritebackPlan {
  const source = activity.worksheet;
  if (!source) throw new DomainError(409, 'WORKSHEET_REQUIRED', '尚未匯入學習單，無法回填。');
  const worksheetAnswers = new Map<string, { text: string; unitName: string }>();
  const noWinner: string[] = [];
  for (const round of rounds.filter(item => item.phase === 'ended')) {
    const unit = source.units.find(item => item.id === round.unitId);
    if (!unit) continue;
    const winner = round.submissions.find(submission => !submission.disqualified && submission.groupId === round.winnerGroupId);
    if (!winner) {
      const correctIds = new Set(round.submissions.filter(sub => !sub.disqualified).flatMap(sub =>
        sub.answers.filter(answer => answer.overrideCorrect ?? answer.autoCorrect).map(answer => answer.questionId)));
      const supplements = new Map(round.supplements?.map(item => [item.questionId, item.text]));
      for (const questionId of unit.questionIds) {
        const text = round.optionalSupplements ? supplements.get(questionId) : undefined;
        if (text === undefined) noWinner.push(questionId);
        if (round.optionalSupplements && !correctIds.has(questionId)) {
          worksheetAnswers.set(questionId, { text: text ?? '', unitName: unit.name });
        }
      }
      continue;
    }
    for (const answer of winner.answers) worksheetAnswers.set(answer.questionId, { text: answer.text, unitName: unit.name });
  }
  const currentByQuestion = new Map<string, FillBlank[]>();
  for (const fill of current.fills) currentByQuestion.set(fill.questionId, [...(currentByQuestion.get(fill.questionId) ?? []), fill]);
  const importedByQuestion = new Map(source.fills.map(fill => [fill.questionId, fill]));
  const writes: WritebackPlan['writes'] = [], matched: string[] = [], conflicts: WritebackPlan['conflicts'] = [];
  for (const [questionId, winner] of worksheetAnswers) {
    const imported = importedByQuestion.get(questionId);
    const matches = currentByQuestion.get(questionId) ?? [];
    if (!imported || matches.length !== 1 || (matches.length === 1 && matches[0].unitId !== imported.unitId)) {
      conflicts.push({ questionId, currentValue: matches.length ? '題號對應不唯一' : '找不到原稿填空', winningAnswer: winner.text });
      continue;
    }
    const fill = matches[0];
    if ((fill.originalValue ?? '') === winner.text) { matched.push(questionId); continue; }
    // 舊版匯入的是小題編號。確認同列原編號與空白答案格後，才改用右側格。
    const legacyLabel = imported.identitySource === 'header' && imported.column === fill.subLabelColumn
      && imported.row === fill.row && imported.subQuestionId === fill.subQuestionId
      && typeof imported.originalValue === 'string'
      && imported.originalValue.trim().match(/^[（(](\d+)[）)]$/)?.[1] === fill.subQuestionId;
    if (legacyLabel ? fill.originalType !== 'blank'
      : !equivalent(fill.originalValue, imported.originalValue) || fill.originalType !== imported.originalType) {
      conflicts.push({ questionId, currentValue: fill.originalValue, winningAnswer: winner.text });
      continue;
    }
    const needsIdentityNote = fill.identitySource !== 'header' || Boolean(fill.subQuestionId) || /^(?:答案|填空)\s*[:：]/.test(winner.text);
    const identity = `課堂搶答：${winner.unitName}／${questionId}`;
    const note = needsIdentityNote && !fill.note?.includes(identity) ? [fill.note?.trim(), identity].filter(Boolean).join('\n') : fill.note;
    writes.push({ fill, text: winner.text, ...(note ? { note } : {}) });
  }
  if (conflicts.length) throw new DomainError(409, 'WRITEBACK_CONFLICT', '來源工作表已有變動。請核對列出的題號與勝組答案，處理後再試。', conflicts.map(conflict => ({ ...conflict, currentValue: readableValue(conflict.currentValue) })));
  return { writes, matched, noWinner, conflicts };
}

async function loadCurrentSource(config: AppConfig, documentId: string, sheetId: number, sheetTitle: string) {
  if (!config.googleServiceAccount) throw new DomainError(503, 'GOOGLE_NOT_CONFIGURED', '尚未設定 GOOGLE_SERVICE_ACCOUNT_JSON，請設定服務帳戶後再回填。');
  const auth = new google.auth.GoogleAuth({ credentials: config.googleServiceAccount as never, scopes: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/spreadsheets'] });
  const sheetsApi = google.sheets({ version: 'v4', auth }), driveApi = google.drive({ version: 'v3', auth });
  const [exportResponse, sheetResponse] = await Promise.all([
    driveApi.files.export({ fileId: documentId, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { responseType: 'arraybuffer' }),
    sheetsApi.spreadsheets.get({ spreadsheetId: documentId, ranges: [sheetTitle], includeGridData: true, fields: 'sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(note))))' }),
  ]);
  const exported = Buffer.from(exportResponse.data as ArrayBuffer);
  const notes = new Map<string, string>();
  const sheetData = sheetResponse.data.sheets?.find(item => item.properties?.sheetId === sheetId);
  sheetData?.data?.forEach(grid => grid.rowData?.forEach((row, rowIndex) => row.values?.forEach((cell, columnIndex) => {
    if (cell.note) notes.set(`${(grid.startRow ?? 0) + rowIndex + 1}:${(grid.startColumn ?? 0) + columnIndex + 1}`, cell.note);
  })));
  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.from(new Uint8Array(exported)) as unknown as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets.find(item => item.name === sheetTitle);
  if (!sheet) throw new DomainError(409, 'WRITEBACK_CONFLICT', '來源工作表已重新命名或移除，請重新匯入後再試。');
  return { identified: identifyWorksheet(sheet, notes), sheet };
}

export async function exportXlsx(activity: Activity, original: Buffer) {
  const source = activity.worksheet;
  if (source?.source.kind !== 'xlsx' || !activity.rounds.some(round => round.phase === 'ended')) throw new DomainError(409, 'XLSX_REQUIRED', '請先匯入 XLSX 並定案至少一題。');
  if (source.originalDigest && source.originalDigest !== createHash('sha256').update(original).digest('hex')) throw new DomainError(409, 'SOURCE_CHANGED', '檔案與匯入時不同，請選擇原始 XLSX。');
  const book = new ExcelJS.Workbook();
  try { await book.xlsx.load(original as never); }
  catch { throw new DomainError(422, 'INVALID_XLSX', '請重新選擇匯入時的 XLSX 原檔。'); }
  const sheet = book.getWorksheet(source.source.sheetId);
  if (!sheet || sheet.name !== source.source.sheetTitle) throw new DomainError(409, 'SOURCE_CHANGED', '來源分頁不符，請選擇原始學習單。');
  const identified = identifyWorksheet(sheet);
  const plan = planWriteback(activity, { ...source, ...identified });
  for (const { fill, text, note } of plan.writes) {
    const cell = sheet.getCell(fill.row, fill.column);
    cell.value = text || null;
    if (note) cell.note = note;
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

export async function writebackToGoogle(activity: Activity, config: AppConfig, rounds = activity.rounds) {
  if(activity.worksheet?.source.kind==='xlsx')throw new DomainError(409,'WRITEBACK_NOT_SUPPORTED','請在結算頁選取原始 XLSX 並下載填好的副本。');
  const endedRounds = rounds.filter(round => round.phase === 'ended');
  if (!endedRounds.length) throw new DomainError(409, 'NO_ENDED_ROUNDS', '尚無已結束回合，請先結束一題後再回填。');
  if (!activity.worksheet) throw new DomainError(409, 'WORKSHEET_REQUIRED', '尚未匯入學習單，請下載活動 CSV。');
  const units = new Map(activity.worksheet.units.map(unit => [unit.id, unit]));
  const sourceRounds = endedRounds.filter(round => units.has(round.unitId));
  if (!sourceRounds.some(round => round.winnerGroupId || round.optionalSupplements)) {
    return { written: [], alreadyMatched: [], noWinner: sourceRounds.flatMap(round => units.get(round.unitId)!.questionIds) };
  }
  let live;
  try { live = await loadCurrentSource(config, activity.worksheet.source.documentId, activity.worksheet.source.sheetId, activity.worksheet.source.sheetTitle); }
  catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(502, 'GOOGLE_READ_FAILED', '無法重新讀取來源工作表，請確認服務帳戶權限及網路後再試。');
  }
  const current: Worksheet = { source: activity.worksheet.source, ...live.identified };
  const snapshotActivity = { ...activity, rounds };
  const plan = planWriteback(snapshotActivity, current, rounds);
  if (!plan.writes.length) return { written: [], alreadyMatched: plan.matched, noWinner: plan.noWinner };
  const auth = new google.auth.GoogleAuth({ credentials: config.googleServiceAccount as never, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheetsApi = google.sheets({ version: 'v4', auth });
  const requests = plan.writes.map(({ fill, text, note }) => ({ updateCells: {
    range: { sheetId: activity.worksheet!.source.sheetId, startRowIndex: fill.row - 1, endRowIndex: fill.row, startColumnIndex: fill.column - 1, endColumnIndex: fill.column },
    rows: [{ values: [{ ...(text ? { userEnteredValue: { stringValue: text } } : {}), ...(note ? { note } : {}) }] }],
    fields: note ? 'userEnteredValue,note' : 'userEnteredValue',
  } }));
  try { await sheetsApi.spreadsheets.batchUpdate({ spreadsheetId: activity.worksheet.source.documentId, requestBody: { requests } }); }
  catch (error) {
    const status = (error as { code?: number }).code;
    if (status === 403) throw new DomainError(403, 'NO_EDIT_PERMISSION', '服務帳戶沒有編輯此工作表的權限，請分享可編輯的教師副本後重試。');
    throw new DomainError(502, 'WRITEBACK_UNCONFIRMED', '寫回結果待確認。請先查看來源工作表，不要重複送出。', plan.writes.map(item => item.fill.questionId));
  }
  try {
    const reread = await loadCurrentSource(config, activity.worksheet.source.documentId, activity.worksheet.source.sheetId, activity.worksheet.source.sheetTitle);
    const byQuestion = new Map(reread.identified.fills.map(fill => [fill.questionId, fill]));
    const differences = plan.writes.filter(({ fill, text, note }) => {
      const found = byQuestion.get(fill.questionId);
      return !found || (found.originalValue ?? '') !== text || (note && !found.note?.includes(note.split('\n').at(-1)!));
    }).map(item => item.fill.questionId);
    if (differences.length) throw new DomainError(502, 'WRITEBACK_UNCONFIRMED', '寫回結果待確認，請核對列出的題號與來源工作表。', differences);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(502, 'WRITEBACK_UNCONFIRMED', '寫回結果待確認。請檢查來源工作表，再重新匯入核對。', plan.writes.map(item => item.fill.questionId));
  }
  return { written: plan.writes.map(item => item.fill.questionId), alreadyMatched: plan.matched, noWinner: plan.noWinner };
}
