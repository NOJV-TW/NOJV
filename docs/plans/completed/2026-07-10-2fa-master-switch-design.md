# 2FA 總開關模型設計

日期:2026-07-10
狀態:設計已確認(使用者逐點確認),待實作
前置:PR #237 分支上的驗證方式重組(two-factor-actions.ts、TwoFactorDialog/PasskeyDialog)

## 模型

- **總開關** `User.twoFactorActivated Boolean @default(false)`(新欄位 + migration)。
- 第一因子:一般使用者 = OAuth;admin = 密碼。第二因子:TOTP 與 Passkey **可同時設定,驗證擇一**。
- **開啟總開關**:寄 6 位數 email OTP(Redis 存 hash,TTL 10 分鐘,沿用 otpSendRateLimiter 節流)→ 驗證通過 → activated=true → 安全通知信。
- **關閉總開關**:step-up 驗證後 activated=false;**TOTP/passkey 設定保留只停用**,重開直接恢復生效。
- **調整 2FA 設定**(添加/刪除方式、關閉總開關、重生備用碼):需 step-up(TOTP/passkey 擇一);**尚無任何方式時 fallback email OTP**(涵蓋剛開啟總開關要加第一個方式的情境)。
- **未開啟總開關前**:TOTP 與 Passkey 都不可添加(UI disabled + server 端 guard;passkey 現況可直接加 → 收緊)。
- `hasStepUpFactor` 改為:`twoFactorActivated && (twoFactorEnabled(TOTP) || passkeys.length > 0)`。

## API token 管理頁

- 入口 gate:`twoFactorActivated` 為 false → 導去 account 開啟;為 true → 需 step-up 驗證(TOTP/passkey 擇一,重用 /account/api-tokens/verify)。
- step-up 授權**獨立 TTL 1 小時**(新 Redis key,如 `tokenPageMfa(sessionId)`,TTL 3600s;不同於 session 壽命),過期重驗。

## Super admin(不含一般 admin)

- 首次登入(twoFactorActivated=false)→ hooks 強制導去開啟 2FA(現有 redirect 機制,目標改總開關流程)。
- 每個 session 登入後需 2FA 驗證一次(既有 adminSessionMfa 機制;驗證方式從只認 TOTP 改為 **TOTP/passkey 擇一**)。
- **session 壽命 1 天**:hooks 檢查 super admin session 年齡 > 24h → 強制登出重登(不動全域 session 設定)。

## UI(account 頁「安全性」區)

- 「兩階段驗證」總開關列:狀態 badge + 開啟(→ email OTP Dialog)/ 關閉(→ step-up Dialog)。
- 開啟後顯示:驗證器 App(TOTP)列 + Passkey 列(現有 TwoFactorDialog/PasskeyDialog 流程,受總開關管制)。
- 未開啟時兩列顯示但 disabled,附「請先開啟兩階段驗證」提示。

## 相容性 / 遷移

- 既有已啟用 TOTP 的使用者(prod 上主要是 admin):migration 將 `twoFactorEnabled=true` 或有 passkey 的使用者 backfill `twoFactorActivated=true`,避免鎖死。
- 現有 TwoFactorDialog 的密碼確認/passwordless email 確認流程由「總開關 OTP + step-up」模型取代:enable TOTP 的前置檢查改為總開關已開 + step-up/OTP fallback;原 `sendConfirm`(email 連結)與 `/account/two-factor/confirm` 落地頁退役(被 email OTP 取代)。
- `hooks.server.ts` 的 admin gate:`twoFactorEnabled` 檢查改 `twoFactorActivated`;adminSessionMfa 標記點涵蓋 passkey 驗證成功路徑。
