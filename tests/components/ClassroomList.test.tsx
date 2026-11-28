// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import ClassroomList from '../../frontend/src/ClassroomList';
import { render, host, flush, input, click } from '../helpers/ui';

it('顯示我的教室及空狀態，建立後前往新教室', async () => {
  const open = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (_path, options) => Response.json(options?.method === 'POST' ? { id: '新教室' } : [])));
  await render(<ClassroomList credential="測試密碼" onOpen={open} onExpired={() => {}} />);
  await flush();
  expect(host.textContent).toContain('我的教室');
  expect(host.textContent).toContain('尚無教室');
  await input('教室名稱', '第二間');
  await click('建立教室');
  expect(open).toHaveBeenCalledWith('新教室');
});

it('依實際回合狀態篩選並在刪除後更新數量和空狀態', async () => {
  const rows = ['preparing', 'active', 'reviewing', 'ended', 'idle'].map(phase => ({ id: phase, name: phase, phase, updatedAt: 0 }));
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => options?.method === 'DELETE'
    ? new Response(null, { status: 204 }) : Response.json([...rows, { ...rows[4], id: 'offline', unavailable: true }])));
  await render(<ClassroomList credential="測試密碼" onOpen={() => {}} onExpired={() => {}} />);
  await flush();
  const names = () => [...host.querySelectorAll('.room-card h3')].map(title => title.textContent);
  await click('進行中 3');
  expect(names()).toEqual(['preparing', 'active', 'reviewing']);
  await click('已定案 1');
  expect(names()).toEqual(['ended']);
  await click('刪除教室');
  await click('確認刪除');
  await flush();
  expect(host.textContent).toContain('目前沒有符合此狀態的教室。');
  await click('全部 5');
  expect(names()).toHaveLength(5);
});

it.each([
  [() => Promise.reject(new TypeError('Failed to fetch')), '教室清單載入失敗，請確認連線後重新載入。'],
  [async () => Response.json({ status: 'unexpected' }), '教室清單載入失敗，請確認連線後重新載入。'],
  [async () => new Response('<html>'), '教室清單載入失敗，請確認連線後重新載入。'],
  [async () => Response.json({ code: 'UNAVAILABLE', message: '教室暫時無法恢復，請稍後再試。' }, { status: 503 }), '教室暫時無法恢復，請稍後再試。'],
])('連線或回應異常時顯示可操作的正體中文訊息 %#', async (reply, expected) => {
  vi.stubGlobal('fetch', vi.fn(reply));
  await render(<ClassroomList credential="測試密碼" onOpen={() => {}} onExpired={() => {}} />);
  await flush();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(expected);
  expect(host.textContent).toContain('重新載入');
});
