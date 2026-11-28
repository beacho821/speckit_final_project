import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openClassroomStorage } from '../../backend/src/classroom-store';
import { Classrooms } from '../../backend/src/classrooms';

it('存檔重啟保留教室並遞增發碼世代，個別損壞檔可隔離', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'classroom-store-'));
  try {
    const path = join(directory, 'records');
    const first = await Classrooms.restore(await openClassroomStorage(path), '測試密碼');
    const room = await first.create('第一間');
    await writeFile(join(path, 'damaged.json'), '{}');
    const second = await Classrooms.restore(await openClassroomStorage(path), '測試密碼');
    expect(second.summary(second.get(room.id)).name).toBe('第一間');
    expect(second.epoch).not.toBe(first.epoch);
    expect(second.list().find(entry => entry.id === 'damaged')?.unavailable).toBe(true);
    const record = JSON.parse(await readFile(join(path, room.id + '.json'), 'utf8'));
    expect(Object.keys(record.activities[0])).not.toContain('joinCodes');
    await writeFile(join(path, 'issuance-epoch.json'), '{}');
    const disabled = await Classrooms.restore(await openClassroomStorage(path), '測試密碼');
    expect(disabled.epoch).toBeNull();
    expect(disabled.get(room.id).name).toBe('第一間');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('只有舊備份時維持停用，恢復可確認的最後發碼世代後才發出新碼', async () => {
  const root = await mkdtemp(join(tmpdir(), 'classroom-epoch-'));
  try {
    const directory = join(root, 'records');
    const generation = join(directory, 'issuance-epoch.json');
    const restore = async () => Classrooms.restore(await openClassroomStorage(directory), '測試密碼');
    const first = await restore();
    const room = await first.create('保留的教室');
    const oldBackup = await readFile(generation, 'utf8');
    const last = await restore();
    const oldCode = last.issue(() => 'SAMEPART');
    const knownLastEpoch = await readFile(generation, 'utf8');
    expect(BigInt(JSON.parse(oldBackup).epoch)).toBeLessThan(BigInt(JSON.parse(knownLastEpoch).epoch));

    await writeFile(generation, '{}');
    const disabled = await restore();
    expect(disabled.epoch).toBeNull();
    expect(disabled.get(room.id).name).toBe('保留的教室');
    for (const projection of [false, true]) {
      expect(() => disabled.lookup(oldCode, projection)).toThrow(expect.objectContaining({ status: 503 }));
    }
    expect(() => disabled.issue()).toThrow(expect.objectContaining({ status: 503 }));
    expect(await readFile(generation, 'utf8')).toBe('{}');

    // 停機時由管理者寫回已確認的最後發碼世代。
    await writeFile(generation, knownLastEpoch);
    const recovered = await restore();
    expect(BigInt(recovered.epoch!)).toBe(BigInt(last.epoch!) + 1n);
    expect(recovered.issue(() => 'SAMEPART')).not.toBe(oldCode);
    expect(recovered.lookup(oldCode)).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('隔離外層有效但來源、題組、題目、補答或收件關聯損壞的教室', async () => {
  const root = await mkdtemp(join(tmpdir(), 'classroom-nested-'));
  try {
    const directory = join(root, 'records');
    const storage = await openClassroomStorage(directory);
    const classrooms = await Classrooms.restore(storage, '測試密碼');
    const healthy = await classrooms.create('正常教室');
    const group = { id: 'g', name: '甲組' };
    const question = { questionId: '1', questionKey: 'q', unitId: 'u', origin: 'worksheet', fillBlankId: 'f',
      acceptedAnswers: ['答案'], prompt: '請填答。', missingPrompt: false, questionRevision: 1 };
    const worksheet = {
      source: { kind: 'google', documentId: 'doc', sheetId: 0, sheetTitle: '資料', importedAt: 1 },
      fills: [{ id: 'f', questionId: '1', mainQuestionId: '1', unitId: 'u', row: 2, column: 1,
        originalValue: null, originalType: 'blank', identitySource: 'header' }],
      units: [{ id: 'u', name: '題組', questionIds: ['1'], fillBlankIds: ['f'] }],
    };
    const round = { id: 'r', phase: 'ended', unitId: 'u', questions: [question], roster: [group], openAtByGroup: {},
      supplements: [{ questionId: '1', text: '補答' }],
      submissions: [{ groupId: 'g', rank: 1, receivedAt: 1, answers: [{ questionId: '1', text: '作答' }] }] };
    type Snapshot = { worksheet: typeof worksheet; units: { id: string; name: string; questions: typeof round.questions }[]; rounds: typeof round[] };
    const damages: [string, (activity: Snapshot) => void][] = [
      ['來源', activity => { activity.worksheet.source.documentId = ''; }],
      ['題組', activity => { activity.worksheet.units[0].fillBlankIds[0] = '不存在'; }],
      ['題目', activity => { activity.rounds[0].questions[0].acceptedAnswers = [null as unknown as string]; }],
      ['補答', activity => { activity.rounds[0].supplements[0].questionId = '2'; }],
      ['收件', activity => { activity.rounds[0].submissions[0].answers[0].questionId = '2'; }],
    ];
    const damaged = new Map<string, string>();
    for (const [name, damage] of [['正常來源', () => {}], ...damages] as typeof damages) {
      const room = await classrooms.create(name);
      const path = join(directory, room.id + '.json');
      const record = JSON.parse(await readFile(path, 'utf8'));
      const data: Snapshot = { worksheet: structuredClone(worksheet),
        units: [{ id: 'u', name: '題組', questions: [structuredClone(question)] }], rounds: [structuredClone(round)] };
      damage(data);
      Object.assign(record.activities[0], data, { groups: [group], rosterLocked: true });
      const json = JSON.stringify(record);
      await writeFile(path, json);
      if (name !== '正常來源') damaged.set(room.id, json);
    }
    const reopened = await Classrooms.restore(await openClassroomStorage(directory), '測試密碼');
    expect(reopened.get(healthy.id).name).toBe('正常教室');
    expect(reopened.list().some(room => room.name === '正常來源' && !room.unavailable)).toBe(true);
    for (const [id, original] of damaged) {
      expect(reopened.list().find(room => room.id === id)?.unavailable).toBe(true);
      expect(() => reopened.get(id)).toThrow(expect.objectContaining({ status: 503, code: 'CLASSROOM_UNAVAILABLE' }));
      expect(await readFile(join(directory, id + '.json'), 'utf8')).toBe(original);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('重啟後教師帳號仍可登入，舊教室歸主帳號、子帳號保有自己的教室', async () => {
  const { TeacherAccounts } = await import('../../backend/src/accounts');
  const { randomUUID } = await import('node:crypto');
  const directory = await mkdtemp(join(tmpdir(), 'classroom-accounts-'));
  const config = { teacherPassword: randomUUID(), teacherUsername: '主教師', teacherDisplayName: '張老師', port: 0 };
  const secret = randomUUID();
  try {
    const accounts = await TeacherAccounts.open(config, join(directory, 'teachers'));
    const master = await accounts.login('主教師', config.teacherPassword);
    expect(master.displayName).toBe('張老師');
    await accounts.update(accounts.identity(master.token), '教師乙', secret, true);
    const sub = await accounts.login('教師乙', secret);
    const id = accounts.identity(sub.token);
    const rooms = await Classrooms.restore(await openClassroomStorage(join(directory, 'rooms')), config.teacherPassword);
    const old = await rooms.create('舊教室'), mine = await rooms.create('子帳號教室', id);
    const path = join(directory, 'rooms', old.id + '.json');
    const legacy = JSON.parse(await readFile(path, 'utf8')); delete legacy.ownerId; await writeFile(path, JSON.stringify(legacy));
    const restart = await TeacherAccounts.open(config, join(directory, 'teachers'));
    const restored = await Classrooms.restore(await openClassroomStorage(join(directory, 'rooms')), config.teacherPassword);
    expect(() => restart.identity(sub.token)).toThrow('重新登入');
    const restoredTeacher = await restart.login('教師乙', secret);
    expect(restoredTeacher.displayName).toBe('教師乙');
    expect(restart.identity(restoredTeacher.token)).toBe(id);
    expect(restored.list(id).map(room => room.id)).toEqual([mine.id]);
    expect(restored.list('master').map(room => room.id)).toEqual([old.id]);
    expect(await readFile(join(directory, 'teachers', 'accounts.json'), 'utf8')).not.toContain(secret);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
