'use client';

import React, { useState } from 'react';
import { Form, Input, Button, Card, Select, App } from 'antd';
import { UserOutlined, LockOutlined, GlobalOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { locales, localeNames, type Locale } from '@/i18n/config';
import styles from './login.module.css';

interface LoginForm {
  username: string;
  password: string;
}

export default function LoginPage() {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();

  // 获取当前 locale
  const currentLocale = pathname.split('/')[1] as Locale;

  const onFinish = async (values: LoginForm) => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      const data = await response.json();

      if (response.ok) {
        message.success(t('auth.loginSuccess'));
        router.push(`/${currentLocale}/dashboard`);
      } else {
        message.error(data.message || t('auth.loginFailed'));
      }
    } catch {
      message.error(t('auth.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleLocaleChange = (locale: string) => {
    router.push(`/${locale}/login`);
  };

  return (
    <div className={styles.container}>
      <div className={styles.background}>
        <div className={styles.shape}></div>
        <div className={styles.shape}></div>
      </div>

      <Card className={styles.loginCard} variant="borderless">
        <div className={styles.header}>
          <div className={styles.logo}>
            <svg viewBox="0 0 100 100" className={styles.logoIcon}>
              <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="6" />
              <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" strokeWidth="4" />
              <circle cx="50" cy="50" r="15" fill="none" stroke="currentColor" strokeWidth="3" />
              <circle cx="50" cy="50" r="5" fill="currentColor" />
            </svg>
          </div>
          <h1 className={styles.title}>{t('common.appNameShort')}</h1>
          <p className={styles.subtitle}>{t('auth.loginSubtitle')}</p>
        </div>

        <Form
          name="login"
          onFinish={onFinish}
          autoComplete="off"
          size="large"
          layout="vertical"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: t('auth.usernameRequired') }]}
          >
            <Input
              prefix={<UserOutlined className={styles.inputIcon} />}
              placeholder={t('auth.username')}
              className={styles.input}
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: t('auth.passwordRequired') }]}
          >
            <Input.Password
              prefix={<LockOutlined className={styles.inputIcon} />}
              placeholder={t('auth.password')}
              className={styles.input}
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              className={styles.loginButton}
            >
              {t('auth.login')}
            </Button>
          </Form.Item>
        </Form>

        <div className={styles.footer}>
          <Select
            value={currentLocale}
            onChange={handleLocaleChange}
            variant="borderless"
            suffixIcon={<GlobalOutlined />}
            className={styles.langSelect}
            options={locales.map((locale) => ({
              value: locale,
              label: localeNames[locale],
            }))}
          />
        </div>
      </Card>
    </div>
  );
}

