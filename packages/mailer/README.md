# @nojv/mailer

> 通用寄信抽象層。web 與 platform worker 共用，並要求明確選擇 SMTP 或本地 sink。

## 職責

- 封裝 `nodemailer`,由 `getMailer()` 回傳統一的 `Mailer` seam
- `smtp` 模式只在 SMTP 接受至少一位收件人後回傳 `accepted`
- `sink` 模式只允許 development/test，回傳 `suppressed` 並輸出不含收件人、主旨或內容的結構化事件
- 組態不完整、SMTP 拒收與傳輸錯誤都會直接拋錯，不會降級或 fallback
- 集中管理站內信 HTML 模板(`renderEmail`)
- **不負責**:通知偏好與收件人解析(在 `@nojv/application`)、要寄什麼內容(呼叫端組)

## 主要 API

- `getMailer(): Mailer` — lazy singleton，依已驗證的 `process.env` 建立 SMTP transport 或 sink
- `validateMailerConfig(): MailerConfig` — 啟動時驗證完整寄信組態
- `renderEmail(content): string` — 雙語站內信 HTML 模板
- `getAppBaseUrl(): string` — email 連結用的站台基底 URL

## 環境變數

沒有任何寄信相關預設值。

| 變數           | `smtp` | `sink` | 說明                                                |
| -------------- | ------ | ------ | --------------------------------------------------- |
| `NODE_ENV`     | 必填   | 必填   | `sink` 僅接受 `development` / `test`                |
| `MAILER_MODE`  | `smtp` | `sink` | 必填 discriminator                                  |
| `SMTP_HOST`    | 必填   | 禁止   | SMTP 主機                                           |
| `SMTP_PORT`    | 必填   | 禁止   | `465` 使用 implicit TLS；其他埠強制 STARTTLS        |
| `SMTP_USER`    | 必填   | 禁止   | SMTP 帳號                                           |
| `SMTP_PASS`    | 必填   | 禁止   | SMTP app password / credential                      |
| `SMTP_FROM`    | 必填   | 禁止   | 完整寄件者 header                                   |
| `APP_BASE_URL` | 必填   | 必填   | email 連結基底 URL；production 必須是絕對 HTTPS URL |

`sink` 模式必須完全移除所有 `SMTP_*` 變數；設定成空字串同樣會被拒絕。Web runtime
在非 SvelteKit build 階段驗證組態，platform/all worker 也會在啟動時驗證；
judge-only worker 不依賴 mailer。

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
