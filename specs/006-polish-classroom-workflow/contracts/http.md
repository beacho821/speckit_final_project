# HTTP 契約｜改善教室操作與活動結算

本文件定義新增的整卡儲存及本功能依賴的既有介面。請求沿用現有驗證。教師活動相關請求使用 `Authorization`、`X-Classroom-Id`、`X-Activity-Id`、`X-Activity-Epoch`。僅定位教室的請求使用教師 `Authorization`。錯誤遵循現有 `{ code, message, details? }`，訊息以正體中文提供原因與下一步。

## 整卡儲存（FR-004）

`PATCH /api/questions/units/:unitId` 需要教師及目前活動範圍，請求使用 `application/json`。

| 欄位 | 規則 |
| --- | --- |
| `catalogRevision` | 非負安全整數，等於目前題庫版本。 |
| `questions` | 非空陣列，完整列出此卡所有部分且識別不重複。單題使用一筆。 |
| `questions[].questionKey` | 既有題目鍵，屬於目標卡。 |
| `questions[].questionRevision` | 非負安全整數，等於對應題目的目前版本。 |
| `questions[].prompt` | 文字，符合既有題幹驗證。不可只含空白、不可見字元或來源題號。 |
| `questions[].acceptedAnswersText` | 文字，每行一種答案。修剪並略過空行後至少留一個答案。 |

驗證順序須在首次寫入前涵蓋活動權限、目前階段、目錄版本、目標卡、全部題目版本及全部內容。依題目鍵對應題目，維持原本部分順序、題號、來源及回填識別。

| 回應 | 意義 |
| --- | --- |
| `200` | `{ unit: CatalogUnit, catalogRevision: number }`。單次交易已成功儲存，回傳保存後內容及版本。有效且無變動時可回傳現況。 |
| `401 / 403` | 認證失敗或角色無權。 |
| `404` | 指定題卡已不存在，提示重新載入。 |
| `409` | 活動範圍過期、回合收件／審核中、題卡已開放或目錄／題目版本衝突。沿用相應既有錯誤碼及核對方式。 |
| `422` | 缺欄位、部分集合不符、版本欄位無效、題幹不合法或缺答案。指出要核對的欄位或部分。 |
| `503 CLASSROOM_SAVE_FAILED` | 教室儲存失敗，整卡與版本維持原狀。 |

可確認的拒絕不部分套用。網路中斷、未取得回應時，前端保留草稿，透過送出後取得的完整教師檢視核對同一教室活動和題卡。比較儲存後的題幹及按本契約修剪、略過空行後的標準答案，完全相符才確認內容已存；有差異或題卡已失效時提示核對。前端不自動重送。保留 `PATCH /api/questions/:questionKey` 的單部分相容介面及原有部分更新語意。

## 題卡刪除與排序（FR-005、FR-006）

- `DELETE /api/questions/units/:unitId` 沿用 `{ catalogRevision }`。成功回傳新清單與目錄版本，原子移除未開放題卡、清單項目及相依的舊準備回合。已開放或版本衝突時拒絕。
- `PUT /api/question-queue` 沿用 `{ worksheetUnitIds, catalogRevision }`。必須是所有可排序題卡的完整排列。驗證成功回傳 `{ queueUnitIds, catalogRevision }`。無效或過期時保留已提交的順序。
- `POST /api/rounds/open-next` 沿用目錄版本與下一題檢查。開題與整卡儲存若競爭，後取得交易者重查版本和狀態。

## 教室定位與投影（FR-001 至 FR-003）

- `GET /api/classrooms`、`GET /api/classrooms/:classroomId` 提供列表與位置。已驗證的原教師頁以位置回應取得目前活動範圍。
- `GET /api/classrooms/:classroomId/projection?after=<version>` 僅接受教師、對應教室及有效活動範圍。首次讀取、重連與範圍更新時省略 `after`，成功回傳完整 `ProjectionView`。正常持續更新傳入已知版本，等待上限 20 秒。無更新回傳 `204`，視為正常連線。
- 已確認 `401 / 403` 時投影撤權。若 `409 ACTIVITY_EXPIRED`，教師頁重新查詢**同一教室**位置。確認活動或執行期換代後清除舊畫面，使用新範圍讀取。定位回傳 `404` 或確認已無可用的來源頁時，清除內容並提供重開指引。網路錯誤、暫時性服務錯誤或請求逾時走重連流程。收到瀏覽器恢復連線通知時取消舊請求，立即以完整查詢重連。若原請求無回應且瀏覽器未通報斷線，最遲在該請求達 25 秒期限時進入重連。投影快照限教室既有公開資訊。

## 結算及公布結果（FR-007 至 FR-009）

| 介面 | 既有契約與使用時機 |
| --- | --- |
| `GET /api/view` | 教師使用目前活動的 `phase`、`closedRoundIds`、`worksheetPreview.source`、`writebackInProgress` 呈現結算入口、可用操作與空狀態。 |
| `POST /api/worksheet/writeback` | 只回填合格 Google 原稿的已定案可對應勝組答案，保留來源比對、衝突、鎖定與結果待確認行為。無定案結果時既有回應為 `409 NO_ENDED_ROUNDS`。 |
| `GET /api/results.csv` | 提供目前活動的已公布結果 CSV，無定案結果時既有回應為 `409 NO_ENDED_ROUNDS`。 |
| `POST /api/classrooms/:classroomId/activities` | 驗證目前活動，在教室交易內拒絕進行中／待審核回合、回填佔用及過期範圍。成功封存原活動並回傳新場的 `201 ClassroomLocation`。 |
| `GET /api/rounds/:id/results` | 學生僅可看到目前活動已公布的本組結果。學生回應維持 `StudentRoundResultLine[]` 或既有空資料語意。未公布回傳 `403 RESULTS_HIDDEN`。教師既有全班結果可繼續查閱。 |

結算開關屬控制台檢視。活動、角色、回填及回合驗證沿用伺服器權限與交易。
