import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Activity } from './activity.js';
import type { RoundQuestion, StudentMember, Worksheet } from '../../shared/api.js';

export type StoredActivity = Pick<Activity, 'id' | 'groups' | 'rosterVersion' | 'rosterLocked' | 'worksheet' | 'units' | 'rounds'> & {
  queueUnitIds?: string[];
  settlementPublished?: boolean;
  settlementGroupCount?: number;
  members: StudentMember[];
  startedAt: number;
  archivedAt?: number;
};
export interface ClassroomRecord {
  ownerId?: string;
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  currentActivityId: string;
  activities: StoredActivity[];
}
export interface ClassroomStorage {
  save(record: ClassroomRecord): Promise<void>;
  remove(id: string): Promise<void>;
}
export interface LoadedStorage extends ClassroomStorage {
  epoch: string | null;
  records: ClassroomRecord[];
  unavailable: string[];
}

const classroomId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function atomicJson(path: string, value: unknown) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const file = await open(temporary, 'wx', 0o600);
  try {
    try {
      await file.writeFile(JSON.stringify(value), 'utf8');
      await file.sync();
    } finally { await file.close(); }
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

const isText = (value: unknown): value is string => typeof value === 'string';
const isOptionalText = (value: unknown) => value === undefined || isText(value);
const isPrompt = (value: unknown) => value === null || isText(value);
const isPositiveIndex = (value: number) => Number.isSafeInteger(value) && value > 0;

function checkWorksheet(worksheet: Worksheet) {
  const { source, fills, units } = worksheet;
  if (!source || !isText(source.sheetTitle) || !Number.isFinite(source.importedAt)
    || !Number.isSafeInteger(source.sheetId) || source.sheetId < 0
    || !(source.kind === 'google' ? isText(source.documentId) && source.documentId.length
      : source.kind === 'xlsx' && isText(source.fileName) && source.fileName.length)
    || !Array.isArray(fills) || !Array.isArray(units)) throw new Error('學習單來源資料不正確。');

  const byId = new Map(fills.map(fill => {
    if (!fill || !isText(fill.id) || !isText(fill.questionId) || !isText(fill.mainQuestionId)
      || !isText(fill.unitId) || !isPositiveIndex(fill.row) || !isPositiveIndex(fill.column)
      || !isText(fill.originalType) || !('originalValue' in fill) || !isOptionalText(fill.note)
      || !isOptionalText(fill.subQuestionId) || (fill.prompt !== undefined && !isPrompt(fill.prompt))
      || !['header', 'marker', 'note'].includes(fill.identitySource)) throw new Error('學習單填空資料不正確。');
    return [fill.id, fill];
  }));
  const referenced = new Set<string>();
  const unitIds = new Set<string>();
  for (const unit of units) {
    if (!unit || !isText(unit.id) || !isText(unit.name) || unitIds.has(unit.id)
      || !Array.isArray(unit.questionIds) || !Array.isArray(unit.fillBlankIds)
      || unit.questionIds.length !== unit.fillBlankIds.length || !unit.questionIds.length) {
      throw new Error('學習單題組資料不正確。');
    }
    unitIds.add(unit.id);
    unit.fillBlankIds.forEach((id, index) => {
      const fill = byId.get(id);
      if (!fill || referenced.has(id) || fill.unitId !== unit.id || fill.questionId !== unit.questionIds[index]) {
        throw new Error('學習單題組與填空不一致。');
      }
      referenced.add(id);
    });
  }
  if (referenced.size !== fills.length) throw new Error('學習單填空資料不一致。');
  return byId;
}

function checkQuestions(questions: RoundQuestion[], unitId: string) {
  if (!Array.isArray(questions)) throw new Error('缺少題目資料。');
  const ids = new Set<string>();
  for (const question of questions) {
    if (!question || !isText(question.questionId) || ids.has(question.questionId)
      || !isText(question.questionKey) || question.unitId !== unitId || !isPrompt(question.prompt)
      || typeof question.missingPrompt !== 'boolean' || !['worksheet', 'manual'].includes(question.origin)
      || !isOptionalText(question.fillBlankId) || !Number.isSafeInteger(question.questionRevision)
      || !Array.isArray(question.acceptedAnswers) || !question.acceptedAnswers.every(isText)) throw new Error('題目資料不一致。');
    ids.add(question.questionId);
  }
  return ids;
}

function recordFrom(raw: unknown, id: string): ClassroomRecord {
  const data = raw as ClassroomRecord;
  if (!data || data.schemaVersion !== 1 || data.id !== id || !classroomId.test(id)
    || (data.ownerId !== undefined && data.ownerId !== 'master' && !classroomId.test(data.ownerId))
    || typeof data.name !== 'string' || !data.name.trim()
    || !Number.isFinite(data.createdAt) || !Number.isFinite(data.updatedAt)
    || !Array.isArray(data.activities) || !data.activities.length) throw new Error('無法辨識教室紀錄。');
  const active = data.activities.filter(activity => activity?.archivedAt === undefined);
  if (active.length !== 1 || active[0]?.id !== data.currentActivityId
    || new Set(data.activities.map(activity => activity.id)).size !== data.activities.length) throw new Error('教室活動定位不符。');
  for (const activity of data.activities) {
    if (!classroomId.test(activity.id) || !Number.isFinite(activity.startedAt)
      || (activity.archivedAt !== undefined && !Number.isFinite(activity.archivedAt))
      || !Number.isSafeInteger(activity.rosterVersion) || typeof activity.rosterLocked !== 'boolean'
      || (activity.settlementPublished !== undefined && typeof activity.settlementPublished !== 'boolean')
      || !Array.isArray(activity.groups) || !Array.isArray(activity.members)
      || !Array.isArray(activity.units) || !Array.isArray(activity.rounds)
      || (activity.worksheet !== null && (!activity.worksheet?.source || !Array.isArray(activity.worksheet.fills) || !Array.isArray(activity.worksheet.units)))) {
      throw new Error('活動資料格式不正確。');
    }
    const groups = new Set(activity.groups.map(group => {
      if (!group || typeof group.id !== 'string' || typeof group.name !== 'string') throw new Error('組別資料不正確。');
      return group.id;
    }));
    if (groups.size !== activity.groups.length || activity.members.some(member => !member || !groups.has(member.groupId)
      || typeof member.name !== 'string' || typeof member.id !== 'string')) throw new Error('成員資料不一致。');
    if (activity.settlementGroupCount !== undefined && (!Number.isSafeInteger(activity.settlementGroupCount)
      || activity.settlementGroupCount < 0 || activity.settlementGroupCount > groups.size)) throw new Error('結算組數不一致。');
    const fills = activity.worksheet ? checkWorksheet(activity.worksheet) : new Map<string, Worksheet['fills'][number]>();
    const units = new Map<string, StoredActivity['units'][number]>();
    for (const unit of activity.units) {
      if (!unit || !isText(unit.id) || !isText(unit.name) || units.has(unit.id)) throw new Error('題組資料不一致。');
      checkQuestions(unit.questions, unit.id);
      for (const question of unit.questions) {
        if (question.origin === 'worksheet') {
          const fill = question.fillBlankId === undefined ? undefined : fills.get(question.fillBlankId);
          if (!fill || fill.unitId !== unit.id || fill.questionId !== question.questionId) throw new Error('題目與填空不一致。');
        }
      }
      units.set(unit.id, unit);
    }
    if (activity.queueUnitIds !== undefined) {
      const queue = activity.queueUnitIds;
      if (!Array.isArray(queue)) throw new Error('出題清單格式不正確。');
      const queued = new Set(queue);
      if (queued.size !== queue.length || queue.some(id => !units.has(id))) {
        throw new Error('出題清單與題庫不一致。');
      }
      if (activity.units.some(unit => unit.questions[0]?.origin === 'manual' && !queued.has(unit.id))) {
        throw new Error('出題清單缺少手動題。');
      }
    }
    let questionNumber = 0;
    if (activity.rounds.filter(round => round.phase !== 'ended').length > (activity.archivedAt === undefined ? 1 : 0)) throw new Error('回合狀態不一致。');
    for (const round of activity.rounds) {
      if (!round || typeof round.id !== 'string' || typeof round.unitId !== 'string'
        || !['preparing', 'active', 'reviewing', 'ended'].includes(round.phase)
        || !Array.isArray(round.roster) || !Array.isArray(round.submissions)
        || (round.phase !== 'preparing' && !Array.isArray(round.questions))
        || (round.phase !== 'ended' && !units.has(round.unitId))
        || !isOptionalText(round.unitName)) throw new Error('回合資料不一致。');
      if (round.phase !== 'preparing') questionNumber++;
      if ((round.sequenceNumber !== undefined && (round.phase === 'preparing' || round.sequenceNumber !== questionNumber))
        || (round.isMultipart !== undefined && typeof round.isMultipart !== 'boolean')) throw new Error('回合題號不一致。');
      const questionIds = checkQuestions(round.questions === undefined ? [] : round.questions, round.unitId);
      const roster = new Set(round.roster.map(group => {
        if (!group || !isText(group.id) || !isText(group.name)) throw new Error('回合組別資料不一致。');
        return group.id;
      }));
      if (roster.size !== round.roster.length || (round.winnerGroupId !== undefined && !roster.has(round.winnerGroupId))
        || (round.phase !== 'preparing' && !questionIds.size)) throw new Error('回合資料不一致。');
      const supplementIds = new Set<string>();
      if (round.supplements !== undefined) {
        if (!Array.isArray(round.supplements)) throw new Error('補答資料不一致。');
        for (const supplement of round.supplements) {
          if (!supplement || !questionIds.has(supplement.questionId) || !isText(supplement.text)
            || supplementIds.has(supplement.questionId)) throw new Error('補答資料不一致。');
          supplementIds.add(supplement.questionId);
        }
      }
      const seen = new Set<string>();
      for (const [index, submission] of round.submissions.entries()) {
        const answered = new Set<string>();
        if (!submission || !roster.has(submission.groupId) || seen.has(submission.groupId)
          || submission.rank !== index + 1 || !Number.isFinite(submission.receivedAt)
          || !Array.isArray(submission.answers) || submission.answers.length !== questionIds.size
          || submission.answers.some(answer => {
            if (!answer || !questionIds.has(answer.questionId) || !isText(answer.text)
              || !isOptionalText(answer.fillBlankId) || answered.has(answer.questionId)) return true;
            answered.add(answer.questionId);
            return false;
          })) throw new Error('收件資料不一致。');
        seen.add(submission.groupId);
      }
    }
  }
  return data;
}

export async function openClassroomStorage(directory: string): Promise<LoadedStorage> {
  let created: string | undefined;
  let files: string[];
  try {
    created = await mkdir(directory, { recursive: true, mode: 0o700 });
    files = await readdir(directory);
  } catch {
    throw new Error('無法開啟教室存檔資料夾，請確認本機讀取權限。');
  }
  const generation = join(directory, 'issuance-epoch.json');
  let epoch: string | null = null;
  try {
    const last = created ? '0' : (JSON.parse(await readFile(generation, 'utf8')) as { epoch?: unknown }).epoch;
    if (typeof last !== 'string' || !/^(0|[1-9][0-9]{0,31})$/.test(last)) throw new Error();
    const next = (BigInt(last) + 1n).toString();
    if (next.length > 32) throw new Error();
    await atomicJson(generation, { epoch: next });
    epoch = next;
  } catch { /* 世代無法確認時，保留教室資料並停用加入碼。 */ }
  const records: ClassroomRecord[] = [];
  const unavailable: string[] = [];
  for (const file of files) {
    if (!file.endsWith('.json') || file === 'issuance-epoch.json') continue;
    const id = file.slice(0, -5);
    try { records.push(recordFrom(JSON.parse(await readFile(join(directory, file), 'utf8')), id)); }
    catch { unavailable.push(id); }
  }
  return {
    epoch, records, unavailable,
    save: record => atomicJson(join(directory, record.id + '.json'), record),
    remove: id => unlink(join(directory, id + '.json')),
  };
}
