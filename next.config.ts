import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Ant Design 优化
  transpilePackages: ['antd', '@ant-design/icons', '@ant-design/pro-components'],
  // 生产部署：CI 构建 standalone 产物，服务器直接用 node server.js 运行（见 scripts/server/）
  output: 'standalone',
};

export default withNextIntl(nextConfig);
