// @vitest-environment jsdom
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import RoundReview from '../../frontend/src/RoundReview';
import type { ActivityView } from '../../shared/api';
import type { ReviewAction } from '../../frontend/src/TeacherRound';
import { click, host, render } from '../helpers/ui';

const questions = [1, 2].map(partNumber => ({ questionId: `原${partNumber}`, questionNumber: 3, partNumber, prompt: '題幹', missingPrompt: false }));
const button = (label: string) => [...host.querySelectorAll('button')].find(item => item.textContent === label)!;
function group(secondCorrect: boolean): NonNullable<ActivityView['groups']> {
  return [{ id: 'g', name: '甲組', rank: 1, received: true, answers: questions.map(({ questionId }, i) => ({
    questionId, text: `甲組原文${i + 1}`, correct: i === 0 || secondCorrect, autoCorrect: i === 0,
  })) }];
}

const candidates = [
  { questionId: '原1', text: '舊人工原文', source: 'legacy' as const },
  { questionId: '原2', text: '第二題標準答案', source: 'configured' as const },
];
function review(revision = 0, supplementCandidates = candidates) {
  return { reviewRevision: revision, supplements: [], missingSupplementQuestionIds: [], supplementCandidates };
}

it('無人送答可直接定案，舊人工與自動補答為只讀', async () => {
  const action = vi.fn<ReviewAction>().mockResolvedValue({ kind: 'ok', data: { id: 'r', phase: 'ended', winnerGroupId: null } });
  await render(<RoundReview roundPath="/api/rounds/r" questions={questions} groups={[]}
    review={review()} disabled={false} action={action} classMode />);
  expect(host.textContent).toMatch(/老師補答[\s\S]*舊人工原文/);
  expect(host.textContent).toMatch(/自動補答[\s\S]*第二題標準答案/);
  expect(host.querySelector('textarea')).toBeNull();
  expect(button('儲存判分').disabled).toBe(true);
  await click('確認定案');
  expect(action).toHaveBeenCalledExactlyOnceWith('/api/rounds/r/publish', { reviewRevision: 0 }, 'POST', expect.any(AbortSignal));
});

it('只有欠答題有補答，無來源時僅提示', async () => {
  const action = vi.fn<ReviewAction>();
  await render(<RoundReview roundPath="/api/rounds/r" questions={questions} groups={group(false)}
    review={review()} disabled={false} action={action} classMode />);
  expect(host.textContent).not.toContain('舊人工原文');
  expect(host.textContent).toContain('第二題標準答案');
  await render(<RoundReview roundPath="/api/rounds/r" questions={questions} groups={group(false)}
    review={review(0, [])} disabled={false} action={action} classMode />);
  expect(host.textContent).toContain('沒有可引用的答案');
  expect(button('確認定案').disabled).toBe(false);
});

it('兩組四筆作答只改指定判分，補答依更正和資格即時更新', async () => {
  const [first] = group(false);
  const groups = [first, { ...first, id: 'h', name: '乙組', rank: 2, answers: first.answers!.map((answer, i) =>
    ({ ...answer, text: `乙組原文${i + 1}` })) },
  { id: 'empty', name: '未送答組', received: false }];
  const action = vi.fn<ReviewAction>().mockResolvedValue({ kind: 'ok', data: { reviewRevision: 1 } });
  await render(<RoundReview roundPath="/api/rounds/r" questions={questions} groups={groups}
    review={review()} disabled={false} action={action} classMode />);
  const answers = [...host.querySelectorAll<HTMLElement>('[role="group"]')];
  const pressed = () => answers.map(answer => answer.querySelector('[aria-pressed="true"]')?.textContent);
  const toggle = (value: '錯誤' | '正確') => act(async () => {
    [...answers[1].querySelectorAll('button')].find(item => item.textContent === value)!.click();
  });
  const supplement = () => host.querySelector('.review-supplements')?.textContent;
  expect(answers).toHaveLength(4);
  expect(answers.every(answer => answer.querySelectorAll('button').length === 2 && answer.querySelectorAll('[aria-pressed="true"]').length === 1)).toBe(true);
  expect(answers[1].getAttribute('aria-label')).toBe('甲組 · 第 3 題，第 2 部分');
  expect(host.querySelector('.review-group h3')?.textContent).toBe('甲組 · 第 1 順位');
  expect(pressed()).toEqual(['正確', '錯誤', '正確', '錯誤']);
  await toggle('錯誤');
  expect(button('儲存判分').disabled).toBe(true);
  expect(action).not.toHaveBeenCalled();
  await toggle('正確');
  expect(pressed()).toEqual(['正確', '正確', '正確', '錯誤']);
  expect(answers[1].textContent).toContain('甲組原文2');
  expect(answers[1].textContent).toContain('自動判分：答錯');
  expect(supplement()).toBeUndefined();
  expect(button('確認定案').disabled).toBe(true);
  await toggle('錯誤');
  expect(supplement()).toContain('第二題標準答案');
  expect(button('儲存判分').disabled).toBe(true);
  await click('甲組取消資格');
  await toggle('正確');
  expect(supplement()).toContain('第二題標準答案');
  await click('甲組恢復資格');
  expect(supplement()).toBeUndefined();
  await click('儲存判分');
  expect(action).toHaveBeenCalledExactlyOnceWith('/api/rounds/r/review', {
    reviewRevision: 0, grades: [{ groupId: 'g', questionId: '原2', correct: true }],
  }, 'PATCH', expect.any(AbortSignal));
});
