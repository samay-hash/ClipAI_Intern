import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClipAI — AI Video Editor in Seconds",
  description:
    "Upload your video and let AI edit it automatically. Auto captions, smart processing, clean output in seconds.",
  keywords: ["AI video editor", "auto captions", "video processing", "subtitle generator"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
