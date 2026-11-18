---
description: "教室介面重新設計的實作與驗收任務"
---

# 任務清單｜教室介面重新設計

**輸入**　[功能規格](spec.md)、[實作計畫](plan.md)、[研究決策](research.md)、[資料模型](data-model.md)、[HTTP 契約](contracts/http.md)、[UI 契約](contracts/ui.md)、[驗收指南](quickstart.md)

**任務格式**　`Tnnn` 依序編號。`[P]` 表示前置任務完成後可與同組標示的任務並行，`[USn]` 對應功能規格的使用情境。檔案路徑皆相對於專案根目錄。

**測試方式**　依專題憲章涵蓋每個功能的正常與邊界案例。各情境先撰寫測試，確認案例因功能未實作而失敗，再完成實作。錯誤案例驗證正體中文提示及資料無異動。

## 階段一｜準備

- [X] T001 依 `package.json` 確認 Node.js 22.12 以上及現有依賴，執行 `npm run typecheck` 與 `npm test` 建立基準，在 `specs/004-redesign-classroom-ui/validation-results.md` 記錄環境、指令及結果。
- [X] T002 在 `.gitignore` 排除 `classroom-data/`，涵蓋伺服器產生的教室存檔及同目錄暫檔。

## 階段二｜共用基礎

- [X] T003 定義教室、活動、定位、列表、角色回應及持久資料型別於 `shared/api.ts` 與 `backend/src/activity.ts`。資料模型約束為「每間教室恰有一場未封存的活動」、「每場活動最多有一個未定案回合」及「存檔外層有 `schemaVersion: 1`，檔名由伺服器產生的教室識別決定」。
- [X] T004 [P] 在 `tests/unit/classroom-store.test.ts` 先測試有效載入、版本或檔名不符、壞檔隔離、故障注入、發碼世代原子提交及失敗、依可信上限復原，以及只有舊備份且無可信上限時維持停用。驗證停用期間教師仍可管理已恢復的教室，並核對存檔欄位排除。所有檔案操作使用獨立暫存目錄。
- [X] T005 [P] 在 `tests/unit/classroom-scope.test.ts` 先測試每教室異動序列、執行期識別、舊授權撤銷，以及碼跨教室與用途不重複。注入產碼碰撞，驗證學生碼及投影碼遇教師密碼時重新產碼，且兩次啟動使用同一隨機部分時仍發出不同的完整碼。
- [X] T006 實作 `backend/src/classroom-store.ts` 的同目錄暫檔完整寫入、同步及原子重新命名、刪除及記憶體測試替身。逐檔驗證版本、檔名、欄位、父子關聯及回合狀態。存檔白名單保留教室、題庫、分組、成員、回合與答案，排除密碼、加入碼、同步版本、匯入世代、執行期查表及單調時計時。以 `classroom-data/issuance-epoch.json` 獨立保存非機敏發碼世代，啟動時原子遞增。存取失敗時停用發碼與用碼驗證，保留教師可操作的教室。依資料模型支援管理者使用可信世代上限復原，驗證下一世代確實高於該值。
- [X] T007 在 `backend/src/classrooms.ts` 建立教室目錄及各教室異動序列及回填進行中標記，供後續刪除與換場守衛讀取。用已提交狀態驗證草稿，存檔後才發布記憶體、快照版本和通知。寫入失敗回傳 503 並保留上一版。刪除與寫入使用同一序列，先完成檔案移除再撤權。
- [X] T008 在 `backend/src/access.ts`、`backend/src/activity.ts`、`backend/src/roster.ts` 實作教室／活動／執行期定位、成員關聯、角色驗證及記憶體碼索引。遵循「有效碼及本進程已用碼跨教室與用途不重複」。用碼登入先驗目前發碼世代及用途。產碼結果遇教師密碼時重新產碼。每次請求及長輪詢返回前重驗授權，撤銷時喚醒等待。
- [X] T009 在 `backend/src/bootstrap.ts`、`backend/src/config.ts` 與 `.env.example` 接上啟動載入及 `HOST`。監聽前還原教室，收件中的回合沿用結束收件規則轉待審核，先存檔，原答案與順位保留。個別壞檔或轉待審核寫入失敗時保留原檔，標記該教室暫時無法恢復、加入或收件，其他教室照常啟動。預設監聽 loopback，允許明確設定區網監聽。
- [X] T010 在 `backend/src/app.ts`、`backend/src/views.ts` 將現有名單、題目、XLSX／Google 匯入、回合、送答、結果、輪詢、CSV 與 Google 回填接到請求指定的教室及目前活動。同階段完成學生 `POST /api/sessions`，由有效碼及名稱定位唯一教室、目前活動、執行期與組別，驗證首次登入及重新登入。異動等待存檔提交，背景匯入完成時核對教室、活動及世代。教室刪除、活動更換或世代失效時拒絕該次提交。CSV 與回填沿用目前活動範圍及既有衝突處理。教師刪除教室及開始新活動的路由由 T016、T022 套用回填期間的 409 規則。
- [X] T011 在 `tests/helpers/classroom.ts`、`tests/contract/worksheet-import.test.ts`、`tests/integration/import-preview.test.ts` 及 `tests/integration/local-app.test.ts` 以注入的記憶體存檔建立具明確定位的教室測試資料，遷移依賴全域活動的斷言。保留原有搶答、題源與授權回歸案例。學生登入經 T010 的正式端點，涵蓋跨室定位及舊加入碼拒絕。
- [X] T012 在 `frontend/src/api.ts`、`frontend/src/session.ts`、`frontend/src/useActivityView.ts` 實作共用活動標頭、學生同分頁重新驗證、跨範圍取消載入與完整快照切換。同教室子頁保留工作狀態，範圍切換先清除舊畫面，忽略過期回應。教師密碼僅保留於記憶體。

**檢查點**　兩間教室可使用不同活動定位，HTTP 與前端存取共用範圍規則，存檔與授權測試可在獨立環境重跑。

## 階段三｜US1 建立、恢復與刪除教室（P1）

**目標**　教師從原登入介面進入教室列表，建立、恢復或確認刪除教室。多間教室可各自運作。

**獨立驗收**　用測試輔助工具建立兩間含回合資料的教室。操作列表、重新啟動並確認兩間皆可恢復，再刪除其一，確認另一間可繼續收件且已刪教室舊授權遭拒。

### 測試

- [X] T013 [P] [US1] 在 `tests/contract/classrooms.test.ts` 測試教師登入後列表、建立、讀取與刪除，含空白、1／40／41 字元、同名獨立識別、非教師存取與不存在教室。
- [X] T014 [P] [US1] 在 `tests/integration/classroom-persistence.test.ts` 測試雙教室同時收件、獨立定案、重啟轉審核、刪除後重啟、壞檔隔離、一般寫盤失敗重試及重啟轉換寫入失敗。後者核對原檔、其他教室可用、受影響教室禁止收件與加入、下次成功啟動保留答案及順位。另經 T010 的正式學生登入端點驗證新分頁手動輸入重啟前的學生碼被拒，當次碼可登入。
- [X] T015 [P] [US1] 在 `tests/components/ClassroomList.test.tsx`、`tests/components/App.test.tsx` 與 `tests/components/useActivityView.test.tsx` 測試登入後的教室列表、空清單、建立／恢復、取消／確認刪除、焦點回復、載入失敗與切室時丟棄遲到回應。

### 實作

- [X] T016 [US1] 在 `backend/src/classrooms.ts` 與 `backend/src/app.ts` 實作教師 `/api/sessions` 與 `/api/classrooms` 列表、建立、讀取、刪除契約。套用「教室名稱去除頭尾空白後限 1–40 個可見字元，同名教室依獨立識別與更新時間區分」，最近更新在前，回傳壞檔或暫時無法恢復的提示。刪除先在該教室的異動序列檢查回填標記，進行中回傳 409 且零異動。
- [X] T017 [US1] 在 `frontend/src/ClassroomList.tsx` 實作左側建立、右側歷史清單及窄版堆疊。各列含教室名稱、階段、更新時間、恢復及刪除，確認對話框說明影響並預設聚焦取消。顯示暫時無法恢復的教室，提示重啟後重試。已知回填期間停用刪除。刪除遇回填衝突時保留該列並提示稍後再試。
- [X] T018 [US1] 在 `frontend/src/App.tsx`、`frontend/src/TeacherWorkspace.tsx`、`frontend/src/styles.css` 接上瀏覽器 History、登入後教室列表和已選教室工作區。保留初始登入排版與欄位，設定教室名稱、返回清單、子頁導覽、標題焦點及當前頁語意。載入、刪除或切室時清理舊畫面及操作狀態。
- [X] T019 [US1] 執行 `tests/contract/classrooms.test.ts`、`tests/integration/classroom-persistence.test.ts` 與 T015 的元件案例，確認正式路徑可建立及恢復教室、拒絕已刪教室的舊授權，並驗證遲到名單或快照無法覆寫已切換的工作區。

## 階段四｜US2 設定活動與分組（P1）

**目標**　獨立管理及分組頁支援備課、分組和建立下一場活動。

**獨立驗收**　以同一間測試教室完成匯入或手動出題、分組管理、備題，從兩個入口進同一分組頁。使用已定案測試資料建立新活動，確認組別可調整、舊回合組名與答案可查。

### 測試

- [X] T020 [P] [US2] 在 `tests/contract/classroom-activities.test.ts`、`tests/contract/roster.test.ts`、`tests/contract/questions.test.ts` 測試開始新活動、沿用分組與題庫、舊授權失效、舊回合快照、準備回合撤下、名單鎖定及收件中／待審核拒絕。
- [X] T021 [P] [US2] 在 `tests/components/ClassroomSettings.test.tsx`、`tests/components/Roster.test.tsx`、`tests/components/WorksheetImport.test.tsx` 測試雙入口、待確認匯入、手動出題、題幹／標準答案的就緒提示、鎖定名單、跨範圍回應及新活動確認對話框。

### 實作

- [X] T022 [US2] 在 `backend/src/classrooms.ts`、`backend/src/roster.ts` 與 `backend/src/app.ts` 實作開始新活動。封存舊活動並撤下未開放的準備回合，沿用教室題庫和分組設定，新活動的名單解鎖，使用記錄、勝組等待與成員登入記錄重新開始。舊活動及歷史成員仍可查，舊學生與投影授權在存檔成功後撤銷。Google 回填期間查同教室的進行中標記並回傳 409，保留目前活動。
- [X] T023 [US2] 在 `frontend/src/ClassroomSettings.tsx` 與 `frontend/src/TeacherRound.tsx` 拆出管理頁的題源匯入、預覽、手動新增、選題及備題編修。沿用 `frontend/src/WorksheetImport.tsx`、`frontend/src/ManualQuestion.tsx`，讓草稿以題目、活動及版本定位，在同範圍切頁保留。於 `frontend/src/TeacherWorkspace.tsx` 共用草稿、待確認及就緒狀態，以供 T031 的控制台連動。
- [X] T024 [US2] 在 `frontend/src/Roster.tsx` 將新增表單移至分組清單前。各列顯示組名、學生加入碼與名單，控制同時間只展開一列編輯或細節。顯示鎖定原因。沿用「保留既有同組同名規則。活動內的組名依既有限制驗證」，回合保留開放時的組名快照。
- [X] T025 [US2] 在 `frontend/src/TeacherWorkspace.tsx`、`frontend/src/ClassroomSettings.tsx` 與 `frontend/src/styles.css` 接通管理、分組的返回與雙入口。管理頁以題目主欄搭配就緒側欄，窄版循閱讀順序堆疊。「開始新活動」確認顯示沿用與換碼結果，成功後切至新活動。回填期間停用換場入口，收到競爭衝突時顯示稍後再試。
- [X] T026 [US2] 執行 `tests/contract/classroom-activities.test.ts` 與 `tests/components/ClassroomSettings.test.tsx`，依驗收指南走查正式備課及分組路徑，驗證名單鎖定、舊資料和活動切換。

## 階段五｜US3 開放搶答、審核與定案（P1）

**目標**　教師在控制台操作目前回合，查閱目前與歷次活動的已定案答案。

**獨立驗收**　用備妥題目與分組的教室開放、送答、結束，改判並取消及恢復一組資格，提交必要補答後定案。確認答案與順位不變、資格重算正確。另一分頁提交較舊版本時，看到提示且定案清單未增加。

### 測試

- [X] T027 [P] [US3] 在 `tests/contract/classroom-review-history.test.ts`、`tests/unit/rounds.test.ts` 先測試資格改動、補答、原子拒絕、重複與過期審核、勝組重算、歷史唯讀及跨教室拒絕。另在 `tests/integration/writeback-identity.test.ts` 模擬 Google 回填暫停於遠端請求，驗證同室第二分頁換場與刪除都回傳 409 且零異動，另一教室仍可操作，回填結束後可重試。另以兩間教室對同一工作表的同題回填不同答案，驗證第二筆忙碌時回傳 409 且零寫入，重試重新核對並保留第一筆答案。測試不同工作表可並行，並驗證失敗後釋放目標。
- [X] T028 [P] [US3] 在 `tests/components/TeacherConsole.test.tsx`、`tests/components/RoundReview.test.tsx` 測試開放條件、階段主操作、逐組資格控制、必要補答、並行衝突與歷史展開。從備課留下未儲存草稿再到控制台，確認不能開放、出現返回備課入口，儲存後可開放。

### 實作

- [X] T029 [US3] 在 `shared/api.ts`、`backend/src/rounds.ts` 保存回合開放時題組名稱、題號、題幹、標準答案及回填定位快照。採用「同回合一組最多一份，順位依伺服器接受順序。取消資格只改資格標記」。同一 `reviewRevision` 一併驗證改判、資格與補答，重算有效正解、補答需求與勝組。
- [X] T030 [US3] 在 `backend/src/views.ts`、`backend/src/app.ts`、`backend/src/results-csv.ts`、`backend/src/worksheet/writeback.ts` 接上資格視圖及教師專屬跨活動摘要、定案明細。已定案結果以快照查詢且唯讀，Google 回填沿用合格勝組與衝突保護，CSV 仍取目前活動。將回填狀態透過教師列表、教室讀取及教師快照呈現。在 `backend/src/classrooms.ts` 於教室異動序列內登記與解除回填標記，綁定原活動及快照，讓 T016 與 T022 的守衛在同一序列生效。回填進行期間釋放教室佇列。依試算表 ID 與工作表 ID 在讀取前取得該目標的處理權，完成或失敗後釋放。相同目標同時請求回傳 `WRITEBACK_TARGET_BUSY` 及 409。重試時重新讀取，若來源值衝突則拒絕覆寫。不同工作表可並行。
- [X] T031 [US3] 在 `frontend/src/TeacherRound.tsx`、`frontend/src/TeacherWorkspace.tsx` 與 `frontend/src/styles.css` 完成獨立控制台，首屏顯示階段、題組和「開放搶答」／「結束搶答」。使用 T023 的共用就緒狀態。未儲存修改時阻止開放，顯示「請先儲存題目修改」與返回備課入口。伺服器仍驗證已儲存題目、分組與階段。收件時以側欄顯示各組進度。
- [X] T032 [US3] 在 `frontend/src/RoundReview.tsx` 實作逐組逐題判對錯、取消或恢復資格、教師補答與「確認定案」。版本衝突時保留可核對草稿，依最新審核快照重載。小螢幕將確認區放在審核後。
- [X] T033 [US3] 在 `frontend/src/RoundHistory.tsx`、`frontend/src/TeacherResults.tsx` 及 `frontend/src/TeacherRound.tsx` 呈現依活動及回合分組的已定案清單。展開才載入逐題答案、順位、資格、補答和勝組。保留目前活動的 CSV 及 Google 回填入口。工作表忙碌時顯示稍後重試的提示。

## 階段六｜US4 學生等待、作答及確認收件（P1）

**目標**　學生使用手機在同一路徑依伺服器狀態完成等待、作答與鎖定確認。

**獨立驗收**　兩台裝置以同組身分進入一個測試回合。以 360 px 完成等待到收件、重新整理顯示相同伺服器答案，再開始下一回合。嘗試缺答、提前送出及同組重複送出，確認提示與順位。

### 測試

- [X] T034 [P] [US4] 在 `tests/integration/reconnect.test.ts`、`tests/contract/fair-submissions.test.ts` 測試同組並送、回應遺失後重抓、同組重新整理、缺答、提前及已關閉拒收與拒絕後的零異動。
- [X] T035 [P] [US4] 在 `tests/components/StudentRound.test.tsx`、`tests/unit/session.test.ts` 測試等待、完整小題、鎖定答案、焦點、舊草稿清理、下一回合、待確認及活動授權失效。

### 實作

- [X] T036 [US4] 在 `backend/src/app.ts`、`backend/src/views.ts`、`shared/api.ts` 沿用 T010 的學生登入定位，提供教室與小題視圖、伺服器接受的本組答案及公平等待。已定案到下一回合間保留當次查閱結果。準備中的題幹、未公布答案和他組資料依既有權限處理。
- [X] T037 [US4] 在 `frontend/src/StudentRound.tsx`、`frontend/src/App.tsx` 與 `frontend/src/styles.css` 實作 `/student` 的等待、搶答、已送出三種版面。顯示教室及組別、「等待老師準備題目」、題幹與相鄰輸入欄、「送出本組答案」及「本組已鎖定送出」。收件時聚焦鎖定標題，長題幹及手機虛擬鍵盤可操作。
- [X] T038 [US4] 在 `frontend/src/StudentRound.tsx` 與 `frontend/src/useActivityView.ts` 完成送出待確認的重連流程。保留草稿、等待已授權完整快照、避免自動或提前重送。顯示伺服器接受的答案，重開新回合後清除舊狀態。

## 階段七｜US5 開啟大螢幕投影（P2）

**目標**　老師開啟全班投影，同時保留控制台。獨立裝置以指定組別的投影碼觀看。

**獨立驗收**　以兩組及現有回合測試全班和組別投影，核對階段和收件狀態同步。再同時開啟兩間教室的投影，驗證一間收件只更新該間投影。用未登入視窗、其他組別碼或舊碼驗證拒絕及資料清除。

### 測試

- [X] T039 [P] [US5] 在 `tests/contract/projection.test.ts` 測試全班教師授權、組別碼正常與錯誤用途、跨室／組隔離、刪除／換場／重啟失效與長輪詢。驗證全新投影分頁手動輸入重啟前的碼也被拒，當次碼可加入，並檢查回應有無未公開題目、答案、學生姓名及加入碼。
- [X] T040 [P] [US5] 在 `tests/components/Projection.test.tsx` 測試教師開窗、來源視窗及同源驗證、彈窗封鎖提示、組別登入、快照更新、登出及撤權後清空。

### 實作

- [X] T041 [US5] 在 `backend/src/projection.ts`、`backend/src/access.ts`、`backend/src/app.ts` 與 `shared/api.ts` 建立組別碼啟用、驗證與唯讀投影版本。符合「組別建立或恢復時可配置投影碼，由教師明確執行『產生投影加入碼』啟用並取得」，名單鎖定仍可取得當次碼。重用 T008 的發碼世代、用途與教師密碼碰撞檢查。全班快照限已驗證的教師，組別快照只含當次指定組別可見欄位。
- [X] T042 [US5] 在 `frontend/src/Projection.tsx` 與 `frontend/src/styles.css` 實作共用深底大字投影及組別碼頁，支援 1280 × 720、長題幹、窄版及撤權。組別碼只留分頁記憶體。
- [X] T043 [US5] 在 `frontend/src/App.tsx`、`frontend/src/ClassroomSettings.tsx` 及 `frontend/src/Projection.tsx` 接上投影頁路徑與同源視窗。教師端以固定教室與活動訂閱裁剪後資料，雙方驗證來源及視窗，網址與訊息不帶密碼或加入碼。切換教師工作區不切換原投影教室。登出、失效及來源中斷後清除快照，未授權直開時提示從教師頁開啟。
- [X] T044 [US5] 在 `frontend/src/Roster.tsx` 放入「產生投影加入碼」，顯示指定組別、當次碼和組別投影入口，以文字區分學生碼用途，並驗證教師和學生登入入口皆拒絕投影碼。

## 階段八｜整合、版面及交付驗收

- [X] T045 [P] 在 `README.md` 與 `.env.example` 更新教師教室流程、學生漏接復原、投影、`classroom-data/` 自動存檔、重啟採待審核及本機／區網啟動方式。
- [X] T046 [P] 在 `tests/integration/classroom.test.ts` 與 `tests/integration/sync.test.ts` 依 `specs/004-redesign-classroom-ui/quickstart.md` 走查實際路由，核對雙教室同時收件、跨角色資料隔離、僅相關教室的投影更新、轉換同步、既有成果及學習單路徑。
- [X] T047 依 `specs/004-redesign-classroom-ui/contracts/ui.md` 批次檢查桌面 1440 px、768 px、手機 360 px、200% 縮放與 1280 × 720 投影，包含鍵盤、長內容、空狀態及斷線。結合 Impeccable 版面掃描與真實畫面證據，在 `frontend/src/styles.css` 及相關元件一次修正，重拍確認並在 `specs/004-redesign-classroom-ui/validation-results.md` 記錄結果。
- [ ] T048 在 `specs/004-redesign-classroom-ui/validation-results.md` 以發出有效操作至最後一個應更新的授權畫面顯示正確狀態計時，記錄各畫面的更新時間。區網開放、結束、收件及定案各測三次，每次均須在 2 秒內。另記錄雙教室各兩組兩筆定案的重啟和刪除流程，以及教師、學生、投影三位試用者的實際結果。核對 SC-001 至 SC-004。
- [X] T049 依 `diagrams/004-component.puml`、`diagrams/004-class.puml`、`diagrams/004-sequence.puml` 核對實作組件、資料關聯與先存後發時序。執行 `npm run typecheck`、`npm test` 與 `npm run build`，在 `specs/004-redesign-classroom-ui/validation-results.md` 記錄可重跑指令與通過、失敗及未執行原因。

## 依賴與執行順序

```text
準備 → 共用基礎 → US1 教室 → US2 備課與分組 → US3 主持與定案
                                          └──────→ US4 學生作答
US2 ＋ US3 ＋ US4 → US5 投影 → 整合、版面及交付驗收
```

- T003 完成後，T004 與 T005 可並行。T006、T007、T008 依序提供存檔、異動及授權。T010 使用這些共用設計，正式學生登入是 T014 的前置條件，T036 再交付作答所需視圖。T016 及 T022 檢查教室回填標記，標記的實際遠端生命週期與並行驗收在 T027、T030 完成。T011 及 T012 提供各情境的測試與前端基礎。
- T011 先用測試輔助建立具明確定位的教室資料。正式建立教室的路徑在 T016 完成後由 T019 驗證。US1 的雙室驗收使用共用回合端點及測試資料，無須等新版控制台或投影。
- US2 接續教師工作區。US3、US4 皆以準備完成的教室為起點，可以先分別用測試輔助端點獨立驗收。涉及 `backend/src/app.ts`、`backend/src/views.ts`、`shared/api.ts` 的整合依序進行，避免同檔衝突。
- US5 使用分組與回合的資料、授權及同步。整合階段使用新版教師、學生與投影完整路徑。T045 與 T046 可並行，之後依序執行畫面驗收、區網與試用者驗收、最終回歸。

## 並行範例

| 情境 | 前置完成後可一起進行 |
| --- | --- |
| US1 | T013 教室 HTTP、T014 存檔整合、T015 教室列表 UI 測試各用不同檔案 |
| US2 | T020 新活動 HTTP 與 T021 管理和分組 UI 測試 |
| US3 | T027 資格、定案與歷史測試可與 T028 控制台元件測試並行 |
| US4 | T034 收件／重連測試可與 T035 三種畫面與學生暫存測試並行 |
| US5 | T039 投影授權及同步測試可與 T040 投影畫面及視窗測試並行 |

## 交付策略

先完成 US1 作為第一個可驗收增量。老師可建立、恢復及刪除多間教室，且資料在重啟後保留。接續合併 US2、US3 與 US4，形成備課到學生作答、審核和定案的核心 MVP。加入 US5 後完成投影，再依驗收指南做完整交付。

## 需求對照

| 規格 | 對應實作或驗收任務 |
| --- | --- |
| FR-001、FR-002 | T010、T012、T015–T018、T036–T037 |
| FR-003、FR-010 | T004、T006–T010、T013–T016、T020–T022、T027、T030、T048 |
| FR-004、FR-005 | T021–T025、T028、T031、T043–T044 |
| FR-006、FR-007 | T027–T033 |
| FR-008 | T039–T044 |
| FR-009 | T034–T038 |
| FR-011 | T006–T012、T014、T022、T036、T039、T041、T043 |
| FR-012 | T017–T018、T025、T031–T037、T042、T047 |
| SC-001 至 SC-004 | T014、T046–T049 |

## Phase 9: Convergence

- [X] T050 CRITICAL 統一 `frontend/src/api.ts`、`frontend/src/ClassroomList.tsx`、`frontend/src/TeacherWorkspace.tsx`、`frontend/src/Roster.tsx`、`frontend/src/RoundHistory.tsx` 及 `frontend/src/Projection.tsx` 的錯誤呈現。保留正式 API 的正體中文提示，將傳輸與解析錯誤改為可修正的正體中文提示。驗證斷線與非預期回應均不顯示原始例外。 依 Constitution II、FR-012（contradicts）
- [X] T051 CRITICAL 補齊 `tests/contract/classrooms.test.ts`、`tests/unit/classroom-store.test.ts`、`tests/unit/classroom-scope.test.ts` 及 `tests/contract/projection.test.ts` 的邊界驗證。確認教室名稱 1 字與 40 字可建立、同名教室獨立，以及錯誤輸入的正體中文提示與零異動。驗證可信世代復原、產碼避開教師密碼，以及重啟後舊組別投影碼遭拒且新碼仍可使用。 依 Constitution V、T004、T005、T013、T039（contradicts）
- [X] T052 補齊 `backend/src/classroom-store.ts` 的巢狀存檔形狀與關聯驗證，涵蓋來源欄位、題組與回合題目、審核補答及收件題號。新增可重跑案例，驗證外層有效而巢狀欄位損壞時保留原檔、顯示無法恢復且其他教室仍可使用。 依 FR-010、T006、US1/AC2（partial）
- [X] T053 在 `frontend/src/Projection.tsx` 為投影的後端訂閱加入符合長輪詢等待的明確失聯期限。教師端心跳只證明視窗仍存在，不得讓失聯的快照持續有效。全班與組別投影在請求無回應時應清除畫面並顯示重新開啟或重新輸入碼的指引。以可控制時間的測試驗證正常長輪詢與失聯路徑。 依 FR-008、T043（partial）
- [X] T054 在 `backend/src/app.ts` 及教師教室工作區提供歷史活動的唯讀成員查閱。由教師在已選教室查看上一場成員與當時的組別，資料以封存快照為準。新增跨角色、活動識別與不含加入碼的驗證。 依 T022（missing）
- [X] T055 在 `frontend/src/TeacherWorkspace.tsx` 顯示「開始新活動」的階段限制。收件中或待審核時，提示先結束或定案目前回合，並提供返回控制台的入口。驗證兩個階段均保留當前活動，完成定案後才可開始新活動。 依 US2/AC4、FR-003、T025（partial）
- [ ] T056 補齊 `specs/004-redesign-classroom-ui/validation-results.md` 的人工驗收。與教師、學生、投影三位試用者在實際區網裝置走完各角色路徑，依原計時方式記錄四種轉換各三次的結果，並記錄三位試用者辨識教室與回合狀態的結果。延用既有雙教室重啟實測證據。 依 SC-002、SC-004、T048（partial）
- [X] T057 在 `frontend/src/StudentRound.tsx` 作答畫面的逐題欄位之前顯示伺服器提供的題組名稱。在題組沒有名稱時以題號辨識。新增多小題案例，確認手機上同時保留題組名稱、各小題題號及完整題幹。 依 FR-009、US4/AC1、T037（partial）
