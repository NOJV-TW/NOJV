# Cloud-Native Sandbox & Worker 重構設計

## 目標

將沙盒執行層從「Worker 直接 spawn docker CLI」重構為 Kubernetes-native 架構，支援彈性擴縮。

## 架構概覽

```
Worker (排程層)  →  SandboxExecutor (抽象層)  →  Sandbox Runner (執行層，Pod 內)
```

### 資料流

```
1. BullMQ 將 submission job 交給 Worker
2. Worker 從 DB 取得 judge context（source code、testcases、judge config）
3. Worker 打包資料建立 ConfigMap（K8s）或 temp 目錄（Docker）
4. Worker 透過 SandboxExecutor 建立執行環境：
   ├─ K8sExecutor:    建立 K8s Job，掛載 ConfigMap
   └─ DockerExecutor: 建立 Docker container，bind mount 檔案
5. Sandbox Runner（Pod/container 內）讀取輸入資料
6. Runner: 編譯 → 逐一跑 testcases → 輸出 JSON 結果到 stdout
7. Worker 讀取 stdout（K8s: Pod logs / Docker: process stdout）
8. Worker 更新 Submission 記錄到 DB
9. Worker 清理 ConfigMap + Job（或 container + temp dir）
```

### 與現有架構的差異

- 現在：Worker 包含所有 judge 邏輯，每個 testcase spawn 一個 container
- 新的：Worker 只做排程，judge 邏輯移入 sandbox runner，一個 submission 一個 Pod

## 執行策略

**Pod-per-Submission（K8s Job API）**

- 每次提交建立一個 K8s Job/Pod，執行完自動清理
- 使用 `@kubernetes/client-node` 在 Worker 中直接操作 K8s API
- 教育用 OJ 的提交量（每分鐘數十到數百筆）K8s Job API 完全應付得來
- Pod 冷啟動 2-5 秒被 compile + judge 的等待時間自然吸收

## SandboxExecutor 介面

```typescript
interface SandboxExecutor {
  execute(request: SandboxRequest): Promise<SandboxResult>;
}

interface SandboxRequest {
  submissionId: string;
  sourceCode: string;
  language: Language;
  testcases: TestcaseInput[];
  judgeType: "standard" | "checker" | "interactive";
  judgeConfig: {
    checkerScript?: string;
    interactorScript?: string;
    checkerLanguage?: string;
  };
  limits: {
    timeoutMs: number;
    memoryMb: number;
    cpuLimit: number;
  };
}

interface SandboxResult {
  compilationError?: string;
  testcaseResults: {
    index: number;
    verdict: "AC" | "WA" | "TLE" | "MLE" | "RE" | "SE";
    stdout: string;
    stderr: string;
    exitCode: number;
    timeMs: number;
    score?: number;
    feedback?: string;
  }[];
}
```

### 雙模式

- `K8sExecutor`：生產環境，建立 ConfigMap + K8s Job，watch 狀態，讀 Pod logs
- `DockerExecutor`：本地開發，寫 temp 目錄，spawn `docker run`，讀 stdout

透過環境變數切換：

```typescript
const executor =
  env.EXECUTION_BACKEND === "kubernetes"
    ? new K8sExecutor(k8sConfig)
    : new DockerExecutor(dockerConfig);
```

## Sandbox Runner

新增 `apps/sandbox-runner/` package，編譯後嵌入 sandbox image。

### 結構

```
apps/sandbox-runner/
  src/
    index.ts            # 入口：讀 /submission 目錄，跑 judge，輸出 JSON
    compiler.ts         # 各語言編譯邏輯（gcc, javac, rustc, etc.）
    judges/
      standard.ts       # stdout 精確比對
      checker.ts        # 跑 checker script 評分
      interactive.ts    # 雙向 pipe 互動
    types.ts            # 輸入輸出 JSON schema
  package.json
  tsconfig.json
```

### 執行流程（Pod 內）

```
1. 讀取 /submission/config.json     → judge 設定、語言、limits
2. 讀取 /submission/source.*        → 使用者原始碼
3. 讀取 /submission/testcases/      → 各測資的 input / expected
4. 編譯原始碼到 /workspace/
5. 對每個 testcase：
   ├─ standard:    執行程式，比對 stdout
   ├─ checker:     執行程式，再執行 checker script 評分
   └─ interactive: 透過 pipe 同時執行程式和 interactor
6. 輸出 JSON 結果到 stdout
```

## K8s 資源定義

### Job Spec（K8sExecutor 動態生成）

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: judge-{submissionId}
  namespace: nojv-sandbox
  labels:
    app: nojv-sandbox
spec:
  ttlSecondsAfterFinished: 60
  activeDeadlineSeconds: 120
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      automountServiceAccountToken: false
      securityContext:
        runAsUser: 10001
        runAsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: runner
          image: nojv-sandbox:latest
          command: ["node", "/runner/index.js"]
          resources:
            requests: { cpu: "500m", memory: "256Mi" }
            limits: { cpu: "1", memory: "512Mi" }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
            readOnlyRootFilesystem: true
          volumeMounts:
            - name: submission-data
              mountPath: /submission
              readOnly: true
            - name: workspace
              mountPath: /workspace
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: submission-data
          configMap:
            name: judge-{submissionId}
        - name: workspace
          emptyDir: { sizeLimit: 128Mi }
        - name: tmp
          emptyDir: { sizeLimit: 64Mi }
```

### NetworkPolicy

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-sandbox
  namespace: nojv-sandbox
spec:
  podSelector:
    matchLabels:
      app: nojv-sandbox
  policyTypes: [Ingress, Egress]
```

### ResourceQuota

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: sandbox-quota
  namespace: nojv-sandbox
spec:
  hard:
    pods: "50"
    requests.cpu: "25"
    requests.memory: "12Gi"
```

## DockerExecutor（本地開發）

```bash
docker run --rm \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --read-only \
  --tmpfs /tmp:rw,size=64m \
  -v {tempDir}:/submission:ro \
  -v {workDir}:/workspace \
  --cpus 1 --memory 512m --pids-limit 64 \
  nojv-sandbox:local \
  node /runner/index.js
```

開發者體驗不變：`docker compose up` 即可。

## 檔案變動

### 新增

```
apps/sandbox-runner/                          # 新 package，Pod 內 judge 執行
  src/index.ts, compiler.ts, judges/*, types.ts
  package.json, tsconfig.json

apps/worker/src/services/
  sandbox-executor.ts                         # SandboxExecutor 介面
  k8s-executor.ts                             # K8s Job 實作
  docker-executor.ts                          # Docker 實作

infra/k8s/sandbox/
  namespace.yaml
  network-policy.yaml
  resource-quota.yaml
```

### 刪除

```
apps/sandbox/                                 # remote sandbox 服務
apps/worker/src/services/remote-sandbox.ts
apps/worker/src/services/docker-sandbox.ts
apps/worker/src/services/ephemeral-workspace.ts
```

### 修改

```
apps/worker/src/services/submission-runner.ts # 620 行 → ~50 行，只剩排程
apps/worker/src/processors.ts                # 用新 executor
apps/worker/src/env.ts                        # 新環境變數
infra/docker/sandbox-runner.Dockerfile        # 加入 runner build
docker-compose.yml                            # 移除 sandbox 服務設定
```

### 不變

```
packages/queue/                               # BullMQ 佇列
packages/db/src/judge-operations.ts           # DB 操作
apps/worker/src/index.ts                      # Worker 啟動
apps/worker/src/health-server.ts              # Health check
apps/web/src/app/api/submissions/             # API routes
```

## 安全模型

| 層級     | 措施                                               |
| -------- | -------------------------------------------------- |
| 網路     | NetworkPolicy deny all ingress/egress              |
| 身份     | 無 service account token                           |
| 檔案系統 | read-only root，emptyDir for /workspace 和 /tmp    |
| 權限     | 非 root (UID 10001)，drop ALL capabilities         |
| 資源     | CPU/memory limits per pod，namespace ResourceQuota |
| 隔離     | seccomp RuntimeDefault，no privilege escalation    |
