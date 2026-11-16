# 研究決策：課堂線上搶答系統

## 1. 本機執行與工具相容性

**決策**　採用當期正式版 Node.js、最新穩定版 npm 與各直接依賴。初次安裝及交付前查核最新穩定版，跨主版本也須驗證。鎖定檔記錄已通過測試的實際版本。已採用的執行與開發依賴列於[實作計畫](plan.md)。  
**理由**　Vite 建置 React 與 TypeScript 前端，套用 Tailwind 樣式；TypeScript 另行型別檢查。Express 在同一個本機來源供應 API 與編譯後的網頁。Vitest 可共用 TypeScript 測試，並控制計時邊界。  
**考量過的方案**　分開部署與多個套件工作區會增加同機演練的啟動步驟。[Node.js 發行週期](https://nodejs.org/en/about/previous-releases) · [Vite](https://vite.dev/guide/) · [Tailwind CSS](https://tailwindcss.com/docs/installation/using-vite) · [Express](https://expressjs.com/) · [Vitest](https://vitest.dev/guide/)

## 2. XLSX 與 Google 原稿

**決策**　老師輸入 Google 工作表連結；後端擷取文件識別碼及分頁 gid。以有該檔案權限的服務帳戶讀取分頁中繼資料，依 gid 取得標題，用 Drive 匯出整本 XLSX，再以 ExcelJS 載入記憶體並選取對應名稱的工作表。同時讀該分頁的原始格值、備註與合併範圍，交叉核對題目身分與位置後才接受匯入。實作測試可直接把本機 XLSX 樣本交給同一解析器。  
**理由**　Google 分頁 ID 與 ExcelJS 的分頁序號分屬不同系統。XLSX 提供活頁簿結構，原稿提供可再次尋址的身分與具型別的比對基準。匯出超過 Drive 的 10 MB 限制時提示老師縮小活頁簿或製作課堂副本。  
**考量過的方案**　只接收已下載的檔案無法確定寫回哪份 Google 原稿；CSV 會丟失合併關係與工作表身分。[Drive 匯出](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export) · [ExcelJS 文件](https://github.com/exceljs/exceljs#reading-xlsx) · [Sheets 分頁](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/sheets)

## 3. 填空身分與安全回填

**決策**　以完整題號重辨填空，合併格以主格去重。若子題或自訂標記會被答案取代，首次回填時一併在該格備註附加題號及所屬單位，保留原有備註。重新匯入或回填時讀取識別備註。單次 Google 批次只改指定目標的輸入值及必要的識別備註。  
**理由**　先重讀原稿、比對匯入快照與勝組原文，可在送出前找出所有衝突。Google 對同一批請求保證全數套用或全數失敗。API 未提供涵蓋「讀取、比較、寫入」的條件式交易。若其他編輯者恰在最後讀取與提交之間改格，外部變更仍可能交錯。應在介面提示寫回期間暫停共編；以單一回填作業、提交後讀回驗證及不盲目重送來處理可偵測的情況。  
**考量過的方案**　記住初始座標會寫錯移位後的原稿；逐格發送請求會留下部分回填；整本 XLSX 覆寫可能改動其他工作表。[批次保證與共編限制](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate) · [儲存格欄位](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/cells)

## 4. 同機身分與即時性

**決策**　每個分頁用老師或學生輸入的憑證透過 Basic 標頭逐次驗證，不另發課堂存取權杖。分頁記憶體在關閉或重整時清空。登入時取得的公開活動 ID 隨程序重啟更換，可拒絕舊頁操作；它不授予權限。重新驗證可接回仍在執行的活動。後端以角色產生可見資料，前端發出附驗證標頭的長輪詢，當該角色可見狀態改變便立即回應。  
**理由**　老師與多組學生能在同一瀏覽器並存。未公布的他組送出不觸發學生更新，也不改變學生可見的版本。長輪詢可走既有 Express HTTP 服務，免去連線升級。  
**考量過的方案**　共用登入 Cookie 會混用分頁身分；固定計時輪詢會受背景分頁節流影響。後端配置的憑證真值只從環境變數讀取，Vite 公開環境變數只可放公開資訊。[HTTP 長輪詢](https://datatracker.ietf.org/doc/html/rfc6202#section-2) · [Vite 環境變數](https://vite.dev/guide/env-and-mode)

## 5. 公平順位與測試

**決策**　單一 Express 程序在記憶體中依收件次序執行狀態操作。計時採可替換的單調時鐘；在不含非同步等待的同一步驟內完成回合驗證、整組驗證、順位編號及登記。以實際 HTTP 請求測序列與權限，以可控時鐘測 2,999 與 3,000 毫秒。  
**理由**　同時送出的兩組可得確定且不同的順位；頁面時間僅供提示。程序結束即開新活動符合已確認的恢復範圍。  
**考量過的方案**　客戶端時間會受各分頁排程影響；資料庫或跨程序鎖超出單機單活動需求。[Vitest 計時測試](https://vitest.dev/guide/mocking/timers)
