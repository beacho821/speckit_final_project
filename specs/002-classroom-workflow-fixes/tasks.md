# 工作清單：開課設定、學習單匯入與學生加入流程修正

**功能目錄**：`specs/002-classroom-workflow-fixes`\
**建立日期**：2026-11-17\
**輸入**：[規格](spec.md)、[計畫](plan.md)、[研究](research.md)、[資料模型](data-model.md)、[HTTP 契約](contracts/http.md)、[XLSX 契約](contracts/worksheet-import.md)、[介面與啟動契約](contracts/ui-and-startup.md)、[驗收指南](quickstart.md)。\
**狀態**：63 項工作已完成；實際驗證、替代測試方式與未執行的雲端實測見 [驗證紀錄](validation-results.md)。

**文件修正**：2026-11-17 已依分析 C1、I1、A1 同步憲章 2.0.0、伺服器／學生分頁保存範圍與「匯入結果待確認」驗收；工作編號與數量不變；下列完成狀態已依本次實作及驗證更新。

**測試依據**：規格 FR-023 及專題憲章明文要求每項功能至少一個正常與一個邊界案例，故包含必要單元、契約、整合及元件測試。每個故事先寫測試並確認因尚未實作的預期行為失敗，再進行實作；不能把語法錯誤、缺測試資料或本機連接埠 EPERM 當成有效的失敗證據。

## 格式與路徑

每個工作使用 `- [ ] T編號 [P?] [US?] 描述＋檔案路徑`。US1 至 US5 對應規格的情境一至五；準備、共用基礎及最後整合不標故事。任務內的檔案為專案根相對路徑，新檔依工作建立，不能因尚不存在就略過。引用規格的欄位限制使用「」保留，詳細錯誤狀態以契約為準。

`[P]` 僅表示相依工作完成後，可與同一批、不同檔案的工作平行；不授權跨越依賴、同時修改共用檔案或自行新增代理。任務內的明確依賴與下方平行範例共同決定可執行批次。串行工作避免同時修改 `backend/src/app.ts`、`shared/api.ts` 或 `frontend/src/App.tsx`。

不新增套件、資料庫、個人帳號、在線心跳、XLSX 回填下載或外網部署。保留兩項澄清：成功換學習單才清舊選題並保留名單；登出／斷線保留曾加入名稱、允許有效身分重連且不重送答案。

## 階段一：準備與測試共用設施

**目標**：沿用現有專案與依賴，準備後續測試，不重新初始化或安裝新套件。

**獨立驗收**：確認參考快照校驗值及既有基準紀錄；測試輔助程式不暴露密碼，副本不覆寫原始參考檔。

- [X] T001 核對 plan.md 的現有 15 檔／43 案例與型別檢查基準、三張 002 圖及參考檔 SHA-256，建立實作驗證紀錄；若程式自上次基準後未變更就沿用，不重複執行相同基準。 檔案：`specs/002-classroom-workflow-fixes/plan.md`、`specs/002-classroom-workflow-fixes/references/README.md`、`specs/002-classroom-workflow-fixes/validation-results.md`。
- [X] T002 [P] 建立共用隔離設定、臨時 HTTP 服務啟停與授權標頭輔助；測試秘密隨執行產生且不輸出，後續教師建組／學生加入輔助隨故事接上真實端點，不以繞過驗證取代契約測試。 檔案：`tests/helpers/classroom.ts`。（依賴：T001）
- [X] T003 [P] 以現有 ExcelJS 建立移動欄列、多頁、富文字／公式、重複題號、空白及損毀／加密拒絕資料的產生或載入輔助，並準備仍為有效 XLSX 的精確 10,485,760-byte 與加一檔；只寫暫存副本，不覆寫兩份原始快照。 另產生含題組與單題、至少 5 個搶答單位的演練副本供 T061 使用，兩份原始快照仍保持不變。 檔案：`tests/fixtures/xlsx-variants.ts`、`specs/002-classroom-workflow-fixes/references/single-questions.xlsx`、`specs/002-classroom-workflow-fixes/references/mixed-questions.xlsx`。（依賴：T001）

**階段檢查點**：測試資料與輔助工具已就緒，不把原始 XLSX 當作可修改輸出。

---

## 階段二：共用基礎（阻擋全部故事）

**目標**：先建立跨故事使用的 DTO 與活動內資料容器；此階段完成前不開始故事實作。

**獨立驗收**：公開組別仍不含秘密，活動初始空白、版本非負，舊程式維持可編譯；新契約於對應故事整合後取代舊介面。

- [X] T004 新增跨故事 DTO：公開 GroupSummary「每組僅 {id,name}」「不含加入碼或成員」；教師名單含 groups／locked／rosterVersion，學生 session 必含 groupId／groupName／memberId／studentName 且「不回傳加入碼或密碼」，預覽為 null 或完整摘要；先增加具名型別，對外舊簽章由故事整合時替換。 檔案：`shared/api.ts`。（依賴：T002、T003）
- [X] T005 擴充 Activity 初始化及版本工具：groups 空陣列；rosterLocked「首回合開始時由 false 變 true，至程序重啟前不可解除」；joinCodes「有效組各一筆，伺服器僅存活動記憶體，只供驗證及教師投影；學生本人分頁暫存依下節獨立規則」；usedJoinCodes「包含目前及已撤銷的碼，刪組不移除，重啟清空」；members「只記錄本活動曾加入的名稱，不追蹤在線狀態」；rosterVersion「非負整數」、importGeneration「非負操作序號」、worksheet 為「Worksheet | null」。 另逐字遵守 Activity.id「所有既有活動請求必須相符；公開 ID 本身不授權」、groups「順序用於顯示及既有結果；不含加入碼或成員」、worksheet「完整驗證後整體發布」、rounds「沿用準備、進行、結束；成功更換來源清除所有準備回合」、viewVersions「成員新增只通知教師；原有他組送答隔離保持不變」，importGeneration「本機與 Google 共用；屬競態控制，不是已發布業務資料」。 檔案：`backend/src/activity.ts`、`tests/unit/activity.test.ts`。（依賴：T004）

**階段檢查點**：共用基礎完成，才可進入 US1；新增欄位不改變秘密投影與既有順位。

---

## 階段三：US1 單一開發啟動指令（P1，最小交付）

**目標**：從根目錄讀取設定，單一 npm run dev 即可開啟前端並以教師密碼登入空名單。

**獨立驗收**：正常根 .env、外部覆寫、只有外部設定、缺少必要值、舊組碼變數、非預設連接埠、停止與啟動失敗清理皆符合契約。

### 測試（先建立並確認預期失敗）

- [X] T006 [P] [US1] 先補設定正常及邊界測試：根檔／外部優先、缺值與空白、檔案不存在、不可讀、Google 可省略或提供無效值、舊 GROUP_CODES_JSON 缺少或錯誤都忽略、PORT 1／65535 接受及越界拒絕；錯誤不含設定真值。 檔案：`tests/unit/config.test.ts`。（依賴：T005）
- [X] T007 [P] [US1] 先建立真實單指令啟動測試，以隔離專案設定及暫時連接埠驗證畫面與教師登入、非預設 API 代理、無第二終端、缺密碼及連接埠衝突退出非零、SIGINT／SIGTERM 清服務、重啟活動 ID 不同；測試即使失敗也關閉子程序。 檔案：`tests/integration/dev-startup.test.ts`。（依賴：T005）
### 實作

- [X] T008 [US1] 移除 loadConfig 對環境預設組碼的讀取與要求；保留 TEACHER_PASSWORD 必填及 Google 選填，PORT「未填預設 3000，提供時須為 1 至 65535 的整數」；同步把既有後端讀取 config.groupCodes 的地方改讀 Activity.joinCodes，維持空名單教師登入可用，舊名單入口由 US2 正式替換。 檔案：`backend/src/config.ts`、`backend/src/access.ts`、`backend/src/app.ts`。（依賴：T006、T007）
- [X] T009 [US1] 建立共用啟動模組並接上正式入口，載入根目錄 .env、保留已提供環境值，「只忽略 ENOENT，其他讀取錯誤須報告」；回傳可關閉的 API 服務與驗證後設定，不在匯入輔助模組時重複建立活動，不輸出秘密。 檔案：`backend/src/bootstrap.ts`、`backend/src/server.ts`。（依賴：T008）
- [X] T010 [P] [US1] 新增 Node 開發入口，由入口位置解析專案根、先用現有 TypeScript 編譯後端，再呼叫共用啟動及 Vite createServer；API 成功後才顯示前端位址，失敗／信號關閉兩服務及編譯子程序；package dev 指向入口，保留 build/start，不增加套件。 檔案：`scripts/dev.mjs`、`package.json`。（依賴：T009）
- [X] T011 [P] [US1] 設定 Vite envDir 為專案根且代理使用已驗證的 API 連接埠，維持 127.0.0.1 與預設 VITE_ 公開規則；移除範例中的 GROUP_CODES_JSON，範例及前端公開設定不得包含教師密碼或 Google 金鑰真值。 檔案：`vite.config.ts`、`.env.example`。（依賴：T009）
### 故事驗收

- [X] T012 [US1] 執行 US1 設定／啟動測試及型別檢查，驗證前端熱更新不重設活動、後端手動重啟開始新活動；更新單指令開發說明並記錄實際正常／邊界結果，尚未支援功能不得寫成已完成。 檔案：`README.md`、`specs/002-classroom-workflow-fixes/validation-results.md`。（依賴：T010、T011）

**階段檢查點**：T012 完成後，依本故事的獨立驗收決定是否可交付，未驗證不得勾選故事工作。

---

## 階段四：US2 老師建立組別與提供加入碼（P1）

**目標**：老師在介面新增、更名、刪除組別並查看碼，取代環境組別與下拉選單。

**獨立驗收**：以教師建立三組、取得不同碼、刪除一組；更名／重新登入不換碼，無效組名零寫入，首回合後鎖定，碼只出現在教師名單。學生加入可先用隔離測試資料模擬，不依賴 US3 UI。

### 測試（先建立並確認預期失敗）

- [X] T013 [P] [US2] 先新增組別服務測試，覆蓋 1／40／41 個可見字元、頭尾空白、同名、emoji／組合字、唯一 8 字碼、碰撞重產、教師密碼碰撞、刪後不回收、同名重建與同步 CRUD／開題競態；拒絕時連名單與碼表都不改。 檔案：`tests/unit/roster.test.ts`。（依賴：T012）
- [X] T014 [P] [US2] 先新增教師名單及 POST/PATCH/DELETE groups 契約測試，核對狀態碼與完整教師投影、GET 不再有 availableGroups、舊 PUT 回 405、鎖定後零寫入；學生越權的最終授權案例由 US3 access 測試補齊。 檔案：`tests/contract/roster.test.ts`。（依賴：T012）
- [X] T015 [P] [US2] 先新增名單元件測試：空清單、輸入組名新增、更名／刪除、可讀加入碼、欄位錯誤保留輸入；沒有組別 ID 下拉選單，鎖定後碼與名單仍顯示但不能修改。 檔案：`tests/components/Roster.test.tsx`。（依賴：T012）
### 實作

- [X] T016 [US2] 建立同步 CRUD 與教師名單投影；逐字落實「組名與學生名稱都先去除頭尾空白，再用 Intl.Segmenter 的 grapheme 分段計算使用者可見字元，允許 1 至 40 字」及「組名在本活動內唯一」；碼為「8 個大寫英文字母／數字」，以 crypto.randomInt 與指定 32 字元集產生，不能等於教師密碼或 usedJoinCodes 任一值；刪組清有效碼／成員但保留已用碼。 檔案：`backend/src/roster.ts`。（依賴：T013、T014、T015）
- [X] T017 [US2] 接上 GET roster 與組別 CRUD，撤除全量 PUT 與 availableGroups；所有操作同步重新驗證角色、活動及 rosterLocked，按契約回 201/200/4xx；新建／更名／刪除只提交一次，回合及結果繼續取公開 GroupSummary。 檔案：`backend/src/app.ts`、`shared/api.ts`。（依賴：T016）
- [X] T018 [US2] 接上教師 rosterVersion 及公開學生 groupName 更新；版本規則為「新增／刪除／更名組、首次新增成員、名單鎖定時遞增；重複登入、登出及重連不遞增」；首回合鎖定更新教師版本，刪組喚醒撤權，碼表不得混入回合與學生快照。 檔案：`backend/src/views.ts`、`backend/src/rounds.ts`、`backend/src/activity.ts`。（依賴：T017）
- [X] T019 [US2] 把 useActivityView 的所有權提升至 App，將快照傳入教師／學生回合元件，一個分頁只掛一個輪詢；教師觀察 rosterVersion 重讀名單，忽略落後版本回應，保持既有階段、收件與歷史顯示。 同步調整既有 StudentRound 元件測試的快照輸入，保留原有收件及不可重送斷言。 檔案：`frontend/src/App.tsx`、`frontend/src/TeacherRound.tsx`、`frontend/src/StudentRound.tsx`、`tests/components/StudentRound.test.tsx`。（依賴：T018）
- [X] T020 [US2] 以獨立新增／更名／刪除請求實作名單介面，顯示組名、加入碼及曾加入名稱，移除下拉／環境組碼說明／全量儲存；鎖定只停用修改，保留完整清單及碼，錯誤保留可修正輸入。 檔案：`frontend/src/Roster.tsx`。（依賴：T019）
### 故事驗收

- [X] T021 [US2] 執行 roster 單元／契約／元件測試與型別檢查，以隔離活動驗證三組新增刪除、更名／重新登入碼不變、空名單不能開題及回合間名單鎖定；記錄結果及 US3 才會驗證的學生重連整合範圍。 檔案：`tests/contract/roster.test.ts`、`specs/002-classroom-workflow-fixes/validation-results.md`。（依賴：T020）

**階段檢查點**：T021 完成後，依本故事的獨立驗收決定是否可交付，未驗證不得勾選故事工作。

---

## 階段五：US3 學生以加入碼及名稱加入、斷線重連（P1）

**目標**：記錄曾加入成員，維持每組一次送答，重新整理及斷線可恢復且不重送。

**獨立驗收**：同組兩個名稱共用一筆送答；同碼同名重登不重複；登出／斷線保留名單；無事件、他人已送、已結束、撤權及重啟等重連案例通過。回合資料可用既有 importer 測試注入，不依賴 US4。

### 測試（先建立並確認預期失敗）

- [X] T022 [P] [US3] 先新增成員服務測試：StudentMember 為 id／groupId／name，唯一鍵「(activity.id,groupId,trimmedName)」，名稱「區分大小寫及中間空白」且不同組可同名；同時同碼同名只一筆、首次加入只改教師版本、登出／重連不刪成員、刪組才清除。 檔案：`tests/unit/members.test.ts`。（依賴：T021）
- [X] T023 [P] [US3] 先更新登入／授權契約測試，涵蓋 Basic 加入碼加 JSON name、名稱必填與 40 字上限、完整學生 session、X-Member-Id 必須與有效碼所屬組一致、memberId 不單獨授權、恢復須帶原活動 ID、教師碼表越權與撤權拒絕且無秘密洩漏。 檔案：`tests/contract/access.test.ts`。（依賴：T021）
- [X] T024 [P] [US3] 先新增輪詢正常／重連測試：每頁一請求、錯誤清 after、無新事件也取完整快照、800 ms 內重試、驗證後 1 秒內恢復、204 接續、online 提早重試；只有 401／ACTIVITY_EXPIRED 登出，業務 409 不誤登出，不自動重送 POST。 檔案：`tests/components/useActivityView.test.tsx`。（依賴：T021）
- [X] T025 [P] [US3] 先新增 App/session 測試：碼與名稱登入、同分頁重新整理先驗證、登出清暫存但保留後端成員、禁止教師密碼／localStorage、儲存不可用提示；恢復未完成就登出／切角色／再登入時，舊成功回應不能覆寫身分。 檔案：`tests/components/App.test.tsx`、`tests/unit/session.test.ts`。（依賴：T021）
### 實作

- [X] T026 [US3] 在名單服務加入同步成員驗證／冪等加入及查詢，落實已測唯一鍵、名稱字數與原樣比較；成員 ID「不是存取權杖」，「只記錄本活動曾加入的名稱，不追蹤在線狀態」；只在首次加入遞增教師版本，斷線／登出不做成員刪除。 名稱比較逐字遵守「名稱區分大小寫及中間空白，不另作會合併不同名稱的正規化；不同組可同名」，成員 ID 為「不可依名稱推算的隨機識別字」。 檔案：`backend/src/roster.ts`。（依賴：T022、T023、T024、T025）
- [X] T027 [US3] 實作學生 POST sessions 與逐次成員授權，回傳必含 groupId／groupName／memberId／studentName 且不回秘密；後續核對 X-Activity-Id、有效 Basic 加入碼與 X-Member-Id，恢復 POST 先拒絕過期活動；角色錯誤使用對應密碼或加入碼用語，不新增 token/cookie 系統。 檔案：`backend/src/access.ts`、`backend/src/app.ts`、`shared/api.ts`。（依賴：T026）
- [X] T028 [US3] 補上成員首次加入只喚醒教師、學生快照的最新 groupName、本組已收答案及狀態；長輪詢等待中也檢查撤權；更名通知原組但碼／memberId 不變，他組加入與送答不喚醒學生。 檔案：`backend/src/views.ts`、`backend/src/app.ts`。（依賴：T027）
- [X] T029 [US3] 依憲章 2.0.0 新增學生本人分頁儲存與 API 標頭輔助，只保存本組的「activityId,joinCode,studentName,memberId 及格式版本，不保存全班資料」；「教師密碼不存入 Web Storage」；登出或得知撤權／過期即刪除，單純網路失敗保留供重新驗證；伺服器碼表仍只在活動記憶體，不因學生分頁暫存而擴大公開範圍，儲存例外不阻止當次登入。 檔案：`frontend/src/session.ts`、`frontend/src/api.ts`。（依賴：T028）
- [X] T030 [US3] 依輪詢測試實作錯誤清版本、800 ms 重試及 online 快速恢復，沿用「最多等待 20 秒」「每 100 ms 檢查」後端契約；重連不自動送答，取消／卸載後不套用舊快照，顯示可理解的連線狀態。 檔案：`frontend/src/useActivityView.ts`。（依賴：T029）
- [X] T031 [US3] 在 App 接上加入碼＋名稱、先驗證才呈現與存暫存、目前姓名／組名及恢復狀態；登入操作序號搭配 AbortController，登出／切角色／新登入使舊登入、恢復、輪詢及名單回應失效；不儲存教師密碼，教師重登接回原活動。 檔案：`frontend/src/App.tsx`。（依賴：T030）
- [X] T032 [US3] 調整學生送答與歷史讀取使用成員標頭及 App 快照；同組已收時用伺服器 ownAnswers 呈現、禁止另一畫面改寫；傳輸回應遺失先同步不自動重送，保留尚未確認草稿與錯誤，組名變更不清草稿。 檔案：`frontend/src/StudentRound.tsx`、`frontend/src/RoundHistory.tsx`、`frontend/src/TeacherResults.tsx`。（依賴：T031）
- [X] T033 [US3] 將既有 HTTP 測試前置改為教師真實建組與學生真實加入，更新共用 helper；保留公平等待、近同時送答、CSV、他組資訊隔離與重啟測試，再補同組雙畫面、送出回應遺失、登出／斷線名單保留、無事件／已送／已結束／已撤銷／重啟重連，驗證零重複成員及順位。 檔案：`tests/helpers/classroom.ts`、`tests/integration/local-app.test.ts`、`tests/contract/rounds.test.ts`、`tests/contract/views.test.ts`、`tests/contract/worksheet-import.test.ts`、`tests/integration/import-preview.test.ts`、`tests/contract/results-csv.test.ts`。（依賴：T032）
### 故事驗收

- [X] T034 [US3] 執行 US3 單元、access、重連、App 與 HTTP 整合測試，驗證同組多人、晚加入、教師名單更新、學生最新組名及驗證後 1 秒恢復；逐案記錄拒絕訊息、成員／送答／順位未變更，不把 stub importer 當成已完成本機 XLSX。 檔案：`specs/002-classroom-workflow-fixes/validation-results.md`、`specs/002-classroom-workflow-fixes/quickstart.md`。（依賴：T033）

**階段檢查點**：T034 完成後，依本故事的獨立驗收決定是否可交付，未驗證不得勾選故事工作。

---

## 階段六：US4 本機 XLSX 匯入（P1）

**目標**：以本機檔案及明確工作表建立可用搶答單位，保留 Google、CSV 與原子發布保護。

**獨立驗收**：無 Google 設定時，單題／混合快照分別為 6／4 回合且各 6 填空；多頁、主格、移位、大小上限、無效檔及晚回應皆正確，成功換來源才清舊選題。

### 測試（先建立並確認預期失敗）

- [X] T035 [P] [US4] 先擴充辨識器測試，直接讀兩份下載快照，核對單題 6 回合與混合 4 回合、各 6 填空及完整題號；覆蓋橫向表頭／答案主格、直向主題合併、移位、標記去重、不同題號同主格、同題號不同主格、富文字及公式識別拒絕。 檔案：`tests/unit/worksheet-parser.test.ts`。（依賴：T034）
- [X] T036 [P] [US4] 先新增 XLSX 來源測試，覆蓋無 Google 設定、單張自選、多頁候選零發布與明選第二張、檔內 ID 非索引、隱藏表排除、無效 ID／空白／假格式／加密／損毀／缺欄；每次拒絕核對原來源與選題不變。 檔案：`tests/unit/xlsx-source.test.ts`。（依賴：T034）
- [X] T037 [P] [US4] 先新增真實 raw HTTP 契約測試，驗證教師／活動檢查先於讀主體、標準 XLSX／octet-stream、URI 編碼檔名、拒絕 multipart／JSON／壓縮、保留 JSON 100 KB、有效檔恰 10,485,760 bytes 接受及加一回 413；不只 mock 成功 Worksheet。 檔案：`tests/contract/xlsx-import.test.ts`。（依賴：T034）
- [X] T038 [P] [US4] 先擴充匯入整合測試：本機／Google 共用序號、舊上傳尚未收完時新 Google 匯入先成功、解析期間先開題、候選／驗證未過／發布前拒絕不發布、成功只清 preparing 並保留組／碼／成員，舊回合不能再開始；另模擬已發布但回應遺失，確認完整快照反映新來源，不能斷言零寫入或回滾其他分頁更新。 檔案：`tests/integration/import-preview.test.ts`。（依賴：T034）
- [X] T039 [P] [US4] 先新增匯入元件測試，覆蓋雙來源、選檔取消不發請求、多頁確認、候選與已發布預覽分離、明確拒絕保留舊預覽／選題、忙碌禁重送與切換、成功清選題、不自動選首題、舊回應不覆蓋新畫面；回應遺失須顯示「匯入結果待確認」，不宣告成功／零寫入、不自動重送，未取得完整快照前停用再匯入與開題，暫時無法連線則維持待確認；撤權或活動過期須清登入並返回加入流程，不恢復舊操作。 檔案：`tests/components/WorksheetImport.test.tsx`。（依賴：T034）
### 實作

- [X] T040 [US4] 將 WorksheetSource 切為互斥聯集，Google 欄位逐字為「kind:'google', documentId, sheetId, sheetTitle, importedAt」，本機為「kind:'xlsx', fileName, sheetId, sheetTitle, importedAt」且「沒有 documentId，也不回填原檔」；更新 Google 建構、回填型別 narrow 及相關測試來源資料，不長期保留無 kind 分支。 檔案：`shared/api.ts`、`backend/src/worksheet/google-source.ts`、`backend/src/worksheet/writeback.ts`、`tests/fixtures/guided-notes.ts`、`tests/unit/google-source.test.ts`、`tests/unit/writeback.test.ts`。（依賴：T035、T036、T037、T038、T039）
- [X] T041 [US4] 修正共用辨識器，以合併主格取表頭／標記／答案及原值並去重，落實「相同合併主格不得建立兩個填空；同一完整題號不得指向不同主格」；保留垂直主題與子題關聯，支援 typed text 及備註，拒絕公式識別但保存原答案公式；掃描有內容格，不能硬編碼範本位置。 FillBlank 欄位逐字涵蓋「唯一完整題號、主題號、選用子題號、單位 ID、合併主格列欄、匯入時原值／原型別、識別備註及識別來源」；BuzzerUnit 含唯一 ID、名稱、完整題號與填空 ID 陣列。 檔案：`backend/src/worksheet/identify.ts`。（依賴：T040）
- [X] T042 [US4] 建立 Buffer 內容及檔名驗證、可選工作表候選與指定 ID 匯入，實際大小「上限為 10,485,760 bytes，含上限」；「本機 sheetId 為該次 XLSX 內實際工作表 ID，不能拿來當 Google gid」；fileName 只保留清理檔名、importedAt 用提交時間；「原始 Buffer、ExcelJS Workbook 與候選選擇不保存在 Activity」，共用辨識器且錯誤不外洩堆疊。 保存欄位遵守「fileName 只保存清理後的檔名，不保存原始路徑。importedAt 為提交時的時間戳」。 檔案：`backend/src/worksheet/xlsx-source.ts`。（依賴：T041）
- [X] T043 [US4] 整理兩來源共用操作開始與原子發布：開始讀主體／遠端前保留序號，完整驗證後同步檢查「活動未換、操作序號最新、首回合未開始、請求未失效」；成功才換 worksheet 及清 preparing，保留組／碼／成員，驗證未過、發布前拒絕或候選不發布；零寫入僅限制本次被拒絕操作，不回滾其他分頁的新更新，已提交但回應遺失不作零寫入保證；維持原有 Google 快照一致性及衝突檢查。 檔案：`backend/src/worksheet/import.ts`、`backend/src/worksheet/google-source.ts`。（依賴：T042）
- [X] T044 [US4] 在全域 express.json 之前註冊 XLSX 路由，依序 auth／活動／鎖定／MIME／保留 importGeneration，再 express.raw limit:10485760、inflate:false；接上候選／發布與錯誤映射、檔名解碼及正整數 sheetId，Google 路徑用相同開始／發布邏輯；學生越權在讀檔前拒絕。 檔案：`backend/src/app.ts`。（依賴：T043）
- [X] T045 [US4] 在教師快照加入 worksheetPreview，為「null | {source,mainQuestionCount,fillCount,unitCount,units}」；主題數取不同 mainQuestionId、回合數取 units 長度，重新登入仍可取得原預覽；學生不帶教師預覽或來源秘密，已有題號與回合結果保持原規則。 檔案：`backend/src/views.ts`、`shared/api.ts`。（依賴：T044）
- [X] T046 [US4] 實作雙來源匯入、File 二進位與 X-File-Name、同檔重傳選工作表、題號／主題／填空／回合預覽；單檔單頁、取消選檔不發請求、忙碌禁切換，驗證或發布前明確拒絕時維持已發布資料；回應遺失顯示「匯入結果待確認」，不宣告成功／零寫入或自動重送，請求序號忽略舊回應；原始 File 只留瀏覽器當次操作。 檔案：`frontend/src/WorksheetImport.tsx`。（依賴：T045）
- [X] T047 [US4] 把教師快照的已發布預覽傳入匯入區及選題區，成功換來源時清除舊選題及準備回合、不自動選首題；回應遺失時立即不帶 after 取得完整快照，確認前停用再匯入及開題，暫時連線失敗維持待確認；取得後按目前來源與選題恢復操作，不能宣告原操作零寫入或回滾其他分頁的新資料；撤權或活動過期則清登入並返回加入流程，不重送舊匯入，鎖定後仍可查看預覽。 檔案：`frontend/src/App.tsx`、`frontend/src/TeacherRound.tsx`。（依賴：T046）
- [X] T048 [US4] 在任何 Google I/O 或注入回填服務前拒絕本機來源，回 409 WRITEBACK_NOT_SUPPORTED 與指定中文訊息；教師結果區依 source.kind 停用回填並說明限制，CSV 仍可下載，Google 來源保留原回填流程。 檔案：`backend/src/app.ts`、`backend/src/worksheet/writeback.ts`、`frontend/src/TeacherResults.tsx`。（依賴：T047）
### 整合與回歸

- [X] T049 [US4] 補本機回填被拒絕且 Google／注入服務呼叫數為零、兩來源 CSV 欄位不變，以及共用主格辨識後 Google 逐格目標／全批衝突／提交後讀回／無勝組保留原值回歸；不可移除既有安全斷言以讓測試過關。 檔案：`tests/unit/writeback.test.ts`、`tests/unit/google-source.test.ts`、`tests/contract/worksheet-import.test.ts`、`tests/contract/results-csv.test.ts`。（依賴：T048）
- [X] T050 [US4] 新增真實 HTTP 的本機學習單端到端測試，以兩份原始快照各完成教師建組、學生加入、選題、整組送答、結束與 CSV；同時驗證主格座標、混合題組完整送答及無雲端設定，不能只注入成功的匯入結果。 檔案：`tests/integration/xlsx-classroom.test.ts`。（依賴：T049）
### 故事驗收

- [X] T051 [US4] 執行 parser／xlsx-source／raw 契約／匯入競態／元件／端到端與回填回歸，量測兩份原始檔預覽 3 秒內；記錄明確拒絕零寫入、成功換來源清選題、回應遺失待確認且不重送／不誤報、完整快照恢復正確現況、原始快照未修改與 Google 呼叫隔離。 檔案：`specs/002-classroom-workflow-fixes/validation-results.md`。（依賴：T050）

**階段檢查點**：T051 完成後，依本故事的獨立驗收決定是否可交付，未驗證不得勾選故事工作。

---

## 階段七：US5 登入術語與品牌移除（P2）

**目標**：以角色對應的密碼／加入碼／名稱顯示登入提示，移除指定品牌文字及圖示。

**獨立驗收**：教師／學生登入與錯誤、雙方工作台及分頁均無指定舊詞與品牌；欄位、頁名、姓名／組名及登出仍可用，切角色不帶入舊密碼。

### 測試（先建立並確認預期失敗）

- [X] T052 [P] [US5] 先補教師／學生登入標籤、提示及錯誤文字測試，驗證缺欄位與無效密碼／碼使用角色對應用語、切角色清輸入、舊登入回應不能恢復身分；US3 已有案例沿用，僅補缺口。 檔案：`tests/components/App.test.tsx`。（依賴：T051）
- [X] T053 [P] [US5] 先新增登入／教師工作台／學生工作台與分頁的品牌移除驗收，正向核對角色頁名、學生姓名／組名及登出仍可用，反向核對指定標題／答字品牌圖示不再呈現，不只掃原始碼字串。 檔案：`tests/components/Branding.test.tsx`。（依賴：T051）
### 實作

- [X] T054 [US5] 清理 App、API 輔助與後端登入錯誤：教師一律「教師密碼」、學生一律「加入碼」「名稱」，不再出現對使用者可見的「憑證」「組別代碼」；欄位 label 有關聯、必填錯誤可讀、狀態有提示，保留既有恢復及角色切換防晚回應。 檔案：`frontend/src/App.tsx`、`frontend/src/api.ts`、`backend/src/access.ts`。（依賴：T052、T053）
- [X] T055 [US5] 移除登入及雙工作台的「課堂線上搶答」品牌文字與「答」字圖示、刪除不再使用的品牌樣式及空白佔位；分頁 title 改「課堂活動」，保留角色標題、姓名／組名及登出，不擴大為視覺重設。 檔案：`frontend/src/App.tsx`、`frontend/index.html`、`frontend/src/styles.css`。（依賴：T054）
### 故事驗收

- [X] T056 [US5] 執行登入文字／品牌元件驗收及實際頁面檢查，涵蓋正常、缺欄位、錯誤密碼／碼、切角色、恢復中與雙方工作台；記錄指定舊詞與圖示出現次數為零，既有操作仍可用。 檔案：`tests/components/Branding.test.tsx`、`specs/002-classroom-workflow-fixes/validation-results.md`。（依賴：T055）

**階段檢查點**：T056 完成後，依本故事的獨立驗收決定是否可交付，未驗證不得勾選故事工作。

---

## 階段八：文件、跨故事回歸與交付

**目標**：按需求、成功標準及 PlantUML 完成整體驗收，記錄實際證據與未執行項目。

**獨立驗收**：全部必要自動檢查與正常／邊界案例通過；Google 原稿不作寫入驗收，若缺副本或授權須明列未執行，不能宣稱已驗證。

- [X] T057 [P] 更新根 README、環境範例與 quickstart 為實際可執行的單指令流程及最終測試檔名；移除預設環境組別與雙終端舊說明，清楚說明名單鎖定、重啟清空、曾加入成員、學生重連及本機回填限制，不含秘密真值。 檔案：`README.md`、`.env.example`、`specs/002-classroom-workflow-fixes/quickstart.md`。（依賴：T056）
- [X] T058 [P] 以三張 002 PlantUML 逐項核對最終職責、實體、授權與時序，尤其刪組撤權、重連不重送、成功匯入清準備回合；如圖需表達實作細節則同步更新且用 PlantUML CLI 產生同目錄 PNG，不能用改圖掩蓋規格未實作。 檔案：`diagrams/002-component.puml`、`diagrams/002-class.puml`、`diagrams/002-sequence.puml`、`diagrams/002-component.png`、`diagrams/002-class.png`、`diagrams/002-sequence.png`。（依賴：T056）
- [X] T059 [P] 補跨故事隔離契約測試：碼表僅教師、student session／view／Round／CSV／一般錯誤無秘密，memberId 不能授權、撤銷及過期狀態不復活、名稱／檔名只作文字；輸出不顯示測試秘密，避免重複已有案例。 檔案：`tests/contract/isolation.test.ts`。（依賴：T056）
- [X] T060 在允許本機連接埠的環境執行 npm run typecheck、npm test、npm run build，修正本功能造成的失敗並記錄實際指令、通過／失敗數與執行環境；EPERM 或未跑案例不能列為通過。 檔案：`package.json`、`specs/002-classroom-workflow-fixes/validation-results.md`。（依賴：T057、T058、T059）
- [X] T061 依 quickstart 在同一台電腦以教師及至少三組連續五回合演練（含混合題組、單題、無人送出），記錄 1 秒同步與重連、3 秒公平等待、30 秒加入及 2 分鐘建組；補實際斷線／重登／無事件／送答回應遺失與兩來源更換驗收。 連續五回合使用 T003 產生的至少 5 單位混合副本，不要求只有 4 回合的原始混合快照提供第五回合。 檔案：`specs/002-classroom-workflow-fixes/quickstart.md`、`specs/002-classroom-workflow-fixes/validation-results.md`。（依賴：T060）
- [X] T062 核對 T049／T060 已執行的 Google 匯入／回填／衝突自動回歸結果，只有新變更、失敗或未解疑慮才重跑；僅在已有獨立可編輯測試副本及授權時做實際回填，否則明列未執行與原因，不寫入兩份公開原稿、不輸出服務帳戶內容，核對本機來源確實不呼叫 Google。 檔案：`tests/unit/google-source.test.ts`、`tests/unit/writeback.test.ts`、`specs/002-classroom-workflow-fixes/validation-results.md`。（依賴：T061）
- [X] T063 依 FR-001 至 FR-023、SC-001 至 SC-007、兩項澄清與三圖彙整交付證據，只有實際完成且驗證的 task 才勾選；回報所有失敗／未執行與限制，必要案例未過不得宣稱功能完成，不將規劃時的 43 案例當成本次結果。 檔案：`specs/002-classroom-workflow-fixes/tasks.md`、`specs/002-classroom-workflow-fixes/validation-results.md`、`specs/002-classroom-workflow-fixes/spec.md`。（依賴：T062）

**階段檢查點**：交付紀錄、必要驗收及實作／圖表一致性均已核對；未完成或未執行事項誠實保留。

---

## 相依關係與執行順序

### 階段及故事完成順序

```text
準備 T001–T003
  └─ 共用基礎 T004–T005
       └─ US1 T006–T012：單指令啟動（最小交付）
            └─ US2 T013–T021：老師名單及加入碼
                 └─ US3 T022–T034：學生名稱、身分恢復與重連
                      └─ US4 T035–T051：本機 XLSX 與原子匯入
                           └─ US5 T052–T056：完整術語與品牌清理
                                └─ 最後整合 T057–T063
```

此為避免共用檔案衝突的建議整合鏈，沒有宣稱五個故事可同時修改同一個 App 或 app.ts。US1 不需其他故事；US2 可先獨立驗證教師 CRUD，學生加入／撤權完整整合在 US3；US3 可使用既有 Google importer 測試注入來準備回合，不需要 US4 本機匯入；US4 完成搶答不需要 US5 品牌修改。各階段皆可用其專屬測試與前置資料單獨重跑。

### 故事內部順序

測試先行，接著資料與驗證、服務、端點、畫面及獨立驗收；每項工作後面的依賴都只指向較早編號。建立測試可平行，執行驗收必須等實作完成。測試寫入可平行不表示允許在其他工作正修改程式時執行整批最終驗收。

| 故事 | 關鍵相依 | 獨立可觀察結果 |
| --- | --- | --- |
| US1 | T006／T007 → T008 → T009 → T010／T011 → T012 | 單指令、根設定、空名單教師登入與失敗清理 |
| US2 | T013–T015 → T016 → T017 → T018 → T019 → T020 → T021 | 老師建立／更名／刪組並看到穩定且可撤銷的碼 |
| US3 | T022–T025 → T026–T033 → T034 | 名稱加入、曾加入名單、同組一次送答與有效重連 |
| US4 | T035–T039 → T040–T048 → T049 → T050 → T051 | 真實 XLSX 到搶答／CSV，失敗及晚回應不破壞現況 |
| US5 | T052／T053 → T054 → T055 → T056 | 角色術語、指定品牌移除及保留可用操作 |

表內範圍表示順序區段，不取代單項工作較精確的依賴；例如 T050 必須等 T049，不能同時修改相關回歸前置。

## 各故事的平行執行範例

| 批次 | 先完成 | 可平行工作 | 不衝突的檔案 |
| --- | --- | --- | --- |
| 準備 | T001 | T002、T003 | tests/helpers/classroom.ts 與 tests/fixtures/xlsx-variants.ts |
| US1 測試 | T005 | T006、T007 | tests/unit/config.test.ts 與 tests/integration/dev-startup.test.ts |
| US1 入口整合 | T009 | T010、T011 | scripts/dev.mjs／package.json 與 vite.config.ts／.env.example |
| US2 測試 | T012 | T013、T014、T015 | roster 單元、契約、元件三個測試檔 |
| US3 測試 | T021 | T022、T023、T024、T025 | members、access、useActivityView、App／session 測試各自檔案 |
| US4 測試 | T034 | T035、T036、T037、T038、T039 | parser、xlsx-source、raw 契約、匯入整合、WorksheetImport 元件各自檔案 |
| US5 測試 | T051 | T052、T053 | App.test.tsx 與 Branding.test.tsx |
| 最後整合 | T056 | T057、T058、T059 | 使用說明、三張圖、獨立隔離測試；T060 等三者都完成 |

共 23 項標示 `[P]`，屬於上表 8 個可並行批次。沒有在相同來源或相同驗證紀錄檔同時寫入的安排。

## 需求與工作追蹤

| 需求 | 主要工作 |
| --- | --- |
| FR-001、FR-002 | T006–T012 |
| FR-003 | T008、T011、T017、T020、T057 |
| FR-004、FR-005 | T013–T017、T020、T021 |
| FR-006、FR-007 | T013、T016–T018、T021、T023、T027、T033 |
| FR-008 | T014、T016–T021、T028、T033 |
| FR-009、FR-010 | T022、T023、T026–T029、T031、T033、T034 |
| FR-011 | T024、T025、T029–T034、T061 |
| FR-012、FR-013、FR-014 | T003、T035–T042、T044–T047、T050、T051 |
| FR-015 | T003、T035–T037、T041、T042、T044、T051 |
| FR-016 | T038、T039、T043、T044、T046、T047、T051 |
| FR-017 | T040、T048–T051、T062 |
| FR-018、FR-019 | T025、T031、T052–T056 |
| FR-020、FR-021 | T004、T006、T008、T014、T016–T018、T023、T027、T037、T044、T059 |
| FR-022 | T005、T007、T025、T029、T033、T061 |
| FR-023 | T001、各故事測試及驗收、T060–T063 |

SC-001 對應 US1；SC-002 對應 US2；SC-003 對應 US3；SC-004／SC-005 對應 US4；SC-006 對應 US5；SC-007 由 T050、T060–T063 跨故事驗證。兩個澄清分別落在 T038／T043／T047 與 T022／T025–T034，沒有留給實作時重新猜測。

## 實作策略

### 先交付最小可用修正

完成 T001–T012，先交付 US1：根環境設定與單一可登入的開發入口。此里程碑不宣稱老師新建組別或本機 XLSX 已完成。它能獨立驗證原始問題第一項，並為後續故事提供可用入口。

### 逐步交付

接續 US2 提供教師名單與加入碼；US3 完成學生名稱與重連，形成可操作的分組參與流程；US4 補上兩種 XLSX 格式與完整搶答／匯出；US5 完成指定文字與品牌清理。每個故事通過自己的正常／邊界驗收才勾選，最後執行全量型別、測試、建置及三圖比對。

只在變更、失敗或尚未解決的疑慮需要時擴大重測。不要為相同已通過且未變動內容重複執行測試。Google 測試使用隔離副本；無副本／授權的實測誠實註記未執行，不碰公開原稿。

### 執行與交付注意

- 維持正體中文訊息及文件，識別字與指令保留原拼法；不新增與目前驗收無關的套件或抽象。
- 舊測試的環境組碼及全量名單前置須改接真實新流程，不可刪除公平、隔離、CSV 及回填保護斷言來維持綠燈。
- 僅勾選已完成並驗證的工作；清單生成時 63 項全部保持未勾選。
- 加入碼來源及學生本人分頁恢復須遵守已修訂的憲章 2.0.0，不將其當作未核定豁免；伺服器碼表與學生本人暫存範圍分開，防洩漏與重新驗證限制均須通過。
- 完成報告依 validation-results.md 列出實際命令、結果、未執行與原因，不以本清單或規劃階段基準代替新功能驗收。
