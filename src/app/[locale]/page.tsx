"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import DemoChart from "@/components/DemoChart";

export default function HomePage() {
  const t = useTranslations("HomePage");

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-black">
      <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{t("title")}</h1>
          <nav className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
            <Link href="/en" className="hover:text-zinc-900 dark:hover:text-zinc-50">
              EN
            </Link>
            <Link href="/zh" className="hover:text-zinc-900 dark:hover:text-zinc-50">
              中文
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <section className="mb-10">
          <h2 className="mb-2 text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
            {t("welcome")}
          </h2>
          <p className="text-lg text-zinc-600 dark:text-zinc-400">{t("description")}</p>
        </section>

        <section className="mb-10">
          <h3 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            ECharts Demo
          </h3>
          <DemoChart />
        </section>

        <section>
          <h3 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Tech Stack</h3>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              "Next.js",
              "Vite / Vitest",
              "pnpm",
              "ESLint",
              "Prettier",
              "Docker Compose",
              "Prisma",
              "ECharts",
              "TailwindCSS",
              "Google GenAI",
              "Zod",
              "next-intl",
            ].map((tech) => (
              <li
                key={tech}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {tech}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
