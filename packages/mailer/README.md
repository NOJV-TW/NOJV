# @nojv/mailer

> 通用 SMTP 寄信抽象層。web 與 platform worker 共用；本地/未設定時為 no-op。

## 職責

- 封裝 `nodemailer`,由 `getMailer()` 回傳統一的 `Mailer` seam
- 未設定 SMTP(`SMTP_HOST` 或 `SMTP_USER` 為空)時回傳 no-op mailer,`sendEmail` 不丟錯、不連線
- 集中管理站內信 HTML 模板(`renderEmail`)
- **不負責**:通知偏好與收件人解析(在 `@nojv/application`)、要寄什麼內容(呼叫端組)

## 主要 API

- `getMailer(): Mailer` — lazy singleton,依 `process.env` 建 transport 或 no-op
- `renderEmail(content): string` — 雙語站內信 HTML 模板
- `getAppBaseUrl(): string` — email 連結用的站台基底 URL

## 環境變數

| 變數           | 預設               | 說明                           |
| -------------- | ------------------ | ------------------------------ |
| `SMTP_HOST`    | `""`               | SMTP 主機;空 → no-op mailer    |
| `SMTP_PORT`    | `465`              | SMTP 埠;`465` → `secure: true` |
| `SMTP_USER`    | `""`               | SMTP 帳號;空 → no-op mailer    |
| `SMTP_PASS`    | `""`               | SMTP 密碼                      |
| `SMTP_FROM`    | `NOJV <SMTP_USER>` | 寄件者;空則以 `SMTP_USER` 組   |
| `APP_BASE_URL` | `https://nojv.tw`  | email 連結基底 URL             |

## 依賴

- 上游:`nodemailer`、`zod`
- 下游:`apps/web`、`apps/worker`(platform)

## 本地開發

```bash
# 從 repo 根目錄
pnpm -F @nojv/mailer build
pnpm -F @nojv/mailer typecheck
```

## 相關文件

- [Architecture Overview](../../docs/architecture/ARCHITECTURE.md)
- [Deployment Guide](../../docs/operations/DEPLOYMENT.md)
