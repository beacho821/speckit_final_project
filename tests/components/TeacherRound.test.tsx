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
  await click('刪除');
  const updated = { ...view, catalogRevision: 2, questionCards: view.questionCards!.map(card =>
    ({ ...card, questions: card.questions.map(item => ({ ...item, questionKey: item.questionKey + '-新' })) })) };
  await show(updated);
  expect(host.querySelector<HTMLDialogElement>('dialog[aria-labelledby=delete-question-title]')?.open).toBe(false);
  expect(host.textContent).toContain('題目清單已更新');
  expect(fetch).not.toHaveBeenCalled();
  await click('刪除');
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
