import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Controller Studio",
  description: "Controller workspace for two-stage Simulator script authoring and execution.",
};

const isDevEnvironment =
  process.env.NODE_ENV === "development" ||
  process.env.CONTROLLER_DEV_DIST === "1";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable}${
          isDevEnvironment ? " dev-environment" : ""
        }`}
      >
        {children}
      </body>
    </html>
  );
}
