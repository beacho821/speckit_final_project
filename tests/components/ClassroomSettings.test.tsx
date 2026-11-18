// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import TeacherPortal from '../../frontend/src/TeacherWorkspace';
import { render, flush, host } from '../helpers/ui';

it('教室管理的兩個分組入口指向同一教室，導覽反映當前頁', async () => {
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
  expect(groups.map(a => a.pathname)).toEqual(['/teacher/classrooms/room/groups', '/teacher/classrooms/room/groups']);
  await render(<TeacherPortal {...props} path="/teacher/classrooms/room/groups" />);
  expect(host.querySelector('nav a[aria-current="page"]')?.textContent).toBe('分組管理');
  expect(host.textContent).toContain('組別名單');
});

it.each([
  ['active', '請先到控制台結束搶答，再審核並定案。'],
  ['reviewing', '請先到控制台完成審核與定案。'],
  ['ended', undefined],
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
  await render(<TeacherPortal credential="測試密碼" path="/teacher/classrooms/room" {...{ navigate }} logout={vi.fn()} openProjection={vi.fn()} />);
  await flush();
  const button = [...host.querySelectorAll('button')].find(node => node.textContent === '開始新活動')!;
  expect(button.disabled).toBe(Boolean(hint));
  expect(host.querySelector('#start-activity-hint')?.textContent).toBe(hint);
  expect([...host.querySelectorAll('a')].find(node => node.textContent === '前往控制台')?.pathname).toBe('/teacher/classrooms/room/console');
});
