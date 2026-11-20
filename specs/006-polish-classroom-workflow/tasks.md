---
description: "改善教室操作與活動結算的實作與驗收任務"
---

# 任務清單｜改善教室操作與活動結算

**設計依據**　[規格](spec.md)、[實作計畫](plan.md)、[研究](research.md)、[資料模型](data-model.md)、[HTTP 契約](contracts/http.md)、[介面契約](contracts/ui.md)、[快速驗收](quickstart.md)。

**格式**　`[P]` 表示前置就緒後可與同階段的獨立檔案工作並行。`[US1]` 至 `[US4]` 對應規格的四個使用情境。路徑皆相對於專案根目錄。各情境先新增或調整憲章要求的正常及邊界測試，確認新增行為在實作前出現預期失敗，既有契約的回歸案例應繼續通過。

## 階段 1｜準備

- [X] T001 依 `package.json`、`.env.example` 及 `specs/006-polish-classroom-workflow/quickstart.md` 確認 Node.js 22.12 以上、測試用教師設定及本機暫用連接埠。執行 `npm run typecheck` 與 `npm test` 建立基準，與規劃時 55 檔、179 項對照。
- [X] T002 依 `specs/006-polish-classroom-workflow/quickstart.md` 準備兩間可區分的測試教室、兩部分題組、手動題及正誤結果。核對 `specs/002-classroom-workflow-fixes/references/mixed-questions.xlsx` 和 `tests/helpers/worksheet.ts` 可用於本機匯入及 Google 回填替身。記錄是否已有 Google 試算表測試副本及編輯權限，供 T026 安排實際回填驗收。

## 階段 2｜共用基礎

- [X] T003 在 `tests/helpers/ui.tsx` 讓共用測試操作能以可辨識名稱定位原生按鈕，包括純圖示按鈕，並保留舊有可見文字定位。沿用目前的對話框與焦點測試支援，供教師工作區和題卡測試使用。

## 階段 3｜US1 登入後管理分組並穩定投影（P1，MVP）

**目標**　從教室列表進入分組管理。投影在等待、網路中斷、來源失效與登出時呈現對應狀態。

**獨立驗收**　兩間教室各由三個工作區開啟投影，切頁及投影重新整理後仍顯示正確教室。有離線和恢復通知的 5 秒中斷會保留畫面，服務可存取時從恢復通知起 10 秒內更新。無通知且原請求無回應時，另驗服務在逾時前已恢復可存取，從偵測逾時起 10 秒內更新。持續中斷時在偵測後第 10 秒清除內容並繼續重連。登出時立即清除。

### 測試

- [X] T004 [P] [US1] 在 `tests/components/App.test.tsx`、`tests/components/ClassroomList.test.tsx`、`tests/components/ClassroomSettings.test.tsx` 驗證新建／恢復主持都先進分組管理、題目與控制台明確網址可用、導覽標示目前工作區，以及三區開啟投影與視窗阻擋提示。更新匯入情境，進教室後先明確切到題目管理再操作。
- [X] T005 [P] [US1] 擴充 `tests/components/Projection.test.tsx`，以假時計及視窗訊息替身驗證初載、重新整理握手、正常 `204`、有通知的 5 秒斷線、無通知且請求在 25 秒無回應的重連、兩種情境各自的 10 秒更新起點、9,999 毫秒保留及 10,000 毫秒清除、同版完整重連、心跳不延長期限、錯誤來源／教室／訊息格式遭忽略、登出即時清除、來源失效需重開及未登入直開。將「逾時停止輪詢」改為逾時後繼續重連。
- [X] T006 [P] [US1] 在 `tests/contract/projection.test.ts`、`tests/integration/classroom.test.ts` 驗證既有輪詢的無更新、同一教室活動換代後完整讀取、未授權及跨教室拒絕。核對公布前答案、學生個資、加入碼與教師操作不出現在投影回應。

### 實作

- [X] T007 [P] [US1] 在 `frontend/src/Projection.tsx` 讓原教師頁的投影傳輸沿用已認證的 HTTP 輪詢與教室位置查詢，先驗證教室及活動範圍。保留 20 秒輪詢等待及 25 秒單次請求期限，失敗採可取消且間隔最多 4 秒的重試，同教室只保留一筆請求。偵測離線即進入重連。遇恢復連線通知立即取消舊請求與退避、讀取完整快照。無通知且請求無回應時，於單次期限偵測逾時並重連。正常 `204` 維持畫面。收到 `409 ACTIVITY_EXPIRED` 時查同一教室，確認換代後清除舊場內容，確認失去授權時停止更新。
- [X] T008 [US1] 在 `frontend/src/Projection.tsx` 串接投影就緒與教師回送狀態，核對精確同源、來源視窗、`roomId`、登記及訊息結構。狀態採「等待、正常顯示、重連、需重新開啟或未授權」。實作「首次偵測到該次中斷時設定。截止時間為偵測時間加 10 秒。重試與心跳共用同一截止時間。」只傳公開快照，重掛載或恢復可見時核對截止時間。收到登出或確認撤權立即清除，來源不可用時提供重開指引。
- [X] T009 [P] [US1] 在 `frontend/src/TeacherWorkspace.tsx` 將教室列表共同入口導向 `/teacher/classrooms/:id/groups`。保留題目管理、控制台和投影原網址及目前頁標示，登入後仍先選教室。核對 `frontend/src/ClassroomList.tsx` 的新建及恢復主持回呼都使用共同入口。
- [X] T010 [US1] 執行 T004 至 T006 對應測試，依 `specs/006-polish-classroom-workflow/quickstart.md` 第一節重跑六次開啟、切頁及重整，記錄有通知與無通知中斷的兩種計時起點、超時清除、撤權與恢復所見內容及耗時。

## 階段 4｜US2 快速編修與排列出題卡（P1）

**目標**　以圖示編修與刪除，整卡確認儲存後退出編修，並顯示可驗證的拖曳預覽和落點。

**獨立驗收**　準備三張可排序學習單題卡，含兩部分題組，另準備手動題與已開放題。驗證題組整卡儲存與失敗零部分寫入，滑鼠、觸控及鍵盤排序可持久化，取消、無效落點與版本過期保留有效順序。

### 測試

- [X] T011 [P] [US2] 在 `tests/contract/questions.test.ts` 補整卡 PATCH 的單題與題組成功、只增一次目錄版本，以及重複／遺漏／外來部分、過期版本、空白欄位、已開放、收件／審核中及學生越權。第二部分無效時讀回所有部分及版本，驗證皆未變更。在 `tests/contract/question-queue.test.ts` 核對合法排序、無效排列拒絕後順序維持，以及刪除後題卡及清單項目同時消失。保留 `tests/contract/xlsx-import.test.ts` 舊單部分 PATCH 的逐步補齊流程。
- [X] T012 [P] [US2] 在 `tests/integration/classroom-persistence.test.ts` 驗證整卡修改重啟後完整恢復、存檔失敗回傳 `503` 且所有部分及版本維持、並行開題或改題只有與目前版本相符的交易成功。
- [X] T013 [P] [US2] 在 `tests/components/TeacherRound.test.tsx`、`tests/components/TeacherConsole.test.tsx` 驗證鉛筆及垃圾桶的可辨識名稱、整卡成功後立即顯示新內容並恢復焦點、拒絕時保留草稿、回應遺失時依送出後同一題卡的完整資料判定相符則退出或不同則保留草稿，核對兩種結果都不自動重送。另驗證跨頁開題／換來源後仍可核對草稿。保留刪除確認測試，另補拖曳預覽與落點、上下箭頭操作、指標取消／失去擷取、清單版本改變及只有一張可排序卡。

### 實作

- [X] T014 [P] [US2] 在 `shared/api.ts` 定義整卡儲存請求與回應型別，沿用 `CatalogUnit`、`RoundQuestion` 及活動範圍欄位。依 `specs/006-polish-classroom-workflow/contracts/http.md` 定義 `catalogRevision`、`questions[]`、各部分識別與版本、題幹、標準答案及 `{ unit, catalogRevision }` 回應。
- [X] T015 [US2] 在 `backend/src/questions.ts` 實作整卡更新。「整卡儲存檢查題卡存在、未開放且目前無收件中或待審核回合」及「各部分的識別集合須完整且不重複」。核對安全整數版本與目前版本，題幹使用既有驗證，答案修剪及略過空行後至少一個。保留可預覽的不完整匯入題卡，儲存時補齊各部分。落實「整卡驗證須先於任何變更。只更新實際修改的部分版本，並對整張卡的有效變更增加一次目錄版本」，沿用部分順序、題號和來源填空識別。
- [X] T016 [US2] 在 `backend/src/app.ts` 接上 `PATCH /api/questions/units/:unitId`，由 `backend/src/classrooms.ts` 的現有教室交易核對教師及目前活動，一次存檔後回傳保存內容。沿用 `409`、`422` 和 `503` 的正體中文修正指引，保留舊單部分 PATCH、整卡 DELETE、排序 PUT 及 `backend/src/question-queue.ts` 的開題順序檢查。
- [X] T017 [P] [US2] 在 `frontend/src/QuestionQueue.tsx` 與 `frontend/src/styles.css` 加入頂端長條把手、不攔截指標的題卡預覽、共用落點的插入線及可單點與鍵盤操作的上下箭頭。落實「可排序集合是已進入清單且尚未開放的學習單題卡」及「排序請求只提交該集合的一組完整排列，依同一次操作的 `catalogRevision` 驗證」。遵守「取消、失去指標擷取、離開有效區或版本失效時移除預覽。排序成功後才更新顯示的順序。」保留把手外捲動、手動題及已開放題規則。
- [X] T018 [US2] 在 `frontend/src/TeacherRound.tsx` 依教室活動、題卡和各部分管理草稿，保留編修起始版本。「版本衝突時保留草稿，與最新題卡核對後才更新提交基準。失效草稿只供核對。」單題及題組共用一個「儲存修改」，採用成功回應立即退出編修，後續同步維持最新版本。儲存回應未送達時先保留輸入、阻擋相依開題並取得送出後的新完整教師檢視。核對教室活動、題卡及各部分識別，並依伺服器規則比較題幹和標準答案。完全相符時使用最新已存資料退出編修。有差異或識別失效時保留草稿並提示核對，不自動重送。並行開題或換來源時提供可讀草稿與明確指引。
- [X] T019 [US2] 在 `frontend/src/TeacherRound.tsx`、`frontend/src/styles.css` 改用有正體中文可辨識名稱的鉛筆及紅色垃圾桶按鈕。保留刪除確認與既有權限，驗證取消及儲存成功後焦點回到原入口，成功移除後焦點落在可繼續操作的位置。接上 T017 的排序與同步回報。
- [ ] T020 [US2] 執行 T011 至 T013 對應測試及 `tests/contract/xlsx-import.test.ts`，依 `specs/006-polish-classroom-workflow/quickstart.md` 第二節驗證整卡儲存、確認刪除／取消、滑鼠與真實觸控落點、鍵盤、拒絕時資料維持及重整後的有效順序。另實測儲存回應遺失後重新讀到相符及不同內容的結果。記錄 SC-002 三位教師的結果與耗時。

## 階段 5｜US3 在老師控制台進入活動結算（P1）

**目標**　控制台由老師主動開啟結算後才顯示回填、匯出及開始新活動。

**獨立驗收**　分別在收件中、待審核、已定案、尚未開題時測試入口。驗證只有合法結算可顯示工具，離開或取消保留同場，確認成功才保存舊紀錄並回到新場主持。

### 測試

- [X] T021 [P] [US3] 在 `tests/contract/classroom-activities.test.ts`、`tests/contract/writeback.test.ts`、`tests/contract/results-csv.test.ts`、`tests/integration/writeback-identity.test.ts` 核對既有活動範圍、回填互斥、已公布結果篩選、CSV 空狀態及歷史封存，補測未覆蓋的並行換場拒絕與舊場資料維持。
- [X] T022 [P] [US3] 在 `tests/components/ClassroomSettings.test.tsx`、`tests/components/useActivityView.test.tsx` 測試結算外隱藏工具、主動進入、四種回合狀態、無定案及不支援回填、回填中禁止切換、返回與確認／取消、其他頁開題及換場、換場回應遺失後核對及認證錯誤。以投影導覽已更新的測試為基礎，驗證結算結束焦點及舊場不被誤操作。

### 實作

- [X] T023 [P] [US3] 在 `frontend/src/useActivityView.ts` 區分認證失敗、活動範圍失效與暫時同步錯誤，讓教師結算可停止舊場操作並重新定位教室。遵守「舊範圍的請求須重新取得教室位置」，保留既有學生失效處理及完整更新語意。
- [X] T024 [P] [US3] 在 `frontend/src/TeacherResults.tsx` 依 `closedRoundIds` 及來源呈現可回填、可匯出或空狀態，沿用既有 Google 回填及 CSV。將同頁回填中狀態回報控制台，保留衝突、結果待確認及不支援回填的正體中文指引。
- [X] T025 [US3] 在 `frontend/src/TeacherWorkspace.tsx` 依 `classroomId`、`activityId`、`activityEpoch` 管理結算和開始新活動對話框。「根據同步中的 `ActivityView.phase`、`closedRoundIds`、學習單來源、`writebackInProgress` 及本頁請求狀態判斷可用操作。」主動進入才顯示工具，收件／審核、活動未確認或過期時停用並提示。跨頁開題、活動換代或離開控制台時收起。返回主持保留同場，換場確認時沿用伺服器交易、匯入及回填限制，結果不明先重新定位而不重送。成功後回到新場主持並關閉結算。
- [X] T026 [US3] 執行 T021、T022 對應測試，依 `specs/006-polish-classroom-workflow/quickstart.md` 第三節核對四種階段、替身回填流程與錯誤、有編輯權的 Google 試算表測試副本實際儲存格更新、無 Google 原稿匯出、空狀態、回填佔用、取消和確認切換，以及舊紀錄、清單、分組及加入碼。

## 階段 6｜US4 學生辨識已公布的逐題判定（P2）

**目標**　用可見文字和顏色區分已作答且定案正誤，保留未作答與舊紀錄的可公開資訊。

**獨立驗收**　在 360 像素畫面查閱答對、答錯、未作答及判定缺值四筆結果，確認灰階仍可分辨。公布前讀不到正解或判定，公布後只能看到本組當場資料。

### 測試

- [X] T027 [P] [US4] 在 `tests/components/StudentRound.test.tsx` 加入學生歷史四態、題組各部分和無公布正解的案例。斷言綠色「正確」、紅色「錯誤」及正解文字，中性呈現未作答及缺值，維持既有標題與可讀判定。
- [X] T028 [P] [US4] 在 `tests/integration/privacy.test.ts`、`tests/contract/views.test.ts` 回歸 `GET /api/rounds/:id/results` 的公布前拒絕、本組隔離及教師可讀既有全班結果，確認舊資料缺判定或正解時欄位依原契約為空。

### 實作

- [X] T029 [US4] 在 `frontend/src/RoundHistory.tsx`、`frontend/src/styles.css` 依 `shared/api.ts` 的 `StudentRoundResultLine` 顯示結果，包含「可為空的 `partNumber`」及「缺少本組答案或已定案判定時保留原有中性色和可公布資訊」。有答案且 `correct === true` 顯示綠色「正確」，有答案且 `correct === false` 顯示紅色「錯誤」及可公布正解。題組逐部分顯示，維持本組的已公布資料邊界。
- [ ] T030 [US4] 執行 T027、T028 對應測試，依 `specs/006-polish-classroom-workflow/quickstart.md` 第四節核對 360 像素畫面、灰階三位試用者和公布前讀取拒絕。記錄四態及本組隔離結果。

## 階段 7｜整合與交付驗收

- [X] T031 [P] 更新 `README.md` 的課堂操作步驟，反映分組預設頁、整卡儲存、拖曳和控制台結算入口，保留環境及 Google 回填設定說明。
- [X] T032 [P] 對照 `diagrams/006-component.puml`、`diagrams/006-class.puml` 與 `diagrams/006-sequence.puml`，核對已實作的元件、資料關係、投影重連、儲存和結算時序。以 PlantUML CLI 確認三張 PNG 可從圖源產生。
- [X] T033 依 `package.json` 執行 `npm run typecheck`、`npm test` 與 `npm run build`，依 `specs/006-polish-classroom-workflow/contracts/http.md` 核對既有匯入、首次送答、公平等待、活動切換、封存、CSV、回填及隔離契約。
- [ ] T034 依 `specs/006-polish-classroom-workflow/quickstart.md` 整理 SC-001 至 SC-004 的實際驗收，在 `specs/006-polish-classroom-workflow/validation-results.md` 記錄可重跑指令、正常與邊界結果、試用者人數及耗時，並標明失敗或未執行項目與原因。若缺少 Google 測試副本或權限，SC-003 的實際回填記為未驗收。必要驗收通過後才能列為完成。

## 依賴與執行順序

| 里程碑 | 依賴 |
| --- | --- |
| 準備與共用基礎 | T001 → T002 → T003 |
| US1 | T003 → T004／T005／T006 → T007／T009。T007 → T008，T008、T009 → T010。 |
| US2 | T003 → T011／T012／T013 → T014／T017。T014 → T015 → T016 → T018。T017、T018 → T019 → T020。 |
| US3 | T003 → T021／T022 → T023／T024。T022 接在 T004 對共用測試的修改之後。T025 必須等 T009、T023、T024，再執行 T026。 |
| US4 | T003 → T027／T028 → T029 → T030。T029 接在 T019 的共用樣式變更後。 |
| 整合驗收 | T010、T020、T026、T030 → T031／T032 及 T033 → T034。 |

箭頭列出所需前置，斜線表示同一批可並行工作。各情境能使用各自的測試資料取得驗收結果。教師工作區、共用測試及樣式表的先後順序用於避免同檔案衝突。

## 並行執行範例

- **US1**　T004 導覽測試、T005 假時計測試、T006 HTTP 測試平行。測試就緒後，T007 投影傳輸與 T009 教師入口平行，再接續 T008 投影接收端。
- **US2**　T011 契約、T012 存檔及 T013 元件測試平行。接著 T014 共用型別與 T017 排序介面平行，兩條路最後整合到題卡操作。
- **US3**　T021 HTTP 測試可與 T022 控制台測試平行。測試就緒後，T023 同步狀態與 T024 結算結果平行，再由 T025 串接。
- **US4**　T027 學生結果呈現與 T028 資料範圍測試平行，T029 隨後套用判定與顏色。

## 交付策略

1. 先完成準備與基礎、US1 和投影獨立驗收。MVP 包含分組預設頁與投影開啟、重連、10 秒保留上限及登出清除。
2. 接續 US2 題卡操作及 US3 結算，再加入 US4 學生判定。各階段以該情境的正常、失敗與邊界結果驗證完成。
3. 四個情境完成後統一執行全套回歸、圖表核對及 SC-001 至 SC-004，保存實際結果。

## 需求對照

| 規格 | 任務 |
| --- | --- |
| FR-001 | T004、T009、T010 |
| FR-002、FR-003、SC-001 | T004 至 T008、T010 |
| FR-004 | T011 至 T016、T018、T020 |
| FR-005 | T011、T013、T016、T019、T020 |
| FR-006、SC-002 | T011、T013、T017、T019、T020 |
| FR-007、SC-004 | T027 至 T030 |
| FR-008、FR-009、SC-003 | T021 至 T026 |

## Phase 8: Convergence

- [X] T035 在 `frontend/src/TeacherWorkspace.tsx` 與 `frontend/src/TeacherResults.tsx` 讓同一活動尚未回覆的回填請求跨結算檢視保有單一進行中狀態。在 `tests/components/ClassroomSettings.test.tsx` 延遲回填回應，驗證返回主持再進結算後仍禁止重送及換場，且離開活動後的遲到回應不影響目前畫面。對應 F1、FR-009、T024、T025（partial）
- [X] T036 依 `backend/src/config.ts` 驗證 `GOOGLE_SERVICE_ACCOUNT_JSON` 指向程序可讀取的服務帳戶 JSON，核對使用者已提供的試算表測試副本授權。依 `specs/006-polish-classroom-workflow/quickstart.md` 使用隔離教室走結算回填一次，讀回單一目標儲存格比對定案答案，再將結果記錄於 `specs/006-polish-classroom-workflow/validation-results.md`。設定或權限仍有問題時記錄實際錯誤，不揭露金鑰。對應 F3、SC-003、T026（partial）
- [X] T037 依 `specs/006-polish-classroom-workflow/quickstart.md` 補驗第二間教室從三個教師工作區開啟投影、切頁及重整。用實際瀏覽器記錄有恢復通知與無通知逾時兩種重連起點及 10 秒邊界，核對教室隔離、逾時繼續重連及撤權，更新 `specs/006-polish-classroom-workflow/validation-results.md`。對應 F4、SC-001、T010（partial）
- [X] T038 在 `frontend/src/Projection.tsx` 補上首次成功顯示後的來源失聯處理。原教師分頁視窗仍存在但通訊已中斷時，避免無期限顯示最後畫面，確認來源不可用後清除內容並提示從教室導覽重新開啟。在 `tests/components/Projection.test.tsx` 驗證來源失聯、短暫漏心跳後恢復，以及登入撤銷仍立即清除。對應 F2、FR-002、FR-003、T008（partial）
- [ ] T039 依 `specs/006-polish-classroom-workflow/quickstart.md` 用可操作的測試學習單完成真實觸控排序，安排三位教師各在 90 秒內完成整卡儲存、指出拖曳落點及取消刪除，將裝置、耗時及成功與邊界結果寫入 `specs/006-polish-classroom-workflow/validation-results.md`。對應 F5、SC-002、T020（partial）
- [ ] T040 依 `specs/006-polish-classroom-workflow/quickstart.md` 用 360 像素寬畫面核對四種公布判定，請三位學生在灰階辨認答對、答錯及未作答，將試用與公布前權限驗證結果寫入 `specs/006-polish-classroom-workflow/validation-results.md`。對應 F6、SC-004、T030（partial）
