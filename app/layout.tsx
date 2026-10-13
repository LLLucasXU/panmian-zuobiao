import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "盘面坐标｜市场状态研究台",
  description: "从事实、证据与不确定性出发，研究 A 股市场状态。",
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
