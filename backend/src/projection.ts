import type { ProjectionView } from '../../shared/api.js';
import type { Classroom } from './classrooms.js';
import { currentRound, publishedAnswers } from './rounds.js';
import { previewQuestion } from './questions.js';
import { activityStandings } from './scoring.js';

export function projectionFor(room: Classroom): ProjectionView {
  const activity = room.activity;
  const round = currentRound(activity) ?? activity.rounds.at(-1);
  const published = round?.phase === 'ended';
  const answers = published ? publishedAnswers(round) : undefined;
  const visible = round && round.phase !== 'preparing';
  const winner = published && round.roster.find(group => group.id === round.winnerGroupId);
  const standings = activityStandings(activity);
  return {
    classroomName: room.name,
    phase: round?.phase ?? 'idle',
    ...(visible ? { title: round.unitName ?? activity.units.find(unit => unit.id === round.unitId)?.name } : {}),
    questions: visible ? (round.questions ?? []).map((question, index) => {
      const publishedAnswer = answers?.get(question.questionId);
      return {
        ...previewQuestion(question), questionNumber: round.sequenceNumber, partNumber: round.isMultipart ? index + 1 : null,
        ...(publishedAnswer !== undefined ? { publishedAnswer } : {}),
      };
    }) : [],
    groups: activity.groups.map(group => ({
      id: group.id, name: group.name, received: Boolean(visible && round.submissions.some(item => item.groupId === group.id)),
    })),
    ...(winner ? { winnerGroupName: winner.name } : {}),
    ...(activity.settlementPublished ? { settlement: standings } : { standings: standings.groups }),
    version: activity.viewVersions.projection ?? 0,
  };
}
