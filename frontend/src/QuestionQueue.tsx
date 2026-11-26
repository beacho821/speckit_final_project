import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

export default function QuestionQueue({ items, sortable, disabled, catalogRevision, onReorder, renderItem, previewLabel }: {
  items: string[];
  sortable: string[];
  disabled: boolean;
  catalogRevision?: number;
  onReorder: (order: string[]) => Promise<boolean>;
  renderItem: (id: string, index: number) => ReactNode;
  previewLabel: (id: string) => string;
}) {
  const list = useRef<HTMLOListElement>(null);
  const drag = useRef<{ id: string; pointer: number; revision: number | undefined; handle: HTMLElement } | null>(null);
  const [preview, setPreview] = useState<{ id: string; x: number; y: number;
    target: { id: string; after: boolean; to: number } | null } | null>(null);
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

  function cancelDrag() {
    const active = drag.current;
    drag.current = null;
    setPreview(null);
    if (active?.handle.hasPointerCapture?.(active.pointer)) active.handle.releasePointerCapture(active.pointer);
  }

  useEffect(() => {
    const active = drag.current;
    if (!active || (!disabled && active.revision === catalogRevision)) return;
    cancelDrag();
    if (active.revision !== catalogRevision) setAnnouncement('題目清單已更新，請核對最新順序後重新拖曳。');
  }, [catalogRevision, disabled]);

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) cancelDrag(); };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);

  function landing(event: PointerEvent, sourceId: string) {
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-queue-id]');
    const id = row?.dataset.queueId;
    if (!row || !id || !list.current?.contains(row)) return null;
    const index = sortable.indexOf(id);
    if (index < 0) return null;
    const rect = row.getBoundingClientRect();
    const after = event.clientY >= rect.top + rect.height / 2;
    const boundary = index + Number(after);
    const from = sortable.indexOf(sourceId);
    const to = boundary - Number(boundary > from);
    return to === from ? null : { id, after, to };
  }

  async function move(id: string, to: number, focus?: 'up' | 'down') {
    const from = sortable.indexOf(id);
    if (disabled || from < 0 || to < 0 || to >= sortable.length || from === to) return;
    const order = [...sortable];
    order.splice(from, 1);
    order.splice(to, 0, id);
    if (focus) focusAfterMove.current = { id, to, preferred: focus };
    if (await onReorder(order)) setAnnouncement(`題目已移至待開放清單的第 ${to + 1} 個位置。`);
    else focusAfterMove.current = null;
  }

  return <>
    {items.length === 0 ? <p className="muted">清單還沒有題目。請加入學習單題目，或新增一題。</p> :
      <ol className="question-queue" ref={list}>{items.map((id, index) => {
        const position = sortable.indexOf(id);
        const target = preview?.target;
        const movable = position >= 0 && sortable.length > 1;
        return <li key={id} data-queue-id={id}
          className={target?.id === id ? (target.after ? 'queue-insert-after' : 'queue-insert-before') : undefined}>
          {movable && <span className="drag-handle" aria-hidden="true"
            onPointerDown={event => {
              if (disabled || !event.isPrimary || event.button !== 0) return;
              drag.current = { id, pointer: event.pointerId, revision: catalogRevision, handle: event.currentTarget };
              setAnnouncement('');
              event.currentTarget.setPointerCapture(event.pointerId);
              setPreview({ id, x: event.clientX, y: event.clientY, target: null });
            }}
            onPointerMove={event => {
              if (drag.current?.pointer !== event.pointerId) return;
              setPreview({ id, x: event.clientX, y: event.clientY, target: landing(event, id) });
            }}
            onPointerUp={event => {
              if (drag.current?.pointer !== event.pointerId) return;
              const destination = drag.current.revision === catalogRevision ? landing(event, id) : null;
              cancelDrag();
              if (destination) void move(id, destination.to);
            }}
            onLostPointerCapture={event => { if (drag.current?.pointer === event.pointerId) cancelDrag(); }}
            onPointerCancel={event => { if (drag.current?.pointer === event.pointerId) cancelDrag(); }} />}
          {renderItem(id, index)}
          {movable && <div className="row-actions queue-controls">
            <button type="button" className="quiet question-icon" aria-label="上移" title="上移" data-move="up"
              disabled={disabled || position === 0} onClick={() => void move(id, position - 1, 'up')}>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
            </button>
            <button type="button" className="quiet question-icon" aria-label="下移" title="下移" data-move="down"
              disabled={disabled || position === sortable.length - 1} onClick={() => void move(id, position + 1, 'down')}>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14m-6-6 6 6 6-6" /></svg>
            </button>
          </div>}
        </li>;
      })}</ol>}
    {preview && <div className="queue-preview" aria-hidden="true"
      style={{ left: Math.min(preview.x + 12, Math.max(8, window.innerWidth - 164)), top: Math.max(8, preview.y - 38) }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v18M3 12h18M8 7l4-4 4 4m-8 10 4 4 4-4M7 8l-4 4 4 4m10-8 4 4-4 4" /></svg>
      <span>{previewLabel(preview.id)}</span>
    </div>}
    <p className="sr-only" role="status">{announcement}</p>
  </>;
}
