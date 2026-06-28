import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "מערכת אוטומציה לפרסום מוצרי AliExpress בטלגרם",
  description: "מערכת ניהול, סריקה ופרסום מוצרים מאליאקספרס לערוצי טלגרם בסיוע AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <div className="app-container">
          <Sidebar />
          <main className="main-content">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
