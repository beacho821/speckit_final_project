import { afterEach, describe, expect, it } from 'vitest';
import { classroom } from '../helpers/classroom.js';
let c: Awaited<ReturnType<typeof classroom>> | undefined;
afterEach(async () => { await c?.close(); c=undefined; });
describe('老師名單與加入碼', () => {
  it('建立、更名、重讀保持加入碼；刪除後不重用', async () => {
    c=await classroom(); const g=await c.group(); expect(g.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{11}$/);
    const rename=await c.request('/groups/'+g.id,c.teacher,{name:'乙組'},'PATCH'); expect(rename.status).toBe(200);
    const body=await rename.json(); expect(body.groups[0].joinCode===g.joinCode).toBe(true); expect(body).not.toHaveProperty('availableGroups');
    expect((await c.request('/groups/'+g.id,c.teacher,undefined,'DELETE')).status).toBe(200);
    const next=await c.group('乙組'); expect(next.joinCode!==g.joinCode).toBe(true);
    expect((await c.request('/roster',c.teacher,{groups:[]},'PUT')).status).toBe(405);
  });
  it('空白、重複與超長名稱零寫入，開題後仍可新增', async () => {
    c=await classroom(); await c.group();
    for(const name of [' ',' 甲組 ','字'.repeat(41)]) expect((await c.request('/groups',c.teacher,{name},'POST')).ok).toBe(false);
    expect(c.activity.groups.length).toBe(1); c.activity.rosterLocked=true;
    expect((await c.request('/groups',c.teacher,{name:'乙組'},'POST')).status).toBe(201); expect(c.activity.groups.length).toBe(2);
  });
});
