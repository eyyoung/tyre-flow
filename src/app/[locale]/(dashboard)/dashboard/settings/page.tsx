'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
  Select,
  Modal,
  Alert,
  Row,
  Col,
  Statistic,
  Progress,
  Checkbox,
} from 'antd';
import {
  SettingOutlined,
  SaveOutlined,
  ReloadOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  ExclamationCircleOutlined,
  ShopOutlined,
  CarOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';

const { Title, Text } = Typography;

interface ConfigData {
  [key: string]: {
    value: string;
    description: string;
    category: string;
  };
}

interface CollectionPoint {
  id: string;
  code: string;
  name: string;
}

export default function SettingsPage() {
  const t = useTranslations();
  const { message, modal } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  // 测试分区状态
  const [collectionPoints, setCollectionPoints] = useState<CollectionPoint[]>([]);
  const [generateStoresModalVisible, setGenerateStoresModalVisible] = useState(false);
  const [generateVehiclesModalVisible, setGenerateVehiclesModalVisible] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [storesForm] = Form.useForm();
  const [vehiclesForm] = Form.useForm();

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

  const fetchCollectionPoints = useCallback(async () => {
    try {
      const response = await fetch('/api/collection-points?all=true');
      const result = await response.json();
      if (response.ok) {
        setCollectionPoints(result.data);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchCollectionPoints();
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

  // 清理数据
  const handleCleanup = (type: 'stores' | 'vehicles' | 'ledgers') => {
    const typeNames = {
      stores: t('menu.stores'),
      vehicles: t('menu.vehicles'),
      ledgers: t('menu.ledgers'),
    };

    // 门店清理需要额外选项
    if (type === 'stores') {
      let includeNonVirtual = false;
      modal.confirm({
        title: t('settings.dataCleanup'),
        icon: <ExclamationCircleOutlined />,
        content: (
          <div>
            <p>{t('settings.cleanupConfirm', { type: typeNames[type] })}</p>
            <Checkbox
              onChange={(e) => {
                includeNonVirtual = e.target.checked;
              }}
            >
              {t('settings.includeNonVirtual')}
            </Checkbox>
            <p style={{ color: '#ff4d4f', fontSize: 12, marginTop: 8 }}>
              {t('settings.includeNonVirtualWarning')}
            </p>
          </div>
        ),
        okText: t('common.confirm'),
        okType: 'danger',
        cancelText: t('common.cancel'),
        onOk: async () => {
          setCleaning(true);
          try {
            const response = await fetch('/api/test-zone/cleanup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type, includeNonVirtual }),
            });

            const result = await response.json();

            if (response.ok) {
              message.success(t('settings.cleanupSuccess', { count: result.count }));
            } else {
              message.error(result.message || t('common.error'));
            }
          } catch {
            message.error(t('common.error'));
          } finally {
            setCleaning(false);
          }
        },
      });
      return;
    }

    modal.confirm({
      title: t('settings.dataCleanup'),
      icon: <ExclamationCircleOutlined />,
      content: t('settings.cleanupConfirm', { type: typeNames[type] }),
      okText: t('common.confirm'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        setCleaning(true);
        try {
          const response = await fetch('/api/test-zone/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type }),
          });

          const result = await response.json();

          if (response.ok) {
            message.success(t('settings.cleanupSuccess', { count: result.count }));
          } else {
            message.error(result.message || t('common.error'));
          }
        } catch {
          message.error(t('common.error'));
        } finally {
          setCleaning(false);
        }
      },
    });
  };

  // 批量生成门店
  const handleGenerateStores = async () => {
    try {
      const values = await storesForm.validateFields();
      setGenerating(true);

      const response = await fetch('/api/stores/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      const result = await response.json();

      if (response.ok) {
        message.success(t('settings.generateStoresSuccess', { count: result.count }));
        setGenerateStoresModalVisible(false);
        storesForm.resetFields();
      } else {
        message.error(result.message || t('common.error'));
      }
    } catch {
      // 表单验证失败
    } finally {
      setGenerating(false);
    }
  };

  // 批量生成车辆
  const handleGenerateVehicles = async () => {
    try {
      const values = await vehiclesForm.validateFields();
      setGenerating(true);

      const response = await fetch('/api/vehicles/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      const result = await response.json();

      if (response.ok) {
        message.success(t('settings.generateVehiclesSuccess', { count: result.count }));
        setGenerateVehiclesModalVisible(false);
        vehiclesForm.resetFields();
      } else {
        message.error(result.message || t('common.error'));
      }
    } catch {
      // 表单验证失败
    } finally {
      setGenerating(false);
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
              extra={<Text type="secondary">4.2米货车默认载重（单位: kg）</Text>}
            >
              <InputNumber min={500} max={10000} step={100} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item
              name="transfer_vehicle_load"
              label={t('settings.transferVehicleLoad')}
              rules={[{ required: true }]}
              extra={<Text type="secondary">13米半挂车默认载重（单位: kg）</Text>}
            >
              <InputNumber min={10000} max={50000} step={1000} style={{ width: 200 }} />
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
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="collection_interval_min"
                  label={t('settings.collectionIntervalMin')}
                  rules={[{ required: true }]}
                  extra={<Text type="secondary">门店收集最小间隔</Text>}
                >
                  <InputNumber min={1} max={30} step={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="collection_interval_max"
                  label={t('settings.collectionIntervalMax')}
                  rules={[{ required: true }]}
                  extra={<Text type="secondary">门店收集最大间隔</Text>}
                >
                  <InputNumber min={1} max={60} step={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name="cold_store_ratio"
              label={t('settings.coldStoreRatio')}
              rules={[{ required: true }]}
              extra={
                <Text type="secondary">
                  冷门门店比例，这些门店本月可能不收集或只收集1次
                </Text>
              }
            >
              <InputNumber min={0} max={0.5} step={0.05} style={{ width: 200 }} />
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="loss_ratio_min"
                  label={t('settings.lossRatioMin')}
                  rules={[{ required: true }]}
                  extra={<Text type="secondary">运输折损最小比例（如 0.001 = 0.1%）</Text>}
                >
                  <InputNumber min={0} max={0.1} step={0.001} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="loss_ratio_max"
                  label={t('settings.lossRatioMax')}
                  rules={[{ required: true }]}
                  extra={<Text type="secondary">运输折损最大比例（如 0.005 = 0.5%）</Text>}
                >
                  <InputNumber min={0} max={0.1} step={0.001} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
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

        <Divider />

        {/* 测试分区 */}
        <Card
          title={
            <Space>
              <span>🧪</span>
              <span style={{ color: '#ff4d4f' }}>{t('settings.testZone')}</span>
            </Space>
          }
          variant="borderless"
          style={{ marginTop: 24, borderColor: '#ff4d4f' }}
        >
          <Alert
            message={t('settings.testZoneDescription')}
            type="warning"
            showIcon
            style={{ marginBottom: 24 }}
          />

          {/* 数据生成 */}
          <div style={{ marginBottom: 24 }}>
            <Title level={5}>
              <ThunderboltOutlined style={{ marginRight: 8 }} />
              {t('settings.dataGeneration')}
            </Title>
            <Space>
              <Button
                type="primary"
                icon={<ShopOutlined />}
                onClick={() => setGenerateStoresModalVisible(true)}
                style={{ background: '#52c41a', borderColor: '#52c41a' }}
              >
                {t('settings.generateStores')}
              </Button>
              <Button
                type="primary"
                icon={<CarOutlined />}
                onClick={() => setGenerateVehiclesModalVisible(true)}
                style={{ background: '#1890ff', borderColor: '#1890ff' }}
              >
                {t('settings.generateVehicles')}
              </Button>
            </Space>
          </div>

          <Divider />

          {/* 数据清理 */}
          <div>
            <Title level={5}>
              <DeleteOutlined style={{ marginRight: 8, color: '#ff4d4f' }} />
              {t('settings.dataCleanup')}
            </Title>
            <Space>
              <Button
                danger
                icon={<ShopOutlined />}
                onClick={() => handleCleanup('stores')}
                loading={cleaning}
              >
                {t('settings.cleanupStores')}
              </Button>
              <Button
                danger
                icon={<CarOutlined />}
                onClick={() => handleCleanup('vehicles')}
                loading={cleaning}
              >
                {t('settings.cleanupVehicles')}
              </Button>
              <Button
                danger
                icon={<FileTextOutlined />}
                onClick={() => handleCleanup('ledgers')}
                loading={cleaning}
              >
                {t('settings.cleanupLedgers')}
              </Button>
            </Space>
          </div>
        </Card>
      </Spin>

      {/* 批量生成门店弹窗 */}
      <Modal
        title={t('settings.generateStoresTitle')}
        open={generateStoresModalVisible}
        onOk={handleGenerateStores}
        onCancel={() => setGenerateStoresModalVisible(false)}
        confirmLoading={generating}
        destroyOnHidden
      >
        {generateStoresModalVisible && (
          <Form form={storesForm} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item
              name="collectionPointId"
              label={t('stores.collectionPoint')}
              rules={[
                {
                  required: true,
                  message: t('settings.selectCollectionPoint'),
                },
              ]}
            >
              <Select
                options={collectionPoints.map((cp) => ({
                  value: cp.id,
                  label: cp.name,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="count"
              label={t('settings.generateCount')}
              rules={[{ required: true }]}
              extra="每个收集点生成的门店数量（1-4000）"
            >
              <InputNumber min={1} max={4000} style={{ width: '100%' }} />
            </Form.Item>
          </Form>
        )}
        {generating && (
          <div style={{ marginTop: 16 }}>
            <Progress percent={100} status="active" />
            <p style={{ textAlign: 'center', color: '#666' }}>
              {t('settings.generating')}
            </p>
          </div>
        )}
      </Modal>

      {/* 批量生成车辆弹窗 */}
      <Modal
        title={t('settings.generateVehiclesTitle')}
        open={generateVehiclesModalVisible}
        onOk={handleGenerateVehicles}
        onCancel={() => setGenerateVehiclesModalVisible(false)}
        confirmLoading={generating}
        destroyOnHidden
      >
        {generateVehiclesModalVisible && (
          <Form form={vehiclesForm} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item
              name="collectionPointId"
              label={t('stores.collectionPoint')}
              rules={[
                {
                  required: true,
                  message: t('settings.selectCollectionPoint'),
                },
              ]}
            >
              <Select
                options={collectionPoints.map((cp) => ({
                  value: cp.id,
                  label: cp.name,
                }))}
              />
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="collectionCount"
                  label={t('settings.collectionVehicleCountGen')}
                  rules={[{ required: true }]}
                  initialValue={5}
                >
                  <InputNumber min={0} max={50} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="transferCount"
                  label={t('settings.transferVehicleCountGen')}
                  rules={[{ required: true }]}
                  initialValue={2}
                >
                  <InputNumber min={0} max={20} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        )}
        {generating && (
          <div style={{ marginTop: 16 }}>
            <Progress percent={100} status="active" />
            <p style={{ textAlign: 'center', color: '#666' }}>
              {t('settings.generating')}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
