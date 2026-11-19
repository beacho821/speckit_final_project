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
        data: { type: 'classroom-projection', roomId: 'room', view: snapshot } }));
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

it('全班投影即使仍有教師心跳，逾時時清除快照並停止輪詢', async () => {
  const { act } = await import('react');
  const { vi } = await import('vitest');
  const { useOpenProjection } = await import('../../frontend/src/Projection');
  const { click } = await import('../helpers/ui');
  const room = { id: 'r', classroomId: 'r', activityId: 'a', activityEpoch: 'e', name: '測試教室', phase: 'idle' as const, updatedAt: 0 };
  const snapshot = { classroomName: room.name, phase: 'idle', questions: [], groups: [], version: 1 };
  const postMessage = vi.fn();
  vi.spyOn(window, 'open').mockReturnValue({ closed: false, postMessage } as unknown as Window);
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(snapshot)).mockImplementation(() => new Promise(() => {}));
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
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'classroom-projection', roomId: 'r', view: snapshot }, location.origin);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'classroom-projection', roomId: 'r', view: null }, location.origin);
    const messages = postMessage.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(1_400));
    expect(postMessage).toHaveBeenCalledTimes(messages);
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});
