import { expect, it } from 'vitest';
import { compareReviewEdit, fieldKey, reviewChangesMatch, savedReviewValues } from '../../frontend/src/review-draft';

const field = { kind: 'grade', groupId: 'g', questionId: 'q' } as const;

it('保留逐筆改判，採用重新對齊的新值，選回原值會清除差異', () => {
  const edit = { field, baseline: false, value: true, reviewRevision: 1 };
  expect(compareReviewEdit(edit, false, 1)).toEqual({ value: true, changed: true, needsReview: false });
  expect(compareReviewEdit(edit, false, 2)).toEqual({ value: true, changed: true, needsReview: true });
  expect(compareReviewEdit(edit, true, 2)).toEqual({ value: true, changed: false, needsReview: true });
  expect(compareReviewEdit({ ...edit, value: false }, false, 1)).toEqual({ value: false, changed: false, needsReview: false });
  expect(compareReviewEdit({ ...edit, value: false }, true, 2)).toEqual({ value: true, changed: false, needsReview: false });
  expect(compareReviewEdit({ ...edit, field: { kind: 'eligibility', groupId: 'g' }, baseline: true, value: false }, true, 2))
    .toEqual({ value: false, changed: true, needsReview: true });
});

it('有效錯答為 false，省略組別資格意指有資格', () => {
  const values = savedReviewValues([{ id: 'g', name: '甲組', received: true, answers: [
    { questionId: 'q', text: '原文', autoCorrect: true, correct: false },
    { questionId: 'q2', text: '原文二', autoCorrect: true },
  ] }, { id: 'empty', name: '未送件', received: false }]);
  expect(values.get(fieldKey({ ...field, questionId: 'q2' }))).toBe(true);
  const saved = { reviewRevision: 1, grades: [{ groupId: 'g', questionId: 'q', correct: false }],
    eligibility: [{ groupId: 'g', disqualified: false }] };
  expect(reviewChangesMatch(saved, values)).toBe(true);
  expect(reviewChangesMatch({ ...saved, grades: [{ ...saved.grades[0], correct: true }] }, values)).toBe(false);
  expect(reviewChangesMatch({ ...saved, grades: [{ ...saved.grades[0], questionId: 'missing' }] }, values)).toBe(false);
  expect(reviewChangesMatch({ ...saved, eligibility: [{ groupId: 'empty', disqualified: false }] }, values)).toBe(false);
});
