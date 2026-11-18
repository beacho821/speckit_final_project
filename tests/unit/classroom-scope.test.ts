import { expect, it, vi } from 'vitest';
import { Classrooms } from '../../backend/src/classrooms';
import { addGroup } from '../../backend/src/roster';

it('隔離各教室並於同室寫入失敗時保留已提交狀態', async () => {
  const classrooms = new Classrooms({
    async save(record) {
      if (record.name === '第一間' && record.activities[0].rosterLocked) throw new Error('模擬存檔異常');
    },
    async remove() {},
  }, '測試密碼', '1');
  const first = await classrooms.create('第一間');
  const second = await classrooms.create('第二間');
  await expect(classrooms.mutate(first, first.activity, draft => { draft.rosterLocked = true; })).rejects.toMatchObject({ status: 503 });
  expect(first.activity.rosterLocked).toBe(false);
  await classrooms.mutate(second, second.activity, draft => { draft.rosterLocked = true; });
  expect(second.activity.rosterLocked).toBe(true);
  expect(classrooms.issue()).not.toBe(classrooms.issue());
});

it('學生與投影發碼均避開教師密碼及已用碼，跨世代可重用相同隨機尾碼', async () => {
  const password = ' 1-PASSWORD ';
  const classrooms = new Classrooms(undefined, password, '1');
  const room = await classrooms.create('測試教室');
  const parts = ['PASSWORD', 'GROUPONE', 'PASSWORD', 'GROUPONE', 'GROUPTWO'];
  const issue = classrooms.issue.bind(classrooms);
  vi.spyOn(classrooms, 'issue').mockImplementation(() => issue(() => parts.shift()!));

  await classrooms.mutate(room, room.activity, draft => addGroup(draft, '甲組', password, undefined, () => classrooms.issue()));
  const [{ id }] = room.activity.groups;
  expect(room.activity.joinCodes.get(id)).toBe('1-GROUPONE');
  const projectionCode = await classrooms.projectionCode(room, room.activity, id);
  expect(projectionCode).toBe('1-GROUPTWO');
  expect(classrooms.lookup(projectionCode)).toBeUndefined();
  expect(classrooms.lookup(projectionCode, true)?.groupId).toBe(id);
  expect(parts).toEqual([]);
  expect(new Classrooms(undefined, password, '2').issue(() => 'GROUPONE')).toBe('2-GROUPONE');
});
