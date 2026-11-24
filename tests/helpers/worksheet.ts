import type {Worksheet} from '../../shared/api';
export const worksheet:Worksheet={source:{kind:'google',documentId:'isolated',sheetId:1,sheetTitle:'題組',importedAt:1},fills:['1（1）','1（2）'].map((questionId,i)=>({id:`f${i}`,questionId,mainQuestionId:'1',subQuestionId:String(i+1),unitId:'u',row:2+i,column:2,originalValue:null,originalType:'blank',identitySource:'header'})),units:[{id:'u',name:'題組',questionIds:['1（1）','1（2）'],fillBlankIds:['f0','f1']}]};

import type { Activity } from '../../backend/src/activity.js';
import { worksheetUnits } from '../../backend/src/questions.js';
import { endRound, publishRound } from '../../backend/src/rounds.js';

export function configureWorksheet(activity: Activity, answers: (questionId: string) => string[] = () => ['答案']) {
  if (!activity.worksheet) throw new Error('測試學習單尚未設定。');
  activity.units = worksheetUnits(activity.worksheet);
  for (const unit of activity.units) for (const question of unit.questions) {
    if (question.missingPrompt) {
      question.prompt = `測試題目 ${question.questionId}：請填答。`;
      question.missingPrompt = false;
    }
    question.acceptedAnswers = answers(question.questionId);
  }
}

export function finishRound(activity: Activity, roundId: string) {
  const round = endRound(activity, roundId);
  publishRound(activity, roundId, round.reviewRevision);
  return round;
}
