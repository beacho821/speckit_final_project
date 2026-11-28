# 介面契約：審核、補答與結果

| 介面或操作 | 可驗收契約 |
| --- | --- |
| 教師 `GET /api/view` 與儲存後的 `ReviewView` | 存在待審核回合時提供 `reviewRevision` 及 `supplementCandidates`。每筆候選含 `questionId`、`text`、`source`（`legacy` 或 `configured`）。既有 `supplements` 表示目前有效補答，`missingSupplementQuestionIds` 只列仍需補答且無來源的題目。學生及投影回應不含候選。 |
| 教師操作區 | 原答按完整題號及組別顯示，含順位與自動判分。每筆有「錯誤」「正確」兩個按鈕，只一種狀態選中。可用滑鼠及鍵盤。依草稿的判分與資格即時顯示「老師補答」、「自動補答」或缺少來源提示。 |
| `PATCH /api/rounds/:id/review` | payload 有 `reviewRevision`、`grades` 或 `eligibility`。空的舊 `supplements` 不構成修改。非空人工補答、重複項目、無權限、錯誤回合或版本不同的請求整筆拒絕。 |
| `POST /api/rounds/:id/publish` | 以既有 `reviewRevision` 定案，回傳原有回合識別、階段及勝組識別。缺少補答來源不阻擋定案。定案預覽須確認已儲存改判，失去回應時依目標回合結果核對。 |
| 公布結果 | 原有教師結果與 CSV 欄位呈現實際封存補答，學生依原可見範圍顯示。同一子題最多一列補答。補答不列為勝組答案，試算表回填繼續使用原勝組作答。 |

權威判分、資格與回合狀態以後端資料為準。教師按鈕只改該筆草稿。審核衝突與寫入回饋沿用原操作區。各來源與欄位限制見[資料模型](../data-model.md)。
