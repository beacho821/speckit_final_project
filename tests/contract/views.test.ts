import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../backend/src/app.js';
import type { AppConfig } from '../../backend/src/config.js';
import type { Worksheet } from '../../shared/api.js';

const config: AppConfig = { teacherPassword: 'teacher-view-secret', groupCodes: new Map([['a', 'alpha-view-secret'], ['b', 'beta-view-secret']]), port: 0 };
const worksheet: Worksheet = { source: { documentId: 'view-test', sheetId: 1, sheetTitle: '題目', importedAt: 0 }, fills: [{ id: 'f', questionId: '1', mainQuestionId: '1', unitId: 'u', row: 2, column: 2, originalValue: '', originalType: 'blank', identitySource: 'header' }], units: [{ id: 'u', name: '第 1 題', questionIds: ['1'], fillBlankIds: ['f'] }] };
const { app } = createApp(config, { importWorksheet: async () => ({ worksheet }) });
let server: ReturnType<typeof app.listen>; let base = '';
const token = (role: string, secret: string) => `Basic ${Buffer.from(`${role}:${secret}`).toString('base64')}`;
const headers = (role: string, secret: string, activityId: string) => ({ Authorization: token(role, secret), 'X-Activity-Id': activityId });
beforeAll(async () => { server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

describe('角色專屬 HTTP 快照與長輪詢', () => {
  it('教師看到可選題目，學生看不到教師清單，其他組送出不喚醒學生輪詢', async () => {
    const teacherLogin = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { Authorization: token('teacher', config.teacherPassword) } });
    const { activityId } = await teacherLogin.json() as { activityId: string };
    const roster = await fetch(`${base}/api/roster`, { method: 'PUT', headers: { ...headers('teacher', config.teacherPassword, activityId), 'Content-Type': 'application/json' }, body: JSON.stringify({ groups: [{ id: 'a', name: '甲組' }, { id: 'b', name: '乙組' }] }) }); expect(roster.status).toBe(200);
    const student = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { Authorization: token('student', 'beta-view-secret') } });
    const studentSession = await student.json() as { activityId: string };
    await fetch(`${base}/api/worksheet/import`, { method: 'POST', headers: { ...headers('teacher', config.teacherPassword, activityId), 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'local' }) });
    const prepared = await fetch(`${base}/api/rounds`, { method: 'POST', headers: { ...headers('teacher', config.teacherPassword, activityId), 'Content-Type': 'application/json' }, body: JSON.stringify({ unitId: 'u' }) });
    const round = await prepared.json() as { id: string };
    const preparingView = await fetch(`${base}/api/view`, { headers: headers('teacher', config.teacherPassword, activityId) });
    expect((await preparingView.json()).availableUnits).toEqual([{ unitId: 'u', questionIds: ['1'] }]);
    await fetch(`${base}/api/rounds/${round.id}/start`, { method: 'POST', headers: headers('teacher', config.teacherPassword, activityId) });
    const current = await fetch(`${base}/api/view`, { headers: headers('student', 'beta-view-secret', studentSession.activityId) });
    const snapshot = await current.json() as { version: number };
    expect(current.headers.get('cache-control')).toBe('no-store');
    const waiting = fetch(`${base}/api/view?after=${snapshot.version}`, { headers: headers('student', 'beta-view-secret', studentSession.activityId) });
    await fetch(`${base}/api/rounds/${round.id}/submissions`, { method: 'POST', headers: { ...headers('student', 'alpha-view-secret', activityId), 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: [{ questionId: '1', text: '不對乙組公開' }] }) });
    expect(await Promise.race([waiting.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 150))])).toBe(false);
    const ended = await fetch(`${base}/api/rounds/${round.id}/end`, { method: 'POST', headers: headers('teacher', config.teacherPassword, activityId) }); expect(ended.status).toBe(200);
    const published = await waiting; expect(published.status).toBe(200); const finalView = await published.json();
    expect(JSON.stringify(finalView)).not.toContain('不對乙組公開'); expect(finalView).not.toHaveProperty('availableUnits');
    const results = await fetch(`${base}/api/rounds/${round.id}/results`, { headers: headers('student', 'beta-view-secret', studentSession.activityId) });
    expect(JSON.stringify(await results.json())).toContain('不對乙組公開');
  });
});
