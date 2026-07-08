const FONT = "Manrope,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
const DISPLAY_FONT = "Fraunces,Georgia,'Times New Roman',serif";
const PRIMARY = "#1d8c9c";
const FOREGROUND = "#181d24";
const MUTED_FOREGROUND = "#5f6875";
const BACKGROUND = "#f4f5f7";
const BORDER = "rgba(20,24,31,0.1)";
const BORDER_SUBTLE = "rgba(20,24,31,0.06)";

export interface EmailContent {
  heading: string;
  intro: string;
  action?: { url: string; label: string };
  outro?: string;
}

export function renderEmail({ heading, intro, action, outro }: EmailContent): string {
  const button = action
    ? `<p style="margin:28px 0"><a href="${action.url}" style="display:inline-block;padding:12px 32px;background-color:${PRIMARY};color:#ffffff;text-decoration:none;border-radius:9999px;font-weight:600;font-size:14px">${action.label}</a></p>
      <p style="margin-top:16px;font-size:13px;color:${MUTED_FOREGROUND}">按鈕無法使用嗎？請複製以下連結貼到瀏覽器開啟。<br>If the button doesn't work, copy and paste this link into your browser:<br><a href="${action.url}" style="color:${PRIMARY};word-break:break-all">${action.url}</a></p>`
    : "";
  const footer = outro
    ? `<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid ${BORDER_SUBTLE};font-size:13px;color:${MUTED_FOREGROUND};line-height:1.6">${outro}</p>`
    : "";
  return `<div style="background-color:${BACKGROUND};padding:32px 16px;font-family:${FONT}">
      <div style="max-width:480px;margin:0 auto">
        <p style="margin:0 0 16px;text-align:center;font-family:${DISPLAY_FONT};font-size:22px;font-weight:700;letter-spacing:0.02em;color:${PRIMARY}">NOJV</p>
        <div style="background-color:#ffffff;border:1px solid ${BORDER};border-radius:24px;padding:32px;color:${FOREGROUND};line-height:1.6">
          <h2 style="margin:0 0 16px;font-size:20px;font-weight:700">${heading}</h2>
          ${intro}
          ${button}
          ${footer}
        </div>
        <p style="margin:16px 0 0;text-align:center;font-size:12px;color:${MUTED_FOREGROUND}">NOJV · <a href="https://nojv.tw" style="color:${MUTED_FOREGROUND}">nojv.tw</a></p>
      </div>
    </div>`;
}
