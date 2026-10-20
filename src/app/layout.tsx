import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Youtube Title Updater",
  description: "Review and update YouTube video titles from descriptions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id" suppressHydrationWarning><body>{children}</body></html>;
}
