import { useEffect, useState } from 'react';
import type { RosterResponse, SessionResponse } from '../../shared/api';
import { activityHeaders, readError } from './api';

export default function Roster({ session, credential, roster, onSave }: { session: SessionResponse; credential: string; roster: RosterResponse; onSave: (next: RosterResponse) => void }) {
  const [groups, setGroups] = useState(roster.groups);
  const [newId, setNewId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setGroups(roster.groups); }, [roster]);
  const unused = roster.availableGroups.filter(item => !groups.some(group => group.id === item.id));
  async function save() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/roster', { method: 'PUT', headers: { ...activityHeaders(session, credential), 'Content-Type': 'application/json' }, body: JSON.stringify({ groups }) });
      if (!response.ok) { setError((await readError(response)).message); return; }
      onSave(await response.json() as RosterResponse);
    } catch { setError('連線中斷，名單尚未更新，請稍後重試。'); }
    finally { setBusy(false); }
  }
  return <section className="round-panel"><p className="eyebrow">名單設定</p><h2>組別名單</h2>
    {roster.locked ? <p className="success-box">首回合已開始，名單已鎖定。</p> : <>
      <p className="muted">使用環境設定中的組別代碼授權；此畫面不會顯示代碼。</p>
      <div className="form-stack">{groups.map((group, index) => <div className="roster-edit" key={group.id}><input aria-label="組名" value={group.name} onChange={event => setGroups(previous => previous.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /><button type="button" className="remove-button" onClick={() => setGroups(previous => previous.filter(item => item.id !== group.id))}>移除</button></div>)}
        {unused.length > 0 && <div className="add-group"><select aria-label="可用組別" value={newId} onChange={event => setNewId(event.target.value)}><option value="">選擇組別 ID</option>{unused.map(group => <option key={group.id} value={group.id}>{group.id}</option>)}</select><button type="button" className="secondary-button" disabled={!newId} onClick={() => { setGroups(previous => [...previous, { id: newId, name: '' }]); setNewId(''); }}>新增組別</button></div>}
        {error && <p role="alert" className="error">{error}</p>}<button className="primary" disabled={busy} onClick={() => void save()}>{busy ? '儲存中…' : '儲存名單'}</button>
      </div>
    </>}
  </section>;
}
