# 題目權限與課程題庫設計

狀態：2026-09-08 實作與完整驗證進行中。權限、題庫 UI 與正式 migration 已加入工作樹；production 尚未遷移。聯合發布證據記錄於 [v1.1.0 發布計畫](2026-09-08-prod-roster-release.md)。

## 本 PR 與下一版本交接

PR #421 最初僅提交權限設計、review 結果與候選資料遷移驗證紀錄。後續實作使用 [正式 migration](../../../packages/db/prisma/migrations/20260908000002_course_problem_permissions/migration.sql)；合併設計文件不能視為課程共編功能已上線。

建立 PR 時已重新核對 `origin/main`（`02df37ef`）：[PR #412](https://github.com/NOJV-TW/NOJV/pull/412) 已包含 [storage pointer 還原修正](../../../packages/db/prisma/migrations/20260907000002_storage_pointer_map_restore/migration.sql) 及 [空 search_path 回歸測試](../../../tests/integration/db/storage-pointer-migration.test.ts)。下一版本沿用這個 migration，不新增重複修正；上線時確認它實際套用，並以新備份驗證一般還原。舊備份的還原程序沿用 [Backup & Restore](../../runbooks/backup-restore.md)。本次未重新查詢 production 是否已套用，不能以 main 已合併代替部署證據。

課程共編需依本文完成後端、UI、正式 migration 與完整升級驗證後，才可排入功能部署。本次本地候選 SQL 不可單獨套用至 production。若下一版本同時包含 course-roster 轉換，需另外完成 [course-roster 遷移契約](2026-09-07-course-roster.md) 的驗證；本文的資料不變證據只涵蓋題庫候選回填，不能替代整個版本的聯合演練。

## 範圍與已確認方向

- 題目由個人建立，owner 是個人。課程不擁有題目，題庫頁面不提供建立題目功能。
- 課程題庫包含作業、考試加入過的題目，以及成員手動加入的個人題目。
- 課程內的老師與 TA 可以共編放入該課程的題目，不以題目 owner 為限。
- 選用 public 題時，先建立獨立的 private fork，再加入課程題庫與指定活動。
- 本階段不設計一般 submission 合併、AC 認定、內容版本或重判流程；本題參考解答的建立、驗證與讀取屬於共編必需權限，不能一起延後。

依據：[Product Sense](../../product/PRODUCT_SENSE.md)、[Database](../../architecture/DATABASE.md)、[Assignments](../../specs/assignments.md)、[Exams](../../specs/exams.md)、[Security](../../operations/SECURITY.md)。

## 題目、owner 與共編範圍

每道題保留一個個人 owner，沿用 `Problem.authorId`。課程題庫只是題目與課程的共享關係；同一題可以出現在多門課，所有獲授權課程的有效老師與 TA 共同編輯同一份內容。

新增 `CourseProblem`，以 `(courseId, problemId)` 作複合主鍵，另建 `problemId` 索引，記錄加入者與加入時間。沿用 `CourseMembership`，不增加題庫角色或逐題協作者名單。新操作必須記錄實際加入者；歷史回填的加入者為 NULL，時間記錄回填時間，不捏造 owner 同意或最初加入者。

沿用最新 course-roster 模型：必須以已綁定且與 actor 相符的 `CourseMembership.userId` 及有效會員狀態授權。只有 pendingUsername、尚未綁定帳號的老師／TA 名單列不授予任何人共編權。

`CourseProblem` 是課程題目清單，只有其中的 private 題會授予共編權。Production 既有 public 活動引用也要保留在清單內，但課程關係不授予 public 原題編輯權；需要後續共編時，建立 private fork。

- 個人建立：owner 是建立者。
- 從 public 匯入課程：fork 的 owner 是執行匯入的人，包含老師、TA 或 admin；fork 為 private。
- 共編不改變 owner；原 public 題的 owner 不因來源關係取得副本權限。
- fork 只保留直接來源資訊，不同步內容、不繼承來源的課程共享或公開同意。
- 匯入者離開課程後仍是副本 owner。其他離開課程的成員失去該課程授予的共編權；若仍是 owner，或在另一個共享課程有有效共編資格，保留該獨立來源的權限。
- 題目 owner 不因題目被課程使用，就取得課程名單或課程管理權。
- 一般停用帳號保留 owner 資訊；刪除或匿名化持有題目的帳號，必須先由 owner 或 admin 明確交接給另一個個人，或刪除可合法刪除的未使用草稿。不能把 owner 自動改成課程老師或 migration 執行者。
- `Problem.authorId` 採非空與 `ON DELETE RESTRICT`；production 若出現無主題，先列出並完成明確交接，再允許遷移。現行帳號刪除流程也必須同步檢查題目持有狀態，不能只依賴 FK 報錯。

## 加入題庫與活動時的處理

| 選取來源                                     | 處理方式                              | owner  |
| -------------------------------------------- | ------------------------------------- | ------ |
| 本課程題庫內的 private 題                    | 直接重用同一道題                      | 不變   |
| 本人的 private 題                            | 建立課程共享關係並直接重用            | 不變   |
| 已發布的 public 題，包含自己持有的 public 題 | 建立 private fork，再建立課程共享關係 | 匯入者 |
| 他人 private 題，尚未分享給本課程            | 拒絕直接加入，需由 owner 分享         | 不變   |

操作新增題庫項目或修改活動的人，必須另外具備目標課程的有效老師、TA 或 admin 管理權。題目的可讀或可編輯資格，不能替代目標課程的管理資格。

老師或 TA 第一次將題目放入作業、考試時，在同一交易內建立 `CourseProblem`。題目 fork、題庫加入與活動建立／更新必須一起成功或一起回滾。

後續編輯活動或從課程題庫選題，直接重用既有 private 副本；不因操作人換成另一位 TA 就再 fork。再次從 public 選題時，介面先呈現本課程已存在的來源副本；若有多份，明確選擇，不只根據來源 ID 猜一份。再次複製是獨立操作，不默默替換已編輯的副本。

升級前已存在的活動引用維持原 ID，包括 public 原題。編輯活動其他設定或保留原選題，不得因新 resolver 而重新 fork；新增 public 選題才適用新規則。

共編資格只授權在已分享的課程內使用，不自動授予把他人的 private 題分享至另一門課、獨立競賽，或 fork 到自己名下的權利。owner 可以將自己的 private 題分享給其他課程，或複製自己的題目作獨立改編。

上述限制針對平台操作與共享關係，不能保證已能讀取完整題目的可信共編者無法手動重製內容。Bundle 整包匯出保留給 owner／admin；共編者可以匯入內容更新本題，但匯入不得更動 ownership、visibility、公開同意或共享範圍。

複製整門課時也必須遵守相同規則，不能藉課程複製擴大他人 private 題的授權範圍。跨課程複製涉及他人 private 題時，需要 owner 授權目標課程。

## Private 題的操作權限

下表中的課程老師與 TA，指本題已分享的課程內，會員狀態有效的成員。課程封存後只保留讀取，停止透過該課程執行共編及題庫變更。表格描述權限資格；既有題型限制、發布檢查、活動生命週期與刪除保護仍要另外成立。

| 操作                                     | 題目 owner           | 授權課程老師／TA           | 其他使用者 | 有效 admin                |
| ---------------------------------------- | -------------------- | -------------------------- | ---------- | ------------------------- |
| 查看完整出題內容、測資與本題參考解答     | 可以                 | 可以                       | 不可以     | 可以                      |
| 修改題敘、範例、測資、判題設定與工作區   | 可以                 | 可以                       | 不可以     | 可以                      |
| 建立與驗證本題參考解答、查看其結果       | 可以                 | 可以                       | 不可以     | 可以                      |
| 將 private 草稿發布為可使用的 private 題 | 可以                 | 可以                       | 不可以     | 可以                      |
| 使用於本課程作業、考試                   | 須另具課程管理權     | 可以                       | 不可以     | 可以                      |
| 將本題分享至另一門課                     | 須另具目標課程管理權 | 不能只憑共編資格           | 不可以     | 代辦仍須 owner 的分享授權 |
| 設定或撤回 `adminMayPublish`             | 可以                 | 不可以，除非本人也是 owner | 不可以     | 僅當本人也是 owner        |
| 刪除題目本體                             | 須符合刪除條件       | 不可以，除非本人也是 owner | 不可以     | 須符合刪除條件            |

老師與 TA 的共編範圍相同。出題能力必須按本題的資源權限判斷，不能只用平台角色 `teacher` 擋掉以平台學生身分任職的 TA。

參考解答提交仍歸實際提交者所有；授權僅涵蓋本題標記為 reference 的完整 practice 提交，不擴大到他人的一般提交、考試資料或一般重判操作。參考解答讀取與驗證必須重查本題權限，並保留現有 reference generation 的有效性檢查。

Advanced 模式的專用授權仍是額外條件，共編資格不提供特權升級。學生依既有活動與歷史參與規則查看可見題目內容，不因加入課程而取得題庫、隱藏測資或參考解答權限。

Advanced 共編者具備專用授權時，可保留本題已核准且 digest 完全相同的既有 image references；替換映像仍須驗證自己的 registry namespace 與平台 allowlist。不得因共編而取得原作者的 registry credentials 或整個 namespace 的操作權。

## 課程題庫頁面

- 入口：課程內的「題庫」，僅課程老師、TA 與 admin 能進入。
- 內容：以 `CourseProblem` 去重列出曾加入活動與手動加入的題目，可看 owner、public 來源及使用中的作業／考試。
- 動作：加入我的題目、從 public 匯入、編輯已有題目、預覽、選用至本課程活動。
- 不提供建立題目；新題從個人題目頁建立後再加入。
- 活動移除題目或刪除草稿活動，不自動刪除題庫項目，也不突然撤銷共編權。

## 解除共享、封存與刪除

- 課程未封存時，課程老師、TA、題目 owner 或 admin 可以解除本課程共享，但必須先確認本課程已無活動引用；有既有活動引用時，不可直接移除題庫關係。
- 從課程解除共享不刪除個人題目，也不影響其他課程的共享關係。
- 解除共享後，僅依賴該關係取得共編權的人失去編輯權；owner 與其他有效共享課程的權限獨立計算。
- 封存課程停止該課程授予的共編能力，保留題庫清單、完整出題內容的讀取與既有活動。owner 本身的個人權限不因課程封存消失。
- 刪除題目本體只允許 owner 或有效 admin，且限未被使用的草稿：不能有課程題庫關係、活動引用或需保留的歷史資料。admin 也不能繞過資料保留條件。已結束的 practice 參考解答驗證屬於草稿出題資料，可隨草稿刪除並排程清理 source／verdict 儲存物件；進行中的驗證與一般提交仍保留。

## Public 的發布與維護

Public 新加入課程時一律 fork，課程成員只編輯 private 副本，不直接修改 public 來源。包含 admin 將自己的 public 題新加入課程，也走同一規則；既有活動引用的承接見 production 章節。

Private 題對外公開一律建立獨立 public fork，不把課程正在共編的 private 原題直接改成 public；即使 publisher 本人是 owner 或 admin 也一樣。共編內容更新不能包含 visibility 或公開同意變更。

1. owner 依目前發布資格自行公開；或 owner 給予一次性的 `adminMayPublish` 同意，由 admin 代為公開。
2. publisher 核對內容並通過發布驗證後，建立自己持有的 public fork；若使用 owner 的一次同意則予以消耗。
3. 原 private 題及課程共編關係保留。後續 private 修改不影響 public；public 修改也不影響課程副本。
4. Public 原題按既有 owner 發布資格與有效 admin 權限維護，不從課程關係取得編輯權；不新增待審修改、同步或合併系統。

是否將所有 public 發布與維護收斂成 admin-only 尚未獲得決定。本次 production 切換不夾帶這項政策變更，也不重新指派已存在的 public owner。若日後採用 admin-only，另訂 owner 權限接管與通知／交接計畫。

admin 只採用已有提升權限的有效角色，不能用帳號的原始平台角色跳過目前的 admin-mode 邊界。owner 對公開的同意不得由課程共編者或非 owner 的 admin 代填。

## 實作邊界

- 共用判斷分為本題可讀、可編輯、owner 專屬管理、目標課程可使用四件事，不把所有操作改成同一個寬鬆的共編檢查。
- 作業／考試 creator 不是永久課程管理者，必須移除跳過有效會員檢查的 creator 捷徑。題目 owner 權限與活動 creator 權限分別處理。
- 編輯頁與所有內容 API 必須一致：題敘、測資、workspace、圖片、checker／interactor、bundle 與本題參考解答；只修選題器或頁面入口不足以完成授權。
- 每個內容 mutation 必須接收 actor，包含目前沒有 actor 的 `setWorkspaceFile`。上傳前的授權只能作早期拒絕，提交寫入時仍須重查。
- 對使用課程授權的寫入，在同一交易內鎖定並重查實際授權的 Course、CourseMembership、CourseProblem，再鎖定 Problem 寫入；鎖必須與封存、會員移除、解除共享互斥。統一鎖順序並測試撤權與上傳競爭，不能只在兩個互不相干的交易裡各查一次。
- 沿用 `forkProblemInTransaction`、`resolveActivityProblems`、既有角色判斷與發布驗證，不引入通用 ACL 框架。
- `resolveActivityProblems` 先保留資料庫中本活動已存在且未更換的引用，再處理新增選題：public 必須 fork，其次才是本課程 private 與 owner private。既有引用必須從 DB 讀取，不能接受客戶端自稱的 existing IDs。
- 獨立競賽不建立課程題庫，也不從管理競賽自動取得他人 private 題的共編權；它的選題仍遵守個人 ownership 與 public fork 規則。
- 活動進行中的內容更改、安全修題與歷史判題一致性，需要在後續內容生命週期設計處理；本權限文件不宣稱 fork 已解決同一 private 題被多個活動引用時的內容一致性。

## 後續實作驗收

1. owner 將 private 題加入 A 課程後，A 的老師與 TA 能編輯完整出題內容；A 的學生與 B 課程老師不能。
2. TA 從 public 匯入後，副本屬於該 TA；A 的其他老師、TA 可共編；原 public owner 不因來源關係取得副本權限。
3. 同一道副本再次加入 A 的作業／考試或由不同 TA 編輯活動時，維持同一題目，不建立新 fork。
4. public 題即使屬於執行選題的人，加入課程仍建立 private 副本。
5. 非 owner 的共編者無法授權公開、刪除原題、轉分享至其他課程或使用課程複製繞過授權。
6. 會員移除或課程封存立即停止對應共編授權；owner 與其他有效共享關係的獨立權限保留。
7. 從活動移除題目不抹除題庫關係；解除共享不刪除原題；存在活動引用時拒絕解除共享。
8. 任何 fork 或活動寫入失敗時，不留下孤立的副本、題庫關係或部分活動。
9. 所有內容寫入 API 採用相同權限；Advanced 專用授權與有效 admin-mode 仍獨立驗證。
10. TA 修改測資後，可重新提交本題參考解答、看到結果並完成 private 發布，但不能讀取 owner 的其他提交。
11. 已被移除的活動 creator 不能管理原活動；在上傳途中撤權時，後續未取得其他合法權限的寫入必須失敗。
12. Owner 或 admin 對課程共享 private 題執行公開，必須建立獨立 public 副本，不能改動原題 visibility。
13. 帳號刪除／匿名化遇到保留中的題目，要求明確交接；一般停用仍可執行。DB 拒絕 NULL owner 與直接刪除仍被題目引用的個人。
14. Advanced 共編者保留既有核准 digest 可成功；換成未獲授權的他人 namespace 映像被拒絕。Private bundle 匯出不因共編而自動開放。

## Review 發現與修訂原因

| 優先級 | 發現                                                                  | 必要修正                                                                                   |
| ------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| P1     | 既有考試直接引用 public，不能在 resolver 更新或 migration 中換成新 ID | 新選題 fork；舊活動引用、owner、提交及成績關聯不變。歷史 public 在題庫中不授予共編權       |
| P1     | 共編者可以改壞參考解答的有效性，卻被現行 author-only 判斷擋住重新驗證 | 將本題 reference submission 的建立、結果與有效性驗證納入共編，但不擴大一般 submission 權限 |
| P1     | 活動 creator 可繞過有效會員檢查，上傳寫入也沒有交易內 actor 驗證      | 移除 creator 捷徑；所有內容寫入傳入 actor 並與撤權同步                                     |
| P1     | 現行帳號刪除可讓題目 owner 變 NULL；匿名化也會讓交接失去責任人        | 交接／刪除 blocker、非空 owner 與 RESTRICT FK 一起落地                                     |
| P1     | 共編題可經原有 visibility 更新及 admin 自有題發布路徑原地變 public    | 普通共編排除權限欄位；private 公開另建副本                                                 |
| P1     | 真實 production 備份無法直接 `pg_restore`                             | 修復 `storage_pointer_map_valid` 的未限定 schema 函式引用，實際驗證還原後才能作為切換備份  |
| P2     | 整包匯出／匯入可繞過介面的禁止 fork 說法                              | 分開 bundle-export 權限，明確界定這是平台操作限制，不能承諾防止可信讀者手動重製            |
| P2     | Advanced 共編者即使有專用授權，也不能保留原作者 namespace 的映像      | 僅放行本題已核准的相同 digest；新映像仍依操作人的 namespace 驗證                           |

對應程式入口：[reference 驗證](../../../packages/application/src/submission/mutations.ts)、[作業權限](../../../packages/application/src/assignment/mutations.ts)、[考試權限](../../../packages/application/src/exam/mutations.ts)、[workspace 寫入](../../../packages/application/src/problem/workspace.ts)、[帳號刪除](../../../packages/application/src/user/mutations.ts)、[刪除 blockers](../../../packages/db/src/repositories/user.ts)、[public 更新](../../../packages/application/src/problem/mutations.ts)、[Advanced image 驗證](../../../apps/web/src/lib/server/advanced-image-config.ts)。

## Production 現況與遷移契約

唯讀盤點時間：2026-09-08 01:53:52（Asia/Taipei），實際目標為 single-machine k3s 的 `nojv` namespace、CNPG `nojv-pg-1`，PostgreSQL 18.4；web image 為 v1.0.4，公開 release endpoint 回報 source SHA `efe425b772a1ffea75986db67dcabcc85d8ae965`。不是 GKE 或本地開發資料庫。

| 盤點項目                         | 結果                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| 題目                             | 69：66 public、3 private；1 題有 fork 來源                                                   |
| Owner                            | 無 NULL owner；題目 owner 均未停用；2 道 public 題由平台 student、目前具有效 TA 身分的人持有 |
| 課程、活動                       | 2 課程、2 考試、0 作業、3 條考試題目引用                                                     |
| 已結束考試                       | 直接引用 2 道 public 題，分別有 109 與 2 筆提交                                              |
| 尚未開始考試                     | 2026-09-14 的已發布考試引用 1 道 private draft 題，當下無提交；不得因遷移改動其題目狀態      |
| 課程成員                         | 60 位有效學生關係、4 位有效 TA 關係、2 位有效老師關係、2 位已移除 TA 關係                    |
| 歷史提交存在但目前活動關係不存在 | 當下為 0 個 course/problem 配對                                                              |

### 回填與資料保留

1. 以現存 `AssessmentProblem → Assessment.courseId`、`ExamProblem → Exam.courseId`，加上仍能驗證活動及課程關係的歷史 Submission 配對，取 distinct 聯集回填 `CourseProblem`。
2. 歷史加入者不可由課程 owner、活動 creator 或題目 owner 推測，使用 NULL；回填時間與最早建立時間不混用。
3. 當下預期回填 3 組關係：1 private 共編項目、2 public 歷史項目。Public 歷史項目可供查看與建立未來使用的 private 副本，課程成員不因此取得 public 原題編輯權。
4. 不重建既有 Problem、不改 `authorId`／`visibility`／`status`／來源、不合併 fork、不重新指派活動引用，也不修改提交、分數、回饋、討論或判題內容。
5. 不把「先不討論 submission 語意」解讀成允許改寫歷史資料；111 筆考試提交仍維持原本的題目與考試關係。
6. 目前有 2 道無課程引用的 private 題，維持個人題目，不推測它們應分享到哪門課。
7. `INSERT … ON CONFLICT DO NOTHING` 可重跑，回填後驗證配對集合完整且無額外共享；不要只比較總數。
8. 已被移除且沒有活動引用、提交或其他可信歷史證據的舊題目加入事件，現有 schema 沒有保存，無法保證重建。不能捏造共享；新版本開始才保證完整記錄題庫加入歷史。

### 切換與回滾

1. 上線前重跑盤點：owner 缺失、停用 owner、public owner 類型、現有引用與孤兒關係、課程狀態、預期新增授權人數。快照中的數字只能作本次演練依據，不能當成上線當下的固定常數。
2. 先確認已合併的 `20260907000002_storage_pointer_map_restore` 隨版本部署，將 `storage_pointer_map_valid` 內部呼叫限定為 `public.storage_pointer_valid`。不新增重複 migration，也不能修改已套用的 20260716 migration 檔案。切換點若仍是舊 schema，需先在隔離還原目標依既有 runbook 驗證舊備份可恢復。
3. 使用既有 Helm migrator 維護流程。[deploy-release.sh](../../../packages/db/prisma/scripts/deploy-release.sh) 已在完整 `prisma migrate deploy` 前停止 web、judge worker 與 platform worker，確認全部停止後才執行此次 schema／回填。不需要為這次新增永久雙寫或 fallback。
4. 在停止寫入後取得切換點的新備份並驗證可還原；不能直接使用本次 review 的較早備份作為未來上線的回滾點。記錄不可變 image/source SHA、Prisma migration 狀態、資料表筆數與雜湊。
5. 在明確的 PostgreSQL transaction 內完成 CourseProblem 新增、回填驗證與 owner 非空／刪除約束；設定 lock／statement timeout，遇到不符合預期的資料即失敗，不自動替 owner 作決定。
6. 新 web 與 workers 必須一起承接新 schema，驗證權限後才開放流量；既有 public 維護資格暫不改，現有資料只增加清單關係與安全約束。
7. SQL transaction 失敗直接回滾。Schema 已提交但尚未開放寫入時，維持維護狀態，選擇向前修復或從切換點備份還原至新資料庫後回到對應舊版；不能只宣稱 Helm rollback 已還原資料庫與權限契約。
8. 開放新版本寫入後，不可拿舊備份覆蓋新資料。此時以向前修復為預設，任何降版都需重新驗證新產生的題庫關係及 owner 約束能否由目標版本承接。

### 實際還原演練

- Production 只執行 READ ONLY 查詢及 `pg_dump`，沒有套用 migration、修改題目或切換服務。
- 將 app DB 完整備份還原到本地獨立資料庫；沒有讓本地應用程式使用 prod URL，也沒有下載或執行學生提交的程式碼。
- 原始 `pg_restore --exit-on-error` 在 Testcase 資料載入失敗：`storage_pointer_map_valid` 的內部函式呼叫未指定 schema，而 pg_restore 使用空 search_path。
- 根因位於 [既有函式定義](../../../packages/db/prisma/migrations/20260716000011_versioned_blob_pointers_expand/migration.sql)。已在本地先還原 pre-data、修正函式，再還原 data／post-data；沒有停用資料完整性檢查。
- 從修復後的本地 DB 再做完整 dump，直接還原到第二個空 DB 成功；演練時 prod 尚未套用修正。建立 PR 時已確認 main 有相同修正，實際部署狀態交由下一版本負責人重新查證。
- 對本地候選 schema／回填執行交易回滾、正式提交、重跑、重複關係／缺失 FK 拒絕、owner 非空與刪除保護。49 張既有資料表共 3,253 筆資料的集合雜湊全數不變；新增清單關係為 3 筆，與獨立盤點的預期配對集合完全相符，漏加與額外共享均為 0。
- 本機驗證工件位於 `output/problem-permissions-review-20260908/`，包含 `rehearsal-result.json`、`rehearse.py` 與候選 SQL。工件未納入 PR；驗證範圍及結果記錄於本節，候選 SQL 不是正式 Prisma migration。兩個隔離演練資料庫已清除。
- 敏感 DB 備份保存在 repository 外且限本機使用者存取；演練輸出不含帳號憑證或學生原始碼。

### 正式上線前仍須完成

- 新權限後端、caller、題庫 UI、帳號交接／刪除處理與 Advanced／reference 路徑已實作，仍須通過完整 CI、真實 DB、瀏覽器驗證及獨立 review。
- 待正式 migration 與程式完成後，重新用當時的 prod 備份，跑完整升級及 API／UI 驗證，包含有效 TA、移除 TA、owner、非成員、admin 與撤權競爭案例。
- 本次未複製或驗證 MinIO 物件內容。候選資料遷移不改 storage pointers，也不新增 fork 或上傳物件；新版本的 fork 功能仍須驗證現有物件引用與回收計數。
- CNPG 當下沒有 `spec.backup`、Backup／ScheduledBackup 資源，namespace 也沒有備份 CronJob。雖 WAL archiver 顯示成功，這不證明存在可用的 base backup 或 PITR。此次已取得可經修復程序還原的邏輯備份，仍須建立正式切換點的備份與保留方式；[PostgreSQL 說明](https://www.postgresql.org/docs/18/continuous-archiving.html)也明確區分邏輯 dump 與 PITR。

## 下一步

依修訂契約實作並完成上述正式上線檢查；admin-only public 政策獨立決策，不阻塞保留既有資格的課程共編遷移。實作落地時同步更新 living docs，不把設計或資料庫演練寫成已部署行為。
