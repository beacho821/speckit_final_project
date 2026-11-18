# 實作計畫｜搶答題目顯示、手動出題與老師補答

**功能識別**　`003-classroom-question-flow`  
**目前 Git 分支**　`main`  
**日期**　2026-11-18  
**輸入**　[功能規格](spec.md)

## 摘要

讓老師與學生閱讀同一題幹，教師可匯入與手動新增題目，為各完整題號設定一行一種的標準答案。回合停止收件後比對固定的答案清單，老師確認或更正判分並為無人答對的題目補答，最後公布。已公布結果供雙方歷史、CSV 及符合資格的 Google 原稿回填使用。

依[組件圖](../../diagrams/003-component.puml)分配現有題目匯入、回合、角色畫面與結果元件的責任。依[類別圖](../../diagrams/003-class.puml)分開題目、原稿位置、標準答案、作答及老師補答。依[時序圖](../../diagrams/003-sequence.puml)驗證開題前檢查、停止收件、自動判分、改判、補答與公布的順序。

## 技術背景

| 項目 | 規劃 |
| --- | --- |
| 語言與版本 | TypeScript、Node.js ≥ 22.12，沿用專案鎖定版本 |
| 主要依賴 | Express、React、Vite、ExcelJS、Google APIs。沿用現有依賴 |
| 儲存 | 單一活動程序記憶體。保留工作表來源及原稿快照，加入活動題庫、開題快照及待確認判分草稿 |
| 測試 | Vitest、既有 HTTP 測試工具、React 元件測試與 Google 模擬介面 |
| 目標環境 | 本機 Web 應用程式，同一堂活動的老師及各組瀏覽器 |
| 效能與規模 | 保留既有輪詢的可見變更 1 秒更新驗收目標。沿用 10 MiB XLSX 及 100 KB JSON 限制 |
| 限制 | 維持首回合名單鎖與已開始活動的來源鎖，並維持既有組別公平等待。Google 回填要求授權的教師副本 |

## 憲章檢查

| 原則 | 研究前設計門檻 | 設計後核對 |
| --- | --- | --- |
| 輸入驗證 | 無效輸入須回報修正方式且零變更 | [HTTP 契約](contracts/http.md)列出開題、衝突、過期跨分頁更新及補答缺漏的拒絕行為 |
| 正體中文 | 使用者可見文字、測試及文件使用正體中文 | [介面與匯出契約](contracts/ui-and-exports.md)定義角色文案、欄名及狀態 |
| 最小可行產品 | 沿用單機架構及既有產品入口 | 續用來源解析、存取驗證、輪詢、匯出及寫回，不引入服務或依賴 |
| 機敏資料 | 延用既有認證及分頁恢復規則，答案清單應僅對老師提供 | 指定各階段的投影欄位，教師私有異動不推進學生版本，測試覆蓋結果與授權 |
| 功能測試 | 各需求須有正常及邊界案例 | [驗收指南](quickstart.md)列出執行指令、情境與結果，實作時回報實際成敗 |
| PlantUML 設計優先 | 三圖為架構、資料及時序藍圖 | 實作後逐圖比對共用題庫、生命週期、可見性與匯出，必要時對應修正並重產 PNG |

## 專案結構

### 本功能文件

```text
specs/003-classroom-question-flow/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── http.md
    └── ui-and-exports.md
```

### 程式與測試落點

```text
backend/src/
├── activity.ts、rounds.ts、fairness.ts
├── app.ts、access.ts、views.ts、results-csv.ts
└── worksheet/
    ├── identify.ts、import.ts、xlsx-source.ts、google-source.ts
    └── writeback.ts
frontend/src/
├── App.tsx、WorksheetImport.tsx、TeacherRound.tsx
├── StudentRound.tsx、RoundHistory.tsx、TeacherResults.tsx
└── api.ts、useActivityView.ts
shared/api.ts
tests/
├── unit/、contract/、components/、integration/
└── helpers/、fixtures/
```

在現有活動、匯入與回合邊界實作。共用題庫決定可選單位及題目順序，共用已公布結果投影提供查看及匯出。教師私有資料由伺服器按角色建立明確投影。

## 階段 0｜研究

[研究紀錄](research.md)說明兩種來源共用題幹辨識、手動題獨立於原稿位置、停止收件後判分、分頁衝突保護、結果投影及回填勝組選擇。開題欄位、判分規則及資料生命週期均已有決定。

## 階段 1｜設計與驗收準備

1. 依 [資料模型](data-model.md)建立可同時由匯入與手動來源供題的單位與回合快照。
2. 依 [HTTP 契約](contracts/http.md)銜接題目維護、開停回合、複核草稿、公布及結果查詢。
3. 依 [介面與匯出契約](contracts/ui-and-exports.md)顯示題幹、教師設定與改判欄位及兩類結果列。
4. 依 [驗收指南](quickstart.md)更新開題準備及公布步驟，保留舊工作表缺題幹案例並增加混合題、隱私、重試、補答與回填驗證。分別確認停止收件與公布後的可見變更在 1 秒內同步。
5. 在實作完成後重新核對憲章、三張 PlantUML 與驗收結果。
