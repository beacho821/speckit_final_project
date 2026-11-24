# 驗收指南：教師定案與學生倒數提示

## 啟動

需要 Node.js 22.12 以上、npm、桌面瀏覽器及可用 localhost。從專案根目錄執行：

```powershell
npm ci
if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env' }
npm run dev
```

首次啟動前在本機 `.env` 設定 `TEACHER_PASSWORD`，開啟終端顯示的網址（預設 `http://127.0.0.1:5173`）。使用獨立測試教室及虛構資料。可匯入[混合題學習單](../002-classroom-workflow-fixes/references/mixed-questions.xlsx)，確認題幹與標準答案已設定，將至少一個雙子題題組放入清單。為長頁面案例增加送答組別或使用含多個子題的測試學習單，先確認審核內容高度超過瀏覽器畫面。教師用兩個分頁進入同一教室的控制台，學生另開分頁以加入碼進入。各案例使用未開放過的題目，必要時另開測試活動。

## 手動驗收

| 案例 | 操作與預期結果 |
| --- | --- |
| SC-001 無人送答 | 開放雙子題後直接結束。定案附近列出兩個完整題號。各用滑鼠、Tab 加 Enter 啟動前往補答，核對第一個欄位有焦點。輸入空格與換行，仍須補答且無法定案。填入有效答案並儲存後定案，顯示「無勝組」。 |
| SC-001 部分答對與全部題目都有正確答案 | 第一組只答對第一子題時，只列第二子題待補答。另一回合由兩個組別各答對一題時可直接定案，沒有全對的組別則顯示「無勝組」。再用一組全對的回合核對勝組名稱。 |
| SC-002 儲存及定案進度 | 在長題組捲動到操作區。成功案例使用瀏覽器開發者工具限制網路速度，觀察尚未儲存、儲存中、儲存結果與定案中。成功定案後，同一區可讀到結果，按鈕移除時焦點在結果區。 |
| SC-002 明確拒絕及結果待確認 | 使用下一節的契約或元件案例控制拒絕與失去回應。驗收操作處顯示正體中文原因及下一步，保留草稿，拒絕後沒有寫入。結果不明時先核對最新回合，分別覆蓋已封存及仍在審核。 |
| SC-003 兩筆分頁衝突 | 兩個教師分頁同時編輯兩筆補答，兩頁輸入不同值。A 頁先儲存。B 頁核對兩組值，第一筆選已存值，核對儲存與定案仍停用，再對第二筆選草稿。儲存後用另一頁看到兩筆結果符合選擇。另核對相同值免選，以及最新已存值再次變更時須重新核對。 |
| SC-004 公平等待 | 用甲、乙兩組，讓甲先答對並取得一次勝組。下一題開放時，甲看到其他組優先與秒數，能先填答且無法提前送出。歸零後手動送出並核對收件與原文。下一回合以兩個分頁或可控時鐘在倒數歸零前結束收件，核對倒數到零也無法送出。 |

## 實作後可重跑的驗證

```powershell
npm run typecheck
npm exec -- vitest run tests/components/RoundReview.test.tsx tests/components/TeacherRound.test.tsx tests/components/StudentRound.test.tsx
npm exec -- vitest run tests/contract/classroom-review-history.test.ts tests/contract/fair-submissions.test.ts tests/unit/rounds.test.ts tests/unit/fairness.test.ts
npm test
npm run build
```

後續任務須將上述案例加入對應的元件和契約測試。元件測試以可控回應與假時鐘重現儲存遭拒、定案遭拒、提交前失去連線和提交後遺失回應。契約測試核對版本錯誤、缺答、階段邊界、角色隔離，以及拒絕後資料維持原值。實際桌面瀏覽器驗收須確認焦點、捲動位置與回饋。狀態與請求的判定方式見[介面契約](contracts/review-and-countdown.md)。
