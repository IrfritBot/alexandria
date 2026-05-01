import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alexandria",
  description: "Shared team memory skeleton for Sprint 1A.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
