import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tyre Flow - 轮胎回收台账追溯系统',
  description: '轮胎回收台账追溯管理系统',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
