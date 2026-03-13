# NOJV 平台擴展設計文件

> 日期：2026-03-13
> 狀態：已確認

---

## 功能範圍

| #   | 功能               | 方向       | 優先序      |
| --- | ------------------ | ---------- | ----------- |
| 1   | Subtask 部分分系統 | 競賽       | 1（基礎層） |
| 2   | Contest 競賽系統   | 競賽       | 2           |
| 3   | 排行榜 Scoreboard  | 競賽       | 3           |
| 4   | 學生進度面板       | 教學       | 4           |
| 5   | Admin Panel        | 平台成熟度 | 5（可平行） |
| 6   | 抄襲偵測（MOSS）   | 教學       | 6           |

---

## 1. Subtask 部分分系統

### 現狀

- `TestcaseSet` 已有 `weight: Int` 欄位，但 judge 未使用
- 目前所有 testcase 是 all-or-nothing

### Schema 變更

`Submission` 新增：

- `subtaskResults: Json?` — 每個 subtask 的判定明細

格式：

```json
[
  {
    "testcaseSetId": "xxx",
    "label": "Subtask 1",
    "weight": 30,
    "passed": true,
    "cases": [
      { "testcaseId": "a1", "ordinal": 1, "verdict": "AC", "runtimeMs": 12, "memoryKb": 3200 },
      { "testcaseId": "a2", "ordinal": 2, "verdict": "AC", "runtimeMs": 8, "memoryKb": 3100 }
    ]
  },
  {
    "testcaseSetId": "yyy",
    "label": "Subtask 2",
    "weight": 70,
    "passed": false,
    "cases": [
      { "testcaseId": "b1", "ordinal": 1, "verdict": "AC", "runtimeMs": 45, "memoryKb": 5200 },
      { "testcaseId": "b2", "ordinal": 2, "verdict": "WA", "runtimeMs": 50, "memoryKb": 5100 },
      {
        "testcaseId": "b3",
        "ordinal": 3,
        "verdict": "TLE",
        "runtimeMs": 2000,
        "memoryKb": 8400
      }
    ]
  }
]
```

### Worker/Judge 改動

- Judge 逐 `TestcaseSet` 執行，每個 set 內所有 testcase 必須全 AC 該 set 才算 `passed`
- `score` = Σ(passed set 的 weight) / Σ(all set weight) × 100
- `subtaskResults` 存完整明細供前端顯示
- 向下相容：沒有 subtask 的舊題（只有一個 TestcaseSet）行為不變

### 前端改動

- Problem Workspace 的 submission 結果顯示 subtask 明細（哪些 subtask 通過、各自分數）
- CreationPanel 建立題目時，每個 TestcaseSet 可設定 label 和 weight

---

## 2. Contest 競賽系統

### Schema 變更

`Contest` 新增欄位：

- `scoringMode: ContestScoringMode` — 計分模式
- `courseId: String?` — optional FK → Course，null 表示獨立競賽
- `frozenAt: DateTime?` — 排行榜凍結時間點
- `submitCooldownSec: Int @default(0)` — 提交冷卻秒數，0 表示不限制

新增 enum：

```prisma
enum ContestScoringMode {
  icpc
  ioi
}
```

`ContestParticipation` 新增欄位：

- `subtaskScores: Json?` — 每題每 subtask 的最佳成績快取，供排行榜用

### 計分邏輯

|          | ICPC                           | IOI                     |
| -------- | ------------------------------ | ----------------------- |
| 每題分數 | 全部 subtask 通過 = AC，否則 0 | Σ 各 subtask 最高分     |
| 排名依據 | 解題數 > 總罰時                | 總分 > 最後 AC 提交時間 |
| 罰時     | 每次 WA +20 分鐘               | 無罰時                  |
| 多次提交 | 只看最終是否 AC                | 每 subtask 取歷次最高   |

### 參與資格

- `courseId` 非 null → 檢查使用者是該 Course 的 active member
- `courseId` 為 null → 檢查 Contest visibility（public 或 JoinToken）

### 提交限制

- **Contest**：全域提交冷卻時間（`submitCooldownSec`），同一題 N 秒內不能重提
- **Assessment（作業）**：維持現有 `maxAttempts` 每題總提交次數上限

### 建立入口

- `/courses/[slug]/manage/assessments` 建立 → 自動填入 `courseId`
- `/exams` 頁面建立 → `courseId = null`，建立者選擇公開或邀請

---

## 3. 排行榜 Scoreboard

### 資料來源

`ContestParticipation.subtaskScores` 作為快取，每次提交 judge 完後更新。

### 排行榜欄位

| 欄位             | ICPC                  | IOI            |
| ---------------- | --------------------- | -------------- |
| 排名             | ✓                     | ✓              |
| 使用者名稱       | ✓                     | ✓              |
| 總解題數/總分    | 解題數                | 總分           |
| 罰時             | 總罰時                | —              |
| 每題狀態         | AC/WA 次數/首 AC 時間 | 得分/滿分      |
| First Blood 標記 | 每題第一個 AC         | 每題第一個滿分 |
| 提交次數統計     | 每題 WA 次數          | 每題提交次數   |

### 凍結機制

- `Contest.frozenAt` 設定後，該時間點之後的提交在排行榜上顯示為 `?`（pending）
- 只影響顯示，judge 照常執行
- 競賽結束後老師可手動「解凍」公開最終排名

### 分數曲線圖

- 前端用每次提交的時間戳 + 累計分數畫折線圖
- 資料從 `Submission` 表按 `contestParticipationId` 查詢，不需額外 schema

### API

- `GET /api/contests/[slug]/scoreboard` — 排名陣列 + First Blood 資訊
- `GET /api/contests/[slug]/scoreboard/chart` — 分數時間序列（前 N 名）

---

## 4. 學生進度面板

### 入口

`/courses/[slug]/manage` 下新增「學生進度」tab

### 核心視圖：學生 × 題目 矩陣表格

| 學生 | 題目 A     | 題目 B     | 題目 C    |
| ---- | ---------- | ---------- | --------- |
| 小明 | ✓ AC (100) | ✗ WA (30)  | —         |
| 小華 | ✓ AC (100) | ✓ AC (100) | ✓ AC (70) |

### 每格顯示

- 未提交：`—`
- 最佳成績：verdict + 分數（subtask 總分）
- 顏色：綠(AC/滿分)、黃(部分分)、紅(0 分)、灰(未提交)

### 上方統計

- 每題的 AC 率
- 可按 Assessment 篩選（全部 / 特定作業 / 特定考試）

### 資料查詢

- 不需額外 schema，從 `Submission` 表 group by (userId, problemId) 取每題最佳分數
- 一次 query 撈出該 course 所有成員的所有提交，server 端聚合成矩陣
- 只有 teacher/ta 權限可存取

---

## 5. Admin Panel

### 入口

新增 `/admin` 路由群組，僅 `platformRole = admin` 可存取。

### 5.1 使用者管理 `/admin/users`

- 使用者列表（搜尋、篩選 role）
- 可修改 `platformRole`（admin/teacher/student）
- 可停用帳號（新增 `User.disabled: Boolean @default(false)`，登入時檢查）
- 顯示：handle、email、學校、建立時間、最後登入

### 5.2 系統監控 `/admin/system`

- Submission queue 狀態：pending/active/completed/failed 數量（從 BullMQ API 取）
- Worker 健康：呼叫 worker `/healthz` endpoint
- 近期失敗的 submission 列表（最近 50 筆）
- Redis / DB 連線狀態

### 5.3 公告管理 `/admin/announcements`

- 公告 CRUD（使用現有 `Announcement` model）
- 欄位：標題、內容(Markdown)、置頂(pinned)、發布/草稿狀態
- 首頁已有公告顯示，只缺此編輯介面

### Schema 變更

`User` 新增：

- `disabled: Boolean @default(false)`

---

## 6. 抄襲偵測（MOSS）

### 觸發方式

老師在 Assessment 管理頁點「執行抄襲偵測」按鈕，手動觸發。

### 比對範圍

該 Assessment 下每題各學生的最佳提交，同語言互相比對。

### 實作方式

串接 Stanford MOSS 服務：

- 透過 socket 送程式碼，回傳相似度報告 URL
- 支援平台上所有語言（C, C++, Java, Python, JS, Go）
- 成熟的正規化處理（變數重命名、空白調整不影響結果）

### 結果儲存

新增 `PlagiarismReport` model：

```prisma
model PlagiarismReport {
  id                  String   @id @default(cuid())
  courseAssessmentId   String
  courseAssessment     CourseAssessment @relation(fields: [courseAssessmentId], references: [id])
  triggeredById       String
  triggeredBy         User     @relation(fields: [triggeredById], references: [id])
  status              PlagiarismReportStatus @default(pending)
  results             Json?    // pair-wise 相似度百分比
  mossReportUrl       String?
  createdAt           DateTime @default(now())
  completedAt         DateTime?
}

enum PlagiarismReportStatus {
  pending
  running
  completed
  failed
}
```

### 前端

- 老師可查看相似度超過閾值的配對列表
- 點進去可 side-by-side 比對程式碼

---

## 實作順序

1. **Subtask 部分分系統** — 基礎層，Contest 和進度面板都依賴
2. **Contest 系統** — Schema + 前端路由 + 計分邏輯
3. **排行榜** — 依賴 Contest + Subtask
4. **學生進度面板** — 依賴 Subtask 分數資料
5. **Admin Panel** — 獨立，可與 4 平行開發
6. **抄襲偵測（MOSS）** — 獨立，優先級最低
