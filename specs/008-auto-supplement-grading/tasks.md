---
description: "自動補答與逐筆改判的實作任務"
---

# 開發任務：自動補答與逐筆改判

**依據**　[功能規格](spec.md)、[實作計畫](plan.md)、[研究紀錄](research.md)、[資料模型](data-model.md)、[介面契約](contracts/review-and-results.md)及[驗收指南](quickstart.md)。

**測試**　依規格的可驗收情境與憲章安排正常及邊界測試。先重現新增行為的缺口，再實作並驗證原有規則。

## 格式與路徑

- `[P]` 表示進入該批次後可與不同檔案的任務並行。
- `[US1]` 與 `[US2]` 對應兩個使用情境。路徑相對於專案根目錄。

## 階段 1 — 準備

- [X] T001 依 `package.json` 與 `specs/008-auto-supplement-grading/quickstart.md` 準備現有 Node.js/npm 環境、獨立測試教室、雙子題測試資料及兩組虛構學生。確認可啟動本機服務及測試套件。

## 階段 2 — 共用基礎

- [X] T002 在 `shared/api.ts` 為既有教師 `ReviewView` 定義補答候選與來源。採「同一子題最多一筆，來源為 legacy 或 configured」，候選含題目識別及原文。沿用封存補答的形態「questionId 與 text」及結果介面。核對 `backend/src/views.ts` 的候選來源僅屬教師審核資料。

**檢查點**　教師審核、定案及公布結果的共用形態清楚。待審核補答預覽與已定案結果各有用途。

## 階段 3 — US1 停止收件後自動補答（P1，MVP）

**目標**　自動採用舊回合已存人工補答或開題時設定的標準答案。老師可直接確認定案。  
**獨立驗收**　測試無人送答、全部答錯及只有第一子題答對，也以舊回合夾具驗證人工補答優先及缺少來源。教師完成補答的額外操作須為零，結果與 CSV 採用同一補答。

### 測試

- [X] T003 [P] [US1] 在 `tests/unit/rounds.test.ts` 新增逐題選用測試，涵蓋多個標準答案、有正確答案、取消資格、純空白來源、無人送答及空來源可定案。用舊回合待審核資料驗證人工補答逐字保留、改判往返及封存時只保留仍適用的補答（FR-001 至 FR-003、FR-008）。
- [X] T004 [P] [US1] 在 `tests/contract/questions.test.ts` 與 `tests/integration/results.test.ts` 驗證教師審核候選、無人工補答請求即可定案、已存人工補答與自動補答同時封存，以及教師結果、學生公布結果和 CSV 一致。測試拒絕夾帶新人工補答時無部分寫入與未授權學生不取得候選（FR-003、FR-009、FR-010）。
- [X] T005 [P] [US1] 在 `tests/components/RoundReview.test.tsx` 測試無人送答、部分子題欠答與舊人工補答的標示。驗證待補題沒有輸入框或額外儲存按鈕、缺少來源僅提示且可定案。確認審核畫面各子題顯示正確來源（SC-001）。

### 實作

- [X] T006 [US1] 新增 `shared/review-supplements.ts` 的共用逐題篩選，依完整題目識別決定有效候選。使用「每項以完整題目識別，標準答案用開題時的順序」與「第一個非空白答案，保存原文」。人工補答依「每題至多一筆有效值，純空白視為缺少」取得優先權。對仍欠答且無來源的題目產生純提示資料。
- [X] T007 [US1] 在 `backend/src/rounds.ts` 與 `backend/src/views.ts` 由凍結題目及已存人工補答產生教師候選，涵蓋目前有人答對但稍後可能需補答的題目。保留待審核舊人工內容，定案時以已儲存判分與資格一次封存「每個仍需補答且有來源的子題最多一筆」。移除缺來源的定案阻擋，已定案舊歷史保持原值。確認 `backend/src/classrooms.ts` 的重啟待審核路徑沿用同一規則。
- [X] T008 [US1] 在 `backend/src/rounds.ts` 的教師審核更新拒絕非空的手動補答修改，接受空的舊 `supplements` 欄位隨有效判分或資格更新。沿用 `backend/src/app.ts` 的原子更新。核對 `backend/src/results-csv.ts`、`backend/src/views.ts` 與 `backend/src/worksheet/writeback.ts` 使用既有封存列，勝組回填只取勝組原答。
- [X] T009 [US1] 在 `frontend/src/RoundReview.tsx` 與 `frontend/src/review-draft.ts` 以候選和目前有效判定顯示只讀補答，分辨「老師補答」、「自動補答」與缺少來源。移除人工補答編輯、定位及儲存阻擋，保留判分與資格草稿、尚未儲存和待確認的定案限制。
- [X] T010 [US1] 更新 `tests/helpers/worksheet.ts` 與 `tests/helpers/classroom.ts` 的定案助手直接確認定案。用預置舊資料取代已淘汰的補答寫入夾具。在 `tests/unit/rounds.test.ts`、`tests/contract/questions.test.ts`、`tests/integration/results.test.ts`、`tests/contract/results-csv.test.ts`、`tests/components/RoundReview.test.tsx` 及 `tests/components/TeacherRound.test.tsx` 核對預期值、備援順序與既有輸出格式，並搜尋其餘依賴舊人工入口的案例。
- [X] T011 [US1] 依 `specs/008-auto-supplement-grading/quickstart.md` 實際驗收 SC-001。在 `specs/008-auto-supplement-grading/validation-results.md` 記錄零額外補答操作、舊人工原文優先、其餘子題的自動補答與讀回結果。

## 階段 4 — US2 老師查看原答並逐筆改判（P1）

**目標**　每組每一筆已送答都有單獨的「錯誤」「正確」按鈕，改判及資格變更即時影響預覽。定案採使用者已儲存的結果。  
**獨立驗收**　兩組各答兩題，逐筆以滑鼠及鍵盤改判，核對原答與順位。覆蓋補答出現、移除、恢復、資格變更、兩分頁衝突及定案後拒絕修改。

### 測試

- [X] T012 [P] [US2] 在 `tests/components/RoundReview.test.tsx` 及 `tests/components/TeacherRound.test.tsx` 驗證兩組四筆作答各有按鈕、恰有一項選中、同值不新增草稿、改判僅影響指定作答，另驗證未送出不提供按鈕及補答隨改判和資格切換。核對未存不可定案及儲存失敗保留草稿（FR-004 至 FR-007、SC-002、SC-003）。
- [X] T013 [P] [US2] 在 `tests/contract/classroom-review-history.test.ts` 測試具權限教師改判後定案勝組、最早有效順位、未收件與定案後的修改拒絕。以同回合兩筆相同版本請求驗證只寫入一筆、過時修改不覆蓋先前資料。測試學生越權時實際資料未變（FR-007、FR-008、FR-010、SC-004）。
- [X] T014 [P] [US2] 在 `tests/unit/review-draft.test.ts` 驗證逐筆判分的差異、選回已存值、版本比對、多分頁核對及資格變更。特別核對 `false` 與缺省值的處理，確保確認新快照時不將未寫入判定當成成功。

### 實作

- [X] T015 [US2] 在 `backend/src/rounds.ts` 與 `backend/src/app.ts` 保留授權及原子儲存，核對「同一教室、活動及世代的目前待審核回合」、「修改或定案必須符合目前的整數審核版本」、「只可改判已收件的組別與子題，判定為布林值」及「每個已收件組別的取消資格狀態為布林值」。拒絕重複或無效判分，定案只採已儲存的有效判定及既有勝組規則。
- [X] T016 [US2] 在 `frontend/src/RoundReview.tsx` 與 `frontend/src/styles.css` 為每筆已收答案顯示原文、完整題號、組別、順位與自動判分，提供有文字、可見焦點及選中狀態的「錯誤」「正確」按鈕。按下現有值不得新增差異，未送答不提供改判。
- [X] T017 [US2] 在 `frontend/src/review-draft.ts`、`frontend/src/RoundReview.tsx` 及 `frontend/src/TeacherRound.tsx` 接合逐筆判分和資格草稿、異版核對、依草稿重算補答預覽及儲存確認。成功前保留原答與順位，僅提交有差異的判定；過時或回應遺失時依同回合最新快照核對，且不得自動重送。
- [X] T018 [US2] 依 `specs/008-auto-supplement-grading/quickstart.md` 在瀏覽器執行 SC-002 至 SC-004，包含鍵盤、「錯誤→正確→錯誤」、資格、兩分頁及有無勝組。將結果與已定案拒絕證據寫入 `specs/008-auto-supplement-grading/validation-results.md`。

## 階段 5 — 整體驗收與交付

- [X] T019 核對 `diagrams/008-component.puml`、`diagrams/008-class.puml` 及 `diagrams/008-sequence.puml` 與實際狀態相符，補上舊人工補答優先與封存步驟，重新產出對應 PNG。
- [X] T020 依 `specs/008-auto-supplement-grading/quickstart.md` 執行型別檢查、元件及 HTTP 測試、全套測試與建置。核對 SC-001 至 SC-004、既有收件及公平等待回歸，並在 `specs/008-auto-supplement-grading/validation-results.md` 記錄實際指令、結果及未執行原因。

## 相依順序與平行範例

```text
T001 → T002
T002 → (T003 ∥ T004 ∥ T005) → T006 → T007 → T008 → T009 → T010 → T011
T011 → (T012 ∥ T013 ∥ T014) → T015 → T016 → T017 → T018
T018 → T019 → T020
```

- **US1**　可先並行撰寫規則、契約與介面測試。
- **US2**　元件、HTTP 契約與草稿單元測試可並行。兩個情境會修改教師審核元件，先完成 US1，再整合 US2。

## 實作策略

1. **MVP**　完成 US1。示範停止收件後可直接定案，含舊人工補答保留及剩餘題目的自動來源。
2. **增量交付**　完成 US2，示範對單筆答案改判後預覽重算，儲存並定案時採用權威結果。
3. 交付前依圖表與驗收指南，核對公開結果、匯出、歷史相容及授權行為。

## Phase 6: Convergence

- [X] T021 **CRITICAL** 在 `backend/src/rounds.ts` 驗證定案請求的版本後再處理已定案回合的重試。缺少或非整數版本應回傳格式錯誤，過時版本應回傳版本衝突。保留同版重試讀回封存結果的行為，並在 `tests/contract/questions.test.ts` 驗證各分支均未變更封存紀錄。依據 Constitution I、T015（contradicts）。
- [X] T022 在 `frontend/src/RoundReview.tsx` 與 `frontend/src/review-draft.ts` 保留過期儲存請求的草稿與核對狀態。即使新版判定恰好與草稿相同，仍須完成核對才能定案；核對完成的草稿不應在後續版本重新出現。新增元件回歸測試，覆蓋兩個分頁改成同值並收到 `409`、後續新版再改回及核對前禁止定案。依據 FR-007、US2/AC4、T017（partial）。
- [X] T023 在 `frontend/src/TeacherRound.tsx` 與 `frontend/src/RoundReview.tsx` 保留待確認定案的回合識別。當定案回應遺失且下一份快照已顯示其他回合時，以同教室、同活動的原回合結果確認勝組或無勝組，並在原操作流程回報。新增元件回歸測試，驗證跳過空閒快照時能讀回原結果，也不會重送定案或誤認新回合。依據 T017、plan: 審核版本與操作回饋（partial）。
- [X] T024 將 Edge 驗收所需的測試教室、題組、舊回合資料及執行步驟放在新工作區可取得的位置。以 `specs/008-auto-supplement-grading/validation-results.md` 記錄可重跑的準備方式、必要工具及實際指令，並從乾淨環境驗證 SC-001 至 SC-004 可重現。依據 T018、T020（partial）。
- [X] T025 在 `tests/unit/rounds.test.ts` 用舊待審核資料驗證同一筆作答由錯誤改為正確再改回錯誤時，已存人工補答先退出預覽再以相同原文恢復，且定案只封存仍適用的補答。依據 T003、FR-001、FR-006（partial）。

## Phase 7: Convergence

- [X] T026 在 `frontend/src/TeacherRound.tsx` 與 `frontend/src/RoundReview.tsx` 保留同教室、同活動、同待審核回合的分頁草稿及未完成的逐筆核對。老師切到題目管理或分組管理再返回控制台時，應恢復各筆改判與資格草稿、補答預覽，以及儲存或核對前的定案限制。新增回歸測試，驗證同分頁切換與返回，也驗證草稿不會套用到其他回合或活動。依據 FR-007、plan: 同一回合的分頁草稿、T017（partial）。
- [X] T027 在 `frontend/src/TeacherRound.tsx` 與 `frontend/src/RoundReview.tsx` 依原回合分別追蹤待讀回的定案結果。當前一回合的定案回應遺失、結果讀取尚未完成，而老師定案下一回合時，前一回合仍應在各自的操作區完成查核或可就地重試，且每則回報必須對應原回合。新增回歸測試，覆蓋延後前一回合的結果讀取、完成下一回合後再收到前一回合結果，以及各回合僅送出一次定案請求。依據 T017、T023（partial）。

## Phase 8: Convergence

- [X] T028 在 `frontend/src/RoundReview.tsx` 保留已確認封存回合的結果查詢狀態。當首次結果查詢先失敗、原定案請求稍後才回報連線失敗時，該回合仍須顯示結果查詢錯誤及「重新取得定案結果」，開下一題後仍可在原回合操作區重試。新增回歸測試，覆蓋此回應順序，並驗證重試僅讀取原回合結果、成功顯示對應勝組或無勝組，且定案請求只送出一次。依據 T017、T023、T027（partial）。
