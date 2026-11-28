import { afterEach, expect, it, vi } from 'vitest';
import { suggestAnswers } from '../../backend/src/answer-suggestions';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each([
  [401, 'expired_secret_key', 'AI_KEY_EXPIRED'],
  [401, 'invalid_api_key', 'AI_ACCESS_DENIED'],
  [403, 'forbidden', 'AI_ACCESS_DENIED'],
  [404, 'model_not_found', 'AI_MODEL_UNAVAILABLE'],
  [429, 'insufficient_quota', 'AI_QUOTA_EXHAUSTED'],
  [429, 'rate_limit_exceeded', 'AI_RATE_LIMITED'],
] as const)('上游 %s %s 會回傳可處理的錯誤並停止整批請求', async (status, code, expected) => {
  vi.stubEnv('AI_API_KEY', '隔離測試'); vi.stubEnv('AI_MODEL', '測試模型');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code, message: '上游機密細節' } }, { status })));
  await expect(suggestAnswers('題組第二小題')).rejects.toMatchObject({
    code: expected, message: expect.not.stringContaining('上游機密細節'), details: { stopBatch: true },
  });
});

it('只送題幹，主要答案及其他有效答案保留順序並去除重複', async () => {
  vi.stubEnv('AI_API_KEY', '隔離測試'); vi.stubEnv('AI_MODEL', '測試模型');
  const request = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '["中央處理器", "CPU", " CPU "]' } }] }));
  vi.stubGlobal('fetch', request);
  expect(await suggestAnswers('負責處理指令的元件？')).toEqual(['中央處理器', 'CPU']);
  const payload = JSON.parse(request.mock.calls[0][1].body);
  expect(payload.messages[1]).toEqual({ role: 'user', content: '負責處理指令的元件？' });
});

it('未設定時不送出網路請求，模型輸出格式錯誤時可略過', async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '錯誤格式' } }] }));
  vi.stubGlobal('fetch', request); vi.stubEnv('AI_API_KEY', ''); vi.stubEnv('AI_MODEL', '測試模型');
  await expect(suggestAnswers('題幹')).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  expect(request).not.toHaveBeenCalled();
  vi.stubEnv('AI_API_KEY', '隔離測試');
  await expect(suggestAnswers('題幹')).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
});
