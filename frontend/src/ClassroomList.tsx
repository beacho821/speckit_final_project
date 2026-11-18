import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ClassroomSummary } from '../../shared/api';
import { basicHeader, readList, requestMessage, requireOk } from './api';

export const phaseLabels = { idle: '尚未開題', preparing: '準備中', active: '搶答中', reviewing: '待審核', ended: '已定案' };
const timeFormat = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' });

export default function ClassroomList({ credential, onOpen, onExpired }: {
  credential: string; onOpen: (id: string) => void; onExpired: () => void;
}) {
  const [rooms, setRooms] = useState<ClassroomSummary[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [removing, setRemoving] = useState<ClassroomSummary>();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/classrooms', {
      headers: { Authorization: basicHeader('teacher', credential) }, signal: controller.signal,
    }).then(async response => {
      if (controller.signal.aborted) return;
      if (response.status === 401) return onExpired();
      await requireOk(response);
      const list = await readList<ClassroomSummary>(response);
      if (!controller.signal.aborted) setRooms(list);
    }).catch(error => { if (!controller.signal.aborted) setError(requestMessage(error, '教室清單載入失敗，請確認連線後重新載入。')); });
    return () => controller.abort();
  }, [credential, onExpired, retry]);

  useEffect(() => {
    if (removing && !dialog.current?.open) dialog.current?.showModal?.();
  }, [removing]);

  async function change(event?: FormEvent) {
    event?.preventDefault();
    const room = removing;
    if (busy || (!room && !name.trim())) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(room ? '/api/classrooms/' + encodeURIComponent(room.id) : '/api/classrooms', {
        method: room ? 'DELETE' : 'POST',
        headers: { Authorization: basicHeader('teacher', credential), 'Content-Type': 'application/json' },
        ...(room ? {} : { body: JSON.stringify({ name }) }),
      });
      if (response.status === 401) return onExpired();
      await requireOk(response);
      if (room) {
        setRooms(previous => previous?.filter(entry => entry.id !== room.id) ?? []);
        close(true);
      } else onOpen((await response.json()).id);
    } catch (cause) {
      setError(requestMessage(cause, '操作未完成，請稍後再試。'));
      if (room) close();
    } finally { setBusy(false); }
  }

  function close(deleted = false) {
    dialog.current?.close?.();
    setRemoving(undefined);
    (deleted ? heading.current : trigger.current)?.focus();
  }

  return <section className="classroom-list" aria-labelledby="classrooms-title">
    <header className="classroom-page-title"><h1 id="classrooms-title" ref={heading} tabIndex={-1}>我的教室</h1></header>
    <div className="classroom-list-grid">
      <section className="work-panel">
        <h2>建立教室</h2>
        <form className="form-stack" onSubmit={change}>
          <label htmlFor="classroom-name">教室名稱</label>
          <input id="classroom-name" value={name} onChange={event => setName(event.target.value)} required />
          <button className="primary" disabled={busy || !name.trim()}>建立教室</button>
        </form>
      </section>
      <section className="work-panel">
        <h2>歷史教室</h2>
        {rooms === null && !error && <p role="status">正在載入教室…</p>}
        {rooms === null && error && <button className="secondary-button" onClick={() => { setError(''); setRetry(value => value + 1); }}>重新載入</button>}
        {rooms?.length === 0 && <p className="muted">尚無教室。建立教室後即可開始備課。</p>}
        <ul className="classroom-rows">{rooms?.map(room => <li key={room.id}>
          <div><h3>{room.name}</h3><p className="muted">{room.unavailable ? '暫時無法恢復。請檢查存檔，重啟後再試。' : phaseLabels[room.phase]}
            {room.updatedAt > 0 && <><span aria-hidden="true"> · </span><time dateTime={new Date(room.updatedAt).toISOString()}>{timeFormat.format(room.updatedAt)}</time></>}</p></div>
          {!room.unavailable && <div className="row-actions">
            <button className="secondary-button" disabled={busy} onClick={() => onOpen(room.id)}>恢復主持</button>
            <button className="remove-button" disabled={busy || room.writebackInProgress} onClick={event => { trigger.current = event.currentTarget; setRemoving(room); }}>刪除教室</button>
          </div>}
        </li>)}</ul>
      </section>
    </div>
    {error && <p className="error work-message" role="alert">{error}</p>}
    {removing && <dialog ref={dialog} className="work-dialog" aria-labelledby="delete-classroom-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
      <h2 id="delete-classroom-title">刪除「{removing.name}」</h2>
      <p>教室的分組、題目、活動紀錄及加入授權皆會移除。</p>
      <div className="row-actions"><button autoFocus className="secondary-button" disabled={busy} onClick={() => close()}>取消</button>
        <button className="danger-button" disabled={busy} onClick={() => void change()}>確認刪除</button></div>
    </dialog>}
  </section>;
}
