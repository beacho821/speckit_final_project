import { describe, it, expect } from 'vitest';
import { createActivity } from '../../backend/src/activity.js';
describe('活動初始資料', () => {
  it('新活動為空，碼表與成員沒有公開在組別', () => { const a = createActivity(); expect(a.groups).toEqual([]); expect(a.joinCodes.size).toBe(0); expect(a.members.size).toBe(0); expect(a.rosterVersion).toBe(0); });
  it('重啟建立不同活動且不繼承撤銷碼', () => { const a = createActivity(); a.usedJoinCodes.add('測試碼'); const b = createActivity(); expect(a.id).not.toBe(b.id); expect(b.usedJoinCodes.size).toBe(0); });
});
