import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../backend/src/app.js';
import { identifyWorksheet } from '../../backend/src/worksheet/identify.js';
import { DomainError } from '../../backend/src/rounds.js';
import type { AppConfig } from '../../backend/src/config.js';
import { makeMarkedWorksheet, makeMixedWorksheet, makeSimpleWorksheet } from '../fixtures/guided-notes.js';

const config: AppConfig = { teacherPassword: 'teacher-preview-secret', port: 0 };
const sourceFor = (documentId: string, sheetId: number, sheetTitle: string) => ({ kind: 'google' as const, documentId, sheetId, sheetTitle, importedAt: 1 });
const { app, activity } = createApp(config, { importWorksheet: async url => {
  const fixture = url === 'single' ? await makeSimpleWorksheet() : url === 'mixed' ? await makeMixedWorksheet() : url === 'moved' ? await makeMarkedWorksheet() : null;
  if (!fixture) throw new DomainError(422, 'INVALID_SHEET_URL', '來源格式錯誤，請修正後重試。');
  return { worksheet: { source: sourceFor(String(url), 7, fixture.sheet.name), ...identifyWorksheet(fixture.sheet) } };
} });
let server: ReturnType<typeof app.listen>; let base = '';
const auth = `Basic ${Buffer.from(`teacher:${config.teacherPassword}`).toString('base64')}`;
beforeAll(async () => { server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

describe('樣本學習單匯入入口', () => {
  it('三種版面經教師 HTTP 匯入後與預期題號、單位及填空數一致', async () => {
    const login = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { Authorization: auth } });
    const { activityId } = await login.json() as { activityId: string };
    const expectations = [
      { url: 'single', unitCount: 6, fillCount: 6, questionIds: ['1', '2', '3', '4', '5', '6'] },
      { url: 'mixed', unitCount: 4, fillCount: 6, questionIds: ['1（1）', '1（2）', '2（1）', '2（2）', '3', '4'] },
      { url: 'moved', unitCount: 4, fillCount: 6, questionIds: ['5', '8', '9', '10', '11', '12'] },
    ];
    let previous: typeof activity.worksheet = null;
    for (const expected of expectations) {
      const response = await fetch(`${base}/api/worksheet/import`, { method: 'POST', headers: { Authorization: auth, 'X-Activity-Id': activityId, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: expected.url }) });
      expect(response.status).toBe(200);
      const preview = await response.json() as { unitCount: number; fillCount: number; units: Array<{ questionIds: string[] }> };
      expect(preview.unitCount).toBe(expected.unitCount); expect(preview.fillCount).toBe(expected.fillCount);
      expect(preview.units.flatMap(unit => unit.questionIds)).toEqual(expected.questionIds);
      previous = activity.worksheet;
    }
    const invalid = await fetch(`${base}/api/worksheet/import`, { method: 'POST', headers: { Authorization: auth, 'X-Activity-Id': activityId, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'invalid' }) });
    expect(invalid.status).toBe(422); expect(activity.worksheet).toBe(previous);
  });
});

it('慢速raw上傳不能覆寫較新Google匯入；成功清準備回合保留名單與成員',async()=>{
 const {classroom}=await import('../helpers/classroom');const {variant}=await import('../fixtures/xlsx-variants');const {request}=await import('node:http');
 const c=await classroom({importWorksheet:async url=>({worksheet:{source:{kind:'google',documentId:String(url),sheetId:1,sheetTitle:'隔離來源',importedAt:0},...identifyWorksheet((await makeSimpleWorksheet()).sheet)}})});
 try{const g=await c.group('甲'),s=await c.student(g.joinCode);await c.request('/worksheet/import',c.teacher,{url:'old'},'POST');const unit=c.activity.worksheet!.units[0];const prepared=await(await c.request('/rounds',c.teacher,{unitId:unit.id},'POST')).json();
 const bytes=await variant();let upload:ReturnType<typeof request>;const result=new Promise<number>((resolve,reject)=>{upload=request(c.base+'/api/worksheet/import/xlsx',{method:'POST',headers:{...c.teacher,'Content-Type':'application/octet-stream','X-File-Name':'local.xlsx','Content-Length':String(bytes.length)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!));});upload.on('error',reject);upload.write(bytes.subarray(0,100));});
 const generation=c.activity.importGeneration;for(let i=0;i<50&&c.activity.importGeneration===generation;i++)await new Promise(r=>setTimeout(r,5));
 expect((await c.request('/worksheet/import',c.teacher,{url:'new'},'POST')).status).toBe(200);upload!.end(bytes.subarray(100));expect(await result).toBe(409);expect(c.activity.worksheet!.source).toMatchObject({kind:'google',documentId:'new'});expect(c.activity.rounds).toHaveLength(0);expect((await c.request(`/rounds/${prepared.id}/start`,c.teacher,undefined,'POST')).status).toBe(409);expect(c.activity.joinCodes.get(g.id)).toBe(g.joinCode);expect(c.activity.members.has(s.session.memberId)).toBe(true);
 }finally{await c.close();}
});
it('解析期間先開題則拒絕發布；候選、失敗與已發布但回應遺失皆以最新快照為準',async()=>{const {classroom}=await import('../helpers/classroom');let release:()=>void=()=>{};let entered:()=>void=()=>{};const started=new Promise<void>(r=>{entered=r;});const gate=new Promise<void>(r=>{release=r;});const c=await classroom({importWorksheet:async url=>{if(url==='slow'){entered();await gate;}return{worksheet:{source:{kind:'google',documentId:String(url),sheetId:1,sheetTitle:'隔離',importedAt:0},...identifyWorksheet((await makeSimpleWorksheet()).sheet)}};}});try{await c.group('甲');await c.request('/worksheet/import',c.teacher,{url:'old'},'POST');const old=c.activity.worksheet;const round=await(await c.request('/rounds',c.teacher,{unitId:old!.units[0].id},'POST')).json();const pending=c.request('/worksheet/import',c.teacher,{url:'slow'},'POST');await started;expect((await c.startConfiguredRound(round.id)).status).toBe(200);release();expect((await pending).status).toBe(409);expect(c.activity.worksheet).toBe(old);const snapshot=await(await c.request('/view')).json();expect(snapshot.worksheetPreview.source.documentId).toBe('old');}finally{release();await c.close();}});

it.each(['single','mixed'] as const)('同一份資料從模擬 Google 與本機 XLSX 匯入的題幹相符（%s）', async kind => {
  const { default: ExcelJS } = await import('exceljs');
  const { reference } = await import('../fixtures/xlsx-variants');
  const { classroom } = await import('../helpers/classroom');
  const bytes = await reference(kind);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as never);
  const sheet = book.worksheets[0];
  const c = await classroom({importWorksheet:async () => ({worksheet:{
    source:{kind:'google',documentId:'跨來源對照',sheetId:1,sheetTitle:sheet.name,importedAt:0},
    ...identifyWorksheet(sheet),
  }})});
  try {
    const remote = await c.request('/worksheet/import',c.teacher,{url:'fixture'},'POST');
    expect(remote.status).toBe(200);
    const local = await fetch(c.base+'/api/worksheet/import/xlsx',{method:'POST',headers:{...c.teacher,'Content-Type':'application/octet-stream','X-File-Name':'reference.xlsx'},body:bytes});
    expect(local.status).toBe(200);
    const [google, xlsx] = await Promise.all([remote.json(),local.json()]);
    expect(xlsx.units).toEqual(google.units);
    expect(xlsx.units.flatMap((unit: {questions: unknown[]}) => unit.questions)).toHaveLength(6);
  } finally { await c.close(); }
});
