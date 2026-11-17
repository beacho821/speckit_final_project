# 課堂線上搶答

目前提供單一 Node.js 專案的前後端骨架：React/Vite/Tailwind 前端、Express API、環境變數驗證，以及記憶體中的課堂活動和組別名單。活動在伺服器重新啟動後會重設。

## 本機開發

需要 Node.js 22.12 或更新版本與 npm。先複製 `.env.example` 為 `.env`，再填入教師密碼和各組學生代碼：

```powershell
Copy-Item .env.example .env
# 編輯 .env，換成自己的憑證
npm install
npm run build
npm start
```

正式入口會在 `http://127.0.0.1:3000` 同時供應前端與 API。伺服器啟動時會讀取專案根目錄的 `.env`；已在作業系統設定的環境變數會優先使用。若要使用 Vite 熱更新，先在一個終端執行 `npm run start`（需先建置一次），再於另一個終端執行 `npm run dev`。`.env` 已列入 Git 忽略清單，請勿提交真實憑證。

目前登入與教師名單管理已接上；學習單匯入、回合與即時同步、結果匯出和原稿回填仍待實作。
