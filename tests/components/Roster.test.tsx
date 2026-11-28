// @vitest-environment jsdom
import { describe,it,expect,vi } from 'vitest';
import Roster from '../../frontend/src/Roster';
import {render,host,input,click} from '../helpers/ui';
const session={role:'teacher' as const,activityId:'a'};
const groups=[{id:'g',name:'甲組',joinCode:'ABCDEFGH',members:[{id:'m',name:'小明'}]}];
describe('教師名單介面',()=>{
 it('空名單可直接輸入組名新增，不含下拉；錯誤保留輸入',async()=>{vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({message:'組名已存在'},{status:422}));await render(<Roster session={session} credential="test" roster={{groups:[],locked:false,rosterVersion:0}} onSave={()=>{}}/>);expect(host.querySelector('select')).toBeNull();await input('新組名','甲組');await click('新增組別');expect(host.textContent).toContain('組名已存在');expect(host.querySelector<HTMLInputElement>('[aria-label="新組名"]')?.value).toBe('甲組');});
 it('鎖定後仍可複製加入碼及查看小組成員', async () => {
   const writeText = vi.fn().mockResolvedValue(undefined);
   Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
   try {
     await render(<Roster session={session} credential="test" roster={{groups,locked:true,rosterVersion:1}}
       standings={[{ id: 'g', name: '甲組', points: 12, rank: 1 }]} onSave={()=>{}}/>);
     const card = host.querySelector('article')!;
     expect(card.querySelector('h3')?.textContent).toBe('甲組');
     expect(card.querySelector('.roster-members')?.textContent).toBe('小明');
     expect(card.querySelector('.roster-points')?.textContent).toContain('積分12');
     expect(host.querySelector('#new-group')).not.toBeNull();
     expect(host.querySelector('#roster-file')).not.toBeNull();
     expect(card.querySelectorAll('button')).toHaveLength(1);
     await click('複製學生加入碼 ABCDEFGH');
     expect(writeText).toHaveBeenCalledWith('ABCDEFGH');
     expect(host.textContent).toContain('已複製');
   } finally {
     Reflect.deleteProperty(navigator, 'clipboard');
   }
 });
});
