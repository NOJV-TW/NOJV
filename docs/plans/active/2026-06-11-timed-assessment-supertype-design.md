# TimedAssessment Participation 超型 — 分階段設計

> **For Claude:** 這是**設計/決策 doc**(風險#1 槓桿2 的 C 方案,使用者已選此方向)。實作前需使用者就「決策點」逐一拍板;批准後才用 superpowers:executing-plans 分階段做,**每階段一個可獨立 merge 的 PR**。這是大 migration——分階段、可回退是硬要求。

**Goal:** 把 `ContestParticipation` / `ExamParticipation` / `VirtualContest` 三張近乎同構的 participation 表收成單一 `Participation` 超型(type discriminator + 真實 FK 欄 + CHECK),**保留 DB 級 FK 完整性與級聯**,並把 3 份 `updateWithVersion` + conflict class 收成一份。

**承接:** 槓桿1(編排層 `runScoreUpdate`)已於 #117 落地。本 doc 是槓桿2 的 C 方案(非多型化 Submission FK——那會失去 FK 完整性)。

---

## 現狀:三表的共同 vs 分歧

| 欄位                                   | ContestParticipation       | ExamParticipation                                          | VirtualContest           |
| -------------------------------------- | -------------------------- | ---------------------------------------------------------- | ------------------------ |
| id / userId / version                  | ✅                         | ✅                                                         | ✅                       |
| score / penaltySeconds / subtaskScores | ✅                         | ✅                                                         | ✅                       |
| status (enum)                          | ContestParticipationStatus | ExamParticipationStatus                                    | VirtualContestStatus     |
| context FK                             | `contestId → Contest`      | `examId → Exam`                                            | `contestId → Contest`    |
| startedAt                              | ✅                         | ✅                                                         | ✅(@default(now))        |
| submittedAt                            | ✅                         | ✅                                                         | ❌                       |
| 型別專屬                               | —                          | registeredAt, disqualifiedAt, **ipPin, ipGateExemptUntil** | **endsAt**               |
| `submissions` 反向關聯                 | ✅(via participationId)    | ❌(exam submission 走 examId)                              | ✅(via virtualContestId) |
| @@unique                               | [contestId, userId]        | [examId, userId]                                           | [contestId, userId]      |

**三個硬骨頭(設計必須正面處理):**

1. **Submission 連結不對稱** — contest / virtual submission 經 `contestParticipationId` / `virtualContestId` 連到 participation;**exam submission 卻直接經 `examId` 連 Exam,不經 participation**。統一後要讓 exam submission 也能對應到 unified participation row(資料 backfill + 改 scoring 的 `findMany({examId,userId})` → 走 participationId)。
2. **型別專屬欄位** — `ipPin`/`ipGateExemptUntil`/`disqualifiedAt`/`registeredAt`(exam-only)、`endsAt`(virtual-only)。單表化 = 這些成 nullable sparse 欄,或收進 `typeData Json`。
3. **VirtualContest 語意不同** — 它是「個人時間平移重玩」,有自己的 `endsAt`、status 語意不同、不影響原賽成績。是否納入統一要先決定(見決策點)。

---

## 目標模型

```
model Participation {
  id             String  @id @default(cuid())
  type           ParticipationType   // contest | exam | virtual
  userId         String
  contestId      String?  // FK → Contest, onDelete Cascade   (type=contest|virtual)
  examId         String?  // FK → Exam,    onDelete Cascade   (type=exam)
  score          Int @default(0)
  penaltySeconds Int @default(0)
  subtaskScores  Json?
  status         String   // 統一字串 + 應用層 enum,或保留三 enum 由 type 區分
  version        Int @default(0)
  startedAt      DateTime?
  submittedAt    DateTime?
  typeData       Json?    // exam: {ipPin, ipGateExemptUntil, disqualifiedAt, registeredAt}; virtual: {endsAt}
  createdAt / updatedAt
  submissions    Submission[]
  // CHECK: (type='exam' AND examId NOT NULL AND contestId NULL)
  //     OR (type IN ('contest','virtual') AND contestId NOT NULL AND examId NULL)
  @@unique([type, contestId, examId, userId])   // 形態待定,見 Task 1
}
```

**為什麼保留真實 FK 欄(`contestId?`/`examId?`)而非單一 `contextId` 字串**:這正是與多型化(B 方案)的關鍵差異——`contestId`/`examId` 仍是有 FK 約束的欄,**onDelete Cascade 與參照完整性留在 DB 層**;`type` + CHECK 保證恰好一個非空。`typeData` 收型別專屬欄,避免一堆 sparse 欄(`ipPin` 等只在 exam gate 路徑讀,JSON 可接受;若 query 需要可日後升欄)。

---

## 分階段計劃(expand → migrate → contract,每階段可回退)

> 用 expand/contract 模式:先加新結構並雙寫,backfill,切讀,最後才拆舊。任一階段可停、可回退。

- **Stage 0 — 設計收斂(本 doc)** + 決策點拍板。
- **Stage 1 — 新表 + repo(不接線)— ✅ 已實作(PR #121)**:加 `Participation` 表 + migration(`Participation_single_context_chk` CHECK 走 migration SQL,`migrate diff` 對 CHECK 無感→無漂移,同 `Submission_single_context_chk`)。`participationRepo` + `UnifiedParticipationVersionConflict`(Stage 5 收掉舊三個後正名)。純加法零風險。
- **Stage 2 — 雙寫 + backfill — ✅ 已實作(細化:create-only)**:**只在 create 點雙寫**(`contest/exam` upsert、`virtual` create 的 repo 層 chokepoint,經 `mirrorParticipation` find-or-create——刻意不用 upsert 以避開「nullable 欄 unique + NULLS NOT DISTINCT」與「同 contest 可同時有 contest+virtual」的陷阱)。**score 更新不雙寫**——`Participation` 分數可暫時 stale,因為讀仍走舊表(Stage 4 才切讀),Stage 3 切寫入時會 re-backfill。`backfillParticipation()`(`pnpm --filter @nojv/db backfill:participation`)把現有三表搬進 `Participation`(冪等 find-or-create)。對帳測試 `participation-mirror.test.ts`。
- **Stage 3 — score dual-write — ✅ 已實作(細化:降風險)**:`runScoreUpdate` 的兩個 adapter(contest/exam)`persist` 改成 **dual-write**——舊表 `updateWithVersion` 後再 `mirrorParticipationScore`(`updateMany`,row 不存在 no-op)把分數寫到 `Participation`。舊表仍是讀來源(Stage 4 才切讀),故 dual-write 而非切換。部署時跑 `backfill:participation` re-sync 既有分數消除 Stage 2 窗口。**原 Stage 3 的「exam submission `examId`→`participationId` backfill」移到 Stage 5**(那是 Submission FK 收斂的事;runScoreUpdate 讀 exam submission 走 examId 本來就能用,Stage 3 不需要動 FK 語意)。race 測試含 dual-write 斷言。
- **Stage 4 — 切讀(進行中)**:**前置閘門 = `reconcileParticipation()`(`pnpm --filter @nojv/db reconcile:participation`)已實作**——read-only 比對 `Participation` vs 舊三表(contest/exam 比 count+score、virtual 比 count;`ok=false` 即有漂移,先跑 backfill)。**部署 Stages 1–3 + backfill 後,先在 prod 跑 reconcile 確認 `ok=true`,才可開始切讀**。
  - **已查實 mirror 對 score/status/startedAt 忠實**:contest/exam 的 status/startedAt 只走已鏡像的 `upsert`,score 走 Stage 3 dual-write;`*ParticipationRepo.update`(plain)在 domain 全無呼叫。**唯一未鏡像 = exam `ipPin`/`ipGateExemptUntil`**(走 `ip-violation` repo 直寫,屬 IP-gate 操作欄、非 standings,留 Stage 5)。
  - **standings read-switch 已完成(就一個 site)**:全 codebase 直接讀 `participation.score/penalty/startedAt/status` 的消費點**只有 `getContestWorkspaceData` 一處**(分數幾乎都從 submissions 重算),已改讀 `participationRepo.findContestParticipation`(新讀取 primitive)。平行驗證測試 + contests API 測試改走 mirror 路徑。`exam/session.ts` 的 `status==='registered'` 是寫入路徑內的操作判斷(同 tx),非 standings,不切。
  - **⚠️ 其餘 participation 讀取耦合 Stage 5,Stage 4 切不了**:scoreboard 的 participant list 來自 `contest.participations` include,但**同一查詢用 `findForContestScoreboard(participationIds)` 以舊 `contestParticipationId` 抓 submissions**——participant list 與 submission 連結都綁在舊 `ContestParticipation` id 上。切到 `Participation` 需 Submission FK 先收斂到 `participationId`(= Stage 5)。所以 scoreboard / 管理頁 participant-list **不是獨立小 PR,是 Stage 5 的一部分**。
- **Stage 5 — contract(進行中,prod 無重要資料故可不可逆)**:逐個解耦舊三表的讀寫,最後 drop。
  - **5a ✅ contest scoreboard 解耦**:`getScoreboard` 的 participant list 改讀 `participationRepo.findContestScoreboardParticipants`(type=contest),submissions 改用 `submissionRepo.findForContestScoreboardByContestId(contestId)`(submissions 本就有 `contestId`+`userId`,不需 `contestParticipationId`)。**這解開了 Stage 4 卡住的 participant-list**。chart/exam scoreboard 同模式待續。
  - **剩餘**:getScoreboardChart、exam scoreboard、各管理頁 participant list 同樣解耦 → participation 的 create/update 改以 `participationRepo` 為主寫(換掉 3 個舊 repo)→ exam submission 的 participation 對應 + Submission 的 `contestParticipationId`/`virtualContestId` 收斂(或直接 drop,因改用 `contestId`/`examId`+`userId` 對應 Participation)→ **drop 三張舊表 + 三 conflict class + 三 updateWithVersion**。
  - 每步先用平行驗證測試守門;mock-based unit test 凡呼叫 `getScoreboard` 的都要補新 repo 方法到 mock。

每階段都跑 `ci:verify` + integration;Stage 2–5 每階段先在 dev `db push` 驗證再寫 migration。

---

## 風險 / 回退

- **資料遷移正確性** — backfill 必須冪等 + 可重跑;Stage 2 雙寫期對帳(`Participation` 計數/分數 == 舊表)後才進 Stage 3。
- **exam submission 連結 backfill** 是最高風險點(改 FK 語意);Stage 3 單獨一個 PR,附對帳查詢。
- **回退** — 每階段在 contract(Stage 5)前都保留舊表 + 雙寫,任一階段出錯可切回讀舊表。Stage 5 之前無不可逆動作。
- **migrate-diff / db:docs gate** — CHECK 與 backfill 走 raw-SQL migration,注意 6.2 零漂移 gate(CHECK 不能用 Prisma schema 宣告,同既有 `Submission_single_context_chk`)。

---

## 需要你拍板的決策點

1. **VirtualContest 納不納入?** — 它語意不同(個人重玩、有 `endsAt`、不落地原賽)。**建議:納入**(它就是 type=virtual 的 participation,`endsAt` 進 typeData),但若想縮小範圍可先只統一 contest+exam、virtual 留後。
2. **型別專屬欄用 `typeData Json` 還是 sparse 欄?** — 建議 JSON(`ipPin` 等只在少數路徑讀);若 exam IP gate 的 query 需要索引 `ipPin` 則改 sparse 欄。
3. **status:統一字串 + 應用層 enum vs 保留三 enum?** — 建議統一字串集合(union)+ 由 `type` 約束哪些值合法。
4. **Submission 端收斂到哪一步?** — Stage 5 把 `contestParticipationId`/`virtualContestId`/(exam 的)`examId` 收成單一 `participationId`;或保留現有 Submission FK、只統一 participation 表(較小)。**建議:Stage 5 收斂**(否則 Submission 仍扛多欄)。
5. **何時開始?** — 這是 5 階段、多 PR 的工程。確認排程 / 要不要先做 Stage 1(純加法零風險)試水溫。
