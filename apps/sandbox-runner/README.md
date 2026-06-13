# NOJV Sandbox Runner

> 隔離容器內跑使用者程式碼，透過受信任的 stdin / stdout 與 worker 通訊。

## 職責

- 在最小權限容器內編譯與執行使用者提交的程式碼
- 對 worker 傳入的 testcase 跑 stdin/stdout 比對或 interactive judge
- 量測 CPU 時間、wall time、memory、exit signal，回報結構化 JSON
- 對輸出做大小上限保護（bounded buffer，16 MB cap）
- 完成後清理 `mkdtemp` 工作目錄
- **不負責**：DB / Redis / Storage 存取、決定 verdict 後續流程（由 worker 處理）

## 主要入口

- `src/index.ts` — 容器 entrypoint，讀 stdin config 並呼叫 judge
- `src/compiler.ts` — 多語言編譯包裝
- `src/judges/standard.ts` — 標準 stdin/stdout judge
- `src/judges/run-process.ts` — 共用程序執行包裝
- `src/judges/interactive.ts` — interactive judge（雙向 IO）
- `src/judges/checker.ts` — special judge / 自訂比對程式（custom comparator）
- `src/utils.ts` — `createBoundedBuffer` 等共用 helper

## 依賴

- 上游：**只能依賴** `@nojv/core`（共享 schema / type）
- 嚴禁依賴 `@nojv/db`、`@nojv/redis`、`@nojv/storage`、`@nojv/application`
- 下游：worker 透過 Docker / K8s 啟動本容器，透過 stdin/stdout 通訊

## 本地開發

```bash
# 從 repo 根目錄
pnpm -F @nojv/sandbox-runner typecheck
pnpm -F @nojv/sandbox-runner build         # 產出 dist/index.js
pnpm sandbox:build                         # 建容器 image
```

## 相關文件

- [Security Requirements](../../docs/operations/SECURITY.md)
- [Threat Model](../../docs/operations/THREAT_MODEL.md)
- [Judge Pipeline](../../docs/architecture/JUDGE_PIPELINE.md)
