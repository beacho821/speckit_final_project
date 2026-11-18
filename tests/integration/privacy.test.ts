import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { classroom } from '../helpers/classroom.js';
import { worksheet } from '../helpers/worksheet.js';

async function filesUnder(root: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

describe('機敏資料與角色隔離', () => {
  it('錯誤憑證、學生越權與一般 API 回應不洩露憑證或他組加入碼', async () => {
    const c = await classroom({ importWorksheet: async () => ({ worksheet: structuredClone(worksheet) }) });
    const teacherSecret = c.config.teacherPassword;
    const wrongSecret = randomUUID();
    const logs: string[] = [];
    const info = vi.spyOn(console, 'info').mockImplementation((...values) => logs.push(values.join(' ')));
    const error = vi.spyOn(console, 'error').mockImplementation((...values) => logs.push(values.join(' ')));
    try {
      const alpha = await c.group('甲組'), beta = await c.group('乙組');
      const student = await c.student(alpha.joinCode, '學生甲');
      const roster = await (await c.request('/roster')).json();
      expect(roster.groups.map((group: { joinCode: string }) => group.joinCode)).toContain(alpha.joinCode);
      const ownView = await (await c.request('/view', student.headers)).json();
      expect(JSON.stringify(ownView)).not.toContain(beta.joinCode);
      expect(ownView).not.toHaveProperty('groups');

      for (const [path, body] of [
        ['/groups', { name: '越權組' }],
        ['/worksheet/import', { url: 'fixture' }],
        ['/rounds', { unitId: 'u' }],
        ['/results.csv', undefined],
        ['/worksheet/writeback', {}],
      ] as const) {
        const response = await c.request(path, student.headers, body, path === '/results.csv' ? 'GET' : 'POST');
        expect([response.status, response.status === 403]).toEqual([403, true]);
        const text = await response.text();
        expect(text).not.toContain(teacherSecret);
        expect(text).not.toContain(beta.joinCode);
      }
      const wrong = await c.request('/sessions', { Authorization: `Basic ${Buffer.from(`student:${wrongSecret}`).toString('base64')}`, 'X-Activity-Id': c.activity.id }, { name: '陌生人' }, 'POST');
      expect(wrong.status).toBe(401);
      const wrongText = await wrong.text();
      expect(wrongText).not.toContain(alpha.joinCode);
      expect(wrongText).not.toContain(wrongSecret);
      expect(wrongText).not.toContain(teacherSecret);
      expect(c.activity.rounds).toHaveLength(0);
      expect(c.activity.groups).toHaveLength(2);

      const assets = await filesUnder(join(process.cwd(), 'dist', 'frontend', 'assets'));
      for (const asset of assets) {
        const contents = await readFile(asset, 'utf8');
        expect(contents).not.toContain(teacherSecret);
        expect(contents).not.toContain(alpha.joinCode);
        expect(contents).not.toContain(beta.joinCode);
      }
      expect(logs.join('\n')).not.toContain(teacherSecret);
      expect(logs.join('\n')).not.toContain(alpha.joinCode);
    } finally { info.mockRestore(); error.mockRestore(); await c.close(); }
  });
});
