import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../backend/src/config.js';
afterEach(() => vi.unstubAllEnvs());
describe('必要環境設定', () => {
  function setup() { vi.stubEnv('TEACHER_PASSWORD', randomUUID()); vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_JSON', ''); vi.stubEnv('GROUP_CODES_JSON', '無效舊設定'); vi.stubEnv('PORT', ''); }
  it('忽略舊組碼、Google 可省略且預設連接埠', () => { setup(); const c = loadConfig(); expect(c.port).toBe(3000); expect(c).not.toHaveProperty('groupCodes'); });
  it.each(['1','65535'])('接受連接埠邊界 %s', port => { setup(); vi.stubEnv('PORT', port); expect(loadConfig().port).toBe(Number(port)); });
  it.each(['0','65536','1.5','abc'])('拒絕無效連接埠 %s', port => { setup(); vi.stubEnv('PORT', port); expect(() => loadConfig()).toThrow('PORT'); });
  it('缺教師密碼指出設定方式', () => { setup(); vi.stubEnv('TEACHER_PASSWORD', ' '); expect(() => loadConfig()).toThrow('TEACHER_PASSWORD'); });
  it('從 JSON 檔案路徑載入 Google 設定', () => {
    setup();
    const directory = join(tmpdir(), `classroom-buzzer-${randomUUID()}`);
    const path = join(directory, 'service-account.json');
    mkdirSync(directory, { recursive: true });
    writeFileSync(path, JSON.stringify({ client_email: 'test@example.invalid', private_key: 'runtime-test-key' }));
    try {
      vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_JSON', path);
      expect(loadConfig().googleServiceAccount).toMatchObject({ client_email: 'test@example.invalid' });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('拒絕無效 Google 設定且不回顯路徑', () => { setup(); const value = join(tmpdir(), `missing-${randomUUID()}.json`); vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_JSON', value); try { loadConfig(); expect.fail('應拒絕'); } catch (e) { expect((e as Error).message.includes(value)).toBe(false); expect((e as Error).message).toContain('GOOGLE_SERVICE_ACCOUNT_JSON'); } });
});

it('根 .env 只忽略不存在，其他讀取錯誤須明確失敗',async()=>{const {loadEnvironment}=await import('../../backend/src/bootstrap');const spy=vi.spyOn(process,'loadEnvFile');spy.mockImplementation(()=>{throw Object.assign(new Error('private'),{code:'ENOENT'});});expect(()=>loadEnvironment('/private/tmp/no-file')).not.toThrow();spy.mockImplementation(()=>{throw Object.assign(new Error('private'),{code:'EACCES'});});expect(()=>loadEnvironment('/private/tmp/no-file')).toThrow('無法讀取');spy.mockRestore();});
