import { useState } from 'react';
import type { GroupStanding, RosterResponse, SessionResponse } from '../../shared/api';
import { activityHeaders, requestMessage, requireOk } from './api';
import { ClassroomIcon } from './ClassroomIcon';

function JoinCode({ code }: { code: string }) {
  const [status, setStatus] = useState('');

  async function copy(button: HTMLButtonElement) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        // Clipboard API 在校內 HTTP 網址可能無法使用。
        const field = document.createElement('textarea');
        field.value = code;
        field.readOnly = true;
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.append(field);
        try {
          field.select();
          if (!document.execCommand('copy')) throw new Error();
        } finally {
          field.remove();
          button.focus();
        }
      }
      setStatus('已複製');
    } catch {
      setStatus('複製失敗，請手動選取加入碼。');
    }
  }

  return <div className="join-code-row">
    <span>學生加入碼</span>
    <button type="button" className="join-code" aria-label={`複製學生加入碼 ${code}`}
      title="點擊複製加入碼" onClick={event => void copy(event.currentTarget)}>{code}</button>
    <span className="muted" role="status">{status}</span>
  </div>;
}

export default function Roster({ session, credential, roster, standings, onSave }: {
  session: SessionResponse; credential: string; roster: RosterResponse; standings?: GroupStanding[]; onSave: (next: RosterResponse) => void;
}) {
  const [editing, setEditing] = useState<{ id: string; name: string }>();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File>();
  const [importMessage, setImportMessage] = useState('');
  const points = new Map(standings?.map(group => [group.id, group.points]));

  async function importRoster(form: HTMLFormElement) {
    if (!file || busy) return;
    setError(''); setImportMessage('');
    if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 10 * 1024 * 1024) {
      setError('請選擇 10 MB 以內的 .xlsx 名單。');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/roster/import/xlsx', {
        method: 'POST', headers: { ...activityHeaders(session, credential), 'Content-Type': 'application/octet-stream' }, body: file,
      });
      await requireOk(response);
      const result = await response.json();
      onSave(result.roster);
      setImportMessage(`已新增 ${result.added} 位學生，略過 ${result.skipped} 筆既有成員。`);
      form.reset(); setFile(undefined);
    } catch (cause) { setError(requestMessage(cause, '名單匯入失敗，請確認連線後重試。')); }
    finally { setBusy(false); }
  }

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

  async function changeMember(groupId: string, id: string, targetGroupId?: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/groups/' + encodeURIComponent(groupId) + '/members/' + encodeURIComponent(id), {
        method: targetGroupId ? 'PATCH' : 'DELETE', headers: { ...activityHeaders(session, credential), 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetGroupId }),
      });
      await requireOk(response); onSave(await response.json());
    } catch (cause) { setError(requestMessage(cause, '名單更新失敗，請確認連線。')); }
    finally { setBusy(false); }
  }

  return <section className="round-panel">
    <div className="roster-title"><h2>組別名單</h2>
      <span>{roster.groups.length} 組 · {roster.groups.reduce((total, group) => total + group.members.length, 0)} 位學生</span>
    </div>
    <p className="muted">{roster.locked ? '活動中可新增組別或匯入學生。更名、刪組與移除或移動既有成員，請於下次活動開題前操作。' : '新增組別後，請將學生加入碼交給該組。'}</p>
    <div className="roster-tools"><form className="form-stack group-add" onSubmit={event => { event.preventDefault(); void change('POST'); }}>
      <label htmlFor="new-group">新組名</label>
      <input id="new-group" aria-label="新組名" required disabled={busy} value={name} onChange={event => setName(event.target.value)} />
      <button className="primary icon-label" disabled={busy || !name.trim()}><ClassroomIcon name="create" />新增組別</button>
    </form>
    <form className="form-stack roster-import" onSubmit={event => { event.preventDefault(); void importRoster(event.currentTarget); }}>
      <label htmlFor="roster-file">匯入 Excel 組別名單</label>
      <p id="roster-format" className="muted">第一張工作表依序填「組別」與「名字」。同名可加座號，例如「01 王小明」、「12 王小明」。學生加入時請輸入含座號的完整名字。</p>
      <input id="roster-file" type="file" accept=".xlsx" aria-describedby="roster-format" disabled={busy} onChange={event => {
        setFile(event.target.files?.[0]); setImportMessage(''); setError('');
      }} />
      <div className="row-actions">
        <button className="secondary-button" disabled={busy || !file}>匯入名單</button>
        <a href="/組別名單範例.xlsx" download>下載 Excel 範例</a>
      </div>
      {importMessage && <p role="status">{importMessage}</p>}
    </form></div>
    {!roster.groups.length && <p className="muted">尚無組別，請先建立名單。</p>}
    <ul className="roster-cards">{roster.groups.map(group => <li key={group.id}>
      <article className="roster-entry" aria-labelledby={'roster-title-' + group.id}>
        <header className="roster-card-header">
          <span className="roster-emblem"><ClassroomIcon name="group" /></span>
          <h3 id={'roster-title-' + group.id}>{group.name}</h3>
          <div className="roster-points"><span><ClassroomIcon name="trophy" />積分</span>
            <strong>{points.get(group.id) ?? (standings ? 0 : '待同步')}</strong>
          </div>
        </header>
        <div className="roster-card-body">
          {group.joinCode ? <JoinCode key={group.joinCode} code={group.joinCode} />
            : <p>學生加入碼目前停用，請管理者確認發碼存檔。</p>}
          <h4 className="roster-members-title">小組成員 <span>{group.members.length} 人</span></h4>
          {group.members.length ? <ul className="roster-members">{group.members.map(member => <li key={member.id}>
            <span className="roster-member-name"><ClassroomIcon name="student" />{member.name}</span>
            {!roster.locked && <div className="roster-member-actions">
              {roster.groups.length > 1 && <select aria-label={'移動' + member.name + '至其他組'} disabled={busy} value="" onChange={event => void changeMember(group.id, member.id, event.target.value)}>
                <option value="" disabled>移至其他組</option>
                {roster.groups.filter(other => other.id !== group.id).map(other => <option key={other.id} value={other.id}>{other.name}</option>)}
              </select>}
              <button type="button" className="remove-button" disabled={busy} onClick={() => { if (window.confirm('移除學生「' + member.name + '」？')) void changeMember(group.id, member.id); }}>移除學生</button>
            </div>}
          </li>)}</ul> : <p className="roster-empty">尚無學生加入</p>}
        </div>
        {!roster.locked && editing?.id !== group.id && <footer className="roster-card-actions">
          <button className="secondary-button icon-label" disabled={busy} onClick={() => setEditing({ id: group.id, name: group.name })}><ClassroomIcon name="pencil" />更名</button>
          <button className="remove-button icon-label" disabled={busy} onClick={() => void change('DELETE', group.id)}><ClassroomIcon name="trash" />刪除</button>
        </footer>}
        {!roster.locked && editing?.id === group.id && <form className="form-stack group-edit" onSubmit={event => { event.preventDefault(); void change('PATCH', group.id); }}>
          <label htmlFor={'group-' + group.id}>更改「{group.name}」組名</label>
          <input id={'group-' + group.id} required autoFocus disabled={busy} value={editing.name} onChange={event => setEditing({ id: group.id, name: event.target.value })} />
          <div className="row-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => setEditing(undefined)}>取消</button>
            <button className="primary" disabled={busy || !editing.name.trim()}>儲存組名</button></div>
        </form>}
      </article>
    </li>)}</ul>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
