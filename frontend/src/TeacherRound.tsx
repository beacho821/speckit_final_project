import { useEffect, useState } from 'react';
import type { ActivityView, RoundQuestion, SessionResponse } from '../../shared/api';
import { activityHeaders, readError } from './api';
import RoundHistory from './RoundHistory';
import ManualQuestion from './ManualQuestion';
import RoundReview from './RoundReview';

export type TeacherAction = (path: string, body?: unknown, method?: 'POST' | 'PATCH') => Promise<boolean>;

interface Props {
  session: SessionResponse;
  credential: string;
  view: ActivityView | null;
  syncError?: string;
  blocked?: boolean;
  refresh?: () => void;
  fullSnapshot?: number;
  onExpired?: () => void;
}

interface QuestionEdit {
  questionRevision: number;
  prompt?: string;
  acceptedAnswersText?: string;
}

interface QuestionDraft {
  questionId: string;
  edit: QuestionEdit;
}

export default function TeacherRound({ session, credential, view, syncError = '', blocked = false, refresh, fullSnapshot, onExpired }: Props) {
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [unknownAt, setUnknownAt] = useState<number | undefined>();
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});
  const awaitingSnapshot = unknownAt !== undefined && fullSnapshot !== undefined && fullSnapshot <= unknownAt;
  const disabled = blocked || busy || awaitingSnapshot;
  useEffect(() => { setSelected(''); }, [view?.roundId, view?.worksheetPreview?.source.importedAt]);
  useEffect(() => { setDrafts({}); }, [session.activityId]);
  useEffect(() => {
    if (unknownAt !== undefined && fullSnapshot !== undefined && fullSnapshot > unknownAt) {
      setUnknownAt(undefined);
      setMessage('已取得最新課堂狀態，請核對操作是否完成。');
    }
  }, [fullSnapshot, unknownAt]);

  const action: TeacherAction = async (path, body, method = 'POST') => {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(path, {
        method,
        headers: { ...activityHeaders(session, credential), 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        const issue = await readError(response);
        if (response.status === 401 || issue.code === 'ACTIVITY_EXPIRED') onExpired?.();
        else {
          setMessage(issue.message);
          if (response.status === 409 || response.status === 404) refresh?.();
        }
        return false;
      }
      setMessage('操作已完成。');
      setUnknownAt(undefined);
      refresh?.();
      return true;
    } catch {
      setUnknownAt(fullSnapshot);
      setMessage('操作結果待確認，請等待最新課堂狀態，再核對目前資料。');
      refresh?.();
      return false;
    } finally {
      setBusy(false);
    }
  };

  function draftKey(questionKey: string) {
    return JSON.stringify([view?.roundId, view?.worksheetPreview?.source.importedAt, questionKey]);
  }

  function editQuestion(question: RoundQuestion, patch: Partial<QuestionEdit>) {
    const key = draftKey(question.questionKey);
    setDrafts(current => ({
      ...current,
      [key]: {
        questionId: question.questionId,
        edit: { ...(current[key]?.edit ?? { questionRevision: question.questionRevision }), ...patch },
      },
    }));
  }

  async function saveQuestion(question: RoundQuestion, edit: QuestionEdit) {
    const key = draftKey(question.questionKey);
    if (!await action(`/api/questions/${question.questionKey}`, edit, 'PATCH')) return;
    setDrafts(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  if (!view) return <section className="round-panel"><h2>課堂回合</h2><p className="muted">{syncError || '正在連線並取得課堂狀態…'}</p></section>;
  const canPrepare = view.phase === 'idle' || view.phase === 'preparing';
  const editableQuestions = view.phase === 'preparing' ? view.editableQuestions ?? [] : [];
  const editableKeys = new Set(editableQuestions.map(question => draftKey(question.questionKey)));
  const activeDraft = Object.keys(drafts).some(key => editableKeys.has(key));
  const archivedDrafts = Object.entries(drafts).filter(([key]) => !editableKeys.has(key));
  const choice = view.availableUnits?.find(unit => unit.unitId === selected);
  const roundPath = view.roundId ? `/api/rounds/${view.roundId}` : undefined;
  const title = { idle: '尚未開題', preparing: '準備中', active: '進行中', reviewing: '待確認判分', ended: '已公布' }[view.phase];

  return <section className="round-panel">
    <div className="section-heading"><div><p className="eyebrow">課堂回合</p><h2>{title}</h2></div></div>
    {syncError && <p className="error" role="status">{syncError}</p>}
    {canPrepare && <div className="form-stack">
      <label htmlFor="unit">{view.phase === 'preparing' ? '更換準備中的題目' : '選擇尚未使用的題目'}</label>
      <select id="unit" disabled={disabled} value={selected || (view.phase === 'preparing' ? view.unit?.id ?? '' : '')} onChange={event => setSelected(event.target.value)}>
        <option value="">請選擇題目</option>
        {view.availableUnits?.map(unit => <option key={unit.unitId} value={unit.unitId}>{unit.questionIds.join('、')}</option>)}
      </select>
      {choice?.unitId !== view.unit?.id && choice?.questions?.map(question =>
        <p className="question-prompt" key={question.questionId}><b>{question.questionId}</b> {question.prompt ?? '缺少題目'}</p>)}
      <button className="primary" disabled={!selected || disabled} onClick={() => void action('/api/rounds', { unitId: selected })}>{view.phase === 'preparing' ? '更換準備題目' : '準備這一題'}</button>
    </div>}
    {canPrepare && <ManualQuestion disabled={disabled} onAdd={(questionId, prompt) => action('/api/questions', { questionId, prompt })} />}
    {view.unit && <div className="question-chip">題號：{view.unit.questionIds.join('、')}</div>}
    {view.unit?.questions?.map(question => <p className="question-prompt" key={question.questionId}><b>{question.questionId}</b> {question.prompt ?? '缺少題目'}</p>)}
    {view.phase === 'preparing' && roundPath && <>
      {editableQuestions.map(question => {
        const draft = drafts[draftKey(question.questionKey)]?.edit;
        const stale = draft !== undefined && draft.questionRevision !== question.questionRevision;
        return <fieldset className="form-stack question-editor" key={question.questionKey} disabled={disabled}>
          <legend>第 {question.questionId} 題</legend>
          <label>題目<textarea rows={2} value={draft?.prompt ?? question.prompt ?? ''} onChange={event => editQuestion(question, { prompt: event.target.value })} /></label>
          <label>標準答案（一行一種答案）<textarea rows={3} value={draft?.acceptedAnswersText ?? question.acceptedAnswers.join('\n')} onChange={event => editQuestion(question, { acceptedAnswersText: event.target.value })} /></label>
          {stale && <p role="status">此題已有更新。請核對目前題目及標準答案後再儲存。</p>}
          {stale && <p className="question-prompt">目前題目：{question.prompt ?? '缺少題目'}<br />目前標準答案：{question.acceptedAnswers.join('、') || '尚未填寫'}</p>}
          {stale && <button className="quiet" onClick={() => editQuestion(question, { questionRevision: question.questionRevision })}>使用最新版本並保留輸入</button>}
          <button className="secondary-button" disabled={!draft || stale} onClick={() => draft && void saveQuestion(question, draft)}>儲存第 {question.questionId} 題</button>
        </fieldset>;
      })}
      <button className="primary" disabled={disabled || !view.groups?.length || activeDraft} onClick={() => void action(`${roundPath}/start`)}>開始搶答</button>
    </>}
    {archivedDrafts.length > 0 && <details open className="question-editor">
      <summary>已失效的備課草稿（可複製）</summary>
      {archivedDrafts.map(([key, { questionId, edit }]) => <fieldset className="form-stack question-editor" key={key}>
        <legend>原第 {questionId} 題</legend>
        {edit.prompt !== undefined && <label>原題幹草稿<textarea rows={2} readOnly value={edit.prompt} /></label>}
        {edit.acceptedAnswersText !== undefined && <label>原標準答案草稿<textarea rows={3} readOnly value={edit.acceptedAnswersText} /></label>}
      </fieldset>)}
    </details>}
    {view.phase === 'active' && roundPath && <button className="danger-button" disabled={disabled} onClick={() => void action(`${roundPath}/end`)}>停止收件</button>}
    {view.phase === 'reviewing' && roundPath && view.review && <RoundReview
      key={roundPath} roundPath={roundPath} questions={view.unit?.questions ?? []} groups={view.groups ?? []}
      review={view.review} disabled={disabled} action={action} />}
    {view.groups && view.phase !== 'reviewing' && <div className="group-progress">{view.groups.map(group => <article className="progress-card" key={group.id}>
      <div><strong>{group.name}</strong><span className={group.received ? 'status received' : 'status'}>{group.received ? `已送出 · 第 ${group.rank} 順位` : '尚未送出'}</span></div>
      {group.answers?.map(answer => <p key={answer.questionId}><span>{answer.questionId}</span>{answer.text}</p>)}
    </article>)}</div>}
    {message && <p className="muted" role="status">{message}</p>}
    {view.closedRoundIds.length > 0 && <RoundHistory session={session} credential={credential} roundIds={view.closedRoundIds} snapshot={fullSnapshot} />}
  </section>;
}
