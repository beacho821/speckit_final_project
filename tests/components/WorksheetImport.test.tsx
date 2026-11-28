// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';import WorksheetImport from '../../frontend/src/WorksheetImport';import {render,host,input,click} from '../helpers/ui';
const session={role:'teacher' as const,activityId:'a'};const preview={source:{kind:'xlsx' as const,fileName:'舊.xlsx',sheetId:1,sheetTitle:'舊題',importedAt:1},mainQuestionCount:1,unitCount:1,fillCount:1,units:[{id:'old',name:'舊題',questionIds:['1']}]};
it('兩個來源各自顯示輸入欄位，匯入失敗保留已發布來源', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json({ code: 'BAD', message: '無效來源' }, { status: 422 }));
  await render(<WorksheetImport session={session} credential="test" preview={preview} catalogRevision={2} />);
  expect(host.querySelector('#sheet-url')).not.toBeNull();
  expect(host.querySelector('#xlsx-file')).toBeNull();
  expect(host.textContent).not.toContain('XLSX 學習單（上限 10 MB）');

  await click('本機 XLSX');
  expect(host.querySelector('#sheet-url')).toBeNull();
  expect(host.querySelector('#xlsx-file')).not.toBeNull();
  expect(host.textContent).toContain('XLSX 學習單（上限 10 MB）');
  await click('Google 試算表');
  expect(host.querySelector('#sheet-url')).not.toBeNull();
  expect(host.querySelector('#xlsx-file')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();

  await input('Google 試算表網址', 'https://docs.google.com/test');
  await click('匯入並預覽');
  await click('確認重新匯入');
  expect(fetch.mock.calls[0][0]).toBe('/api/worksheet/import');
  expect(host.textContent).toContain('無效來源');
  expect(host.textContent).toContain('舊.xlsx');
});
it('回應遺失只標待確認、觸發完整快照，不自動重送',async()=>{const uncertain=vi.fn(),fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new TypeError('offline'));await render(<WorksheetImport session={session} credential="test" preview={preview} catalogRevision={2} onUnconfirmed={uncertain}/>);await input('Google 試算表網址','https://docs.google.com/test');await click('匯入並預覽');await click('確認重新匯入');expect(host.textContent).toContain('匯入結果待確認');expect(uncertain).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledOnce();expect(host.querySelector('dialog')?.open).toBe(false);});

it('二進位同檔多頁確認、忙碌禁切換；候選不取代已發布預覽',async()=>{const {act}=await import('react');let resolve:(r:Response)=>void=()=>{};const published=vi.fn();const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(r=>{resolve=r;}));await render(<WorksheetImport session={session} credential="test" preview={preview} catalogRevision={2} onPublished={published}/>);await click('本機 XLSX');const file=new File(['zip'],'中文.xlsx',{type:'application/octet-stream'}),picker=host.querySelector<HTMLInputElement>('input[type=file]')!;await act(async()=>{Object.defineProperty(picker,'files',{value:[file],configurable:true});picker.dispatchEvent(new Event('change',{bubbles:true}));});await click('匯入並預覽');await click('確認重新匯入');expect([...host.querySelectorAll('button')].find(b=>b.textContent==='Google 試算表')?.disabled).toBe(true);expect(fetch.mock.calls[0][1]?.body).toBe(file);expect(new Headers(fetch.mock.calls[0][1]?.headers).get('X-File-Name')).toBe(encodeURIComponent(file.name));await act(async()=>resolve(Response.json({candidates:[{sheetId:9,title:'第二頁'}]})));expect(host.textContent).toContain('尚未發布');expect(host.textContent).toContain('舊.xlsx');const select=host.querySelector('select')!;await act(async()=>{select.value='9';select.dispatchEvent(new Event('change',{bubbles:true}));});expect(fetch.mock.calls[1][0]).toBe('/api/worksheet/import/xlsx?sheetId=9');expect(fetch.mock.calls[1][1]?.body).toBe(file);await act(async()=>resolve(Response.json({source:{kind:'xlsx'}})));expect(published).toHaveBeenCalledOnce();expect(host.querySelector('select')).toBeNull();});
it('卸載後的舊匯入回應不發布；選檔取消不發請求',async()=>{const {act}=await import('react');let resolve:(r:Response)=>void=()=>{};const published=vi.fn(),fetch=vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(r=>{resolve=r;}));await render(<WorksheetImport key="old" session={session} credential="test" onPublished={published}/>);await click('本機 XLSX');const picker=host.querySelector('input[type=file]')!;await act(async()=>picker.dispatchEvent(new Event('change',{bubbles:true})));expect(fetch).not.toHaveBeenCalled();await click('Google 試算表');await input('Google 試算表網址','https://docs.google.com/test');await click('匯入並預覽');await render(<WorksheetImport key="new" session={session} credential="test" onPublished={published}/>);await act(async()=>resolve(Response.json({source:{kind:'google'}})));expect(published).not.toHaveBeenCalled();});

it('重新匯入先說明會移除手動題，取消時保留原來源', async () => {
  const request = vi.spyOn(globalThis, 'fetch');
  await render(<WorksheetImport session={session} credential="test" catalogRevision={2} preview={preview} />);
  await input('Google 試算表網址', 'https://docs.google.com/test');
  await click('匯入並預覽');
  expect(host.querySelector('dialog')?.open).toBe(true);
  expect(host.querySelector('dialog')?.textContent).toContain('包含手動新增的題目');
  await click('取消');
  expect(request).not.toHaveBeenCalled();
  expect(host.textContent).toContain('舊.xlsx');
});

it('重匯確認期間收到新版來源時取消，重新確認才可用新版本送出', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(preview));
  const show = (revision: number) => render(<WorksheetImport session={session} credential="test" catalogRevision={revision}
    preview={{ ...preview, source: { ...preview.source, importedAt: revision } }} />);
  await show(2);
  await input('Google 試算表網址', 'https://docs.google.com/test');
  await click('匯入並預覽');
  await show(3);
  expect(host.querySelector('dialog')?.open).toBe(false);
  expect(host.textContent).toContain('題目清單已更新');
  expect(fetch).not.toHaveBeenCalled();
  await click('匯入並預覽');
  await click('確認重新匯入');
  expect(new Headers(fetch.mock.calls[0][1]?.headers).get('X-Catalog-Revision')).toBe('3');
});

it('重新同步完成時會清除匯入待確認，即使畫面未先呈現父層的等待狀態', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
  const show = (completedRefresh: number) => render(<WorksheetImport session={session} credential="test"
    catalogRevision={2} completedRefresh={completedRefresh} />);
  await show(0);
  await input('Google 試算表網址', 'https://docs.google.com/test');
  await click('匯入並預覽');
  expect(host.textContent).toContain('匯入結果待確認');
  await show(1);
  expect(host.textContent).not.toContain('匯入結果待確認');
});
