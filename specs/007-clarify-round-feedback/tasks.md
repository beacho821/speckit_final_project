---
description: "教師定案與學生倒數提示的實作任務"
---

# 開發任務：教師定案與學生倒數提示

**依據**　[規格](spec.md)、[計畫](plan.md)、[研究](research.md)、[資料模型](data-model.md)、[介面契約](contracts/review-and-countdown.md)與[驗收指南](quickstart.md)。

**測試**　依規格的獨立驗收與憲章規定，補齊正常及邊界案例。新增的回歸案例先確認可重現缺口，既有規則案例則須繼續通過。

## 格式與路徑

- `[P]` 表示在共同前置完成後，可與同批不同檔案的任務並行。
- `[US1]`、`[US2]`、`[US3]` 對應規格的使用情境。
- 任務中的檔案路徑皆相對專案根目錄。

## 階段 1 — 準備

- [X] T001 依 `package.json` 和 `specs/007-clarify-round-feedback/quickstart.md` 準備 Node.js 22.12 以上、現有 npm 鎖定依賴、獨立測試教室和可重現的雙子題測試資料。用 `specs/002-classroom-workflow-fixes/references/mixed-questions.xlsx` 或具同等驗收條件的虛構學習單準備題組。

## 階段 2 — 共用基礎

- [X] T002 核對 `shared/api.ts`、`backend/src/app.ts`、`backend/src/views.ts` 與 `frontend/src/useActivityView.ts` 所提供的角色快照、審核版本、結果查詢與全量刷新序號，按 `specs/007-clarify-round-feedback/contracts/review-and-countdown.md` 確認後續任務所用欄位。「目前教室、活動識別及世代、回合識別」共同界定操作範圍。
- [X] T003 在 `frontend/src/TeacherRound.tsx` 接出供審核區使用的操作結果，區分已確認成功、明確遭拒與待確認，並沿用既有身分、活動識別、失效處理、請求互斥及更新序號。以 `frontend/src/api.ts` 的錯誤解析保留原因與詳細欄位。

**檢查點**　教師審核可使用有明確結果的操作入口。學生仍可使用既有快照與送出契約。

## 階段 3 — US1 教師找出必填補答並確認定案（P1，MVP）

**目標**　待補答題號、定位入口及定案條件位於同一操作區。  
**獨立驗收**　用無人送答、只欠第二子題及所有子題皆有人答對三個回合驗證 SC-001。以滑鼠與鍵盤測試欄位焦點，核對空白不通過、可定案時進入既有封存流程。

### 測試

- [X] T004 [P] [US1] 在 `tests/components/RoundReview.test.tsx` 補上無人送答、只欠第二子題、空白、各子題皆有人答對及未儲存修改的案例。核對完整題號、待補答順序、鍵盤與滑鼠可用的定位控制項，以及阻擋時未送出定案請求（FR-001 至 FR-003、SC-001）。
- [X] T005 [P] [US1] 在 `tests/unit/rounds.test.ts` 核對既有判分、資格、純空白補答、題組無勝組與最早全對的合資格勝組規則。補齊缺答定案遭拒後回合資料與階段未變更的案例（FR-003、FR-008）。

### 實作

- [X] T006 [US1] 在 `frontend/src/RoundReview.tsx` 依完整題目識別與現有 `frontend/src/question-label.ts` 顯示當前待補答題號，依畫面順序列出。「每個子題由具資格組別的正確作答或有效補答滿足。純空白視為無補答，其餘答案保留原文。」按缺答、尚未儲存、待核對、忙碌或待確認狀態限制定案，並在操作位置說明原因與下一步。
- [X] T007 [US1] 在 `frontend/src/RoundReview.tsx` 加入「前往第一個待補答」原生按鈕，以完整題目識別定位並聚焦第一個可編輯待填欄位。用 `frontend/src/styles.css` 保持窄版與鍵盤操作下的可見焦點及題號回饋。
- [X] T008 [US1] 依 `specs/007-clarify-round-feedback/quickstart.md` 執行 SC-001 並記錄三種回合結果。確認可定案的流程保留既有勝組判定，缺答流程沒有送出定案。

## 階段 4 — US2 教師在操作位置看到儲存與定案結果（P1）

**目標**　儲存與定案進度、分頁衝突及斷線後核對可在原操作區完成。  
**獨立驗收**　在已備妥的長題組回合驗證 SC-002 與 SC-003。用兩個教師分頁對兩筆補答各填不同值，先選擇一筆確認仍被阻擋，再分別保留已存值與草稿值，最後儲存並重新讀取。模擬前後各一次遺失回應，確認不重送、能查明狀態。

### 測試

- [X] T009 [P] [US2] 在 `tests/unit/review-draft.test.ts` 新增逐筆比對案例，覆蓋本機單改、遠端單改、相同值、不同值、最新值再次變更與失效補答。測試「有效正誤，保留 `false` 為合法值」、「原文或空值，空白與未填等效」、「有資格或已取消資格，省略取消資格欄等效於有資格」。
- [X] T010 [P] [US2] 在 `tests/components/RoundReview.test.tsx` 驗證兩筆衝突各自選擇且選擇時未寫入。測試儲存未送出、處理中、已儲存仍缺條件、儲存成功與明確拒絕，覆蓋草稿保留、全部解決後使用最新版本及無有效差異時無空請求（FR-004、FR-005、SC-003）。
- [X] T011 [P] [US2] 在 `tests/components/TeacherRound.test.tsx` 驗證儲存及定案的即時與斷線回復，包含拒絕、重複點擊、版本前進但欄值尚未反映、兩分頁並行、跨回合晚到結果和定案後審核畫面卸載。核對操作區仍可讀取勝組或「無勝組」，未確認前不顯示成功或重送，已確認仍審核時才可明確重試（FR-004、FR-006、FR-007、SC-002）。
- [X] T012 [P] [US2] 在 `tests/contract/classroom-review-history.test.ts` 驗證兩次並行審核更新中，過期版本收到 `REVIEW_REVISION_CHANGED` 且未部分寫入。核對封存前後結果查詢、成功回應的回合與勝組識別，以及學生快照沒有教師審核資料（FR-005 至 FR-008）。

### 實作

- [X] T013 [US2] 在 `frontend/src/review-draft.ts` 實作基準、草稿及新快照的逐筆比對。判分鍵為組別與題目，補答鍵為題目，資格鍵為組別。採用資料模型的四種比對結果，以最新已存值綁定教師選擇，已存值再次變更時重新核對該筆。依最新判分和資格重算補答需求，保留失效草稿供複製，並排除於儲存內容。
- [X] T014 [US2] 在 `frontend/src/RoundReview.tsx` 接上逐筆選擇，並列已存值與草稿，以完整題號和適用的組別標示。阻止尚有未解衝突時儲存或定案，保留可合併的本機差異。選擇只更新待儲存草稿，教師明確儲存後才寫入。若最後沒有有效差異，完成核對而不呼叫空白更新。
- [X] T015 [US2] 在 `frontend/src/TeacherRound.tsx` 和 `frontend/src/RoundReview.tsx` 顯示儲存及定案的處理中、明確拒絕、待確認與已確認狀態。儲存以已提交欄值和本次更新序號核對新快照，版本增加不得單獨作為成功證據。定案用目標回合識別核對 `closedRoundIds`，必要時查回合結果並提供就地重新取得狀態的入口。校驗回應範圍；「回合結束收件後，依現有流程從進行中進入待審核，定案後進入已結束。」
- [X] T016 [US2] 在 `frontend/src/TeacherRound.tsx`、`frontend/src/RoundReview.tsx` 及 `frontend/src/styles.css` 保留同一操作區的定案回饋，讓回饋跨越審核子元件卸載。操作控制項移除時將焦點留在結果區。「保留同回合的 `winnerGroupId` 及顯示名稱，`null` 表示無勝組。」驗證待確認或名稱暫缺時能再次核對。
- [X] T017 [US2] 依 `specs/007-clarify-round-feedback/quickstart.md` 執行並記錄長題組頁尾的儲存成功與失敗、定案成功與拒絕、失去回應，以及兩筆分頁衝突（SC-002、SC-003）。

## 階段 5 — US3 學生確認等待原因並送出原草稿（P2）

**目標**　學生知道誰有優先時段、可先填答、剩餘秒數及送出可用時機。  
**獨立驗收**　在同一活動以曾勝組與尚未勝組重現公平等待。確認曾勝組倒數中不可送出，歸零且仍收件時能手動送出原草稿，另一次於倒數中停止收件時不能送出。

### 測試

- [X] T018 [P] [US3] 在 `tests/components/StudentRound.test.tsx` 以可控時鐘驗證倒數文案、暫停分頁後經過時間、最後一秒、`WAIT_REQUIRED` 校正、無等待組別、同回合保留草稿與停止收件。核對倒數歸零前未送出請求，歸零且仍收件時手動送出原文（FR-009、FR-010、SC-004）。
- [X] T019 [P] [US3] 在 `tests/contract/fair-submissions.test.ts` 驗證既有 2,999 與 3,000 毫秒邊界、未受限制組別、錯過收件階段及等待拒收後未新增送出紀錄。核對拒收回應僅提供本組所需資料（FR-008 至 FR-010）。

### 實作

- [X] T020 [US3] 在 `frontend/src/StudentRound.tsx` 用快照和 `WAIT_REQUIRED` 的正數剩餘毫秒設定本機倒數，以經過時間計算並向上取整顯示。說明其他組別優先且本組可先填答。草稿範圍為「當前學生組別、活動範圍及回合」，同回合校正不清空草稿。
- [X] T021 [US3] 在 `frontend/src/StudentRound.tsx` 的按鈕與送出入口共同核對目前回合及等待條件。「歸零後需同時符合仍在收件、尚未收件成功且沒有未確認的送出，才可手動提交。」保留既有收件回饋與停收提示。依 `specs/007-clarify-round-feedback/quickstart.md` 執行並記錄 SC-004。

## 階段 6 — 整體驗收與交付

- [X] T022 核對 `diagrams/007-component.puml`、`diagrams/007-class.puml`、`diagrams/007-sequence.puml` 及對應 PNG 與實際角色、欄位、狀態及步驟。需調整時同步圖檔並以 PlantUML 重新產出對應 PNG。
- [X] T023 按 `specs/007-clarify-round-feedback/quickstart.md` 執行元件和契約測試、`package.json` 的型別檢查、全套測試與建置。於 `specs/007-clarify-round-feedback/validation-results.md` 記錄指令、實際結果、SC-001 至 SC-004、拒絕後資料未變更的驗證，以及未完成案例與原因。

## 相依順序與平行範例

```text
T001 → T002 → T003
T003 → (T004 ∥ T005) → T006 → T007 → T008
T008 → (T009 ∥ T010 ∥ T011 ∥ T012) → T013 → T014 → T015 → T016 → T017
T003 → (T018 ∥ T019) → T020 → T021
T008 + T017 + T021 → T022 → T023
```

- **US1**　T004 與 T005 同時處理不同測試層。
- **US2**　T009 至 T012 分別編修不同檔案。T010 與 US1 的 T004 共用同一元件測試檔，因此依圖排序。
- **US3**　T018、T019 可同時進行，學生流程與教師流程的程式修改可並行。若依序實作，可在兩個教師情境通過後進入學生情境。

## 實作策略

1. **MVP**　先完成 US1。獨立示範無人送答時可找到補答欄位，未補答不能定案，符合條件時能完成既有定案流程。
2. **教師回饋**　完成 US2，驗收頁尾就地回饋與兩分頁並行修改。
3. **學生倒數**　完成 US3，驗收歸零送出、提前停止收件與草稿保留。
4. 各使用情境在各自的驗收資料下可獨立測試。整體交付前核對圖表、全套測試與實際驗收紀錄。

## Phase 7: Convergence

- [ ] T024 在 `frontend/src/review-draft.ts` 和 `frontend/src/RoundReview.tsx` 失效已核對的衝突選擇。若最新已存值不同於老師選擇時的值，包括回到最初基準值，只要已存值與草稿仍不同，就再次並列兩值並阻擋儲存與定案。在 `tests/unit/review-draft.test.ts` 與 `tests/components/RoundReview.test.tsx` 驗證保留已存值後的回改不會使舊草稿自動列入送出資料，並保留相同值免選的行為。對應 FR-005、SC-003、T013（partial）。
- [ ] T025 在 `frontend/src/RoundReview.tsx` 收到 `SUPPLEMENT_REQUIRED` 等表示審核條件已變的定案拒絕時，就地顯示原因並取得同回合新快照。先停用定案，依最新待補答題號開放對應欄位及定位入口，保留已有輸入。在 `tests/components/TeacherRound.test.tsx` 以連續快照驗證拒絕後未封存、同步前無法重送，且補答並儲存後才能再定案。對應 FR-003、FR-007、US2/AC4、T015（partial）。
- [ ] T026 在 `frontend/src/StudentRound.tsx` 處理同回合送出收到 `INVALID_PHASE` 的情況，立即就地提示停止收件或等候最新狀態，封鎖該回合的送出入口並刷新快照。於 `tests/components/StudentRound.test.tsx` 模擬仍顯示收件中的舊快照、倒數歸零和先抵達的伺服器拒絕，確認新快照抵達前不會再次發出送出請求。對應 FR-010、US3/AC3、T021（partial）。
- [ ] T027 補齊既有驗收的時序與操作證據。在 `tests/components/TeacherRound.test.tsx` 切到新回合後才結束舊回合的請求，驗證舊回應不更新新回合的訊息。於 `tests/contract/classroom-review-history.test.ts` 讓兩筆同版本審核更新重疊，驗證只有一筆寫入且失敗請求無部分修改。依 `specs/007-clarify-round-feedback/quickstart.md` 在部分答對的題組以滑鼠及鍵盤各定位一次唯一待答子題，在 `specs/007-clarify-round-feedback/validation-results.md` 記錄實測。對應 SC-001、T008、T011、T012（partial）。
