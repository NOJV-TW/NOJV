# About 頁面 + 全站 Footer — Design

**Date:** 2026-05-12
**Scope:** 新增公開 `/about` 介紹頁、新增全站 Footer、補上 `/legal/terms` 與 `/legal/privacy` 佔位頁
**Status:** Design approved, ready to implement

## Goal

讓訪客（不論是否登入）可以從頁尾的 Footer 進入 `/about`，看到專案的一段介紹、三個開發者的簡介與 GitHub、以及歡迎開源協作的訊息。Footer 同時提供版權、聯絡 Email、ToS / Privacy、Docs / API / Status 等次要連結的固定入口。

## Non-Goals

- 不做開發者 CMS / DB 化（資料寫死即可，三人皆用 placeholder）
- 不做 newsletter 訂閱與 social 連結（Twitter/X 等）
- 不做 footer 摺疊式 mobile UI（grid 折成單欄即可）
- 不在 Header 加 About 連結（從 Footer 進入即可）
- 不做 ToS / Privacy 實際法律內容（placeholder「Coming soon」+ 聯絡 email）

## Architecture

### 路由與 layout 歸屬

- `/about` — 公開頁，**獨立於 `(app)` 與 `(auth)` 之外**，使用一個輕量 `PublicHeader` + `Footer`。登入登出皆可看。
- `/legal/terms` 與 `/legal/privacy` — 同樣公開、同樣套 `PublicHeader` + `Footer`，內文只是「Coming soon」placeholder。
- Footer 由各分層自己 import，共 3 個地方需要接：
  - `apps/web/src/routes/+page.svelte`（首頁）
  - `apps/web/src/routes/(app)/+layout.svelte`
  - `apps/web/src/routes/(auth)/+layout.svelte`
- 為何不直接在最外層 `routes/+layout.svelte` 統一加：因為它本身沒包 container，container 邏輯散在各分層；為了不大幅改動既有結構，沿用「各層自己接 Footer」的做法。

### About 頁段落（由上到下）

1. **Hero**：產品名 NOJV + tagline + 主要 CTA「View on GitHub」按鈕
2. **Meet the team**：3 個開發者卡片，桌面 3 欄 / 平板 2 欄 / 手機 1 欄。每張卡片：頭像（用 GitHub avatar URL `https://github.com/{user}.png`）、姓名、職責一句話、GitHub 連結
3. **Open source / Get involved**：歡迎 PR、Issues 的 callout + 兩個 outline 按鈕（Star on GitHub、Open an Issue）
4. **Contact**：Email mailto + issue tracker 連結

視覺沿用 `PageContainer` + `Card` + `Badge` + `Button` 既有元件，動畫用既有 `animate-[fade-up_...]`。整頁採 single column `max-w-5xl` 置中，section 之間 `space-y-12`。

### Footer 結構

4 欄 grid（lg）、2 欄（sm）、1 欄（mobile）：

| 欄  | 標題           | 內容                                             |
| --- | -------------- | ------------------------------------------------ |
| 1   | NOJV (logo 區) | 一句 tagline + 版權年                            |
| 2   | Product        | About、Docs（佔位）、API（佔位）、Status（佔位） |
| 3   | Community      | GitHub (project)、Open Issue、Contact (mailto)   |
| 4   | Legal          | Terms of Service、Privacy Policy                 |

視覺：

- 上邊框 `border-t border-border`、上 padding `pt-10 pb-6 mt-16`
- 字級 `text-body-sm` + `text-muted-foreground`，標題用 `text-caption font-semibold uppercase tracking-[0.24em]`
- 各連結 `hover:text-foreground transition-colors duration-fast ease-out-soft`
- 底部一條細線 + 「© {year} NOJV · Built with care」+ 外連 GitHub icon（用 `@lucide/svelte` 的 `Github`）
- 不用 Card 卡片包，保持輕量

### 資料來源（About 頁）

寫死在 `apps/web/src/routes/about/+page.server.ts` 回傳的物件：

```ts
return {
  repoUrl: "https://github.com/your-org/nojv",
  contactEmail: "contact@example.com",
  developers: [
    { id: "a", name: "Developer A", github: "githubuser-1" },
    { id: "b", name: "Developer B", github: "githubuser-2" },
    { id: "c", name: "Developer C", github: "githubuser-3" },
  ],
};
```

i18n 不能在 server 端跑（paraglide 是 client runtime），所以 server 只回 stable id + github username + name。role 文字在 `.svelte` 裡用 `m.about_devARole()` / `m.about_devBRole()` / `m.about_devCRole()` 對 3 個固定 key 取譯文。

### 新增 i18n keys

- `nav_about`（備用）
- `about_heroTitle`, `about_heroSubtitle`, `about_viewOnGithub`
- `about_teamTitle`, `about_teamSubtitle`
- `about_devARole`, `about_devBRole`, `about_devCRole`
- `about_openSourceTitle`, `about_openSourceBody`, `about_starOnGithub`, `about_openIssue`
- `about_contactTitle`, `about_contactBody`, `about_emailUs`
- `footer_tagline`, `footer_product`, `footer_community`, `footer_legal`
- `footer_docs`, `footer_api`, `footer_status`, `footer_contact`, `footer_terms`, `footer_privacy`
- `footer_copyright`（含 `{year}` 參數）
- `legal_comingSoon`

en + zh-TW 各約 25 個 key。

## 檔案異動

**新增：**

```
apps/web/src/routes/
  about/
    +page.svelte
    +page.server.ts
  legal/
    terms/+page.svelte
    privacy/+page.svelte

apps/web/src/lib/components/layout/
  Footer.svelte
  PublicHeader.svelte
```

**修改：**

- `apps/web/src/routes/+page.svelte` — `<main>` 之後加 `<Footer />`
- `apps/web/src/routes/(app)/+layout.svelte` — 同上
- `apps/web/src/routes/(auth)/+layout.svelte` — 同上
- `apps/web/messages/en.json` 與 `apps/web/messages/zh-TW.json` — 新增約 25 個 key

## 建置順序

1. 新增 i18n keys（en + zh-TW），跑 `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`
2. 建立 `Footer.svelte`（吃 `currentYear` prop，避免 SSR/hydration 不一致）
3. 建立 `PublicHeader.svelte`（Logo + 主題切換 + 語言切換，不含 nav / 通知 / UserMenu）
4. 建立 `/about` 路由（`+page.svelte` + `+page.server.ts`）
5. 建立 `/legal/terms` 與 `/legal/privacy` placeholder 頁
6. 把 `Footer` 接到 3 個地方
7. 驗證：
   - `pnpm -w typecheck` → 17/17 綠
   - `pnpm lint`、`pnpm format`
   - `pnpm dev` 手動測：登出 / 登入 / `/about` / `/legal/terms` / `/signin` 都看到 footer 且不重疊；語言切換能在中英切；深淺色 footer 對比正常；手機 grid 折成單欄
   - GitHub avatar 失敗 fallback（`<img>` `onerror` 或 `loading="lazy"` + alt）

## Open questions / Follow-ups

- 開發者 placeholder（Developer A/B/C + githubuser-1/2/3）由 user 之後手動換成真實資料
- `your-org/nojv` repo URL 同上
- `contact@example.com` 同上
- Docs / API / Status 三個 footer 連結先指向 `#`（disabled），等實際資源出來再接路徑
