import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../backend/src/app.js';
import type { AppConfig } from '../../backend/src/config.js';

const config: AppConfig = { teacherPassword: 'teacher-restart-secret', groupCodes: new Map([['a', 'alpha-restart-secret']]), port: 0 };
const { app, activity } = createApp(config);
let server: ReturnType<typeof app.listen>; let base = '';
const auth = `Basic ${Buffer.from(`teacher:${config.teacherPassword}`).toString('base64')}`;
beforeAll(async () => { server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

describe('本機活動生命週期', () => {
  it('真實 HTTP 登入及名單更新後，重啟新程序會清空狀態並拒絕舊活動 ID', async () => {
    const login = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { Authorization: auth } });
    const session = await login.json() as { activityId: string };
    const update = await fetch(`${base}/api/roster`, { method: 'PUT', headers: { Authorization: auth, 'X-Activity-Id': session.activityId, 'Content-Type': 'application/json' }, body: JSON.stringify({ groups: [{ id: 'a', name: '甲組' }] }) });
    expect(update.status).toBe(200); expect(activity.groups).toEqual([{ id: 'a', name: '甲組' }]);
    const restarted = createApp(config);
    const nextServer = restarted.app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => nextServer.once('listening', resolve));
    try {
      const stale = await fetch(`http://127.0.0.1:${(nextServer.address() as { port: number }).port}/api/roster`, { headers: { Authorization: auth, 'X-Activity-Id': session.activityId } });
      expect(stale.status).toBe(409); expect(restarted.activity.groups).toEqual([]); expect(restarted.activity.worksheet).toBeNull(); expect(restarted.activity.rounds).toEqual([]);
    } finally { await new Promise<void>((resolve, reject) => nextServer.close(error => error ? reject(error) : resolve())); }
  });
});
