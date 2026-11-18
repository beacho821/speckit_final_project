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

async function mount(view: ActivityView = baseView) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<StudentRound session={session} credential="alpha" view={view} onExpired={() => undefined} />));
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
    await act(async()=>root!.render(<StudentRound session={session} credential="alpha" view={{...baseView,received:true,ownAnswers:[{questionId:'1（1）',text:'CPU'}]}}/>));
    expect(submitted).toBe(true); expect(host!.textContent).toContain('本組答案已收件'); expect(host!.querySelector('textarea')).toBeNull();
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

  it('曾勝組可先填答案，優先時段內拒收仍保留草稿與剩餘時間提示', async () => {
    const waitingView = { ...baseView, waitRemainingMs: 2999 };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ code: 'WAIT_REQUIRED', message: '本組尚須等待 2999 毫秒才能送出，答案草稿已保留。', details: { waitRemainingMs: 2999 } }, { status: 409 }));
    await mount(waitingView);
    expect(host!.textContent).toContain('本組有優先送出時段');
    const field = host!.querySelector('textarea')!;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!; setter.call(field, '等待期間先填好的原文'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    const submit = [...host!.querySelectorAll('button')].find(button => button.textContent?.includes('送出本組答案'))!;
    await act(async () => { submit.click(); await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(fetch).toHaveBeenCalledOnce();
    expect(host!.textContent).toContain('答案草稿已保留');
    expect(field.value).toBe('等待期間先填好的原文');
    expect(host!.textContent).not.toContain('本組答案已收件');
  });
});

it('送答回應遺失只重讀快照，不自動重送；另一畫面收件後停用修改',async()=>{const refresh=vi.fn(),fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new TypeError());await mount();await act(async()=>root!.render(<StudentRound session={session} credential="alpha" view={baseView} refresh={refresh}/>));const button=[...host!.querySelectorAll('button')].find(b=>b.textContent==='送出本組答案')!;await act(async()=>button.click());expect(host!.textContent).toContain('送出結果待確認');expect(refresh).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledOnce();await act(async()=>root!.render(<StudentRound session={session} credential="alpha" view={{...baseView,received:true,ownAnswers:[{questionId:'1（1）',text:'另一畫面的答案'}]}}/>));expect(host!.textContent).toContain('另一畫面的答案');expect(host!.querySelector('textarea')).toBeNull();expect(fetch).toHaveBeenCalledOnce();});

it('開題後在對應作答欄顯示完整題幹', async () => {
  await mount({...baseView, unit:{...baseView.unit!, questions:[{questionId:'1（1）', prompt:'請說明裝置的用途。', missingPrompt:false}]}});
  expect(host!.querySelector('textarea')?.labels?.[0]?.textContent).toContain('請說明裝置的用途。');
});

it('作答區保留題組名稱、每個小題的題號與完整題幹', async () => {
  const questions = [
    { questionId: '1（1）', prompt: '請用完整句子描述中央處理器的主要工作。', missingPrompt: false },
    { questionId: '1（2）', prompt: '請列出主記憶體與儲存裝置的差異，並各舉一個例子。', missingPrompt: false },
  ];
  await mount({ ...baseView, unit: { ...baseView.unit!, name: '電腦硬體', questions } });
  expect(host!.querySelector('h3')?.textContent).toBe('電腦硬體');
  expect([...host!.querySelectorAll('label')].map(label => label.textContent)).toEqual(
    questions.map(question => question.questionId + question.prompt),
  );
  await act(async () => root!.render(<StudentRound session={session} credential="alpha" view={{
    ...baseView, unit: { ...baseView.unit!, name: undefined, questions },
  }} />));
  expect(host!.querySelector('h3')?.textContent).toBe('1（1）、1（2）');
});
