'use client';

import React, { useState } from 'react';
import { Layout, Menu, Dropdown, Avatar, Space, Button, theme } from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  ShopOutlined,
  CarOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  SettingOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
  GlobalOutlined,
  DownOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { locales, localeNames, type Locale } from '@/i18n/config';
import styles from './DashboardLayout.module.css';

const { Header, Sider, Content } = Layout;

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { token } = theme.useToken();

  // 获取当前 locale
  const pathParts = pathname.split('/');
  const currentLocale = pathParts[1] as Locale;
  const currentPath = '/' + pathParts.slice(2).join('/');

  // 菜单项配置
  const menuItems = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: <Link href={`/${currentLocale}/dashboard`}>{t('menu.dashboard')}</Link>,
    },
    {
      key: '/dashboard/users',
      icon: <UserOutlined />,
      label: <Link href={`/${currentLocale}/dashboard/users`}>{t('menu.users')}</Link>,
    },
    {
      key: '/dashboard/collection-points',
      icon: <EnvironmentOutlined />,
      label: (
        <Link href={`/${currentLocale}/dashboard/collection-points`}>
          {t('menu.collectionPoints')}
        </Link>
      ),
    },
    {
      key: '/dashboard/stores',
      icon: <ShopOutlined />,
      label: <Link href={`/${currentLocale}/dashboard/stores`}>{t('menu.stores')}</Link>,
    },
    {
      key: '/dashboard/vehicles',
      icon: <CarOutlined />,
      label: <Link href={`/${currentLocale}/dashboard/vehicles`}>{t('menu.vehicles')}</Link>,
    },
    {
      key: '/dashboard/ledgers',
      icon: <FileTextOutlined />,
      label: <Link href={`/${currentLocale}/dashboard/ledgers`}>{t('menu.ledgers')}</Link>,
    },
    {
      key: '/dashboard/settings',
      icon: <SettingOutlined />,
      label: <Link href={`/${currentLocale}/dashboard/settings`}>{t('menu.settings')}</Link>,
    },
  ];

  // 获取当前选中的菜单项
  const getSelectedKey = () => {
    // 精确匹配优先
    const exactMatch = menuItems.find((item) => currentPath === item.key);
    if (exactMatch) return exactMatch.key;

    // 按路径长度降序排列，找到最长的匹配前缀
    const sortedItems = [...menuItems].sort((a, b) => b.key.length - a.key.length);
    const prefixMatch = sortedItems.find((item) => currentPath.startsWith(item.key + '/'));
    if (prefixMatch) return prefixMatch.key;

    // 默认返回 dashboard
    return '/dashboard';
  };

  // 语言切换
  const handleLocaleChange = (locale: string) => {
    const newPath = pathname.replace(`/${currentLocale}`, `/${locale}`);
    router.push(newPath);
  };

  // 登出
  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push(`/${currentLocale}/login`);
  };

  // 用户下拉菜单
  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: t('menu.profile'),
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('auth.logout'),
      onClick: handleLogout,
    },
  ];

  // 语言下拉菜单
  const langMenuItems = locales.map((locale) => ({
    key: locale,
    label: localeNames[locale],
    onClick: () => handleLocaleChange(locale),
  }));

  return (
    <Layout className={styles.layout}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        className={styles.sider}
        width={240}
      >
        <div className={styles.logo}>
          <svg viewBox="0 0 100 100" className={styles.logoIcon}>
            <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="6" />
            <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" strokeWidth="4" />
            <circle cx="50" cy="50" r="15" fill="none" stroke="currentColor" strokeWidth="3" />
            <circle cx="50" cy="50" r="5" fill="currentColor" />
          </svg>
          {!collapsed && <span className={styles.logoText}>{t('common.appNameShort')}</span>}
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[getSelectedKey()]}
          items={menuItems}
          className={styles.menu}
        />
      </Sider>

      <Layout>
        <Header
          className={styles.header}
          style={{ background: token.colorBgContainer }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            className={styles.trigger}
          />

          <div className={styles.headerRight}>
            <Dropdown menu={{ items: langMenuItems }} placement="bottomRight">
              <Button type="text" icon={<GlobalOutlined />}>
                {!collapsed && (
                  <Space>
                    {localeNames[currentLocale]}
                    <DownOutlined style={{ fontSize: 10 }} />
                  </Space>
                )}
              </Button>
            </Dropdown>

            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <Space className={styles.userInfo}>
                <Avatar size="small" icon={<UserOutlined />} />
                <span className={styles.userName}>Admin</span>
                <DownOutlined style={{ fontSize: 10 }} />
              </Space>
            </Dropdown>
          </div>
        </Header>

        <Content className={styles.content}>{children}</Content>
      </Layout>
    </Layout>
  );
}

