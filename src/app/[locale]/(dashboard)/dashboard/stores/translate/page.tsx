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

interface Store {
  id: string;
  code: string;
  name: string;
  nameTranslations: TranslationCache | null;
  address: string;
  addressTranslations: TranslationCache | null;
  legalPerson: string | null;
  legalPersonTranslations: TranslationCache | null;
  province: string | null;
  city: string | null;
  district: string | null;
  translateStatus?: 'pending' | 'translated' | 'failed';
  translateError?: string;
}

interface TranslateResult {
  storeId: string;
  success: boolean;
  nameTranslation?: string;
  addressTranslation?: string;
  legalPersonTranslation?: string;
  error?: string;
}

export default function StoreTranslatePage() {
  const t = useTranslations();
  const { message, modal } = App.useApp();
  const [collectionPoints, setCollectionPoints] = useState<CollectionPoint[]>([]);
  const [selectedCollectionPoint, setSelectedCollectionPoint] = useState<string>('');
  const [stores, setStores] = useState<Store[]>([]);
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

  // 获取门店列表
  const fetchStores = useCallback(async () => {
    if (!selectedCollectionPoint) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams({
        collectionPointId: selectedCollectionPoint,
        pageSize: '9999',
        status: showPendingOnly ? 'pending' : '',
      });

      const response = await fetch(`/api/stores/translate?${params}`);
      const result = await response.json();

      if (response.ok) {
        // 标记门店的翻译状态
        const storesWithStatus = result.data.map((store: Store) => ({
          ...store,
          translateStatus: store.nameTranslations?.[targetLanguage] ? 'translated' : 'pending',
        }));
        setStores(storesWithStatus);
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
      fetchStores();
    } else {
      setStores([]);
      setStats({ total: 0, translated: 0, pending: 0 });
    }
  }, [selectedCollectionPoint, fetchStores]);

  // 检查翻译状态
  const hasTranslation = (store: Store, field: 'name' | 'address' | 'legalPerson') => {
    const translationsField = `${field}Translations` as keyof Store;
    const translations = store[translationsField] as TranslationCache | null;
    return translations?.[targetLanguage] ? true : false;
  };

  // 获取翻译内容
  const getTranslation = (store: Store, field: 'name' | 'address' | 'legalPerson') => {
    const translationsField = `${field}Translations` as keyof Store;
    const translations = store[translationsField] as TranslationCache | null;
    return translations?.[targetLanguage] || '';
  };

  // 执行翻译
  const handleTranslate = async (storeIds?: string[]) => {
    const idsToTranslate = storeIds || (selectedRowKeys.length > 0 
      ? selectedRowKeys as string[]
      : stores.filter(s => s.translateStatus === 'pending').map(s => s.id));
    
    if (idsToTranslate.length === 0) {
      message.info(t('storeTranslate.noStoresNeedTranslate'));
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
    const updatedStores = [...stores];

    for (const batch of batches) {
      if (abortRef.current) break;

      try {
        const response = await fetch('/api/stores/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storeIds: batch,
            targetLanguage,
          }),
        });

        const result = await response.json();

        if (response.ok) {
          // 更新门店状态
          result.results.forEach((r: TranslateResult) => {
            const index = updatedStores.findIndex(s => s.id === r.storeId);
            if (index !== -1) {
              if (r.success) {
                updatedStores[index] = {
                  ...updatedStores[index],
                  translateStatus: 'translated',
                  nameTranslations: r.nameTranslation 
                    ? { ...(updatedStores[index].nameTranslations || {}), [targetLanguage]: r.nameTranslation }
                    : updatedStores[index].nameTranslations,
                  addressTranslations: r.addressTranslation
                    ? { ...(updatedStores[index].addressTranslations || {}), [targetLanguage]: r.addressTranslation }
                    : updatedStores[index].addressTranslations,
                  legalPersonTranslations: r.legalPersonTranslation
                    ? { ...(updatedStores[index].legalPersonTranslations || {}), [targetLanguage]: r.legalPersonTranslation }
                    : updatedStores[index].legalPersonTranslations,
                };
              } else {
                updatedStores[index] = {
                  ...updatedStores[index],
                  translateStatus: 'failed',
                  translateError: r.error,
                };
              }
            }
          });
        }
      } catch {
        // 标记当前批次为失败
        batch.forEach(storeId => {
          const index = updatedStores.findIndex(s => s.id === storeId);
          if (index !== -1) {
            updatedStores[index] = {
              ...updatedStores[index],
              translateStatus: 'failed',
              translateError: t('storeCleanup.networkError'),
            };
          }
        });
      }

      processedCount += batch.length;
      setProgress(Math.round((processedCount / idsToTranslate.length) * 100));
      setStores([...updatedStores]);

      // 添加延迟，避免请求过快
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setTranslating(false);
    setSelectedRowKeys([]);
    
    // 刷新统计数据
    fetchStores();
    message.success(t('storeTranslate.translateComplete'));
  };

  // 清除翻译
  const handleClearTranslations = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning(t('common.selectAtLeastOne'));
      return;
    }

    try {
      const response = await fetch('/api/stores/translate', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeIds: selectedRowKeys,
          targetLanguage,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        message.success(t('storeTranslate.clearTranslationsSuccess', { count: result.count }));
        setSelectedRowKeys([]);
        fetchStores();
      } else {
        message.error(result.message || t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    }
  };

  // 过滤显示的数据
  const displayStores = showPendingOnly
    ? stores.filter(s => s.translateStatus === 'pending' || s.translateStatus === 'failed')
    : stores;

  // 表格列
  const columns: ColumnsType<Store> = [
    {
      title: t('stores.code'),
      dataIndex: 'code',
      key: 'code',
      width: 120,
      fixed: 'left',
    },
    {
      title: t('storeTranslate.fields.name'),
      key: 'name',
      width: 300,
      render: (_, record) => (
        <div>
          <div>
            <Text strong>{t('storeTranslate.original')}:</Text> {record.name}
          </div>
          {hasTranslation(record, 'name') && (
            <div style={{ marginTop: 4 }}>
              <Text type="success">{t('storeTranslate.translated')}:</Text>{' '}
              <Text type="success">{getTranslation(record, 'name')}</Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: t('storeTranslate.fields.address'),
      key: 'address',
      width: 350,
      render: (_, record) => {
        const fullAddress = [record.province, record.city, record.district, record.address]
          .filter(Boolean)
          .join('');
        return (
          <div>
            <div>
              <Text strong>{t('storeTranslate.original')}:</Text>{' '}
              <Tooltip title={fullAddress}>
                <Text ellipsis style={{ maxWidth: 280 }}>{fullAddress}</Text>
              </Tooltip>
            </div>
            {hasTranslation(record, 'address') && (
              <div style={{ marginTop: 4 }}>
                <Text type="success">{t('storeTranslate.translated')}:</Text>{' '}
                <Tooltip title={getTranslation(record, 'address')}>
                  <Text type="success" ellipsis style={{ maxWidth: 280 }}>
                    {getTranslation(record, 'address')}
                  </Text>
                </Tooltip>
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: t('storeTranslate.fields.legalPerson'),
      key: 'legalPerson',
      width: 200,
      render: (_, record) => (
        <div>
          <div>
            <Text strong>{t('storeTranslate.original')}:</Text> {record.legalPerson || '-'}
          </div>
          {record.legalPerson && hasTranslation(record, 'legalPerson') && (
            <div style={{ marginTop: 4 }}>
              <Text type="success">{t('storeTranslate.translated')}:</Text>{' '}
              <Text type="success">{getTranslation(record, 'legalPerson')}</Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: t('storeTranslate.translateStatus'),
      key: 'translateStatus',
      width: 120,
      render: (_, record) => {
        if (record.translateStatus === 'translated') {
          return <Tag icon={<CheckCircleOutlined />} color="success">{t('storeTranslate.statusTranslated')}</Tag>;
        }
        if (record.translateStatus === 'failed') {
          return (
            <Tooltip title={record.translateError}>
              <Tag icon={<CloseCircleOutlined />} color="error">{t('storeTranslate.statusFailed')}</Tag>
            </Tooltip>
          );
        }
        return <Tag icon={<SyncOutlined />} color="default">{t('storeTranslate.statusPending')}</Tag>;
      },
    },
  ];

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  };

  // 是否所有门店都已翻译
  const allTranslated = stats.total > 0 && stats.pending === 0;

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        <TranslationOutlined style={{ marginRight: 8 }} />
        {t('storeTranslate.title')}
      </Title>

      <Card variant="borderless" style={{ marginBottom: 24 }}>
        <Alert
          message={t('storeTranslate.description')}
          description={t('storeTranslate.descriptionDetail')}
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
        />

        <Row gutter={24} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <div style={{ marginBottom: 8 }}>
              <Text strong>{t('storeTranslate.selectCollectionPoint')}</Text>
              <span style={{ color: 'red' }}> *</span>
            </div>
            <Select
              placeholder={t('storeTranslate.selectCollectionPointPlaceholder')}
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
              <Text strong>{t('storeTranslate.targetLanguage')}</Text>
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
                    ? t('storeTranslate.translateSelected', { count: selectedRowKeys.length })
                    : allTranslated
                    ? t('storeTranslate.translateComplete')
                    : t('storeTranslate.translateAll')}
                </Button>
                <Popconfirm
                  title={t('storeTranslate.clearTranslationsConfirm')}
                  onConfirm={handleClearTranslations}
                  disabled={selectedRowKeys.length === 0}
                  destroyOnHidden
                >
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    disabled={selectedRowKeys.length === 0}
                  >
                    {t('storeTranslate.clearTranslations')}
                    {selectedRowKeys.length > 0 && ` (${selectedRowKeys.length})`}
                  </Button>
                </Popconfirm>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={fetchStores}
                  disabled={translating}
                >
                  {t('common.refresh')}
                </Button>
                <Switch
                  checked={showPendingOnly}
                  onChange={setShowPendingOnly}
                  checkedChildren={t('storeTranslate.showPendingOnly')}
                  unCheckedChildren={t('storeTranslate.showAll')}
                />
              </Space>
            )}
          </Col>
        </Row>

        {translating && (
          <Progress
            percent={progress}
            status="active"
            format={() => t('storeTranslate.translating')}
            style={{ marginBottom: 24 }}
          />
        )}

        {allTranslated && !translating && selectedCollectionPoint && stores.length > 0 && (
          <Alert
            message={t('storeTranslate.translateComplete')}
            description={t('storeTranslate.translateSuccess', { count: stats.translated })}
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            style={{ marginBottom: 24 }}
          />
        )}

        {selectedCollectionPoint && stores.length > 0 && (
          <>
            <Row gutter={16} style={{ marginBottom: 24 }}>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title={t('storeTranslate.totalStores')}
                    value={stats.total}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title={t('storeTranslate.translatedCount')}
                    value={stats.translated}
                    valueStyle={{ color: '#3f8600' }}
                    prefix={<CheckCircleOutlined />}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title={t('storeTranslate.pendingCount')}
                    value={stats.pending}
                    valueStyle={{ color: '#faad14' }}
                    prefix={<SyncOutlined />}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title={t('storeTranslate.failedCount')}
                    value={stores.filter(s => s.translateStatus === 'failed').length}
                    valueStyle={{ color: '#cf1322' }}
                    prefix={<CloseCircleOutlined />}
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
              scroll={{ x: 1200, y: 500 }}
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
            message={t('storeTranslate.noStores')}
            description={t('storeTranslate.noStoresDesc')}
            type="warning"
            showIcon
          />
        )}
      </Card>
    </div>
  );
}
