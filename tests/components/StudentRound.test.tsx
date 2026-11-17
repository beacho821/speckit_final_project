// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityView, SessionResponse } from '../../shared/api.js';
import StudentRound from '../../frontend/src/StudentRound.js';

const session: SessionResponse = { activityId: 'activity-test', role: 'student', groupId: 'a' };
const baseView: ActivityView = { phase: 'active', roundId: 'round-test', unit: { id: 'u', name: '題組', questionIds: ['1（1）', '1（2）'], fillBlankIds: [] }, closedRoundIds: [], groupId: 'a', received: false, waitRemainingMs: 0, version: 1 };
let root: Root | undefined; let host: HTMLDivElement | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; host?.remove(); host = undefined; vi.restoreAllMocks(); });

async function mount() {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<StudentRound session={session} credential="alpha" onExpired={() => undefined} />));
  for (let count = 0; count < 30 && !host.querySelector('textarea'); count += 1) await new Promise(resolve => setTimeout(resolve, 10));
}

describe('學生作答互動', () => {
  it('完整題組送出後顯示收件確認', async () => {
    let submitted = false, delivered = false, resumePoll: (() => void) | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith('/api/view')) {
        if (!url.includes('after=')) return Response.json(baseView);
        if (submitted && !delivered) { delivered = true; return Response.json({ ...baseView, received: true, ownAnswers: [{ questionId: '1（1）', text: 'CPU' }, { questionId: '1（2）', text: '中央處理器' }], version: 2 }); }
        await new Promise<void>(resolve => { resumePoll = resolve; init?.signal?.addEventListener('abort', resolve, { once: true }); });
        return new Response(null, { status: 204 });
      }
      submitted = true; resumePoll?.();
      return Response.json({ roundId: 'round-test', received: true }, { status: 201 });
    });
    await mount();
    const fields = host!.querySelectorAll('textarea');
    await act(async () => {
      for (const [index, field] of [...fields].entries()) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
        setter.call(field, index === 0 ? 'CPU' : '中央處理器'); field.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    const submit = [...host!.querySelectorAll('button')].find(button => button.textContent?.includes('送出本組答案'))!;
    await act(async () => { submit.click(); await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(host!.textContent).toContain('本組答案已收件');
  });
  it('缺答時指出題號並保留已填草稿，不顯示收件成功', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).startsWith('/api/view')) {
        if (!String(input).includes('after=')) return Response.json(baseView);
        await new Promise<void>(resolve => init?.signal?.addEventListener('abort', resolve, { once: true }));
        throw new DOMException('已取消', 'AbortError');
      }
      return Response.json({ code: 'INVALID_ANSWERS', message: '1（2）尚未填答，請補齊後一起送出。' }, { status: 422 });
    });
    await mount();
    const first = host!.querySelector('textarea')!;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!; setter.call(first, '保留的答案'); first.dispatchEvent(new Event('input', { bubbles: true })); });
    const submit = [...host!.querySelectorAll('button')].find(button => button.textContent?.includes('送出本組答案'))!;
    await act(async () => { submit.click(); await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(host!.textContent).toContain('1（2）尚未填答'); expect(first.value).toBe('保留的答案'); expect(host!.textContent).not.toContain('本組答案已收件');
  });
});
