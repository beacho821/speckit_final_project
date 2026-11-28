export function AwardEmblem({ rank }: { rank: number }) {
  if (rank !== 1) return <svg className="award-medal" viewBox="0 0 90 90" aria-hidden="true">
    <g stroke="#493b4e" strokeWidth="2.4" strokeLinejoin="round">
      <path d="m27 51-7 30 13-6 9 9 6-29m3-3 16 29 3-13 13 1-16-25" fill={rank === 2 ? '#929ab9' : '#d7876e'} />
      <circle cx="45" cy="35" r="29" fill={rank === 2 ? '#dbe3f1' : '#f5b990'} />
      <circle cx="45" cy="35" r="23" fill="none" strokeWidth="1.5" />
      <path d="M25 25q4-9 13-11" fill="none" stroke="#fff5db" strokeWidth="3" strokeLinecap="round" />
    </g>
    <text x="45" y="45" textAnchor="middle" fontSize="30" fontWeight="800" fill="#342e46">{rank}</text>
  </svg>;
  return <svg className="award-cup" viewBox="0 0 152 112" aria-hidden="true">
    <g stroke="#513744" strokeWidth="2.7" strokeLinejoin="round" strokeLinecap="round">
      <path d="M47 22H29c-1 20 8 32 29 34m47-34h18c1 20-8 32-29 34" fill="none" stroke="#ffc765" strokeWidth="8" />
      <path d="M44 14h64l-6 30c-2 15-10 23-21 26v10l8 5H63l8-5V70C54 64 50 52 48 40z" fill="#efab45" />
      <path d="M48 17h49l-5 26c-2 11-6 19-15 23-15-3-22-14-24-29z" fill="#ffda79" stroke="none" />
      <path d="m76 28 4 8 9 1-6.5 6.4 1.7 9.2-8.2-4.5-8.2 4.5 1.6-9.2-6.5-6.4 9.1-1z" fill="#bd7b35" stroke="none" />
      <rect x="42" y="10" width="68" height="8" rx="4" fill="#ffedb3" />
      <rect x="60" y="83" width="32" height="8" rx="3" fill="#f5be62" />
      <path d="M54 91h44l5 11H49z" fill="#976e58" /><rect x="45" y="101" width="62" height="6" rx="3" fill="#e3bb7b" />
    </g>
    <g fill="#ffe7a0"><path d="m16 52 2.4 7 7 2.4-7 2.5-2.4 7-2.5-7-7-2.5 7-2.4zM124 2l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5-5.5-2 5.5-2z"/><circle cx="134" cy="57" r="2.5"/></g>
  </svg>;
}
