import ExcelJS from 'exceljs';

export async function makeSimpleWorksheet() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('單題範本');
  sheet.addRow(['題號', '作答']);
  sheet.addRow([1, null]); sheet.addRow([2, '']); sheet.addRow([3, null]); sheet.addRow([4, null]); sheet.addRow([5, null]); sheet.addRow([6, null]);
  return { workbook, sheet };
}

export async function makeMixedWorksheet() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('混合範本');
  sheet.addRow(['課堂練習']); sheet.addRow(['題號', '作答']);
  sheet.addRow([1, '(1)']); sheet.addRow([null, '(2)']); sheet.mergeCells('A3:A4');
  sheet.addRow([2, '(1)']); sheet.addRow([null, '(2)']); sheet.mergeCells('A5:A6');
  sheet.addRow([3, null]); sheet.addRow([4, null]);
  return { workbook, sheet };
}

export async function makeMarkedWorksheet() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('移位範本');
  sheet.addRow(['作答說明', '教師備註', '學生答案']);
  sheet.addRow(['答案：運算／5', null, '']);
  sheet.addRow([null, '中間空列', null]);
  sheet.addRow(['答案：運算／8', null, '']);
  sheet.addRow(['答案：單題一／9', null, '']);
  sheet.addRow(['答案：隊伍／10', null, '']);
  sheet.addRow(['答案：隊伍／11', null, '']);
  sheet.addRow(['答案：單題二／12', null, '']);
  return { workbook, sheet };
}
