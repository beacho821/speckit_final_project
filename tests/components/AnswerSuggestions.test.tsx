// @vitest-environment jsdom
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import AnswerSuggestions from '../../frontend/src/AnswerSuggestions';
import { click, host, render } from '../helpers/ui';

it('金鑰過期時顯示原因、停止後續小題並保留已取得的答案', async () => {
  const request = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ answers: ['甲答案'] }))
    .mockResolvedValueOnce(Response.json({ code: 'AI_KEY_EXPIRED', message: 'AI 金鑰已過期。', details: { stopBatch: true } }, { status: 503 }));
  const accept = vi.fn();
  await render(<AnswerSuggestions targets={['甲', '乙', '丙'].map(id => ({ id, label: id, prompt: id, text: '' }))}
    session={{ activityId: '課堂', role: 'teacher' }} credential="測試" onAccept={accept} />);
  await click('AI 產生建議答案'); await click('產生建議');
  expect(host.textContent).toContain('AI 金鑰已過期');
  expect(request).toHaveBeenCalledTimes(2);
  await click('加入標準答案');
  expect([...accept.mock.calls[0][0].keys()]).toEqual(['甲']);
});

it('等待 AI 時若有人補上答案，略過該題並保留其他小題的建議', async () => {
  let respond!: (response: Response) => void;
  const request = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise(resolve => { respond = resolve; }))
    .mockResolvedValueOnce(Response.json({ answers: ['乙答案', '同義答案'] }));
  const accept = vi.fn();
  const targets = ['甲', '乙', '丙'].map(id => ({ id, label: id, prompt: id + '題幹', text: '' }));
  const show = () => render(<AnswerSuggestions targets={targets.map(q => ({ ...q }))} onAccept={accept}
    session={{ activityId: '課堂', role: 'teacher' }} credential="測試" />);
  await show();
  await click('AI 產生建議答案');
  await act(async () => host.querySelectorAll<HTMLInputElement>('.ai-answer-dialog input')[2].click());
  await click('產生建議');
  targets[0].text = '教師已填';
  await show();
  await act(async () => respond(Response.json({ answers: ['過期建議'] })));
  await click('加入標準答案');
  expect(request).toHaveBeenCalledTimes(2);
  expect([...accept.mock.calls[0][0].keys()]).toEqual(['乙']);
});

it('一題失敗仍保留已產生的建議，重試只送出缺少建議的小題', async () => {
  const request = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ answers: ['甲答案'] }))
    .mockResolvedValueOnce(Response.json({ message: '請稍後重試。' }, { status: 502 }))
    .mockResolvedValueOnce(Response.json({ answers: ['乙答案'] }));
  const accept = vi.fn();
  await render(<AnswerSuggestions targets={['甲', '乙'].map(id => ({ id, label: id, prompt: id, text: '' }))}
    session={{ activityId: '課堂', role: 'teacher' }} credential="測試" onAccept={accept} />);
  await click('AI 產生建議答案'); await click('產生建議');
  expect(host.textContent).toContain('請稍後重試。');
  await click('產生建議'); await click('加入標準答案');
  expect(request.mock.calls.map(([, opts]) => JSON.parse(String(opts?.body)).prompt)).toEqual(['甲', '乙', '乙']);
  expect([...accept.mock.calls[0][0].keys()]).toEqual(['甲', '乙']);
});
