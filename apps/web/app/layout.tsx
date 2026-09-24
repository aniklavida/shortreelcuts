import type { ReactNode } from "react";

export const metadata = {
  title: "ShortReelCuts",
  description: "A self-hosted web app that turns a prompt into a short vertical video, and shows every decision it made.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
