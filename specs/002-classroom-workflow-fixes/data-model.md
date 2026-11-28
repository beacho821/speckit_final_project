# 資料模型

以 [002 類別圖](../../diagrams/002-class.puml) 為主要藍圖，延伸現有 `Activity` 與 `shared/api.ts`；以下為待實作模型，不是已存在的程式碼。

## 活動與授權資料

| 實體／欄位 | 型別與意義 | 驗證與生命週期 |
| --- | --- | --- |
| Activity.id | 隨程序建立的唯一字串 | 所有既有活動請求必須相符；公開 ID 本身不授權 |
| Activity.groups | `GroupSummary[]`，每組僅 `{id,name}` | 順序用於顯示及既有結果；不含加入碼或成員 |
| Activity.rosterLocked | boolean | 首回合開始時由 false 變 true，至程序重啟前不可解除 |
| Activity.joinCodes | `Map<groupId,joinCode>` | 有效組各一筆，伺服器僅存活動記憶體，只供驗證及教師投影；學生本人分頁暫存依下節獨立規則 |
| Activity.usedJoinCodes | `Set<string>` | 包含目前及已撤銷的碼，刪組不移除，重啟清空 |
| Activity.members | `Map<memberId,StudentMember>` | 只記錄本活動曾加入的名稱，不追蹤在線狀態 |
| Activity.rosterVersion | 非負整數 | 新增／刪除／更名組、首次新增成員、名單鎖定時遞增；重複登入、登出及重連不遞增 |
| Activity.worksheet | `Worksheet | null` | 完整驗證後整體發布 |
| Activity.rounds | `Round[]` | 沿用準備、進行、結束；成功更換來源清除所有準備回合 |
| Activity.viewVersions | 角色可見版本表 | 成員新增只通知教師；原有他組送答隔離保持不變 |
| Activity.importGeneration | 非負操作序號 | 本機與 Google 共用；屬競態控制，不是已發布業務資料 |

`StudentMember` 欄位為 `id, groupId, name`。成員 ID 為不可依名稱推算的隨機識別字，不是存取權杖。唯一鍵為 `(activity.id,groupId,trimmedName)`，以同步驗證／查找／建立確保同時登入不重複。名稱區分大小寫及中間空白，不另作會合併不同名稱的正規化；不同組可同名。

組名與學生名稱都先去除頭尾空白，再用 `Intl.Segmenter` 的 grapheme 分段計算使用者可見字元，允許 1 至 40 字。不得使用 UTF-16 `.length` 當字數。組名在本活動內唯一。

加入碼為 8 個大寫英文字母／數字，字元集與隨機策略見 [研究 R-002](research.md#r-002組別加入碼與成員分開存放)。只去除輸入頭尾空白，不自動改大小寫。新增組別時驗證名稱後產生組 ID 與加入碼，一次提交；加入碼不能等於教師密碼或 `usedJoinCodes` 任一值。

## 教師與學生投影

- `TeacherRosterResponse`：`{groups:[{id,name,joinCode,members:[{id,name}]}],locked,rosterVersion}`，僅教師可取得。
- `SessionResponse`：教師為 `{activityId,role:'teacher'}`；學生另含 `groupId,groupName,memberId,studentName`。不回傳加入碼或密碼。
- `Identity`：教師只有 role；學生另含經驗證的 groupId、memberId。請求提供的 ID 必須與有效碼所指組別一致。
- 教師 `ActivityView` 增加 `rosterVersion` 與 `worksheetPreview`；預覽含來源聯集、主題數、填空數、回合數與單位清單。學生快照不含這兩欄，不含碼表或其他組的成員名單。
- 學生 `ActivityView` 增加目前的 `groupName`；老師於首回合前更名時通知該組，前端使用最新快照更新顯示，不能一直沿用登入時的名稱。加入碼及 memberId 不變。
- `Round.roster`、結果及 CSV 繼續只取 `GroupSummary`，禁止直接序列化活動內秘密 Map。學生斷線後收到的 `ownAnswers` 必須來自已接受送答，不能用過期草稿覆蓋。

## 學習單來源

`WorksheetSource` 為互斥聯集：

| 分支 | 欄位 | 可用操作 |
| --- | --- | --- |
| Google | `kind:'google', documentId, sheetId, sheetTitle, importedAt` | 匯入、搶答、CSV、具權限時回填原稿 |
| 本機 | `kind:'xlsx', fileName, sheetId, sheetTitle, importedAt` | 匯入、搶答、CSV；沒有 documentId，也不回填原檔 |

本機 sheetId 為該次 XLSX 內實際工作表 ID，不能拿來當 Google gid。fileName 只保存清理後的檔名，不保存原始路徑。importedAt 為提交時的時間戳。原始 Buffer、ExcelJS Workbook 與候選選擇不保存在 Activity，請求結束即可釋放；多頁檔案由瀏覽器保留 File 以重傳。

`Worksheet {source,fills,units}` 沿用既有結構。`FillBlank` 保存唯一完整題號、主題號、選用子題號、單位 ID、合併主格列欄、匯入時原值／原型別、識別備註及識別來源。`BuzzerUnit` 包含唯一 ID、名稱、完整題號陣列與填空 ID 陣列。主題數以不同 mainQuestionId 計算；回合數以 units 長度計算。

表頭、標記與答案目標先解析合併主格。相同合併主格不得建立兩個填空；同一完整題號不得指向不同主格。縱向合併的主題號可連結不同列的子題作答主格。公式的原始型別與原值保留供 Google 回填比對，辨識文字不執行公式。

## 狀態轉換與原子邊界

| 操作 | 前置條件 | 單次提交效果 | 拒絕時 |
| --- | --- | --- | --- |
| 新增／更名／刪組 | 教師、活動有效、名單未鎖 | 同步更新公開組、碼表、成員及教師版本；刪組保留已用碼墓碑 | 全部不變 |
| 學生首次登入 | 碼有效、名稱合法 | 同步建立或取回同組同名成員；首次建立只改教師版本 | 不建成員、不揭露活動 |
| 登出／斷線 | 已加入 | 後端不移除成員；登出清前端狀態 | 不涉及業務寫入 |
| 重新整理／重連 | 原活動及碼有效，成員相符 | 重新驗證並讀目前快照；沿用成員 | 撤權或過期回加入流程 |
| 取得多頁候選 | 已驗證檔案可讀 | 僅回候選，未發布學習單 | 原學習單及選題不變 |
| 發布匯入結果 | 活動未換、操作序號最新、首回合未開始、請求未失效 | 換 worksheet、清 preparing 回合、通知畫面；保留所有組／碼／成員 | 原學習單、選題與名單不變 |
| 開始首回合 | 有學習單、有效選題、至少一組 | 同步鎖定名單、建立送答資格 | 保留原資料 |
| 組別送答 | 原有階段、公平等待與完整答案檢查通過 | 每組每回合唯一首次送答與順位 | 不耗用順位、不改答案 |
| 程序重啟 | 重新執行服務 | 全新活動 ID，所有活動記憶體清空 | 舊活動請求不能恢復 |

本機與 Google 解析均可非同步，完成後必須重新檢查發布條件，不能使用解析開始時的名單鎖定快照。組別 CRUD 與成員建立本身不跨 `await`，無須新增資料庫鎖。

「匯入結果待確認」是前端操作狀態，不是新增的 Activity 或 Round 階段。
驗證未通過或發布前拒絕時，本次操作零寫入；回應遺失時，伺服器可能已完成發布，
前端不得回滾、宣告成功／零寫入或自動重送，須立即取得教師完整快照確認目前來源及選題。
尚未取得快照時保留待確認狀態，停用再次匯入及開題；其他分頁已完成的新更新不得被舊快照取代。
待確認僅在暫時連線問題時持續；若驗證回報撤權或活動過期，依既有身分規則清除登入並返回加入流程，不自動恢復舊操作。

## 分頁恢復資料

依憲章 2.0.0 的限定例外，學生的 `sessionStorage` 項目保存 `activityId,joinCode,studentName,memberId` 及格式版本，只含本人組別，不保存全班資料。這是學生端的分頁暫存，與伺服器只在活動記憶體保存碼表的規則分開。它只是重新驗證的輸入；伺服器核對活動、碼、名稱後才接受。若從另一分頁複製出暫存，仍只代表同組同名，不能增加送答次數。教師密碼不存入 Web Storage。登出或得知活動過期、授權撤銷時立即刪除該項目，單純網路失敗保留供重新驗證。暫存不可用時以正體中文說明恢復限制，不讓儲存例外造成登入失敗。
