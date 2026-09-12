import { escapeHtml } from "./html";
import {
  BACKGROUND,
  BORDER,
  BORDER_SUBTLE,
  DISPLAY_FONT,
  FONT,
  FOREGROUND,
  MUTED_FOREGROUND,
  PRIMARY,
  SURFACE,
} from "./theme";

export interface EmailContent {
  preheader?: string;
  eyebrow?: string;
  heading: string;
  meta?: string;
  intro?: string;
  body?: string;
  action?: { url: string; label: string };
  outro?: string;
}

const PREHEADER_PADDING = "&zwnj;&nbsp;".repeat(60);

export function renderEmail({
  preheader,
  eyebrow,
  heading,
  meta,
  intro,
  body,
  action,
  outro,
}: EmailContent): string {
  const hiddenPreheader = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${BACKGROUND};opacity:0;mso-hide:all">${escapeHtml(preheader)}${PREHEADER_PADDING}</div>`
    : "";
  const eyebrowLine = eyebrow
    ? `<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${PRIMARY}">${eyebrow}</p>`
    : "";
  const metaLine = meta
    ? `<p style="margin:0 0 20px;font-size:13px;color:${MUTED_FOREGROUND}">${meta}</p>`
    : "";
  const article = body
    ? `<div style="margin:20px 0 8px;padding:20px 0 8px;border-top:1px solid ${BORDER_SUBTLE};border-bottom:1px solid ${BORDER_SUBTLE};font-size:15px">${body}</div>`
    : "";
  const button = action
    ? `<p style="margin:28px 0"><a href="${action.url}" style="display:inline-block;padding:12px 32px;background-color:${PRIMARY};color:#ffffff;text-decoration:none;border-radius:9999px;font-weight:600;font-size:14px">${action.label}</a></p>
      <p style="margin-top:16px;font-size:13px;color:${MUTED_FOREGROUND}">按鈕無法使用嗎？請複製以下連結貼到瀏覽器開啟。<br>If the button doesn't work, copy and paste this link into your browser:<br><a href="${action.url}" style="color:${PRIMARY};word-break:break-all">${action.url}</a></p>`
    : "";
  const footer = outro
    ? `<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid ${BORDER_SUBTLE};font-size:13px;color:${MUTED_FOREGROUND};line-height:1.6">${outro}</p>`
    : "";
  return `<div style="background-color:${BACKGROUND};padding:32px 16px;font-family:${FONT}">
      ${hiddenPreheader}
      <div style="max-width:560px;margin:0 auto">
        <p style="margin:0 0 16px;text-align:center;font-family:${DISPLAY_FONT};font-size:22px;font-weight:700;letter-spacing:0.02em;color:${PRIMARY}">NOJV</p>
        <div style="background-color:${SURFACE};border:1px solid ${BORDER};border-radius:24px;padding:32px;color:${FOREGROUND};line-height:1.6">
          ${eyebrowLine}
          <h2 style="margin:0 0 ${meta ? "6px" : "16px"};font-size:20px;font-weight:700;line-height:1.35">${heading}</h2>
          ${metaLine}
          ${intro ?? ""}
          ${article}
          ${button}
          ${footer}
        </div>
        <p style="margin:16px 0 0;text-align:center;font-size:12px;color:${MUTED_FOREGROUND}">NOJV · <a href="https://nojv.tw" style="color:${MUTED_FOREGROUND}">nojv.tw</a></p>
      </div>
    </div>`;
}
