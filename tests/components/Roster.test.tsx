// @vitest-environment jsdom
import { describe,it,expect,vi } from 'vitest';
import Roster from '../../frontend/src/Roster';
import {render,host,input,click} from '../helpers/ui';
const session={role:'teacher' as const,activityId:'a'};
const groups=[{id:'g',name:'甲組',joinCode:'ABCDEFGH',members:[{id:'m',name:'小明'}]}];
describe('教師名單介面',()=>{
 it('空名單可直接輸入組名新增，不含下拉；錯誤保留輸入',async()=>{vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({message:'組名已存在'},{status:422}));await render(<Roster session={session} credential="test" roster={{groups:[],locked:false,rosterVersion:0}} onSave={()=>{}}/>);expect(host.querySelector('select')).toBeNull();await input('新組名','甲組');await click('新增組別');expect(host.textContent).toContain('組名已存在');expect(host.querySelector<HTMLInputElement>('[aria-label="新組名"]')?.value).toBe('甲組');});
 it('鎖定後仍可看碼及曾加入名稱，不能更名刪除',async()=>{await render(<Roster session={session} credential="test" roster={{groups,locked:true,rosterVersion:1}} onSave={()=>{}}/>);expect(host.textContent).toContain('ABCDEFGH');expect(host.textContent).toContain('小明');expect(host.querySelector('input:not(:disabled)')).toBeNull();expect([...host.querySelectorAll('button')].some(b=>!b.disabled)).toBe(false);});
});
