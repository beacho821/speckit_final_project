import { useEffect, useState } from 'react';

// 分頁收到快照時記下本機時間，投影重播同一份快照時沿用原時間。
export type TimedSnapshot<T> = T & { sampledAt?: number };

export default function SubmissionAvailability({ waitMs, sampledAt }: { waitMs?: number; sampledAt?: number }) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const deadline = (sampledAt ?? Date.now()) + (waitMs ?? 0);
    const update = () => {
      const left = Math.max(0, deadline - Date.now());
      setRemaining(left);
      return left;
    };
    if (!update()) return;
    const timer = setInterval(() => { if (!update()) clearInterval(timer); }, 100);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [waitMs, sampledAt]);
  if (waitMs === undefined) return <>尚未送出</>;
  return remaining > 0 ? <>冷卻中 · 剩 {(Math.ceil(remaining / 100) / 10).toFixed(1)} 秒</> : <>可搶答</>;
}
