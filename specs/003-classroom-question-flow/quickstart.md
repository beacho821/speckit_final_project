# 驗收指南｜搶答題目、判分與老師補答

以下是功能實作完成後的驗收步驟。既有基準測試僅用於確認驗收工具可執行。

## 環境

在專案根目錄使用 Node.js 22.12 以上版本。HTTP 測試與開發伺服器須能監聽本機連接埠。驗收使用隔離的測試活動、測試用教師密碼與臨時組別；不要把啟動憑證寫入測試紀錄。

```sh
npm ci
npm run typecheck
npm test
npm run build
```

首次開發啟動可由 `.env.example` 建立本機 `.env`，填入 `TEACHER_PASSWORD`，或使用已配置的專案環境。

```sh
npm run dev
```

開啟終端顯示的網址。用老師身分新增甲、乙、丙三組，以三個獨立分頁加入。原始 [單題 XLSX](../002-classroom-workflow-fixes/references/single-questions.xlsx) 及 [混合題 XLSX](../002-classroom-workflow-fixes/references/mixed-questions.xlsx) 可直接使用。各來源切換驗收須在該活動首回合開始前執行，或另開新活動。驗收副本應含欄列移動、子題題幹共用合併範圍及空白題幹。需要測 Google 實際回填時，使用獨立、已分享給服務帳戶且可編輯的教師副本，依 [專案設定](../../README.md)設定憑證路徑。

## 使用者提供的 Google 驗收工作表

將 [Google 驗收工作表（gid 1167716485）](https://docs.google.com/spreadsheets/d/1_XnA1A4Cr1CXcrg5aNF0edg3s7_ITWZE7G4cMNn9mGM/edit?gid=1167716485#gid=1167716485) 用於唯讀匯入。以有檢視權的服務帳戶選擇該分頁，核對完整題號、題幹、子題歸屬與雙角色畫面。2026-11-18 未登入的唯讀匯出檢查收到 HTTP 401。其後使用 `.env` 的測試中，服務帳戶 JSON 檔案存在，但本機 Node.js 讀取時收到 `EPERM`，該次測試未向 Google 送出匯入請求。

### Google 驗收判定

| 項目 | 通過條件 | 目前狀態 |
| --- | --- | --- |
| SC-001 實機跨來源對照 | 分別匯入內容相同的 XLSX 與 Google 工作表，完整題號、題幹與子題歸屬逐一相符。 | 待驗收 |
| 提供的工作表唯讀匯入 | 使用具檢視權的服務帳戶匯入指定分頁，核對完整題號、題幹、子題歸屬及師生畫面。 | 待驗收，本機讀取金鑰收到 `EPERM` |
| SC-005 實機回填 | 使用具編輯權的獨立教師副本，確認只寫入已公布勝組的原稿填空。另測原稿衝突，驗證整批零寫入。 | 待驗收 |
| Google 模擬與本機 XLSX | 以模擬的 Google 網路回應及既有 XLSX 快照執行對照、匯出與回填相關案例。 | 通過 |

將各項結果記為通過、失敗或待驗收。遇到授權、金鑰或連線阻礙時記錄原因，保留實機項目的待驗收狀態，並獨立執行及記錄模擬結果。

## MVP 驗收

匯入一個單題並設定至少兩種標準答案，例如「CPU」和「中央處理器」。讓一組學生查看題幹並送出「記憶體」。老師停止收件後，確認系統自動判為答錯，填入老師補答並公布。下載 CSV，核對該組原始答案「記憶體」、最終正誤「答錯」及該題恰好一列「老師補答」。

## 端到端情境

| 驗收 | 操作 | 預期 |
| --- | --- | --- |
| 匯入與顯示（FR-001 至 FR-003） | 分開匯入兩份 XLSX 與欄列移動副本，以相同內容驗證 Google。核對題號、換行、子題題幹和作答位置。匯入一份子題缺題幹的副本，試開後補齊、設定答案再開題。 | 預覽與老師端題幹一致；學生開題後在作答欄旁看到題幹，重連也可重現。缺題幹的回合遭拒且保留選題、題號與已填內容。共用題幹只出現於明確涵蓋的子題。 |
| 手動與來源替換（FR-004） | 分別在空活動及已有匯入題的活動新增並選取一個手動單題，在純手動題做完一回合及 CSV。測試空白、重複、活動中新增和重匯入撞題號。 | 兩種活動均可新增並選取；拒絕時說明問題及修正方式、保留輸入與既有題庫。合法重匯入只替換匯入題、保留手動題與名單、清除待開始選題。 |
| 答案設定與自動判分（FR-005、FR-011） | 留一子題的答案只有空白行，試開回合。補齊後，某題填兩行 `CPU` 及 `中央處理器`，中間加空白行。依序送出 `cpu`、` CPU `、`中央處理器`，停止收件。 | 缺標準答案時提示完整題號且維持準備。補齊後三組分別判為錯、對、對；原文與順位保留。題目開啟後不能更改本回合的答案清單。 |
| 更正、補答與勝組（FR-005 至 FR-007） | 公布「先錯後對」回合；另測全錯、無人送出、部分子題無人答對及各組分別答對不同子題。把唯一答對改為答錯後嘗試無補答公布，再改回有組答對並公布。 | 先錯的組保有第一順位，最早全對組勝出並受下回合既有 3 秒規則約束。補答僅適用無人答對子題。缺補答阻止公布，改判有正解後排除該題草稿。 |
| 隔離與重試（FR-005、FR-006、FR-010、FR-011） | 用學生身分嘗試編輯或看草稿結果。用兩個老師分頁競爭儲存複核。停止收件同時送答，另測重連及同回合公布重送。 | 越權遭拒、無資料變更且無標準答案洩漏。過期複核被拒並可重新載入。依接受先後決定是否收件。分別量測停止收件與公布後的角色可見畫面，均須在 1 秒內更新。已儲存草稿及已公布結果可恢復，無重複補答。 |
| CSV 與線上回填（FR-008、FR-009） | 下載含已送出、未送出、含雙引號逗號換行與老師補答的 CSV，再次下載比對。對含第二順位勝組、手動題與補答的 Google 教師副本回填。另改動原稿值來測衝突。 | 逐列符合[匯出契約](contracts/ui-and-exports.md)。Google 只寫已公布的勝組對應格，教師補答與手動題不寫入；衝突清楚列出題號，批次零變更。 |

## 聚焦回歸指令

```sh
npm test -- tests/unit/worksheet-parser.test.ts tests/contract/worksheet-import.test.ts tests/contract/xlsx-import.test.ts tests/integration/import-preview.test.ts tests/integration/xlsx-classroom.test.ts
npm test -- tests/components/TeacherRound.test.tsx tests/components/StudentRound.test.tsx tests/components/WorksheetImport.test.tsx tests/components/useActivityView.test.tsx
npm test -- tests/contract/rounds.test.ts tests/contract/fair-submissions.test.ts tests/contract/views.test.ts tests/contract/isolation.test.ts tests/integration/sync.test.ts tests/integration/reconnect.test.ts tests/integration/privacy.test.ts
npm test -- tests/contract/results-csv.test.ts tests/integration/results.test.ts tests/contract/writeback.test.ts tests/integration/writeback-identity.test.ts
```

更新既有測試的備課及封存流程，讓需要成功開題的案例儲存有效題幹與標準答案，再停止收件及公布。缺題幹樣本保留給拒絕開題和教師補題案例。連線、格式與回填先由現有 HTTP 測試及 Google 模擬覆蓋，再用教師副本做權限和實際回填驗收。匯入競爭測試以伺服器確定收到舊匯入、較新匯入已提交、再放行舊匯入的順序驗證，避免以固定等待時間推斷收件順序。

## 完成記錄

對照[組件圖](../../diagrams/003-component.puml)、[類別圖](../../diagrams/003-class.puml)及[時序圖](../../diagrams/003-sequence.puml)，確認各職責、資料關係及回合階段。實作完成時記錄上述指令及執行結果、正常及邊界案例、未執行項目與原因。

### 規劃時的既有基準（2026-11-18）

`npm run typecheck` 通過。允許本機監聽後，`npm test` 及 `npm test -- --maxWorkers=2` 都有 113 個通過、1 個失敗。失敗為 `tests/contract/worksheet-import.test.ts` 的「較早發出的非同步匯入不能覆蓋較新的來源」，較早發出的請求實得 200，預期 409。後續驗收須以明確的伺服器收件順序重測。此基準在本功能實作前取得。

### 實作驗收（2026-11-18）

| 指令或項目 | 結果 |
| --- | --- |
| `node --version`、`npm run typecheck` | Node.js v26.5.0，型別檢查通過。 |
| `npm test -- tests/contract/worksheet-import.test.ts` | 5 個案例通過，包含依伺服器實際收件順序控制兩次匯入的競爭案例。 |
| `npm test` | 43 個測試檔、132 個案例全數通過。 |
| 上方聚焦回歸指令（合併測試路徑執行） | 23 個測試檔、65 個案例全數通過，另含手動加題、複核畫面及題庫契約。 |
| `npm run build` | 前端及後端建置通過。 |
| `java -Djava.awt.headless=true -jar plantuml.jar -checkonly -failfast2 'diagrams/003-*.puml'` | 三張圖語法核對通過，既有 PNG 可讀。組件、類別及時序與題庫、判分、公布、匯出及回填實作相符。 |
| Google 實機唯讀匯入 | 以新建置重試，Node.js 讀取 `.env` 所指定的服務帳戶 JSON 仍收到 `EPERM`。此重試尚未送出 Google 請求。 |
| Google 實機跨來源對照及原稿回填 | 待驗收。跨來源對照須可讀取 Google 工作表，回填須有具編輯權的獨立教師副本。 |

本機 XLSX 與模擬 Google 案例已驗證正常及邊界情況，包括完整題幹與兩種來源對照、缺題幹或標準答案、手動和匯入題混用、順位與改判、逾期版本、公布重試、補答 CSV、角色同步，以及模擬 Google 原稿衝突的零寫入與回填後重讀。MVP 的匯入題作答、停止收件、補答、公布及 CSV 已由 `tests/integration/results.test.ts` 驗證。T035 保留待驗收狀態。

### 收斂補強驗收（2026-11-18）

- `npm test -- tests/unit/worksheet-parser.test.ts tests/contract/questions.test.ts tests/contract/xlsx-import.test.ts tests/contract/views.test.ts tests/components/TeacherRound.test.tsx tests/components/RoundReview.test.tsx` 通過 6 個測試檔、29 個案例。
- `npm test` 通過 43 個測試檔、139 個案例。`npm run typecheck` 與 `npm run build` 皆通過。
- 半形子題號佔位與只含不可見字元的題幹無法開題或儲存。學生在準備階段收不到教師的題組標籤，開題後仍可讀到題幹。跨分頁更新後，老師可以複製已失效的備課或補答草稿，舊草稿不會帶入新回合。
- Google 實機驗收前置重試以 `node --env-file=.env` 開啟 `GOOGLE_SERVICE_ACCOUNT_JSON` 指向的檔案，仍收到 `EPERM`。因此這次沒有送出 Google 請求，指定分頁匯入、實機來源對照及回填仍待驗收。T035、T039 保留待完成。
