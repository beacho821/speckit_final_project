import { worksheetHeaders } from '../helpers/classroom';
import {it,expect} from 'vitest';import {classroom} from '../helpers/classroom';import {reference,variant} from '../fixtures/xlsx-variants';
async function exercise(bytes:Buffer,five=false){let googleCalls=0;const c=await classroom({writeback:async()=>{googleCalls++;return{written:[],alreadyMatched:[],noWinner:[]};}});try{
 const rosterStart=performance.now();const gs=[];for(const n of ['甲組','乙組','丙組'])gs.push(await c.group(n));expect(performance.now()-rosterStart).toBeLessThan(120000);const joinStart=performance.now();const students=[];for(const g of gs)students.push(await c.student(g.joinCode,'學生'));expect(performance.now()-joinStart).toBeLessThan(30000);
 const uploadStart=performance.now();const response=await fetch(c.base+'/api/worksheet/import/xlsx',{method:'POST',headers:{...c.teacher,...worksheetHeaders(c.activity),'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent('實際課堂.xlsx')},body:bytes});expect(response.status).toBe(200);expect(performance.now()-uploadStart).toBeLessThan(3000);const units=c.activity.worksheet!.units;expect(c.activity.worksheet!.fills.every(f=>f.column>0)).toBe(true);
 for(const [i,unit] of units.slice(0,five?5:1).entries()){
 const r=await(await c.request('/rounds',c.teacher,{unitId:unit.id},'POST')).json();await c.startConfiguredRound(r.id, questionId => `${questionId} 答案`);
 if(i!==4){const answers=unit.questionIds.map(questionId=>({questionId,text:`${questionId} 答案`}));if(i>0){const early=await c.request(`/rounds/${r.id}/submissions`,students[0].headers,{answers},'POST');expect(early.status).toBe(409);expect((await early.json()).code).toBe('WAIT_REQUIRED');await new Promise(r=>setTimeout(r,3050));}
 const accepted=await c.request(`/rounds/${r.id}/submissions`,students[0].headers,{answers},'POST');expect(accepted.status).toBe(201);const own=await(await c.request('/view',students[0].headers)).json();expect(own.received).toBe(true);expect(own.ownAnswers).toEqual(answers);
 const member=await c.student(gs[0].joinCode,'學生');expect(member.session.memberId).toBe(students[0].session.memberId);expect((await c.request(`/rounds/${r.id}/submissions`,member.headers,{answers},'POST')).status).toBe(409);
 }
 await c.finishRound(r.id);const results=await(await c.request(`/rounds/${r.id}/results`,students[1].headers)).json();expect(results).toHaveLength(unit.questionIds.length);if(i===4)expect(results.every((line:{ownAnswer:string|null})=>line.ownAnswer===null)).toBe(true);
 }
 const writeback=await c.request('/worksheet/writeback',c.teacher,undefined,'POST');expect(writeback.status).toBe(409);expect((await writeback.json()).code).toBe('WRITEBACK_NOT_SUPPORTED');expect(googleCalls).toBe(0);const csv=await c.request('/results.csv');expect(csv.status).toBe(200);const text=await csv.text();expect(text).toContain('甲組');expect(text).toContain('丙組,,,未送出');expect(c.activity.members.size).toBe(3);expect(c.activity.rosterLocked).toBe(true);
 }finally{await c.close();}}
it('原始單題與混合XLSX從HTTP匯入到整組送答／CSV，無雲端帳戶',async()=>{await exercise(await reference('single'));await exercise(await reference('mixed'));},15000);
it('三組連續五回合含混合題、單題、無人送出與3秒公平等待',async()=>{await exercise(await variant({extra:true}),true);},20000);
