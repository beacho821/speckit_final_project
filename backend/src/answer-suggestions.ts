import { DomainError } from './rounds.js';

async function providerError(response: Response) {
  const body = await response.json().catch(() => null);
  const code = body?.error?.code;
  const stopBatch = { stopBatch: true };
  if (response.status === 401 && code === 'expired_secret_key') {
    return new DomainError(503, 'AI_KEY_EXPIRED', 'AI 金鑰已過期。請管理者更新後端的 AI_API_KEY 並重新啟動服務。', stopBatch);
  }
  if (response.status === 401 || response.status === 403) {
    return new DomainError(503, 'AI_ACCESS_DENIED', 'AI 服務拒絕授權，請管理者確認 AI_API_KEY 與模型存取權限。', stopBatch);
  }
  if (code === 'model_not_found') {
    return new DomainError(503, 'AI_MODEL_UNAVAILABLE', '指定的模型無法使用，請管理者確認 AI_MODEL 與此金鑰可存取的模型。', stopBatch);
  }
  if (response.status === 429) {
    return code === 'insufficient_quota'
      ? new DomainError(503, 'AI_QUOTA_EXHAUSTED', 'AI 服務可用額度不足，請管理者檢查 API 專案的額度。', stopBatch)
      : new DomainError(429, 'AI_RATE_LIMITED', 'AI 服務目前限制請求頻率，請稍後重試。', stopBatch);
  }
  return new DomainError(502, 'AI_UNAVAILABLE', 'AI 服務未能完成請求，請稍後重試。');
}

export async function suggestAnswers(prompt: string) {
  const key = process.env.AI_API_KEY?.trim();
  const model = process.env.AI_MODEL?.trim();
  if (!key || !model) throw new DomainError(503, 'AI_NOT_CONFIGURED', '請設定 AI_API_KEY 與 AI_MODEL，或略過 AI 繼續備題。', { stopBatch: true });
  try {
    const base = (process.env.AI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const response = await fetch(base + '/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ model, messages: [
        { role: 'system', content: '你是教師備課助手。針對題幹提出可直接用於逐字判分的標準答案，第一項為主要答案，其後列出確實等義的名稱、縮寫或其他正確作答。不確定時回傳空陣列。只輸出 JSON 字串陣列，每項一個答案。' },
        { role: 'user', content: prompt },
      ] }),
    });
    if (!response.ok) throw await providerError(response);
    const result = await response.json();
    const values = JSON.parse(result.choices[0].message.content);
    if (!Array.isArray(values) || !values.every(value => typeof value === 'string' && value.trim() && value.length <= 4000 && !/[\r\n]/.test(value))) throw Error();
    return [...new Set<string>(values.map(value => value.trim()))].slice(0, 20);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(502, 'AI_UNAVAILABLE', '無法取得有效的 AI 建議，請重試、手動填寫或略過。');
  }
}
