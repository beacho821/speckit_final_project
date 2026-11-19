# 實作計畫｜調整教室操作流程

**目前分支**　`main` · **功能識別**　`005-refine-classroom-workflow` · **日期**　2026-11-20 · **規格**　[spec.md](spec.md)

## 摘要

教師在題目管理用卡片備題，拖曳安排學習單題目，手動題排在待開放學習單題目後。控制台依清單開放，伺服器在實際開放時固定題號。教師導覽提供同教室的唯讀全班投影。學生可切換作答及歷史，已公布答案由伺服器依學生所屬組別提供。

## 技術背景

| 項目 | 現況與選擇 |
| --- | --- |
| 語言與版本 | Node.js 22.12 以上及 TypeScript，沿用 package.json 的相依版本。 |
| 主要相依 | React、Vite、Express、ExcelJS、Google Sheets 整合。排序採原生 Pointer Events 與上移、下移按鈕。 |
| 儲存 | 沿用每教室序列化寫入及 JSON 原子存檔，以相容的選用欄位擴充。 |
| 測試 | Vitest、jsdom、本機 HTTP 整合及實際桌面與手機瀏覽器驗收。 |
| 目標平台 | 現有 Node.js 網路服務、桌面教師頁、手機學生頁與獨立投影分頁。 |
| 專案類型 | 既有 Web 應用，共用前後端 TypeScript 型別。 |
| 效能目標 | 執行 SC-001 至 SC-004。同區網兩間教室各三次收件更新，所屬投影每次 2 秒內更新。 |
| 條件與範圍 | 維持雙教室隔離、既有公平等待、審核、CSV、Google 回填及學生加入驗證。 |

## 憲章檢核

| 原則 | 規劃前檢核 | 設計後複核 |
| --- | --- | --- |
| 輸入驗證與錯誤訊息 | 以活動、角色、回合階段及來源檢驗操作。 | 契約定義必填值、排序範圍、版本衝突、匯入確認及拒絕後狀態。 |
| 正體中文 | 延續現有介面用語。 | 按鈕、錯誤與驗收說明採正體中文。 |
| 最小可行產品 | 沿用工作區、長輪詢與存檔。 | 清單、原子開題及學生本組結果使用既有服務；拖曳沿用瀏覽器能力。 |
| 機敏資料保護 | 憑證來自環境，沿用教師記憶體授權及學生同分頁重驗。 | 跨視窗傳送投影快照，學生歷史在伺服器剔除其他組資料。 |
| 功能測試 | 各情境配正常與邊界案例。 | 快速驗收涵蓋首匯、重匯、拖曳、舊存檔、並行、權限與歷史。 |
| PlantUML | 以組件、類別、時序三圖為藍圖。 | 三張圖依澄清同步為頁面與資料流、清單及回合快照、備題及開放的驗收依據。 |

設計前後皆通過。功能驗收依 [quickstart.md](quickstart.md) 執行。

## 專案結構

### 功能文件

```text
specs/005-refine-classroom-workflow/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── http.md
    └── ui.md
```

### 原始碼與測試

```text
backend/src/
├── activity.ts、classrooms.ts、classroom-store.ts
├── questions.ts、rounds.ts、views.ts、projection.ts
├── app.ts、access.ts
└── worksheet/import.ts、worksheet/writeback.ts
frontend/src/
├── App.tsx、TeacherWorkspace.tsx、TeacherRound.tsx
├── WorksheetImport.tsx、ManualQuestion.tsx、Roster.tsx
├── Projection.tsx、StudentRound.tsx、RoundHistory.tsx
└── useActivityView.ts、styles.css
shared/api.ts
tests/{unit,contract,integration,components}/
```

[組件圖](../../diagrams/005-component.puml)對應教師導覽、題目管理、控制台、投影與學生導覽。沿用匯入元件及題目編修能力，使用同一學生工作區保留同步與作答狀態。

[類別圖](../../diagrams/005-class.puml)對應教室、活動、題目卡、可重用的出題清單，以及開題時固定的回合快照。[時序圖](../../diagrams/005-sequence.puml)對應在教室交易內寫入清單及開題，以及分享經權限篩選的投影及公布結果。

## 階段 0｜研究

[研究紀錄](research.md)定案題目識別、排序、相容儲存、匯入交易、投影及學生結果。

## 階段 1｜設計與契約

1. 擴充教室存檔與活動驗證，接上題目卡、清單、重新匯入及下一題開放。教室交易同時驗證題目與清單狀態，回合快照保留來源鍵。刪除與其相依的舊準備回合一併儲存。教師歷史以回合快照顯示正式題號。MVP 交付前同時完成學生結果端點的本組限制、既有歷史介面的相容讀取及權限驗收。
2. 統一教師導覽及全班投影。沿用教師分頁記憶體驗證及同源快照轉送，移除組別投影入口與伺服器授權。
3. 保留學生作答元件的生命週期，加入學生歷史導覽，沿用 MVP 已實作的角色別結果。驗證未公布、跨組、跨教室與跨活動的資料邊界。
4. 依[資料模型](data-model.md)、[HTTP 契約](contracts/http.md)、[介面契約](contracts/ui.md)及[快速驗收](quickstart.md)檢查各層一致性。

## 複雜度追蹤

無需例外核准。
