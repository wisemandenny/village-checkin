import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { AdminButton } from "@/components/admin-button";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

const domaine = localFont({
  src: "./fonts/Domaine Display Condensed Regular.ttf",
  variable: "--font-domaine",
});

export const metadata: Metadata = {
  title: "Potluck Sessions — Takes a Village",
  description: "Check in to the Potluck Sessions open recording studio.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geist.variable} ${domaine.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-[family-name:var(--font-geist)]">
        <AdminButton />
        {children}
      </body>
    </html>
  );
}
