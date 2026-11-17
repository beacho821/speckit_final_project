import type { Worksheet } from '../../../shared/api.js';
import { changed, type Activity } from '../activity.js';
import { DomainError } from '../rounds.js';
import type { ImportResult } from './google-source.js';

export function publishImportedWorksheet(activity: Activity, result: ImportResult, requestGeneration: number, requestActivityId: string): Worksheet {
  if (!('worksheet' in result) || !result.worksheet) throw new DomainError(422, 'SHEET_SELECTION_REQUIRED', '請先選擇要匯入的工作表。');
  if (activity.id !== requestActivityId || activity.importGeneration !== requestGeneration || activity.rounds.some(round => round.phase !== 'preparing')) {
    throw new DomainError(409, 'IMPORT_SUPERSEDED', '匯入期間活動或來源已更新，請重新匯入。');
  }
  activity.worksheet = result.worksheet;
  activity.rounds = activity.rounds.filter(round => round.phase !== 'preparing');
  changed(activity);
  return result.worksheet;
}
