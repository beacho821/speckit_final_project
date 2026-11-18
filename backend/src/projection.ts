import type { ProjectionView } from '../../shared/api.js';
import type { Classroom } from './classrooms.js';
import { currentRound } from './rounds.js';
import { previewQuestion } from './questions.js';

export function projectionFor(room: Classroom, groupId?: string): ProjectionView {
  const activity = room.activity;
  const round = currentRound(activity) ?? activity.rounds.at(-1);
  const published = round?.phase === 'ended';
  const visible = round && round.phase !== 'preparing';
  const winner = published && round.roster.find(group => group.id === round.winnerGroupId && (!groupId || group.id === groupId));
  return {
    classroomName: room.name,
    ...(groupId ? { groupName: activity.groups.find(group => group.id === groupId)?.name } : {}),
    phase: round?.phase ?? 'idle',
    ...(visible ? { title: round.unitName ?? activity.units.find(unit => unit.id === round.unitId)?.name } : {}),
    questions: visible ? (round.questions ?? []).map(previewQuestion) : [],
    groups: activity.groups.filter(group => !groupId || group.id === groupId).map(group => ({
      id: group.id, name: group.name, received: Boolean(visible && round.submissions.some(item => item.groupId === group.id)),
    })),
    ...(winner ? { winnerGroupName: winner.name } : {}),
    version: activity.viewVersions[groupId ? `projection:${groupId}` : 'projection'] ?? 0,
  };
}
