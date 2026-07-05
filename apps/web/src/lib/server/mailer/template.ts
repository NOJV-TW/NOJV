const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

export interface EmailContent {
  heading: string;
  intro: string;
  action?: { url: string; label: string };
  outro?: string;
}

export function renderEmail({ heading, intro, action, outro }: EmailContent): string {
  const button = action
    ? `<p style="margin:24px 0"><a href="${action.url}" style="display:inline-block;padding:12px 32px;background-color:#2563eb;color:#ffffff;text-decoration:none;border-radius:9999px;font-weight:600;font-size:14px">${action.label}</a></p>
      <p style="margin-top:16px;font-size:13px;color:#6b7280">按鈕無法使用嗎？請複製以下連結貼到瀏覽器開啟。<br>If the button doesn't work, copy and paste this link into your browser:<br><a href="${action.url}" style="color:#2563eb;word-break:break-all">${action.url}</a></p>`
    : "";
  const footer = outro
    ? `<p style="margin-top:24px;font-size:13px;color:#6b7280;line-height:1.6">${outro}</p>`
    : "";
  return `<div style="max-width:480px;margin:0 auto;font-family:${FONT};color:#1a1a1a;line-height:1.6">
      <h2 style="margin-bottom:16px">${heading}</h2>
      ${intro}
      ${button}
      ${footer}
    </div>`;
}
