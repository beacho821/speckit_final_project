---
description: "調整教室操作流程的實作與驗收任務"
---

# 任務清單｜調整教室操作流程

**輸入**　[功能規格](spec.md)、[實作計畫](plan.md)、[研究](research.md)、[資料模型](data-model.md)、[HTTP 契約](contracts/http.md)、[介面契約](contracts/ui.md)、[快速驗收](quickstart.md)。

**格式**　每項提供任務編號及專案相對路徑。`[P]` 表示在明列的前置任務完成後可與其他標記任務並行。`[US1]` 至 `[US3]` 對應規格情境。各情境先擴充既有測試以覆蓋憲章要求的正常及邊界案例，確認變更前預期的失敗，再實作及重跑。

## 階段 1｜準備

- [X] T001 依 `package.json`、`.env.example` 和 `specs/005-refine-classroom-workflow/quickstart.md` 確認 Node.js 22.12 以上、測試教室及本機 HTTP 監聽環境，執行 `npm run typecheck` 與 `npm test` 建立基準。核對 `specs/002-classroom-workflow-fixes/references/mixed-questions.xlsx` 及 `single-questions.xlsx` 可供驗收。

## 階段 2｜共用基礎

- [X] T002 建立教師題目管理、學生逐題結果及回合編號的共用型別於 `shared/api.ts`。Round 新欄位按舊存檔相容性設為選用。題目管理包含來源、子題版本、已開放狀態、清單及下一題 ID，沒有待開放題時回傳空值。學生結果包含 questionNumber、partNumber、prompt、ownAnswer、correct、publishedAnswer，單題部分、未作答、無判定與無可用公布答案均可為空。 教師歷史摘要與逐題結果保留原欄位並加入正式題號，逐題加入可為空的部分序號。
- [X] T003 在 `tests/unit/classroom-store.test.ts` 與 `tests/integration/classroom-persistence.test.ts` 先定義測試，覆蓋舊 schema 1、明確空清單、無效引用隔離、開放轉待審核、題號重啟穩定與換場後完整沿用清單。
- [X] T004 在 `backend/src/activity.ts`、`backend/src/classroom-store.ts`、`backend/src/classrooms.ts` 初始化、驗證、儲存及還原清單與回合欄位。「每個 ID 須存在於題庫且只出現一次。已選學習單題目在前，手動題依新增次序排在後方」。「有效開放序列只含 `active`、`reviewing` 與 `ended`」。舊清單依已開放或已準備的學習單題及手動題推導，明確空清單保留。舊題號依活動內開放順序、舊題組依子題數及可辨識來源資料推導。新活動複製完整清單、題庫及來源並歸零開放進度，存檔失敗保留上次有效狀態。加入活動範圍內的執行期 catalogRevision，沿用既有原子存檔與隔離。通過 T003。

## 階段 3｜US1 從題目卡安排課堂出題（P1，MVP）

**目標**　完成匯入、選題、拖曳、編修、新增、刪除、開題與換場。

**獨立驗收**　先新增手動題，再首次匯入及選入兩張學習單題卡。拖曳對調後重新整理，控制台依新順序開放，手動題排第三。換場複用完整清單。確認重匯後清空舊題與清單，失敗則保留原資料。可用 HTTP 回合資料核對正式題號，再於 US3 驗收學生標籤。

### 測試

- [X] T005 [P] [US1] 在 `tests/contract/questions.test.ts`、`tests/contract/rounds.test.ts`、`tests/contract/classroom-activities.test.ts`、`tests/contract/views.test.ts` 改依新契約驗證無輸入題號的新增、必填／空白、同題去重、無效排列與空清單、版本衝突、刪除、原子開題、舊路徑無法跳題、已開題鎖定、換場及教師／學生視圖差異。涵蓋同時開題只成功一次、已開放手動題後再加入學習單仍保留原題號。 另在 `tests/integration/classroom-persistence.test.ts` 補測從舊存檔刪除準備題後重啟、開放下一題及存檔失敗保留原資料。在 `tests/contract/classroom-review-history.test.ts` 核對教師現有及封存歷史的正式題號，並驗證換場和重啟後仍維持。 將既有學生取得全班結果的斷言改為本組格式，原全班斷言改由教師驗證。
- [X] T006 [P] [US1] 在 `tests/contract/worksheet-import.test.ts`、`tests/contract/xlsx-import.test.ts`、`tests/integration/import-preview.test.ts`、`tests/integration/writeback-identity.test.ts` 驗證兩種來源的首匯、重匯、候選未發布、版本過期、錯誤零寫入、開題後拒絕，以及拖曳後依原始來源鍵回填。更新舊有「重匯保留手動題」及跨來源題號衝突的預期。 在 `tests/integration/privacy.test.ts` 驗證同一結果端點在待審核、跨活動或跨教室時拒絕學生，已公布時兩組各自只取得本組答案，教師仍取得原有全班資料。
- [X] T007 [P] [US1] 在 `tests/components/ManualQuestion.test.tsx`、`tests/components/ClassroomSettings.test.tsx`、`tests/components/TeacherConsole.test.tsx`、`tests/components/WorksheetImport.test.tsx` 驗證對話框必填、取消與焦點，題卡加入、移動、無效落點、刪除、原清單保留、重匯確認，以及控制台依最新清單顯示下一題並阻擋未儲存或待確認的操作。 在 `tests/components/TeacherRound.test.tsx` 或 `tests/components/TeacherConsole.test.tsx` 驗證教師歷史的標題與逐題部分序號，並在 `tests/components/StudentRound.test.tsx` 驗證既有學生歷史可讀取受限資料。

### 實作

- [X] T008 [US1] 在 `backend/src/questions.ts` 實作新增、編修、加入、排序及刪除規則。「每張卡的 `unitId` 在本活動內唯一，子題用既有 `questionKey` 編修」。「題幹及至少一個去除空白後有效的標準答案必填」。「排序輸入只包含恰好一份目前待開放、已加入的學習單 ID 排列」。「刪除限本活動未開放卡片，清單項目一同移除」。保留已開放卡的設定位置和手動題次序，沿用編修的收件／待審核限制，題目編修驗證 questionRevision 和 catalogRevision。每次成功異動推進教師版本，保留原始來源識別。 刪除時在同一次教室交易移除仍引用該卡的舊版未開放準備回合。存檔失敗須保留卡片、清單項目及準備回合。
- [X] T009 [P] [US1] 在 `backend/src/worksheet/import.ts` 實作兩種來源共用的發布規則。「已有學習單時需版本相符的取代確認」。「首次成功匯入保留手動題；重新匯入成功時清除該活動既有卡片、清單與未開放準備回合，再發布新來源的題卡」。候選選取仍是唯讀，保留來源內有效性檢查，成功發布才清除舊資料並推進版本。
- [X] T010 [US1] 在 `backend/src/rounds.ts` 依清單挑選下一題，鎖內核對版本、下一題、分組、題幹、標準答案及回合階段，一次完成開放與快照。「實際開放時以該活動開過的回合數加一，正整數且同活動連續唯一。準備回合尚無正式號碼」。「只有一個部分的顯式題組仍顯示『第 1 部分』」。保持來源鍵、送答公平等待、審核、公布及回填流程，拒絕舊準備／開始路徑跳過下一題。
- [X] T011 [US1] 在 `backend/src/views.ts` 提供教師題卡、已選順序、待開放題及 catalogRevision。匯入預覽卡片與統計以目前題庫計算，已刪題不出現在預覽；保留 `backend/src/worksheet/writeback.ts` 所需的來源填空定位。排定次序和教師標準答案限教師視圖。 由開放快照產生教師逐題結果的正式題號與部分序號，並在 `backend/src/classrooms.ts` 提供現有及封存回合摘要的正式題號。學生結果限於驗證組別與本組提交，以最終判定及公布補答或第一個可公布的標準答案呈現。
- [X] T012 [US1] 在 `backend/src/app.ts` 接上新增／更新／刪除題目、POST 與 PUT 清單、POST open-next 及相容舊路徑的版本檢查。Google 與 XLSX 依契約接受 X-Catalog-Revision 和重匯確認，開始讀檔及發布時都檢查活動、世代、版本、確認與未開放條件。保留 XLSX 10 MiB 限制及來源格式。以既有每教室交易寫入，拒絕請求保留資料並回傳正體中文原因。 同時依角色分流既有逐題結果端點。教師結果保留原欄位並提供正式題號，學生只取得已驗證組別的已公布資料。沿用未公布、跨範圍及憑證失效的拒絕規則，CSV 契約維持。
- [X] T013 [P] [US1] 在 `frontend/src/ManualQuestion.tsx` 實作新增題目的模態對話框及無題號輸入的送出資料，包含必填修正、取消、備援錯誤、避免重送與關閉後返回焦點。
- [X] T014 [P] [US1] 在 `frontend/src/WorksheetImport.tsx` 接入版本、重匯確認及候選選取。提示重匯會清除目前全部題目，包含手動題。取消、失敗或結果待確認時維持上次畫面，成功後請求教師視圖更新。
- [X] T015 [US1] 在 `frontend/src/TeacherRound.tsx` 與 `frontend/src/TeacherWorkspace.tsx` 串接題卡選取編修、加入、刪除確認、清單與下一題開放，移除獨立備課題目欄位。沿用儲存驗證保留同一教師分頁的草稿，且在待確認、匯入未完成、缺少分組、題幹或標準答案時禁止相依開放，提供回題目管理入口。 在 `frontend/src/RoundHistory.tsx` 以正式題號呈現教師歷史回合和逐題內容，並將現有學生歷史接到本組結果格式，使 MVP 期間原作答頁的歷史仍可使用。
- [X] T016 [US1] 在 `frontend/src/QuestionQueue.tsx`、`frontend/src/TeacherRound.tsx` 與 `frontend/src/styles.css` 對待開放學習單卡加入 Pointer Events 拖曳手把及可達同一結果的上移、下移按鈕。落點或取消無效時維持原順序，正確儲存後回報新位置並維持焦點。已開放卡與手動題維持既定規則，題組整卡移動。
- [X] T017 [US1] 通過 T005 至 T007 及 `tests/integration/xlsx-classroom.test.ts`、`tests/contract/writeback.test.ts`、`tests/contract/fair-submissions.test.ts` 的相關回歸。更新其開題夾具以明確排入清單及帶入版本，依 `specs/005-refine-classroom-workflow/quickstart.md` 第一、二節獨立驗收，涵蓋成功及拒絕時無錯誤寫入。 在交付前通過本組結果權限驗收及既有學生歷史的相容測試，並核對教師歷史在換場和重啟後的正式題號。

## 階段 4｜US2 用同一列導覽切換工作並開啟教室投影（P1）

**目標**　教師可從三個工作區開啟獨立的全班投影。

**獨立驗收**　核對三頁的導覽與投影連結，在兩間教室各開啟投影並送答。只更新對應教室，直接開啟無授權網址顯示指引，舊組別投影入口和授權失效。

### 測試

- [X] T018 [P] [US2] 在 `tests/contract/projection.test.ts` 與 `tests/contract/isolation.test.ts` 驗證全班投影可見欄位、雙教室隔離、角色及活動查驗、舊 API 回傳 404、舊投影憑證遭拒、學生加入碼照常使用。
- [X] T019 [P] [US2] 在 `tests/components/Projection.test.tsx` 與 `tests/components/Roster.test.tsx` 驗證三頁投影行為、正確來源和教室才可更新、同教室聚焦、新活動重新同步、登出與心跳失效，以及班級顯示不含組別產碼或輸碼。

### 實作

- [X] T020 [US2] 在 `backend/src/app.ts`、`backend/src/access.ts`、`backend/src/classrooms.ts`、`backend/src/activity.ts`、`backend/src/projection.ts` 與 `shared/api.ts` 移除組別投影端點、存取角色、產碼索引及版本分支，保留學生碼發放與撤銷。全班長輪詢沿用教師範圍，僅回傳教室名稱、階段、可見題目、組名、收件標記及定案摘要；保持等待、204 和跨教室拒絕。
- [X] T021 [P] [US2] 在 `frontend/src/Projection.tsx`、`frontend/src/App.tsx` 與 `frontend/src/Roster.tsx` 移除組別投影介面。沿用教師記憶體憑證與相符同源、來源視窗及教室的快照傳送；同教室重開復用視窗，換場重置快照與輪詢版本，切換所選教室不改變已開視窗所屬教室。失效、登出或心跳停止清除內容，保留舊網址的教師開啟指引。
- [X] T022 [US2] 在 `frontend/src/TeacherWorkspace.tsx` 與 `frontend/src/styles.css` 依序呈現分組管理、題目管理、老師控制台及目前頁，右側加入真實投影超連結，可由滑鼠或鍵盤開啟獨立視窗。移除活動準備側欄，將開始新活動及確認移至控制台，保留收件、審核及回填限制，確認說明清單會完整沿用。
- [X] T023 [US2] 通過 T018 至 T019 並更新 `tests/integration/classroom.test.ts` 的雙教室情境，依 `specs/005-refine-classroom-workflow/quickstart.md` 第三節從三頁各開啟一次及記錄兩間教室各三次投影更新的時間。

## 階段 5｜US3 在作答與歷史紀錄間切換（P1）

**目標**　學生在同一活動可自由切換作答與歷史，看到完整題號和本組公布結果。

**獨立驗收**　在 360 像素頁面輸入答案後切頁再返回，核對草稿與收件鎖定。驗收單題、兩部分題組，以及正確、錯誤及未作答。當回合待審核或活動不符時，角色視圖無該回合的公布答案。

### 測試

- [X] T024 [P] [US3] 在 `tests/unit/views.test.ts` 和 `tests/contract/views.test.ts` 驗證學生作答視圖的單題與題組正式編號，以及公布結果的補答優先與舊資料無正解。重跑 T006 的本組隔離案例。
- [X] T025 [P] [US3] 在 `tests/components/StudentRound.test.tsx` 與 `tests/components/App.test.tsx` 驗證預設作答、往返導覽與前後頁保留同回合草稿、新回合不搶跳、已收件唯讀、完整標籤、歷史載入／空白／重試與答對／答錯／未答版型。

### 實作

- [X] T026 [US3] 在 `backend/src/views.ts` 以開放回合快照向學生作答視圖提供正式題號及部分序號。沿用 T011、T012 的學生公布結果資料及角色限制。
- [X] T027 [P] [US3] 在 `frontend/src/RoundHistory.tsx` 將 T015 的本組結果檢視接到獨立歷史頁，提供載入、無紀錄及重試狀態，取消過期請求。題幹與完整題號為標題，顯示「已回答」及隔一空行的「正確」或「正確答案」，無資料適用「未作答」或「未提供」。保留教師歷史檢視。
- [X] T028 [US3] 在 `frontend/src/App.tsx`、`frontend/src/StudentRound.tsx` 與 `frontend/src/styles.css` 串接 /student 和 /student/history 及當前頁標示。同一活動保留同步、草稿及唯讀收件，使用回合範圍隔離草稿。由快照標示「第 N 題」及「第 N 題，第 M 部分」。確認 360 像素頁面與鍵盤操作，活動失效清理草稿。
- [X] T029 [US3] 通過 T024 至 T025 與 `tests/integration/reconnect.test.ts`、`tests/integration/sync.test.ts` 的回歸，依 `specs/005-refine-classroom-workflow/quickstart.md` 第四節獨立驗收單題、題組、三種結果、前後頁、收件與資料範圍。

## 階段 6｜整合與交付驗收

- [X] T030 [P] 核對 `README.md` 的正式操作入口，更新已失效的教室管理、組別投影、題號與備題步驟。保留環境變數及 Google 回填設定指引。
- [X] T031 [P] 依 `diagrams/005-component.puml`、`diagrams/005-class.puml`、`diagrams/005-sequence.puml` 逐一比對已實作的組件、回合資料及時序，確認三張 PNG 可由圖源重生並對得上實作。
- [X] T032 依 `package.json` 執行 `npm run typecheck`、`npm test` 及 `npm run build`。檢查其餘測試是否仍引用舊的手動題號、準備開題、匯入、學生全班結果或組別投影契約，按 `specs/005-refine-classroom-workflow/contracts/http.md` 調整過期夾具並重跑，保留既有公平等待、審核、CSV、教室隔離與回填覆蓋。
- [ ] T033 依 `specs/005-refine-classroom-workflow/quickstart.md` 完成實際瀏覽器及 SC-001 至 SC-004 驗收。以正體中文在 `specs/005-refine-classroom-workflow/validation-results.md` 記錄可重跑指令、各情境正常與邊界結果、試用人數、投影延遲及失敗或未執行情境與原因。必要驗收通過後交付。

## 依賴與執行順序

| 里程碑 | 前置 |
| --- | --- |
| 準備 | T001 |
| 共用基礎 | T001 → T002 → T003 → T004 |
| US1 | T004 → T005 至 T007 → 服務和端點 → 教師介面 → T017 |
| US2 | T004 → T018 至 T019 → 投影服務和介面 → T023。需要串接控制台新活動與出題清單時，以 T015 的工作區為基礎。 |
| US3 | T004 → T024 至 T025 → 結果服務和學生介面 → T029。T026 使用 T010 的正式題號。T027 使用 T011、T012 的本組結果及 T015 的歷史介面。T024 在 T005 的共用視圖測試完成後修改同一檔案，T025 在 T007 的學生作答測試完成後修改同一檔案。 |
| 整合 | T017、T023、T029 完成後執行 T030 至 T032，最後執行 T033。 |

共用檔案分批修改。教師題目及角色別結果路徑由 T012 先完成，再由 T020 移除組別投影。`TeacherWorkspace.tsx` 依 T015、T022 整合，`App.tsx` 依 T021、T028 整合。`styles.css` 依 T016、T022、T028 整合。各情境可依各自的資料夾具重跑驗收。

## 並行範例

- **US1**　T005、T006、T007 可同時改不同測試。共用型別及測試齊備後，T009 可和 T008 並行，T013 和 T014 可各自完成。
- **US2**　T018 與 T019 可同時補測。測試就緒且 US1 已完成相關共用檔案後，T020 後端和 T021 前端可並行。
- **US3**　T024 與 T025 可同時補測。T026 可與 T027 並行，T028 再整合學生導覽。
- **整合**　T030 操作文件與 T031 圖表一致性核對可並行。

## 交付策略

1. **MVP**　完成準備、共用基礎與 US1，交付題目卡、拖曳、手動題排尾、依序開題、教師歷史正式題號與重匯保護。交付前須通過 T017 的本組結果隔離驗收。
2. **增量交付**　加入 US2 全班投影，再整合 US3 的獨立學生歷史頁。所有情境均以自身驗收條件收斂。
3. **全功能驗收**　依規格走完雙教室、換場、舊存檔、學生隱私與計時案例，保留實際驗收結果。

## 需求對照

| 需求 | 任務 |
| --- | --- |
| FR-001 至 FR-003 | T018 至 T023 |
| FR-004 至 FR-007 | T003 至 T017 |
| FR-008、FR-010、FR-011 | T006、T011、T012、T015、T017、T024 至 T029；教師鍵盤及錯誤狀態涵蓋 T013 至 T016、T022 |
| FR-009 | T002 至 T005、T010 至 T012、T015、T017、T024 至 T029 |
| SC-001 至 SC-004 | T017、T023、T029、T033 |

T033 的自動測試和同機瀏覽器驗收已記錄於 [驗收紀錄](validation-results.md)。現場真人試用與獨立區網裝置複測仍待完成。

## Phase 7: Convergence

- [X] T034 CRITICAL 在 `frontend/src/RoundHistory.tsx` 將學生歷史載入時的連線、解析及非預期錯誤轉成正體中文並保留重試入口。沿用伺服器已提供的正體中文業務錯誤及授權失效流程。在 `tests/components/StudentRound.test.tsx` 模擬瀏覽器以英文錯誤拒絕 fetch、無效回應及重試成功，驗證只呈現正體中文提示。依憲章第二條、FR-011、T027 (contradicts)
- [X] T035 在 `frontend/src/TeacherRound.tsx`、`frontend/src/QuestionQueue.tsx` 及 `frontend/src/WorksheetImport.tsx`，將刪除確認、拖曳與重新匯入確認綁定操作開始時老師看到的題目管理版本。若操作期間收到新版，取消過期操作並顯示重新核對提示；若提交前發生競爭，由現有伺服器版本檢查拒絕。以 `tests/components/TeacherRound.test.tsx` 與 `tests/components/WorksheetImport.test.tsx` 驗證第二分頁更新順序或重匯相同來源識別後，舊操作不會覆蓋新版順序或刪除新題，且老師可依最新內容重新操作。依 FR-004、FR-005、US1/AC4、US1/AC7、US1/AC8、T016 (partial)
- [X] T036 在 `frontend/src/TeacherRound.tsx`、`frontend/src/TeacherWorkspace.tsx` 及 `frontend/src/useActivityView.ts` 將題目儲存或匯入結果待確認的開題鎖定，綁定偵測到不明結果後發起且成功完成的完整同步。在 `tests/components/TeacherConsole.test.tsx` 與 `tests/components/App.test.tsx` 模擬請求送出後舊快照先回覆、寫入回應遺失、新完整同步延遲，驗證期間不可開題，成功核對後才恢復。依 FR-006、T014、T015 (partial)
- [X] T037 在 `backend/src/rounds.ts` 與 `frontend/src/StudentRound.tsx` 讓空白作答及漏答的可見錯誤使用正式題號與部分序號，保留供傳輸及判分的題目識別欄位。在 `tests/contract/question-queue.test.ts` 及 `tests/components/StudentRound.test.tsx` 驗證手動單題顯示「第 N 題」、題組顯示「第 N 題，第 M 部分」，錯誤提交未收件且保留草稿。依 FR-009、FR-011、US3/AC2 (partial)
