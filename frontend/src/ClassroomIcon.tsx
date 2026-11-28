import type { ReactNode } from 'react';

const drawings = {
  trash: <><path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14m-8 4v6m4-6v6"/></>,
  play: <path d="m8 5 10 7-10 7z" fill="currentColor" />,
  bell: <><path d="M5 16c2-2 2-4 2-7a5 5 0 0 1 10 0c0 3 0 5 2 7l1 2H4z" fill="#ffbf43" /><path d="M10 20a2.3 2.3 0 0 0 4 0M12 2v2m7-1 2 2M3 5l2-2" /></>,
  teacher: <><path d="M3 21c.7-4 4.2-6 9-6s8.3 2 9 6" fill="#ffbe58"/><path d="M6 8a6 6 0 1 1 12 0v2a6 6 0 0 1-12 0z" fill="#ffe0b5"/><path d="M6 7c2 1 4 0 6-2 1.5 2 4 2 6 2"/><path d="M6.4 9h4.7v3H7zm6.6 0h4.6l-.6 3h-4zm-2 1h2"/></>,
  student: <><path d="M3 21c.7-4 4.2-6 9-6s8.3 2 9 6" fill="#8fd0d2"/><path d="M6 8a6 6 0 1 1 12 0v2a6 6 0 0 1-12 0z" fill="#ffe0b5"/><path d="M6 8c2 .5 4-1 5-3l2 2 2-1 3 2M9.5 10h.1m4.8 0h.1"/></>,
  user: <><circle cx="12" cy="8" r="3.5"/><path d="M5 20v-2a7 7 0 0 1 14 0v2"/></>,
  key: <><circle cx="8" cy="9" r="4"/><path d="m11 12 8 8 2-2-2-2 1-1-2-2"/></>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
  back: <path d="M20 12H5m6-6-6 6 6 6"/>,
  exit: <><path d="M10 4H4v16h6m-1-8h12m-5-5 5 5-5 5"/></>,
  group: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3c2 .6 3 2 3 5"/></>,
  book: <><path d="M3 4h7a3 3 0 0 1 2 1 3 3 0 0 1 2-1h7v15h-7l-2 1-2-1H3zm9 1v15"/></>,
  board: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4m-4 0h8m-9-9 3-3 3 2 4-4"/></>,
  projection: <><path d="M2 4h20M4 4v12h16V4m-8 12v4m-4 1 4-2 4 2"/></>,
  pencil: <><path d="m4 15 11-11a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L9 20l-6 1zm9-9 5 5"/></>,
  trophy: <><path d="M7 3h10v6a5 5 0 0 1-10 0zm0 2H3v2c0 3 2 5 5 5m9-7h4v2c0 3-2 5-5 5m-4 2v5m-4 2h8"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
  create: <><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8m-4-4h8"/></>,
} satisfies Record<string, ReactNode>;

export function ClassroomIcon({ name }: { name: keyof typeof drawings }) {
  return <svg className="classroom-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{drawings[name]}</svg>;
}
