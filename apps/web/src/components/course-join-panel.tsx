import Image from "next/image";
import { headers } from "next/headers";
import QRCode from "qrcode";

import { getLocale, getTranslations } from "next-intl/server";

import { shellClassNames } from "@nojv/ui";

interface CourseJoinPanelProps {
  courseSlug: string;
  joinChannels: {
    label: string;
    method: "join_code" | "manual_invite" | "qr_code";
    token: string;
  }[];
}

export async function CourseJoinPanel({
  courseSlug,
  joinChannels
}: CourseJoinPanelProps) {
  const locale = await getLocale();
  const t = await getTranslations("courseDetail");
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";

  if (!host) {
    throw new Error("Host header is required to build course join URLs.");
  }

  const qrCards = await Promise.all(
    joinChannels.map(async (channel) => ({
      ...channel,
      dataUrl:
        channel.method === "qr_code"
          ? await QRCode.toDataURL(
              (() => {
                const joinUrl = new URL(
                  `/${locale}/courses/${courseSlug}/join/${channel.token}`,
                  `${protocol}://${host}`
                );
                joinUrl.searchParams.set("method", channel.method);

                return joinUrl.toString();
              })()
            )
          : null
    }))
  );

  return (
    <section className={`${shellClassNames.card} px-5 py-5`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className={shellClassNames.eyebrow}>{t("joinFlows")}</p>
          <h3 className="mt-1 text-2xl font-semibold">{t("joinFlowsSubtitle")}</h3>
        </div>
        <span className={shellClassNames.badge}>{t("teacherManaged")}</span>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {qrCards.map((channel) => (
          <article
            className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
            key={`${channel.method}:${channel.token}`}
          >
            <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
              {channel.method.replaceAll("_", " ")}
            </p>
            <p className="mt-2 text-lg font-semibold">{channel.label}</p>
            <p className="mt-3 rounded-2xl bg-stone-950 px-3 py-2 font-mono text-sm text-stone-100">
              {channel.token}
            </p>
            {channel.dataUrl ? (
              <Image
                alt={`${channel.label} QR code`}
                className="mt-4 h-36 w-36 rounded-2xl border border-[color:var(--color-border)] bg-white p-2"
                height={144}
                src={channel.dataUrl}
                unoptimized
                width={144}
              />
            ) : (
              <p className="mt-4 text-sm leading-7 text-[color:var(--color-muted)]">
                {t("manualInviteHint")}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
