import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ClassroomIcon } from './ClassroomIcon';
import type { ClassroomSummary } from '../../shared/api';
import { basicHeader, readList, requestMessage, requireOk } from './api';

export const phaseLabels = { idle: '尚未開題', preparing: '準備中', active: '搶答中', reviewing: '待審核', ended: '已定案' };
const timeFormat = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' });
const filters = { all: '全部', live: '進行中', ended: '已定案' } as const;
type RoomFilter = keyof typeof filters;
function matchesFilter(room: ClassroomSummary, filter: RoomFilter) {
  if (filter === 'all') return true;
  if (room.unavailable) return false;
  return filter === 'ended' ? room.phase === 'ended' : ['preparing', 'active', 'reviewing'].includes(room.phase);
}

export default function ClassroomList({ credential, onOpen, onExpired }: {
  credential: string; onOpen: (id: string) => void; onExpired: () => void;
}) {
  const [rooms, setRooms] = useState<ClassroomSummary[] | null>(null);
  const [filter, setFilter] = useState<RoomFilter>('all');
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

  const visibleRooms = rooms?.filter(room => matchesFilter(room, filter));
  return <section className="classroom-list" aria-labelledby="classrooms-title">
    <header className="classroom-page-title list-banner"><span className="banner-art" aria-hidden="true" /><h1 id="classrooms-title" ref={heading} tabIndex={-1}>我的教室</h1></header>
    <div className="classroom-list-grid">
      <section className="work-panel create-room-panel">
        <h2 className="panel-title"><ClassroomIcon name="create" />建立教室</h2>
        <form className="form-stack" onSubmit={change}>
          <label htmlFor="classroom-name">教室名稱</label>
          <input id="classroom-name" placeholder="輸入新教室名稱" value={name} onChange={event => setName(event.target.value)} required />
          <button className="primary icon-label" disabled={busy || !name.trim()}><ClassroomIcon name="create" />建立教室</button>
        </form>
      </section>
      <section className="work-panel room-history-panel">
        <header className="room-history-header">
          <h2 className="panel-title"><ClassroomIcon name="clock" />歷史教室</h2>
          {rooms && rooms.length > 0 && <div className="room-filters" role="group" aria-label="依回合狀態篩選教室">
            {(Object.keys(filters) as RoomFilter[]).map(key => <button type="button" key={key} aria-pressed={filter === key}
              onClick={() => setFilter(key)}>{filters[key]} <span>{rooms.filter(room => matchesFilter(room, key)).length}</span></button>)}
          </div>}
        </header>
        {rooms === null && !error && <p role="status">正在載入教室…</p>}
        {rooms === null && error && <button className="secondary-button" onClick={() => { setError(''); setRetry(value => value + 1); }}>重新載入</button>}
        {rooms && visibleRooms?.length === 0 && <p className="room-empty muted" role="status">
          <ClassroomIcon name="book" />{rooms.length ? '目前沒有符合此狀態的教室。' : '尚無教室。建立教室後即可開始備課。'}
        </p>}
        <ul className="room-list">{visibleRooms?.map(room => <li className="room-card" data-phase={room.unavailable ? 'unavailable' : room.phase} key={room.id}>
          <div className="room-details">
            <span className="room-emblem"><ClassroomIcon name={room.phase === 'active' ? 'bell' : room.phase === 'reviewing' ? 'pencil' : 'book'} /></span>
            <div><h3 id={'room-title-' + room.id}>{room.name}</h3>
              {room.updatedAt > 0 && <p className="room-meta"><ClassroomIcon name="clock" />最近更新 <time dateTime={new Date(room.updatedAt).toISOString()}>{timeFormat.format(room.updatedAt)}</time></p>}
              {room.unavailable && <p className="room-meta">暫時無法恢復。請檢查存檔，重啟後再試。</p>}
            </div>
          </div>
          <div className="room-actions">
            <span className="room-phase">{room.unavailable ? '暫停使用' : phaseLabels[room.phase]}</span>
            {!room.unavailable && <><button className="room-open icon-label" aria-describedby={'room-title-' + room.id} disabled={busy} onClick={() => onOpen(room.id)}><ClassroomIcon name="play" />恢復主持</button>
            <button className="room-delete" aria-label="刪除教室" aria-describedby={'room-title-' + room.id} title={'刪除「' + room.name + '」'} disabled={busy || room.writebackInProgress} onClick={event => { trigger.current = event.currentTarget; setRemoving(room); }}><ClassroomIcon name="trash" /></button></>}
          </div>
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
