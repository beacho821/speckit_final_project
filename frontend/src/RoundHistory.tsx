import { useEffect, useState } from 'react';
import type { RoundResultLine, SessionResponse } from '../../shared/api';
import { activityHeaders } from './api';

export default function RoundHistory({ session, credential, roundIds, snapshot }: { session: SessionResponse; credential: string; roundIds: string[]; snapshot?: number }) {
  const [history, setHistory] = useState<Array<{ id: string; rows: RoundResultLine[] }>>([]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all(roundIds.map(async id => {
      try {
        const response = await fetch(`/api/rounds/${id}/results`, { headers: activityHeaders(session, credential), signal: controller.signal });
        return response.ok ? { id, rows: await response.json() as RoundResultLine[] } : null;
      } catch {
        return null;
      }
    })).then(results => {
      if (!controller.signal.aborted) setHistory(previous => roundIds.flatMap((id, index) => {
        const result = results[index] ?? previous.find(entry => entry.id === id);
        return result ? [result] : [];
      }));
    });
    return () => controller.abort();
  }, [roundIds.join('|'), session.activityId, session.role, session.groupId, credential, snapshot]);

  if (!history.length) return null;
  return <div className="results-list">{history.map(round => {
    const first = round.rows[0];
    const winner = first?.groups.find(group => group.groupId === first.winnerGroupId);
    return <article key={round.id}>
      <strong>已公布回合</strong>
      <p>{winner ? `勝組：${winner.groupName}` : '無勝組'}</p>
      {round.rows.map(row => <div className="history-question" key={row.questionId}>
        <p className="question-prompt"><b>{row.questionId}</b> {row.prompt}</p>
        {row.groups.map(group => <p className="question-prompt" key={group.groupId}>
          <span>{group.groupName} · {group.status}</span>
          {group.rank !== null ? ` · 第 ${group.rank} 順位` : ''}
          {typeof group.correct === 'boolean' ? (group.correct ? ' · 答對' : ' · 答錯') : ''}
          {group.answer ? `：${group.answer}` : ''}
        </p>)}
        {row.teacherAnswer !== undefined && <p className="question-prompt"><strong>老師補答</strong> {row.teacherAnswer}</p>}
      </div>)}
    </article>;
  })}</div>;
}
