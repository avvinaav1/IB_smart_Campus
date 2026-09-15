import type { Metadata, Viewport } from "next";

import "./globals.css";
import "./certificates.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ibcampus.icebrkr.space"),

  title: {
    default: "IB Smart Campus — Digital Campus Platform",
    template: "%s | IB Smart Campus",
  },

  description:
    "IB Smart Campus is a digital campus platform for student communities, events, communication, rewards, certificates and campus services.",

  applicationName: "IB Smart Campus",

  keywords: [
    "IB Smart Campus",
    "Smart Campus",
    "ICEBRKR",
    "digital campus",
    "smart campus platform",  
    "digital campus platform",
    "campus management platform",
    "student campus platform",
    "college campus platform",
    "student community platform",

    "campus event management",
    "event management for colleges",
    "college event management",
    "student event management",
    "campus events",
    "college events platform",

    "campus community",
    "student communities",
    "college student community",
    "campus community engagement",
    "community engagement platform",
    "student engagement platform",

    "campus chat",
    "student chat platform",
    "college chat platform",
    "campus communication platform",
    "student communication platform",

    "campus life",
    "digital campus experience",
    "student campus experience",
    "student engagement",
    "campus activities",

    "digital certificates",
    "digital certificate management",
    "certificate verification",
    "online certificate verification",
    "academic certificate verification",
    "student certificate verification",

    "student rewards",
    "campus rewards",
    "student achievement platform",
    "student achievements"
  ],

  authors: [
    {
      name: "ICEBRKR",
      url: "https://www.icebrkr.one/",
    },
  ],

  creator: "ICEBRKR",
  publisher: "ICEBRKR",

  robots: {
    index: true,
    follow: true,

    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },

  },

  alternates: {
    canonical: "/",
  },

  openGraph: {
    type: "website",
    locale: "en_IN",
    url: "/",
    siteName: "IB Smart Campus",

    title: "IB Smart Campus — Your Campus, All in One Place",

    description:
      "A digital campus platform for students, communities, events, chats, rewards, certificates and campus services.",

    images: [
      {
        url: "/smart-campus-logo-white.png",
        width: 1200,
        height: 630,
        alt: "IB Smart Campus — Your Campus, All in One Place",
      },
    ],
  },


  icons: {
    icon: "/smart-campus-logo-black.png",
    apple: "/smart-campus-logo-black.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#6C3BFF",
  colorScheme: "light dark",
};

const themeScript = `
  try {
    const saved = localStorage.getItem("sc-theme");
    const dark =
      saved === "dark" ||
      (!saved && matchMedia("(prefers-color-scheme: dark)").matches);

    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (_) {}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: themeScript,
          }}
        />
      </head>

      <body>{children}</body>
    </html>
  );
}