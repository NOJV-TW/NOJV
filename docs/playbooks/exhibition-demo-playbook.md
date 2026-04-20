# NOJV 展覽 Demo 操作手冊

這份手冊用於現場對一般觀眾與技術觀眾進行展示。
整體設計是用一條完整流程呈現平台價值：出題 -> 交付 -> 反作弊 -> 營運。

## 1. Demo 目標

透過一個連貫故事展示以下能力：

1. 建立與管理題目（含較進階的 judge 模式）。
2. 操作課程作業與競賽流程。
3. 展示安全控制（頁面鎖定、IP 策略、語言限制、冷卻與嘗試次數限制）。
4. 執行抄襲檢查並查看並排原始碼比對。
5. 展示系統可觀測性與營運面（queue/system/admin 控制）。
6. 展示本次迭代新增的工程可靠性機制（seed validation 與 hardening）。

## 2. 執行環境與帳號

## 環境需求

1. Node.js >= 24
2. pnpm 10.x
3. Docker Desktop 已啟動

## 啟動指令

```bash
pnpm install
docker compose up -d
pnpm db:generate
pnpm db:push
pnpm db:seed:validate
pnpm db:seed
pnpm sandbox:build
pnpm dev
```

## Demo 帳號（來自 seed）

所有帳號密碼皆為 `password123`。

1. 管理員：`admin` 或 `admin@nojv.local`
2. 教師：`teacher` 或 `teacher@nojv.local`
3. 助教學生：`ta-student` 或 `ta-student@nojv.local`
4. 學生：`student` 或 `student@nojv.local`

帳密登入頁面：`/admin-signin`

## 現場可直接使用的 seed 資料

1. 課程：`os-lab-spring-2026`
2. 課程作業：`hw1-process-trace`
3. 綁定課程的競賽：`midterm-systems-lab`
4. 公開競賽：`spring-qualifier-2026`（邀請碼 `spring2026`）
5. 新增的高難題目：
   - `stateful-dhcp-parser`（multi_file）
   - `memory-leak-forensics`（multi_file）
   - `noisy-oracle-hunt`（interactive）

## 3. 展前 10 分鐘檢查清單

請在觀眾入場前完成。

1. 開 3 個瀏覽器 profile/視窗：
   - 視窗 A：管理員
   - 視窗 B：教師
   - 視窗 C：學生/助教學生
2. 先確認 seed hardening gate：

```bash
pnpm db:seed:validate
```

3. 在教師視窗開啟 `/courses/os-lab-spring-2026/manage/assessments`，建立即時展示作業：
   - Title：`Demo HW Live`
   - Slug：`demo-hw-live`
   - Scoreboard mode：`hidden`
   - Problems：`warmup-sum, process-log-parser`
   - Opens：現在 - 5 分鐘
   - Due：現在 + 20 分鐘
   - Closes：現在 + 30 分鐘
   - 啟用 `pageLockEnabled`（可選，用於展示 lock redirect）
   - 啟用 `ipBindingEnabled` 並選 `notify`（可展示策略設定）
4. 在教師視窗開啟 `/contests/create`，建立即時展示競賽：
   - Slug：`demo-live-contest`
   - Title：`Demo Live Contest`
   - Problems：`warmup-sum, graph-docking`
   - Starts：現在 - 2 分鐘
   - Ends：現在 + 25 分鐘
   - Scoreboard mode：`frozen`
   - Freeze at：現在 + 15 分鐘
   - 啟用 `pageLockEnabled`
   - 啟用 `ipBindingEnabled`（notify）
   - 設定 `submitCooldownSec` 為 `20`（展示冷卻保護）
5. 產生展示資料：
   - 學生與助教學生各自對 `demo-hw-live` 的 `warmup-sum` 提交一次 AC。
   - 學生在 `demo-live-contest` 再提交一次，讓 scoreboard 有資料。
6. `warmup-sum` 可用的快速 AC 程式碼：

```python
a, b = map(int, input().split())
print(a + b)
```

## 4. 台上展示時間軸（25 分鐘）

## 第 0-2 分鐘：平台定位

畫面：landing/dashboard + 架構簡報一頁。

台詞：
"這是一個同時處理競賽、課程、反作弊與營運的整合平台。"

操作：

1. 開 `/dashboard`
2. 用一句話帶過 README 架構重點

## 第 2-5 分鐘：可靠性與防呆

畫面：terminal。

操作：

1. 顯示 `pnpm db:seed:validate` 成功
2. 說明：seed 會在寫入 DB 前先 fail-fast，擋下 script/template/testcase 缺漏與 invariant 問題

台詞：
"我們先驗證資料完整性，再進入功能展示，這是上線前的保護閘。"

## 第 5-9 分鐘：出題能力展示

畫面：`/problems/create`

操作：

1. 切換 judge modes：standard/checker/interactive
2. 切換 problem types：full_source / multi_file / special_env
3. 展示 workspace file visibility（editable/readonly/hidden）與 testcase 區塊

接著切到 `/problems` 並打開這三題：

1. `stateful-dhcp-parser`
2. `memory-leak-forensics`
3. `noisy-oracle-hunt`

台詞：
"這些題目刻意偏離基本 IO，老師透過 multi_file 題型搭配 readonly 的 driver 檔（像 DHCP 這題），讓學生只實作核心函式；再加上對抗式互動評測，展現平台的題型廣度。"

## 第 9-14 分鐘：課程營運面

畫面：教師視窗 `/courses/os-lab-spring-2026/manage`

依序走訪分頁：

1. 成員：`/courses/os-lab-spring-2026/manage/members`
2. 題庫：`/courses/os-lab-spring-2026/manage/problems`
3. 作業：`/courses/os-lab-spring-2026/manage/assessments`
4. 進度矩陣：`/courses/os-lab-spring-2026/manage/progress`

台詞：
"教師可以在同一個 cockpit 裡管理名單、發布作業與追蹤學習進度。"

## 第 14-18 分鐘：競賽與安全控制

畫面：`/contests/demo-live-contest`，再切到 `/contests/demo-live-contest/scoreboard`

操作：

1. 展示競賽計時器與狀態
2. 展示安全標籤（page lock/IP policy/language restrictions）
3. 展示 frozen scoreboard
4. 用管理員或教師開 `/contests/demo-live-contest/scoreboard`，點 `Unfreeze Board`

可選的 page-lock redirect 展示：

1. 在學生視窗（已進入 active contest）手動前往 `/dashboard`
2. 展示被重新導回 contest 上下文

## 第 18-23 分鐘：抄襲檢查流程

畫面：教師視窗 `/courses/os-lab-spring-2026/manage/assessments`

流程：

1. 在 `Demo HW Live` 點 `Run Plagiarism Check`
2. 口述狀態變化：`Starting -> Pending -> Running -> Completed`
3. 點 `View Results`
4. 若 Dolos 未找到高相似度配對，將 similarity threshold 調到 `0`
5. 點 `Compare` 開啟並排原始碼

台詞：
"老師可以在平台內直接觸發反作弊，並做可解釋的比對檢視。"

## 第 23-25 分鐘：管理後台收尾

畫面切換順序：

1. `/admin/users`（角色調整 / 停用切換）
2. `/admin/announcements`（發布與置頂）
3. `/admin/system`（DB + queue 健康度、失敗任務重試/移除）

收尾台詞：
"這不只是 OJ 介面，而是一個可營運、可維護、可治理的學習與競賽平台。"

## 5. Demo 台詞提示（Speaker Notes）

可用以下短句維持節奏：

1. "我會展示完整生命週期：建立、提交、排名、異常偵測與營運。"
2. "先做資料完整性驗證，再展示產品行為。"
3. "接著從作者視角切到教師營運視角。"
4. "這一步是反作弊：觸發、監看、檢查、比對。"
5. "最後這個管理後台，才是系統能長期存活的關鍵。"

## 6. 故障備援（Plan B）

## 若抄襲結果沒有資料

1. 將 threshold slider 調到 `0`
2. 確認同一題、同一範圍至少有兩筆 accepted submissions
3. 從 assessments 頁面重新觸發

## 若 queue 或 worker 延遲

1. 到 `/admin/system` 展示 queue backlog
2. 先切回展示已完成的 submissions/reports
3. 補充說明：架構為非同步，web 仍可回應

## 若 contest 不在 active 時段

1. 到 `/contests/create` 立刻建立一場現在開始的短競賽
2. 在新競賽重跑 page lock/frozen board 展示

## 若遇到權限阻擋

1. 確認右上角目前登入身份
2. 切到對應 profile 視窗（管理員或教師）

## 7. 功能覆蓋矩陣

用下表確認「目前所有工作項目」都有被展示。

圖例：

1. 完整：可直接在 demo 中操作此功能
2. 檢視：可看到或體驗此功能，但無法管理
3. 無：一般流程中不預期可使用

| 功能                                                                                 | 管理員      | 教師        | 助教                    | 學生             |
| ------------------------------------------------------------------------------------ | ----------- | ----------- | ----------------------- | ---------------- |
| 平台管理後台（`/admin/users`, `/admin/system`, `/admin/announcements`）              | 完整        | 無          | 無                      | 無               |
| 建立題目（`/problems/create`）                                                       | 完整        | 完整        | 無                      | 無               |
| 進階評測模式（standard/checker/interactive）                                         | 完整        | 完整        | 檢視                    | 檢視             |
| Function template 編修                                                               | 完整        | 完整        | 檢視                    | 檢視             |
| 高難 seed 題（`stateful-dhcp-parser`, `memory-leak-forensics`, `noisy-oracle-hunt`） | 完整        | 完整        | 檢視                    | 檢視             |
| 建立課程（`/courses`）                                                               | 完整        | 完整        | 無                      | 無               |
| 課程管理面板（`/courses/{slug}/manage/*`）                                           | 完整        | 完整        | 完整                    | 無               |
| 課程成員管理                                                                         | 完整        | 完整        | 完整                    | 無               |
| 課程題庫掛載與管理                                                                   | 完整        | 完整        | 完整                    | 無               |
| 發布作業                                                                             | 完整        | 完整        | 完整                    | 無               |
| 課程進度矩陣與 CSV 匯出                                                              | 完整        | 完整        | 完整                    | 檢視             |
| 觸發抄襲檢查                                                                         | 完整        | 完整        | 完整                    | 無               |
| 抄襲結果與並排原始碼比對                                                             | 完整        | 完整        | 完整                    | 無               |
| 建立公開競賽（`/contests/create`）                                                   | 完整        | 完整        | 完整（僅未綁課）        | 完整（僅未綁課） |
| 將競賽綁定課程                                                                       | 完整        | 完整        | 無                      | 無               |
| 參與競賽（`/contests/{slug}`）                                                       | 檢視        | 檢視        | 檢視                    | 檢視             |
| Scoreboard 解凍（`/contests/{slug}/scoreboard`）                                     | 完整        | 完整        | 無                      | 無               |
| 競賽安全控制（page lock、IP whitelist、IP binding、violation mode）                  | 完整        | 完整        | 完整（課程範圍）        | 檢視/受控        |
| 語言限制策略（contest/assessment）                                                   | 設定 + 檢視 | 設定 + 檢視 | 設定 + 檢視（課程範圍） | 受控             |
| 提交冷卻 / 嘗試次數限制                                                              | 設定 + 檢視 | 設定 + 檢視 | 設定 + 檢視（課程範圍） | 受控             |
| Seed 可靠性閘門（`pnpm db:seed:validate`）                                           | 完整        | 完整        | 檢視                    | 檢視             |

## 8. Demo 後重置（可選）

若要快速回到可重演環境：

```bash
pnpm db:push
pnpm db:seed:validate
pnpm db:seed
```

接著依照展前清單重新建立 `demo-hw-live` 與 `demo-live-contest`。
