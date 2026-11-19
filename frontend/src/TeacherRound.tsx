import { useEffect, useRef, useState } from 'react';
import type { ActivityView, CatalogUnit, RoundQuestion, SessionResponse } from '../../shared/api';
import { activityHeaders, readError } from './api';
import RoundHistory from './RoundHistory';
import ManualQuestion from './ManualQuestion';
import RoundReview from './RoundReview';
import QuestionQueue from './QuestionQueue';
import { questionLabel } from './question-label';

export type TeacherAction = (path: string, body?: unknown, method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE') => Promise<boolean>;

interface Props {
  session: SessionResponse;
  credential: string;
  view: ActivityView | null;
  syncError?: string;
  blocked?: boolean;
  refresh?: () => number;
  completedRefresh?: number;
  fullSnapshot?: number;
  onExpired?: () => void;
  mode?: 'settings' | 'console' | 'combined';
  onSettings?: () => void;
}

interface QuestionEdit {
  questionRevision: number;
  prompt?: string;
  acceptedAnswersText?: string;
}

interface QuestionDraft {
  edit: QuestionEdit;
}

export default function TeacherRound({ session, credential, view, syncError = '', blocked = false, refresh, fullSnapshot, completedRefresh = 0, onExpired, mode = 'combined', onSettings }: Props) {
  const [selected, setSelected] = useState('');
  const [deleting, setDeleting] = useState<{ id: string; revision: number | undefined }>();
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingRefresh, setPendingRefresh] = useState<number | undefined>();
  const actionRequest = useRef<AbortController | null>(null);
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});
  const awaitingSnapshot = pendingRefresh !== undefined && completedRefresh < pendingRefresh;
  const disabled = blocked || busy || awaitingSnapshot;
  useEffect(() => {
    if (!deleting || busy || deleting.revision === view?.catalogRevision) return;
    deleteDialog.current?.close();
    setMessage('題目清單已更新，請核對最新內容後再刪除。');
  }, [deleting, busy, view?.catalogRevision]);
  useEffect(() => { setSelected(''); }, [session.activityId, view?.worksheetPreview?.source.importedAt]);
  useEffect(() => {
    setDrafts({}); setBusy(false); setPendingRefresh(undefined); setMessage('');
    return () => actionRequest.current?.abort();
  }, [session.activityId]);
  useEffect(() => {
    if (pendingRefresh !== undefined && completedRefresh >= pendingRefresh) {
      setPendingRefresh(undefined);
      setMessage('已取得最新課堂狀態，請核對操作是否完成。');
    }
  }, [completedRefresh, pendingRefresh]);

  const action: TeacherAction = async (path, body, method = 'POST') => {
    if (actionRequest.current && !actionRequest.current.signal.aborted) return false;
    const controller = new AbortController();
    actionRequest.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(path, {
        method, signal: controller.signal,
        headers: { ...activityHeaders(session, credential), 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (controller.signal.aborted) return false;
      if (!response.ok) {
        const issue = await readError(response);
        if (controller.signal.aborted) return false;
        if (response.status === 401 || issue.code === 'ACTIVITY_EXPIRED') onExpired?.();
        else {
          setMessage(issue.message);
          if (response.status === 409 || response.status === 404) refresh?.();
        }
        return false;
      }
      setMessage('操作已完成。');
      setPendingRefresh(undefined);
      refresh?.();
      return true;
    } catch {
      if (controller.signal.aborted) return false;
      setPendingRefresh(refresh?.() ?? Infinity);
      setMessage('操作結果待確認，請等待最新課堂狀態，再核對目前資料。');
      return false;
    } finally {
      if (actionRequest.current === controller) actionRequest.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  function draftKey(questionKey: string) {
    return questionKey;
  }

  function editQuestion(question: RoundQuestion, patch: Partial<QuestionEdit>) {
    const key = draftKey(question.questionKey);
    setDrafts(current => ({
      ...current,
      [key]: {
        edit: { ...(current[key]?.edit ?? { questionRevision: question.questionRevision }), ...patch },
      },
    }));
  }

  async function saveQuestion(question: RoundQuestion, edit: QuestionEdit) {
    const key = draftKey(question.questionKey);
    if (!await action(`/api/questions/${question.questionKey}`, { ...edit, catalogRevision: view?.catalogRevision }, 'PATCH')) return;
    setDrafts(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  if (!view) return <section className="round-panel"><h2>課堂回合</h2><p className="muted">{syncError || '正在連線並取得課堂狀態…'}</p></section>;
  const showSettings = mode !== 'console';
  const showConsole = mode !== 'settings';
  const running = view.phase === 'active' || view.phase === 'reviewing';
  const cards = view.questionCards ?? [];
  const byId = new Map(cards.map(card => [card.id, card]));
  const queued = (view.queueUnitIds ?? []).filter(id => byId.has(id));
  const opened = queued.filter(id => byId.get(id)?.opened)
    .sort((a, b) => (byId.get(a)?.questionNumber ?? 0) - (byId.get(b)?.questionNumber ?? 0));
  const queue = [...opened, ...queued.filter(id => !byId.get(id)?.opened)];
  const sortable = queue.filter(id => {
    const card = byId.get(id);
    return !card?.opened && card?.questions[0]?.origin === 'worksheet';
  });
  const addable = cards.filter(card => !queue.includes(card.id) && !card.opened);
  const next = view.nextUnitId ? byId.get(view.nextUnitId) : undefined;
  const roundPath = view.roundId ? `/api/rounds/${view.roundId}` : undefined;
  const title = view.phase === 'idle' && view.closedRoundIds.length ? '已定案' :
    { idle: '尚未開題', preparing: '準備中', active: '進行中', reviewing: '待確認判分', ended: '已公布' }[view.phase];
  const catalogRevision = view.catalogRevision;
  const preparationIssue = blocked || awaitingSnapshot ? '請等待題目資料同步完成'
    : !next ? '請先到題目管理加入題目'
    : next.questions.some(question => drafts[question.questionKey]) ? '請先儲存題目修改'
    : !view.groups?.length ? '請先建立分組'
    : next.questions.some(question => question.missingPrompt || !question.acceptedAnswers.length) ? '請補齊題幹和標準答案' : '';
  const lostDrafts = Object.entries(drafts).filter(([key]) => !cards.some(card => !card.opened && card.questions.some(question => question.questionKey === key)));

  function renderCard(card: CatalogUnit & { opened: boolean; questionNumber?: number }, position?: number) {
    const isManual = card.questions[0]?.origin === 'manual';
    const editing = selected === card.id && !card.opened && !running;
    const cancelEdit = () => {
      setDrafts(current => {
        const kept = { ...current };
        for (const question of card.questions) delete kept[question.questionKey];
        return kept;
      });
      setSelected('');
    };
    return <div className="question-card-content">
      <header className="question-card-heading">
        <div><h4>{card.opened && card.questionNumber !== undefined ? questionLabel(card) : isManual ? '手動題' : `來源題號 ${card.name}`}</h4>
          {position !== undefined && <p className="muted">{card.opened ? '已開放' : `清單位置 ${position + 1}`}</p>}</div>
        {!card.opened && <div className="row-actions">
          {position === undefined && <button className="secondary-button" disabled={disabled}
            onClick={() => void action('/api/question-queue', { unitId: card.id, catalogRevision })}>加入出題清單</button>}
          <button className="quiet" disabled={disabled || running} aria-expanded={editing}
            onClick={() => editing ? cancelEdit() : setSelected(card.id)}>{editing ? '取消編修' : '編修題目'}</button>
          <button className="quiet" disabled={disabled} onClick={event => {
            deleteTrigger.current = event.currentTarget;
            setDeleting({ id: card.id, revision: catalogRevision });
            deleteDialog.current?.showModal();
          }}>刪除</button>
        </div>}
      </header>
      {card.questions.map((question, index) => {
        const draft = drafts[question.questionKey]?.edit;
        const stale = draft !== undefined && draft.questionRevision !== question.questionRevision;
        return editing ? <fieldset className="form-stack question-editor" key={question.questionKey} disabled={disabled}>
          <legend>{card.questions.length > 1 ? `第 ${index + 1} 部分` : '編修內容'}</legend>
          <label>題幹<textarea rows={2} value={draft?.prompt ?? question.prompt ?? ''} onChange={event => editQuestion(question, { prompt: event.target.value })} /></label>
          <label>標準答案（一行一種答案）<textarea rows={3} value={draft?.acceptedAnswersText ?? question.acceptedAnswers.join('\n')} onChange={event => editQuestion(question, { acceptedAnswersText: event.target.value })} /></label>
          {stale && <><p role="status">此題已有更新。請核對題幹與答案後再儲存。</p>
            <p>目前題幹：{question.prompt ?? '缺少題幹'}<br />目前標準答案：{question.acceptedAnswers.join('、') || '尚未填寫'}</p>
            <button className="quiet" onClick={() => editQuestion(question, { questionRevision: question.questionRevision })}>使用最新版本並保留輸入</button></>}
          <button className="secondary-button" disabled={!draft || stale} onClick={() => draft && void saveQuestion(question, draft)}>
            {card.questions.length > 1 ? `儲存第 ${index + 1} 部分` : '儲存修改'}
          </button>
        </fieldset> : <p className="question-prompt" key={question.questionKey}>
          {card.questions.length > 1 && <b>第 {index + 1} 部分　</b>}{question.prompt ?? '缺少題幹'}
          {!question.acceptedAnswers.length && <small className="question-incomplete">缺少標準答案</small>}
          {draft && <small className="question-incomplete">有未儲存修改</small>}
        </p>;
      })}
    </div>;
  }

  return <section className="round-panel">
    {syncError && <p className="error" role="status">{syncError}</p>}
    {message && <p className="work-message" role="status">{message}</p>}
    {showSettings && <>
      <div className="section-heading">
        <h2>出題清單</h2>
        <ManualQuestion disabled={disabled || running} error={message}
          onAdd={(prompt, acceptedAnswersText) => action('/api/questions', { prompt, acceptedAnswersText, catalogRevision })} />
      </div>
      <QuestionQueue items={queue} sortable={sortable} disabled={disabled} catalogRevision={catalogRevision}
        onReorder={worksheetUnitIds => action('/api/question-queue', { worksheetUnitIds, catalogRevision }, 'PUT')}
        renderItem={(id, index) => renderCard(byId.get(id)!, index)} />
      {addable.length > 0 && <section className="question-catalog">
        <h3>學習單題目</h3>
        <ul className="question-queue">{addable.map(card => <li key={card.id}>{renderCard(card)}</li>)}</ul>
      </section>}
      {lostDrafts.length > 0 && <details className="question-editor">
        <summary>已失效的草稿</summary>
        {lostDrafts.map(([key, { edit }]) => <p key={key}>{edit.prompt}<br />{edit.acceptedAnswersText}</p>)}
      </details>}
      <dialog ref={deleteDialog} className="work-dialog" aria-labelledby="delete-question-title" onClose={() => {
        setDeleting(undefined);
        if (deleteTrigger.current?.isConnected) deleteTrigger.current.focus();
      }} onCancel={event => { if (busy) event.preventDefault(); }}>
        <h2 id="delete-question-title">刪除題目</h2>
        <p>這會移除題目卡及其出題清單項目。</p>
        <div className="row-actions">
          <button className="secondary-button" autoFocus disabled={busy} onClick={() => deleteDialog.current?.close()}>取消</button>
          <button className="danger-button" disabled={!deleting || disabled || deleting.revision !== catalogRevision} onClick={async () => {
            if (deleting && deleting.revision === catalogRevision && await action(
              `/api/questions/units/${encodeURIComponent(deleting.id)}`, { catalogRevision: deleting.revision }, 'DELETE')) {
              deleteDialog.current?.close();
            }
          }}>確認刪除</button>
        </div>
        {message && <p className="muted" role="status">{message}</p>}
      </dialog>
    </>}
    {showConsole && <>
      <div className="section-heading console-heading"><h2>{title}</h2>
        {!running && next && <button className="primary" disabled={disabled || Boolean(preparationIssue)}
          onClick={() => void action('/api/rounds/open-next', { unitId: next.id, catalogRevision })}>開放搶答</button>}
        {roundPath && view.phase === 'active' && <button className="danger-button" disabled={disabled}
          onClick={() => void action(`${roundPath}/end`)}>結束搶答</button>}
      </div>
      {!running && next && <div className="next-question">
        <h3>下一題</h3>
        {next.questions.map(question => <p key={question.questionKey} className="question-prompt">{question.prompt ?? '缺少題幹'}</p>)}
      </div>}
      {!running && preparationIssue && <p className="work-message">{preparationIssue}。{' '}
        {onSettings && <button className="secondary-button" onClick={onSettings}>前往題目管理</button>}
      </p>}
      <div className={view.phase === 'active' ? 'console-grid' : undefined}>
        <div>
          {running && view.unit?.questions?.map(question => <p key={question.questionId} className="question-prompt"><b>{questionLabel(question)}</b> {question.prompt}</p>)}
          {view.phase === 'reviewing' && roundPath && view.review && <RoundReview
            key={roundPath} roundPath={roundPath} questions={view.unit?.questions ?? []} groups={view.groups ?? []}
            review={view.review} disabled={disabled} action={action} classMode={mode === 'console'} />}
        </div>
        {view.phase === 'active' && view.groups && <div className="group-progress">{view.groups.map(group => <article className="progress-card" key={group.id}>
          <div><strong>{group.name}</strong><span className={group.received ? 'status received' : 'status'}>{group.received ? `已送出 · 第 ${group.rank} 順位` : '尚未送出'}</span></div>
          {group.answers?.map(answer => <p key={answer.questionId}><span>{questionLabel(view.unit?.questions?.find(question => question.questionId === answer.questionId) ?? answer)}</span>{answer.text}</p>)}
        </article>)}</div>}
      </div>
      {(session.classroomId || view.closedRoundIds.length > 0) && <RoundHistory session={session} credential={credential} roundIds={view.closedRoundIds} snapshot={fullSnapshot} />}
    </>}
  </section>;
}
