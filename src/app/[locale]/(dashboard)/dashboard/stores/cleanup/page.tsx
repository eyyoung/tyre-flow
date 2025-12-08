'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Typography,
  Select,
  Alert,
  Tag,
  App,
  Progress,
  Popconfirm,
  Descriptions,
  Row,
  Col,
  Statistic,
  Switch,
} from 'antd';
import {
  ClearOutlined,
  EnvironmentOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  ExclamationCircleOutlined,
  CarOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text } = Typography;

interface CollectionPoint {
  id: string;
  code: string;
  name: string;
}

interface Store {
  id: string;
  code: string;
  name: string;
  address: string;
  province: string | null;
  city: string | null;
  district: string | null;
  longitude: number | null;
  latitude: number | null;
  estimatedTravelMinutes: number;
  status: 'ACTIVE' | 'DISABLED';
  disabledReason: string | null;
  geocodeStatus?: 'pending' | 'success' | 'failed';
  geocodeError?: string;
  routeStatus?: 'pending' | 'success' | 'failed';
  routeError?: string;
}

interface GeocodeResult {
  storeId: string;
  success: boolean;
  longitude?: number;
  latitude?: number;
  error?: string;
}

interface RoutePlanResult {
  storeId: string;
  success: boolean;
  duration?: number;
  distance?: number;
  error?: string;
}

export default function StoreCleanupPage() {
  const t = useTranslations();
  const { message, modal } = App.useApp();
  const [collectionPoints, setCollectionPoints] = useState<CollectionPoint[]>([]);
  const [selectedCollectionPoint, setSelectedCollectionPoint] = useState<string>('');
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [routePlanning, setRoutePlanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hideSuccess, setHideSuccess] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 获取收集点列表
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

  // 获取门店列表
  const fetchStores = useCallback(async () => {
    if (!selectedCollectionPoint) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams({
        collectionPointId: selectedCollectionPoint,
        pageSize: '9999', // 获取所有门店
        isVirtual: 'false', // 只获取非虚拟门店（导入的真实数据）
      });

      const response = await fetch(`/api/stores?${params}`);
      const result = await response.json();

      if (response.ok) {
        // 标记门店的地理编码状态
        const storesWithStatus = result.data.map((store: Store) => ({
          ...store,
          geocodeStatus: store.longitude && store.latitude ? 'success' : 'pending',
        }));
        setStores(storesWithStatus);
      } else {
        message.error(result.message || t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [selectedCollectionPoint, t, message]);

  useEffect(() => {
    fetchCollectionPoints();
  }, [fetchCollectionPoints]);

  useEffect(() => {
    if (selectedCollectionPoint) {
      fetchStores();
    } else {
      setStores([]);
    }
  }, [selectedCollectionPoint, fetchStores]);

  // 执行地理编码
  const handleGeocode = async () => {
    const pendingStores = stores.filter(s => s.geocodeStatus === 'pending' || s.geocodeStatus === 'failed');
    
    if (pendingStores.length === 0) {
      message.info(t('storeCleanup.noStoresNeedGeocode'));
      return;
    }

    setGeocoding(true);
    setProgress(0);

    const batchSize = 5; // 每批处理5个（避免超过高德API QPS限制）
    const batches = [];
    for (let i = 0; i < pendingStores.length; i += batchSize) {
      batches.push(pendingStores.slice(i, i + batchSize));
    }

    let processedCount = 0;
    const updatedStores = [...stores];

    for (const batch of batches) {
      try {
        const response = await fetch('/api/stores/geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stores: batch.map(s => ({
              id: s.id,
              address: [s.province, s.city, s.district, s.address].filter(Boolean).join(''),
            })),
          }),
        });

        const result = await response.json();

        if (response.ok) {
          // 更新门店状态
          result.results.forEach((r: GeocodeResult) => {
            const index = updatedStores.findIndex(s => s.id === r.storeId);
            if (index !== -1) {
              updatedStores[index] = {
                ...updatedStores[index],
                geocodeStatus: r.success ? 'success' : 'failed',
                longitude: r.longitude || null,
                latitude: r.latitude || null,
                geocodeError: r.error,
              };
            }
          });
        }
      } catch {
        // 标记当前批次为失败
        batch.forEach(store => {
          const index = updatedStores.findIndex(s => s.id === store.id);
          if (index !== -1) {
            updatedStores[index] = {
              ...updatedStores[index],
              geocodeStatus: 'failed',
              geocodeError: t('storeCleanup.networkError'),
            };
          }
        });
      }

      processedCount += batch.length;
      setProgress(Math.round((processedCount / pendingStores.length) * 100));
      setStores([...updatedStores]);

      // 添加延迟，避免请求过快（高德免费API限制约3QPS）
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setGeocoding(false);
    message.success(t('storeCleanup.geocodeComplete'));
  };

  // 标记选中的失败门店为停用
  const handleMarkAsDisabled = async () => {
    const failedStores = stores.filter(
      s => selectedRowKeys.includes(s.id) && s.geocodeStatus === 'failed'
    );

    if (failedStores.length === 0) {
      message.warning(t('storeCleanup.selectFailedStores'));
      return;
    }

    try {
      const response = await fetch('/api/stores/geocode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeIds: failedStores.map(s => s.id),
          status: 'DISABLED',
          disabledReason: t('storeCleanup.geocodeFailed'),
        }),
      });

      const result = await response.json();

      if (response.ok) {
        message.success(t('storeCleanup.markDisabledSuccess', { count: result.count }));
        // 更新本地状态
        const updatedStores = stores.map(s => {
          if (failedStores.find(f => f.id === s.id)) {
            return { ...s, status: 'DISABLED' as const, disabledReason: t('storeCleanup.geocodeFailed') };
          }
          return s;
        });
        setStores(updatedStores);
        setSelectedRowKeys([]);
      } else {
        message.error(result.message || t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    }
  };

  // 执行路径规划
  const handleRoutePlan = async () => {
    const successStores = stores.filter(s => s.geocodeStatus === 'success' && s.longitude && s.latitude);
    
    if (successStores.length === 0) {
      message.info(t('storeCleanup.noStoresNeedRoutePlan'));
      return;
    }

    setRoutePlanning(true);
    setProgress(0);

    const batchSize = 5; // 每批处理5个
    const batches = [];
    for (let i = 0; i < successStores.length; i += batchSize) {
      batches.push(successStores.slice(i, i + batchSize));
    }

    let processedCount = 0;
    const updatedStores = [...stores];

    for (const batch of batches) {
      try {
        const response = await fetch('/api/stores/route-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            collectionPointId: selectedCollectionPoint,
            stores: batch.map(s => ({
              id: s.id,
              longitude: s.longitude,
              latitude: s.latitude,
            })),
          }),
        });

        const result = await response.json();

        if (response.ok) {
          // 更新门店状态
          result.results.forEach((r: RoutePlanResult) => {
            const index = updatedStores.findIndex(s => s.id === r.storeId);
            if (index !== -1) {
              updatedStores[index] = {
                ...updatedStores[index],
                routeStatus: r.success ? 'success' : 'failed',
                estimatedTravelMinutes: r.duration || updatedStores[index].estimatedTravelMinutes,
                routeError: r.error,
              };
            }
          });
        }
      } catch {
        // 标记当前批次为失败
        batch.forEach(store => {
          const index = updatedStores.findIndex(s => s.id === store.id);
          if (index !== -1) {
            updatedStores[index] = {
              ...updatedStores[index],
              routeStatus: 'failed',
              routeError: t('storeCleanup.networkError'),
            };
          }
        });
      }

      processedCount += batch.length;
      setProgress(Math.round((processedCount / successStores.length) * 100));
      setStores([...updatedStores]);

      // 添加延迟，避免请求过快
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setRoutePlanning(false);
    message.success(t('storeCleanup.routePlanComplete'));
  };

  // 统计数据
  const stats = {
    total: stores.length,
    success: stores.filter(s => s.geocodeStatus === 'success').length,
    failed: stores.filter(s => s.geocodeStatus === 'failed').length,
    pending: stores.filter(s => s.geocodeStatus === 'pending').length,
    disabled: stores.filter(s => s.status === 'DISABLED').length,
  };

  // 是否所有门店都已经有坐标（无需编码）
  const allGeocoded = stats.total > 0 && stats.pending === 0 && stats.failed === 0;
  // 是否可以进行路径规划（有成功编码的门店）
  const canRoutePlan = stats.success > 0;

  // 过滤显示的数据
  const displayStores = hideSuccess
    ? stores.filter(s => s.geocodeStatus === 'failed' || s.geocodeStatus === 'pending')
    : stores;

  // 表格列
  const columns: ColumnsType<Store> = [
    {
      title: t('stores.code'),
      dataIndex: 'code',
      key: 'code',
      width: 150,
      fixed: 'left',
    },
    {
      title: t('stores.name'),
      dataIndex: 'name',
      key: 'name',
      width: 200,
      ellipsis: true,
    },
    {
      title: t('stores.address'),
      key: 'fullAddress',
      width: 300,
      ellipsis: true,
      render: (_, record) => (
        <span>
          {[record.province, record.city, record.district, record.address]
            .filter(Boolean)
            .join('')}
        </span>
      ),
    },
    {
      title: t('storeCleanup.coordinates'),
      key: 'coordinates',
      width: 200,
      render: (_, record) => (
        record.longitude && record.latitude ? (
          <Text type="success">
            <EnvironmentOutlined /> {record.longitude.toFixed(6)}, {record.latitude.toFixed(6)}
          </Text>
        ) : (
          <Text type="secondary">-</Text>
        )
      ),
    },
    {
      title: t('storeCleanup.geocodeStatus'),
      key: 'geocodeStatus',
      width: 120,
      render: (_, record) => {
        if (record.geocodeStatus === 'success') {
          return <Tag icon={<CheckCircleOutlined />} color="success">{t('storeCleanup.geocodeSuccess')}</Tag>;
        }
        if (record.geocodeStatus === 'failed') {
          return (
            <Tag icon={<CloseCircleOutlined />} color="error">
              {t('storeCleanup.geocodeFailedTag')}
            </Tag>
          );
        }
        return <Tag icon={<SyncOutlined />} color="default">{t('storeCleanup.geocodePending')}</Tag>;
      },
    },
    {
      title: t('storeCleanup.errorReason'),
      dataIndex: 'geocodeError',
      key: 'geocodeError',
      width: 200,
      ellipsis: true,
      render: (v) => v || '-',
    },
    {
      title: t('storeCleanup.estimatedTime'),
      dataIndex: 'estimatedTravelMinutes',
      key: 'estimatedTravelMinutes',
      width: 120,
      render: (v, record) => {
        if (record.routeStatus === 'success' || v) {
          return <Text type="success"><CarOutlined /> {v} {t('storeCleanup.minutes')}</Text>;
        }
        if (record.routeStatus === 'failed') {
          return <Text type="danger">{record.routeError || '-'}</Text>;
        }
        if (record.geocodeStatus === 'success') {
          return <Tag color="default">{t('storeCleanup.routePending')}</Tag>;
        }
        return <Text type="secondary">-</Text>;
      },
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => (
        <Tag color={status === 'ACTIVE' ? 'success' : 'error'}>
          {status === 'ACTIVE' ? t('status.active') : t('status.disabled')}
        </Tag>
      ),
    },
  ];

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
    getCheckboxProps: (record: Store) => ({
      disabled: record.geocodeStatus !== 'failed',
    }),
  };

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        <ClearOutlined style={{ marginRight: 8 }} />
        {t('storeCleanup.title')}
      </Title>

      <Card variant="borderless" style={{ marginBottom: 24 }}>
        <Alert
          message={t('storeCleanup.description')}
          description={t('storeCleanup.descriptionDetail')}
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
        />

        <Row gutter={24} style={{ marginBottom: 24 }}>
          <Col span={8}>
            <div style={{ marginBottom: 8 }}>
              <Text strong>{t('storeCleanup.selectCollectionPoint')}</Text>
              <span style={{ color: 'red' }}> *</span>
            </div>
            <Select
              placeholder={t('storeCleanup.selectCollectionPointPlaceholder')}
              value={selectedCollectionPoint || undefined}
              onChange={(v) => {
                setSelectedCollectionPoint(v);
                setSelectedRowKeys([]);
              }}
              style={{ width: '100%' }}
              options={collectionPoints.map((cp) => ({
                value: cp.id,
                label: `${cp.name} (${cp.code})`,
              }))}
            />
          </Col>
          <Col span={16}>
            {selectedCollectionPoint && (
              <Space style={{ marginTop: 28 }}>
                <Button
                  type="primary"
                  icon={<EnvironmentOutlined />}
                  onClick={handleGeocode}
                  loading={geocoding}
                  disabled={allGeocoded || routePlanning}
                >
                  {allGeocoded ? t('storeCleanup.allGeocoded') : t('storeCleanup.startGeocode')}
                </Button>
                <Button
                  type="primary"
                  icon={<CarOutlined />}
                  onClick={handleRoutePlan}
                  loading={routePlanning}
                  disabled={!canRoutePlan || geocoding}
                >
                  {t('storeCleanup.startRoutePlan')}
                </Button>
                <Popconfirm
                  title={t('storeCleanup.markDisabledConfirm')}
                  onConfirm={handleMarkAsDisabled}
                  disabled={selectedRowKeys.length === 0}
                >
                  <Button
                    danger
                    icon={<ExclamationCircleOutlined />}
                    disabled={selectedRowKeys.length === 0}
                  >
                    {t('storeCleanup.markAsDisabled', { count: selectedRowKeys.length })}
                  </Button>
                </Popconfirm>
                <Switch
                  checked={hideSuccess}
                  onChange={setHideSuccess}
                  checkedChildren={t('storeCleanup.showPendingAndFailed')}
                  unCheckedChildren={t('storeCleanup.showAll')}
                />
              </Space>
            )}
          </Col>
        </Row>

        {(geocoding || routePlanning) && (
          <Progress
            percent={progress}
            status="active"
            format={() => geocoding ? t('storeCleanup.geocodingProgress') : t('storeCleanup.routePlanningProgress')}
            style={{ marginBottom: 24 }}
          />
        )}

        {allGeocoded && !geocoding && !routePlanning && (
          <Alert
            message={t('storeCleanup.allGeocodedMessage')}
            description={t('storeCleanup.allGeocodedDesc')}
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            style={{ marginBottom: 24 }}
          />
        )}

        {selectedCollectionPoint && stores.length > 0 && (
          <>
            <Row gutter={16} style={{ marginBottom: 24 }}>
              <Col span={4}>
                <Card size="small">
                  <Statistic
                    title={t('storeCleanup.totalStores')}
                    value={stats.total}
                  />
                </Card>
              </Col>
              <Col span={4}>
                <Card size="small">
                  <Statistic
                    title={t('storeCleanup.geocodeSuccess')}
                    value={stats.success}
                    valueStyle={{ color: '#3f8600' }}
                    prefix={<CheckCircleOutlined />}
                  />
                </Card>
              </Col>
              <Col span={4}>
                <Card size="small">
                  <Statistic
                    title={t('storeCleanup.geocodeFailedCount')}
                    value={stats.failed}
                    valueStyle={{ color: '#cf1322' }}
                    prefix={<CloseCircleOutlined />}
                  />
                </Card>
              </Col>
              <Col span={4}>
                <Card size="small">
                  <Statistic
                    title={t('storeCleanup.geocodePending')}
                    value={stats.pending}
                    valueStyle={{ color: '#faad14' }}
                    prefix={<SyncOutlined />}
                  />
                </Card>
              </Col>
              <Col span={4}>
                <Card size="small">
                  <Statistic
                    title={t('storeCleanup.disabledCount')}
                    value={stats.disabled}
                    valueStyle={{ color: '#8c8c8c' }}
                  />
                </Card>
              </Col>
            </Row>

            <Table
              columns={columns}
              dataSource={displayStores}
              rowKey="id"
              loading={loading}
              rowSelection={rowSelection}
              scroll={{ x: 1400, y: 500 }}
              pagination={{
                pageSize: 50,
                showTotal: (total) => t('common.total', { count: total }),
              }}
              size="small"
            />
          </>
        )}

        {selectedCollectionPoint && stores.length === 0 && !loading && (
          <Alert
            message={t('storeCleanup.noStores')}
            description={t('storeCleanup.noStoresDesc')}
            type="warning"
            showIcon
          />
        )}
      </Card>
    </div>
  );
}

