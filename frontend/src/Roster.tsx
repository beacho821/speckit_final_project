import { useState } from 'react';
import type { RosterResponse, SessionResponse } from '../../shared/api';
import { activityHeaders, requestMessage, requireOk } from './api';

export default function Roster({ session, credential, roster, onSave }: {
  session: SessionResponse; credential: string; roster: RosterResponse; onSave: (next: RosterResponse) => void;
}) {
  const [editing, setEditing] = useState<{ id: string; name: string }>();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function change(method: string, id?: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch(id ? '/api/groups/' + encodeURIComponent(id) : '/api/groups', {
        method, headers: { ...activityHeaders(session, credential), 'Content-Type': 'application/json' },
        ...(method !== 'DELETE' ? { body: JSON.stringify({ name: id ? editing?.name : name }) } : {}),
      });
      await requireOk(response);
      onSave(await response.json());
      if (!id) setName('');
      else setEditing(undefined);
    } catch (cause) { setError(requestMessage(cause, '連線中斷，請確認目前名單後再操作。')); }
    finally { setBusy(false); }
  }

  return <section className="round-panel">
    <h2>組別名單</h2>
    <p className="muted">{roster.locked ? '本場活動已鎖定名單。開始新活動後可調整分組。' : '新增組別後，請將學生加入碼交給該組。'}</p>
    {!roster.locked && <form className="form-stack group-add" onSubmit={event => { event.preventDefault(); void change('POST'); }}>
      <label htmlFor="new-group">新組名</label>
      <input id="new-group" aria-label="新組名" required disabled={busy} value={name} onChange={event => setName(event.target.value)} />
      <button className="primary" disabled={busy || !name.trim()}>新增組別</button>
    </form>}
    {!roster.groups.length && <p className="muted">尚無組別，請先建立名單。</p>}
    <ul className="classroom-rows">{roster.groups.map(group => <li className="roster-entry" key={group.id}>
      <div>
        <h3>{group.name}</h3>
        <p>學生加入碼：{group.joinCode ? <strong className="join-code">{group.joinCode}</strong> : '目前停用，請管理者確認發碼存檔。'}</p>
        <p className="muted">曾加入名稱：{group.members.map(member => member.name).join('、') || '尚無學生加入'}</p>
      </div>
      <div className="row-actions">
        {!roster.locked && <><button className="secondary-button" disabled={busy} onClick={() => setEditing({ id: group.id, name: group.name })}>更名</button>
          <button className="remove-button" disabled={busy} onClick={() => void change('DELETE', group.id)}>刪除</button></>}
      </div>
      {!roster.locked && editing?.id === group.id && <form className="form-stack group-edit" onSubmit={event => { event.preventDefault(); void change('PATCH', group.id); }}>
        <label htmlFor={'group-' + group.id}>更改「{group.name}」組名</label>
        <input id={'group-' + group.id} required autoFocus disabled={busy} value={editing.name} onChange={event => setEditing({ id: group.id, name: event.target.value })} />
        <div className="row-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => setEditing(undefined)}>取消</button>
          <button className="primary" disabled={busy || !editing.name.trim()}>儲存組名</button></div>
      </form>}
    </li>)}</ul>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
