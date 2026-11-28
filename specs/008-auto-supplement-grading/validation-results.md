# 功能 008 驗收結果

2026-11-24 以 Node.js 26.13.1、專案已安裝的依賴及 Edge 執行。瀏覽器及 HTTP 測試使用隔離的本機教室、虛構組別和預置題組。試算表回填使用既有的測試替身。

| 驗收項目 | 實際結果 |
| --- | --- |
| SC-001 自動補答 | 在 Edge 定案無人送答、全部答錯、僅第一子題答對與舊題缺少補答來源的回合。補答欄位輸入與另外儲存皆為 0 次。僅替仍欠答且有來源的題目封存補答。 |
| SC-001 舊人工補答 | 舊待審核回合第一子題保留已存人工原文，第二子題使用首個非空白標準答案。教師結果、學生公布結果與 CSV 讀回相同文字。整合測試另驗證空格、逗號、引號及換行保留。 |
| SC-002 逐筆改判 | 兩組四筆答案各有一對按鈕且恰有一項選中。用滑鼠與 Shift+Tab、Enter 操作同一筆，確認焦點可見、其餘三筆判分與各組順位不變，原文與自動判分仍可查看。 |
| SC-003 補答預覽 | 對同一筆作答操作「錯誤 → 正確 → 錯誤」，預覽補答依序出現、移除、恢復。組別取消資格後即使改判正確，補答仍在，恢復資格後才移除。 |
| SC-004 定案與權限 | 驗證無勝組，以及改判後由最早符合資格的全對組獲勝。兩個教師分頁發出實際請求，先儲存的一頁成功，另一頁收到 `409` 且保留草稿，逐筆核對後可重新儲存。學生改判回 `403`，已定案改判回 `409`，兩者皆未寫入。 |

## 執行紀錄

| 指令或檢查 | 結果 |
| --- | --- |
| `npm run typecheck` | 通過。 |
| `npm exec -- vitest run tests/unit/rounds.test.ts tests/unit/review-draft.test.ts tests/components/RoundReview.test.tsx tests/components/TeacherRound.test.tsx --maxWorkers=2 --testTimeout=15000` | 4 檔、34 個測試通過。 |
| `npm exec -- vitest run tests/contract/questions.test.ts --maxWorkers=2 --testTimeout=15000` | 5 個 HTTP 契約測試通過。 |
| `npm test -- --maxWorkers=2 --testTimeout=15000` | 56 檔、214 個測試通過，含重啟恢復、收件與公平等待的回歸測試。 |
| `npm run build` | 前後端建置通過。 |
| `node scripts/verify-review-browser.mjs $reviewBrowserTools` | 新工作區副本已驗證 SC-001 至 SC-004 可重跑。本次 Edge 重跑另通過 T026、T027。 |
| `PlantUML -charset UTF-8 -failfast2 diagrams/008-sequence.puml` | 更新並重新產出時序圖 PNG。 |

驗收未連線至實際 Google 試算表。

## 收斂回歸

- T021：封存後缺少版本、小數及字串版本回傳 `422`，過期版本回傳 `409`。同版重試讀回原結果，各分支皆保留封存資料。
- T022：兩分頁改成同值仍須核對後才能定案。核對後另一頁再更正，原草稿不會重新出現。
- T023：定案回應遺失且下一份快照已開新題時，原操作區讀回原回合勝組，定案請求只傳送一次。
- T025：相同作答從錯誤改為正確再改回錯誤。舊人工補答回到預覽並逐字封存，另一筆已無須補答的舊值不進入結果。
- **T026**　Edge 同分頁切到題目管理與分組管理後再返回，改判草稿保留，「確認定案」仍停用。元件測試另驗證資格草稿及收到新版後的逐筆核對，並確認草稿與其他回合及活動隔離。
- **T027**　Edge 模擬定案回應遺失並延後讀回。在下一回合顯示「無勝組」之後，前一回合仍在自己的操作區讀回並顯示「勝組：甲組」。兩個回合各收到一次定案請求。
- **T028**　Edge 模擬首次結果查詢回傳 `503`，原定案回應稍後遺失。開下一題後仍可在原操作區重試並顯示「無勝組」。瀏覽器記錄兩次結果查詢及一次定案請求。元件回歸另驗證較晚的版本衝突也會保留重試入口，並可讀回原勝組。

## 從新工作區重跑 Edge 驗收

需要 Node.js 22.12 以上、npm、Microsoft Edge，以及安裝 npm 套件的網路連線。在專案根目錄執行：

```powershell
npm ci --no-audit --no-fund
npm run build
$reviewBrowserTools = Join-Path ([IO.Path]::GetTempPath()) ('speckit-review-browser-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $reviewBrowserTools | Out-Null
npm install --prefix $reviewBrowserTools --no-save --package-lock=false --no-audit --no-fund playwright-core@1.56.1
node scripts/verify-review-browser.mjs $reviewBrowserTools
```

腳本會在隨機的本機連接埠建立記憶體教室，產生兩組虛構學生、雙子題及舊待審核資料，執行結束後關閉瀏覽器及服務。使用系統預設安裝位置的 Edge，可直接執行上述指令。若 Edge 安裝於其他位置，先將 `SPECKIT_EDGE_EXECUTABLE` 設為其執行檔的絕對路徑。
