# NOJV Sandbox Runner

> 在隔離容器內編譯與執行使用者程式碼、比對或驗證輸出，以 JSON 行回報結果給 worker。

Stage 拓撲、限制與 verdict 規則見 [Judge Pipeline](../../docs/architecture/JUDGE_PIPELINE.md#standard-mode-pipeline)。

## 職責

- 依 `SANDBOX_PHASE`（或 `config.mode.kind`）執行一個 phase：

  | Phase         | 容器                      | 工作                                                                                       |
  | ------------- | ------------------------- | ------------------------------------------------------------------------------------------ |
  | `materialize` | K8s init container        | 把 `/payload` 的 ConfigMap shards 依 manifest 驗證 SHA-256 後還原到 `/submission`          |
  | `run-stage`   | run（不含答案）           | 編譯一次到 `/artifact`，逐 case 執行，把 stdout 與 SHA-256 寫到 `/outputs`，回報 `rawRuns` |
  | `judge-stage` | judge（run 結束後才啟動） | 驗證 output hash，以 `compareStandard` 比對或編譯並執行 DOMjudge validator                 |
  | interactive   | solution / interactor     | 以 framed channel 跑 interactive stage                                                     |

- 設定讀自 `/submission/config.json`；結果以單行 JSON 寫到 stdout，cgroup resource usage 寫到 stderr
- 每個解答與 validator 程序都經 `nojv-exec` 執行，量測程序自己的 CPU 與 peak RSS
- 輸出上限 16 MiB（bounded buffer）；結束時清理 `mkdtemp` 工作目錄
- **不負責**：DB、Redis、Storage 存取、判題後續流程（由 worker 處理）

## 主要入口

- `src/index.ts` — entrypoint 與 phase dispatch
- `src/payload-materializer.ts` — payload shard 還原（拒絕 path traversal、缺 chunk、大小或 hash 不符）
- `src/compiler.ts` — 依 `@nojv/core` 的 `judge-environment.json` 編譯
- `src/testcase-files.ts` — 只讀取指定 index 的 testcase
- `src/judges/run-stage.ts`、`judge-stage.ts`、`stage-files.ts` — run / judge phase
- `src/judges/standard.ts`、`validate.ts` — per-case 執行與 DOMjudge validator
- `src/judges/interactive-stage.ts`、`interactive-channel.ts` — interactive protocol
- `src/judges/run-process.ts` — `nojv-exec` 包裝、verdict 分類、orphan 清理
- `src/utils.ts` — `createBoundedBuffer`、`cleanupTempDir`、cgroup 讀取
- `native/nojv-exec.c` — `RLIMIT_CPU`、wall 與 summed-RSS kill、subreaper、`wait4` 量測（image 內為 `/usr/local/bin/nojv-exec`；測試由 `tests/setup/nojv-exec.ts` 編譯並設 `NOJV_EXEC_PATH`）
- `assets/wrappers/` — DOMjudge validator / interactor 的 Python wrappers

## 依賴

- **只能依賴** `@nojv/core`（sandbox contract 與 schemas），見 JDG-18
- 由 worker 透過 Docker 或 Kubernetes 啟動；image 由 `infra/docker/sandbox-runner.Dockerfile` 建置

## 本地開發

```bash
pnpm -F @nojv/sandbox-runner typecheck
pnpm -F @nojv/sandbox-runner build         # dist/index.js
pnpm sandbox:build                         # nojv-sandbox:local image
```

## 相關文件

- [Judge Pipeline](../../docs/architecture/JUDGE_PIPELINE.md)
- [Security Requirements](../../docs/operations/SECURITY.md)
- [Threat Model](../../docs/operations/THREAT_MODEL.md)
