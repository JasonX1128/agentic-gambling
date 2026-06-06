import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EventFund OS",
  description: "Multi-agent Kalshi event trading command center."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
