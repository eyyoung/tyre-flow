import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Ant Design 优化
  transpilePackages: ['antd', '@ant-design/icons', '@ant-design/pro-components'],
  // Docker 部署优化
  output: 'standalone',
};

export default withNextIntl(nextConfig);
