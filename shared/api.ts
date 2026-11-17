export interface SessionResponse {
  activityId: string;
  role: 'teacher' | 'student';
  groupId?: string;
}

export interface GroupSummary { id: string; name: string }
export interface AvailableGroup { id: string }
export interface RosterResponse { groups: GroupSummary[]; availableGroups: AvailableGroup[]; locked: boolean }
export interface ApiError { code: string; message: string; details?: unknown }

export type Phase = 'preparing' | 'active' | 'ended';
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
  identitySource: 'header' | 'marker' | 'note';
}
export interface BuzzerUnit { id: string; name: string; questionIds: string[]; fillBlankIds: string[] }
export interface WorksheetSource { documentId: string; sheetId: number; sheetTitle: string; importedAt: number }
export interface Worksheet { source: WorksheetSource; fills: FillBlank[]; units: BuzzerUnit[] }
export interface Submission { groupId: string; rank: number; receivedAt: number; answers: Array<{ questionId: string; fillBlankId: string; text: string }> }
export interface Round {
  id: string;
  unitId: string;
  phase: Phase;
  openedAt?: number;
  openAtByGroup: Record<string, number>;
  roster: GroupSummary[];
  submissions: Submission[];
  winnerGroupId?: string;
}
export interface ActivityView {
  phase: Phase | 'idle';
  roundId: string | null;
  unit: BuzzerUnit | null;
  closedRoundIds: string[];
  availableUnits?: Array<{ unitId: string; questionIds: string[] }>;
  groups?: Array<{ id: string; name: string; received: boolean; rank?: number; answers?: Array<{ questionId: string; text: string }> }>;
  groupId?: string;
  received?: boolean;
  ownAnswers?: Array<{ questionId: string; text: string }>;
  waitRemainingMs?: number;
  version: number;
}
export interface RoundResultLine { questionId: string; groups: Array<{ groupId: string; groupName: string; answer: string; rank: number | null; status: string }> }
