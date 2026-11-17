import { createHash } from 'node:crypto';
import type ExcelJS from 'exceljs';
import type { BuzzerUnit, FillBlank } from '../../../shared/api.js';
import { DomainError } from '../rounds.js';

export interface IdentifiedWorksheet { fills: FillBlank[]; units: BuzzerUnit[] }
export const textOf = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  if ('formula' in value || 'sharedFormula' in value) return '';
  if ('richText' in value && Array.isArray(value.richText)) return value.richText.map(part => part.text ?? '').join('');
  if ('text' in value) return String(value.text);
  return '';
};
const noteOf = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'texts' in value && Array.isArray(value.texts)) return value.texts.map(textOf).join('');
  return '';
};
const isFormula = (value: unknown) => Boolean(value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value));
const clean = (value: string) => value.replace(/[\s　]+/g, '').trim();
const markerPattern = /^(?:答案|填空)\s*[:：]\s*([^/／]+)\s*[/／]\s*(.+)$/;
const notePattern = /課堂搶答\s*[:：]\s*([^/／\r\n]+)\s*[/／]\s*([^\r\n]+)/;
const subPattern = /^(.+?)\s*[（(]\s*(\d+)\s*[）)]$/;

export function parseQuestion(raw: string, inferredSub?: string) {
  const value = raw.trim();
  const match = value.match(subPattern);
  const mainQuestionId = (match?.[1] ?? value).trim();
  const subQuestionId = match?.[2] ?? inferredSub;
  const questionId = subQuestionId ? `${mainQuestionId}（${subQuestionId}）` : mainQuestionId;
  if (!mainQuestionId || !/\d/.test(mainQuestionId)) return null;
  return { mainQuestionId, subQuestionId, questionId };
}

export function identifyWorksheet(sheet: ExcelJS.Worksheet, notes: Map<string, string> = new Map()): IdentifiedWorksheet {
  const master = (row: number, column: number) => sheet.getCell(row,column).master;
  const cellValue = (row: number, col: number) => textOf(master(row,col).value);
  let headerRow = 0, questionColumn = 0, answerColumn = 0;
  sheet.eachRow(row => {
    if (headerRow) return;
    let q=0,a=0;
    row.eachCell(cell => {
      if (cell.address !== cell.master.address) return;
      const label=clean(textOf(cell.value));
      if (/^(題號|題目號|題號編號)$/.test(label)) q=cell.fullAddress.col;
      if (/^(作答|答案|填答)$/.test(label)) a=cell.fullAddress.col;
    });
    if(q&&a){headerRow=row.number;questionColumn=q;answerColumn=a;}
  });

  const fills: FillBlank[] = [];
  const unitMap = new Map<string, BuzzerUnit>();
  const seenQuestions = new Set<string>();
  const seenTargets = new Set<string>();
  let currentMain = '';
  const startRow = headerRow ? headerRow + 1 : 1;
  for (let rowNumber = startRow; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const questionRaw = questionColumn ? cellValue(rowNumber, questionColumn).trim() : '';
    const answerCell = answerColumn ? master(rowNumber, answerColumn) : undefined;
    if (questionColumn && isFormula(master(rowNumber,questionColumn).value)) throw new DomainError(422,'FORMULA_IDENTITY','題號不能使用公式，請改為明確文字或數字。');
    const answerRaw = answerCell ? cellValue(rowNumber, answerColumn) : '';
    const cells = row.values as unknown[];
    let markedCell: ExcelJS.Cell | undefined;
    let markedUnit = '';
    let markedQuestion = '';
    let markedNote = '';
    let targetNote = '';
    for (let column = 1; column < cells.length; column += 1) {
      const cell = master(rowNumber,column);
      if(cell.fullAddress.row !== rowNumber || cell.fullAddress.col !== column) continue;
      const cellText = textOf(cell.value).trim();
      const note = notes.get(`${rowNumber}:${column}`) ?? noteOf(cell.note);
      if (cell.address === answerCell?.address) targetNote = note;
      const mark = cellText.match(markerPattern);
      const noteMark = note.match(notePattern);
      if (mark || noteMark) {
        if (markedCell) throw new DomainError(422, 'AMBIGUOUS_MARKER', `第 ${rowNumber} 列有多個題號標記，請保留一個明確標記。`);
        markedCell = cell; markedUnit = (noteMark?.[1] ?? mark?.[1] ?? '').trim(); markedQuestion = (noteMark?.[2] ?? mark?.[2] ?? '').trim(); markedNote = note;
      }
    }
    if (!questionRaw && !markedCell && !answerRaw) {
      currentMain = '';
      continue;
    }
    if (!markedCell && !answerColumn) continue;
    if (questionRaw) currentMain = questionRaw;

    let parsed: ReturnType<typeof parseQuestion> = null;
    let unitName = '';
    let targetCell = answerCell;
    let identitySource: FillBlank['identitySource'] = 'header';
    if (markedCell) {
      if (!markedUnit || !markedQuestion) throw new DomainError(422, 'INVALID_MARKER', `第 ${rowNumber} 列的填空標記不完整，請填入單位名稱與題號。`);
      parsed = parseQuestion(markedQuestion);
      unitName = markedUnit;
      targetCell = markedCell;
      identitySource = markedNote.match(notePattern) ? 'note' : 'marker';
    } else if (answerCell) {
      let inferredSub: string | undefined;
      const answerSub = answerRaw.match(/^\s*[（(](\d+)[）)]\s*$/);
      if (answerSub) inferredSub = answerSub[1];
      const main = questionRaw || currentMain;
      if (!main) continue;
      parsed = parseQuestion(main, inferredSub);
      if (!questionRaw && !inferredSub && !answerRaw) continue;
      unitName = parsed?.mainQuestionId ?? '';
    }
    if (!parsed || !targetCell || !unitName) continue;
    if (seenTargets.has(targetCell.address)) continue;
    seenTargets.add(targetCell.address);
    if (seenQuestions.has(parsed.questionId)) throw new DomainError(422, 'DUPLICATE_QUESTION', `${parsed.questionId} 重複出現，請修正學習單題號。`);
    seenQuestions.add(parsed.questionId);
    const unitId = `unit-${createHash('sha1').update(unitName).digest('hex').slice(0, 10)}`;
    const fillId = `fill-${createHash('sha1').update(`${sheet.name}:${rowNumber}:${targetCell.fullAddress.col}:${parsed.questionId}`).digest('hex').slice(0, 12)}`;
    const value = targetCell.value;
    const fill: FillBlank = {
      id: fillId, ...parsed, unitId, row: targetCell.fullAddress.row, column: targetCell.fullAddress.col,
      originalValue: value ?? null,
      originalType: value === null || value === undefined ? 'blank' : typeof value === 'object' && 'formula' in value ? 'formula' : typeof value === 'object' && 'richText' in value ? 'richText' : typeof value,
      ...(targetNote || markedNote ? { note: targetNote || markedNote } : {}), identitySource,
    };
    fills.push(fill);
    let unit = unitMap.get(unitId);
    if (!unit) { unit = { id: unitId, name: unitName, questionIds: [], fillBlankIds: [] }; unitMap.set(unitId, unit); }
    unit.questionIds.push(parsed.questionId); unit.fillBlankIds.push(fillId);
  }
  if (!fills.length) throw new DomainError(422, 'NO_FILL_BLANKS', '找不到可辨識的填空，請確認學習單含「題號／作答」表頭或答案標記。');
  for (const unit of unitMap.values()) if (unit.fillBlankIds.length === 0) throw new DomainError(422, 'EMPTY_UNIT', `題組「${unit.name}」沒有填空，請修正題目標記。`);
  return { fills, units: [...unitMap.values()] };
}
