"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useLocale, useTranslations } from "next-intl";

import { LogOut, User } from "lucide-react";

import { authClient } from "@/lib/auth-client";

export function UserAuthMenu() {
  const t = useTranslations("auth");
  const tNav = useTranslations("navigation");
  const locale = useLocale();
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        btnRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right
    });
  }, [open]);

  if (isPending) {
    return (
      <div className="size-9 animate-pulse rounded-full border border-[color:var(--color-border)] bg-white/60" />
    );
  }

  if (!session?.user) {
    return null;
  }

  const name = session.user.name ?? "";
  const initial = name.charAt(0).toUpperCase() || "?";
  const hasHandle = !!session.user.username;

  return (
    <>
      <button
        ref={btnRef}
        className="flex size-9 cursor-pointer items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-accent)] text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:opacity-90"
        onClick={() => setOpen((v) => !v)}
        title={name}
        type="button"
      >
        {initial}
      </button>
      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] min-w-[10rem] overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-white py-1 shadow-lg"
            style={{ top: pos.top, right: pos.right }}
          >
            <div className="border-b border-[color:var(--color-border)] px-4 py-2.5">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-[color:var(--color-muted)]">{session.user.email}</p>
            </div>
            {hasHandle && (
              <Link
                className="flex items-center gap-2 px-4 py-2 text-sm transition hover:bg-[color:var(--color-accent)]/10"
                href={`/${locale}/account`}
                onClick={() => setOpen(false)}
              >
                <User size={16} />
                {tNav("account")}
              </Link>
            )}
            <button
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 transition hover:bg-red-50"
              onClick={() => void authClient.signOut().then(() => { router.push(`/${locale}`); router.refresh(); })}
              type="button"
            >
              <LogOut size={16} />
              {t("signOut")}
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
