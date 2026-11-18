// @vitest-environment jsdom
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import type { ActivityView, RoundQuestion } from '../../shared/api';
import TeacherRound from '../../frontend/src/TeacherRound';
import { render, host, click } from '../helpers/ui';

it('同分頁切換控制台時，共用草稿會阻止開放，儲存後可以開放', async () => {
  const question: RoundQuestion = {
    questionKey: 'q', unitId: 'u', questionId: '1', origin: 'manual',
    questionRevision: 1, acceptedAnswers: ['答案'], prompt: '原題', missingPrompt: false,
  };
  const view: ActivityView = { phase: 'preparing', roundId: 'r', unit: { id: 'u', questionIds: ['1'] }, closedRoundIds: [], version: 1,
    editableQuestions: [question], groups: [{ id: 'g', name: '甲組', received: false }] };
  const session = { role: 'teacher' as const, activityId: 'a' };
  const actions = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));
  const workspace = (mode: 'settings' | 'console') => <TeacherRound session={session} credential="測試" view={view} mode={mode} />;
  await render(workspace('settings'));
  const prompt = host.querySelector<HTMLTextAreaElement>('fieldset.question-editor textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(prompt, '新題');
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await render(workspace('console'));
  expect(host.textContent).toContain('請先儲存題目修改');
  await click('開放搶答');
  expect(actions).not.toHaveBeenCalled();
  await render(workspace('settings'));
  await click('儲存第 1 題');
  await render(workspace('console'));
  await click('開放搶答');
  expect(actions.mock.calls.map(([path]) => path)).toEqual(['/api/questions/q', '/api/rounds/r/start']);
});

it('切換教室後忽略原教室的遲到撤權', async () => {
  let answer!: (response: Response) => void;
  const expired = vi.fn();
  const requests = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(resolve => { answer = resolve; }));
  const view: ActivityView = { phase: 'active', roundId: 'r', unit: { id: 'u', questionIds: ['1'] },
    closedRoundIds: [], version: 1, groups: [] };
  const workspace = (activityId: string) => <TeacherRound session={{ role: 'teacher', activityId }} credential="測試" view={view} mode="console" onExpired={expired} />;
  await render(workspace('原教室'));
  await click('結束搶答');
  await render(workspace('新教室'));
  expect(requests.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await act(async () => answer(Response.json({ code: 'ACTIVITY_EXPIRED' }, { status: 409 })));
  expect(expired).not.toHaveBeenCalled();
});
