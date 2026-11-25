import { useEffect, useRef, useState } from 'react';
import type { ActivityView, SessionResponse, StudentRoundResultLine } from '../../shared/api';
import { activityHeaders, fetchStudentRoundResults, readError, requestMessage } from './api';
import { questionLabel } from './question-label';
import Settlement from './Settlement';

const waitRejected = '送出時尚未開放，答案草稿已保留。';

export default function StudentRound({ session, credential, view, syncError = '', refresh, fullSnapshot, onExpired }: { session: SessionResponse; credential: string; view: ActivityView|null; syncError?: string; blocked?: boolean; refresh?: () => void; fullSnapshot?: number; onExpired?: () => void }) {
  const [drafts, setDrafts] = useState<Map<string, string>>(() => new Map());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<number>();
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const scope = JSON.stringify([session.classroomId, session.activityId, session.activityEpoch, session.groupId, view?.roundId]);
  const submittedRound = useRef<string | undefined>(scope);
  const submissionInFlight = useRef(false);
  const deadline = useRef(0);
  const [remainingMs, setRemainingMs] = useState(view?.waitRemainingMs ?? 0);
  useEffect(() => {
    submittedRound.current = scope;
    submissionInFlight.current = false;
    setError(''); setDrafts(new Map()); setPending(undefined); setBusy(false);
    return () => { submittedRound.current = undefined; };
  }, [scope]);
  useEffect(() => {
    if (view?.received) { setPending(undefined); receiptHeading.current?.focus(); }
  }, [view?.received]);
  useEffect(() => {
    if (pending !== undefined && fullSnapshot !== undefined && fullSnapshot > pending) {
      setPending(undefined);
    }
  }, [pending, fullSnapshot]);
  useEffect(() => {
    const waiting = view?.phase === 'active' ? view.waitRemainingMs ?? 0 : 0;
    deadline.current = performance.now() + waiting;
    setRemainingMs(waiting);
    if (view?.phase !== 'active') return;
    const update = () => setRemainingMs(Math.max(0, deadline.current - performance.now()));
    const timer = setInterval(update, 100);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [view?.waitRemainingMs, view?.phase, scope]);

  async function submit() {
    if (!view?.roundId || !view.unit || view.phase !== 'active' || view.received || submissionInFlight.current
      || pending !== undefined || performance.now() < deadline.current) return;
    submissionInFlight.current = true;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/rounds/${view.roundId}/submissions`, { method: 'POST', headers: { ...activityHeaders(session, credential), 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: view.unit.questionIds.map(questionId => ({ questionId, text: drafts.get(questionId) ?? '' })) }) });
      if (submittedRound.current !== scope) return;
      if (!response.ok) {
        const issue = await readError(response);
        if (submittedRound.current !== scope) return;
        if (response.status === 401 || issue.code === 'ACTIVITY_EXPIRED') onExpired?.();
        else {
          const missing: unknown = issue.details?.missingQuestionIds;
          const questions = view.unit.questions ?? [];
          const labels = issue.code === 'INVALID_ANSWERS' && Array.isArray(missing)
            ? questions.filter(question => question.questionNumber !== undefined && missing.includes(question.questionId)).map(questionLabel)
            : [];
          const wait: unknown = issue.details?.waitRemainingMs;
          if (issue.code === 'WAIT_REQUIRED' && typeof wait === 'number' && Number.isFinite(wait) && wait > 0) {
            deadline.current = performance.now() + wait;
            setRemainingMs(wait);
            setError(waitRejected);
          } else setError(labels.length ? `${labels.join('、')}尚未填答，請補齊後一起送出。` : issue.message);
          if (issue.code === 'ALREADY_RECEIVED' || issue.code === 'ROUND_EXPIRED') {
            setPending(fullSnapshot ?? 0); refresh?.();
          }
        }
      } else {
        setPending(fullSnapshot ?? 0); refresh?.();
      }
    } catch {
      if (submittedRound.current === scope) {
        setPending(fullSnapshot ?? 0);
        setError('送出結果待確認，草稿已保留。請等待同步收件狀態，不會自動重送。'); refresh?.();
      }
    } finally {
      if (submittedRound.current === scope) {
        submissionInFlight.current = false;
        setBusy(false);
      }
    }
  }
  if (!view) return <section className="round-panel"><h2>學生作答</h2><p className="muted">{syncError || '正在連線並取得課堂狀態…'}</p></section>;
  if (view.settlement) return <div className="student-round">
    {syncError && <p className="error" role="status">{syncError}</p>}
    <Settlement settlement={view.settlement} ownGroupId={session.groupId} />
  </div>;
  const title = view.received ? (view.phase === 'ended' ? '本組作答結果' : '本組已鎖定送出') : {
    active: '請完成本回合答案',
    reviewing: '已停止收件，等待老師公布結果',
    ended: '本組未作答',
    preparing: '等待老師準備題目',
    idle: '等待老師準備題目',
  }[view.phase];
  const labelFor = (id: string) => questionLabel(view.unit?.questions?.find(question => question.questionId === id) ?? { questionId: id });
  return <section className="round-panel student-round"><h2 ref={receiptHeading} tabIndex={-1} aria-live="polite">{title}</h2>
    {syncError && <p className="error" role="status">{syncError}</p>}
    {view.unit && view.phase !== 'preparing' && <>
      {view.phase === 'active' && !view.received && <>
        <div className="answer-list">{view.unit.questionIds.map(questionId => <label key={questionId}><strong>{labelFor(questionId)}</strong><span className="question-prompt">{view.unit?.questions?.find(question => question.questionId === questionId)?.prompt}</span><textarea rows={2} value={drafts.get(questionId) ?? ''} onChange={event => setDrafts(previous => new Map(previous).set(questionId, event.target.value))} /></label>)}</div>
        <p className="muted">{remainingMs > 0 ? `其他組別優先送出中。你可以先填答，還有 ${Math.ceil(remainingMs / 1000)} 秒可送出。` : '請填妥所有題目後一次送出。'}</p>
        {error && (error !== waitRejected || remainingMs > 0) && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy || pending !== undefined || remainingMs > 0} onClick={() => void submit()}>{busy ? '送出中…' : pending !== undefined ? '等待收件確認…' : '送出本組答案'}</button></>}
      {(view.received || view.phase === 'reviewing') && view.unit.questions?.map(question =>
        <p className="question-prompt" key={question.questionId}><b>{questionLabel(question)}</b> {question.prompt}</p>)}
      {view.received && <AnswerFeedback key={scope} {...{ view, session, credential, labelFor, onExpired }}
        questionIds={view.unit.questionIds} />}
    </>}
  </section>;
}

function AnswerFeedback({ view, session, credential, labelFor, onExpired, questionIds }: {
  view: ActivityView; session: SessionResponse; credential: string; labelFor: (id: string) => string;
  onExpired?: () => void; questionIds: string[];
}) {
  const [published, setPublished] = useState<StudentRoundResultLine[]>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const ended = view.phase === 'ended';
  const roundId = ended && view.ownAnswers?.some(answer => answer.correct === false && !answer.publishedAnswer?.trim())
    ? view.roundId : null;

  useEffect(() => {
    if (!roundId) return;
    const controller = new AbortController();
    void fetchStudentRoundResults(roundId, activityHeaders(session, credential), controller.signal, onExpired)
      .then(rows => { if (!controller.signal.aborted) setPublished(rows); })
      .catch(cause => {
        if (!controller.signal.aborted) setError(requestMessage(cause, '無法載入正確答案，請重試。'));
      });
    return () => controller.abort();
  }, [roundId, session, credential, onExpired, retry]);

  return <div className="answer-feedback" aria-live="polite">
    {!ended && <p className="muted">本組答案已收件，請等待老師公布結果。</p>}
    {view.ownAnswers?.map(answer => {
      // The results endpoint returns the frozen round's questions in the same order as the view.
      const row = published?.length === questionIds.length ? published[questionIds.indexOf(answer.questionId)] : undefined;
      const reference = answer.publishedAnswer?.trim() ? answer.publishedAnswer
        : row?.correct === false && row.ownAnswer === answer.text ? row.publishedAnswer : undefined;
      return <div key={answer.questionId}
        className={answer.correct === true ? 'answer-feedback-correct' : answer.correct === false ? 'answer-feedback-incorrect' : undefined}>
        {answer.correct !== undefined && <strong>{answer.correct ? '正確' : '錯誤'}</strong>}
        <p>{labelFor(answer.questionId)}：{answer.text}</p>
        {ended && answer.correct === false && <p className="answer-feedback-reference">
          <strong>正確答案：</strong>{reference ?? (error ? '載入失敗' : published ? '未提供' : '載入中…')}
        </p>}
      </div>;
    })}
    {roundId && error && <p className="error">{error} <button className="secondary-button"
      onClick={() => { setError(''); setRetry(value => value + 1); }}>重新載入</button></p>}
  </div>;
}
