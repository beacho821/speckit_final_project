import { useState } from 'react';
import type { ActivityView, GradeEdit, QuestionPreview, ReviewView } from '../../shared/api';
import type { TeacherAction } from './TeacherRound';

interface Draft {
  revision: number;
  grades: Map<string, GradeEdit>;
  eligibility: Map<string, boolean>;
  supplements: Map<string, string>;
}

function gradeKey(groupId: string, questionId: string) {
  return JSON.stringify([groupId, questionId]);
}

export default function RoundReview({ roundPath, questions, groups, review, disabled, action, classMode = false }: {
  roundPath: string;
  questions: QuestionPreview[];
  groups: NonNullable<ActivityView['groups']>;
  review: ReviewView;
  disabled: boolean;
  action: TeacherAction;
  classMode?: boolean;
}) {
  const [draft, setDraft] = useState<Draft>();
  const [savedAt, setSavedAt] = useState<number>();
  const [archivedSupplements, setArchivedSupplements] = useState<Map<string, string>>(() => new Map());
  const stale = draft !== undefined && draft.revision !== review.reviewRevision;
  const waitingForSave = savedAt !== undefined && review.reviewRevision <= savedAt;
  const savedSupplements = new Map(review.supplements.map(item => [item.questionId, item.text]));
  const correctIds = new Set(groups.filter(group => !(draft?.eligibility.get(group.id) ?? group.disqualified)).flatMap(group => (group.answers ?? [])
    .filter(answer => draft?.grades.get(gradeKey(group.id, answer.questionId))?.correct ?? answer.correct)
    .map(answer => answer.questionId)));
  const needingSupplement = questions.filter(question => !correctIds.has(question.questionId));
  const eligibleIds = new Set(needingSupplement.map(question => question.questionId));
  const excludedDrafts = [...draft?.supplements ?? []].filter(([questionId]) => !eligibleIds.has(questionId));
  const recoverySupplements = new Map([...archivedSupplements, ...excludedDrafts]);
  const missing = needingSupplement.filter(question => !(draft?.supplements.get(question.questionId) ?? savedSupplements.get(question.questionId))?.trim());

  function edit(update: (draft: Draft) => Draft) {
    setDraft(previous => update(previous ?? { revision: review.reviewRevision, grades: new Map(), eligibility: new Map(), supplements: new Map() }));
  }

  async function save() {
    if (!draft || stale) return;
    const supplements = [...draft.supplements].filter(([questionId]) => eligibleIds.has(questionId)).map(([questionId, text]) => ({ questionId, text }));
    const grades = [...draft.grades.values()];
    const eligibility = [...draft.eligibility].map(([groupId, disqualified]) => ({ groupId, disqualified }));
    if (grades.length || supplements.length || eligibility.length) {
      if (!await action(`${roundPath}/review`, { reviewRevision: draft.revision, grades, supplements, ...(eligibility.length ? { eligibility } : {}) }, 'PATCH')) return;
      setSavedAt(draft.revision);
    }
    if (excludedDrafts.length) setArchivedSupplements(new Map([...archivedSupplements, ...excludedDrafts]));
    setDraft(undefined);
  }

  return <div className="form-stack">
    <fieldset className="form-stack question-editor" disabled={disabled || waitingForSave}>
      <legend>確認判分</legend>
      <div className={classMode ? 'review-layout' : 'form-stack'}><div>
      {groups.every(group => !group.received) && <p>本回合無人送答。</p>}
      {groups.filter(group => group.received).map(group => <section className="review-group form-stack" key={group.id}>
        <div className="section-heading"><h3>{group.name}</h3>
          {classMode && <button className="secondary-button" aria-label={group.name + ((draft?.eligibility.get(group.id) ?? group.disqualified) ? '恢復資格' : '取消資格')}
            onClick={() => edit(current => ({ ...current, eligibility: new Map(current.eligibility).set(group.id,
              !(current.eligibility.get(group.id) ?? group.disqualified)) }))}>
            {(draft?.eligibility.get(group.id) ?? group.disqualified) ? '恢復資格' : '取消資格'}
          </button>}
        </div>
        {classMode && (draft?.eligibility.get(group.id) ?? group.disqualified) && <p role="status">本回合已取消資格</p>}
        {group.answers?.map(answer => {
        const key = gradeKey(group.id, answer.questionId);
        const correct = draft?.grades.get(key)?.correct ?? answer.correct ?? false;
        return <label key={key}>
          <strong>{group.name} · 第 {answer.questionId} 題</strong>
          <span className="question-prompt">{answer.text}</span>
          <span>自動判分：{answer.autoCorrect ? '答對' : '答錯'}{stale ? ` · 目前已儲存：${answer.correct ? '答對' : '答錯'}` : ''}</span>
          <select value={String(correct)} onChange={event => {
            const selected = event.target.value === 'true';
            edit(current => ({ ...current, grades: new Map(current.grades).set(key, { groupId: group.id, questionId: answer.questionId, correct: selected }) }));
          }}>
            <option value="true">答對</option><option value="false">答錯</option>
          </select>
        </label>;
        })}
      </section>)}
      {needingSupplement.map(question => <label key={question.questionId}>
        老師補答 · 第 {question.questionId} 題
        <textarea rows={2} value={draft?.supplements.get(question.questionId) ?? savedSupplements.get(question.questionId) ?? ''} onChange={event => {
          const value = event.target.value;
          edit(current => ({ ...current, supplements: new Map(current.supplements).set(question.questionId, value) }));
        }} />
        {stale && <span className="question-prompt">目前已儲存：{savedSupplements.get(question.questionId) ?? '尚未填寫'}</span>}
      </label>)}
      </div><aside className="review-actions form-stack">
      {missing.length > 0 && <p role="status">公布前請補答：{missing.map(question => question.questionId).join('、')}</p>}
      {stale && <p role="status">判分已有更新。請核對最新判分及補答後再儲存。</p>}
      {stale && <button className="quiet" onClick={() => edit(current => ({ ...current, revision: review.reviewRevision }))}>使用最新版本並保留輸入</button>}
      <button className="secondary-button" disabled={!draft || stale} onClick={() => void save()}>儲存判分與補答</button>
      {draft && !stale && <p className="muted">請先儲存修改，再公布結果。</p>}
      <button className="primary" disabled={Boolean(draft)} onClick={() => void action(`${roundPath}/publish`, { reviewRevision: review.reviewRevision })}>{classMode ? '確認定案' : '公布結果'}</button>
      </aside></div>
    </fieldset>
    {recoverySupplements.size > 0 && <details open className="question-editor">
      <summary>已失效的補答草稿（可複製）</summary>
      {[...recoverySupplements].map(([questionId, text]) => <label key={questionId}>
        原第 {questionId} 題補答<textarea rows={2} readOnly value={text} />
      </label>)}
    </details>}
  </div>;
}
