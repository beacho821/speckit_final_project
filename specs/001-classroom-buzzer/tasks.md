---
description: "課堂線上搶答系統的開發任務與獨立驗收條件"
---

# 開發任務：課堂線上搶答系統

依據[功能規格](spec.md)、[實作計畫](plan.md)、[研究決策](research.md)、[資料模型](data-model.md)、[HTTP 契約](contracts/http.md)、[學習單契約](contracts/guided-notes.md)與[驗收指南](quickstart.md)。下列檔案路徑均相對於專案根目錄。

各情境先寫 Vitest 案例，確認能重現預期缺口，再實作並重跑。每個功能至少驗證一個正常案例及一個邊界案例；拒絕操作時同時檢查正體中文修正提示及資料未變更（FR-011、FR-012）。同一批標示 `[P]` 的任務可分檔並行，批次與先決條件列於文末。

## 階段一　建立可重現的本機專案

- [X] T001 在 `package.json`、`package-lock.json` 建立單一 npm 專案。依計畫查核最新穩定版 npm、Vite、React、TypeScript、Tailwind CSS、Express、Vitest、ExcelJS，以及已採用的 react-dom、@tailwindcss/vite、googleapis 與按需採用的四項 @types 宣告。記錄 Node.js 正式版與實際版本，設定 typecheck、test、build、start 指令。其他直接依賴先提出名稱、用途與必要性。
- [X] T002 [P] 在 `tsconfig.json`、`backend/tsconfig.json`、`vite.config.ts`、`frontend/index.html`、`frontend/src/main.tsx`、`frontend/src/styles.css` 設定前後端型別檢查、Express 編譯輸出及 Vite 的 React、Tailwind 建置入口。
- [X] T003 [P] 在 `vitest.config.ts` 設定 Vitest 單次執行與 tests 目錄探索，在 `.gitignore` 排除安裝產物、建置產物及本機憑證檔。測試用憑證於執行時產生。

## 階段二　建立各情境共用的本機活動、身分與名單

- [X] T004 [P] 在 `tests/contract/access.test.ts` 撰寫 POST /sessions、GET／PUT /roster 成功及失敗的 HTTP 案例，涵蓋教師與各組同時登入、錯誤憑證、冒用組名、組名空白或重複、刪組撤權，以及重啟後帶舊活動 ID 的請求被拒絕、僅帶正確活動 ID 而無憑證也無權存取。
- [X] T005 [P] 在 `tests/unit/config.test.ts` 測試從環境取得合法設定、缺少教師密碼、組別代碼空白或重複、教師密碼與任一組別代碼相同時拒絕啟動、錯誤 JSON 及缺 Google 設定。確認錯誤與日誌不含輸入的機敏值，缺 Google 設定時本機測試仍可執行。
- [X] T006 在 `shared/api.ts` 定義契約中的請求、角色專屬回應與中文錯誤結構，在 `backend/src/activity.ts` 建立記憶體活動。遵守「程序啟動時建立空活動。另開畫面不會重建活動。」初始名單、來源、回合與勝組皆為空。按類別圖維持每個活動可有 0..1 份來源學習單。
- [X] T007 在 `backend/src/config.ts` 驗證 TEACHER_PASSWORD、GROUP_CODES_JSON、GOOGLE_SERVICE_ACCOUNT_JSON，在 `backend/src/access.ts` 驗證憑證與全量名單更新。「名稱去除首尾空白後不得空白或重複。授權代碼唯一且與教師密碼不同。」組別更名保留 ID。逐次對照環境設定與活動名單，拒絕憑證碰撞並在移除組別時立即撤權。
- [X] T008 在 `backend/src/app.ts`、`backend/src/server.ts` 建立可獨立啟動的測試與正式入口，掛載 /api/sessions、/api/roster，實作 Basic 逐次驗證、登入回傳公開 activityId、受保護請求比對 X-Activity-Id、角色驗證、no-store、中文錯誤及安全日誌。同源供應前端，正式入口只監聽 127.0.0.1:3000。
- [X] T009 在 `frontend/src/App.tsx`、`frontend/src/api.ts`、`frontend/src/Roster.tsx` 接通兩種登入入口及教師名單管理。每分頁只在記憶體保存輸入的憑證與活動 ID，依 HTTP 契約發送 Basic 標頭，失效時重新驗證；先顯示可選組別 ID，編輯名單時不顯示代碼。
- [X] T010 在 `tests/integration/local-app.test.ts` 啟動本機 Express，以真實 HTTP 重跑登入及名單流程，檢查同機分頁代表不同身分、錯誤回應及重啟清空。確認 `package.json` 的型別檢查、測試與建置均可執行。

## 階段三　US1 老師匯入並核對學習單（P1）

**目標**　老師能核對主題號、子題號、題組與填空總數。  
**獨立驗收**　只用教師畫面及三份學習單。單題版應有 6 個單位、6 格；混合版應有 4 個單位、6 格；移動欄列與使用分散標記後，仍須逐項符合預期對照。錯誤重匯須保留原預覽（FR-002、FR-003、SC-001）。

### 測試

- [X] T011 [P] [US1] 在 `tests/fixtures/guided-notes.ts` 以 ExcelJS 建立三種版面的 XLSX、對應原稿格值及獨立預期題號表。在 `tests/unit/worksheet-parser.test.ts` 驗證三種正例，另測跨空行誤接子題、重複題號、歧義、零填空與合併格重算。
- [X] T012 [P] [US1] 在 `tests/contract/worksheet-import.test.ts` 以可控 Google 回應測 POST /worksheet/import：指定 gid、多分頁待選、單頁自選、錯誤網址、失權、XLSX 與 Sheets 快照不一致、學生越權及舊請求晚到。失敗時原預覽必須完整。

### 實作

- [X] T013 [US1] 在 `backend/src/worksheet/identify.ts` 依表頭、子題、合併主格、分散標記與既有身分備註辨識單位。「完整題號與同單位內子題均須唯一。」「每個填空只屬於一個單位。」保存原稿順序與具型別的匯入原值，固定座標、檔名與題目敘述不得成為辨識鍵。
- [X] T014 [US1] 在 `backend/src/worksheet/google-source.ts` 解析合法文件 ID 與非負整數 gid，以 googleapis 讀分頁名稱、格值、備註及合併範圍，透過 Drive 匯出 XLSX 並以 ExcelJS 載入。處理分頁選擇、無權限、網路錯誤及匯出大小限制。
- [X] T015 [US1] 在 `backend/src/worksheet/import.ts` 對照兩種來源後按當前活動狀態發布預覽。「匯入整份驗證成功才替換預覽。」首回合開啟後保留來源；成功重匯清除舊準備選題；晚到的非同步結果不能覆寫新來源或已開啟回合。
- [X] T016 [US1] 在 `backend/src/app.ts` 掛載教師匯入端點，在 `frontend/src/WorksheetImport.tsx`、`frontend/src/App.tsx` 接通網址輸入、分頁選取、題號與填空計數預覽及中文錯誤修正。
- [X] T017 [US1] 在 `tests/integration/import-preview.test.ts` 讓三份樣本走完整匯入入口，檢查實際預覽逐項符合 T011 的對照，並重跑失敗重匯與移位案例。

## 階段四　US2 全班同步搶答與課中保密（P1）

**目標**　完成一個老師可操作、各組可送出並查看結果的回合。  
**獨立驗收**　以預載的一個雙子題單位及三組名單測試，無須存取 Google。老師能開題、看即時收件並結束；學生缺一格時保留草稿，完整送出只取一個順位，結束前看不到他組進度（FR-001、FR-004、FR-005、FR-007、FR-008）。

### 測試

- [X] T018 [P] [US2] 在 `tests/contract/rounds.test.ts` 測準備、開啟、整組送出與結束端點。加入未匯入就選題、空名單、舊回合 ID、首回合鎖名單、重複開啟、漏題、多答、同組並發及送出與結束先後案例，逐次核對答案與順位。
- [X] T019 [P] [US2] 在 `tests/contract/views.test.ts` 測 GET /view 與 GET /rounds/:id/results。核對老師、本人、他組在三階段的回應，尤其是他組送出不能改變學生可見版本、喚醒請求或透露本組順位。另測教師重連時會收到含單位 ID 與完整題號的 availableUnits、學生快照省略該欄，以及逾時與越權查詢。

### 實作

- [X] T020 [US2] 在 `backend/src/rounds.ts` 實作選題、替換準備選題、開始與結束。「同堂活動每單位至多開題一次。」「每次變更須比對目前回合 ID 與階段。首回合開啟時鎖名單，後續回合沿用同一份名單。」名單內晚加入的組別可參與。
- [X] T021 [US2] 在 `backend/src/rounds.ts` 實作同步收件。「每回合每組至多一筆。提交題號集合須完全等於本單位填空集合，無漏題、重複、多餘或純空白。通過檢查後保存未裁切的原文。」同一步驟驗證、編定唯一連續順位、登記；結束沿用同一操作順序，第一筆贏得整個單位，無人送出則無勝組。
- [X] T022 [US2] 在 `backend/src/views.ts` 產生角色專屬快照與封存結果，教師可選清單取自原稿及既有回合，未匯入或全用完時回空陣列。實作比對可見版本並登記等待、20 秒逾時回 204、取消及重連；只有角色可見內容變動才喚醒。結果按完整題號涵蓋當堂固定名單。
- [X] T023 [US2] 在 `backend/src/app.ts` 掛載 /rounds、/:id/start、/:id/submissions、/:id/end（後三者接在 /rounds 下）、/view 與回合結果端點。驗證身分、輸入與階段，學生收件僅回 roundId 與 received。
- [X] T024 [US2] 在 `frontend/src/useActivityView.ts` 接通單一分頁長輪詢：首次取得完整快照、無變更續等、斷線顯示中文並重連、登入失效回登入畫面。拒收或同步更新時保留目前回合的學生草稿。
- [X] T025 [US2] 在 `frontend/src/TeacherRound.tsx`、`frontend/src/StudentRound.tsx`、`frontend/src/App.tsx` 接通教師自登入後快照選題、開關回合與名單鎖定，學生依完整題號填寫簡答。按角色呈現本組確認、教師全班即時進度及結束後的歷次結果。
- [X] T026 [US2] 在 `tests/integration/classroom.test.ts` 以真實 HTTP 演練一位老師與三組學生，驗證雙子題同收、缺答修正、並發先後、晚到組別、重連與重啟，加測首回合結束、教師重開分頁登入、無須重匯即可開第二回合。在 `tests/components/StudentRound.test.tsx` 用 Vitest 實際掛載 React 組件，模擬輸入並按送出：完整答案顯示收件確認；缺一格則指明題號、保留已填原文且沒有成功收件。依 `specs/001-classroom-buzzer/quickstart.md` 的單檔指令重跑，另以多分頁核對隔離。

## 階段五　US3 公平送出時間與順位（P1）

**目標**　尚未勝出的組別有優先送出時段。  
**獨立驗收**　給定甲曾勝、乙未勝的歷程，以可控後端時鐘在 2,999 與 3,000 毫秒收件，分別驗證拒絕與接受。乙若未先送，甲滿 3 秒後仍可獲勝（FR-006、FR-007、SC-003）。

### 測試

- [X] T027 [P] [US3] 在 `tests/unit/fairness.test.ts` 以可控時鐘驗證第一回合、未勝組、曾勝組的兩側臨界值、全組皆曾勝、無人送出歷程，以及新活動資格重算。
- [X] T028 [P] [US3] 在 `tests/contract/fair-submissions.test.ts` 以已知勝出歷程測送出及快照契約：提前拒收只回本組剩餘毫秒，零新增順位；到時首次有效者取得整組第一。測近乎同時送出、重新登入與用戶端偽造時間。

### 實作

- [X] T029 [US3] 在 `backend/src/fairness.ts` 從已結束回合推算各組曾否勝出，開題時凍結各組開放時刻。有未勝組時曾勝組延後 3,000 毫秒，全組皆曾勝時立即開放。比較採後端單調時鐘的「大於或等於」。
- [X] T030 [US3] 在 `backend/src/rounds.ts` 的同步收件步驟先核對資格，再編號；在 `backend/src/views.ts` 提供本組 waitRemainingMs。已結束回合的順位與開題資格快照不得因重連或後續勝負而改變。
- [X] T031 [US3] 在 `frontend/src/StudentRound.tsx` 顯示本組規則與剩餘等待時間。等待時仍可填答，提前送出的草稿保留，開放時更新操作；重跑 T027、T028 與課堂演練中「乙先送」和「乙未送」兩種結果。

## 階段六　US4 勝組回填與全班 CSV（P2）

**目標**　老師可以把封存答案交回原稿並取得明細。  
**獨立驗收**　預載兩個已結束題組與一個無人作答的已結束單題，名單三組。匯出應有 15 筆資料；回填只命中四個勝組填空。移欄後仍正確，若提交前發現一格遭手動修改則整批零寫入（FR-009、FR-010、SC-004）。

### 測試

- [X] T032 [P] [US4] 在 `tests/contract/writeback.test.ts` 驗證 POST /worksheet/writeback 對勝組、未結束與無勝組的處理；測未授權、無已結束回合、移欄、刪格、同格衝突、同時回填、無編輯權、回應遺失後重試及結果核對。分別斷言提交前發現衝突時寫入批次零次，以及提交後讀回受外部編輯影響時回 WRITEBACK_UNCONFIRMED、寫入批次僅一次。
- [X] T033 [P] [US4] 在 `tests/contract/results-csv.test.ts` 驗證 GET /results.csv 的權限、檔名、UTF-8 欄名、排序、15 筆資料及無已結束回合的拒絕。讀回含引號、逗號、換行及等號的簡答，檢查未送出組答案與順位為空。
- [X] T034 [P] [US4] 在 `tests/integration/writeback-identity.test.ts` 以可控 Sheets 測試替身驗證首次寫入、移欄及再匯入均可重辨混合版六格。覆蓋公式原值、形似標記的答案、既有備註、非目標格、合併與格式。

### 實作

- [X] T035 [US4] 在 `backend/src/worksheet/writeback.ts` 固定請求開始時的已結束回合並取得單一寫回執行權。重讀原 gid、重用 US1 的辨識邏輯，逐格比對具型別的匯入值、現值與勝組字串；歧義、缺格或衝突時列出題號、現值與勝組答案，整批不送出。
- [X] T036 [US4] 在 `backend/src/worksheet/google-source.ts`、`backend/src/worksheet/writeback.ts` 組成單次 spreadsheets.batchUpdate，將原文寫為 stringValue；必要時在同格附加一次識別備註並保留原有文字。提交後重新辨識並核對，差異或讀回失敗時回報待確認及相關題號，不自動重送或回滾。老師重試時重新讀取並完整比對；所有返回路徑均釋放寫回執行權。
- [X] T037 [US4] 在 `backend/src/results-csv.ts` 由封存結果產生「題號、組別、答案、搶答順位、作答狀態」五欄。每填空乘固定名單各一列，依回合、題號原序、有效順位及未送出名單序排列，保留答案原文並正確跳脫。
- [X] T038 [US4] 在 `backend/src/app.ts` 掛載回填與下載端點，在 `frontend/src/TeacherResults.tsx`、`frontend/src/App.tsx` 提供教師操作。呈現已寫入、已相符、無勝組、衝突與結果待確認，提示寫回期間暫停共編，支援處理後重試與 CSV 下載。
- [X] T039 [US4] 在 `tests/integration/results.test.ts` 從已結束回合走完兩個正式 HTTP 入口，比對同一份封存結果的勝組原文、子題順位、未送出組、四格更新與 15 筆 CSV；再次寫回不可重複附加備註或改動其他格。

## 階段七　整體驗收與交付

- [X] T040 [P] 在 `tests/integration/privacy.test.ts` 以執行期虛構機敏值驗證正常與錯誤路徑的日誌、例外、前端建置檔及未授權回應無真值；遍歷學生無權使用的教師操作，核對各入口保密、輸入驗證與正體中文回饋。
- [ ] T041 [P] 在 `tests/integration/sync.test.ts` 驗證一師三組五回合的授權更新與未授權事件零洩漏。按 `specs/001-classroom-buzzer/quickstart.md` 的瀏覽器演練量測操作被接受至各授權畫面呈現的最慢時間，須在 1 秒內（SC-002）。
- [ ] T042 依 `specs/001-classroom-buzzer/quickstart.md` 使用可編輯的 Google 教師副本實際走完三種版面與完整課堂流程，核對權限失敗、人工改值衝突、移欄、回填後重讀、CSV、重啟後外部成果仍保留。在該文件交付紀錄分列實測與替身結果（SC-001、SC-004、SC-005）。
- [X] T043 核對 `diagrams/component.puml`、`diagrams/class.puml`、`diagrams/sequence.puml` 與實際模組、資料關係及開題至回填順序。依 `package-lock.json` 執行 npm ci、npm outdated --include=dev 並複核最新穩定版，執行 npm run typecheck、npm test、npm run build、npm start。在 `specs/001-classroom-buzzer/quickstart.md` 記錄指令、通過與失敗數、最慢同步時間、差異及未執行原因，通過必要案例才勾選交付。

## 相依順序與平行範例

| 階段／情境 | 前置條件與可並行的工作 |
| --- | --- |
| 建置與基礎 | T001 後可並行 T002、T003。階段一完成後可並行 T004、T005；T006～T010 接通同一活動與登入入口。 |
| US1 | 基礎完成後並行 T011、T012。測試完成後依序接辨識、外部來源與預覽。 |
| US2 | 基礎完成後可用預載單位並行 T018、T019。完整畫面演練串接已通過的 US1 預覽，不會因測試缺 Google 帳戶而卡住收件規則驗證。 |
| US3 | US2 收件與角色快照可用後，並行 T027、T028；再串接時鐘與畫面。 |
| US4 | US1 原稿辨識與 US2 封存資料就緒後，並行 T032、T033、T034。可與 US3 分檔開發；共用入口與畫面的整合依序合併。 |
| 交付 | 四個故事均通過後可並行 T040、T041，再完成真實副本驗收與最終回報。 |

```text
階段一 → 階段二 → US1（學習單）
                → US2（回合，以預載題組可獨立測試）
US2 → US3（公平順位）
US1 + US2 → US4（原稿與匯出）
US1 + US2 + US3 + US4 → 整體驗收
```

## MVP 與增量交付

先交付 US1 的可核對預覽。第一個可演練的課堂 MVP 為 US1 加 US2：一位老師、兩組、一份學習單、一個題組，從開題演練到結果公布。接著以 US3 完成正式公平規則，再以 US4 驗收原稿與 CSV；四個情境都屬完整交付範圍。

## Phase 8: Convergence

- [X] T044 為 `backend/src/worksheet/google-source.ts` 建立可控制的 Google API 測試替身，驗證 `tests/unit/google-source.test.ts` 與 `tests/contract/worksheet-import.test.ts` 涵蓋分頁 metadata、指定 gid、多分頁選擇、格值與備註轉換、XLSX／Sheets 快照差異、權限及匯出大小錯誤；以三種 fixture 對照題號與填空結果（FR-002、SC-001，partial）。
- [X] T045 擴充 `tests/integration/classroom.test.ts`，以真實 HTTP 演練老師及三組完成至少五回合，涵蓋不同組別勝出、晚加入組別、教師重新登入後直接開下一題、學生重連、逾時前後與並發送出；逐次驗證結果隔離及授權畫面更新在 1 秒內（FR-004、FR-007、FR-008、SC-002、SC-003，partial）。
- [X] T046 擴充 `tests/contract/fair-submissions.test.ts` 與 `tests/components/StudentRound.test.tsx`，使用可控時鐘驗證曾勝組剩餘等待、提早送出被拒且順位不變、答案草稿保留、滿 3 秒可送，以及所有組都曾勝時立即開放（FR-006、SC-003，partial）。
- [X] T047 新增 `tests/integration/writeback-identity.test.ts` 與 `tests/integration/results.test.ts` 的可控 Sheets API 測試，驗證混合版移欄後以題號重辨、單次 `batchUpdate`、字串原文與識別備註、衝突零寫入、讀回待確認不重送、重試冪等，並比對相同封存回合的 CSV、勝組與未送出列（FR-009、FR-010、SC-004，partial）。
- [X] T048 新增 `tests/integration/privacy.test.ts`，使用執行期虛構憑證檢查學生存取教師端點、錯誤登入、撤銷組別、匯入／回填錯誤等路徑的回應、日誌與建置產物；確認不洩漏憑證或他組資料，並驗證拒絕操作不改變活動狀態、中文提示可供修正（FR-011、憲章「機敏資料保護／功能測試」，partial）。

## Phase 9: Convergence

- [X] T049 建立 `tests/integration/sync.test.ts`，以一師三組五回合驗證長輪詢只通知具授權角色、未授權事件零洩漏，並量測各授權畫面在接受操作後 1 秒內更新（SC-002、FR-008；partial）。
- [ ] T050 取得可編輯的 Google 教師副本後，依 `specs/001-classroom-buzzer/quickstart.md` 執行三種版面與完整課堂端到端驗收，記錄真實權限失敗、衝突、移欄、回填重讀、CSV 與重啟保存結果；目前僅有替身覆蓋，無法證明外部流程（SC-001、SC-004、SC-005；partial）。
## Phase 10: Convergence

- [ ] T051 依 `specs/001-classroom-buzzer/quickstart.md` 以實際桌面瀏覽器開啟教師及三組學生分頁，完成五回合授權同步演練；逐次量測操作接受至各授權分頁畫面呈現的最慢時間，記錄實測值並確認均小於 1 秒（SC-002；partial，HTTP 長輪詢測試不代表瀏覽器畫面呈現）。
- [ ] T052 取得可編輯的 Google 教師副本及服務帳戶設定後，完成三種版面及整堂課的真實 Google 匯入、人工改值衝突、移欄回填重讀、CSV 與重啟保存驗收，並將實測與替身結果分開記錄（SC-001、SC-004、SC-005；partial，目前只有 Google API 替身測試）。