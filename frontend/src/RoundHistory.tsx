import { useEffect, useState } from 'react';
import type { RoundResultLine, SessionResponse } from '../../shared/api';
import { activityHeaders } from './api';

export default function RoundHistory({ session, credential, roundIds }: { session: SessionResponse; credential: string; roundIds: string[] }) {
  const [history, setHistory] = useState<Array<{ id: string; rows: RoundResultLine[] }>>([]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all(roundIds.map(async id => {
      const response = await fetch(`/api/rounds/${id}/results`, { headers: activityHeaders(session, credential), signal: controller.signal });
      return response.ok ? { id, rows: await response.json() as RoundResultLine[] } : null;
    })).then(results => setHistory(results.filter((item): item is { id: string; rows: RoundResultLine[] } => item !== null))).catch(() => undefined);
    return () => controller.abort();
  }, [roundIds.join('|'), session.activityId, session.role, session.groupId, credential]);
  if (!history.length) return null;
  return <div className="results-list">{history.map(round => <article key={round.id}><strong>已結束回合</strong>{round.rows.map(row => <div className="history-question" key={row.questionId}><b>{row.questionId}</b>{row.groups.map(group => <p key={group.groupId}><span>{group.groupName} · {group.status}</span>{group.rank ? ` · 第 ${group.rank} 順位` : ''}{group.answer ? `：${group.answer}` : ''}</p>)}</div>)}</article>)}</div>;
}
