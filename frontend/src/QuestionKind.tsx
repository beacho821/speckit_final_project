import { ClassroomIcon } from './ClassroomIcon';

export function hasQuestionParts(questions: readonly { questionId: string; partNumber?: number | null }[]) {
  if (questions.length > 1) return true;
  const first = questions[0];
  if (!first) return false;
  return first.partNumber === undefined ? /[（(]\s*\d+\s*[）)]$/.test(first.questionId) : first.partNumber !== null;
}

export function QuestionKind({ grouped, count }: { grouped: boolean; count: number }) {
  return <span className="question-kind" data-grouped={grouped}>
    <ClassroomIcon name={grouped ? 'book' : 'pencil'} />{grouped ? `題組 · ${count} 小題` : '單題'}
  </span>;
}
