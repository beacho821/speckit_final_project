import { useEffect, useState } from 'react';
import type { HistoryRound, RoundResultLine, SessionResponse, StudentRoundResultLine } from '../../shared/api';
import { questionLabel } from './question-label';
import { activityHeaders, fetchStudentRoundResults, readList, requestMessage, requireOk } from './api';

export default function RoundHistory(props: { session: SessionResponse; credential: string; roundIds: string[]; snapshot?: number; onExpired?: () => void }) {
  return props.session.role === 'teacher' && props.session.classroomId
    ? <ClassroomHistory {...props} classroomId={props.session.classroomId} />
    : <StudentHistory {...props} />;
}

export function StudentHistory({ session, credential, roundIds, snapshot, onExpired }: {
  session: SessionResponse; credential: string; roundIds: string[]; snapshot?: number; onExpired?: () => void;
}) {
  const [history, setHistory] = useState<Array<{ id: string; rows: StudentRoundResultLine[] }>>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const roundKey = roundIds.join('|');
  useEffect(() => {
    const controller = new AbortController();
    const headers = activityHeaders(session, credential);
    setError('');
    void Promise.all(roundIds.map(async id => ({
      id, rows: await fetchStudentRoundResults(id, headers, controller.signal, onExpired),
    }))).then(results => { if (!controller.signal.aborted) setHistory(results); })
      .catch(cause => {
        if (!controller.signal.aborted) setError(requestMessage(cause, '歷史紀錄載入失敗，請確認連線後重新載入。'));
      });
    return () => controller.abort();
  }, [roundKey, session, credential, snapshot, retry, onExpired]);

  return <section className={session.role === 'student' ? 'student-history student-round' : 'student-history'}>
    <h2>歷史紀錄</h2>
    {error && <p className="error" role="alert">{error} <button className="secondary-button" onClick={() => setRetry(value => value + 1)}>重新載入</button></p>}
    {roundIds.length === 0 ? <p className="muted">目前還沒有公布的答案。</p> :
      !history && !error && <p role="status">正在載入歷史紀錄…</p>}
    <div className="results-list">{history?.filter(round => roundIds.includes(round.id)).map(round =>
      <div key={round.id}>{round.rows.map((item, index) => <article className="student-history-item" key={index}>
        <h3>{questionLabel(item)}　{item.prompt}</h3>
        <p>已回答：{item.ownAnswer ?? '未作答'}</p>
        <p className="published-answer">
          {item.ownAnswer !== null && item.correct === true
            ? <strong className="outcome-correct">正確</strong>
            : <>
              {item.ownAnswer !== null && item.correct === false && <><strong className="outcome-incorrect">錯誤</strong>{'　'}</>}
              正確答案：{item.publishedAnswer ?? '未提供'}
            </>}
        </p>
      </article>)}</div>)}</div>
  </section>;
}

function ResultRows({ rows }: { rows: RoundResultLine[] }) {
  return <>{rows.map(row => <div className="history-question" key={row.questionId}>
        <p className="question-prompt"><b>{questionLabel(row)}</b> {row.prompt}</p>
        {row.groups.map(group => <p className="question-prompt" key={group.groupId}>
          <span>{group.groupName} · {group.status}</span>
          {group.rank !== null ? ` · 第 ${group.rank} 順位` : ''}
          {typeof group.correct === 'boolean' ? (group.correct ? ' · 答對' : ' · 答錯') : ''}
          {group.answer ? `：${group.answer}` : ''}
        </p>)}
        {row.teacherAnswer !== undefined && <p className="question-prompt"><strong>老師補答</strong> {row.teacherAnswer}</p>}
      </div>)} </>;
}

function ClassroomHistory({ session, credential, classroomId, roundIds, snapshot }: {
  session: SessionResponse; credential: string; classroomId: string; roundIds: string[]; snapshot?: number;
}) {
  const [history, setHistory] = useState<HistoryRound[]>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const base = '/api/classrooms/' + encodeURIComponent(classroomId);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(base + '/results', { headers: activityHeaders(session, credential), signal: controller.signal }).then(async response => {
      await requireOk(response);
      const list = await readList<HistoryRound>(response);
      if (!controller.signal.aborted) { setHistory(list); setError(''); }
    }).catch(cause => { if (!controller.signal.aborted) setError(requestMessage(cause, '已定案答案載入失敗，請確認連線後重新載入頁面。')); });
    return () => controller.abort();
  }, [base, session, credential, roundIds.join('|'), snapshot, retry]);
  const sections = new Map<string, HistoryRound[]>();
  for (const round of history ?? []) {
    sections.set(round.activityId, [...(sections.get(round.activityId) ?? []), round]);
  }
  return <section className="classroom-history">
    <h2>已定案答案</h2>
    {!history && !error && <p role="status">正在載入歷史紀錄…</p>}
    {history?.length === 0 && <p className="muted">尚無定案紀錄。</p>}
    {error && <p className="error" role="alert">{error} <button className="secondary-button" onClick={() => setRetry(value => value + 1)}>重新載入</button></p>}
    {[...sections].map(([id, rounds]) => <section key={id}>
      <h3>{id === session.activityId ? '目前活動' : new Date(rounds[0].startedAt).toLocaleString('zh-TW')}</h3>
      {rounds.map(round => <HistoryDetail key={round.roundId} {...{ base, round, session, credential }} />)}
    </section>)}
  </section>;
}

function HistoryDetail({ base, round, session, credential }: { base: string; round: HistoryRound; session: SessionResponse; credential: string }) {
  const [opened, setOpened] = useState(false);
  const [rows, setRows] = useState<RoundResultLine[]>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!opened || rows) return;
    const controller = new AbortController();
    void fetch(base + '/activities/' + round.activityId + '/rounds/' + round.roundId + '/results', {
      headers: activityHeaders(session, credential), signal: controller.signal,
    }).then(async response => {
      await requireOk(response);
      const data = await readList<RoundResultLine>(response);
      if (!controller.signal.aborted) { setRows(data); setError(''); }
    }).catch(cause => { if (!controller.signal.aborted) setError(requestMessage(cause, '回合答案載入失敗，請確認連線後重新載入頁面。')); });
    return () => controller.abort();
  }, [opened, rows, base, round.activityId, round.roundId, session, credential, retry]);
  return <details onToggle={event => setOpened(event.currentTarget.open)}>
    <summary>{round.questionNumber === undefined ? round.title : questionLabel(round)} · {round.winnerGroupName ? '勝組 ' + round.winnerGroupName : '無勝組'}</summary>
    {rows ? <ResultRows rows={rows} />
      : error ? <p role="alert">{error} <button className="secondary-button" onClick={() => { setError(''); setRetry(value => value + 1); }}>重試</button></p>
        : <p role="status">正在載入答案…</p>}
  </details>;
}
