import { expect, it } from 'vitest';
import { classroom } from '../helpers/classroom';
import { worksheet } from '../helpers/worksheet';

it('手動加題支援空活動，重複、格式及學生越權遭拒', async () => {
  const c = await classroom();
  try {
    const group = await c.group();
    const student = await c.student(group.joinCode);
    const add = (questionId: string, prompt: string, headers = c.teacher) => c.request('/questions', headers, { questionId, prompt }, 'POST');
    expect((await add('1', '1.')).status).toBe(422);
    expect((await add('1', '完整題目', student.headers)).status).toBe(403);
    const added = await add(' 1 ', '完整題目');
    expect(added.status).toBe(201);
    const question = await added.json();
    expect(question).toMatchObject({ questionId: '1', origin: 'manual' });
    expect(question.fillBlankId).toBeUndefined();
    expect((await add('1', '重複題號')).status).toBe(409);
    expect(c.activity.units).toHaveLength(1);
    const round = await (await c.request('/rounds', c.teacher, { unitId: question.unitId }, 'POST')).json();
    const update = await c.request(`/questions/${question.questionKey}`, c.teacher, { questionRevision: 0, acceptedAnswersText: '答案' }, 'PATCH');
    expect(update.status).toBe(200);
    expect((await c.request(`/rounds/${round.id}/start`, c.teacher, undefined, 'POST')).status).toBe(200);
    expect((await add('2', '課堂中新增')).status).toBe(409);
  } finally { await c.close(); }
});

it('重新匯入保留手動題，遇同題號保持原題庫與已選題目', async () => {
  const c = await classroom({ importWorksheet: async () => ({ worksheet: structuredClone(worksheet) }) });
  try {
    const add = (questionId: string) => c.request('/questions', c.teacher, { questionId, prompt: '完整題目' }, 'POST');
    const manual = await (await add('M1')).json();
    const importSheet = () => c.request('/worksheet/import', c.teacher, {url:'mock'}, 'POST');
    expect((await importSheet()).status).toBe(200);
    expect(c.activity.units.some(unit => unit.id === manual.unitId)).toBe(true);
    const firstImportKey = c.activity.units.find(unit => unit.id === 'u')?.questions[0].questionKey;
    await c.request('/rounds', c.teacher, { unitId: manual.unitId }, 'POST');
    expect((await importSheet()).status).toBe(200);
    expect(c.activity.rounds).toHaveLength(0);
    expect(c.activity.units.find(unit => unit.id === 'u')?.questions[0].questionKey).not.toBe(firstImportKey);
  } finally { await c.close(); }

  const conflict = await classroom({ importWorksheet: async () => ({ worksheet: structuredClone(worksheet) }) });
  try {
    const manual = await (await conflict.request('/questions', conflict.teacher, {questionId:'1（1）', prompt:'手動題目'}, 'POST')).json();
    await conflict.request('/rounds', conflict.teacher, {unitId:manual.unitId}, 'POST');
    const old = conflict.activity.rounds[0];
    const result = await conflict.request('/worksheet/import', conflict.teacher, {url:'mock'}, 'POST');
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ details:{ questionIds:['1（1）'] } });
    expect(conflict.activity.worksheet).toBeNull();
    expect(conflict.activity.rounds[0]).toBe(old);
    expect(conflict.activity.units).toHaveLength(1);
  } finally { await conflict.close(); }
});

it('純手動回合自動判分、改判及補答可公布，CSV 保留一筆補答', async () => {
  const c = await classroom();
  try {
    const a = await c.group('甲組');
    const b = await c.group('乙組');
    const students = await Promise.all([c.student(a.joinCode), c.student(b.joinCode)]);
    const question = await (await c.request('/questions', c.teacher, {questionId:'M1', prompt:'請寫出中央處理器簡稱。'}, 'POST')).json();
    await c.request(`/questions/${question.questionKey}`,c.teacher,{questionRevision:0,acceptedAnswersText:'測試標準甲\r\n\r\n 測試標準乙 '},'PATCH');
    const round = await (await c.request('/rounds',c.teacher,{unitId:question.unitId},'POST')).json();
    const path = `/rounds/${round.id}`;
    const post = (suffix: string, body?:unknown) => c.request(path+suffix,c.teacher,body,'POST');
    expect((await post('/start')).status).toBe(200);
    const submit = (index:number,text:string) => c.request(path+'/submissions',students[index].headers,{answers:[{questionId:'M1',text}]},'POST');
    expect((await submit(0,'錯誤原文')).status).toBe(201);
    expect((await submit(1,' 測試標準乙 ')).status).toBe(201);
    const studentView = await (await c.request('/view',students[0].headers)).json();
    const stopped = await post('/end');
    expect(await stopped.json()).toMatchObject({phase:'reviewing'});
    expect((await c.request(path+'/results',students[0].headers)).status).toBe(403);
    expect((await c.request('/results.csv')).status).toBe(409);
    expect((await submit(1,'不能再送')).status).toBe(409);
    const view = await (await c.request('/view')).json();
    expect(view.groups.map((g: {answers: {correct:boolean}[]}) => g.answers[0].correct)).toEqual([false,true]);
    const studentReview = await (await c.request('/view',students[0].headers)).json();
    expect(studentReview.version).toBeGreaterThan(studentView.version);
    expect(studentReview.groups).toBeUndefined();
    expect(JSON.stringify(studentReview)).not.toContain('測試標準甲');
    const change = (body: unknown) => c.request(path+'/review',c.teacher,body,'PATCH');
    expect((await c.request(path+'/review',students[0].headers,{reviewRevision:0,grades:[]},'PATCH')).status).toBe(403);
    expect((await change({reviewRevision:0,grades:[{groupId:b.id,questionId:'M1',correct:false}]})).status).toBe(200);
    expect((await change({reviewRevision:0,supplements:[{questionId:'M1',text:'過期草稿'}]})).status).toBe(409);
    const firstPublish = await post('/publish',{reviewRevision:1});
    expect(firstPublish.status).toBe(422);
    expect(await firstPublish.json()).toMatchObject({details:{missingSupplementQuestionIds:['M1']}});
    expect((await change({reviewRevision:1,supplements:[{questionId:'M1',text:'老師答案,含"引號"\n下一行'}]})).status).toBe(200);
    expect((await (await c.request('/view',students[0].headers)).json()).version).toBe(studentReview.version);
    expect(await (await post('/publish',{reviewRevision:2})).json()).toMatchObject({phase:'ended',winnerGroupId:null});
    expect((await post('/publish',{reviewRevision:2})).status).toBe(200);
    const published = await (await c.request(path+'/results',students[0].headers)).json();
    expect(published[0]).toMatchObject({teacherAnswer:'老師答案,含"引號"\n下一行',winnerGroupId:null, groups:[{rank:1,correct:false},{rank:2,correct:false}]});
    expect(JSON.stringify(published)).not.toContain('測試標準甲');
    const csv = await (await c.request('/results.csv')).text();
    expect(csv).toContain('題號,組別,答案,搶答順位,作答狀態,正誤');
    expect(csv).toContain('M1,乙組, 測試標準乙 ,2,已送出,答錯');
    expect(csv.match(/,老師補答,/g)).toHaveLength(1);
    expect(csv).toContain('"老師答案,含""引號""\n下一行"');
    expect((await (await c.request('/results.csv')).text())).toBe(csv);
  } finally { await c.close(); }
});

it('不可見的手動題幹與改題請求不會變更題庫', async () => {
  const c = await classroom();
  try {
    const add = (prompt: string) => c.request('/questions',c.teacher,{questionId:'M1',prompt},'POST');
    for (const hidden of ['\u200b\u200d', '\u0000\ufe0f', '\u2060\n']) {
      const rejected = await add(hidden);
      expect(rejected.status).toBe(422);
      expect(await rejected.json()).toMatchObject({code:'INVALID_PROMPT',message:expect.stringContaining('完整題幹')});
      expect(c.activity.units).toHaveLength(0);
    }
    const prompt = '  A\u200dB\n請說明。  ';
    const valid = await add(prompt);
    expect(valid.status).toBe(201);
    const question = await valid.json();
    expect(question.prompt).toBe(prompt);
    const rejected = await c.request(`/questions/${question.questionKey}`,c.teacher,{questionRevision:0,prompt:'\u200b'},'PATCH');
    expect(rejected.status).toBe(422);
    expect(c.activity.units[0].questions[0]).toMatchObject({prompt,questionRevision:0});
  } finally { await c.close(); }
});
