import type { RequestHandler } from "@sveltejs/kit";

import { prisma } from "@nojv/db";

export const GET: RequestHandler = async (event) => {
  const token = event.url.searchParams.get("token");

  if (!token) {
    return new Response(renderHtml("error", "缺少驗證 token"), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  const record = await prisma.verification.findUnique({ where: { id: token } });

  if (!record || record.expiresAt < new Date()) {
    // Clean up expired token
    if (record) {
      await prisma.verification.delete({ where: { id: token } });
    }
    return new Response(renderHtml("error", "驗證連結已過期或無效"), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  const data = JSON.parse(record.value) as { handle: string };

  // Check handle not taken by someone else
  const existing = await prisma.user.findUnique({ where: { handle: data.handle } });
  if (existing && existing.id !== record.identifier) {
    await prisma.verification.delete({ where: { id: token } });
    return new Response(renderHtml("error", "此學號已被其他帳號使用"), {
      status: 409,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  // Update user handle
  await prisma.user.update({
    where: { id: record.identifier },
    data: { handle: data.handle, displayHandle: data.handle }
  });

  // Delete used token
  await prisma.verification.delete({ where: { id: token } });

  return new Response(renderHtml("success", data.handle), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
};

function renderHtml(status: "success" | "error", detail: string): string {
  const isSuccess = status === "success";
  const title = isSuccess ? "驗證成功" : "驗證失敗";
  const message = isSuccess
    ? `你的 NOJV 帳號已設定為 <strong>${detail}</strong>。你可以關閉此頁面。`
    : detail;

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — NOJV</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8f8f8; }
    .card { background: white; border-radius: 1rem; padding: 2rem; max-width: 24rem; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .success { color: #16a34a; }
    .error { color: #dc2626; }
  </style>
</head>
<body>
  <div class="card">
    <h1 class="${status}">${title}</h1>
    <p>${message}</p>
  </div>
  ${isSuccess ? `<script>
    try {
      const bc = new BroadcastChannel("nojv-school-verify");
      bc.postMessage({ type: "verified", handle: ${JSON.stringify(detail)} });
      bc.close();
    } catch (_) {}
  </script>` : ""}
</body>
</html>`;
}
