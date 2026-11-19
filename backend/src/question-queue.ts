import { catalogChanged, projectionChanged, type Activity } from './activity.js';
import { DomainError } from './rounds.js';

export function requireCatalogRevision(activity: Activity, revision: unknown) {
  if (!Number.isSafeInteger(revision) || Number(revision) < 0) {
    throw new DomainError(422, 'INVALID_CATALOG_REVISION', '請重新載入題目清單後再操作。');
  }
  if (revision !== activity.catalogRevision) {
    throw new DomainError(409, 'CATALOG_CHANGED', '題目清單已更新，請核對最新內容後再操作。');
  }
}

export function openedUnits(activity: Activity) {
  return new Set(activity.rounds.filter(round => round.phase !== 'preparing').map(round => round.unitId));
}

export function nextUnitId(activity: Activity) {
  const opened = openedUnits(activity);
  return activity.queueUnitIds.find(id => !opened.has(id)) ?? null;
}

export function requireNextUnit(activity: Activity, unitId: unknown, revision: unknown) {
  requireCatalogRevision(activity, revision);
  if (typeof unitId !== 'string' || !unitId) throw new DomainError(422, 'INVALID_UNIT', '請選擇有效題目。');
  if (nextUnitId(activity) !== unitId) throw new DomainError(409, 'NEXT_UNIT_CHANGED', '請在題目管理加入題目，並從控制台確認下一題。');
}

function queueView(activity: Activity) {
  return { queueUnitIds: activity.queueUnitIds, catalogRevision: activity.catalogRevision };
}

export function addToQueue(activity: Activity, input: { unitId?: unknown; catalogRevision?: unknown }) {
  requireCatalogRevision(activity, input.catalogRevision);
  const unit = activity.units.find(unit => unit.id === input.unitId && unit.questions[0]?.origin === 'worksheet');
  if (!unit) throw new DomainError(404, 'UNIT_NOT_FOUND', '找不到所選學習單題目，請重新整理。');
  if (openedUnits(activity).has(unit.id)) throw new DomainError(409, 'UNIT_ALREADY_USED', '此題已開放，請選擇其他題目。');
  if (!activity.queueUnitIds.includes(unit.id)) {
    const manual = new Set(activity.units.filter(unit => unit.questions[0]?.origin === 'manual').map(unit => unit.id));
    const firstManual = activity.queueUnitIds.findIndex(id => manual.has(id));
    activity.queueUnitIds.splice(firstManual < 0 ? activity.queueUnitIds.length : firstManual, 0, unit.id);
    catalogChanged(activity);
  }
  return queueView(activity);
}

export function reorderQueue(activity: Activity, input: { worksheetUnitIds?: unknown; catalogRevision?: unknown }) {
  requireCatalogRevision(activity, input.catalogRevision);
  const opened = openedUnits(activity);
  const worksheet = new Set(activity.units.filter(unit => unit.questions[0]?.origin === 'worksheet').map(unit => unit.id));
  const eligible = new Set(activity.queueUnitIds.filter(id => worksheet.has(id) && !opened.has(id)));
  const order = input.worksheetUnitIds;
  if (!Array.isArray(order) || order.length !== eligible.size || new Set(order).size !== order.length
    || !order.every(id => eligible.has(id))) throw new DomainError(422, 'INVALID_QUEUE_ORDER', '請重新排列所有尚未開放的學習單題目。');
  let index = 0;
  const next = activity.queueUnitIds.map(id => eligible.has(id) ? order[index++] as string : id);
  if (next.some((id, i) => id !== activity.queueUnitIds[i])) {
    activity.queueUnitIds = next;
    catalogChanged(activity);
  }
  return queueView(activity);
}

export function deleteQuestionUnit(activity: Activity, id: string, revision: unknown) {
  requireCatalogRevision(activity, revision);
  if (!activity.units.some(unit => unit.id === id)) throw new DomainError(404, 'UNIT_NOT_FOUND', '找不到欲刪除的題目，請重新整理。');
  if (openedUnits(activity).has(id)) throw new DomainError(409, 'UNIT_ALREADY_USED', '此題已開放，無法刪除。');
  activity.units = activity.units.filter(unit => unit.id !== id);
  activity.queueUnitIds = activity.queueUnitIds.filter(unitId => unitId !== id);
  const removedDraft = activity.rounds.some(round => round.unitId === id && round.phase === 'preparing');
  activity.rounds = activity.rounds.filter(round => round.unitId !== id);
  catalogChanged(activity, removedDraft ? ['teacher', ...activity.groups.map(group => `student:${group.id}`)] : undefined);
  if (removedDraft) projectionChanged(activity);
  return queueView(activity);
}
