import type { Worksheet } from '../../../shared/api.js';
import { catalogChanged, projectionChanged, type Activity } from '../activity.js';
import { worksheetUnits } from '../questions.js';
import { DomainError } from '../rounds.js';
import type { ImportResult } from './google-source.js';

export function publishImportedWorksheet(activity: Activity, result: ImportResult, requestGeneration: number, requestActivityId: string, alive: () => boolean = () => true): Worksheet {
  if (!('worksheet' in result) || !result.worksheet) throw new DomainError(422, 'SHEET_SELECTION_REQUIRED', '請先選擇要匯入的工作表。');
  if (!alive() || activity.rosterLocked || activity.id !== requestActivityId || activity.importGeneration !== requestGeneration || activity.rounds.some(round => round.phase !== 'preparing')) {
    throw new DomainError(409, 'IMPORT_SUPERSEDED', '匯入期間活動或來源已更新，請重新匯入。');
  }
  const manual = activity.worksheet ? [] : activity.units.filter(unit => unit.questions[0]?.origin === 'manual');
  const imported = worksheetUnits(result.worksheet);
  const importedAt = Math.max(Date.now(), (activity.worksheet?.source.importedAt ?? 0) + 1);
  const clearedRound = activity.rounds.some(round => round.phase === 'preparing');
  activity.worksheet = { ...result.worksheet, source: { ...result.worksheet.source, importedAt } };
  activity.units = [...imported, ...manual];
  activity.queueUnitIds = manual.map(unit => unit.id);
  activity.rounds = activity.rounds.filter(round => round.phase !== 'preparing');
  catalogChanged(activity, clearedRound ? ['teacher', ...activity.groups.map(group => `student:${group.id}`)] : undefined);
  if (clearedRound) projectionChanged(activity);
  return activity.worksheet;
}

export function beginImport(activity: Activity) {
  if (activity.rosterLocked) throw new DomainError(409, 'WORKSHEET_LOCKED', '已有回合開始，不能更換來源學習單。');
  return { generation: ++activity.importGeneration, activityId: activity.id };
}
