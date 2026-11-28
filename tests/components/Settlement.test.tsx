// @vitest-environment jsdom
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import Settlement from '../../frontend/src/Settlement';
import { click, host, render } from '../helpers/ui';

const groups = [1, 2, 3, 3, 5].map((rank, i) => ({ rank, points: 5 - rank, name: '組別' + i, id: String(i) }));
const settlement = { roundCount: 3, groups };
const revealed = () => [...host.querySelectorAll('.award-step li strong')].map(el => el.textContent);
const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });

it('由銅到金逐級揭曉，並列一起登台，輪詢不重播，其他組別於最後公布', async () => {
  vi.useFakeTimers();
  try {
    await render(<Settlement settlement={settlement} ownGroupId="0" />);
    expect(revealed()).toEqual([]);
    expect(host.textContent).not.toContain('組別0');
    await advance(650);
    expect(revealed()).toEqual(['組別2', '組別3']);
    await advance(1000);
    await render(<Settlement settlement={structuredClone(settlement)} ownGroupId="0" />);
    await advance(850);
    expect(revealed()).toEqual(['組別2', '組別3', '組別1']);
    expect(host.querySelector('.award-effects')).toBeNull();
    await advance(1850);
    expect(revealed()).toContain('組別0');
    expect(host.querySelector('.award-effects')).not.toBeNull();
    expect(host.textContent).toContain('組別4');
    await click('重播頒獎');
    expect(revealed()).toEqual([]);
    await click('略過動畫');
    expect(revealed()).toHaveLength(4);
    expect(host.querySelector('.award-effects')).toBeNull();
  } finally { vi.useRealTimers(); }
});

it('並列冠軍略過第二名，從教師靜態預覽切換公布時重新揭曉', async () => {
  const tie = { ...settlement, groups: [groups[0], { ...groups[1], rank: 1, points: groups[0].points }, groups[2]] };
  vi.useFakeTimers();
  try {
    await render(<Settlement settlement={tie} preview />);
    expect(revealed()).toHaveLength(3);
    await render(<Settlement settlement={tie} />);
    expect(revealed()).toEqual([]);
    expect(host.querySelector('[data-rank="2"]')).toBeNull();
    await advance(650); await advance(1850);
    expect(host.textContent).toContain('並列第一名');
    expect(revealed()).toHaveLength(3);
  } finally { vi.useRealTimers(); }
});
