import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aangan Enquiries",
  description: "Every call answered, qualified and booked — and what it costs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <Suspense>{children}</Suspense>
      </body>
    </html>
  );
}
