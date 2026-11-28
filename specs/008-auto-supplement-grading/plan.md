# 實作計畫：自動補答與逐筆改判

**Git 分支**　`main`  
**功能識別**　`008-auto-supplement-grading`  
**日期**　2026-11-24  
**規格**　[自動補答與逐筆改判](spec.md)

## 摘要

停止收件後，依已保存的回合題目和有效判分產生補答預覽。定案時以最後已儲存的判分與資格計算並封存補答。教師可用每筆作答的「錯誤／正確」按鈕改判，沿用原審核版本及操作回饋。

## 技術背景

| 項目 | 設計決策 |
| --- | --- |
| 語言及執行環境 | TypeScript、Node.js 22.12 以上、現有 npm 鎖定檔。 |
| 主要相依套件 | React、Vite、Express、Vitest 及現有瀏覽器驗收方式。 |
| 儲存 | 使用現有回合題目快照、判分欄位及補答列。教師未儲存選擇保留於同一回合的分頁草稿。 |
| 測試 | 正常與邊界案例使用 Vitest 的單元、HTTP 契約及 DOM 測試。以實際瀏覽器核對逐筆按鈕、鍵盤選擇及定案流程。 |
| 平台與效能 | 現有教室網頁。教師端以已收到的資料即時重算草稿預覽，點選判定時毋須往返伺服器。 |
| 約束 | 教師授權、回合範圍、審核版本、已定案歷史、收件順位及公平等待沿用既有行為。 |

## 憲章檢核

| 原則 | 研究前及設計後檢核 |
| --- | --- |
| 輸入驗證及錯誤訊息 | 通過。修改限有效版本、待審核回合、具權限教師及已收答項。拒絕保留先前資料。 |
| 正體中文 | 通過。介面、錯誤及驗收紀錄使用正體中文。 |
| MVP 優先 | 通過。沿用現有介面、回合型別及結果產出，先驗收自動補答。 |
| 機敏資料保護 | 通過。補答候選只在教師審核資料，學生公布前沿用既有可見範圍，測試使用虛構資料。 |
| 正常與邊界測試 | 通過。涵蓋混合來源、缺少答案、改判撤銷、資格、過時版本與結果封存。 |
| PlantUML 設計優先 | 通過。以[組件圖](../../diagrams/008-component.puml)、[類別圖](../../diagrams/008-class.puml)及[時序圖](../../diagrams/008-sequence.puml)對應設定、審核、補答與定案。交付前按實際流程核對圖及 PNG。 |

## 專案結構

| 位置 | 責任 |
| --- | --- |
| `shared/api.ts`、`shared/review-supplements.ts` | 教師審核候選型別，前後端共用逐題選用規則。 |
| `backend/src/rounds.ts`、`backend/src/app.ts` | 建立候選、審核版本、儲存判分及封存。 |
| `backend/src/views.ts`、`backend/src/results-csv.ts`、`backend/src/worksheet/writeback.ts` | 角色快照與既有封存結果、匯出及回填界線。 |
| `frontend/src/RoundReview.tsx`、`frontend/src/TeacherRound.tsx`、`frontend/src/review-draft.ts`、`frontend/src/styles.css` | 教師預覽、逐筆按鈕及同處操作回饋。 |
| `tests/unit/`、`tests/contract/`、`tests/components/`、`tests/integration/`、`tests/helpers/` | 既有規則回歸及本功能測試。 |

## 階段 0 — 研究

[研究紀錄](research.md)確立舊補答優先次序、審核預覽與封存生命週期、異版拒絕與結果相容方式。

## 階段 1 — 設計與驗收

1. 依[資料模型](data-model.md)定義逐題補答候選。候選須涵蓋仍可能因改判而需補答的題目。
2. 依[介面契約](contracts/review-and-results.md)用同一套逐題選用規則呈現審核預覽及封存補答。學生及 CSV 沿用現有結果資料。
3. 將逐筆改判改成可用滑鼠與鍵盤的兩個按鈕。預覽採目前草稿，定案採已儲存判分及資格。
4. 按[驗收指南](quickstart.md)驗證 SC-001 至 SC-004，並核對已定案舊資料、測試替身及結果輸出。

## 複雜度追蹤

未發現需例外處理的憲章限制。
