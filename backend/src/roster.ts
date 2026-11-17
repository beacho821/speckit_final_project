import { randomInt, randomUUID } from 'node:crypto';
import type { Activity } from './activity.js';
import { changed } from './activity.js';
import { DomainError } from './rounds.js';

export function validateName(input: unknown, label = '組名'): string {
  if (typeof input !== 'string' || !input.trim()) throw new DomainError(422, 'INVALID_NAME', `${label}不可空白，請重新輸入。`);
  const name = input.trim();
  if ([...new Intl.Segmenter('zh-TW', { granularity: 'grapheme' }).segment(name)].length > 40) throw new DomainError(422, 'INVALID_NAME', `${label}須為 1 至 40 字，請縮短後重試。`);
  return name;
}
function editable(a: Activity) { if (a.rosterLocked) throw new DomainError(409, 'ROSTER_LOCKED', '名單已鎖定，請於新活動開始前調整。'); }
function rosterChanged(a: Activity, oldGroup?: string) { a.rosterVersion++; changed(a, ['teacher',...a.groups.map(g=>`student:${g.id}`),...(oldGroup?[`student:${oldGroup}`]:[])]); }
export function rosterFor(a: Activity) {
  return { groups:a.groups.map(g=>({...g,joinCode:a.joinCodes.get(g.id)!,members:[...a.members.values()].filter(m=>m.groupId===g.id).map(m=>({id:m.id,name:m.name}))})),locked:a.rosterLocked,rosterVersion:a.rosterVersion };
}
export function addGroup(a: Activity, input: unknown, teacherPassword: string, generate?: () => string) {
  editable(a); const name=validateName(input);
  if(a.groups.some(g=>g.name===name)) throw new DomainError(409,'DUPLICATE_GROUP_NAME','組名不可重複，請使用不同組名。');
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const make=generate??(()=>Array.from({length:8},()=>alphabet[randomInt(alphabet.length)]).join(''));
  let code=make(), attempts=0;
  while(code===teacherPassword||a.usedJoinCodes.has(code)) { if(++attempts>100) throw new DomainError(503,'CODE_UNAVAILABLE','目前無法產生加入碼，請稍後重試。'); code=make(); }
  if(!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw new DomainError(500,'CODE_UNAVAILABLE','加入碼產生失敗，請重試。');
  const group={id:randomUUID(),name}; a.groups.push(group); a.joinCodes.set(group.id,code); a.usedJoinCodes.add(code); rosterChanged(a); return group;
}
export function renameGroup(a: Activity,id:string,input:unknown) {
  editable(a); const group=a.groups.find(g=>g.id===id); if(!group) throw new DomainError(404,'GROUP_NOT_FOUND','找不到組別，請重新整理名單。');
  const name=validateName(input); if(a.groups.some(g=>g.id!==id&&g.name===name)) throw new DomainError(409,'DUPLICATE_GROUP_NAME','組名不可重複，請使用不同組名。');
  if(group.name!==name) { group.name=name; rosterChanged(a); }
}
export function deleteGroup(a:Activity,id:string) {
  editable(a); if(!a.groups.some(g=>g.id===id)) throw new DomainError(404,'GROUP_NOT_FOUND','找不到組別，請重新整理名單。');
  a.groups=a.groups.filter(g=>g.id!==id); a.joinCodes.delete(id);
  for(const [key,m] of a.members) if(m.groupId===id) a.members.delete(key);
  rosterChanged(a,id);
}
export function joinMember(a:Activity,groupId:string,input:unknown) {
  if(!a.groups.some(g=>g.id===groupId)||!a.joinCodes.has(groupId))throw new DomainError(401,'ACCESS_REVOKED','加入碼無效，請向老師確認。');
  const name=validateName(input,'名稱');
  const prior=[...a.members.values()].find(m=>m.groupId===groupId&&m.name===name); if(prior) return prior;
  const member={id:randomUUID(),groupId,name}; a.members.set(member.id,member); a.rosterVersion++; changed(a,['teacher']); return member;
}
