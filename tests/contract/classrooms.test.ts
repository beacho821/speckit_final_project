import { expect, it } from 'vitest';
import { classroom } from '../helpers/classroom';

it('教師可建立及刪除指定教室，輸入錯誤時維持清單', async () => {
  const c = await classroom();
  try {
    const create = (name: string) => c.request('/classrooms', c.teacher, { name }, 'POST');
    const listIds = async () => (await (await c.request('/classrooms')).json()).map((item: { id: string }) => item.id);
    for (const [name, message] of [
      [' ', '教室名稱不可空白，請重新輸入。'],
      ['字'.repeat(41), '教室名稱須為 1 至 40 字，請縮短後重試。'],
    ]) {
      const response = await create(name);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: 'INVALID_NAME', message });
      expect(await listIds()).toEqual([c.room.id]);
    }
    const longest = '👩‍🏫'.repeat(40);
    const created = [];
    for (const name of ['字', longest, longest]) {
      const response = await create(name);
      expect(response.status).toBe(201);
      const entry = await response.json();
      expect(entry.name).toBe(name);
      created.push(entry);
    }
    expect(new Set(created.map(entry => entry.id)).size).toBe(3);
    expect(new Set(created.map(entry => entry.activityId)).size).toBe(3);
    expect(created[0].activityId).not.toBe(c.activity.id);
    const group = await c.group();
    const member = await c.student(group.joinCode);
    expect((await c.request('/classrooms', member.headers)).status).toBe(403);
    for (const room of created) {
      expect((await c.request('/classrooms/' + room.id, c.teacher, undefined, 'DELETE')).status).toBe(204);
    }
    const missing = await c.request('/classrooms/' + created[0].id);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'CLASSROOM_NOT_FOUND', message: '找不到教室，請返回教室列表。' });
    expect(await listIds()).toEqual([c.room.id]);
  } finally { await c.close(); }
});
