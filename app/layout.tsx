import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Campus — Your campus, all in one place",
  description: "Communities, events, chats and rewards for campus life.",
  icons: { icon: "/smart-campus-logo-black.png", apple: "/smart-campus-logo-black.png" },
};

export const viewport: Viewport = { themeColor: "#6C3BFF" };

const themeScript = `
  try {
    const saved = localStorage.getItem('sc-theme');
    const dark = saved === 'dark' || (!saved && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (_) {}
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
