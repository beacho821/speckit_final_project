// @vitest-environment jsdom
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import TeacherRound from '../../frontend/src/TeacherRound';
import type { ActivityView } from '../../shared/api';
import { click, host, render } from '../helpers/ui';

const session = { role: 'teacher' as const, activityId: 'a' };
const question = { questionKey: 'q', unitId: 'u', questionId: '1', origin: 'worksheet' as const,
  prompt: '請說明裝置的用途。', missingPrompt: false, acceptedAnswers: ['甲', '乙'], questionRevision: 1 };
const alternate = { ...question, questionKey: 'q2', unitId: 'v', prompt: '另一題' };
const view: ActivityView = {
  phase: 'idle', roundId: null, unit: null, closedRoundIds: [], version: 1, catalogRevision: 1,
  questionCards: [{ id: 'u', name: '第一張', questions: [question], opened: false },
    { id: 'v', name: '第二張', questions: [alternate], opened: false }],
  queueUnitIds: ['u', 'v'], nextUnitId: 'u', groups: [{ id: 'g', name: '甲', received: false }],
};
const show = (current: ActivityView, blocked = false) =>
  render(<TeacherRound session={session} credential="test" view={current} blocked={blocked} />);

it('學習單只能由老師選入，等待同步時無法加入或開題', async () => {
  await show({ ...view, queueUnitIds: [], nextUnitId: null });
  expect(host.querySelector('[data-queue-id]')).toBeNull();
  expect(host.textContent).toContain('清單還沒有題目');
  await show(view, true);
  expect([...host.querySelectorAll('button')].find(b => b.textContent === '開放搶答')?.disabled).toBe(true);
});

it('老師可以在題卡直接編修改題幹及標準答案', async () => {
  await show({ ...view, questionCards: view.questionCards!.slice(0, 1), queueUnitIds: ['u'] });
  expect(host.textContent).toContain(question.prompt);
  await click('編修題目');
  const field = [...host.querySelectorAll('textarea')].find(field => field.value === '甲\n乙');
  expect(field?.labels?.[0]?.textContent).toContain('標準答案');
});

it('跨分頁換來源後仍可看見失效草稿，新題可以獨立開題', async () => {
  await show(view);
  await click('編修題目');
  const field = host.querySelector<HTMLTextAreaElement>('fieldset.question-editor textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, '舊題未存題幹');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const start = () => [...host.querySelectorAll('button')].find(b => b.textContent === '開放搶答');
  expect(start()?.disabled).toBe(true);
  await show({ ...view, questionCards: view.questionCards!.slice(1), queueUnitIds: ['v'], nextUnitId: 'v', catalogRevision: 2 });
  expect(host.textContent).toContain('已失效的草稿');
  expect(host.textContent).toContain('舊題未存題幹');
  expect(start()?.disabled).toBe(false);
});

it('上移和下移提交完整的待開放學習單順序', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));
  await show(view);
  const second = host.querySelector('[data-queue-id="v"]')!;
  await act(async () => second.querySelector<HTMLButtonElement>('[data-move="up"]')!.click());
  expect(fetch.mock.calls[0][0]).toBe('/api/question-queue');
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ worksheetUnitIds: ['v', 'u'], catalogRevision: 1 });
});

it('刪除確認不會用新版的版本刪除同識別的新題', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));
  await show(view);
  await click('刪除題目');
  const updated = { ...view, catalogRevision: 2, questionCards: view.questionCards!.map(card =>
    ({ ...card, questions: card.questions.map(item => ({ ...item, questionKey: item.questionKey + '-新' })) })) };
  await show(updated);
  expect(host.querySelector<HTMLDialogElement>('dialog[aria-labelledby=delete-question-title]')?.open).toBe(false);
  expect(host.textContent).toContain('題目清單已更新');
  expect(fetch).not.toHaveBeenCalled();
  await click('刪除題目');
  await click('確認刪除');
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ catalogRevision: 2 });
});

it('拖曳期間收到新版清單時取消拖曳，不會提交舊順序', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));
  await show(view);
  const handle = host.querySelector<HTMLElement>('[data-queue-id="u"] .drag-handle')!;
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  handle.hasPointerCapture = () => true;
  const pointer = (type: string) => Object.assign(new MouseEvent(type, { bubbles: true, button: 0 }), { pointerId: 1, isPrimary: true });
  await act(async () => { handle.dispatchEvent(pointer('pointerdown')); });
  expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
  await show({ ...view, catalogRevision: 2, queueUnitIds: ['v', 'u'], nextUnitId: 'v' });
  expect(host.textContent).toContain('題目清單已更新');
  await act(async () => { handle.dispatchEvent(pointer('pointerup')); });
  expect(fetch).not.toHaveBeenCalled();
  const row = host.querySelector('[data-queue-id="u"]')!;
  await act(async () => { row.querySelector<HTMLButtonElement>('[data-move=up]')!.click(); });
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ worksheetUnitIds: ['u', 'v'], catalogRevision: 2 });
});

it.each([true, false])('題卡回應遺失，依本次完整同步核對是否已存（相符：%s）', async matches => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError());
  const refresh = vi.fn(() => 2);
  const show = (current: ActivityView, completedRefresh: number) =>
    render(<TeacherRound session={session} credential="測試" view={current} {...{ refresh, completedRefresh }} />);
  await show(view, 1);
  await click('編修題目');
  const field = host.querySelector<HTMLTextAreaElement>('fieldset.question-editor textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, '送出的題幹');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('儲存修改');
  expect(host.textContent).toContain('待確認');
  const questions = [{ ...question, prompt: matches ? '送出的題幹' : '其他內容', questionRevision: 2 }];
  await show({ ...view, catalogRevision: 2, questionCards: [{ ...view.questionCards![0], questions }, view.questionCards![1]] }, 2);
  expect(Boolean(host.querySelector('fieldset.question-editor textarea'))).toBe(!matches);
  expect(host.textContent).toContain(matches ? '送出的題幹' : '請核對');
  expect(fetch).toHaveBeenCalledOnce();
});

it('拖曳預覽與放開共用落點，取消不提交排序', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));
  await show(view);
  const handle = host.querySelector<HTMLElement>('[data-queue-id="u"] .drag-handle')!;
  const row = host.querySelector<HTMLElement>('[data-queue-id="v"]')!;
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  handle.hasPointerCapture = () => true;
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 30, 50, 50));
  const hit = vi.fn(() => row);
  const previous = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  Object.defineProperty(document, 'elementFromPoint', { value: hit, configurable: true });
  const dispatch = (type: string) => act(async () => {
    handle.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientY: 70 }), { pointerId: 1, isPrimary: true }));
  });
  try {
    await dispatch('pointerdown');
    await dispatch('pointermove');
    expect(row.classList.contains('queue-insert-after')).toBe(true);
    expect(host.querySelector('.queue-preview')?.textContent).toContain(question.prompt);
    await dispatch('pointercancel');
    expect(host.querySelector('.queue-preview')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await dispatch('pointerdown');
    await dispatch('pointerup');
    expect(JSON.parse(String(fetch.mock.lastCall?.[1]?.body))).toEqual({ worksheetUnitIds: ['v', 'u'], catalogRevision: 1 });
  } finally {
    if (previous) Object.defineProperty(document, 'elementFromPoint', previous);
    else Reflect.deleteProperty(document, 'elementFromPoint');
  }
});

const reviewSession = { ...session, classroomId: 'c', activityEpoch: 'e' };
const reviewSnapshot: ActivityView = {
  phase: 'reviewing', roundId: 'r', closedRoundIds: [], version: 11,
  unit: { id: 'u', questionIds: ['q'], questions: [{ questionId: 'q', prompt: '測試題幹', missingPrompt: false }] },
  groups: [{ id: 'g', name: '甲組', received: true, answers: [{ questionId: 'q', text: '原文', correct: true }] }],
  review: { reviewRevision: 0, supplements: [], missingSupplementQuestionIds: [],
    supplementCandidates: [{ questionId: 'q', text: '標準答案', source: 'configured' }] },
};
const closedSnapshot: ActivityView = { ...reviewSnapshot, phase: 'idle', roundId: null, unit: null, closedRoundIds: ['r'], review: undefined, version: 12 };

function showReview(current: ActivityView, refresh: () => number, completedRefresh = 0,
  mode: 'console' | 'settings' = 'console', scope = reviewSession) {
  return render(<TeacherRound session={scope} credential="test" view={current} {...{ mode, refresh, completedRefresh }} />);
}
const operationArea = () => host.querySelector('.review-actions');

it('定案進度就地顯示，結果與焦點跨越審核快照結束', async () => {
  let finish!: (result: Response) => void;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(input => String(input).endsWith('/publish')
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(Response.json([])));
  const refresh = vi.fn(() => 1);
  await showReview(reviewSnapshot, refresh);
  const region = operationArea();
  await click('確認定案');
  expect(region?.textContent).toContain('定案中');
  await click('確認定案');
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/publish'))).toHaveLength(1);
  await act(async () => finish(Response.json({ id: 'r', phase: 'ended', winnerGroupId: 'g' })));
  await showReview(closedSnapshot, refresh, 1);
  expect(operationArea()).toBe(region);
  expect(region?.textContent).toContain('勝組：甲組');
  expect(document.activeElement?.textContent).toContain('已定案');
  await showReview({ ...reviewSnapshot, roundId: 'next', closedRoundIds: ['r'] }, refresh, 1);
  expect(operationArea()?.textContent).not.toContain('勝組：甲組');
});

it.each([true, false])('定案回應遺失後只核對同回合結果（已封存：%s）', async published => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
    if (String(input).endsWith('/publish')) return Promise.reject(new TypeError());
    if (input === '/api/rounds/r/results') return Promise.resolve(Response.json([{ winnerGroupId: null, groups: [] }]));
    return Promise.resolve(Response.json([]));
  });
  const refresh = vi.fn(() => 1);
  await showReview(reviewSnapshot, refresh);
  await click('確認定案');
  expect(operationArea()?.textContent).toContain('結果待確認');
  await showReview(reviewSnapshot, refresh, 0);
  await click('確認定案');
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/publish'))).toHaveLength(1);
  await showReview(published ? closedSnapshot : reviewSnapshot, refresh, 1);
  if (published) {
    expect(operationArea()?.textContent).toContain('已定案。無勝組');
    expect(fetch.mock.calls.some(([url]) => url === '/api/rounds/r/results')).toBe(true);
  } else {
    expect(operationArea()?.textContent).toContain('仍在待審核');
    expect([...host.querySelectorAll('button')].find(b => b.textContent === '確認定案')?.disabled).toBe(false);
  }
});

it('定案明確遭拒時就地說明，不顯示成功', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(input => Promise.resolve(String(input).endsWith('/publish')
    ? Response.json({ code: 'REVIEW_REVISION_CHANGED', message: '判分內容已更新，請核對最新版本後再操作。' }, { status: 409 }) : Response.json([])));
  await showReview(reviewSnapshot, vi.fn(() => 1));
  await click('確認定案');
  expect(operationArea()?.querySelector('[role=alert]')?.textContent).toBe('判分內容已更新，請核對最新版本後再操作。');
  expect(operationArea()?.textContent).not.toContain('已定案');
});

it('儲存回應遺失時僅版本增加不算成功，保留未反映的草稿', async () => {
  const refresh = vi.fn(() => 2);
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(input => String(input).endsWith('/review')
    ? Promise.reject(new TypeError()) : Promise.resolve(Response.json([])));
  await showReview(reviewSnapshot, refresh);
  await click('錯誤');
  await click('儲存判分');
  expect(operationArea()?.textContent).toContain('結果待確認');
  await showReview({ ...reviewSnapshot, review: { ...reviewSnapshot.review!, reviewRevision: 1 } }, refresh, 2);
  expect(operationArea()?.textContent).toContain('尚未反映此次儲存');
  expect(host.querySelector('.review-grade button')?.getAttribute('aria-pressed')).toBe('true');
  expect(operationArea()?.textContent).toContain('修改尚未儲存');
  expect(operationArea()?.textContent).toContain('請逐筆核對');
  const save = () => [...host.querySelectorAll('button')].find(button => button.textContent === '儲存判分')!;
  expect(save().disabled).toBe(true);
  await click('保留草稿');
  expect(save().disabled).toBe(false);
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/review'))).toHaveLength(1);
});

it('儲存遭拒會保留改判，仍可核對並重試', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(input => Promise.resolve(String(input).endsWith('/review')
    ? Response.json({ code: 'INVALID_GRADE', message: '請重新核對改判項目。' }, { status: 422 }) : Response.json([])));
  await showReview(reviewSnapshot, vi.fn());
  await click('錯誤');
  await click('儲存判分');
  expect(operationArea()?.querySelector('[role=alert]')?.textContent).toBe('請重新核對改判項目。');
  expect(host.querySelector('.review-grade [aria-pressed=true]')?.textContent).toBe('錯誤');
  expect([...host.querySelectorAll('button')].find(button => button.textContent === '確認定案')?.disabled).toBe(true);
});

it('過期改判與新版同值時也須核對，核對後的草稿不會隨後續改判重現', async () => {
  const refresh = vi.fn(() => 1);
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(input => Promise.resolve(String(input).endsWith('/review')
    ? Response.json({ code: 'REVIEW_REVISION_CHANGED', message: '判分內容已更新，請核對最新版本後再操作。' }, { status: 409 }) : Response.json([])));
  const find = (label: string) => [...host.querySelectorAll('button')].find(button => button.textContent === label)!;
  await showReview(reviewSnapshot, refresh);
  await click('錯誤');
  await click('儲存判分');
  await showReview({
    ...reviewSnapshot,
    review: { ...reviewSnapshot.review!, reviewRevision: 1 },
    groups: [{ ...reviewSnapshot.groups![0], answers: [{ questionId: 'q', text: '原文', correct: false }] }],
  }, refresh, 1);
  expect(operationArea()?.textContent).toContain('目前草稿：錯誤');
  expect(operationArea()?.textContent).toContain('最新已存值：錯誤');
  expect(find('確認定案').disabled).toBe(true);
  expect(find('儲存判分').disabled).toBe(true);
  await click('保留草稿');
  expect(find('確認定案').disabled).toBe(false);
  await showReview({ ...reviewSnapshot, review: { ...reviewSnapshot.review!, reviewRevision: 2 } }, refresh, 1);
  expect(host.querySelector('.review-grade [aria-pressed=true]')?.textContent).toBe('正確');
  expect(operationArea()?.textContent).not.toContain('尚未儲存');
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/review'))).toHaveLength(1);
});

it('定案回應遺失且下一份快照已開下一題時，仍就地讀回原回合結果', async () => {
  let finish!: (reason: Error) => void;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    if (input === '/api/rounds/r/publish') return new Promise((_, reject) => { finish = reject; });
    if (input === '/api/rounds/r/results') {
      expect(new Headers(init?.headers).get('X-Classroom-Id')).toBe('c');
      return Promise.resolve(Response.json([{ winnerGroupId: 'g', groups: [{ groupId: 'g', groupName: '甲組' }] }]));
    }
    return Promise.resolve(Response.json([]));
  });
  const refresh = vi.fn(() => 1);
  await showReview(reviewSnapshot, refresh);
  const region = operationArea();
  await click('確認定案');
  await showReview({ ...closedSnapshot, phase: 'active', roundId: 'next', unit: reviewSnapshot.unit }, refresh, 1);
  await act(async () => finish(new TypeError()));
  expect(operationArea()).toBe(region);
  expect(region?.textContent).toContain('已定案。勝組：甲組');
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/publish')).map(([url]) => url)).toEqual(['/api/rounds/r/publish']);
  expect(fetch.mock.calls.filter(([url]) => /^\/api\/rounds\/.+\/results$/.test(String(url))).map(([url]) => url)).toEqual(['/api/rounds/r/results']);
  expect([...host.querySelectorAll('button')].some(button => button.textContent === '結束搶答')).toBe(true);
});

it('切換功能頁後保留同回合的判分、資格草稿與新版核對，其他回合和活動各自獨立', async () => {
  const refresh = vi.fn(() => 1);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([]));
  const publishButton = () => [...operationArea()!.querySelectorAll('button')].find(button => button.textContent === '確認定案')!;
  const selectedGrade = () => host.querySelector('.review-grade [aria-pressed=true]')?.textContent;
  await showReview(reviewSnapshot, refresh);
  await click('錯誤');
  await click('甲組取消資格');
  expect(publishButton().disabled).toBe(true);
  await showReview(reviewSnapshot, refresh, 0, 'settings');
  expect(operationArea() && !operationArea()?.closest('[hidden]')).toBeFalsy();
  await showReview(reviewSnapshot, refresh);
  expect(selectedGrade()).toBe('錯誤');
  expect(host.textContent).toContain('本回合已取消資格');
  expect(host.querySelector('.review-supplements')?.textContent).toContain('標準答案');
  expect(publishButton().disabled).toBe(true);

  const newer = { ...reviewSnapshot, review: { ...reviewSnapshot.review!, reviewRevision: 1 } };
  await showReview(newer, refresh, 0, 'settings');
  await showReview(newer, refresh);
  expect(operationArea()?.querySelectorAll('.review-conflict')).toHaveLength(2);
  expect(publishButton().disabled).toBe(true);
  expect([...operationArea()!.querySelectorAll('button')].find(button => button.textContent === '儲存判分')?.disabled).toBe(true);
  await showReview({ ...newer, roundId: 'next', closedRoundIds: ['r'] }, refresh);
  expect(selectedGrade()).toBe('正確');
  expect(publishButton().disabled).toBe(false);
  await click('錯誤');
  await showReview({ ...newer, roundId: 'next' }, refresh, 0, 'console', { ...reviewSession, activityId: '另一活動' });
  expect(selectedGrade()).toBe('正確');
  expect(publishButton().disabled).toBe(false);
});

it('定案下一回合後，前一回合仍可完成讀回並在自己的操作區顯示結果', async () => {
  let finishFirstRead!: (result: Response) => void;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
    if (input === '/api/rounds/r/publish') return Promise.reject(new TypeError());
    if (input === '/api/rounds/r/results') return new Promise(resolve => { finishFirstRead = resolve; });
    if (input === '/api/rounds/next/publish') return Promise.resolve(Response.json({ id: 'next', phase: 'ended', winnerGroupId: null }));
    return Promise.resolve(Response.json([]));
  });
  const refresh = vi.fn(() => 1);
  await showReview(reviewSnapshot, refresh);
  await click('確認定案');
  const firstOperation = operationArea();
  await showReview({ ...reviewSnapshot, roundId: 'next', closedRoundIds: ['r'] }, refresh, 1);
  expect(firstOperation?.textContent).toContain('正在確認勝組');
  const secondOperation = host.querySelectorAll('.review-actions')[1];
  await click('確認定案');
  await showReview({ ...closedSnapshot, closedRoundIds: ['r', 'next'] }, refresh, 1);
  expect(secondOperation.textContent).toContain('已定案。無勝組');
  expect(firstOperation?.isConnected).toBe(true);
  await act(async () => finishFirstRead(Response.json([{ winnerGroupId: 'g', groups: [{ groupId: 'g', groupName: '甲組' }] }])));
  expect(firstOperation?.textContent).toContain('已定案。勝組：甲組');
  expect(secondOperation.textContent).toContain('已定案。無勝組');
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/publish')).map(([url]) => url))
    .toEqual(['/api/rounds/r/publish', '/api/rounds/next/publish']);
  expect(fetch.mock.calls.filter(([url]) => url === '/api/rounds/r/results')).toHaveLength(1);
  await click('關閉定案結果');
  expect(firstOperation?.isConnected).toBe(false);
  expect(secondOperation.isConnected).toBe(true);
});

it.each([
  { lateReply: '連線失敗', winner: 'g', expected: '勝組：甲組' },
  { lateReply: '版本衝突', winner: null, expected: '無勝組' },
])('結果讀取失敗後收到較晚的$lateReply，仍可在下一回合就地重試原結果', async ({ lateReply, winner, expected }) => {
  const publishPath = '/api/rounds/r/publish';
  const resultPath = '/api/rounds/r/results';
  let finishPublication!: () => void;
  let reads = 0;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (input === publishPath) {
      return new Promise((resolve, reject) => {
        finishPublication = () => {
          if (lateReply === '連線失敗') reject(new TypeError());
          else resolve(Response.json({ code: 'REVIEW_REVISION_CHANGED', message: '判分內容已更新。' }, { status: 409 }));
        };
      });
    }
    if (input === resultPath) {
      if (++reads === 1) return Response.json({ message: '暫時無法取得結果。' }, { status: 503 });
      return Response.json([{ winnerGroupId: winner, groups: [{ groupId: 'g', groupName: '甲組' }] }]);
    }
    return Response.json([]);
  });
  const refresh = vi.fn(() => 1);
  await showReview(reviewSnapshot, refresh);
  await click('確認定案');
  await showReview(closedSnapshot, refresh);
  const original = operationArea();
  const retry = () => [...original!.querySelectorAll('button')].find(button => button.textContent === '重新取得定案結果');
  expect(retry()).toBeDefined();

  await act(async () => finishPublication());
  expect(original?.querySelector('[role=alert]')?.textContent).toContain('請重新取得結果');
  expect(retry()).toBeDefined();
  await showReview({ ...closedSnapshot, phase: 'active', roundId: 'next', unit: reviewSnapshot.unit }, refresh, 1);
  expect(operationArea()).toBe(original);
  expect(retry()).toBeDefined();
  await click('重新取得定案結果');
  expect(original?.textContent).toContain(`已定案。${expected}`);
  expect(retry()).toBeUndefined();
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/publish')).map(([url]) => url)).toEqual([publishPath]);
  expect(fetch.mock.calls.filter(([url]) => /^\/api\/rounds\/.+\/results$/.test(String(url))).map(([url]) => url))
    .toEqual([resultPath, resultPath]);
});
