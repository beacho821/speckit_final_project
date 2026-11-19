import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, vi } from 'vitest';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  const prototype = HTMLDialogElement.prototype;
  if (typeof prototype.showModal === 'function') return;
  // jsdom 未實作原生對話框，瀏覽器驗收另檢查焦點與模態行為。
  Object.defineProperties(prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value(this: HTMLDialogElement) {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event('close', { bubbles: true }));
    } },
  });
});

let root: Root | undefined;
export let host: HTMLDivElement;
export async function render(node: ReactNode) { if (!root) { host=document.createElement('div'); document.body.append(host); root=createRoot(host); } await act(async()=>root!.render(node)); }
export async function click(text:string) { const button=[...host.querySelectorAll('button')].find(b=>b.textContent===text); if (!button) throw new Error(`找不到按鈕：${text}`); await act(async()=>button.click()); }
export async function input(label:string,value:string) { const element=host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`) ?? host.querySelector<HTMLInputElement>(`#${host.querySelector<HTMLLabelElement>(`label[for]`)?.htmlFor}`); if(!element) throw new Error('找不到欄位'); await act(async()=>{ Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,value); element.dispatchEvent(new Event('input',{bubbles:true})); }); }
export async function flush(ms=0) { await act(async()=>{await new Promise(resolve=>setTimeout(resolve,ms));}); }
afterEach(async()=>{if(root) await act(async()=>root?.unmount());root=undefined;host?.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
