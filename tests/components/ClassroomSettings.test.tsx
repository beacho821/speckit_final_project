// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import TeacherPortal from '../../frontend/src/TeacherWorkspace';
import { render, flush, host, click } from '../helpers/ui';

it('教師導覽按指定順序呈現，三頁皆可一鍵開啟教室投影', async () => {
  const navigate = vi.fn();
  const logout = vi.fn();
  const props = { credential: '測試密碼', navigate, logout, openProjection: vi.fn(() => true) };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
    if (path === '/api/classrooms/room') return Response.json({
      id: 'room', classroomId: 'room', activityId: 'a', activityEpoch: 'e', name: '甲教室', phase: 'idle', updatedAt: 0,
    });
    if (path === '/api/roster') return Response.json({ groups: [], locked: false, rosterVersion: 0 });
    if (path === '/api/view') return Response.json({ phase: 'idle', roundId: null, unit: null, closedRoundIds: [], version: 1 });
    return new Promise((_, reject) => options?.signal?.addEventListener('abort', () => reject(new Error())));
  });
  await render(<TeacherPortal {...props} path="/teacher/classrooms/room" />);
  await flush();
  const groups = [...host.querySelectorAll<HTMLAnchorElement>('a')].filter(a => ['分組管理', '開啟分組管理'].includes(a.textContent ?? ''));
  expect(groups.map(a => a.pathname)).toEqual(['/teacher/classrooms/room/groups']);
  for (const path of ['/teacher/classrooms/room', '/teacher/classrooms/room/console', '/teacher/classrooms/room/groups']) {
    await render(<TeacherPortal {...props} path={path} />);
    const nav = [...host.querySelectorAll<HTMLAnchorElement>('nav a')];
    expect(nav.map(link => link.textContent)).toEqual(['分組管理', '題目管理', '老師控制台', '開啟教室投影']);
    expect(nav[3].pathname).toBe('/teacher/classrooms/room/projection');
    nav[3].click();
  }
  expect(props.openProjection).toHaveBeenCalledTimes(3);
  expect(host.querySelector('nav a[aria-current="page"]')?.textContent).toBe('分組管理');
  expect(host.textContent).toContain('組別名單');
  props.openProjection.mockReturnValueOnce(false);
  const { act } = await import('react');
  await act(async () => host.querySelector<HTMLAnchorElement>('.projection-link')!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('瀏覽器阻擋投影視窗');
});

it.each([
  ['active', '請先到控制台結束搶答，再審核並定案。'],
  ['reviewing', '請先到控制台完成審核與定案。'],
  ['ended', undefined],
  ['idle', undefined],
])('新活動按鈕反映 %s 的階段限制', async (phase, hint) => {
  const navigate = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
    if (path === '/api/classrooms/room') return Response.json({
      id: 'room', classroomId: 'room', activityId: 'a', activityEpoch: 'e', name: '甲教室', phase, updatedAt: 0,
    });
    if (path === '/api/roster') return Response.json({ groups: [], locked: false, rosterVersion: 0 });
    if (path === '/api/view') return Response.json({ phase, roundId: 'r', unit: null, closedRoundIds: [], version: 1 });
    return new Promise((_, reject) => options?.signal?.addEventListener('abort', () => reject(new Error())));
  });
  await render(<TeacherPortal credential="測試密碼" path="/teacher/classrooms/room/console" {...{ navigate }} logout={vi.fn()} openProjection={vi.fn()} />);
  await flush();
  const button = [...host.querySelectorAll('button')].find(node => node.textContent === '結算')!;
  expect(button.disabled).toBe(Boolean(hint));
  expect(host.querySelector('#settlement-hint')?.textContent).toBe(hint);
  expect(host.textContent).not.toContain('回填與匯出');
  expect(host.textContent).not.toContain('開始新活動');
  if (!hint) {
    await click('結算');
    expect(host.textContent).toContain('目前沒有可回填的答案');
    expect(host.textContent).toContain('開始新活動');
    await click('返回主持');
    expect(host.textContent).not.toContain('回填與匯出');
  }
  expect([...host.querySelectorAll('a')].find(node => node.textContent === '老師控制台')?.pathname).toBe('/teacher/classrooms/room/console');
});

it('結算取消確認保留本場，確認成功返回新場主持', async () => {
  const initial = { id: 'room', classroomId: 'room', activityId: 'a', activityEpoch: 'e', name: '甲教室', phase: 'idle', updatedAt: 0 };
  const next = { ...initial, activityId: 'next' };
  const start = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
    if (path === '/api/classrooms/room') return Response.json(initial);
    if (path === '/api/roster') return Response.json({ groups: [], locked: false, rosterVersion: 0 });
    if (path === '/api/view') return Response.json({ phase: 'idle', roundId: null, unit: null, closedRoundIds: [], version: 1 });
    if (path === '/api/classrooms/room/activities') {
      start(new Headers(options?.headers).get('X-Activity-Id'));
      return Response.json(next, { status: 201 });
    }
    if (path === '/api/classrooms/room/results') return Response.json([]);
    return new Promise((_, reject) => options?.signal?.addEventListener('abort', () => reject(new Error())));
  });
  await render(<TeacherPortal credential="測試" path="/teacher/classrooms/room/console"
    navigate={vi.fn()} logout={vi.fn()} openProjection={vi.fn()} />);
  await click('結算');
  await click('開始新活動');
  await click('取消');
  expect(start).not.toHaveBeenCalled();
  expect(host.textContent).toContain('回填與匯出');
  await click('開始新活動');
  await click('確認開始');
  await flush();
  expect(start).toHaveBeenCalledExactlyOnceWith('a');
  expect(host.textContent).not.toContain('回填與匯出');
  expect(host.textContent).toContain('結算');
});

it('結算期間收到其他分頁開題的更新時收起工具及確認對話框', async () => {
  let deliverUpdate!: (response: Response) => void;
  const initial = { id: 'room', classroomId: 'room', activityId: 'a', activityEpoch: 'e', name: '甲教室', phase: 'idle', updatedAt: 0 };
  const snapshot = { phase: 'idle', roundId: null, unit: null, closedRoundIds: [], version: 1 };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
    if (path === '/api/classrooms/room') return Response.json(initial);
    if (path === '/api/roster') return Response.json({ groups: [], locked: false, rosterVersion: 0 });
    if (path === '/api/view') return Response.json(snapshot);
    if (path === '/api/classrooms/room/results') return Response.json([]);
    return new Promise((resolve, reject) => {
      deliverUpdate = resolve;
      options?.signal?.addEventListener('abort', () => reject(new Error()));
    });
  });
  await render(<TeacherPortal credential="測試" path="/teacher/classrooms/room/console"
    navigate={vi.fn()} logout={vi.fn()} openProjection={vi.fn()} />);
  await click('結算');
  await click('開始新活動');
  const { act } = await import('react');
  await act(async () => deliverUpdate(Response.json({ ...snapshot, phase: 'active', roundId: 'r', version: 2 })));
  expect(host.textContent).not.toContain('回填與匯出');
  expect(host.querySelector('[aria-labelledby="activity-title"]')).toBeNull();
  expect(host.textContent).toContain('請先到控制台結束搶答');
});

it('Google 回填中不能換場，拒絕編輯後提示權限並保留結算', async () => {
  let finish!: (response: Response) => void;
  const logout = vi.fn();
  const initial = { id: 'room', classroomId: 'room', activityId: 'a', activityEpoch: 'e', name: '甲教室', phase: 'idle', updatedAt: 0 };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
    if (path === '/api/classrooms/room') return Response.json(initial);
    if (path === '/api/roster') return Response.json({ groups: [], locked: false, rosterVersion: 0 });
    if (path === '/api/view') return Response.json({ phase: 'idle', roundId: null, unit: null, closedRoundIds: ['r'], version: 1,
      worksheetPreview: { source: { kind: 'google', documentId: '測試文件', sheetId: 0, sheetTitle: '測試工作表', importedAt: 1 }, units: [] } });
    if (path === '/api/classrooms/room/results') return Response.json([]);
    if (path === '/api/worksheet/writeback') return new Promise(resolve => { finish = resolve; });
    return new Promise((_, reject) => options?.signal?.addEventListener('abort', () => reject(new Error())));
  });
  await render(<TeacherPortal credential="測試" path="/teacher/classrooms/room/console"
    navigate={vi.fn()} logout={logout} openProjection={vi.fn()} />);
  await click('結算');
  await click('將勝組答案回填原稿');
  expect([...host.querySelectorAll('button')].find(button => button.textContent === '開始新活動')?.disabled).toBe(true);
  const { act } = await import('react');
  await act(async () => finish(Response.json({
    code: 'NO_EDIT_PERMISSION', message: '服務帳戶沒有編輯此工作表的權限。',
  }, { status: 403 })));
  expect(host.textContent).toContain('服務帳戶沒有編輯此工作表的權限');
  expect(logout).not.toHaveBeenCalled();
});

it('回填請求跨結算檢視維持互斥，離開教室後忽略遲到的認證錯誤', async () => {
  const { act } = await import('react');
  const logout = vi.fn();
  const replies: Array<(response: Response) => void> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const path = String(input);
    if (/^\/api\/classrooms\/(room|other)$/.test(path)) {
      const id = path.split('/').at(-1)!;
      return Response.json({ id, classroomId: id, activityId: id + '-a', activityEpoch: 'e',
        name: id === 'room' ? '甲教室' : '乙教室', phase: 'idle', updatedAt: 0 });
    }
    if (path === '/api/roster') return Response.json({ groups: [], locked: false, rosterVersion: 0 });
    if (path === '/api/view') return Response.json({
      phase: 'idle', roundId: null, unit: null, closedRoundIds: ['r'], version: 1,
      worksheetPreview: { source: { kind: 'google', documentId: '測試文件', sheetId: 0, sheetTitle: '測試工作表', importedAt: 1 }, units: [] },
    });
    if (path.endsWith('/results')) return Response.json([]);
    if (path === '/api/worksheet/writeback') return new Promise(resolve => replies.push(resolve));
    return new Promise((_, reject) => options?.signal?.addEventListener('abort', () => reject(new Error())));
  });
  const show = (id: string) => render(<TeacherPortal credential="測試" path={`/teacher/classrooms/${id}/console`}
    navigate={vi.fn()} logout={logout} openProjection={vi.fn()} />);
  const button = (name: string) => [...host.querySelectorAll('button')].find(node => node.textContent === name)!;
  await show('room');
  await click('結算');
  await click('將勝組答案回填原稿');
  await click('返回主持');
  await click('結算');
  expect(button('將勝組答案回填原稿').disabled).toBe(true);
  expect(button('開始新活動').disabled).toBe(true);
  await click('將勝組答案回填原稿');
  expect(replies).toHaveLength(1);
  await act(async () => replies[0](Response.json({ written: ['1'], alreadyMatched: [], noWinner: [] })));
  expect(host.textContent).toContain('回填完成');
  expect(button('開始新活動').disabled).toBe(false);
  await click('將勝組答案回填原稿');
  await show('other');
  await act(async () => replies[1](Response.json({ code: 'UNAUTHORIZED' }, { status: 401 })));
  expect(logout).not.toHaveBeenCalled();
  expect(host.textContent).toContain('乙教室');
});
