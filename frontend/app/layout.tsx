import type { ReactNode } from "react";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";

export const metadata = {
  title: "Resume Matcher",
  description: "Score how well your resume matches a job description.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
