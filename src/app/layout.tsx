import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alexandria",
  description:
    "MCP-native shared team memory for teams adopting AI across real workflows.",
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
