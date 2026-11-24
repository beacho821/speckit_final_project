import { randomInt, randomUUID } from 'node:crypto';
import type { ArchivedRoster, ClassroomLocation, ClassroomSummary, HistoryRound } from '../../shared/api.js';
import { createActivity, type Activity } from './activity.js';
import type { ClassroomRecord, ClassroomStorage, LoadedStorage, StoredActivity } from './classroom-store.js';
import { currentRound, DomainError, endRound, multipart } from './rounds.js';
import { validateName } from './roster.js';

export interface Classroom {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  startedAt: number;
  activity: Activity;
  history: StoredActivity[];
}

const memoryStorage: ClassroomStorage = { async save() {}, async remove() {} };
const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const storageError = () => new DomainError(503, 'CLASSROOM_SAVE_FAILED', '教室存檔未完成，請確認存檔權限後再試。');
export const expiredActivity = () => new DomainError(409, 'ACTIVITY_EXPIRED', '活動已更新或教室已移除，請重新進入教室。');

function storedActivity(activity: Activity, startedAt: number): StoredActivity {
  return {
    id: activity.id, startedAt, groups: activity.groups, members: [...activity.members.values()],
    worksheet: activity.worksheet, units: activity.units, queueUnitIds: activity.queueUnitIds, rosterLocked: activity.rosterLocked,
    rosterVersion: activity.rosterVersion, settlementPublished: activity.settlementPublished,
    rounds: activity.rounds.map(round => {
      const { openedAt: _time, ...data } = round;
      return { ...data, openAtByGroup: {}, submissions: round.submissions.map(submission => ({
        ...submission, receivedAt: submission.receivedOn ?? 0,
      })) };
    }),
  };
}

function snapshot(room: Classroom, activity = room.activity, updatedAt = room.updatedAt): ClassroomRecord {
  return {
    schemaVersion: 1, id: room.id, name: room.name, createdAt: room.createdAt,
    updatedAt, currentActivityId: activity.id,
    activities: [...room.history, storedActivity(activity, room.startedAt)],
  };
}

export class Classrooms {
  readonly runtime = randomUUID();
  private rooms = new Map<string, Classroom>();
  private unavailable = new Map<string, string>();
  private pending = new Map<string, Promise<unknown>>();
  private issued = new Set<string>();
  private codeIndex = new Map<string, { room: Classroom; groupId: string }>();
  private writebackTargets = new Set<string>();

  constructor(private storage: ClassroomStorage = memoryStorage, private teacherPassword = '', readonly epoch: string | null = '1') {}

  static async restore(storage: LoadedStorage, password: string) {
    const directory = new Classrooms(storage, password, storage.epoch);
    for (const id of storage.unavailable) directory.unavailable.set(id, '無法讀取的教室（' + id + '）');
    for (const record of storage.records) {
      const current = record.activities.find(item => item.id === record.currentActivityId)!;
      for (const stored of record.activities) {
        let sequence = 0;
        for (const round of stored.rounds) {
          if (round.phase === 'preparing') continue;
          sequence++;
          round.sequenceNumber ??= sequence;
          round.isMultipart ??= multipart(round.questions ?? [], stored.worksheet);
        }
      }
      const manual = current.units.filter(unit => unit.questions[0]?.origin === 'manual').map(unit => unit.id);
      const worksheetIds = new Set(current.units.filter(unit => unit.questions[0]?.origin === 'worksheet').map(unit => unit.id));
      const queued = current.queueUnitIds ?? current.rounds.map(round => round.unitId);
      const queueUnitIds = [...new Set([...queued.filter(id => worksheetIds.has(id)), ...worksheetIds]), ...manual];
      const activity = { ...createActivity(), ...current, queueUnitIds, members: new Map(current.members.map(member => [member.id, member])) };
      const room = {
        id: record.id, name: record.name, createdAt: record.createdAt, updatedAt: record.updatedAt,
        startedAt: current.startedAt, activity, history: record.activities.filter(item => item.id !== current.id),
      };
      try {
        const round = currentRound(activity);
        if (round?.phase === 'active') {
          endRound(activity, round.id);
          await directory.save(snapshot(room));
        }
        directory.issueForGroups(activity);
        directory.rooms.set(room.id, room);
        directory.updateStudentCodes(room, new Map());
      } catch { directory.unavailable.set(room.id, room.name); }
    }
    return directory;
  }

  issue(randomPart = () => Array.from({ length: 10 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join('')) {
    if (this.epoch === null) throw new DomainError(503, 'CODE_UNAVAILABLE', '加入碼暫停使用，請管理者確認發碼世代存檔。');
    // 固定長度的隨機前段接上同字母表編碼的發碼世代，跨重啟仍不重複。
    const generation = Array.from(BigInt(this.epoch).toString(32), digit => codeAlphabet[parseInt(digit, 32)]).join('');
    for (let attempt = 0; attempt < 100; attempt++) {
      const code = randomPart() + generation;
      if (code !== this.teacherPassword.trim() && !this.issued.has(code)) {
        this.issued.add(code);
        return code;
      }
    }
    throw new DomainError(503, 'CODE_UNAVAILABLE', '目前無法產生加入碼，請稍後再試。');
  }

  private issueForGroups(activity: Activity) {
    if (this.epoch !== null) for (const group of activity.groups) activity.joinCodes.set(group.id, this.issue());
  }

  lookup(code: string) {
    if (this.epoch === null) throw new DomainError(503, 'CODE_UNAVAILABLE', '加入碼暫停使用，請管理者確認發碼世代存檔。');
    return this.codeIndex.get(code);
  }

  private updateStudentCodes(room: Classroom, previous: Map<string, string>) {
    for (const [id, code] of previous) {
      if (room.activity.joinCodes.get(id) !== code) this.codeIndex.delete(code);
    }
    for (const [groupId, code] of room.activity.joinCodes) {
      if (previous.get(groupId) !== code) this.codeIndex.set(code, { room, groupId });
    }
  }

  private revokeCodes(room: Classroom) {
    for (const code of room.activity.joinCodes.values()) this.codeIndex.delete(code);
  }

  summary(room: Classroom): ClassroomSummary {
    return {
      id: room.id, name: room.name, updatedAt: room.updatedAt,
      phase: currentRound(room.activity)?.phase ?? (room.activity.rounds.length ? 'ended' : 'idle'),
      writebackInProgress: room.activity.writebackInProgress,
    };
  }

  location(room: Classroom): ClassroomLocation {
    return { ...this.summary(room), classroomId: room.id, activityId: room.activity.id, activityEpoch: this.runtime };
  }

  list(): ClassroomSummary[] {
    return [...this.rooms.values()].map(room => this.summary(room))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .concat([...this.unavailable].map(([id, name]) => ({ id, name, updatedAt: 0, phase: 'idle', unavailable: true })));
  }

  get(id: string): Classroom {
    const room = this.rooms.get(id);
    if (room) return room;
    if (this.unavailable.has(id)) throw new DomainError(503, 'CLASSROOM_UNAVAILABLE', '此教室暫時無法恢復，請檢查存檔並在重啟後重試。');
    throw new DomainError(404, 'CLASSROOM_NOT_FOUND', '找不到教室，請返回教室列表。');
  }

  async create(input: unknown) {
    const name = validateName(input, '教室名稱');
    const now = Date.now();
    const room: Classroom = { id: randomUUID(), name, createdAt: now, updatedAt: now, startedAt: now, activity: createActivity(), history: [] };
    await this.save(snapshot(room));
    this.rooms.set(room.id, room);
    return room;
  }

  async exclusive<T>(room: Classroom, activity: Activity | undefined, work: () => Promise<T> | T): Promise<T> {
    const previous = this.pending.get(room.id);
    const next = (previous ?? Promise.resolve()).catch(() => undefined).then(() => {
      if (this.rooms.get(room.id) !== room || (activity && room.activity !== activity)) throw expiredActivity();
      return work();
    });
    this.pending.set(room.id, next);
    try { return await next; }
    finally { if (this.pending.get(room.id) === next) this.pending.delete(room.id); }
  }

  mutate<T>(room: Classroom, activity: Activity, change: (draft: Activity) => T): Promise<T> {
    return this.exclusive(room, activity, async () => {
      const draft = structuredClone(activity);
      // 題源只會整體替換。維持原物件可辨識單純回合異動。
      draft.worksheet = activity.worksheet;
      const result = change(draft);
      if (draft.version === activity.version && draft.rosterLocked === activity.rosterLocked) return result;
      const updatedAt = Math.max(Date.now(), room.updatedAt + 1);
      await this.save(snapshot(room, draft, updatedAt));
      const previousCodes = activity.joinCodes;
      Object.assign(activity, draft);
      room.updatedAt = updatedAt;
      this.updateStudentCodes(room, previousCodes);
      return result;
    });
  }

  startNew(room: Classroom, previous: Activity) {
    return this.exclusive(room, previous, async () => {
      this.requireNoWriteback(room);
      const round = currentRound(previous);
      if (round && round.phase !== 'preparing') throw new DomainError(409, 'ROUND_ACTIVE', '請先完成目前回合，再開始新活動。');
      const now = Date.now();
      const activity = Object.assign(createActivity(), {
        groups: structuredClone(previous.groups), worksheet: previous.worksheet, units: structuredClone(previous.units),
        queueUnitIds: [...previous.queueUnitIds],
      });
      this.issueForGroups(activity);
      const archived = structuredClone(storedActivity(previous, room.startedAt));
      archived.archivedAt = now;
      archived.rounds = archived.rounds.filter(item => item.phase === 'ended');
      const replacement = { ...room, activity, startedAt: now, updatedAt: Math.max(now, room.updatedAt + 1), history: [...room.history, archived] };
      await this.save(snapshot(replacement));
      this.revokeCodes(room);
      Object.assign(room, replacement);
      this.updateStudentCodes(room, new Map());
      return this.location(room);
    });
  }

  remove(room: Classroom) {
    return this.exclusive(room, undefined, async () => {
      this.requireNoWriteback(room);
      try { await this.storage.remove(room.id); } catch { throw storageError(); }
      this.revokeCodes(room);
      this.rooms.delete(room.id);
    });
  }

  archivedRosters(room: Classroom): ArchivedRoster[] {
    return [...room.history].reverse().map(activity => ({
      activityId: activity.id,
      startedAt: activity.startedAt,
      archivedAt: activity.archivedAt!,
      groups: activity.groups.map(({ id, name }) => ({
        id, name,
        members: activity.members.filter(member => member.groupId === id).map(member => ({ id: member.id, name: member.name })),
      })),
    }));
  }

  history(room: Classroom): HistoryRound[] {
    return [...room.history, storedActivity(room.activity, room.startedAt)].reverse().flatMap(activity =>
      activity.rounds.filter(round => round.phase === 'ended').reverse().map(round => ({
        activityId: activity.id, startedAt: activity.startedAt, roundId: round.id,
        questionNumber: round.sequenceNumber,
        title: round.unitName ?? round.questions?.map(question => question.questionId).join('、') ?? '已定案回合',
        winnerGroupName: round.roster.find(group => group.id === round.winnerGroupId)?.name,
      })));
  }

  async beginWriteback(room: Classroom, activity: Activity, target: string) {
    await this.exclusive(room, activity, () => {
      if (activity.writebackInProgress) throw new DomainError(409, 'WRITEBACK_BUSY', '回填作業正在執行，請稍候再查看結果。');
      if (this.writebackTargets.has(target)) throw new DomainError(409, 'WRITEBACK_TARGET_BUSY', '此工作表正在回填，請稍後再試。');
      this.writebackTargets.add(target);
      activity.writebackInProgress = true;
      activity.viewVersions.teacher = (activity.viewVersions.teacher ?? 0) + 1;
    });
    return () => this.exclusive(room, activity, () => {
      this.writebackTargets.delete(target);
      activity.writebackInProgress = false;
      activity.viewVersions.teacher = (activity.viewVersions.teacher ?? 0) + 1;
    });
  }

  private requireNoWriteback(room: Classroom) {
    if (room.activity.writebackInProgress) throw new DomainError(409, 'WRITEBACK_IN_PROGRESS', '回填進行中，請稍後再試。');
  }

  private async save(record: ClassroomRecord) {
    try { await this.storage.save(record); } catch { throw storageError(); }
  }
}
