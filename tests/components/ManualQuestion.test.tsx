// @vitest-environment jsdom
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import ManualQuestion from '../../frontend/src/ManualQuestion';
import { host, render } from '../helpers/ui';

it('手動新增驗證失敗保留輸入，成功才清空', async () => {
  const onAdd = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await render(<ManualQuestion disabled={false} onAdd={onAdd} />);
  const form = host.querySelector('form')!;
  const id = form.querySelector('input')!;
  const prompt = form.querySelector('textarea')!;
  expect(id.labels?.[0]?.textContent).toContain('題號');
  expect(prompt.labels?.[0]?.textContent).toContain('題目');
  await act(async () => {
    for (const [field, value] of [[id, 'M1'], [prompt, '完整題幹']] as const) {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(id.value).toBe('M1');
  expect(prompt.value).toBe('完整題幹');
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(onAdd).toHaveBeenCalledWith('M1', '完整題幹');
  expect(id.value).toBe('');
  expect(prompt.value).toBe('');
});
