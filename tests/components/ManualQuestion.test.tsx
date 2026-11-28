// @vitest-environment jsdom
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import ManualQuestion from '../../frontend/src/ManualQuestion';
import { click, flush, host, render } from '../helpers/ui';

it('新增題目不需題號，驗證失敗保留輸入，成功才清空', async () => {
  const onAdd = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await render(<ManualQuestion disabled={false} onAdd={onAdd} />);
  await click('新增題目');
  const dialog = host.querySelector('dialog')!;
  expect(dialog.open).toBe(true);
  expect(dialog.querySelector('input')).toBeNull();
  const [prompt, answers] = dialog.querySelectorAll('textarea');
  await click('儲存題目');
  expect(onAdd).not.toHaveBeenCalled();
  expect(dialog.textContent).toContain('請填寫題幹');
  await act(async () => {
    for (const [field, value] of [[prompt, '完整題幹'], [answers, '第一個正解']] as const) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await click('儲存題目');
  expect(prompt.value).toBe('完整題幹');
  expect(dialog.open).toBe(true);
  await click('儲存題目');
  expect(onAdd).toHaveBeenCalledWith('完整題幹', '第一個正解');
  expect(dialog.open).toBe(false);
  await flush(15);
  expect(prompt.value).toBe('');
  expect(answers.value).toBe('');
});
