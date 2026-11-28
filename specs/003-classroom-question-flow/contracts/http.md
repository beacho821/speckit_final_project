# HTTP 契約｜題庫、回合與結果

沿用 `Authorization`、`X-Activity-Id`、學生 `X-Member-Id`、既有 `Cache-Control: no-store` 與 `{ code, message, details? }` 錯誤格式。所有題庫及老師回合異動均須通過教師授權；學生提交仍限有效組別身分。新資料欄位由 `shared/api.ts` 定義。

## 題庫及匯入

| 入口 | 請求與成功回應 |
| --- | --- |
| `POST /api/worksheet/import`、`POST /api/worksheet/import/xlsx` | 保留現有 Google／XLSX 選擇與提交格式。沿用候選工作表及預覽的形狀，在各單位附上有序題目 `{ questionId, prompt, missingPrompt }`，原計數及 `questionIds` 仍可取用。 |
| `POST /api/questions` | 教師傳 `{ questionId, prompt }`。201 回傳帶有 `questionKey, questionId, unitId, prompt, questionRevision` 的新增單題。 |
| `PATCH /api/questions/:questionKey` | 教師傳 `{ questionRevision, prompt?, acceptedAnswersText? }`，至少包含一個可編輯欄位。用原樣多行欄位傳標準答案；200 回傳教師題目資料與新版本。允許清空備課中的標準答案草稿，開題仍須完整。 |

題號及題幹缺漏或題幹只有題號回 422。重複手動題號或匯入衝突回 409，提供相關完整題號。活動進行中、待確認判分、題目已開過、版本過期均以 409 拒絕不適用的題庫異動；題目鍵已不存在時回 404。來源替換未通過時保留原題庫與準備回合。連線中斷須先查最新完整視圖，匯入仍沿用現有待確認規則。

## 回合

| 入口 | 請求與成功回應 |
| --- | --- |
| `POST /api/rounds` | 沿用 `{ unitId }`／201，選取同一題庫中的手動或匯入單位。已有開放或待確認判分回合時回 409。 |
| `POST /api/rounds/:id/start` | 成功回 200 並固定作答項目、標準答案與現有公平等待資料。題幹或標準答案缺漏時回 422，`details` 帶 `missingPromptQuestionIds` 與 `missingAcceptedAnswerQuestionIds`；回合仍為 `preparing`。已開題或當前回合已換時回 409。 |
| `POST /api/rounds/:id/submissions` | 維持 `{ answers: [{ questionId, text }] }`／201 及各組一次、完整作答、公平等待規則。成功只回本組收件確認。停止收件後回 409。 |
| `POST /api/rounds/:id/end` | 停止收件、固定收件結果及初判後回 200，`phase: reviewing`。結果仍未公布。錯誤階段或過期回合回 409。 |
| `PATCH /api/rounds/:id/review` | 教師傳 `{ reviewRevision, grades?: [{ groupId, questionId, correct }], supplements?: [{ questionId, text }] }`。至少有一筆修改；空白補答可清除草稿。以本次修改後的判分驗證補答資格。針對有組答對的題目提交非空補答，或組別、題號、布林型別不符及重複項目，回 422。成功回 200 與最新草稿版本。 |
| `POST /api/rounds/:id/publish` | 教師傳 `{ reviewRevision }`。成功回 200，`phase: ended`、可空的 `winnerGroupId`。缺補答回 422 並回傳 `missingSupplementQuestionIds`。同一已公布回合再送時回 200 及既有公布摘要。 |

需使用複核版本的異動，須在當前回合及版本相符時提交；過期回 409，提示重新整理及核對尚未儲存的內容。每次儲存先驗證整筆請求。回應未收到時以不帶 `after` 的完整活動視圖確認當前階段及已儲存狀態。師生於無權操作時維持既有 401／403 回應。

## 視圖與已公布結果

- `GET /api/view[?after=…]` 沿用 200／204 長輪詢。共用視圖保留目前階段、公開單位識別、題號和已公布回合識別碼。老師選題清單含有序題幹及缺漏狀態，當前題目可帶標準答案和題目版本，複核階段含各組已收答案、初判、最終判分、待補題號、已存補答及複核版本。
- 學生在 `preparing` 取得已選題號，在 `active`／`reviewing` 取得當前題幹及本組答案、收件狀態及適用的等待時間。未公布前不提供本組順位、他組答題狀態或任何判分。所有學生輸出均排除標準答案、題庫內部欄位及原稿內容。
- `GET /api/rounds/:id/results` 保留陣列，每個題目的列含原 `questionId, groups`，新增 `prompt, winnerGroupId` 與選用的 `teacherAnswer`；組別列新增可空的 `correct`。空的 `winnerGroupId` 代表無勝組。未公布維持 403，找不到回合回 404。
- `GET /api/results.csv` 沿用教師專用下載，未有已公布回合時回 409。格式見[介面與匯出契約](ui-and-exports.md)，可匯出純手動活動。
- `POST /api/worksheet/writeback` 保留已寫入、已相同、無勝組及原稿衝突語意。純手動與本機來源回應不支援並建議下載 CSV。有 Google 來源但沒有應回填的已公布勝組答案時可直接回空寫入結果及提示。回填輸入是當次已公布回合快照，維持忙碌鎖、原稿驗證與批次寫入後重讀。
