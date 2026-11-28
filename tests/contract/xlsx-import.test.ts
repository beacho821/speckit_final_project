import { worksheetHeaders } from '../helpers/classroom';
import {afterEach,it,expect} from 'vitest';import {classroom} from '../helpers/classroom';import {variant,exactSize} from '../fixtures/xlsx-variants';
let c:Awaited<ReturnType<typeof classroom>>;afterEach(async()=>{await c?.close();});
const mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
async function upload(bytes:Buffer,headers:Record<string,string>={},query=''){return fetch(`${c.base}/api/worksheet/import/xlsx${query}`,{method:'POST',headers:{...c.teacher,...worksheetHeaders(c.activity),'Content-Type':mime,'X-File-Name':encodeURIComponent('學習單.xlsx'),...headers},body:bytes});}
it('raw上傳、候選不發布、指定實際工作表再發布、錯誤保留舊來源',async()=>{c=await classroom();let r=await upload(await variant({sheets:2}));expect(r.status).toBe(200);const candidates=(await r.json()).candidates;expect(c.activity.worksheet).toBeNull();r=await upload(await variant({sheets:2}),{'Content-Type':'application/octet-stream'},`?sheetId=${candidates[1].sheetId}`);expect(r.status).toBe(200);const old=c.activity.worksheet;expect(old?.source).toMatchObject({kind:'xlsx',fileName:'學習單.xlsx',sheetId:2});r=await upload(Buffer.from('壞檔'));expect(r.status).toBe(422);expect(c.activity.worksheet).toBe(old);});
it('先授權／鎖定／MIME才讀主體，原JSON限制不變、精確10MiB接受及加一拒絕',async()=>{c=await classroom();const bytes=exactSize(await variant(),10485760);expect((await upload(bytes)).status).toBe(200);expect((await upload(Buffer.concat([bytes,Buffer.of(0)]))).status).toBe(413);expect((await upload(bytes,{Authorization:'Basic dGVhY2hlcjp3cm9uZw=='})).status).toBe(401);for(const type of ['multipart/form-data','application/json','text/plain'])expect((await upload(Buffer.of(0),{'Content-Type':type})).status).toBe(415);expect((await upload(Buffer.of(0),{'Content-Encoding':'gzip'})).status).toBe(415);expect((await c.request('/sessions',c.teacher,{padding:'x'.repeat(110000)},'POST')).status).toBe(413);c.activity.rosterLocked=true;expect((await upload(bytes)).status).toBe(409);});

it.each(['single', 'mixed'] as const)('最後一題未填標準答案仍可開題，開放後才向學生顯示題幹（%s）', async kind => {
  const { reference } = await import('../fixtures/xlsx-variants');
  c = await classroom();
  const group = await c.group();
  const student = await c.student(group.joinCode);
  const preview = await (await upload(await reference(kind))).json();
  const unit = preview.units[0];
  expect(unit.questions.every((q: {prompt: string}) => q.prompt.length > 0)).toBe(true);
  const round = await (await c.request('/rounds', c.teacher, { unitId: unit.id }, 'POST')).json();
  const start = () => c.request(`/rounds/${round.id}/start`, c.teacher, undefined, 'POST');
  const view = await (await c.request('/view')).json();
  const questions = view.editableQuestions;
  const save = (q: {questionKey: string; questionRevision: number}) => c.request(`/questions/${q.questionKey}`, c.teacher, {questionRevision:q.questionRevision, acceptedAnswersText:'甲答案\n乙答案'}, 'PATCH');
  for (const question of questions.slice(0, -1)) expect((await save(question)).status).toBe(200);
  const preparing = await (await c.request('/view', student.headers)).json();
  expect(preparing.phase).toBe('preparing');
  expect(preparing.unit.questions).toBeUndefined();
  expect(c.activity.units[0].questions.at(-1)?.acceptedAnswers).toEqual([]);
  expect((await start()).status).toBe(200);
  const opened = await (await c.request('/view', student.headers)).json();
  expect(opened.unit.questions).toEqual(unit.questions.map((item, index) => ({ ...item, questionNumber: 1, partNumber: kind === 'mixed' ? index + 1 : null })));
  expect(JSON.stringify(opened)).not.toContain('甲答案');
});

it('舊學習單可預覽缺題幹，但補齊及保留已填答案後才能開題', async () => {
  c = await classroom();
  await c.group();
  const response = await upload(await variant());
  expect(response.status).toBe(200);
  const unit = (await response.json()).units[0];
  expect(unit.questions[0]).toMatchObject({questionId:'1（1）', prompt:null, missingPrompt:true});
  const round = await (await c.request('/rounds',c.teacher,{unitId:unit.id},'POST')).json();
  const start = () => c.request(`/rounds/${round.id}/start`,c.teacher,undefined,'POST');
  const questions = (await (await c.request('/view')).json()).editableQuestions;
  for (const q of questions) {
    const saved = await c.request(`/questions/${q.questionKey}`,c.teacher,{questionRevision:0,acceptedAnswersText:'已填標準答案'},'PATCH');
    expect(saved.status).toBe(200);
  }
  const denied = await start();
  expect(denied.status).toBe(422);
  expect(await denied.json()).toMatchObject({details:{missingPromptQuestionIds:unit.questionIds,missingAcceptedAnswerQuestionIds:[]}});
  for (const q of questions) {
    const saved = await c.request(`/questions/${q.questionKey}`,c.teacher,{questionRevision:1,prompt:'已補充的完整題目'},'PATCH');
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({acceptedAnswers:['已填標準答案']});
  }
  expect((await start()).status).toBe(200);
});

it('只有半形子題號的題幹不可開題，保留準備回合', async () => {
  const {default:ExcelJS} = await import('exceljs');
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('題號佔位');
  sheet.addRows([['題號','題目','作答'], [1,'1(1).','（1）']]);
  c = await classroom();
  await c.group();
  const response = await upload(Buffer.from(await book.xlsx.writeBuffer()));
  expect(response.status).toBe(200);
  const unit = (await response.json()).units[0];
  expect(unit.questions).toEqual([{questionId:'1（1）',prompt:null,missingPrompt:true}]);
  const round = await (await c.request('/rounds',c.teacher,{unitId:unit.id},'POST')).json();
  const question = (await (await c.request('/view')).json()).editableQuestions[0];
  expect((await c.request(`/questions/${question.questionKey}`,c.teacher,{questionRevision:0,acceptedAnswersText:'甲'},'PATCH')).status).toBe(200);
  const start = await c.request(`/rounds/${round.id}/start`,c.teacher,undefined,'POST');
  expect(start.status).toBe(422);
  expect(await start.json()).toMatchObject({details:{missingPromptQuestionIds:['1（1）']}});
  expect(c.activity.rounds[0].phase).toBe('preparing');
  expect(c.activity.rosterLocked).toBe(false);
});
