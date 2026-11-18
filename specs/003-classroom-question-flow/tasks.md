---
description: "搶答題目顯示、手動出題與老師補答的實作任務"
---

# 任務｜搶答題目顯示、手動出題與老師補答

**設計輸入**　[規格](spec.md)、[計畫](plan.md)、[研究](research.md)、[資料模型](data-model.md)、[HTTP 契約](contracts/http.md)、[介面與匯出契約](contracts/ui-and-exports.md)、[驗收指南](quickstart.md)

**測試要求**　FR-010 與憲章要求每項功能有正常及邊界案例。先補各情境的測試，再實作對應行為。預期拒絕時同時驗證正體中文錯誤、修正方式及零資料變更。

## 格式與路徑

每項任務使用 `- [ ] Tnnn [P?] [USn?] 描述及檔案路徑`。路徑相對於專案根目錄。`[P]` 表示前置任務滿足後，可與同批、使用不同檔案的任務並行。

## 階段 1｜準備

- [X] T001 依 `package.json` 確認 Node.js ≥ 22.12、依賴、可用本機監聽及 `npm run typecheck` 基準，將指令、結果與阻礙記入 `specs/003-classroom-question-flow/quickstart.md` 的完成記錄。
- [X] T002 在 `tests/contract/worksheet-import.test.ts` 將既有固定等待改為明確的時序控制。等待伺服器確認舊匯入已進入讀取，再送出並確認新匯入，最後放行舊匯入。用可區分的來源驗證新匯入 200、舊匯入 409 且新來源維持有效。

## 階段 2｜共同基礎

- [X] T003 在 `shared/api.ts` 定義題目、單位、來源、教師及學生視圖、判分草稿與公開結果型別，保留 `questionIds` 和既有公開欄位，新增 `reviewing`。依資料模型落實「每單位至少一題。手動單位只有一題。每單位至多一個已開始的回合。」以及「缺題幹的匯入題將 `prompt` 設為空值」。
- [X] T004 在 `backend/src/activity.ts` 與 `backend/src/questions.ts` 建立活動題庫、題目鍵、單位查找、原稿填空引用和空活動初始化。沿用既有角色版本與鎖，遵守「記憶體隨程序重啟重建。名單及匯入鎖定沿用首回合成功開題的時點。」以及「活動題目鍵在來源替換時更新，與原稿填空身分分離。」
- [X] T005 在 `backend/src/rounds.ts` 將選題和作答欄解析接到活動題庫，保留學生提交合約與公平等待入口。遵守「每組每回合一筆，必須答完所有子題。沿用等待與接受順序。」選題拒絕已使用單位及目前有進行中或待確認判分的回合。

## 階段 3｜US1 匯入並呈現完整題幹（P1）

**目標**　XLSX 與 Google 匯入的完整題號和題幹維持原對應，老師可補缺題幹、設定標準答案，學生開題後即可讀題。

**獨立驗收**　匯入兩份原始 XLSX、欄列移動副本及模擬 Google 來源。核對單題、各子題、合併共用題幹與換行。缺題幹或缺標準答案時核對拒絕原因及回合未開始，補齊後從師生畫面驗證同一題幹。此情境可在停止收件前完成。

### 測試

- [X] T006 [P] [US1] 在 `tests/unit/worksheet-parser.test.ts` 與 `tests/fixtures/xlsx-variants.ts` 以 002 原始單題、混合題及其欄列移動副本驗證題幹對應，加入跨列題組共用、欄位重疊、缺文字、僅題號及題幹形似填空標記的案例。
- [X] T007 [P] [US1] 在 `tests/contract/worksheet-import.test.ts`、`tests/contract/xlsx-import.test.ts` 與 `tests/integration/import-preview.test.ts` 驗證候選工作表、預覽計數與有序題幹、Google 與 XLSX 等價、缺題幹可預覽、題目編輯版本過期拒絕，以及無效匯入保留原來源與選題。在 `tests/contract/xlsx-import.test.ts` 先驗證單題答案全空及題組缺一個子題答案均拒絕開題，回應含缺漏的完整題號，維持準備並保留已填資料。補齊後可開題。
- [X] T008 [P] [US1] 在 `tests/components/WorksheetImport.test.tsx`、`tests/components/TeacherRound.test.tsx` 與 `tests/components/StudentRound.test.tsx` 驗證預覽、缺漏提示、每題欄位標籤、未存草稿、教師端題幹，以及學生開題前與開題後的題幹差異。

### 實作

- [X] T009 [P] [US1] 在 `backend/src/worksheet/identify.ts` 依表頭辨識題目欄，共用 Google 和 XLSX 路徑。落實「題幹保留原可見文字及換行。」與「共用題幹只取同一題組中明確由題幹合併範圍覆蓋的子題。」排除題號、作答格和身分標記來源。無法辨識時保留原匯入及回填定位。
- [X] T010 [P] [US1] 在 `frontend/src/WorksheetImport.tsx` 依合約呈現題號、題幹和「缺少題目」，保留候選工作表、匯入待確認與現有操作鎖定。
- [X] T011 [US1] 在 `backend/src/worksheet/import.ts` 將解析題目一次提交到題庫，換發匯入題目鍵，保留手動題與既有組別，成功時清除準備回合。遵守「匯入只在既有驗證及活動世代檢查通過後提交。」
- [X] T012 [US1] 在 `backend/src/questions.ts` 以題目鍵和版本維護未開過題目的題幹及標準答案，整筆驗證，空白答案草稿可儲存，拒絕過期版本、已移除題目與不允許的回合階段。遵守「工作台編輯題幹、標準答案或手動新增題目只改活動題庫。」及「判定題號佔位時忽略頭尾空白與題號後單個句點（如「1.」），並以完整題號核對。」
- [X] T013 [US1] 在 `backend/src/rounds.ts` 開題前核對每子題題幹及標準答案，依契約回傳各自缺漏題號且維持準備。遵守「未成功開題的回合沿用可編輯題庫。」以及「固定題目副本及名單。」採用模型的「備課可暫缺，開題時每題至少一種。拆分 LF、CRLF 或 CR，略過空白行。」標準答案存入開題快照後固定。
- [X] T014 [US1] 在 `backend/src/app.ts`、`backend/src/views.ts` 沿用 `backend/src/access.ts` 的授權並串接原匯入入口、教師題目 PATCH、開題驗證及角色投影。成功預覽回應與輪詢共用映射。學生準備時只取題號，開題後可取題幹，標準答案與私有題庫屬性以許可欄位投影排除。
- [X] T015 [US1] 在 `frontend/src/TeacherRound.tsx`、`frontend/src/StudentRound.tsx`、`frontend/src/styles.css` 顯示題幹、選題預覽及老師的個別題幹和多行標準答案輸入。保留驗證失敗及未儲存輸入，支援換行、相符的表單標籤與開題後的學生作答欄。

## 階段 4｜US2 手動新增單題（P1）

**目標**　空活動與混合活動可手動加題，來源更換和題號衝突有一致處理。

**獨立驗收**　分別在空活動及已有匯入題的活動新增、選取及準備一個手動單題，設定標準答案後開題送答。重複、空白及目前不可修改時，題庫不變。回合公布、CSV 及混合回填由 US3 的整合案例完成。

### 測試

- [X] T016 [P] [US2] 在 `tests/contract/questions.test.ts` 驗證純手動與混合活動新增、學生越權、空白或僅題號題幹、修剪後重複、進行中和待確認判分的拒絕，以及混合來源重新匯入時保留手動題或整批拒絕。
- [X] T017 [P] [US2] 在 `tests/components/ManualQuestion.test.tsx` 驗證欄位標籤、送出失敗保留輸入、成功清空表單、更新可選單位與階段限制。

### 實作

- [X] T018 [US2] 在 `backend/src/questions.ts` 實作手動單題新增，遵守「完整題號去除頭尾空白後在活動內唯一。」以及「手動題不可空白或僅重複題號。」手動題沒有原稿填空對應，拒絕重複與不允許的回合階段。在 `backend/src/worksheet/import.ts` 落實「提交前再次檢查目前手動題的完整題號，成功才替換來源及其匯入題、清除準備回合並保留手動題及名單。」
- [X] T019 [US2] 在 `backend/src/app.ts`、`backend/src/views.ts` 接上教師專用 `POST /api/questions`、201 回應、422 欄位錯誤及 409 衝突，讓手動題與匯入題在同一清單可選。純手動活動用正常的準備與開題入口。
- [X] T020 [US2] 在 `frontend/src/ManualQuestion.tsx`、`frontend/src/TeacherRound.tsx` 新增題號與題幹表單，接上既有教師狀態更新及錯誤處理。處理空題庫、混合題庫、進行中與待確認判分狀態。失去回應先讀完整活動視圖確認新增結果。

## 階段 5｜US3 自動判分、老師更正、補答及匯出（P1）

**目標**　在收件後依固定標準自動判分，老師可更正及補答，將相同結果用於勝組、公平等待、雙方歷史、CSV 及 Google 原稿。

**獨立驗收**　以已備好題目與標準答案的測試活動，驗證多種答案、先錯後對、全錯、無人送出、部分子題無正解、各組分別答對不同子題、雙向改判、空白補答、重試、重連、CSV 及回填。此階段可用既有模擬匯入來源和題庫夾具驗證判分核心。

### 測試

- [X] T021 [P] [US3] 在 `tests/unit/rounds.test.ts`、`tests/unit/fairness.test.ts` 與 `tests/contract/fair-submissions.test.ts` 驗證多行任一相符、區分大小寫及保留原文，收件先後、全部答對才勝出、第二順位可勝及 2,999／3,000 毫秒等待邊界。
- [X] T022 [P] [US3] 在 `tests/contract/rounds.test.ts`、`tests/contract/views.test.ts`、`tests/contract/isolation.test.ts`、`tests/integration/privacy.test.ts`、`tests/integration/sync.test.ts`、`tests/integration/reconnect.test.ts` 驗證停止收件、自動判分、雙向更正、草稿過期、公布冪等、學生拒絕異動及各階段資料隔離。在 `tests/integration/sync.test.ts` 從伺服器接受操作起，分別斷言停止收件與公布的可見變更在 1 秒內抵達老師及有權查看的學生。教師私有變更不喚醒學生，已儲存草稿與學生收件可恢復。
- [X] T023 [P] [US3] 在 `tests/contract/results-csv.test.ts`、`tests/integration/results.test.ts`、`tests/contract/writeback.test.ts`、`tests/integration/writeback-identity.test.ts` 驗證公布前匯出限制、純手動 CSV、老師補答唯一列、正誤欄及含引號逗號換行的原文。用 Google 模擬驗證第二順位勝組、無勝組、排除手動題與老師補答、衝突零寫入及重讀確認。
- [X] T024 [P] [US3] 在 `tests/components/RoundReview.test.tsx` 驗證自動正誤、改判、補答欄出現與解除、缺補答提示、草稿版本衝突及已公布歷史。

### 實作

- [X] T025 [US3] 在 `backend/src/rounds.ts` 實作停止收件後進入 `reviewing`，保留原文與順位。遵守「只有當前回合可收件、停止收件及儲存草稿。」和「比對完整學生答案的去頭尾空白值，使用區分大小寫的逐字等值比對。原始送答不變。」停收後的提交回 409。
- [X] T026 [US3] 在 `backend/src/rounds.ts` 實作原子複核與公布，依 `overrideCorrect ?? autoCorrect` 取最終正誤。遵守「待確認判分時，老師只可改已有收件的組別與對應完整題號。保留原文及順位。」及「對某題存在最終答對紀錄時移除該題補答草稿。若之後改回無人答對，重新提示填寫。所有無人答對的題目須有非空補答才能公布。」依資料模型「用原順位找第一個整個單位全對的組別；無人全對時為空。相同回合再次公布只回傳既有結果。」
- [X] T027 [P] [US3] 依 T026 已定義的公布結果，在 `backend/src/fairness.ts` 改讀已公布 `winnerGroupId`，保留 3 秒規則、全組皆曾勝出立即開放及原順位。補答與無勝組回合不增加勝出紀錄。
- [X] T028 [P] [US3] 依 T026 已定義的公布結果，在 `backend/src/worksheet/writeback.ts` 使用已公布勝組的原始組別作答。只處理有 Google 原稿位置的題目，處理無可回填項目，保留既有忙碌控制、原稿識別、原值比對、衝突零寫入、整批寫入及重讀驗證。
- [X] T029 [US3] 在 `backend/src/app.ts`、`backend/src/views.ts` 接上 `/end`、複核 PATCH、公布 POST、兩類角色視圖及已公布結果陣列。通過教師授權才可管理，`reviewRevision` 過期回 409。遵守「題目清單、標準答案或複核草稿的教師私有變更只推進教師視圖版本。開題、停止收件及公布推進所有可見角色版本。」保留 200／204 及未公布結果的 403，讓 CSV 及 Google 回填路由僅處理已公布回合，並處理缺少來源與無可回填內容。
- [X] T030 [US3] 在 `backend/src/results-csv.ts` 使用 T029 的已公布結果投影。保留前五欄，新增「正誤」，依題目與順位輸出已收、未收及老師補答。保留 UTF-8、CRLF、原文及 CSV 跳脫。純手動活動可下載，待確認判分回合排除。
- [X] T031 [P] [US3] 依 T029 契約在 `frontend/src/RoundReview.tsx`、`frontend/src/TeacherRound.tsx` 實作停止收件、草稿儲存、可更正判分、條件式補答與公布。保留未儲存輸入，輪詢收到新版本或回應遺失時先確認現況。老師可續用已儲存草稿。
- [X] T032 [P] [US3] 依 T029 契約在 `frontend/src/StudentRound.tsx`、`frontend/src/RoundHistory.tsx` 顯示待確認判分與本組收件，停止提交。公布後顯示題幹、勝組、各組正誤與老師補答；下一回合仍可檢視歷史。
- [X] T033 [P] [US3] 依 T028、T030 結果在 `frontend/src/TeacherResults.tsx` 支援純手動匯出，對缺少 Google 來源顯示 CSV 指引，並處理無可回填內容、衝突及原稿結果待確認。

## 階段 6｜整合與交付驗證

- [X] T034 在 `tests/helpers/classroom.ts`、`tests/integration/classroom.test.ts`、`tests/integration/xlsx-classroom.test.ts` 及 `tests/unit/views.test.ts`、`tests/unit/writeback.test.ts`、`tests/unit/google-io.test.ts` 的舊回合測試中，讓成功回合在開題前儲存題幹與標準答案，將原停止回合步驟更新成停止與公布。用獨立活動驗證純手動完整流程及混合來源連續回合，維持既有同步、身份、順位與回填案例。
- [ ] T035 依 `specs/003-classroom-question-flow/quickstart.md` 執行師生端到端流程和 MVP，分別記錄 SC-001 的實機跨來源對照、使用者提供工作表的唯讀匯入、SC-005 的實機回填及模擬驗收。各項標記通過、失敗或待驗收。若金鑰、權限或連線仍阻礙實機測試，記錄原因並維持待驗收，另執行 Google 模擬與既有 XLSX 快照測試。實際回填與衝突案例使用有編輯權的獨立教師副本。
- [X] T036 對照 `diagrams/003-component.puml`、`diagrams/003-class.puml`、`diagrams/003-sequence.puml` 與完成程式，查核責任、資料與時序一致。需要修正時同步更新圖源，用 PlantUML 重新輸出同名 PNG。
- [X] T037 執行 `package.json` 中的 `npm run typecheck`、`npm test`、`npm run build` 及 `specs/003-classroom-question-flow/quickstart.md` 聚焦指令，記錄實際成敗、未執行原因、匯入競爭的重測結果，以及所有正常與邊界案例的驗收結果。

## 依賴與執行順序

- T001 → T002 → T003 → T004 → T005。T005 完成後，各情境的測試可先撰寫；新增測試應能定位預期未通過的功能。
- **US1**　T006–T008 完成測試設計，T009、T010 可同時實作，T011、T012、T013 後由 T014 接好 HTTP，T015 完成雙角色操作。缺標準答案的開題案例由 T007 建立，於 T014 完成後驗證。
- **US2**　T016、T017 可獨立於 US1 的介面撰寫。T018 接在 T011、T012 後，T019 接在 T014、T018 後，T020 接在 T015、T019 後。純手動 CSV 最終驗收依賴 T030。
- **US3**　T021–T024 可互相並行，並可在 US1／US2 實作期間用測試夾具設計。T025 接在 T013 後，T026 接在 T025 後。T027、T028、T029 各自在 T026 完成後可同批執行，T029 另依賴 T019 以避免共檔衝突。T030 在 T029 後完成。T031、T032 在 T020、T029 後可並行，T033 在 T028、T030 後可與它們同批。
- **整合**　T034–T037 在三個情境完成驗收入口後按序執行。

## 各情境的並行範例

| 情境 | 可同時開始的工作 |
| --- | --- |
| US1 | T006 解析及夾具、T007 匯入 HTTP、T008 角色元件。測試建立後，T009 辨識器與 T010 匯入預覽亦可同批。 |
| US2 | T016 題庫 HTTP 契約與 T017 手動題表單測試。 |
| US3 | T021 判分與公平等待、T022 HTTP 與隔離、T023 匯出與回填、T024 複核元件測試。後續 T031 老師複核、T032 學生與歷史、T033 教師匯出亦可分工。 |

## 實作策略

1. 完成準備、共同基礎與 US1。首個展示里程碑是老師能匯入題目、設定標準答案，學生能看到完整題幹並送答。
2. MVP 須走完一個回合。老師為匯入的單題設定至少兩種標準答案，學生送出不符合任何一種的答案。停止收件後系統自動判錯，老師補答並公布。CSV 須保留學生的原始送答、最終正誤及一筆「老師補答」。
3. 完整交付另驗收手動加題、混合來源、判分邊界及 Google 原稿回填。依 T035 分別確認實機與模擬結果，所有必要案例通過後完成交付。

## Phase 7: Convergence

- [X] T038 CRITICAL 在 `backend/src/questions.ts` 與 `backend/src/worksheet/identify.ts` 拒絕只有不可見字元的題幹，並用與匯入相同的子題號格式判斷僅有題號的佔位文字。保留有效題幹原文。在 `tests/unit/worksheet-parser.test.ts`、`tests/contract/questions.test.ts` 與 `tests/contract/xlsx-import.test.ts` 驗證半形子題號佔位、零寬字元題幹、有效題幹與拒絕時題庫及回合狀態無變更 per Constitution I、FR-003、FR-004、US1/AC3、US2/AC3 (contradicts)
- [ ] T039 補齊 T035 的 Google 實機驗收。先確認應用程式的 Node.js 程序可讀取 `.env` 指定的服務帳戶檔案，再依 `specs/003-classroom-question-flow/quickstart.md` 驗證指定分頁唯讀匯入、Google 與 XLSX 內容對照，以及具編輯權的獨立教師副本回填與衝突零寫入。記錄各項實測結果。若權限仍阻礙測試，保留實機項目待驗收 per SC-001、SC-005、T035 (partial)
- [X] T040 在 `backend/src/views.ts` 依學生準備階段的公開欄位投影，排除來源題組名稱，保留當前階段及既有公開回合定位與題號。在 `tests/contract/views.test.ts` 驗證含自訂標籤的匯入題於準備階段不把標籤或題幹傳給學生，並核對老師預覽及學生開題後題幹仍可正常顯示 per FR-002、US1/AC2、T014 (contradicts)
- [X] T041 在 `frontend/src/TeacherRound.tsx` 與 `frontend/src/RoundReview.tsx` 讓老師在其他分頁切換待開始回合、替換來源或更正判分時，仍能查看並複製過期的未存題幹、標準答案或補答。已失效草稿不得送到新題目或新回合。在 `tests/components/TeacherRound.test.tsx`、`tests/components/RoundReview.test.tsx` 驗證輪詢更新後的草稿可見性及相關儲存限制 per plan: 介面與匯出契約、T015、T031 (partial)
