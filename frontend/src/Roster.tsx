import { useEffect, useState } from 'react';
import type { RosterResponse, SessionResponse } from '../../shared/api';
import { activityHeaders, readError } from './api';

export default function Roster({ session, credential, roster, onSave }: { session: SessionResponse; credential: string; roster: RosterResponse; onSave: (next: RosterResponse) => void }) {
  const [names, setNames] = useState<Record<string,string>>({});
  const [name, setName] = useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  useEffect(()=>{setNames(Object.fromEntries(roster.groups.map(g=>[g.id,g.name])));},[roster]);
  async function change(method:string,id?:string) {
    setBusy(true);setError('');
    try {const response=await fetch(id?`/api/groups/${encodeURIComponent(id)}`:'/api/groups',{method,headers:{...activityHeaders(session,credential),'Content-Type':'application/json'},...(method==='DELETE'?{}:{body:JSON.stringify({name:id?names[id]:name})})});
      if(!response.ok){setError((await readError(response)).message);return;}
      onSave(await response.json());if(!id)setName('');
    }catch{setError('連線中斷，請確認目前名單後再操作。');}finally{setBusy(false);}
  }
  return <section className="round-panel"><p className="eyebrow">名單設定</p><h2>組別名單</h2>
    <p className="muted">{roster.locked?'首回合已開始，名單已鎖定；程序重啟後可重新建立。':'新增組別後，請將加入碼交給該組學生。'}</p>
    {!roster.groups.length&&<p className="muted">尚無組別，請先建立名單。</p>}
    <div className="form-stack">{roster.groups.map(group=><article className="progress-card" key={group.id}>
      <div className="roster-edit"><input aria-label={`${group.name}組名`} disabled={roster.locked||busy} value={names[group.id]??group.name} onChange={e=>setNames({...names,[group.id]:e.target.value})}/><button className="secondary-button" disabled={roster.locked||busy} onClick={()=>void change('PATCH',group.id)}>更名</button><button className="remove-button" disabled={roster.locked||busy} onClick={()=>void change('DELETE',group.id)}>刪除</button></div>
      <p>加入碼：<strong className="join-code">{group.joinCode}</strong></p><p className="muted">曾加入名稱：{group.members.map(m=>m.name).join('、')||'尚無學生加入'}</p>
    </article>)}</div>
    {!roster.locked&&<form className="form-stack" onSubmit={e=>{e.preventDefault();void change('POST');}}><label htmlFor="new-group">新組名</label><input id="new-group" aria-label="新組名" required disabled={busy} value={name} onChange={e=>setName(e.target.value)}/><button className="primary" disabled={busy||!name.trim()}>{busy?'處理中…':'新增組別'}</button></form>}
    {error&&<p className="error" role="alert">{error}</p>}
  </section>;
}
