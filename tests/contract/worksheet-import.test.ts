import { worksheetHeaders } from '../helpers/classroom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../backend/src/app.js';
import { DomainError } from '../../backend/src/rounds.js';
import type { AppConfig } from '../../backend/src/config.js';
import type { Worksheet } from '../../shared/api.js';

const config: AppConfig = { teacherPassword: 'teacher-import-secret', port: 0 };
const worksheet: Worksheet = { source: { kind: 'google', documentId: 'doc-test', sheetId: 12, sheetTitle: '樣本頁', importedAt: 1 }, fills: [], units: [{ id: 'u1', name: '第 1 題', questionIds: ['1'], fillBlankIds: [] }] };
let markOlderReceived: () => void;
let resumeOlder: () => void;
const olderReceived = new Promise<void>(resolve => { markOlderReceived = resolve; });
const olderCanFinish = new Promise<void>(resolve => { resumeOlder = resolve; });
const { app, classrooms } = createApp(config, { importWorksheet: async (url, sheetId) => {
  if (url === 'multi' && sheetId === undefined) return { candidates: [{ sheetId: 12, title: '樣本頁' }, { sheetId: 13, title: '備用頁' }] };
  if (url === 'broken') throw new DomainError(502, 'GOOGLE_READ_FAILED', '無法讀取試算表，請檢查權限。');
  if (url === 'invalid') throw new DomainError(422, 'INVALID_SHEET_URL', '僅支援 Google 試算表網址，請確認連結後重試。');
  if (url === 'mismatch') throw new DomainError(409, 'SHEET_CHANGED', '學習單已變更，請重新匯入。');
  if (url === 'slow') {
    markOlderReceived();
    await olderCanFinish;
    return { worksheet: { ...worksheet, source: { ...worksheet.source, documentId: 'doc-older' } } as Worksheet };
  }
  return { worksheet };
} });
const room = await classrooms.create('匯入測試教室');
const activity = room.activity;
const scope = { 'X-Classroom-Id': room.id, 'X-Activity-Id': activity.id, 'X-Activity-Epoch': classrooms.runtime };
let server: ReturnType<typeof app.listen>; let base = '';
const auth = `Basic ${Buffer.from(`teacher:${config.teacherPassword}`).toString('base64')}`;
beforeAll(async () => { server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function importRequest(url: string, sheetId?: number) {
  return fetch(`${base}/api/worksheet/import`, { method: 'POST', headers: { Authorization: auth, ...scope, ...worksheetHeaders(activity), 'Content-Type': 'application/json' }, body: JSON.stringify({ url, ...(sheetId === undefined ? {} : { sheetId }) }) });
}

describe('學習單匯入契約', () => {
  it('多分頁先回選項，指定分頁後才發布預覽', async () => {
    const candidates = await importRequest('multi');
    expect(candidates.status).toBe(200); expect((await candidates.json()).candidates).toHaveLength(2); expect(activity.worksheet).toBeNull();
    const selected = await importRequest('multi', 12);
    expect(selected.status).toBe(200); expect(await selected.json()).toMatchObject({ unitCount: 1, fillCount: 0, source: { sheetId: 12 } });
    expect(activity.worksheet?.source.sheetTitle).toBe('樣本頁');
  });
  it('單分頁自動選取；錯誤網址保留預覽，學生不能匯入或替換來源', async () => {
    const selected = await importRequest('single');
    expect(selected.status).toBe(200);
    expect(await selected.json()).toMatchObject({ source: { sheetId: 12 }, unitCount: 1 });
    const before = activity.worksheet;
    const invalidUrl = await importRequest('invalid');
    expect(invalidUrl.status).toBe(422);
    expect((await invalidUrl.json()).message).toContain('Google 試算表網址');
    expect(activity.worksheet).toBe(before);

    const groupResponse = await fetch(`${base}/api/groups`, { method: 'POST', headers: { Authorization: auth, ...scope, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '匯入權限組' }) });
    const group = (await groupResponse.json()).groups[0] as { id: string; joinCode: string };
    const studentHeader = { Authorization: `Basic ${Buffer.from(`student:${group.joinCode}`).toString('base64')}`, ...scope };
    const login = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { Authorization: studentHeader.Authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '學生甲' }) });
    const studentSession = await login.json() as { memberId: string };
    const forbidden = await fetch(`${base}/api/worksheet/import`, { method: 'POST', headers: { ...studentHeader, 'X-Member-Id': studentSession.memberId, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'single' }) });
    expect(forbidden.status).toBe(403);
    expect(activity.worksheet).toBe(before);
  });
  it('匯入錯誤不取代原有預覽，無效 gid 被拒絕', async () => {
    const before = activity.worksheet;
    const failed = await importRequest('broken');
    expect(failed.status).toBe(502); expect((await failed.json()).message).toContain('檢查權限'); expect(activity.worksheet).toBe(before);
    const badGid = await fetch(`${base}/api/worksheet/import`, { method: 'POST', headers: { Authorization: auth, ...scope, ...worksheetHeaders(activity), 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'multi', sheetId: -1 }) });
    expect(badGid.status).toBe(422); expect(activity.worksheet).toBe(before);
  });
  it('較早發出的非同步匯入不能覆蓋較新的來源', async () => {
    const older = importRequest('slow');
    await olderReceived;
    try {
      const newer = await importRequest('latest');
      expect(newer.status).toBe(200);
    } finally {
      resumeOlder();
    }
    const late = await older;
    expect(late.status).toBe(409); expect(activity.worksheet?.source.documentId).toBe('doc-test');
  });
  it('無教師憑證或兩種快照不一致時拒絕匯入並保留目前預覽', async () => {
    const before = activity.worksheet;
    const unauthorized = await fetch(`${base}/api/worksheet/import`, { method: 'POST', headers: { Authorization: 'Basic dGVhY2hlcjp3cm9uZw==', ...scope, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'multi' }) });
    expect(unauthorized.status).toBe(401);
    const mismatch = await importRequest('mismatch');
    expect(mismatch.status).toBe(409); expect((await mismatch.json()).code).toBe('SHEET_CHANGED'); expect(activity.worksheet).toBe(before);
  });
});
