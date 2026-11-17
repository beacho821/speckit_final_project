import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';

export const reference = (kind: 'single' | 'mixed') => readFile(new URL(`../../specs/002-classroom-workflow-fixes/references/${kind === 'single' ? 'single' : 'mixed'}-questions.xlsx`, import.meta.url));
export async function variant(options: { sheets?: number; moved?: boolean; duplicate?: boolean; formula?: boolean; extra?: boolean } = {}) {
  const book = new ExcelJS.Workbook();
  for (let i = 0; i < (options.sheets ?? 1); i++) {
    const sheet = book.addWorksheet(`學習單${i + 1}`);
    if (options.moved) sheet.addRow(['額外標題']);
    const q = options.moved ? 2 : 1, a = options.moved ? 4 : 2;
    const header = options.moved ? 2 : 1;
    sheet.getCell(header, q).value = '題號'; sheet.getCell(header, a).value = '作答';
    sheet.getCell(header + 1, q).value = options.formula ? { formula: '1', result: 1 } : 1;
    sheet.getCell(header + 1, a).value = '（1）';
    sheet.getCell(header + 2, q).value = options.duplicate ? 1 : 1;
    sheet.getCell(header + 2, a).value = options.duplicate ? '（1）' : '（2）';
    if (!options.duplicate) sheet.mergeCells(header + 1, q, header + 2, q);
    for (let n = 2; n <= (options.extra ? 5 : 3); n++) sheet.getCell(header + n + 1, q).value = n;
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

// 在 ZIP 前加入填補區；JSZip 會以中央目錄推算偏移，仍實際載入驗證。
export function exactSize(buffer: Buffer, size: number) {
  if (buffer.length > size) throw new Error('測試來源已超過目標大小');
  return Buffer.concat([Buffer.concat([Buffer.from('PK'),Buffer.alloc(size-buffer.length-2)]),buffer]);
}

export async function movedReference(kind:'single'|'mixed') {
  const old=new ExcelJS.Workbook();await old.xlsx.load(await reference(kind) as never);
  const source=old.worksheets[0],book=new ExcelJS.Workbook(),target=book.addWorksheet('移位副本');
  source.eachRow(row=>row.eachCell(cell=>{if(cell.address!==cell.master.address)return;const next=target.getCell(cell.fullAddress.row+2,cell.fullAddress.col+3);next.value=structuredClone(cell.value);if(cell.note)next.note=structuredClone(cell.note);}));
  for(const range of source.model.merges??[]){const [start,end]=range.split(':').map(address=>source.getCell(address).fullAddress);target.mergeCells(start.row+2,start.col+3,end.row+2,end.col+3);}
  return Buffer.from(await book.xlsx.writeBuffer());
}
