import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ActivityView, SessionResponse, StudentRoundResultLine } from '../../shared/api';
import { activityHeaders, fetchStudentRoundResults, readError, requestMessage } from './api';
import { questionLabel } from './question-label';
import { hasQuestionParts, QuestionKind } from './QuestionKind';
import Settlement from './Settlement';
import type { TimedSnapshot } from './SubmissionAvailability';

const waitRejected = '送出時尚未開放，答案草稿已保留。';

export default function StudentRound({ session, credential, view, syncError = '', refresh, fullSnapshot, onExpired }: { session: SessionResponse; credential: string; view: TimedSnapshot<ActivityView>|null; syncError?: string; blocked?: boolean; refresh?: () => void; fullSnapshot?: number; onExpired?: () => void }) {
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
  useLayoutEffect(() => {
    const elapsed = view?.sampledAt === undefined ? 0 : Math.max(0, Date.now() - view.sampledAt);
    const waiting = view?.phase === 'active' ? Math.max(0, (view.waitRemainingMs ?? 0) - elapsed) : 0;
    deadline.current = performance.now() + waiting;
    setRemainingMs(waiting);
    if (view?.phase !== 'active') return;
    const update = () => setRemainingMs(Math.max(0, deadline.current - performance.now()));
    const timer = setInterval(update, 100);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [view?.waitRemainingMs, view?.sampledAt, view?.phase, scope]);

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
  const unanswered = !view.received && view.phase === 'ended';
  const cooldownMs = view.cooldownMs ?? 0;
  const title = view.received ? (view.phase === 'ended' ? '本組作答結果' : '本組已鎖定送出') : {
    active: remainingMs > 0 ? '請先閱讀本回合題目' : '請完成本回合答案',
    reviewing: '已停止收件，等待老師公布結果',
    ended: '本組未作答',
    preparing: '等待老師準備題目',
    idle: '等待老師準備題目',
  }[view.phase];
  const labelFor = (id: string) => questionLabel(view.unit?.questions?.find(question => question.questionId === id) ?? { questionId: id });
  const questionCount = view.unit?.questionIds.length ?? 0;
  const showQuestions = view.phase !== 'preparing' && questionCount > 0;
  const grouped = hasQuestionParts(view.unit?.questions ?? view.unit?.questionIds.map(questionId => ({ questionId })) ?? []);
  return <section className={unanswered ? 'round-panel student-round unanswered-round' : 'round-panel student-round'}
    data-receipt={view.received && view.phase !== 'ended' ? 'locked' : undefined}>
    {(view.phase === 'idle' || view.phase === 'preparing') && <span className="waiting-art" aria-hidden="true" />}
    <h2 ref={receiptHeading} tabIndex={-1} aria-live="polite">{title}</h2>
    {syncError && <p className="error" role="status">{syncError}</p>}
    {!view.received && view.phase === 'reviewing' && <p className="muted">本組尚未送出答案。結果公布後，可在這裡查看正確答案。</p>}
    {unanswered && <p className="muted unanswered-round-summary">本回合已結束。</p>}
    <div className={showQuestions ? 'question-unit' : undefined} data-grouped={grouped}>
    {showQuestions && <QuestionKind grouped={grouped} count={questionCount} />}
    {view.unit && view.phase !== 'preparing' && <>
      {view.phase === 'active' && !view.received && <>
        {cooldownMs > 0 && <p><strong>本組本回合冷卻 {cooldownMs / 1000} 秒</strong>（依前兩題得標情況與近期答對率計算）</p>}
        <p className="muted" id="answer-availability">{remainingMs > 0 ? `冷卻中，可先讀題。剩 ${(Math.ceil(remainingMs / 100) / 10).toFixed(1)} 秒開放填答與送出。`
          : cooldownMs > 0 ? '冷卻已結束，現在可以填答與送出。' : '本組可立即搶答，請填妥所有題目後一次送出。'}</p>
        <div className="answer-list">{view.unit.questionIds.map(questionId => <label key={questionId}>
          <strong>{labelFor(questionId)}</strong>
          <span className="question-prompt">{view.unit?.questions?.find(question => question.questionId === questionId)?.prompt}</span>
          <textarea rows={2} disabled={remainingMs > 0} aria-describedby={remainingMs > 0 ? 'answer-availability' : undefined}
            value={drafts.get(questionId) ?? ''} onChange={event => setDrafts(previous => new Map(previous).set(questionId, event.target.value))} />
        </label>)}</div>
        {error && (error !== waitRejected || remainingMs > 0) && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy || pending !== undefined || remainingMs > 0} onClick={() => void submit()}>{busy ? '送出中…' : pending !== undefined ? '等待收件確認…' : '送出本組答案'}</button></>}
      {(view.received || view.phase === 'reviewing') && view.unit.questions?.filter(question =>
        !view.received || !view.ownAnswers?.some(answer => answer.questionId === question.questionId)).map(question =>
        <div className="question-block" key={question.questionId}><strong className="part-label">{questionLabel(question)}</strong><p className="question-prompt">{question.prompt}</p></div>)}
    </>}
    {(unanswered || (view.received && view.unit && view.phase !== 'preparing')) &&
      <AnswerFeedback key={scope} {...{ view, session, credential, labelFor, onExpired }} />}
    </div>
  </section>;
}

function AnswerFeedback({ view, session, credential, labelFor, onExpired }: {
  view: ActivityView; session: SessionResponse; credential: string; labelFor: (id: string) => string;
  onExpired?: () => void;
}) {
  const [published, setPublished] = useState<StudentRoundResultLine[]>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const ended = view.phase === 'ended';
  const roundId = ended && (!view.received || view.ownAnswers?.some(answer => answer.correct === false && !answer.publishedAnswer?.trim()))
    ? view.roundId : null;
  const questionIds = view.unit?.questionIds ?? [];

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

  const loadError = roundId && error && <p className="error" role="alert">{error} <button className="secondary-button"
    onClick={() => { setError(''); setRetry(value => value + 1); }}>重新載入</button></p>;

  if (!view.received) return <div className="unanswered-results">
    {published?.length ? <ul className="unanswered-results-list" role="list">
      {published.map((row, index) => <li className="question-block" key={index}>
        <h3>{questionLabel(row)}</h3>
        {row.prompt && <p className="question-prompt">{row.prompt}</p>}
        <p className="unanswered-reference"><strong>正確答案：</strong>{row.publishedAnswer?.trim() ? row.publishedAnswer : '未提供'}</p>
      </li>)}
    </ul> : <>
      {view.unit?.questions?.map(question => <p className="question-prompt question-block" key={question.questionId}>
        <b>{questionLabel(question)}</b> {question.prompt}
      </p>)}
      {!error && <p className="muted" role="status">{roundId && !published ? '正在載入正確答案…' : '本回合沒有可顯示的正確答案。'}</p>}
    </>}
    {loadError}
  </div>;

  return <div className="answer-feedback" aria-live="polite">
    {!ended && <p className="muted">本組答案已收件，請等待老師公布結果。</p>}
    {view.ownAnswers?.map(answer => {
      const prompt = view.unit?.questions?.find(question => question.questionId === answer.questionId)?.prompt;
      if (!ended) return <article className="question-block receipt-question" key={answer.questionId}>
        <strong className="part-label">{labelFor(answer.questionId)}</strong>
        {prompt && <h3 className="question-prompt">{prompt}</h3>}
        <div className="receipt-answer"><span>本組答案</span><p>{answer.text}</p></div>
      </article>;
      // The results endpoint returns the frozen round's questions in the same order as the view.
      const row = published?.length === questionIds.length ? published[questionIds.indexOf(answer.questionId)] : undefined;
      const reference = answer.publishedAnswer?.trim() ? answer.publishedAnswer
        : row?.correct === false && row.ownAnswer === answer.text ? row.publishedAnswer : undefined;
      return <div key={answer.questionId}
        className={answer.correct === true ? 'answer-feedback-correct' : answer.correct === false ? 'answer-feedback-incorrect' : undefined}>
        {prompt && <p className="question-prompt">{prompt}</p>}
        {answer.correct !== undefined && <strong>{answer.correct ? '正確' : '錯誤'}</strong>}
        <p>{labelFor(answer.questionId)}：{answer.text}</p>
        {ended && answer.correct === false && <p className="answer-feedback-reference">
          <strong>正確答案：</strong>{reference ?? (error ? '載入失敗' : published ? '未提供' : '載入中…')}
        </p>}
      </div>;
    })}
    {loadError}
  </div>;
}
