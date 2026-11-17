import { createHash } from 'node:crypto';
import type ExcelJS from 'exceljs';
import type { BuzzerUnit, FillBlank } from '../../../shared/api.js';
import { DomainError } from '../rounds.js';

export interface IdentifiedWorksheet { fills: FillBlank[]; units: BuzzerUnit[] }
const textOf = (value: unknown) => typeof value === 'object' && value && 'text' in value ? String((value as { text: unknown }).text) : value == null ? '' : String(value);
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
  const mergedMaster = new Map<string, ExcelJS.Cell>();
  for (let row = 1; row <= sheet.rowCount; row += 1) for (let column = 1; column <= sheet.columnCount; column += 1) {
    const cell = sheet.getCell(row, column);
    if (cell.isMerged) mergedMaster.set(`${row}:${column}`, cell.master);
  }
  const cellValue = (row: number, col: number) => {
    const master = mergedMaster.get(`${row}:${col}`);
    return textOf((master ?? sheet.getCell(row, col)).value);
  };
  let headerRow = 0, questionColumn = 0, answerColumn = 0;
  for (let row = 1; row <= sheet.rowCount; row += 1) {
    const columns = sheet.getRow(row).values as unknown[];
    for (let col = 1; col < columns.length; col += 1) {
      const label = clean(textOf(columns[col]));
      if (/^(題號|題目號|題號編號)$/.test(label)) questionColumn = col;
      if (/^(作答|答案|填答)$/.test(label)) answerColumn = col;
    }
    if (questionColumn && answerColumn) { headerRow = row; break; }
    questionColumn = 0; answerColumn = 0;
  }

  const fills: FillBlank[] = [];
  const unitMap = new Map<string, BuzzerUnit>();
  const seenQuestions = new Set<string>();
  let currentMain = '';
  const startRow = headerRow ? headerRow + 1 : 1;
  for (let rowNumber = startRow; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const questionRaw = questionColumn ? cellValue(rowNumber, questionColumn).trim() : '';
    const answerCell = answerColumn ? sheet.getCell(rowNumber, answerColumn) : undefined;
    const answerRaw = answerCell ? cellValue(rowNumber, answerColumn) : '';
    const cells = row.values as unknown[];
    let markedCell: ExcelJS.Cell | undefined;
    let markedUnit = '';
    let markedQuestion = '';
    let markedNote = '';
    let targetNote = '';
    for (let column = 1; column < cells.length; column += 1) {
      const cell = sheet.getCell(rowNumber, column);
      const cellText = textOf(cell.value).trim();
      const note = notes.get(`${rowNumber}:${column}`) ?? (typeof cell.note === 'string' ? cell.note : '');
      if (column === answerColumn) targetNote = note;
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
    if (seenQuestions.has(parsed.questionId)) throw new DomainError(422, 'DUPLICATE_QUESTION', `${parsed.questionId} 重複出現，請修正學習單題號。`);
    seenQuestions.add(parsed.questionId);
    const unitId = `unit-${createHash('sha1').update(unitName).digest('hex').slice(0, 10)}`;
    const fillId = `fill-${createHash('sha1').update(`${sheet.name}:${rowNumber}:${targetCell.fullAddress.col}:${parsed.questionId}`).digest('hex').slice(0, 12)}`;
    const value = targetCell.value;
    const fill: FillBlank = {
      id: fillId, ...parsed, unitId, row: rowNumber, column: targetCell.fullAddress.col,
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
