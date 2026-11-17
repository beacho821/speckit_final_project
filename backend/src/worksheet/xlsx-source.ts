import ExcelJS from 'exceljs';
import {DomainError} from '../rounds.js';
import {identifyWorksheet} from './identify.js';
import type {ImportResult} from './google-source.js';
export const XLSX_LIMIT=10485760;
export function cleanFileName(input:unknown):string {
  const fileName=typeof input==='string'?input.replace(/\\/g,'/').split('/').at(-1)!.replace(/[\u0000-\u001f\u007f]/g,'').trim():'';
  if(!fileName||!fileName.toLowerCase().endsWith('.xlsx'))throw new DomainError(422,'INVALID_FILE_NAME','請選擇副檔名為 .xlsx 的學習單。');
  return fileName;
}
export async function importXlsxWorksheet(bytes:Buffer,inputName:unknown,sheetId?:number):Promise<ImportResult>{
  const fileName=cleanFileName(inputName);
  if(bytes.length>XLSX_LIMIT)throw new DomainError(413,'XLSX_TOO_LARGE','檔案超過 10 MB，請選擇較小的學習單。');
  if(!bytes.length||bytes[0]!==0x50||bytes[1]!==0x4b)throw new DomainError(422,'INVALID_XLSX','無法讀取 XLSX，請確認檔案未損毀或加密。');
  if(sheetId!==undefined&&(!Number.isSafeInteger(sheetId)||sheetId<1))throw new DomainError(422,'INVALID_SHEET_ID','請選擇有效的工作表。');
  const book=new ExcelJS.Workbook();try{await book.xlsx.load(bytes as never);}catch{throw new DomainError(422,'INVALID_XLSX','無法讀取 XLSX，請確認檔案未損毀或加密。');}
  const visible=book.worksheets.filter(s=>s.state==='visible');
  if(sheetId!==undefined){const sheet=visible.find(s=>s.id===sheetId);if(!sheet)throw new DomainError(422,'SHEET_NOT_FOUND','所選工作表不存在或已隱藏，請重新選擇。');return {worksheet:{source:{kind:'xlsx',fileName,sheetId:sheet.id,sheetTitle:sheet.name,importedAt:Date.now()},...identifyWorksheet(sheet)}};}
  const valid=visible.flatMap(sheet=>{try{return [{sheet,identified:identifyWorksheet(sheet)}];}catch(error){if(error instanceof DomainError)return [];throw error;}});
  if(!valid.length){if(visible.length===1)identifyWorksheet(visible[0]);throw new DomainError(422,'NO_FILL_BLANKS','找不到可辨識的學習單，請確認題號與作答欄位。');}
  if(valid.length>1)return {candidates:valid.map(({sheet})=>({sheetId:sheet.id,title:sheet.name}))};
  const {sheet,identified}=valid[0];return {worksheet:{source:{kind:'xlsx',fileName,sheetId:sheet.id,sheetTitle:sheet.name,importedAt:Date.now()},...identified}};
}
