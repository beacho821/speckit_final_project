import {it,expect} from 'vitest';import {classroom} from '../helpers/classroom';import {worksheet} from '../helpers/worksheet';
it('學生他組加入不喚醒，老師版本更新；更名只更新組名，碼與成員不變',async()=>{const c=await classroom({importWorksheet:async()=>({worksheet:structuredClone(worksheet)})});try{const g=await c.group('甲'),h=await c.group('乙'),s=await c.student(g.joinCode);await c.request('/worksheet/import',c.teacher,{url:'isolated'},'POST');const teacher=await(await c.request('/view')).json();expect(teacher.worksheetPreview).toMatchObject({mainQuestionCount:1,fillCount:2});const view=await(await c.request('/view',s.headers)).json();expect(view).not.toHaveProperty('worksheetPreview');const pending=c.request(`/view?after=${view.version}`,s.headers);await c.student(h.joinCode);expect(await Promise.race([pending.then(()=>true),new Promise(r=>setTimeout(()=>r(false),150))])).toBe(false);await c.request(`/groups/${g.id}`,c.teacher,{name:'新甲'},'PATCH');const next=await(await pending).json();expect(next.groupName).toBe('新甲');expect(c.activity.joinCodes.get(g.id)).toBe(g.joinCode);expect(c.activity.members.has(s.session.memberId)).toBe(true);expect((await(await c.request('/view')).json()).rosterVersion).toBeGreaterThan(teacher.rosterVersion);}finally{await c.close();}});

it('準備階段學生只收到回合定位與題號，老師仍能看自訂標籤與題幹', async () => {
  const fixture = structuredClone(worksheet);
  fixture.units[0].name = '教師的自訂標籤';
  fixture.fills.forEach(fill => { fill.prompt = '完整題幹'; });
  const c = await classroom({importWorksheet:async () => ({worksheet:fixture})});
  try {
    const group = await c.group();
    const student = await c.student(group.joinCode);
    await c.request('/worksheet/import',c.teacher,{url:'mock'},'POST');
    const round = await (await c.request('/rounds',c.teacher,{unitId:'u'},'POST')).json();
    const teacher = await (await c.request('/view')).json();
    expect(teacher.unit).toMatchObject({name:'教師的自訂標籤',questions:[{prompt:'完整題幹'},{prompt:'完整題幹'}]});
    const studentView = await (await c.request('/view',student.headers)).json();
    expect(studentView).toMatchObject({phase:'preparing',roundId:round.id});
    expect(studentView.unit).toEqual({id:'u',questionIds:['1（1）','1（2）']});
    expect((await c.startConfiguredRound(round.id)).status).toBe(200);
    const active = await (await c.request('/view',student.headers)).json();
    expect(active.unit.questions).toMatchObject([{prompt:'完整題幹'},{prompt:'完整題幹'}]);
  } finally { await c.close(); }
});
