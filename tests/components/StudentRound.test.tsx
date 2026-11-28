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
  it('定案後只在答錯的小題下補上已公布答案，並保留原作答', async () => {
    await mount();
    const ownAnswers = [
      { questionId: '1（1）', text: '原本的錯答' },
      { questionId: '1（2）', text: '原本的對答' },
    ];
    const show = (view: ActivityView) => act(async () => root!.render(
      <StudentRound session={session} credential="alpha" view={view} />,
    ));
    await show({ ...baseView, phase: 'reviewing', received: true, ownAnswers });
    expect(host!.querySelector('.answer-feedback-reference')).toBeNull();
    await show({ ...baseView, phase: 'ended', received: true, ownAnswers: [
      { ...ownAnswers[0], correct: false, publishedAnswer: '已公布的答案' },
      { ...ownAnswers[1], correct: true },
    ] });
    expect(host!.querySelector('.answer-feedback-incorrect')?.textContent).toContain('原本的錯答');
    expect(host!.querySelector('.answer-feedback-reference')?.textContent).toBe('正確答案：已公布的答案');
    expect(host!.querySelector('.answer-feedback-correct')?.textContent).toContain('原本的對答');
    expect(host!.querySelector('.answer-feedback-correct .answer-feedback-reference')).toBeNull();
  });

  it('作答快照缺少正解時讀取已公布結果，讀取失敗可重試', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json([
        { questionNumber: 1, partNumber: 1, prompt: '第一部分', ownAnswer: '甲', correct: false, publishedAnswer: '第一個正解' },
        { questionNumber: 1, partNumber: 2, prompt: '第二部分', ownAnswer: '乙', correct: false, publishedAnswer: '第二個正解' },
      ]));
    await mount();
    const ownAnswers = [{ questionId: '1（2）', text: '乙' }, { questionId: '1（1）', text: '甲' }];
    await act(async () => root!.render(<StudentRound session={session} credential="alpha"
      view={{ ...baseView, phase: 'reviewing', received: true, ownAnswers }} />));
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => root!.render(<StudentRound session={session} credential="alpha"
      view={{ ...baseView, phase: 'ended', received: true, ownAnswers: ownAnswers.map(answer => ({ ...answer, correct: false })) }} />));
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/rounds/round-test/results', expect.objectContaining({
      headers: expect.objectContaining({ 'X-Activity-Id': 'activity-test' }),
    }));
    expect(host!.textContent).toContain('載入失敗');
    expect(host!.textContent).not.toContain('未提供');
    await act(async () => host!.querySelector<HTMLButtonElement>('.answer-feedback button')!.click());
    expect([...host!.querySelectorAll('.answer-feedback-reference')].map(row => row.textContent)).toEqual([
      '正確答案：第二個正解', '正確答案：第一個正解',
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('本組未送出時，保留停收題目並於公布後逐題顯示正解', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json([
        { questionNumber: 1, partNumber: 1, prompt: '第一部分題幹', ownAnswer: null, correct: null, publishedAnswer: '公布的正解' },
        { questionNumber: 1, partNumber: 2, prompt: '第二部分題幹', ownAnswer: null, correct: null, publishedAnswer: null },
      ]));
    const view = { ...baseView, unit: { ...baseView.unit!, questions: [
      { questionId: '1（1）', questionNumber: 1, partNumber: 1, prompt: '第一部分題幹', missingPrompt: false },
      { questionId: '1（2）', questionNumber: 1, partNumber: 2, prompt: '第二部分題幹', missingPrompt: false },
    ] } };
    await mount(view);
    const show = (nextView: ActivityView) => act(async () => root!.render(
      <StudentRound session={session} credential="alpha" view={nextView} />,
    ));
    await show({ ...view, phase: 'reviewing' });
    expect(host!.textContent).toContain('本組尚未送出答案');
    expect(host!.textContent).toContain('第一部分題幹');
    expect(host!.querySelector('textarea')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();

    await show({ ...view, phase: 'ended', closedRoundIds: ['round-test'] });
    expect(host!.querySelector('h2')?.textContent).toBe('本組未作答');
    expect(host!.textContent).toContain('第一部分題幹');
    expect(host!.querySelector('[role=alert]')?.textContent).toContain('無法載入正確答案');
    await act(async () => host!.querySelector<HTMLButtonElement>('[role=alert] button')!.click());
    const rows = [...host!.querySelectorAll('.unanswered-results li')];
    expect(rows.map(row => row.querySelector('h3')?.textContent)).toEqual(['第 1 題，第 1 部分', '第 1 題，第 2 部分']);
    expect(rows.map(row => row.querySelector('.unanswered-reference')?.textContent)).toEqual(['正確答案：公布的正解', '正確答案：未提供']);
    expect(host!.textContent).not.toContain('錯誤');
    expect(fetch).toHaveBeenCalledTimes(2);
    await show({ ...view, roundId: 'next-round' });
    expect(host!.textContent).not.toContain('公布的正解');
    expect(host!.querySelectorAll('textarea')).toHaveLength(2);
  });

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
      return Response.json({ code: 'INVALID_ANSWERS', message: '來源題號尚未填答，請補齊後一起送出。', details: { missingQuestionIds: ['1（2）'] } }, { status: 422 });
    });
    await mount({ ...baseView, unit: { ...baseView.unit!, questions: baseView.unit!.questionIds.map((questionId, index) => ({
      questionId, questionNumber: 3, partNumber: index + 1, prompt: '題幹', missingPrompt: false,
    })) } });
    const first = host!.querySelector('textarea')!;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!; setter.call(first, '保留的答案'); first.dispatchEvent(new Event('input', { bubbles: true })); });
    const submit = [...host!.querySelectorAll('button')].find(button => button.textContent?.includes('送出本組答案'))!;
    await act(async () => { submit.click(); await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(host!.textContent).toContain('第 3 題，第 2 部分尚未填答'); expect(first.value).toBe('保留的答案'); expect(host!.textContent).not.toContain('本組答案已收件');
  });

  it('等待時可編輯草稿，恢復分頁後按實際時間開放，拒收時校正等待', async () => {
    const time = vi.spyOn(performance, 'now').mockReturnValue(0);
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ code: 'WAIT_REQUIRED',
      message: '本組須等待。', details: { waitRemainingMs: 1000 },
    }, { status: 409 })).mockResolvedValueOnce(Response.json({ received: true }, { status: 201 }));
    await mount({ ...baseView, waitRemainingMs: 3000 });
    const submit = host!.querySelector('button')!;
    expect(host!.textContent).toContain('其他組別優先送出中');
    expect(submit.disabled).toBe(true);
    const field = host!.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, '  原文  ');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      submit.click();
    });
    expect(fetch).not.toHaveBeenCalled();
    time.mockReturnValue(2999);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(host!.textContent).toContain('還有 1 秒');
    time.mockReturnValue(3000);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => submit.click());
    expect(submit.disabled).toBe(true);
    expect(host!.textContent).toContain('答案草稿已保留');
    expect(field.value).toBe('  原文  ');
    time.mockReturnValue(4000);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => submit.click());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).answers[0].text).toBe('  原文  ');
  });

  it('倒數期間停止收件後，時間到也不會開放送出', async () => {
    const time = vi.spyOn(performance, 'now').mockReturnValue(0);
    const fetch = vi.spyOn(globalThis, 'fetch');
    await mount({ ...baseView, waitRemainingMs: 3000 });
    await act(async () => root!.render(<StudentRound session={session} credential="alpha" view={{ ...baseView, phase: 'reviewing' }} />));
    time.mockReturnValue(3000);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(host!.textContent).toContain('已停止收件');
    expect(host!.querySelector('button')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

it('送答回應遺失只重讀快照，不自動重送；另一畫面收件後停用修改',async()=>{const refresh=vi.fn(),fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new TypeError());await mount();await act(async()=>root!.render(<StudentRound session={session} credential="alpha" view={baseView} refresh={refresh}/>));const button=[...host!.querySelectorAll('button')].find(b=>b.textContent==='送出本組答案')!;await act(async()=>button.click());expect(host!.textContent).toContain('送出結果待確認');expect(refresh).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledOnce();await act(async()=>root!.render(<StudentRound session={session} credential="alpha" view={{...baseView,received:true,ownAnswers:[{questionId:'1（1）',text:'另一畫面的答案'}]}}/>));expect(host!.textContent).toContain('另一畫面的答案');expect(host!.querySelector('textarea')).toBeNull();expect(fetch).toHaveBeenCalledOnce();});

it('開題後在對應作答欄顯示完整題幹', async () => {
  await mount({...baseView, unit:{...baseView.unit!, questions:[{questionId:'1（1）', prompt:'請說明裝置的用途。', missingPrompt:false}]}});
  expect(host!.querySelector('textarea')?.labels?.[0]?.textContent).toContain('請說明裝置的用途。');
});

it('作答區用實際出題順序及部分序號顯示完整題幹', async () => {
  const questions = [
    { questionId: '1（1）', questionNumber: 2, partNumber: 1, prompt: '請用完整句子描述中央處理器的主要工作。', missingPrompt: false },
    { questionId: '1（2）', questionNumber: 2, partNumber: 2, prompt: '請列出主記憶體與儲存裝置的差異，並各舉一個例子。', missingPrompt: false },
  ];
  await mount({ ...baseView, unit: { ...baseView.unit!, name: '電腦硬體', questions } });
  expect([...host!.querySelectorAll('label')].map(label => label.textContent)).toEqual(
    questions.map(question => `第 2 題，第 ${question.partNumber} 部分` + question.prompt),
  );
  await act(async () => root!.render(<StudentRound session={session} credential="alpha" view={{
    ...baseView, unit: { ...baseView.unit!, name: undefined, questions },
  }} />));
  expect(host!.textContent).toContain('第 2 題，第 2 部分');
});

it('歷史載入的網路與解析錯誤以正體中文顯示，可重試並保留業務提示', async () => {
  const { StudentHistory } = await import('../../frontend/src/RoundHistory');
  const onExpired = vi.fn();
  const request = vi.spyOn(globalThis, 'fetch')
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(new Response('invalid JSON'))
    .mockResolvedValueOnce(Response.json([null]))
    .mockResolvedValueOnce(Response.json({ message: 'Bad gateway' }, { status: 502 }))
    .mockResolvedValueOnce(Response.json({ message: '目前尚未公布。' }, { status: 403 }))
    .mockResolvedValueOnce(Response.json([{ questionNumber: 1, partNumber: null, prompt: '題幹',
      ownAnswer: '回答', correct: true, publishedAnswer: null }]))
    .mockResolvedValueOnce(Response.json({ code: 'ACTIVITY_EXPIRED', message: '活動已結束。' }, { status: 409 }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const show = (snapshot: number) => act(async () => root!.render(
    <StudentHistory session={session} credential="測試" roundIds={['r']} snapshot={snapshot} onExpired={onExpired} />,
  ));
  const retry = () => act(async () => host!.querySelector<HTMLButtonElement>('[role=alert] button')!.click());
  await show(1);
  expect(host.textContent).toContain('歷史紀錄載入失敗');
  expect(host.textContent).not.toContain('Failed to fetch');
  for (let attempt = 0; attempt < 3; attempt++) {
    await retry();
    expect(host.textContent).toContain('歷史紀錄載入失敗');
    expect(host.textContent).not.toContain('Bad gateway');
  }
  await retry();
  expect(host.textContent).toContain('目前尚未公布。');
  await retry();
  expect(host.textContent).toContain('已回答：回答');
  expect(host.querySelector('[role=alert]')).toBeNull();
  await show(2);
  expect(request).toHaveBeenCalledTimes(7);
  expect(onExpired).toHaveBeenCalledOnce();
});

it('學生歷史用文字區分已公布的正誤、未作答及缺少判定', async () => {
  const { StudentHistory } = await import('../../frontend/src/RoundHistory');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([
    { questionNumber: 1, partNumber: 1, prompt: '第一部分', ownAnswer: '甲', correct: true, publishedAnswer: null },
    { questionNumber: 1, partNumber: 2, prompt: '第二部分', ownAnswer: '乙', correct: false, publishedAnswer: '丙' },
    { questionNumber: 2, partNumber: null, prompt: '未作答題', ownAnswer: null, correct: false, publishedAnswer: '丁' },
    { questionNumber: 3, partNumber: null, prompt: '舊題', ownAnswer: '戊', correct: null, publishedAnswer: null },
  ]));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<StudentHistory session={session} credential="測試" roundIds={['r']} />));
  const rows = host.querySelectorAll('article');
  expect(rows[0].querySelector('.outcome-correct')?.textContent).toBe('正確');
  expect(rows[1].querySelector('.outcome-incorrect')?.textContent).toBe('錯誤');
  expect(rows[1].textContent).toContain('正確答案：丙');
  expect(rows[2].textContent).toContain('未作答');
  expect(rows[2].querySelector('.outcome-incorrect')).toBeNull();
  expect(rows[3].textContent).toContain('正確答案：未提供');
  expect(rows[3].querySelector('.outcome-correct, .outcome-incorrect')).toBeNull();
});
