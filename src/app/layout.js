import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ThemeProvider from "@/components/ThemeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "My Prayer Line — Connecting hearts through prayer",
    template: "%s | My Prayer Line",
  },
  description:
    "A faith-centered community where believers gather in prayer groups, share prayer requests and testimonies, and pray for one another in real time.",
  applicationName: "My Prayer Line",
  keywords: [
    "prayer",
    "prayer groups",
    "Christian community",
    "faith",
    "prayer requests",
    "testimonies",
  ],
  icons: {
    icon: "/mpl-logo.png",
    apple: "/mpl-logo.png",
  },
  openGraph: {
    type: "website",
    siteName: "My Prayer Line",
    title: "My Prayer Line — Connecting hearts through prayer",
    description:
      "Connect with believers, share what's on your heart, and experience the power of prayer—together.",
    images: [
      {
        url: "/landing-hero.jpg",
        alt: "Believers gathered together in prayer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "My Prayer Line — Connecting hearts through prayer",
    description:
      "Connect with believers, share what's on your heart, and experience the power of prayer—together.",
    images: ["/landing-hero.jpg"],
  },
};

export const viewport = {
  themeColor: "#064e3b",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
