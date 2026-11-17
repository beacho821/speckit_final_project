import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApp, type AppServices } from '../../backend/src/app.js';

export const basic = (role: string, value: string) => `Basic ${Buffer.from(`${role}:${value}`).toString('base64')}`;
export async function classroom(services: AppServices = {}) {
  const config = { teacherPassword: randomUUID(), port: 0 };
  const { app, activity } = createApp(config, services);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const teacher = { Authorization: basic('teacher', config.teacherPassword), 'X-Activity-Id': activity.id };
  async function request(path: string, headers = teacher, body?: unknown, method = 'GET') {
    return fetch(base + '/api' + path, { method, headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function group(name = '甲組') {
    const response = await request('/groups', teacher, { name }, 'POST');
    if (!response.ok) throw new Error('測試建組失敗');
    return (await response.json()).groups.find((g: { name: string }) => g.name === name) as { id: string; name: string; joinCode: string };
  }
  async function student(joinCode: string, name = '小明') {
    const response = await request('/sessions', { ...teacher, Authorization: basic('student', joinCode) }, { name }, 'POST');
    if (!response.ok) throw new Error('測試加入失敗');
    const session = await response.json();
    return { session, headers: { Authorization: basic('student', joinCode), 'X-Activity-Id': activity.id, 'X-Member-Id': session.memberId } };
  }
  return { app, activity, config, base, teacher, request, group, student, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
