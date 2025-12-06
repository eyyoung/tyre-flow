'use client';

import '@ant-design/v5-patch-for-react-19';
import React from 'react';
import { ConfigProvider, App, theme } from 'antd';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

interface AntdProviderProps {
  children: React.ReactNode;
  locale: string;
}

const antdLocales: Record<string, typeof zhCN> = {
  zh: zhCN,
  en: enUS,
};

export default function AntdProvider({ children, locale }: AntdProviderProps) {
  // 设置 dayjs 语言
  dayjs.locale(locale === 'zh' ? 'zh-cn' : 'en');

  return (
    <AntdRegistry>
      <ConfigProvider
        locale={antdLocales[locale] || zhCN}
        theme={{
          token: {
            colorPrimary: '#1677ff',
            borderRadius: 6,
            colorBgContainer: '#ffffff',
          },
          algorithm: theme.defaultAlgorithm,
          components: {
            Layout: {
              headerBg: '#001529',
              siderBg: '#001529',
              triggerBg: '#002140',
            },
            Menu: {
              darkItemBg: '#001529',
              darkSubMenuItemBg: '#000c17',
            },
          },
        }}
      >
        <App>{children}</App>
      </ConfigProvider>
    </AntdRegistry>
  );
}

