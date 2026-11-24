# 驗收指南：自動補答與逐筆改判

在專案根目錄使用 Node.js 22.12 以上及已鎖定依賴。首次設定時將 `.env.example` 複製成 `.env` 並填入測試教師密碼。準備獨立本機教室、兩組虛構學生，及可開放的雙子題題組。沒有現成題組時可用[混合學習單](../002-classroom-workflow-fixes/references/mixed-questions.xlsx)。確認每個子題都已存標準答案，至少一題有兩個依序設定的標準答案。

```powershell
npm ci
npm run dev
```

| 驗收 | 操作及預期結果 |
| --- | --- |
| SC-001 自動補答 | 依序測試無人送答、全部答錯、只答對第一子題。停止收件後只替無具資格組別答對的題目補答，每題一筆，採第一個非空白標準答案。直接定案，不操作任何補答欄位。 |
| SC-001 舊回合 | 用測試夾具載入一個待審核回合，兩題都需補答且一題已有不同於標準答案的人工補答。定案後以教師歷史、學生結果及 CSV 核對舊值原文和新自動補答。另核對無答案來源的舊題可定案。 |
| SC-002 逐筆按鈕 | 兩組各送兩個子題，停止收件後驗證四筆皆有按鈕。用滑鼠及 Tab、Enter 操作同一筆，驗證其他答案的內容、判定和順位。 |
| SC-003 自動重算 | 演練錯誤→正確→錯誤，確認預覽補答出現、移除、恢復。另演練已取消資格的組別，改成正確時仍需補答。 |
| SC-004 定案與拒絕 | 儲存改判後分別定案有勝組、無勝組的回合，核對勝組與封存補答。用兩個教師分頁驗證舊版本拒絕及草稿保留，並核對已定案及未授權的改判無法寫入。 |

```powershell
npm run typecheck
npm exec -- vitest run tests/unit/rounds.test.ts tests/unit/review-draft.test.ts tests/components/RoundReview.test.tsx tests/components/TeacherRound.test.tsx
npm exec -- vitest run tests/contract/classroom-review-history.test.ts tests/contract/questions.test.ts tests/contract/results-csv.test.ts tests/integration/results.test.ts
npm test
npm run build
```

以[介面契約](contracts/review-and-results.md)核對操作輸出。交付時記錄實際指令與結果、瀏覽器驗收、拒絕時未寫入的證據及未執行原因。
