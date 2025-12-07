"use client";

import React, { useState, useEffect } from "react";
import {
  Layout,
  Menu,
  Dropdown,
  Avatar,
  Space,
  Button,
  theme,
  Drawer,
} from "antd";
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
  SwapOutlined,
  ContainerOutlined,
  IdcardOutlined,
  LineChartOutlined,
} from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { locales, localeNames, type Locale } from "@/i18n/config";
import styles from "./DashboardLayout.module.css";

const { Header, Sider, Content } = Layout;

// 移动端断点
const MOBILE_BREAKPOINT = 768;

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { token } = theme.useToken();

  // 检测是否为移动端
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // 菜单点击时关闭移动端抽屉
  const handleMenuClick = () => {
    if (isMobile) {
      setMobileMenuOpen(false);
    }
  };

  // 获取当前 locale
  const pathParts = pathname.split("/");
  const currentLocale = pathParts[1] as Locale;
  const currentPath = "/" + pathParts.slice(2).join("/");

  // 菜单项配置
  const menuItems = [
    {
      key: "/dashboard",
      icon: <DashboardOutlined />,
      label: (
        <Link href={`/${currentLocale}/dashboard`}>{t("menu.dashboard")}</Link>
      ),
    },
    {
      key: "/dashboard/users",
      icon: <UserOutlined />,
      label: (
        <Link href={`/${currentLocale}/dashboard/users`}>
          {t("menu.users")}
        </Link>
      ),
    },
    {
      key: "/dashboard/collection-points",
      icon: <EnvironmentOutlined />,
      label: (
        <Link href={`/${currentLocale}/dashboard/collection-points`}>
          {t("menu.collectionPoints")}
        </Link>
      ),
    },
    {
      key: "/dashboard/stores",
      icon: <ShopOutlined />,
      label: (
        <Link href={`/${currentLocale}/dashboard/stores`}>
          {t("menu.stores")}
        </Link>
      ),
    },
    {
      key: "/dashboard/vehicles",
      icon: <CarOutlined />,
      label: (
        <Link href={`/${currentLocale}/dashboard/vehicles`}>
          {t("menu.vehicles")}
        </Link>
      ),
    },
    {
      key: "/dashboard/ledgers",
      icon: <FileTextOutlined />,
      label: t("menu.ledgers"),
      children: [
        {
          key: "/dashboard/ledgers/collection",
          icon: <ContainerOutlined />,
          label: (
            <Link href={`/${currentLocale}/dashboard/ledgers/collection`}>
              {t("menu.collectionLedger")}
            </Link>
          ),
        },
        {
          key: "/dashboard/ledgers/driver",
          icon: <IdcardOutlined />,
          label: (
            <Link href={`/${currentLocale}/dashboard/ledgers/driver`}>
              {t("menu.driverLedger")}
            </Link>
          ),
        },
        {
          key: "/dashboard/ledgers/driver-analysis",
          icon: <LineChartOutlined />,
          label: (
            <Link href={`/${currentLocale}/dashboard/ledgers/driver-analysis`}>
              {t("menu.driverAnalysis")}
            </Link>
          ),
        },
        {
          key: "/dashboard/ledgers/transfer",
          icon: <SwapOutlined />,
          label: (
            <Link href={`/${currentLocale}/dashboard/ledgers/transfer`}>
              {t("menu.transferLedger")}
            </Link>
          ),
        },
      ],
    },
    {
      key: "/dashboard/settings",
      icon: <SettingOutlined />,
      label: (
        <Link href={`/${currentLocale}/dashboard/settings`}>
          {t("menu.settings")}
        </Link>
      ),
    },
  ];

  // 获取所有菜单项（包括子菜单）
  const getAllMenuKeys = () => {
    const keys: string[] = [];
    const extractKeys = (items: typeof menuItems) => {
      for (const item of items) {
        keys.push(item.key);
        if ("children" in item && item.children) {
          extractKeys(item.children as typeof menuItems);
        }
      }
    };
    extractKeys(menuItems);
    return keys;
  };

  // 获取当前选中的菜单项
  const getSelectedKey = () => {
    const allKeys = getAllMenuKeys();

    // 精确匹配优先
    if (allKeys.includes(currentPath)) {
      return currentPath;
    }

    // 按路径长度降序排列，找到最长的匹配前缀
    const sortedKeys = [...allKeys].sort((a, b) => b.length - a.length);
    const prefixMatch = sortedKeys.find((key) =>
      currentPath.startsWith(key + "/")
    );
    if (prefixMatch) return prefixMatch;

    // 默认返回 dashboard
    return "/dashboard";
  };

  // 获取应该展开的子菜单
  const getOpenKeys = () => {
    for (const item of menuItems) {
      if ("children" in item && item.children) {
        const childKeys = item.children.map((c) => c.key);
        if (
          childKeys.includes(currentPath) ||
          currentPath.startsWith(item.key + "/")
        ) {
          return [item.key];
        }
      }
    }
    return [];
  };

  // 语言切换
  const handleLocaleChange = (locale: string) => {
    const newPath = pathname.replace(`/${currentLocale}`, `/${locale}`);
    router.push(newPath);
  };

  // 登出
  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push(`/${currentLocale}/login`);
  };

  // 用户下拉菜单
  const userMenuItems = [
    {
      key: "profile",
      icon: <UserOutlined />,
      label: t("menu.profile"),
    },
    {
      type: "divider" as const,
    },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: t("auth.logout"),
      onClick: handleLogout,
    },
  ];

  // 语言下拉菜单
  const langMenuItems = locales.map((locale) => ({
    key: locale,
    label: localeNames[locale],
    onClick: () => handleLocaleChange(locale),
  }));

  // 侧边栏菜单内容
  const siderContent = (
    <>
      <div className={styles.logo}>
        <svg viewBox="0 0 100 100" className={styles.logoIcon}>
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
          />
          <circle
            cx="50"
            cy="50"
            r="30"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
          />
          <circle
            cx="50"
            cy="50"
            r="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
          <circle cx="50" cy="50" r="5" fill="currentColor" />
        </svg>
        {(!collapsed || isMobile) && (
          <span className={styles.logoText}>{t("common.appNameShort")}</span>
        )}
      </div>

      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[getSelectedKey()]}
        defaultOpenKeys={getOpenKeys()}
        items={menuItems}
        className={styles.menu}
        onClick={handleMenuClick}
      />
    </>
  );

  return (
    <Layout className={styles.layout}>
      {/* 桌面端侧边栏 */}
      {!isMobile && (
        <Sider
          trigger={null}
          collapsible
          collapsed={collapsed}
          className={styles.sider}
          width={240}
        >
          {siderContent}
        </Sider>
      )}

      {/* 移动端抽屉菜单 */}
      {isMobile && (
        <Drawer
          placement="left"
          open={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
          width={280}
          styles={{
            body: { padding: 0, background: "#001529" },
            header: { display: "none" },
          }}
        >
          {siderContent}
        </Drawer>
      )}

      <Layout className={isMobile ? styles.mobileLayout : undefined}>
        <Header
          className={`${styles.header} ${isMobile ? styles.mobileHeader : ""}`}
          style={{ background: token.colorBgContainer }}
        >
          <Button
            type="text"
            icon={
              isMobile ? (
                <MenuUnfoldOutlined />
              ) : collapsed ? (
                <MenuUnfoldOutlined />
              ) : (
                <MenuFoldOutlined />
              )
            }
            onClick={() =>
              isMobile ? setMobileMenuOpen(true) : setCollapsed(!collapsed)
            }
            className={styles.trigger}
          />

          <div className={styles.headerRight}>
            <Dropdown menu={{ items: langMenuItems }} placement="bottomRight">
              <Button type="text" icon={<GlobalOutlined />}>
                {!isMobile && (
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
                {!isMobile && (
                  <>
                    <span className={styles.userName}>Admin</span>
                    <DownOutlined style={{ fontSize: 10 }} />
                  </>
                )}
              </Space>
            </Dropdown>
          </div>
        </Header>

        <Content
          className={`${styles.content} ${isMobile ? styles.mobileContent : ""}`}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
