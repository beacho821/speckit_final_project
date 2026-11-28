import ExcelJS from 'exceljs';
import { DomainError } from './rounds.js';
import { validateName } from './roster.js';

function invalid(message: string) { return new DomainError(422, 'INVALID_ROSTER_XLSX', message); }

function cellName(cell: ExcelJS.Cell, row: number, label: string) {
  const value = cell.value;
  const text = typeof value === 'number' ? String(value)
    : value && typeof value === 'object' && 'richText' in value ? value.richText.map(part => part.text).join('') : value;
  try { return validateName(text, label); }
  catch { throw invalid(`第 ${row} 列的「${label}」請填入 1 至 40 字的文字或數字。`); }
}

export async function readRosterXlsx(bytes: Buffer) {
  const book = new ExcelJS.Workbook();
  try { await book.xlsx.load(bytes as never); }
  catch { throw invalid('無法讀取 Excel 名單，請確認檔案為可開啟的 .xlsx 活頁簿。'); }
  const sheet = book.worksheets.find(sheet => sheet.state === 'visible');
  const header = sheet?.getRow(1);
  if (!sheet || !header || header.getCell(1).text.trim() !== '組別' || header.getCell(2).text.trim() !== '名字') {
    throw invalid('第一張可見工作表的第一列須依序填寫「組別」與「名字」，可下載範例後修改。');
  }
  const groups = new Map<string, Set<string>>();
  const blank = (cell: ExcelJS.Cell) => cell.value == null || (typeof cell.value === 'string' && !cell.value.trim());
  sheet.eachRow((row, index) => {
    row.eachCell((cell, column) => {
      if (column > 2 && !blank(cell)) throw invalid(`第 ${index} 列超出兩欄，請只保留「組別」與「名字」。`);
    });
    if (index === 1 || (blank(row.getCell(1)) && blank(row.getCell(2)))) return;
    const group = cellName(row.getCell(1), index, '組別');
    const name = cellName(row.getCell(2), index, '名字');
    const members = groups.get(group) ?? new Set<string>();
    if (members.has(name)) throw invalid(`第 ${index} 列與同組學生同名，請在名字前加座號區分。`);
    members.add(name);
    groups.set(group, members);
  });
  if (!groups.size) throw invalid('名單沒有學生，請從第二列開始填寫組別與名字。');
  return groups;
}
