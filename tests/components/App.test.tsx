// @vitest-environment jsdom
import { act as reactAct } from 'react';
import type { ActivityView } from '../../shared/api';
import { SESSION_KEY } from '../../frontend/src/session';
import {it,expect,vi} from 'vitest';import App from '../../frontend/src/App';import {render,host,input,click,flush} from '../helpers/ui';
it('學生欄位為加入碼與名稱、切角色清輸入；晚登入不能覆寫登出',async()=>{sessionStorage.clear();let resolve:(r:Response)=>void=()=>{};vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(r=>{resolve=r;}));await render(<App/>);await click('學生');expect(host.textContent).toContain('加入碼');expect(host.querySelector('[aria-label="名稱"]')).not.toBeNull();await input('加入碼','ABCDEFGH');await input('名稱','小明');await click('加入活動');await click('老師');await flush();resolve(Response.json({role:'student',activityId:'a',groupId:'g',groupName:'甲',memberId:'m',studentName:'小明'}));await flush();expect(host.textContent).not.toContain('學生工作台');expect(host.textContent).toContain('教師密碼');expect(sessionStorage.length).toBe(0);});
it('沒有品牌或舊術語且教師密碼不存 Web Storage',async()=>{sessionStorage.clear();vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>String(input).startsWith('/api/view')?new Promise(()=>{}):Response.json(String(input)==='/api/classrooms'?[]:{role:'teacher'}));await render(<App/>);expect(host.textContent).not.toMatch(/課堂線上搶答|憑證|組別代碼/);await input('教師密碼','temporary-password');await click('登入活動');await flush();expect(host.textContent).toContain('我的教室');expect(sessionStorage.length).toBe(0);expect(localStorage.length).toBe(0);});

it('重新整理先驗證；恢復中切角色會清除暫存並忽略晚成功',async()=>{const {SESSION_KEY}=await import('../../frontend/src/session');sessionStorage.setItem(SESSION_KEY,JSON.stringify({version:1,activityId:'old',joinCode:'ABCDEFGH',studentName:'小明',memberId:'m'}));let resolve:(r:Response)=>void=()=>{};const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(r=>{resolve=r;}));await render(<App/>);expect(host.textContent).toContain('正在驗證');expect(host.textContent).not.toContain('學生工作台');expect(new Headers(fetch.mock.calls[0][1]?.headers).get('X-Activity-Id')).toBe('old');await click('老師');resolve(Response.json({role:'student',activityId:'old',groupId:'g',memberId:'m',studentName:'小明'}));await flush();expect(sessionStorage.length).toBe(0);expect(host.textContent).not.toContain('學生工作台');});
it('匯入回應遺失後完整快照恢復新來源，離線維持待確認且不重送POST',async()=>{sessionStorage.clear();let full=0,posts=0;const oldPreview={source:{kind:'xlsx',fileName:'舊.xlsx',sheetId:1,sheetTitle:'舊',importedAt:1},mainQuestionCount:1,fillCount:1,unitCount:1,units:[{id:'old',name:'舊題',questionIds:['1']}]};const base={phase:'idle',roundId:null,unit:null,closedRoundIds:[],version:1,rosterVersion:0,catalogRevision:0,availableUnits:[{unitId:'old',questionIds:['1']}],worksheetPreview:oldPreview};vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{if(String(url)==='/api/sessions')return Response.json({role:'teacher'});if(String(url)==='/api/classrooms')return Response.json([{id:'room',name:'測試教室',phase:'idle',updatedAt:1}]);if(String(url)==='/api/classrooms/room')return Response.json({id:'room',classroomId:'room',activityId:'a',activityEpoch:'e',name:'測試教室',phase:'idle',updatedAt:1});if(String(url)==='/api/roster')return Response.json({groups:[],locked:false,rosterVersion:0});if(String(url)==='/api/worksheet/import'){posts++;throw new TypeError();}if(String(url).includes('after='))return new Promise((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error())));full++;if(full===2)throw new TypeError();return Response.json(full===1?base:{...base,version:2,worksheetPreview:{...oldPreview,source:{...oldPreview.source,fileName:'新.xlsx',importedAt:2}}});});await render(<App/>);await input('教師密碼','test');await click('登入活動');await flush();await click('恢復主持');await flush();expect(location.pathname).toBe('/teacher/classrooms/room/groups');await reactAct(async()=>host.querySelector<HTMLAnchorElement>('nav a[href="/teacher/classrooms/room"]')!.click());await flush();await input('Google 試算表網址','https://docs.google.com/test');await click('匯入並預覽');await click('確認重新匯入');await flush();expect(host.textContent).toContain('匯入結果待確認');expect([...host.querySelectorAll('button')].find(b=>b.textContent==='匯入並預覽')?.disabled).toBe(true);await flush(850);expect(host.textContent).toContain('新.xlsx');expect(host.textContent).not.toContain('匯入結果待確認');expect(posts).toBe(1);});

it('匯入結果不明時，先前連線恢復的快照不能解除開題鎖定', async () => {
  const { act } = await import('react');
  sessionStorage.clear();
  history.replaceState(null, '', '/');
  const view = {
    phase: 'idle', roundId: null, unit: null, closedRoundIds: [], version: 1, catalogRevision: 1, rosterVersion: 0,
    queueUnitIds: ['u'], nextUnitId: 'u', groups: [{ id: 'g', name: '甲組', received: false }],
    questionCards: [{ id: 'u', opened: false, name: '手動題', questions: [
      { questionKey: 'q', origin: 'manual', prompt: '題幹', missingPrompt: false, acceptedAnswers: ['答案'] },
    ] }],
  };
  let lost!: (error: Error) => void;
  let synced!: (response: Response) => void;
  let fullReads = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    switch (String(url)) {
      case '/api/sessions': return Response.json({ role: 'teacher' });
      case '/api/classrooms': return Response.json([{ id: 'room', name: '測試教室', phase: 'idle', updatedAt: 1 }]);
      case '/api/classrooms/room': return Response.json({ id: 'room', classroomId: 'room', activityId: 'a', activityEpoch: 'e', name: '測試教室', phase: 'idle' });
      case '/api/roster': return Response.json({ groups: [], locked: false, rosterVersion: 0 });
      case '/api/worksheet/import': return new Promise((_, reject) => { lost = reject; });
      case '/api/view':
        fullReads++;
        return fullReads <= 2 ? Response.json(view) : new Promise(resolve => { synced = resolve; });
      default: return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error())));
    }
  });
  await render(<App />);
  await input('教師密碼', 'test');
  await click('登入活動');
  await flush();
  await click('恢復主持');
  await flush();
  expect(location.pathname).toBe('/teacher/classrooms/room/groups');
  await act(async () => host.querySelector<HTMLAnchorElement>('nav a[href="/teacher/classrooms/room"]')!.click());
  await flush();
  await input('Google 試算表網址', 'https://docs.google.com/test');
  await click('匯入並預覽');
  await act(async () => { window.dispatchEvent(new Event('online')); });
  expect(fullReads).toBe(2);
  await act(async () => lost(new TypeError('offline')));
  expect(fullReads).toBe(3);
  expect(host.textContent).toContain('匯入結果待確認');
  const consoleLink = [...host.querySelectorAll('nav a')].find(link => link.textContent === '老師控制台') as HTMLAnchorElement;
  await act(async () => consoleLink.click());
  const open = () => [...host.querySelectorAll('button')].find(button => button.textContent === '開放搶答')!;
  expect(open().disabled).toBe(true);
  await act(async () => synced(Response.json({ version: 2 })));
  expect(open().disabled).toBe(true);
  await act(async () => { window.dispatchEvent(new Event('online')); });
  expect(fullReads).toBe(4);
  await act(async () => synced(Response.json(view)));
  expect(open().disabled).toBe(false);
  expect(host.textContent).not.toContain('匯入結果待確認');
});

it('學生可用導覽切換即時排名，保留作答草稿並在重整後回到排名', async () => {
  const session = { role: 'student', activityId: 'a', groupId: 'g', memberId: 'm', groupName: '甲組', studentName: '小明' };
  let view: ActivityView = { phase: 'active', roundId: 'r', unit: { id: 'u', questionIds: ['q'] }, closedRoundIds: [], version: 1,
    standings: [{ id: 'g', name: '甲組', points: 0, rank: 1 }] };
  let deliver!: (response: Response) => void;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url) === '/api/sessions') return Response.json(session);
    if (String(url) === '/api/view') return Response.json(view);
    return new Promise((resolve, reject) => {
      deliver = resolve;
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  });
  const navigate = (path: string) => reactAct(async () => host.querySelector<HTMLAnchorElement>(`nav a[href="${path}"]`)!.click());
  history.replaceState(null, '', '/student/standings');
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, version: 1, joinCode: 'ABCDEFGH' }));
  try {
    await render(<App />);
    expect(location.pathname).toBe('/student/standings');
    expect(host.querySelector('nav a[aria-current="page"]')?.textContent).toBe('即時排名');
    expect(document.activeElement?.textContent).toBe('即時排名');
    await navigate('/student');
    const draft = host.querySelector('textarea')!;
    await reactAct(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(draft, '還沒送出的草稿');
      draft.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelector('.student-standings')).toBeNull();
    await navigate('/student/standings');
    expect(draft.closest('[hidden]')).not.toBeNull();
    view = { ...view, version: 2, standings: [
      { id: 'other', name: '乙組', points: 3, rank: 1 }, { id: 'g', name: '甲組', points: 2, rank: 2 },
    ] };
    await reactAct(async () => deliver(Response.json(view)));
    expect(host.querySelector('.student-standings p')?.textContent).toBe('本組第 2 名 · 2 分');
    await navigate('/student');
    expect(host.querySelector('textarea')?.value).toBe('還沒送出的草稿');
  } finally {
    await render(null);
    sessionStorage.clear();
    history.replaceState(null, '', '/');
  }
});
