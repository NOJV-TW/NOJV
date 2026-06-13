# 單題測資平行化(per-submission testcase parallelization)

狀態:**設計待裁示**(2026-06-13)。本計劃只做設計與分期,**尚未動工**。

## 問題陳述

NOJV 目前一份提交的所有測資在**單一容器(Docker)或單一 K8s Job 內循序**跑完:`executeSandbox`
是「每提交一個 Temporal activity」,容器內 `runJudge` 用 `for...of` 逐案執行
(`apps/sandbox-runner/src/index.ts:316-330`)。平台的平行是**跨提交**(多 worker 同時判不同提交,
`judge` task queue 按提交量擴展),**不在單題內把測資散到多容器**。

DOMjudge 能把一份提交拆成 per-testcase judgetask 分散到多台 judgehost。差異根因:

1. **編譯產物從不離開容器** —— NOJV 在 run 容器內編譯,binary 活在 tmpfs `/workspace`,容器結束即毀;
   要 fan-out 就得每個 shard 各自重編譯。
2. **activity 粒度太粗**(一提交一個 `executeSandbox`)。
3. K8s interactive 已是 per-case Job,但仍循序(`k8s-executor.ts:461-475`)。
4. **ConfigMap 1 MB 硬上限**(`k8s-configmaps.ts:10`)限制單次能塞多少測資資料到 K8s。

**這是效能/延遲優化,不是正確性或功能缺口。** 對教學規模(數十~數百並發),跨提交平行通常已足夠;
單題內平行只有在「**一份提交有很多慢測資、又要壓低那一筆延遲、且有閒置資源**」時才有感。

## 候選方案比較

| 方案                                                      | 機制                                                                                                                   | 加速                                                        | 工作量                             | 風險                                                                     | 教學規模適配                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| **A. ShardingExecutor 薄包裝**                            | `SandboxExecutor` 裝飾器:把一個 `SandboxRequest` 切成 G 組,`Promise.all` 各自走現有 `inner.execute()`,依 `.index` 合併 | G 倍(G=2-4)單筆 run 階段延遲下降;每 shard 重編譯(小 G 攤提) | **小(~90 行 + 工廠 3 行 + 1 env)** | **低**(全程重用既有硬化路徑;唯一風險點=index 合併,以等價測試守住)        | **最佳**;預設關閉=零成本,K8s 順帶把 1 MB ConfigMap 上限變 per-shard |
| B. execute() 內 fan-out + per-host 編譯快取 + Indexed Job | compile-once + 內容定址快取 + per-testcase shard + 公平性 semaphore                                                    | 最高(尾端題 5-20x,需閒置資源)                               | **大**                             | **高**(可寫快取掛載=污染風險;需公平性閘門防 starvation;唯一新增可寫掛載) | **過度建設**;為大型公開賽事設計,本平台不會碰到                      |
| C. K8s-native Indexed Job                                 | `completions=G, parallelism=P` 由叢集排程;Docker 退化為 bounded 併發                                                   | K8s 上 ~min(G,P);多重 subtask 題明顯;單一 set 題無益        | **大**(兩條後端路徑)               | **中高**(兩後端各測;Indexed Job 高 completions 退化;只在 K8s 生效)       | 偏生產、對現規模偏重;是 A 之後的正確升級路徑                        |

## 推薦:建 Approach A,預設關閉;B/C 延後到觸發條件

理由:A 是唯一「建置成本與這個窄payoff相稱」的方案——單一 `executor-factory` 接縫的 ~90 行裝飾器,
**不動** sandbox-runner / 計分 / Temporal activity / 兩個 executor 內部,預設 `G=1` 是**逐位元組
no-op**,直到 per-deployment 顯式開啟。兩個承載事實已驗證:

- `scoring.ts` 已用 `flatIndex` **位置式**讀取且內建 `sandboxCase?.verdict ?? "SE"` 缺口容錯
  → shard 失敗的 gap-fill 不需動計分。
- 兩後端的 kill timeout 已是 `request.testcases.length` 的函式 → 小 shard 自動縮小 kill 計時,
  **executor 零改動**。

B 的編譯快取 + 公平性機器、C 的雙後端 Indexed Job 都在解大型公開賽事的問題;其 5-20x 只在
「閒置叢集 + 多重重 subtask IOI 題」成立,本平台明確不是這種主機。若那種負載真出現,**C 是 A 的正確
升級**(A 的 shard-plan/merge 契約 forward-compatible),而 **B 的 binary-distribution-adjacent
編譯快取除非實測證明重編譯成本主導,否則一律避免**。

### Approach A 設計細節

新增 `apps/worker/src/services/sharding-executor.ts`(`class ShardingExecutor implements SandboxExecutor`):

1. **Guard 直通**:`advanced` / `judgeType==='interactive'` / `testcases.length<=1` / `G<=1`
   → 直接 `inner.execute(request)`(advanced 本就單一 grader;interactive 已 per-case;單案無從拆)。
2. **切分**:`testcases` 切成 G 個**連續組**,每組是 request 的淺拷貝(同 source/語言/limits/judgeConfig),
   只換 `testcases` 子集;**`.index` 一律保留、絕不重編號**。
3. **平行**:`await Promise.all(shards.map(s => inner.execute(s)))` —— 每 shard 自己寫 temp dir / ConfigMap、
   自己容器內編譯、只跑自己那組(standard 或 standard+per-shard validator job)。
4. **合併**:攤平所有 `shardResults[].testcaseResults`,依 `.index` **排序重建**成 `buildSandboxTestcases`
   原始順序。
5. **失敗 gap-fill**:任何 shard 回 SE 或缺 index → 該 index 補成 `SE`(下游計分已容忍)。

變更層級:

| 檔案                                                                               | 變更                                                                                          |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `sharding-executor.ts`(新, ~90 行)                                                 | 裝飾器全部邏輯,純編排,不碰沙箱內部                                                            |
| `executor-factory.ts`                                                              | 建好 inner 後 `return new ShardingExecutor(inner, { groups: env.JUDGE_SHARD_GROUPS })`(~3 行) |
| `env.ts`                                                                           | 新增 `JUDGE_SHARD_GROUPS`(zod int,**預設 1 = 關閉**)                                          |
| `judge.ts` / `check-standard.ts` / `standard-mode-executor.ts` / `k8s-executor.ts` | **不動**(回傳形狀不變;timeout 已是測資數函式)                                                 |
| `tests/integration`                                                                | G=1 vs G=3 **逐位元組等價**測試 + shard-SE gap-fill 測試                                      |

不變量保全(全部已逐項確認):run/answer 隔離、ALL_OR_NOTHING 需完整結果集、index 順序、
六項硬化旗標、16 MB buffer(反而每 shard 各自一份更嚴)、kill timeout 自動縮放、per-case CPU 計時、
heartbeat/hung 偵測、rejudge 取消、stale reaper/system_error、SSE 只發一次、checker 兩階段隔離。
**唯一高風險接縫 = index 合併**,由等價測試把關。

## 分期

- **Phase 0 — 先量測,不 fan-out(硬閘門)**:加 per-submission 判題指標(測資數、run 階段總 wall、
  編譯時間、端到端延遲 + context tag),走既有觀測路徑。**2-4 週真實資料**回答:是否真有提交滿足
  「N≥~10 測資 ∧ run 階段時間遠大於編譯 ∧ 有人在等」?若判題對所有真實題目都已夠快 → **停,別建 Phase 1**。
- **Phase 1 — ShardingExecutor,預設關閉(可 ship)**:依上節實作 + 兩個測試。退出條件:G=1 等價測試證明
  no-op、gap-fill 測試綠、Docker + K8s 皆綠、合進去仍預設關。
- **Phase 2 — 在一個有重題的 deployment 開 G=2-3 驗證**:看 Phase 0 指標確認延遲下降、輕題無編譯回歸、
  K8s ConfigMap headroom 改善。無可量測效益 → 退回 G=1 收尾(A 建對了但暫時用不到)。
- **Phase 3(延後,觸發閘門)— 升級到 Indexed Job(Approach C)**:僅當觸發條件成立才做,重用 A 的
  shard-plan/merge 契約。**除非實測證明重編譯成本主導,否則永不建 B 的編譯快取。**

## 風險

- **index 合併契約靜默壞掉 → 判錯題**(scoring 走無 testcaseSetId 的 flat flatIndex)。緩解:slice 時保留
  原 `.index`、依 index 排序合併(非完成順序);G=1 vs G=N 逐位元組等價測試是必過閘門。
- **重編譯浪費 CPU(重模板 C++);佇列飽和時 fan-out 反而搶跨提交平行**。緩解:G 小(2-3,絕不 per-case);
  預設 1;Phase 0 先確認 run 階段主導;文件註明「只在閒置資源時有益」(同 DOMjudge)。
- **本平台規模根本不需要 → 過早建置**。緩解:Phase 0 是硬閘門;Phase 2 可乾淨退回 G=1;預設關閉讓押錯只賠 ~90 行。
- **shard SE gap-fill 可能遮蔽系統性失敗**。緩解:worker 死亡走既有 stale reaper → submission-level system_error;
  加測試斷言「shard SE → per-case SE」與「worker 死 → submission system_error」兩路徑分明。

## 待裁示(實作前需回答)

1. **真實測資數 / run 時間分佈如何?** 沒有 Phase 0 資料無法判斷是否有任何提交會受益——必須先量。
2. **單筆判題延遲現在是真痛點嗎?** 還是跨提交平行 + 既有 rejudge 10-way 批次已足夠?若沒人在等,可無限延後。
3. **G 是 per-deployment env 還是 per-problem(老師對重題才開)?** per-problem 更精準但要 schema/UI;
   per-deployment env 較簡單、符合薄版目標——**建議先用 env**。
4. **連續切 vs round-robin?** 兩者在 index 排序合併下都正確;連續切讓 subtask 的 case 留在同 shard。確認可接受。
5. **生產 deployment 跑 Docker 還是 K8s?** ConfigMap 上限修復與 Indexed Job 升級只對 K8s 有意義。

## 觸發條件(何時才值得建)

**建 Phase 1 的門檻(全部滿足):**(1) 提交 ≥10 測資且 run 階段 wall ≥ ~3× 編譯時間(run-dominated);
(2) 那些提交端到端延遲常 >~30-60s 且有人在等(互動賽即時回饋、或老師清大提交的 rejudge);
(3) 此模式**反覆出現**(非一次性)。低於此門檻 → A 過早,維持 G=1。

**升級 Phase 3 / Approach C:** 反覆出現 IOI 式多重重 subtask 題(如 ≥8 個 testcaseSet 各數十秒)跑在
有閒置容量的 K8s 上(賽末/rejudge 風暴),且 A 的 G=2-3 實測仍不足。**永不建 B 編譯快取**,除非 profiling
獨立證明重編譯成本主導。

## 完成後

本計劃移至 `docs/plans/completed/`。與本次「DOMjudge 對齊」計劃
(`2026-06-13-domjudge-alignment.md`)正交,兩者互不阻塞。
