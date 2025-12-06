'use client';

import React, { useState, useEffect } from 'react';
import {
  Card,
  Form,
  InputNumber,
  Button,
  Typography,
  Divider,
  Space,
  Spin,
  App,
} from 'antd';
import { SettingOutlined, SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';

const { Title, Text } = Typography;

interface ConfigData {
  [key: string]: {
    value: string;
    description: string;
    category: string;
  };
}

export default function SettingsPage() {
  const t = useTranslations();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/settings');
      const result = await response.json();

      if (response.ok) {
        const formValues: Record<string, number> = {};
        for (const [key, config] of Object.entries(result.data as ConfigData)) {
          formValues[key] = parseFloat(config.value);
        }
        form.setFieldsValue(formValues);
      } else {
        message.error(result.message || t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      // 转换为字符串格式
      const configs: Record<string, string> = {};
      for (const [key, value] of Object.entries(values)) {
        configs[key] = String(value);
      }

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configs }),
      });

      const result = await response.json();

      if (response.ok) {
        message.success(t('settings.saveSuccess'));
      } else {
        message.error(result.message || t('common.error'));
      }
    } catch {
      // 表单验证失败
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        <SettingOutlined style={{ marginRight: 8 }} />
        {t('settings.title')}
      </Title>

      <Spin spinning={loading}>
        <Form form={form} layout="vertical" style={{ maxWidth: 800 }}>
          {/* 门店配置 */}
          <Card
            title={
              <Space>
                <span>🏪</span>
                <span>{t('stores.title')}</span>
              </Space>
            }
            variant="borderless"
            style={{ marginBottom: 24 }}
          >
            <Form.Item
              name="store_count_min"
              label={t('settings.storeCountMin')}
              rules={[{ required: true }]}
              extra={
                <Text type="secondary">
                  虚拟门店生成时，每个收集点的最小门店数量
                </Text>
              }
            >
              <InputNumber min={100} max={10000} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item
              name="store_count_max"
              label={t('settings.storeCountMax')}
              rules={[{ required: true }]}
              extra={
                <Text type="secondary">
                  虚拟门店生成时，每个收集点的最大门店数量
                </Text>
              }
            >
              <InputNumber min={100} max={10000} style={{ width: 200 }} />
            </Form.Item>
          </Card>

          {/* 车辆配置 */}
          <Card
            title={
              <Space>
                <span>🚛</span>
                <span>{t('vehicles.title')}</span>
              </Space>
            }
            variant="borderless"
            style={{ marginBottom: 24 }}
          >
            <Form.Item
              name="collection_vehicle_count"
              label={t('settings.collectionVehicleCount')}
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={100} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item
              name="transfer_vehicle_count"
              label={t('settings.transferVehicleCount')}
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={50} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item
              name="collection_vehicle_load"
              label={t('settings.collectionVehicleLoad')}
              rules={[{ required: true }]}
              extra={<Text type="secondary">4.2米货车默认载重</Text>}
            >
              <InputNumber min={0.5} max={10} step={0.5} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item
              name="transfer_vehicle_load"
              label={t('settings.transferVehicleLoad')}
              rules={[{ required: true }]}
              extra={<Text type="secondary">13米半挂车默认载重</Text>}
            >
              <InputNumber min={10} max={50} step={1} style={{ width: 200 }} />
            </Form.Item>
          </Card>

          {/* 台账配置 */}
          <Card
            title={
              <Space>
                <span>📊</span>
                <span>{t('ledgers.title')}</span>
              </Space>
            }
            variant="borderless"
            style={{ marginBottom: 24 }}
          >
            <Form.Item
              name="tire_weight_kg"
              label={t('settings.tireWeightKg')}
              rules={[{ required: true }]}
              extra={<Text type="secondary">用于条数和重量的换算</Text>}
            >
              <InputNumber min={5} max={50} step={1} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item
              name="collection_tire_limit"
              label={t('settings.collectionTireLimit')}
              rules={[{ required: true }]}
              extra={
                <Text type="secondary">
                  单次收集时，从单个门店收集的轮胎条数上限
                </Text>
              }
            >
              <InputNumber min={50} max={1000} step={10} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item
              name="collection_interval_days"
              label="门店收集间隔（天）"
              rules={[{ required: true }]}
              extra={
                <Text type="secondary">同一门店两次收集之间的最小间隔天数</Text>
              }
            >
              <InputNumber min={1} max={30} step={1} style={{ width: 200 }} />
            </Form.Item>
          </Card>

          <Divider />

          <Space>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saving}
            >
              {t('common.save')}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={fetchSettings}>
              {t('common.reset')}
            </Button>
          </Space>
        </Form>
      </Spin>
    </div>
  );
}

