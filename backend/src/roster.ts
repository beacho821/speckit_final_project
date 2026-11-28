import { randomInt, randomUUID } from 'node:crypto';
import type { Activity } from './activity.js';
import { changed, projectionChanged } from './activity.js';
import { currentRound, DomainError } from './rounds.js';

export function validateName(input: unknown, label = '組名'): string {
  if (typeof input !== 'string' || !input.trim()) throw new DomainError(422, 'INVALID_NAME', `${label}不可空白，請重新輸入。`);
  const name = input.trim();
  if ([...new Intl.Segmenter('zh-TW', { granularity: 'grapheme' }).segment(name)].length > 40) throw new DomainError(422, 'INVALID_NAME', `${label}須為 1 至 40 字，請縮短後重試。`);
  return name;
}
export function requireEditableRoster(a: Activity) { if (a.rosterLocked) throw new DomainError(409, 'ROSTER_LOCKED', '本場已開題，更名、刪組及異動既有成員請於新活動開題前進行。'); }
function rosterChanged(a: Activity, oldGroup?: string) { a.rosterVersion++; changed(a, ['teacher',...a.groups.map(g=>`student:${g.id}`),...(oldGroup?[`student:${oldGroup}`]:[])]); projectionChanged(a); }
export function rosterFor(a: Activity) {
  return { groups:a.groups.map(g=>({...g,joinCode:a.joinCodes.get(g.id) ?? '',members:[...a.members.values()].filter(m=>m.groupId===g.id).map(m=>({id:m.id,name:m.name}))})),locked:a.rosterLocked,rosterVersion:a.rosterVersion };
}
export function addGroup(a: Activity, input: unknown, teacherPassword: string, generate?: () => string, issueCode?: () => string | null) {
  const name=validateName(input);
  if(a.groups.some(g=>g.name===name)) throw new DomainError(409,'DUPLICATE_GROUP_NAME','組名不可重複，請使用不同組名。');
  const code = issueCode ? issueCode() : localJoinCode(a, teacherPassword, generate);
  const group = { id: randomUUID(), name };
  // 舊存檔只有公布旗標；第一次補建組別時記住原有的公布範圍。
  if (a.settlementPublished) a.settlementGroupCount ??= a.groups.length;
  a.groups.push(group);
  if (code !== null) a.joinCodes.set(group.id, code);
  const round = currentRound(a);
  if (round?.phase === 'preparing' || round?.phase === 'active') {
    round.roster.push({ ...group });
    // 新組沒有先前勝場，可立即參與仍在收件的回合。
    if (round.phase === 'active') round.openAtByGroup[group.id] = round.openedAt ?? 0;
  }
  rosterChanged(a);
  return group;
}

function localJoinCode(a: Activity, teacherPassword: string, generate?: () => string) {
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const make=generate??(()=>Array.from({length:8},()=>alphabet[randomInt(alphabet.length)]).join(''));
  let code=make(), attempts=0;
  while(code===teacherPassword||a.usedJoinCodes.has(code)) { if(++attempts>100) throw new DomainError(503,'CODE_UNAVAILABLE','目前無法產生加入碼，請稍後重試。'); code=make(); }
  if(!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw new DomainError(500,'CODE_UNAVAILABLE','加入碼產生失敗，請重試。');
  a.usedJoinCodes.add(code);
  return code;
}
export function renameGroup(a: Activity,id:string,input:unknown) {
  requireEditableRoster(a); const group=a.groups.find(g=>g.id===id); if(!group) throw new DomainError(404,'GROUP_NOT_FOUND','找不到組別，請重新整理名單。');
  const name=validateName(input); if(a.groups.some(g=>g.id!==id&&g.name===name)) throw new DomainError(409,'DUPLICATE_GROUP_NAME','組名不可重複，請使用不同組名。');
  if(group.name!==name) { group.name=name; rosterChanged(a); }
}
function removeMember(a: Activity, id: string) {
  a.members.delete(id);
  a.memberLoginCodes.delete(id);
}

export function deleteGroup(a:Activity,id:string) {
  requireEditableRoster(a); if(!a.groups.some(g=>g.id===id)) throw new DomainError(404,'GROUP_NOT_FOUND','找不到組別，請重新整理名單。');
  a.groups=a.groups.filter(g=>g.id!==id); a.joinCodes.delete(id);
  for(const [key,m] of a.members) if(m.groupId===id) removeMember(a, key);
  rosterChanged(a,id);
}
export function changeMember(a: Activity, id: string, from: unknown, target: unknown, remove: boolean) {
  requireEditableRoster(a);
  const member = a.members.get(id);
  if (!member || member.groupId !== from) throw new DomainError(409, 'MEMBER_CHANGED', '學生名單已更新，請重新載入後操作。');
  if (remove) removeMember(a, id);
  else {
    if (typeof target !== 'string' || target === from || !a.groups.some(group => group.id === target)) throw new DomainError(422, 'INVALID_GROUP', '請選擇其他有效組別。');
    if ([...a.members.values()].some(other => other.groupId === target && other.name === member.name)) throw new DomainError(409, 'DUPLICATE_MEMBER', '目的組已有同名學生，請先確認名單。');
    a.members.set(id, { ...member, groupId: target });
    // 舊分頁只送上次讀到的版本號，移組後的新版本必須超過原組版本。
    const targetView = 'student:' + target;
    a.viewVersions[targetView] = Math.max(a.viewVersions[targetView] ?? 0, a.viewVersions['student:' + member.groupId] ?? 0);
  }
  rosterChanged(a, member.groupId);
}

function addMember(a: Activity, groupId: string, name: string) {
  const member = { id: randomUUID(), groupId, name };
  a.members.set(member.id, member);
  return member;
}

export function mergeRoster(a: Activity, rows: Map<string, Set<string>>, teacherPassword: string, issueCode: () => string | null) {
  const existingGroups = new Map(a.groups.map(group => [group.name, group]));
  const existingMembers = new Map<string, Set<string>>();
  for (const member of a.members.values()) {
    const names = existingMembers.get(member.groupId) ?? new Set<string>();
    names.add(member.name);
    existingMembers.set(member.groupId, names);
  }
  let added = 0, skipped = 0;
  for (const [groupName, names] of rows) {
    const group = existingGroups.get(groupName) ?? addGroup(a, groupName, teacherPassword, undefined, issueCode);
    for (const name of names) {
      if (existingMembers.get(group.id)?.has(name)) { skipped++; continue; }
      addMember(a, group.id, name);
      added++;
    }
  }
  if (added) { a.rosterVersion++; changed(a, ['teacher']); }
  return { roster: rosterFor(a), added, skipped };
}

export function joinMember(a: Activity, groupId: string, input: unknown) {
  const code = a.joinCodes.get(groupId);
  if (!code || !a.groups.some(group => group.id === groupId)) throw new DomainError(401, 'ACCESS_REVOKED', '加入碼無效，請向老師確認。');
  const name = validateName(input, '名稱');
  const existing = [...a.members.values()].find(member => member.groupId === groupId && member.name === name);
  const member = existing ?? addMember(a, groupId, name);
  const codes = a.memberLoginCodes.get(member.id) ?? new Set<string>();
  if (!codes.has(code)) {
    codes.add(code);
    a.memberLoginCodes.set(member.id, codes);
    if (!existing) a.rosterVersion++;
    changed(a, existing ? [] : ['teacher']);
  }
  return member;
}
