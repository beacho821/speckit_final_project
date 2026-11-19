import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

export default function QuestionQueue({ items, sortable, disabled, catalogRevision, onReorder, renderItem }: {
  items: string[];
  sortable: string[];
  disabled: boolean;
  catalogRevision?: number;
  onReorder: (order: string[]) => Promise<boolean>;
  renderItem: (id: string, index: number) => ReactNode;
}) {
  const list = useRef<HTMLOListElement>(null);
  const drag = useRef<{ id: string; pointer: number; revision: number | undefined; handle: HTMLElement } | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const focusAfterMove = useRef<{ id: string; to: number; preferred: 'up' | 'down' } | null>(null);

  useEffect(() => {
    const pending = focusAfterMove.current;
    if (!pending || disabled || sortable.indexOf(pending.id) !== pending.to) return;
    focusAfterMove.current = null;
    const row = Array.from(list.current?.children ?? []).find(el => (el as HTMLElement).dataset.queueId === pending.id);
    const button = row?.querySelector<HTMLButtonElement>(`[data-move="${pending.preferred}"]:not(:disabled)`)
      ?? row?.querySelector<HTMLButtonElement>('[data-move]:not(:disabled)');
    button?.focus();
  }, [sortable, disabled]);

  useEffect(() => {
    const active = drag.current;
    if (!active || active.revision === catalogRevision) return;
    drag.current = null;
    if (active.handle.hasPointerCapture(active.pointer)) active.handle.releasePointerCapture(active.pointer);
    setTarget(null);
    setAnnouncement('題目清單已更新，請核對最新順序後重新拖曳。');
  }, [catalogRevision]);

  function landing(event: PointerEvent) {
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-queue-id]');
    return row && list.current?.contains(row) && sortable.includes(row.dataset.queueId ?? '') ? row.dataset.queueId! : null;
  }

  async function move(id: string, to: number, focus?: 'up' | 'down') {
    const from = sortable.indexOf(id);
    if (disabled || from < 0 || to < 0 || to >= sortable.length || from === to) return;
    const order = [...sortable];
    order.splice(from, 1);
    order.splice(to, 0, id);
    if (focus) focusAfterMove.current = { id, to, preferred: focus };
    if (await onReorder(order)) setAnnouncement(`題目已移至學習單待開放清單的第 ${to + 1} 個位置。`);
    else focusAfterMove.current = null;
  }

  return <>
    {items.length === 0 ? <p className="muted">清單還沒有題目。請加入學習單題目，或新增一題。</p> :
      <ol className="question-queue" ref={list}>{items.map((id, index) => {
        const position = sortable.indexOf(id);
        return <li key={id} data-queue-id={id} className={target === id ? 'queue-target' : undefined}>
          {renderItem(id, index)}
          {position >= 0 && sortable.length > 1 && <div className="row-actions queue-controls">
            <span className="drag-handle" aria-hidden="true"
              onPointerDown={event => {
                if (disabled || !event.isPrimary || event.button !== 0) return;
                drag.current = { id, pointer: event.pointerId, revision: catalogRevision, handle: event.currentTarget };
                setAnnouncement('');
                event.currentTarget.setPointerCapture(event.pointerId);
                setTarget(id);
              }}
              onPointerMove={event => { if (drag.current?.pointer === event.pointerId) setTarget(landing(event)); }}
              onPointerUp={event => {
                if (drag.current?.pointer !== event.pointerId || drag.current.revision !== catalogRevision) return;
                const destination = landing(event);
                drag.current = null; setTarget(null);
                if (destination) void move(id, sortable.indexOf(destination));
              }}
              onLostPointerCapture={() => { drag.current = null; setTarget(null); }}
              onPointerCancel={() => { drag.current = null; setTarget(null); }}>拖曳</span>
            <button type="button" className="quiet" data-move="up" disabled={disabled || position === 0}
              onClick={() => void move(id, position - 1, 'up')}>上移</button>
            <button type="button" className="quiet" data-move="down" disabled={disabled || position === sortable.length - 1}
              onClick={() => void move(id, position + 1, 'down')}>下移</button>
          </div>}
        </li>;
      })}</ol>}
    <p className="sr-only" role="status">{announcement}</p>
  </>;
}
