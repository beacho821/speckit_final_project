# HTTP 與同步契約

本文件取代 001 的環境組碼、全量名單及學生僅記憶體登入限制；未變更的回合、結果、CSV 與 Google 回填衝突語意沿用 [001 HTTP 契約](../../001-classroom-buzzer/contracts/http.md)。所有路徑前綴為 `/api`，錯誤為 `{code,message,details?}`，message 及可見 details 使用正體中文，回應設 `Cache-Control:no-store`。

機敏值來源與保存遵守憲章 2.0.0：部署密碼／金鑰由環境提供；伺服器碼表只存活動記憶體並供授權教師查看；學生只可在本人分頁 sessionStorage 暫存本組碼及恢復資料，重新驗證後才授權，登出或得知撤權／過期即清除。教師密碼不存 Web Storage。

## 身分驗證

- 每次請求由 fetch 明確設定 Basic Authorization：UTF-8 的 `teacher:教師密碼` 或 `student:加入碼` 經 Base64。Base64 不是加密，服務限本機 `127.0.0.1`，本次不擴充為外網部署。
- 登入以外的請求必帶 `X-Activity-Id`；學生另帶 `X-Member-Id`。後端逐次核對碼仍有效、所屬組存在及成員屬於該組。activityId、groupId 或 memberId 單獨提供均不授權。
- 登入 POST 若帶原 `X-Activity-Id`，必須先確認相符；重連不得省略而把舊身分帶入新活動。一般首次登入可不帶此標頭。
- 教師密碼錯誤回「教師密碼無效，請重新輸入」；學生碼錯誤回「加入碼無效，請向老師確認」。格式無法判斷角色時提示重新選擇身分並輸入教師密碼或加入碼，不使用「憑證」。秘密不得出現在網址、錯誤、日誌或非教師碼表回應。

## 登入與組別

| 方法／路徑 | 輸入及身分 | 成功回應 | 拒絕與不變條件 |
| --- | --- | --- | --- |
| POST /sessions | 教師 Basic，空或空 JSON | 200 `{activityId,role:'teacher'}` | 密碼無效 401；不更動活動 |
| POST /sessions | 學生 Basic，JSON `{name}` | 200 `{activityId,role:'student',groupId,groupName,memberId,studentName}` | 名稱空白／超長 422；無效碼 401；舊活動 409，均不建成員 |
| GET /roster | 教師 | 200 教師名單投影，含碼、曾加入成員、locked、rosterVersion | 學生 403，不能讀取任何其他組碼 |
| POST /groups | 教師，JSON `{name}` | 201 最新教師名單投影 | 名稱無效 422／重複 409／已鎖 409，零寫入 |
| PATCH /groups/:id | 教師，JSON `{name}` | 200 最新教師名單投影，原加入碼不變 | 組不存在 404／名稱無效 422／重複或已鎖 409 |
| DELETE /groups/:id | 教師，空主體 | 200 最新教師名單投影，該碼及成員立即撤銷 | 不存在 404／已鎖 409，其他資料不變 |
| PUT /roster | 不再支援的舊介面 | 無 | 405 `ROSTER_UPDATE_REPLACED`，提示用新增／更名／刪除操作，不回傳舊 availableGroups |

同活動同組同名登入冪等，只取回原成員，不重新加入、不清答案、不改版。首次成員新增只更新教師可見版本。登出為前端操作，不刪後端成員，沒有刪除成員的端點。名稱驗證及組碼規則見 [資料模型](../data-model.md)。

教師名單格式為 `{groups:[{id,name,joinCode,members:[{id,name}]}],locked,rosterVersion}`。學生 session 不回碼，公開 `GroupSummary`、Round、結果及 CSV 均不得附加 joinCode 或全班 members。

## 學習單與回合

| 方法／路徑 | 行為 |
| --- | --- |
| POST /worksheet/import | 保留 Google JSON `{url,sheetId?}`；候選或預覽格式與本機一致，來源增加 `kind:'google'` |
| POST /worksheet/import/xlsx | 教師二進位上傳；完整媒體、檔名與多工作表契約見 [XLSX 契約](worksheet-import.md) |
| POST /worksheet/writeback | 僅教師與 Google 來源可用；XLSX 先回 409 `WRITEBACK_NOT_SUPPORTED`，訊息「本機學習單不支援線上原稿回填」，不得呼叫 Google 或測試注入回填服務 |
| POST /rounds | 仍以 `{unitId}` 選題，新的準備回合 ID 不得沿用已清除的舊回合 |
| POST /rounds/:id/start | 開始時同步鎖定名單；已清除的準備回合不可再啟動 |
| POST /rounds/:id/submissions | 學生取驗證後的組別，仍只收首次完整且符合資格的答案，不接受客戶端指定其他 groupId |
| POST /rounds/:id/end | 保留原來結束與封存順位規則 |
| GET /rounds/:id/results | 僅已結束回合可向學生公布全班結果 |
| GET /results.csv | 保留原欄位、排序、未送出列及文字轉義；不加入學生名或加入碼欄 |

匯入的「零寫入」只適用取消選檔及伺服器在驗證／發布前明確拒絕本次操作，不能據此回滾其他分頁的新資料。
請求已送出但未收到可判定結果的回應時，前端操作狀態為「匯入結果待確認」，不是一個可據以保證零寫入的 HTTP 錯誤碼。
此時立即不帶 after 取得教師完整 `/view`，以最新 worksheetPreview、roundId 及 unit 為準；取得前停用再匯入與開題，無法讀取就保持待確認，不自動重送匯入 POST，也不宣告成功或零寫入。
暫時連線失敗才保持待確認；401／撤權或 `409 ACTIVITY_EXPIRED` 仍按身分規則清除登入並返回加入流程，不重送舊操作。

## 快照與斷線重連

`GET /view` 仍接受選用 `after`，初次不帶則立即回 200 完整角色快照；相同可見版本最多等待 20 秒，無變更回 204。長輪詢每 100 ms 檢查變動及撤權；刪組時原請求也須被拒絕。

教師快照新增：

- `rosterVersion:number`：老師 App 觀察變動後取得 `/roster`；名單回應若已落後目前已知版本，重新讀取，不用舊回應覆蓋新名單。
- `worksheetPreview:null | {source,mainQuestionCount,fillCount,unitCount,units}`：來源為判別聯集，units 含 `{id,name,questionIds}`。重新登入後直接恢復來源摘要及題目選擇，不必重匯。`availableUnits` 沿用既有未開題單位。

學生快照保留 `groupId,received,ownAnswers,waitRemainingMs` 與共通回合欄位，另加最新 `groupName`；老師首回合前更名時更新該組可見版本，前端以快照組名為準，加入碼與 memberId 不變。不帶教師的上述欄位或其他組成員。自身送答、回合轉換更新該組版本；其他組送答或新成員加入不應喚醒學生。

前端每分頁只掛一個輪詢。網路例外後清除版本，800 ms 內重新請求完整快照；`online` 可提早重試。重連驗證成功後 1 秒內應顯示目前快照，即使斷線期間沒有新事件，也不能帶舊 after 再等 20 秒。401 或 `409 ACTIVITY_EXPIRED` 才清除登入；一般傳輸錯誤維持恢復資料。

送答 POST 的回應若遺失，先讀快照判斷 received，絕不自動重試 POST。收到「已接受」即顯示伺服器的 ownAnswers，不能用斷線前草稿改寫。其他 409（例如重送、未到送答時間）是業務拒絕，不能一律當成活動過期登出。

## 錯誤分類

| 狀態 | code | 意義 |
| --- | --- | --- |
| 400 | INVALID_JSON／INVALID_FILE_NAME | JSON 或編碼格式無效，不回傳原始例外 |
| 401 | UNAUTHORIZED／ACCESS_REVOKED | 密碼、碼、成員不相符或組別撤銷；清登入並提示修正 |
| 403 | FORBIDDEN | 教師／學生角色無權使用該操作 |
| 404 | GROUP_NOT_FOUND／ROUND_NOT_FOUND | 指定的組或回合不存在 |
| 409 | ACTIVITY_EXPIRED | 原活動不再有效，返回登入 |
| 409 | ROSTER_LOCKED／DUPLICATE_GROUP_NAME | 名單鎖定／同名，不更動資料 |
| 409 | WORKSHEET_LOCKED／IMPORT_SUPERSEDED | 首回合開始／較新的匯入或活動已取代本次操作 |
| 409 | WRITEBACK_NOT_SUPPORTED | 本機來源無線上原稿回填能力 |
| 413 | FILE_TOO_LARGE | 實際檔案超過 10,485,760 bytes |
| 415 | UNSUPPORTED_MEDIA_TYPE／UNSUPPORTED_CONTENT_ENCODING | 非支援上傳媒體或傳輸壓縮 |
| 422 | INVALID_NAME／INVALID_XLSX／SHEET_NOT_FOUND／NO_FILL_BLANKS／DUPLICATE_QUESTION | 欄位或學習單無效；附可修正的工作表／題號資訊 |
| 502／503 | 沿用 Google 錯誤 | 權限、服務或網路問題，保留已發布資料 |
