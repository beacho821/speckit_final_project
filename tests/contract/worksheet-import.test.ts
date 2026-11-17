import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../backend/src/app.js';
import { DomainError } from '../../backend/src/rounds.js';
import type { AppConfig } from '../../backend/src/config.js';
import type { Worksheet } from '../../shared/api.js';

const config: AppConfig = { teacherPassword: 'teacher-import-secret', port: 0 };
const worksheet: Worksheet = { source: { kind: 'google', documentId: 'doc-test', sheetId: 12, sheetTitle: '樣本頁', importedAt: 1 }, fills: [], units: [{ id: 'u1', name: '第 1 題', questionIds: ['1'], fillBlankIds: [] }] };
const { app, activity } = createApp(config, { importWorksheet: async (url, sheetId) => {
  if (url === 'multi' && sheetId === undefined) return { candidates: [{ sheetId: 12, title: '樣本頁' }, { sheetId: 13, title: '備用頁' }] };
  if (url === 'broken') throw new DomainError(502, 'GOOGLE_READ_FAILED', '無法讀取試算表，請檢查權限。');
  if (url === 'mismatch') throw new DomainError(409, 'SHEET_CHANGED', '學習單已變更，請重新匯入。');
  if (url === 'slow') await new Promise(resolve => setTimeout(resolve, 80));
  return { worksheet };
} });
let server: ReturnType<typeof app.listen>; let base = '';
const auth = `Basic ${Buffer.from(`teacher:${config.teacherPassword}`).toString('base64')}`;
beforeAll(async () => { server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function importRequest(url: string, sheetId?: number) {
  return fetch(`${base}/api/worksheet/import`, { method: 'POST', headers: { Authorization: auth, 'X-Activity-Id': activity.id, 'Content-Type': 'application/json' }, body: JSON.stringify({ url, ...(sheetId === undefined ? {} : { sheetId }) }) });
}

describe('學習單匯入契約', () => {
  it('多分頁先回選項，指定分頁後才發布預覽', async () => {
    const candidates = await importRequest('multi');
    expect(candidates.status).toBe(200); expect((await candidates.json()).candidates).toHaveLength(2); expect(activity.worksheet).toBeNull();
    const selected = await importRequest('multi', 12);
    expect(selected.status).toBe(200); expect(await selected.json()).toMatchObject({ unitCount: 1, fillCount: 0, source: { sheetId: 12 } });
    expect(activity.worksheet?.source.sheetTitle).toBe('樣本頁');
  });
  it('匯入錯誤不取代原有預覽，無效 gid 被拒絕', async () => {
    const before = activity.worksheet;
    const failed = await importRequest('broken');
    expect(failed.status).toBe(502); expect((await failed.json()).message).toContain('檢查權限'); expect(activity.worksheet).toBe(before);
    const badGid = await fetch(`${base}/api/worksheet/import`, { method: 'POST', headers: { Authorization: auth, 'X-Activity-Id': activity.id, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'multi', sheetId: -1 }) });
    expect(badGid.status).toBe(422); expect(activity.worksheet).toBe(before);
  });
  it('較早發出的非同步匯入不能覆蓋較新的來源', async () => {
    const older = importRequest('slow');
    const newer = await importRequest('latest');
    expect(newer.status).toBe(200);
    const late = await older;
    expect(late.status).toBe(409); expect(activity.worksheet?.source.documentId).toBe('doc-test');
  });
  it('無教師憑證或兩種快照不一致時拒絕匯入並保留目前預覽', async () => {
    const before = activity.worksheet;
    const unauthorized = await fetch(`${base}/api/worksheet/import`, { method: 'POST', headers: { Authorization: 'Basic dGVhY2hlcjp3cm9uZw==', 'X-Activity-Id': activity.id, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'multi' }) });
    expect(unauthorized.status).toBe(401);
    const mismatch = await importRequest('mismatch');
    expect(mismatch.status).toBe(409); expect((await mismatch.json()).code).toBe('SHEET_CHANGED'); expect(activity.worksheet).toBe(before);
  });
});
