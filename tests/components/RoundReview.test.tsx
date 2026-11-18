// @vitest-environment jsdom
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import RoundReview from '../../frontend/src/RoundReview';
import type { ActivityView } from '../../shared/api';
import { host, render } from '../helpers/ui';

it('老師雙向改判更新補答欄，並保留同回合過期草稿供核對', async () => {
  const review = { reviewRevision: 0, missingSupplementQuestionIds: [], supplements: [] };
  const groups: ActivityView['groups'] = [{ id:'甲', name:'甲組', received:true, rank:1, answers:[{questionId:'1',text:'CPU',autoCorrect:true,correct:true}] }];
  const action = vi.fn().mockResolvedValue(true);
  const show = (revision = 0) => render(<RoundReview roundPath="/api/rounds/r" questions={[{questionId:'1',prompt:'處理器簡稱？',missingPrompt:false}]} groups={groups} review={{...review,reviewRevision:revision}} disabled={false} action={action} />);
  await show();
  expect(host.textContent).toContain('自動判分：答對');
  expect(host.querySelector('textarea')).toBeNull();
  const select = host.querySelector('select')!;
  await act(async () => {
    select.value = 'false';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(host.querySelector('textarea')?.labels?.[0]?.textContent).toContain('老師補答');
  const textarea = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '老師答案');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await show(1);
  expect(host.textContent).toContain('已有更新');
  expect(host.querySelector('textarea')?.value).toBe('老師答案');
  const confirm = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('使用最新版本'))!;
  await act(async () => confirm.click());
  await act(async () => {
    select.value = 'true';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(host.querySelector('textarea')?.readOnly).toBe(true);
  const save = [...host.querySelectorAll('button')].find(button => button.textContent === '儲存判分與補答')!;
  await act(async () => save.click());
  expect(action).toHaveBeenCalledWith('/api/rounds/r/review', {reviewRevision:1,grades:[{groupId:'甲',questionId:'1',correct:true}],supplements:[]},'PATCH');
});

it('其他分頁改成有組答對後，舊補答仍可複製且不提交', async () => {
  const action = vi.fn().mockResolvedValue(true);
  const show = (revision:number, correct:boolean) => render(<RoundReview roundPath="/api/rounds/r"
    questions={[{questionId:'1',prompt:'處理器簡稱？',missingPrompt:false}]}
    groups={[{id:'甲',name:'甲組',received:true,rank:1,answers:[{questionId:'1',text:'新寫法',autoCorrect:false,correct}]}]}
    review={{reviewRevision:revision,missingSupplementQuestionIds:correct?[]:['1'],supplements:[]}} disabled={false} action={action}/>);
  await show(0,false);
  const field = host.querySelector('textarea')!;
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,'過期但可複製的補答');
    field.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await show(1,true);
  expect(host.querySelector('textarea')?.readOnly).toBe(true);
  expect(host.querySelector('textarea')?.value).toBe('過期但可複製的補答');
  const adopt = [...host.querySelectorAll('button')].find(b=>b.textContent?.includes('使用最新版本'))!;
  await act(async()=>adopt.click());
  const save = [...host.querySelectorAll('button')].find(b=>b.textContent==='儲存判分與補答')!;
  await act(async()=>save.click());
  expect(action).not.toHaveBeenCalled();
  expect(host.querySelector('textarea')?.value).toBe('過期但可複製的補答');
});
