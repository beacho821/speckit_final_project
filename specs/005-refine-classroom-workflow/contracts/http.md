# HTTP 契約｜題目、開題、投影與結果

## 授權及共通回應

題目、範圍內回合操作及投影沿用教師 Basic 授權與 `X-Classroom-Id`、`X-Activity-Id`、`X-Activity-Epoch`。學生沿用分組授權及成員驗證。須由伺服器查得身分及教室，不信任請求指定的組別。錯誤沿用 `{ code, message, details? }` 與正體中文提示。`401/403` 處理憑證或角色問題，`404` 處理範圍內找不到的資源，`409` 處理失效範圍、版本或階段衝突，`422` 處理格式或必填資料錯誤。

變更以伺服器最新狀態驗證，成功後觸發對應角色更新。版本衝突重新取得畫面。寫入失敗或請求結果未確認時，前端先取得快照核對結果，再允許後續相依動作。

## 題目管理及開放

教師用 `GET /api/view` 取得題卡、已選擇的順序和 `catalogRevision`。每張卡提供 `unitId`、來源種類、子題及其編修版本、是否已開放。另提供下一題 ID；沒有待開放題時回傳空值。供學生使用的回應不含此區及來源的標準答案。

| 操作 | 請求與結果 |
| --- | --- |
| `POST /api/questions` | `{ prompt, acceptedAnswersText, catalogRevision }`。一行一種標準答案，題幹及至少一種答案為必填。伺服器建立單題卡並加入清單末端，回傳 `201` 和新增結果。 |
| `PATCH /api/questions/:questionKey` | `{ questionRevision, catalogRevision, prompt?, acceptedAnswersText? }`。沿用子題編修驗證。儲存有效編修回傳更新題目。 |
| `POST /api/question-queue` | `{ unitId, catalogRevision }`。加入一張未開放的學習單卡。已有該題且版本仍有效時回傳當前清單，不重複插入。 |
| `PUT /api/question-queue` | `{ worksheetUnitIds, catalogRevision }`。提交目前已加入且未開放的學習單卡完整排列。拒絕重複、缺少、未加入、手動及已開放 ID。成功回傳目前清單及版本。 |
| `DELETE /api/questions/units/:unitId` | JSON `{ catalogRevision }`，在介面確認後送出。在同一次存檔刪除卡片、清單項目及仍引用該卡的未開放準備回合，回傳最新清單及版本。已開放卡片拒絕刪除；存檔失敗保留三者。 |
| `POST /api/rounds/open-next` | `{ unitId, catalogRevision }`。鎖內比較下一題與版本，沿用準備及開放的分組、階段與題目驗證，一次完成儲存與正式編號。回傳 `201` 和開放回合。清單空、題目過期、仍收件或待審核時拒絕，無空回合或重複回合。 |
| 舊準備及開放路徑 | 教師正常入口改用原子開放。保留的 `POST /api/rounds`、`POST /api/rounds/:id/start` 一樣驗證下一題及題目管理版本，避免從舊路徑跳過清單。結束、送答、審核及公布路徑延續既有行為。 |

## 學習單

沿用 `POST /api/worksheet/import` 與 `POST /api/worksheet/import/xlsx` 及既有 Google URL、候選工作表和 XLSX 10 MiB 請求格式。兩者使用 `X-Catalog-Revision` 綁定讀檔及發布。發現既有已發布來源時，教師確認後帶 `X-Confirm-Worksheet-Replacement: true`。候選選取可回傳既有 `candidates` 格式，只有最終成功發布才更新來源與清單。伺服器在開始讀取和提交時重查確認、版本、活動、發起世代與未開放條件，舊請求不得覆寫。成功回覆沿用學習單預覽，前端同步教師視圖取得新題卡及版本。

## 投影

- 保留 `GET /api/classrooms/:classroomId/projection?after=version` 的快照、等待及 `204` 回應。教師授權、標頭及網址教室需一致。各組僅有名稱及收件狀態。準備中無題幹，其他階段只返回可展示的題目，勝組等摘要限已公布。
- 移除 `POST /api/groups/:id/projection-code`、`POST /api/projections/group/session`、`GET /api/projections/group/view`。上述舊操作回傳通用 `404`，且不讀取或產生組別投影資料。舊投影憑證不授權任何路徑。
- 選定教室切換新活動時，教師頁對同一教室重新查驗目前活動，清除舊輪詢版本及快照。更換教師工作頁所選教室不會變更現有投影所屬教室。

## 學生作答及公布結果

- `GET /api/view` 的開放題目加入課堂題號與可用的部分序號。已有的送答鍵、收件內容、等待與重驗欄位沿用。不可向學生回傳準備中題幹、題目管理版本與答案庫。
- `GET /api/rounds/:id/results` 維持已公布檢查。教師取得保留原欄位的全班結果，各題新增 `questionNumber` 及 `partNumber`（單題為空）。學生取得依其已驗證組別投影的逐題陣列。學生每題欄位為 `questionNumber`、`partNumber`（單題為空）、`prompt`、`ownAnswer`（未作答為空）、`correct`（無判定為空）及 `publishedAnswer`（需要顯示且可用時才有值）。缺少可用公布答案時以空值表示。
- 學生請求本活動未公布回合回傳 `403`。不在本活動的回合回傳 `404`，失效的活動或組別先走現有授權拒絕。學生回應無其他組別逐題答案、學生名單、順位、來源定位或標準答案清單。CSV 保持既有合約。
- 教師用 `GET /api/classrooms/:classroomId/results` 取得目前及封存活動的回合摘要，每筆新增 `questionNumber`。用 `GET /api/classrooms/:classroomId/activities/:activityId/rounds/:roundId/results` 取得包含 `questionNumber` 及 `partNumber` 的全班逐題明細。正式題號依該活動開放時的快照或舊存檔的開放順序推得，保留原有來源識別欄位。
