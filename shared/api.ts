export type SessionResponse =
  | { activityId: string; classroomId?: string; activityEpoch?: string; role: 'teacher'; groupId?: never; groupName?: never; memberId?: never; studentName?: never }
  | { activityId: string; classroomId?: string; activityEpoch?: string; classroomName?: string; role: 'student'; groupId: string; groupName: string; memberId: string; studentName: string };


export interface GroupSummary { id: string; name: string }
export interface StudentMember { id: string; groupId: string; name: string }
export interface TeacherRosterResponse { groups: Array<GroupSummary & { joinCode: string; members: Array<{ id: string; name: string }> }>; locked: boolean; rosterVersion: number }
export type RosterResponse = TeacherRosterResponse;
export interface WorksheetPreview { source: WorksheetSource; mainQuestionCount: number; unitCount: number; fillCount: number; units: Array<{ id: string; name: string; questionIds: string[]; questions?: QuestionPreview[] }> }
export interface ApiError { code: string; message: string; details?: unknown }

export type Phase = 'preparing' | 'active' | 'reviewing' | 'ended';
export interface FillBlank {
  id: string;
  questionId: string;
  mainQuestionId: string;
  subQuestionId?: string;
  unitId: string;
  row: number;
  column: number;
  originalValue: unknown;
  originalType: string;
  note?: string;
  prompt?: string | null;
  identitySource: 'header' | 'marker' | 'note';
}
export interface BuzzerUnit { id: string; name: string; questionIds: string[]; fillBlankIds: string[] }
export type WorksheetSource = { kind: 'google'; documentId: string; sheetId: number; sheetTitle: string; importedAt: number } | { kind: 'xlsx'; fileName: string; sheetId: number; sheetTitle: string; importedAt: number };
export interface Worksheet { source: WorksheetSource; fills: FillBlank[]; units: BuzzerUnit[] }
export interface QuestionPreview { questionId: string; prompt: string | null; missingPrompt: boolean; questionNumber?: number; partNumber?: number | null }
export interface RoundQuestion extends QuestionPreview {
  questionKey: string;
  unitId: string;
  origin: 'worksheet' | 'manual';
  fillBlankId?: string;
  acceptedAnswers: string[];
  questionRevision: number;
}
export interface CatalogUnit { id: string; name: string; questions: RoundQuestion[] }
export interface QuestionPartEdit {
  questionKey: string;
  questionRevision: number;
  prompt: string;
  acceptedAnswersText: string;
}
export interface QuestionCardEdit { catalogRevision: number; questions: QuestionPartEdit[] }
export interface QuestionCardSaved { unit: CatalogUnit; catalogRevision: number }

export function normalizeAcceptedAnswers(text: string) {
  return text.split(/\r\n|\r|\n/).map(answer => answer.trim()).filter(Boolean);
}

export interface Answer {
  questionId: string;
  fillBlankId?: string;
  text: string;
  autoCorrect?: boolean;
  overrideCorrect?: boolean;
}
export interface Submission { disqualified?: boolean; groupId: string; rank: number; receivedAt: number; receivedOn?: number; answers: Answer[] }
export interface GradeEdit { groupId: string; questionId: string; correct: boolean }
export interface TeacherSupplement { questionId: string; text: string }
export interface ReviewView { reviewRevision: number; missingSupplementQuestionIds: string[]; supplements: TeacherSupplement[] }
export interface Round {
  id: string;
  unitId: string;
  unitName?: string;
  phase: Phase;
  openedAt?: number;
  sequenceNumber?: number;
  isMultipart?: boolean;
  openAtByGroup: Record<string, number>;
  roster: GroupSummary[];
  submissions: Submission[];
  winnerGroupId?: string;
  questions?: RoundQuestion[];
  reviewRevision?: number;
  supplements?: TeacherSupplement[];
}
export interface ActivityView {
  phase: Phase | 'idle';
  writebackInProgress?: boolean;
  roundId: string | null;
  unit: (Pick<BuzzerUnit, 'id' | 'questionIds'> & Partial<Pick<BuzzerUnit, 'name' | 'fillBlankIds'>> & { questions?: QuestionPreview[] }) | null;
  closedRoundIds: string[];
  questionCards?: Array<CatalogUnit & { opened: boolean; questionNumber?: number }>;
  queueUnitIds?: string[];
  catalogRevision?: number;
  nextUnitId?: string | null;
  availableUnits?: Array<{ unitId: string; questionIds: string[]; questions?: QuestionPreview[] }>;
  editableQuestions?: RoundQuestion[];
  review?: ReviewView;
  groups?: Array<{ id: string; name: string; received: boolean; disqualified?: boolean; rank?: number; answers?: Array<{ questionId: string; text: string; autoCorrect?: boolean; correct?: boolean }> }>;
  groupId?: string;
  groupName?: string;
  rosterVersion?: number;
  worksheetPreview?: WorksheetPreview | null;
  received?: boolean;
  ownAnswers?: Array<{ questionId: string; text: string }>;
  waitRemainingMs?: number;
  version: number;
}
export interface StudentRoundResultLine {
  questionNumber: number;
  partNumber: number | null;
  prompt: string | null;
  ownAnswer: string | null;
  correct: boolean | null;
  publishedAnswer: string | null;
}

export interface RoundResultLine {
  questionNumber?: number;
  partNumber?: number | null;
  questionId: string;
  prompt: string | null;
  winnerGroupId: string | null;
  teacherAnswer?: string;
  groups: Array<{ groupId: string; groupName: string; answer: string; rank: number | null; status: string; correct: boolean | null }>;
}

export interface ClassroomScope {
  classroomId: string;
  activityId: string;
  activityEpoch: string;
}

export interface ClassroomSummary {
  id: string;
  name: string;
  updatedAt: number;
  phase: ActivityView['phase'];
  unavailable?: boolean;
  writebackInProgress?: boolean;
}

export interface ClassroomLocation extends ClassroomSummary, ClassroomScope {}
export interface ArchivedRoster {
  activityId: string;
  startedAt: number;
  archivedAt: number;
  groups: Array<GroupSummary & { members: Array<{ id: string; name: string }> }>;
}
export interface HistoryRound { activityId: string; startedAt: number; roundId: string; title: string; questionNumber?: number; winnerGroupName?: string }
export interface ProjectionView {
  classroomName: string;
  phase: ActivityView['phase'];
  title?: string;
  questions: QuestionPreview[];
  groups: Array<{ id: string; name: string; received: boolean }>;
  winnerGroupName?: string;
  version: number;
}
