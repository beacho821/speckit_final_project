import type { ActivityView, GradeEdit } from '../../shared/api';

type ReviewGroups = NonNullable<ActivityView['groups']>;
export type ReviewField = { kind: 'grade'; groupId: string; questionId: string }
  | { kind: 'eligibility'; groupId: string };
type Edit = { field: ReviewField; baseline: boolean; value: boolean; reviewRevision: number };
export type ReviewDraft = Map<string, Edit>;

export interface ReviewChanges {
  reviewRevision: number;
  grades: GradeEdit[];
  eligibility?: Array<{ groupId: string; disqualified: boolean }>;
}

export function fieldKey(field: ReviewField): string {
  switch (field.kind) {
    case 'grade': return JSON.stringify([field.kind, field.groupId, field.questionId]);
    case 'eligibility': return JSON.stringify([field.kind, field.groupId]);
  }
}

export function savedReviewValues(groups: ReviewGroups) {
  const values = new Map<string, boolean>();
  for (const group of groups.filter(group => group.received)) {
    values.set(fieldKey({ kind: 'eligibility', groupId: group.id }), group.disqualified ?? false);
    for (const answer of group.answers ?? []) {
      values.set(fieldKey({ kind: 'grade', groupId: group.id, questionId: answer.questionId }), answer.correct ?? answer.autoCorrect ?? false);
    }
  }
  return values;
}

export function compareReviewEdit(edit: Edit, savedValue: boolean, reviewRevision: number) {
  const hasDraft = edit.value !== edit.baseline;
  const value = hasDraft ? edit.value : savedValue;
  const changed = value !== savedValue;
  return { value, changed, needsReview: hasDraft && edit.reviewRevision !== reviewRevision };
}

export function reviewChangesMatch(changes: ReviewChanges, saved: ReadonlyMap<string, boolean>): boolean {
  return changes.grades.every(grade => saved.get(fieldKey({ ...grade, kind: 'grade' })) === grade.correct)
    && (changes.eligibility ?? []).every(group => saved.get(fieldKey({ ...group, kind: 'eligibility' })) === group.disqualified);
}
