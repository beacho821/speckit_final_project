import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../backend/src/app.js';
import type { AppConfig } from '../../backend/src/config.js';

const config: AppConfig = { teacherPassword: 'teacher-test-secret', groupCodes: new Map([['a', 'alpha-test-secret'], ['b', 'beta-test-secret']]), port: 0 };
const { app, activity } = createApp(config);
let server: ReturnType<typeof app.listen>;
let base = '';
const basic = (user: string, code: string) => `Basic ${Buffer.from(`${user}:${code}`).toString('base64')}`;
beforeAll(async () => { server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

describe('登入與組別名單 HTTP 契約', () => {
  it('教師登入後可更新全量名單，回應不含代碼且設定 no-store', async () => {
    const login = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { Authorization: basic('teacher', config.teacherPassword) } });
    const session = await login.json() as { activityId: string; role: string };
    expect(login.status).toBe(200); expect(session.role).toBe('teacher');
    const roster = await fetch(`${base}/api/roster`, { headers: { Authorization: basic('teacher', config.teacherPassword), 'X-Activity-Id': session.activityId } });
    expect(roster.headers.get('cache-control')).toBe('no-store');
    expect(await roster.json()).toMatchObject({ groups: [], availableGroups: [{ id: 'a' }, { id: 'b' }] });
    const update = await fetch(`${base}/api/roster`, { method: 'PUT', headers: { Authorization: basic('teacher', config.teacherPassword), 'X-Activity-Id': session.activityId, 'Content-Type': 'application/json' }, body: JSON.stringify({ groups: [{ id: 'a', name: '甲組' }, { id: 'b', name: '乙組' }] }) });
    const body = await update.json() as { groups: Array<Record<string, unknown>> };
    expect(update.status).toBe(200); expect(JSON.stringify(body)).not.toContain('alpha-test-secret');
    expect(body.groups.map(group => group.name)).toEqual(['甲組', '乙組']);
  });
  it('拒絕錯誤憑證、偽冒組名、重複或空白組名以及過期活動 ID', async () => {
    const bad = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { Authorization: basic('teacher', 'wrong-secret') } });
    expect(bad.status).toBe(401); expect((await bad.json()).message).toContain('重新輸入');
    const good = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { Authorization: basic('teacher', config.teacherPassword) } });
    const { activityId } = await good.json() as { activityId: string };
    for (const groups of [[{ id: 'a', name: '  ' }], [{ id: 'a', name: '甲' }, { id: 'b', name: '甲' }], [{ id: 'not-configured', name: '冒名' }]]) {
      const response = await fetch(`${base}/api/roster`, { method: 'PUT', headers: { Authorization: basic('teacher', config.teacherPassword), 'X-Activity-Id': activityId, 'Content-Type': 'application/json' }, body: JSON.stringify({ groups }) });
      expect(response.status).toBe(422);
      expect((await response.json()).message).toContain('組名');
    }
    const stale = await fetch(`${base}/api/roster`, { headers: { Authorization: basic('teacher', config.teacherPassword), 'X-Activity-Id': 'stale-activity' } });
    expect(stale.status).toBe(409);
    const noCredential = await fetch(`${base}/api/roster`, { headers: { 'X-Activity-Id': activityId } });
    expect(noCredential.status).toBe(401);
  });
  it('刪除組別會立即撤權，重新啟動活動會拒絕舊活動 ID', async () => {
    const login = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { Authorization: basic('teacher', config.teacherPassword) } });
    const { activityId } = await login.json() as { activityId: string };
    const studentToken = basic('student', 'beta-test-secret');
    const currentView = await fetch(`${base}/api/view`, { headers: { Authorization: studentToken, 'X-Activity-Id': activityId } });
    const version = (await currentView.json()).version as number;
    const pending = fetch(`${base}/api/view?after=${version}`, { headers: { Authorization: studentToken, 'X-Activity-Id': activityId } });
    await new Promise(resolve => setTimeout(resolve, 25));
    const update = await fetch(`${base}/api/roster`, { method: 'PUT', headers: { Authorization: basic('teacher', config.teacherPassword), 'X-Activity-Id': activityId, 'Content-Type': 'application/json' }, body: JSON.stringify({ groups: [{ id: 'a', name: '甲組' }] }) });
    expect(update.status).toBe(200);
    expect((await pending).status).toBe(401);
    const revoked = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { Authorization: basic('student', 'beta-test-secret') } });
    expect(revoked.status).toBe(401);
    const previousId = activity.id;
    const restarted = createApp(config);
    expect(restarted.activity.id).not.toBe(previousId);
    const newServer = restarted.app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => newServer.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(newServer.address() as { port: number }).port}/api/roster`, { headers: { Authorization: basic('teacher', config.teacherPassword), 'X-Activity-Id': activityId } });
      expect(response.status).toBe(409);
      expect(restarted.activity.groups).toHaveLength(0);
    } finally { await new Promise<void>((resolve, reject) => newServer.close(error => error ? reject(error) : resolve())); }
  });
});
