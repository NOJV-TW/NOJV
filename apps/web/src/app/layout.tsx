import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  description:
    "NOJV is a production-oriented Online Judge skeleton with practice, contest, workspace, and integrity surfaces.",
  title: "NOJV"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
