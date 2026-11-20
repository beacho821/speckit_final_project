// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { ProjectionDisplay } from '../../frontend/src/Projection';
import { render, host } from '../helpers/ui';

it('全班投影呈現公開的題目、組名與收件狀態', async () => {
  await render(<ProjectionDisplay view={{ classroomName: '測試教室', phase: 'active', title: '第一題',
    questions: [{ questionId: '1', prompt: '公開題幹', missingPrompt: false }],
    groups: [{ id: 'g', name: '甲組', received: true }], version: 1 }} />);
  expect(host.textContent).toContain('公開題幹');
  expect(host.textContent).toContain('已送出');
  expect(host.querySelector('button, input, nav')).toBeNull();
});

it('全班投影只接受原教師視窗及同源訊息，收到撤銷後清除畫面', async () => {
  const { act } = await import('react');
  const { ProjectionEntry } = await import('../../frontend/src/Projection');
  const priorPath = window.location.pathname;
  const oldOpener = window.opener;
  const frame = document.createElement('iframe');
  document.body.append(frame);
  try {
    window.opener = frame.contentWindow;
    window.history.replaceState(null, '', '/teacher/classrooms/room/projection');
    await render(<ProjectionEntry />);
    const view = { classroomName: '已授權教室', phase: 'idle', questions: [], groups: [], version: 0 };
    const message = (source: Window | null, origin: string, snapshot: typeof view | null) => act(async () => {
      window.dispatchEvent(new MessageEvent('message', { source, origin,
        data: { type: 'classroom-projection', roomId: 'room', state: snapshot ? { kind: 'live', view: snapshot } : { kind: 'unauthorized' } } }));
    });
    await message(window, location.origin, view);
    await message(frame.contentWindow, 'https://example.invalid', view);
    expect(host.textContent).not.toContain('已授權教室');
    await message(frame.contentWindow, location.origin, view);
    expect(host.textContent).toContain('已授權教室');
    await message(frame.contentWindow, location.origin, null);
    expect(host.textContent).not.toContain('已授權教室');
  } finally {
    window.opener = oldOpener;
    window.history.replaceState(null, '', priorPath);
    frame.remove();
  }
});

it('舊投影入口只顯示教師指引', async () => {
  const { ProjectionEntry } = await import('../../frontend/src/Projection');
  const priorPath = location.pathname;
  window.history.replaceState(null, '', '/projection');
  try {
    await render(<ProjectionEntry />);
    expect(host.textContent).toContain('從教室導覽');
    expect(host.querySelector('input, form')).toBeNull();
  } finally { window.history.replaceState(null, '', priorPath); }
});

it('全班投影即使仍有教師心跳，逾時後保留畫面並重新取得完整快照', async () => {
  const { act } = await import('react');
  const { vi } = await import('vitest');
  const { useOpenProjection } = await import('../../frontend/src/Projection');
  const { click } = await import('../helpers/ui');
  const room = { id: 'r', classroomId: 'r', activityId: 'a', activityEpoch: 'e', name: '測試教室', phase: 'idle' as const, updatedAt: 0 };
  const snapshot = { classroomName: room.name, phase: 'idle', questions: [], groups: [], version: 1 };
  const postMessage = vi.fn();
  vi.spyOn(window, 'open').mockReturnValue({ closed: false, postMessage } as unknown as Window);
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(snapshot)).mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(Response.json(snapshot)).mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetch);

  function Launcher() {
    const open = useOpenProjection('測試密碼', true);
    return <button onClick={() => open(room)}>開啟投影</button>;
  }
  vi.useFakeTimers();
  try {
    await render(<Launcher />);
    await click('開啟投影');
    await act(async () => vi.advanceTimersByTimeAsync(24_999));
    expect(postMessage.mock.calls.length).toBeGreaterThan(1);
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ state: { kind: 'live', view: snapshot } }), location.origin);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      state: { kind: 'reconnecting', view: snapshot, expiresAt: Date.now() + 10_000 },
    }), location.origin);
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(fetch.mock.calls[2][0]).toBe('/api/classrooms/r/projection');
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ state: { kind: 'live', view: snapshot } }), location.origin);
  } finally { vi.useRealTimers(); }
});

it('重連畫面在 10 秒邊界清除，重複訊息或重新整理讀取不延長期限', async () => {
  const { act } = await import('react');
  const { vi } = await import('vitest');
  const { ProjectionEntry } = await import('../../frontend/src/Projection');
  const priorPath = location.pathname;
  const oldOpener = window.opener;
  const frame = document.createElement('iframe');
  document.body.append(frame);
  vi.useFakeTimers();
  try {
    window.opener = frame.contentWindow;
    const sender = vi.spyOn(frame.contentWindow!, 'postMessage');
    history.replaceState(null, '', '/teacher/classrooms/room/projection');
    await render(<ProjectionEntry />);
    expect(host.textContent).toContain('正在連線');
    expect(sender).toHaveBeenCalledWith({ type: 'classroom-projection-ready', roomId: 'room' }, location.origin);
    const view = { classroomName: '保留的教室', phase: 'active', groups: [], questions: [], version: 1 };
    const state = { kind: 'reconnecting', view, expiresAt: Date.now() + 10_000 };
    const emit = (roomId: string, message: unknown) => act(async () => {
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: location.origin,
        data: { type: 'classroom-projection', roomId, state: message } }));
    });
    await emit('其他教室', state);
    await emit('room', { kind: 'live', view: {} });
    expect(host.textContent).toContain('正在連線');
    await emit('room', state);
    expect(host.textContent).toContain('重新連線中');
    await act(async () => vi.advanceTimersByTimeAsync(9_999));
    await emit('room', state);
    expect(host.textContent).toContain('保留的教室');
    await act(async () => vi.advanceTimersByTimeAsync(1));
    await emit('room', state);
    expect(host.textContent).not.toContain('保留的教室');
    expect(host.textContent).toContain('重新連線中');
    await emit('room', { kind: 'live', view });
    expect(host.textContent).toContain('保留的教室');
  } finally {
    await render(null);
    vi.useRealTimers();
    window.opener = oldOpener;
    history.replaceState(null, '', priorPath);
    frame.remove();
  }
});

it('瀏覽器恢復連線即取消沒回應的輪詢，以完整快照恢復原投影', async () => {
  const { act } = await import('react');
  const { vi } = await import('vitest');
  const { useOpenProjection } = await import('../../frontend/src/Projection');
  const { click } = await import('../helpers/ui');
  const room = { id: 'r', classroomId: 'r', activityId: 'a', activityEpoch: 'e', name: '教室', phase: 'idle' as const, updatedAt: 0 };
  const snapshot = { classroomName: room.name, phase: 'idle', questions: [], groups: [], version: 1 };
  const postMessage = vi.fn();
  vi.spyOn(window, 'open').mockReturnValue({ closed: false, postMessage } as unknown as Window);
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(snapshot))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetch);
  function Launcher() {
    const open = useOpenProjection('測試密碼', true);
    return <button onClick={() => open(room)}>開啟投影</button>;
  }
  vi.useFakeTimers();
  try {
    await render(<Launcher />);
    await click('開啟投影');
    expect(fetch.mock.calls[2][0]).toContain('?after=1');
    await act(async () => window.dispatchEvent(new Event('offline')));
    expect(fetch.mock.calls[2][1].signal.aborted).toBe(true);
    expect(postMessage.mock.lastCall?.[0].state.kind).toBe('reconnecting');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      fetch.mockResolvedValueOnce(Response.json(snapshot));
      window.dispatchEvent(new Event('online'));
    });
    expect(fetch.mock.calls[3][0]).toBe('/api/classrooms/r/projection');
    expect(fetch.mock.calls[3][1].signal.aborted).toBe(true);
    expect(fetch.mock.calls[4][0]).toBe('/api/classrooms/r/projection');
    expect(postMessage.mock.lastCall?.[0].state).toEqual({ kind: 'live', view: snapshot });
    await render(null);
    expect(postMessage.mock.lastCall?.[0].state).toEqual({ kind: 'unauthorized' });
  } finally { await render(null); vi.useRealTimers(); }
});

it('已顯示投影後試探安靜的來源，短暫失聯可恢復，無回應則清除', async () => {
  const { act } = await import('react');
  const { vi } = await import('vitest');
  const { ProjectionEntry } = await import('../../frontend/src/Projection');
  const priorPath = location.pathname;
  const oldOpener = window.opener;
  const frame = document.createElement('iframe');
  document.body.append(frame);
  vi.useFakeTimers();
  try {
    window.opener = frame.contentWindow;
    const probe = vi.spyOn(frame.contentWindow!, 'postMessage');
    history.replaceState(null, '', '/teacher/classrooms/room/projection');
    await render(<ProjectionEntry />);
    const view = { classroomName: '失聯測試教室', phase: 'active', groups: [], questions: [], version: 1 };
    const emit = (state: unknown) => act(async () => {
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: location.origin,
        data: { type: 'classroom-projection', roomId: 'room', state } }));
    });
    const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    await emit({ kind: 'live', view });
    await advance(5000);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain(view.classroomName);
    await emit({ kind: 'live', view });
    await advance(9999);
    expect(host.textContent).toContain(view.classroomName);
    await advance(1);
    expect(host.textContent).not.toContain(view.classroomName);
    expect(host.textContent).toContain('從教室導覽重新選擇');
    await emit({ kind: 'live', view });
    expect(host.textContent).toContain(view.classroomName);
    await emit({ kind: 'unauthorized' });
    await emit({ kind: 'live', view });
    expect(host.textContent).not.toContain(view.classroomName);
    expect(host.textContent).toContain('請登入教師端');
  } finally {
    await render(null);
    vi.useRealTimers();
    window.opener = oldOpener;
    history.replaceState(null, '', priorPath);
    frame.remove();
  }
});
