import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { questionLabel } from './question-label';
import type { ActivityView, QuestionPreview, ReviewView } from '../../shared/api';
import { selectReviewSupplements } from '../../shared/review-supplements';
import type { ReviewAction } from './TeacherRound';
import { compareReviewEdit, fieldKey, reviewChangesMatch, savedReviewValues,
  type ReviewChanges, type ReviewDraft, type ReviewField } from './review-draft';

type Feedback = { message: string; error?: boolean };
type Pending = { token?: number } & (
  { kind: 'save'; changes: ReviewChanges; expectedRevision?: number }
  | { kind: 'publish'; revision: number }
  | { kind: 'refresh'; revision: number; requireNewRevision: boolean }
);

function winnerLabel(id: unknown, groups: Array<{ id: string; name: string }>): string | null | undefined {
  if (id === null) return null;
  return typeof id === 'string' ? groups.find(group => group.id === id)?.name : undefined;
}

function winnerFromResult(data: unknown): string | null | undefined {
  if (!Array.isArray(data) || !data[0] || !Array.isArray(data[0].groups)) return;
  return winnerLabel(data[0].winnerGroupId, data[0].groups.flatMap((group: unknown) => {
    if (!group || typeof group !== 'object' || !('groupId' in group) || !('groupName' in group)
      || typeof group.groupId !== 'string' || typeof group.groupName !== 'string') return [];
    return [{ id: group.groupId, name: group.groupName }];
  }));
}

function displayValue(field: ReviewField, value: boolean | undefined) {
  if (value === undefined) return "待教師判分";
  if (field.kind === 'grade') return value ? '正確' : '錯誤';
  return value ? '已取消資格' : '有資格';
}

export default function RoundReview({
  roundPath, questions, groups, review, disabled, action, classMode = false, closed = false, refresh,
  completedRefresh = 0, readRoundResult, onPublicationStarted, onPublicationSettled, onDismissResult,
}: {
  roundPath: string;
  questions: QuestionPreview[];
  groups: NonNullable<ActivityView['groups']>;
  review: ReviewView;
  disabled: boolean;
  action: ReviewAction;
  classMode?: boolean;
  closed?: boolean;
  refresh?: () => number;
  completedRefresh?: number;
  readRoundResult?: (path: string, signal: AbortSignal) => Promise<unknown>;
  onPublicationStarted?: () => void;
  onPublicationSettled?: (roundPath: string) => void;
  onDismissResult?: () => void;
}) {
  const [draft, setDraft] = useState<ReviewDraft>(() => new Map());
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Feedback>();
  const [requested, setRequested] = useState<'save' | 'publish'>();
  const [pending, setPending] = useState<Pending>();
  const [publicationResult, setPublicationResult] = useState<{ winner: string | null; fromResponse?: boolean }>();
  const [resultAttempt, setResultAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const confirmedClosed = useRef(closed);
  const resultStatus = useRef<HTMLParagraphElement>(null);
  const statusId = useId();
  const saved = useMemo(() => savedReviewValues(groups), [groups]);
  const winner = publicationResult?.winner;
  const carried = onDismissResult !== undefined;
  const resultHeading = questions[0]?.questionNumber
    ? `第 ${questions[0].questionNumber} 題的定案結果` : '先前回合的定案結果';
  const finalized = winner !== undefined || closed;
  const locked = disabled || requested !== undefined || pending !== undefined || finalized;

  useLayoutEffect(() => { confirmedClosed.current = closed; }, [closed]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (winner !== undefined && !carried) resultStatus.current?.focus();
  }, [winner, carried]);
  useEffect(() => {
    if (publicationResult?.fromResponse && !carried) onPublicationSettled?.(roundPath);
  }, [publicationResult, carried, onPublicationSettled, roundPath]);

  useEffect(() => {
    if (!closed || winner !== undefined || !readRoundResult) return;
    const controller = new AbortController();
    setPending(undefined);
    setFeedback({ message: '回合已定案，正在確認勝組…' });
    void readRoundResult(roundPath, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      const value = winnerFromResult(data);
      if (value === undefined) throw new Error();
      setPublicationResult({ winner: value });
      setFeedback(undefined);
    }).catch(() => {
      if (!controller.signal.aborted) setFeedback({ error: true, message: '回合已定案，勝組待確認。請重新取得結果。' });
    });
    return () => controller.abort();
  }, [closed, winner, roundPath, readRoundResult, resultAttempt]);

  useEffect(() => {
    if (!pending || finalized) return;
    const revision = pending.kind === 'save' ? pending.changes.reviewRevision : pending.revision;
    const fresh = pending.token !== undefined ? completedRefresh >= pending.token : review.reviewRevision > revision;
    if (!fresh) return;
    if (pending.kind === 'refresh' && pending.requireNewRevision && review.reviewRevision <= revision) return;
    if (pending.kind === 'save') {
      const matches = review.reviewRevision >= (pending.expectedRevision ?? revision + 1) && reviewChangesMatch(pending.changes, saved);
      if (matches) {
        setDraft(new Map());
        setFeedback({ message: '已儲存判分。' });
      } else {
        setFeedback({ error: true, message: '最新審核內容尚未反映此次儲存。請核對草稿後再試。' });
      }
    } else if (pending.kind === 'publish') {
      setFeedback({ error: true, message: '回合仍在待審核。請核對最新內容後再定案。' });
      onPublicationSettled?.(roundPath);
    }
    setPending(undefined);
  }, [pending, finalized, completedRefresh, review.reviewRevision, saved, roundPath, onPublicationSettled]);

  function savedValue(field: ReviewField) {
    return saved.get(fieldKey(field));
  }

  function edit(field: ReviewField, value: boolean) {
    if (effectiveValue(field) === value) return;
    const key = fieldKey(field);
    const baseline = savedValue(field);
    setDraft(previous => {
      const next = new Map(previous);
      if (value === baseline) next.delete(key);
      else next.set(key, { field, baseline, value, reviewRevision: review.reviewRevision });
      return next;
    });
    setFeedback(undefined);
  }

  function effectiveValue(field: ReviewField) {
    const stored = savedValue(field);
    const local = draft.get(fieldKey(field));
    return local ? compareReviewEdit(local, stored, review.reviewRevision).value : stored;
  }

  const questionById = new Map(questions.map(question => [question.questionId, question]));
  const correctIds = new Set(groups.filter(group => group.received && !effectiveValue({ kind: 'eligibility', groupId: group.id }))
    .flatMap(group => (group.answers ?? []).filter(answer => effectiveValue({
      kind: 'grade', groupId: group.id, questionId: answer.questionId,
    })).map(answer => answer.questionId)));
  const { selected, missingSupplementQuestionIds } = selectReviewSupplements(questions, correctIds, review.supplementCandidates);
  const changes: ReviewChanges = { reviewRevision: review.reviewRevision, grades: [] };
  const needingReview: Array<{ field: ReviewField; saved: boolean | undefined; value: boolean | undefined }> = [];
  const fieldsToReview = new Set<string>();
  for (const entry of draft.values()) {
    const { field } = entry;
    const stored = savedValue(field);
    const comparison = compareReviewEdit(entry, stored, review.reviewRevision);
    if (comparison.needsReview) {
      needingReview.push({ field, saved: stored, value: comparison.value });
      fieldsToReview.add(fieldKey(field));
    }
    if (!comparison.changed) continue;
    if (field.kind === 'grade') changes.grades.push({ groupId: field.groupId, questionId: field.questionId, correct: entry.value });
    else (changes.eligibility ??= []).push({ groupId: field.groupId, disqualified: entry.value });
  }
  const unsaved = Boolean(changes.grades.length || changes.eligibility?.length);
  const canSave = !locked && unsaved && needingReview.length === 0;
  const ungraded = groups.some(group => group.received && !effectiveValue({ kind: 'eligibility', groupId: group.id }) &&
    group.answers?.some(answer => effectiveValue({ kind: 'grade', groupId: group.id, questionId: answer.questionId }) === undefined));
  const missingChoices = Object.entries(choices).some(([id, text]) => !correctIds.has(id) && !text.trim());
  const canPublish = !ungraded && !missingChoices && !locked && !unsaved && needingReview.length === 0;

  async function submit(kind: 'save' | 'publish') {
    if (request.current || (kind === 'save' ? !canSave : !canPublish)) return;
    const controller = new AbortController();
    request.current = controller;
    setRequested(kind);
    setFeedback(undefined);
    if (kind === 'publish') onPublicationStarted?.();
    try {
      const result = kind === 'save'
        ? await action(roundPath + '/review', changes, 'PATCH', controller.signal)
        : await action(roundPath + '/publish', { reviewRevision: review.reviewRevision,
          ...(review.optionalSupplements ? { supplements: Object.entries(choices).filter(([id]) => !correctIds.has(id)).map(([questionId, text]) => ({ questionId, text })) } : {}),
        }, 'POST', controller.signal);
      if (controller.signal.aborted) return;
      const data = result.kind === 'ok' ? result.data : undefined;
      if (kind === 'publish' && data && typeof data === 'object' && 'id' in data && 'phase' in data && 'winnerGroupId' in data
        && data.id === decodeURIComponent(roundPath.split('/').at(-1) ?? '') && data.phase === 'ended') {
        const value = winnerLabel(data.winnerGroupId, groups);
        if (value !== undefined) {
          setPublicationResult({ winner: value, fromResponse: true });
          refresh?.();
          return;
        }
      }
      // 已確認封存後，較晚的操作回應須保留結果查詢的狀態。
      if (confirmedClosed.current) return;
      if (result.kind === 'rejected') {
        if (kind === 'publish') onPublicationSettled?.(roundPath);
        setFeedback({ error: true, message: result.message });
        if (result.status === 409 || result.status === 404) {
          setPending({
            kind: 'refresh', revision: review.reviewRevision, token: refresh?.(),
            requireNewRevision: result.code === 'REVIEW_REVISION_CHANGED',
          });
        }
        return;
      }
      const saveRevision = kind === 'save' && data && typeof data === 'object' && 'reviewRevision' in data
        && typeof data.reviewRevision === 'number' && Number.isSafeInteger(data.reviewRevision)
        && data.reviewRevision > review.reviewRevision ? data.reviewRevision : undefined;
      setFeedback({ message: saveRevision !== undefined ? '正在確認已存內容…' : '結果待確認，正在取得最新回合狀態。' });
      const token = refresh?.();
      setPending(kind === 'save'
        ? { kind, token, changes, expectedRevision: saveRevision }
        : { kind, token, revision: review.reviewRevision });
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setRequested(undefined);
    }
  }

  function keepReviewValue(field: ReviewField, keepDraft: boolean) {
    const key = fieldKey(field);
    setDraft(previous => {
      const next = new Map(previous);
      const entry = next.get(key);
      const baseline = savedValue(field);
      if (entry && keepDraft && entry.value !== baseline) next.set(key, { ...entry, baseline, reviewRevision: review.reviewRevision });
      else next.delete(key);
      return next;
    });
    setFeedback(undefined);
  }

  return <div className={classMode && !onDismissResult ? 'review-layout' : 'form-stack'}>
      {!onDismissResult && <fieldset className="form-stack question-editor" disabled={locked}>
        <legend>確認判分</legend>
        {groups.every(group => !group.received) && <p>本回合無人送答。</p>}
        {groups.filter(group => group.received).map(group => {
          const eligibility: ReviewField = { kind: 'eligibility', groupId: group.id };
          const disqualified = effectiveValue(eligibility);
          const eligibilityAction = disqualified ? '恢復資格' : '取消資格';
          return <section className="review-group form-stack" key={group.id}>
            <div className="section-heading"><h3>{group.name}{group.rank !== undefined && ` · 第 ${group.rank} 順位`}</h3>
              {classMode && <button type="button" className="secondary-button" aria-label={group.name + eligibilityAction}
                disabled={fieldsToReview.has(fieldKey(eligibility))}
                onClick={() => edit(eligibility, !disqualified)}>{eligibilityAction}</button>}
            </div>
            {classMode && disqualified && <p role="status">本回合已取消資格</p>}
            {group.answers?.map(answer => {
              const field: ReviewField = { kind: 'grade', groupId: group.id, questionId: answer.questionId };
              const label = `${group.name} · ${questionLabel(questionById.get(answer.questionId) ?? answer)}`;
              const correct = effectiveValue(field);
              const needsReview = fieldsToReview.has(fieldKey(field));
              return <div key={fieldKey(field)} className="form-stack" role="group" aria-label={label}>
                <strong>{label}</strong>
                <p className="question-prompt">{answer.text}</p>
                <p>自動判分：{answer.autoCorrect === undefined ? '待教師判分' : answer.autoCorrect ? '答對' : '答錯'}</p>
                <div className="row-actions review-grade">
                  <button type="button" className="secondary-button" aria-pressed={correct === false} disabled={needsReview}
                    onClick={() => edit(field, false)}>錯誤</button>
                  <button type="button" className="secondary-button" aria-pressed={correct === true} disabled={needsReview}
                    onClick={() => edit(field, true)}>正確</button>
                </div>
              </div>;
            })}
          </section>;
        })}
        {!finalized && review.optionalSupplements && questions.some(q => !correctIds.has(q.questionId)) && <section className="form-stack" aria-label="學習單補答">
          <h3>學習單補答</h3>
          {questions.filter(q => !correctIds.has(q.questionId)).map(q => {
            const id = q.questionId;
            const chosen = choices[id] !== undefined;
            const suggestion = review.supplementCandidates.find(item => item.questionId === id)?.text ?? '';
            return <div key={id} className="form-stack"><label className="supplement-choice"><input type="checkbox" checked={chosen}
              onChange={event => {
                const checked = event.target.checked;
                setChoices(previous => {
                  const next = { ...previous };
                  if (checked) next[id] = suggestion; else delete next[id];
                  return next;
                });
              }} /> {questionLabel(q)} · 補答到學習單</label>
              {chosen && <label>補答內容<textarea maxLength={4000} value={choices[id]} onChange={event => setChoices({ ...choices, [id]: event.target.value })} /></label>}
            </div>;
          })}
          {missingChoices && <p>請填寫補答，或取消勾選以留白。</p>}
        </section>}
        {!finalized && !review.optionalSupplements && (selected.length > 0 || missingSupplementQuestionIds.length > 0) && <section className="form-stack review-supplements" aria-label="補答預覽">
          <h3>補答預覽</h3>
          {selected.map(item => <div key={item.questionId}>
            <strong>{questionLabel(questionById.get(item.questionId) ?? item)} · {item.source === 'legacy' ? '老師補答' : '自動補答'}</strong>
            <p className="question-prompt">{item.text}</p>
          </div>)}
          {missingSupplementQuestionIds.map(questionId => <p key={questionId}>
            {questionLabel(questionById.get(questionId) ?? { questionId })} · 沒有可引用的答案
          </p>)}
        </section>}
      </fieldset>}
      <aside className="review-actions form-stack" aria-label={carried ? resultHeading : '審核操作'}>
        {carried && <h3>{resultHeading}</h3>}
        {winner !== undefined && <p className="success-box" ref={resultStatus} tabIndex={-1} role="status">
          已定案。{winner === null ? '無勝組' : `勝組：${winner}`}
        </p>}
        {finalized && unsaved && <p>本分頁尚有未儲存的草稿，僅供核對。</p>}
        {feedback && winner === undefined && <p className={feedback.error ? 'error' : undefined} role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
        {closed && winner === undefined && feedback?.error && <button type="button" className="secondary-button"
          onClick={() => setResultAttempt(value => value + 1)}>重新取得定案結果</button>}
        {onDismissResult && winner !== undefined && <button type="button" className="quiet" onClick={onDismissResult}>關閉定案結果</button>}
        {!finalized && <>
          <div id={statusId}>
            {requested && <p role="status">{requested === 'save' ? '儲存中…' : '定案中…'}</p>}
            {needingReview.length > 0 && <p role="status">其他分頁已更新判分。請逐筆核對後再儲存或定案。</p>}
            {unsaved && !requested && !pending && <p>修改尚未儲存。</p>}
            {disabled && !requested && !pending && <p>操作暫停，請等待課堂狀態確認。</p>}
            {ungraded && <p>請完成待教師判分的作答並儲存。</p>}
            {canPublish && <p>審核完成，可定案。</p>}
          </div>
          {needingReview.map(({ field, saved: latest, value }) => {
            const group = groups.find(item => item.id === field.groupId);
            const label = field.kind === 'grade' ? questionLabel(questionById.get(field.questionId) ?? field) : '組別資格';
            const title = `${group?.name ?? field.groupId} · ${label}`;
            return <section className="review-conflict form-stack" aria-label={title} key={fieldKey(field)}>
              <h4>{title}</h4>
              <p>最新已存值：{displayValue(field, latest)}</p>
              <p>目前草稿：{displayValue(field, value)}</p>
              <div className="row-actions">
                <button type="button" className="secondary-button" disabled={locked}
                  onClick={() => keepReviewValue(field, false)}>保留已存值</button>
                <button type="button" className="secondary-button" disabled={locked}
                  onClick={() => keepReviewValue(field, true)}>保留草稿</button>
              </div>
            </section>;
          })}
          {pending && refresh && <button type="button" className="quiet"
            onClick={() => { const token = refresh(); setPending({ ...pending, token }); }}>重新取得審核狀態</button>}
          <button type="button" className="secondary-button" aria-describedby={statusId} disabled={!canSave}
            onClick={() => void submit('save')}>儲存判分</button>
          <button type="button" className="primary" aria-describedby={statusId} disabled={!canPublish}
            onClick={() => void submit('publish')}>{classMode ? '確認定案' : '公布結果'}</button>
        </>}
      </aside>
  </div>;
}
