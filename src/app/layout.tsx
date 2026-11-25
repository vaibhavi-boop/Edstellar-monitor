import type { Metadata } from "next";
import { ThemeProvider } from "@/components/layout/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Edstellar Monitor", template: "%s · Edstellar Monitor" },
  description: "Website health monitoring for edstellar.com",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
