export interface AppConfig { teacherPassword: string; groupCodes: Map<string, string>; googleServiceAccount?: Record<string, unknown>; port: number }

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少環境變數 ${name}，請設定後重新啟動。`);
  return value;
}

export function loadConfig(): AppConfig {
  const teacherPassword = required('TEACHER_PASSWORD');
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(required('GROUP_CODES_JSON')) as Record<string, unknown>; }
  catch { throw new Error('GROUP_CODES_JSON 格式錯誤，請設定為組別 ID 對應代碼的 JSON 物件。'); }
  const entries = Object.entries(raw);
  const groupCodes = new Map<string, string>();
  for (const [id, candidate] of entries) {
    if (!id.trim() || typeof candidate !== 'string' || !candidate.trim()) throw new Error('GROUP_CODES_JSON 含空白組別 ID 或代碼，請修正設定。');
    const code = candidate.trim();
    if (code === teacherPassword || [...groupCodes.values()].includes(code)) throw new Error('TEACHER_PASSWORD 與 GROUP_CODES_JSON 的代碼必須彼此不同，請修正環境設定。');
    groupCodes.set(id, code);
  }
  if (groupCodes.size === 0) throw new Error('GROUP_CODES_JSON 至少需設定一組代碼，請加入組別後重新啟動。');
  let googleServiceAccount: Record<string, unknown> | undefined;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) {
    try { googleServiceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) as Record<string, unknown>; }
    catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 格式錯誤，請設定有效的服務帳戶 JSON。'); }
    if (typeof googleServiceAccount.client_email !== 'string' || typeof googleServiceAccount.private_key !== 'string') throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 缺少必要欄位，請確認服務帳戶設定。');
  }
  return { teacherPassword, groupCodes, googleServiceAccount, port: Number(process.env.PORT) || 3000 };
}
