'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Row,
  Col,
  Statistic,
  Switch,
  Tooltip,
} from 'antd';
import {
  TranslationOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  DeleteOutlined,
  ReloadOutlined,
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

interface TranslationCache {
  en?: string;
  [locale: string]: string | undefined;
}

interface Vehicle {
  id: string;
  plateNumber: string;
  type: 'COLLECTION' | 'TRANSFER';
  driverName: string | null;
  driverNameTranslations: TranslationCache | null;
  driverPhone: string | null;
  translateStatus?: 'pending' | 'translated' | 'failed';
  translateError?: string;
}

interface TranslateResult {
  vehicleId: string;
  success: boolean;
  driverNameTranslation?: string;
  error?: string;
}

export default function VehicleTranslatePage() {
  const t = useTranslations();
  const { message } = App.useApp();
  const [collectionPoints, setCollectionPoints] = useState<CollectionPoint[]>([]);
  const [selectedCollectionPoint, setSelectedCollectionPoint] = useState<string>('');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showPendingOnly, setShowPendingOnly] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [targetLanguage, setTargetLanguage] = useState<string>('en');
  const [stats, setStats] = useState({ total: 0, translated: 0, pending: 0 });
  
  // 支持的目标语言
  const targetLanguages = [
    { value: 'en', label: 'English' },
    { value: 'fr', label: 'Français' },
    { value: 'de', label: 'Deutsch' },
    { value: 'es', label: 'Español' },
  ];

  // 翻译中断标记
  const abortRef = useRef(false);

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

  // 获取车辆列表
  const fetchVehicles = useCallback(async () => {
    if (!selectedCollectionPoint) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams({
        collectionPointId: selectedCollectionPoint,
        pageSize: '9999',
        status: showPendingOnly ? 'pending' : '',
      });

      const response = await fetch(`/api/vehicles/translate?${params}`);
      const result = await response.json();

      if (response.ok) {
        // 标记车辆的翻译状态
        const vehiclesWithStatus = result.data.map((vehicle: Vehicle) => ({
          ...vehicle,
          translateStatus: vehicle.driverNameTranslations?.[targetLanguage] ? 'translated' : 'pending',
        }));
        setVehicles(vehiclesWithStatus);
        setStats(result.stats || { total: 0, translated: 0, pending: 0 });
      } else {
        message.error(result.message || t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [selectedCollectionPoint, showPendingOnly, targetLanguage, t, message]);

  useEffect(() => {
    fetchCollectionPoints();
  }, [fetchCollectionPoints]);

  useEffect(() => {
    if (selectedCollectionPoint) {
      fetchVehicles();
    } else {
      setVehicles([]);
      setStats({ total: 0, translated: 0, pending: 0 });
    }
  }, [selectedCollectionPoint, fetchVehicles]);

  // 检查翻译状态
  const hasTranslation = (vehicle: Vehicle) => {
    return vehicle.driverNameTranslations?.[targetLanguage] ? true : false;
  };

  // 获取翻译内容
  const getTranslation = (vehicle: Vehicle) => {
    return vehicle.driverNameTranslations?.[targetLanguage] || '';
  };

  // 执行翻译
  const handleTranslate = async (vehicleIds?: string[]) => {
    const idsToTranslate = vehicleIds || (selectedRowKeys.length > 0 
      ? selectedRowKeys as string[]
      : vehicles.filter(v => v.translateStatus === 'pending').map(v => v.id));
    
    if (idsToTranslate.length === 0) {
      message.info(t('vehicleTranslate.noVehiclesNeedTranslate'));
      return;
    }

    setTranslating(true);
    setProgress(0);
    abortRef.current = false;

    const batchSize = 5; // 每批处理5个
    const batches = [];
    for (let i = 0; i < idsToTranslate.length; i += batchSize) {
      batches.push(idsToTranslate.slice(i, i + batchSize));
    }

    let processedCount = 0;
    const updatedVehicles = [...vehicles];

    for (const batch of batches) {
      if (abortRef.current) break;

      try {
        const response = await fetch('/api/vehicles/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vehicleIds: batch,
            targetLanguage,
          }),
        });

        const result = await response.json();

        if (response.ok) {
          // 更新车辆状态
          result.results.forEach((r: TranslateResult) => {
            const index = updatedVehicles.findIndex(v => v.id === r.vehicleId);
            if (index !== -1) {
              if (r.success) {
                updatedVehicles[index] = {
                  ...updatedVehicles[index],
                  translateStatus: 'translated',
                  driverNameTranslations: r.driverNameTranslation 
                    ? { ...(updatedVehicles[index].driverNameTranslations || {}), [targetLanguage]: r.driverNameTranslation }
                    : updatedVehicles[index].driverNameTranslations,
                };
              } else {
                updatedVehicles[index] = {
                  ...updatedVehicles[index],
                  translateStatus: 'failed',
                  translateError: r.error,
                };
              }
            }
          });
        }
      } catch {
        // 标记当前批次为失败
        batch.forEach(vehicleId => {
          const index = updatedVehicles.findIndex(v => v.id === vehicleId);
          if (index !== -1) {
            updatedVehicles[index] = {
              ...updatedVehicles[index],
              translateStatus: 'failed',
              translateError: t('storeCleanup.networkError'),
            };
          }
        });
      }

      processedCount += batch.length;
      setProgress(Math.round((processedCount / idsToTranslate.length) * 100));
      setVehicles([...updatedVehicles]);

      // 添加延迟，避免请求过快
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setTranslating(false);
    setSelectedRowKeys([]);
    
    // 刷新统计数据
    fetchVehicles();
    message.success(t('vehicleTranslate.translateComplete'));
  };

  // 清除翻译
  const handleClearTranslations = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning(t('common.selectAtLeastOne'));
      return;
    }

    try {
      const response = await fetch('/api/vehicles/translate', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleIds: selectedRowKeys,
          targetLanguage,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        message.success(t('vehicleTranslate.clearTranslationsSuccess', { count: result.count }));
        setSelectedRowKeys([]);
        fetchVehicles();
      } else {
        message.error(result.message || t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    }
  };

  // 过滤显示的数据
  const displayVehicles = showPendingOnly
    ? vehicles.filter(v => v.translateStatus === 'pending' || v.translateStatus === 'failed')
    : vehicles;

  // 表格列
  const columns: ColumnsType<Vehicle> = [
    {
      title: t('vehicles.plateNumber'),
      dataIndex: 'plateNumber',
      key: 'plateNumber',
      width: 120,
      fixed: 'left',
    },
    {
      title: t('vehicles.type'),
      dataIndex: 'type',
      key: 'type',
      width: 180,
      render: (type) => (
        <Tag color={type === 'COLLECTION' ? 'blue' : 'green'}>
          {type === 'COLLECTION' ? t('vehicles.typeCollection') : t('vehicles.typeTransfer')}
        </Tag>
      ),
    },
    {
      title: t('vehicleTranslate.fields.driverName'),
      key: 'driverName',
      width: 200,
      render: (_, record) => (
        <div>
          <div>
            <Text strong>{t('vehicleTranslate.original')}:</Text> {record.driverName || '-'}
          </div>
          {hasTranslation(record) && (
            <div style={{ marginTop: 4 }}>
              <Text type="success">{t('vehicleTranslate.translated')}:</Text>{' '}
              <Text type="success">{getTranslation(record)}</Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: t('vehicles.driverPhone'),
      dataIndex: 'driverPhone',
      key: 'driverPhone',
      width: 130,
      render: (v) => v || '-',
    },
    {
      title: t('vehicleTranslate.translateStatus'),
      key: 'translateStatus',
      width: 120,
      render: (_, record) => {
        if (record.translateStatus === 'translated') {
          return <Tag icon={<CheckCircleOutlined />} color="success">{t('vehicleTranslate.statusTranslated')}</Tag>;
        }
        if (record.translateStatus === 'failed') {
          return (
            <Tooltip title={record.translateError}>
              <Tag icon={<CloseCircleOutlined />} color="error">{t('vehicleTranslate.statusFailed')}</Tag>
            </Tooltip>
          );
        }
        return <Tag icon={<SyncOutlined />} color="default">{t('vehicleTranslate.statusPending')}</Tag>;
      },
    },
  ];

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  };

  // 是否所有司机都已翻译
  const allTranslated = stats.total > 0 && stats.pending === 0;

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        <CarOutlined style={{ marginRight: 8 }} />
        {t('vehicleTranslate.title')}
      </Title>

      <Card variant="borderless" style={{ marginBottom: 24 }}>
        <Alert
          message={t('vehicleTranslate.description')}
          description={t('vehicleTranslate.descriptionDetail')}
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
        />

        <Row gutter={24} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <div style={{ marginBottom: 8 }}>
              <Text strong>{t('vehicleTranslate.selectCollectionPoint')}</Text>
              <span style={{ color: 'red' }}> *</span>
            </div>
            <Select
              placeholder={t('vehicleTranslate.selectCollectionPointPlaceholder')}
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
          <Col span={4}>
            <div style={{ marginBottom: 8 }}>
              <Text strong>{t('vehicleTranslate.targetLanguage')}</Text>
            </div>
            <Select
              value={targetLanguage}
              onChange={setTargetLanguage}
              style={{ width: '100%' }}
              options={targetLanguages}
            />
          </Col>
          <Col span={14}>
            {selectedCollectionPoint && (
              <Space style={{ marginTop: 28 }} wrap>
                <Button
                  type="primary"
                  icon={<TranslationOutlined />}
                  onClick={() => handleTranslate()}
                  loading={translating}
                  disabled={allTranslated && selectedRowKeys.length === 0}
                >
                  {selectedRowKeys.length > 0
                    ? t('vehicleTranslate.translateSelected', { count: selectedRowKeys.length })
                    : allTranslated
                    ? t('vehicleTranslate.translateComplete')
                    : t('vehicleTranslate.translateAll')}
                </Button>
                <Popconfirm
                  title={t('vehicleTranslate.clearTranslationsConfirm')}
                  onConfirm={handleClearTranslations}
                  disabled={selectedRowKeys.length === 0}
                  destroyOnHidden
                >
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    disabled={selectedRowKeys.length === 0}
                  >
                    {t('vehicleTranslate.clearTranslations')}
                    {selectedRowKeys.length > 0 && ` (${selectedRowKeys.length})`}
                  </Button>
                </Popconfirm>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={fetchVehicles}
                  disabled={translating}
                >
                  {t('common.refresh')}
                </Button>
                <Switch
                  checked={showPendingOnly}
                  onChange={setShowPendingOnly}
                  checkedChildren={t('vehicleTranslate.showPendingOnly')}
                  unCheckedChildren={t('vehicleTranslate.showAll')}
                />
              </Space>
            )}
          </Col>
        </Row>

        {translating && (
          <Progress
            percent={progress}
            status="active"
            format={() => t('vehicleTranslate.translating')}
            style={{ marginBottom: 24 }}
          />
        )}

        {allTranslated && !translating && selectedCollectionPoint && vehicles.length > 0 && (
          <Alert
            message={t('vehicleTranslate.translateComplete')}
            description={t('vehicleTranslate.translateSuccess', { count: stats.translated })}
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            style={{ marginBottom: 24 }}
          />
        )}

        {selectedCollectionPoint && vehicles.length > 0 && (
          <>
            <Row gutter={16} style={{ marginBottom: 24 }}>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title={t('vehicleTranslate.totalVehicles')}
                    value={stats.total}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title={t('vehicleTranslate.translatedCount')}
                    value={stats.translated}
                    valueStyle={{ color: '#3f8600' }}
                    prefix={<CheckCircleOutlined />}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title={t('vehicleTranslate.pendingCount')}
                    value={stats.pending}
                    valueStyle={{ color: '#faad14' }}
                    prefix={<SyncOutlined />}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title={t('vehicleTranslate.failedCount')}
                    value={vehicles.filter(v => v.translateStatus === 'failed').length}
                    valueStyle={{ color: '#cf1322' }}
                    prefix={<CloseCircleOutlined />}
                  />
                </Card>
              </Col>
            </Row>

            <Table
              columns={columns}
              dataSource={displayVehicles}
              rowKey="id"
              loading={loading}
              rowSelection={rowSelection}
              scroll={{ x: 900, y: 500 }}
              pagination={{
                pageSize: 50,
                showTotal: (total) => t('common.total', { count: total }),
              }}
              size="small"
            />
          </>
        )}

        {selectedCollectionPoint && vehicles.length === 0 && !loading && (
          <Alert
            message={t('vehicleTranslate.noVehicles')}
            description={t('vehicleTranslate.noVehiclesDesc')}
            type="warning"
            showIcon
          />
        )}
      </Card>
    </div>
  );
}

