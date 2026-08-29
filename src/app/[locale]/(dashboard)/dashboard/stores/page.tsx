'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Input,
  Select,
  Modal,
  Form,
  Popconfirm,
  Typography,
  Row,
  Col,
  App,
  Descriptions,
  Checkbox,
  Progress,
  Collapse,
  Divider,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  ShopOutlined,
  CarOutlined,
  EnvironmentOutlined,
  DownloadOutlined,
  AimOutlined,
  StopOutlined,
  FileWordOutlined,
  EyeOutlined,
  TranslationOutlined,
} from '@ant-design/icons';
import { useTranslations, useLocale } from 'next-intl';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useCollectionPoint } from '@/contexts/CollectionPointContext';
import { useAuth } from '@/contexts/AuthContext';
import { STORE } from '@/lib/permissions';

const { Title } = Typography;

interface TranslationCache {
  en?: string;
  [locale: string]: string | undefined;
}

interface Store {
  id: string;
  code: string;
  name: string;
  nameTranslations: TranslationCache | null;
  businessLicense: string | null;
  legalPerson: string | null;
  legalPersonTranslations: TranslationCache | null;
  address: string;
  addressTranslations: TranslationCache | null;
  province: string | null;
  city: string | null;
  district: string | null;
  longitude: number | null;
  latitude: number | null;
  contactName: string | null;
  contactPhone: string | null;
  estimatedTravelMinutes: number;
  status: 'ACTIVE' | 'DISABLED';
  isVirtual: boolean;
  disabledAt: string | null;
  createdAt: string;
  collectionPoint: {
    id: string;
    name: string;
    code: string;
  };
}

interface IsccExportJob {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';
  phase: string;
  progress: number;
  processed: number;
  total: number;
  fileName: string | null;
  fileSize: number | null;
  errorMessage: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export default function StoresPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { message } = App.useApp();
  const { currentCollectionPoint, getTranslatedName } = useCollectionPoint();
  const { can } = useAuth();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Store[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [isVirtualFilter] = useState<string>('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<Store | null>(null);
  const [form] = Form.useForm();
  
  // 导出相关状态
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exportForm] = Form.useForm();
  const [exporting, setExporting] = useState(false);
  
  // 重置坐标相关状态
  const [resettingGeocode, setResettingGeocode] = useState(false);
  
  // 排序相关状态
  const [sortField, setSortField] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<string>('');
  
  // 批量操作相关状态
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchDisabling, setBatchDisabling] = useState(false);
  
  // ISCC 导出相关状态
  const [isccModalVisible, setIsccModalVisible] = useState(false);
  const [submittingIscc, setSubmittingIscc] = useState(false);
  const [loadingIsccJob, setLoadingIsccJob] = useState(false);
  const [isccJob, setIsccJob] = useState<IsccExportJob | null>(null);
  
  // 翻译编辑相关状态
  const [translationLang, setTranslationLang] = useState<string>('en');
  
  // 支持的翻译语言列表
  const translationLanguages = [
    { value: 'en', label: 'English' },
    { value: 'fr', label: 'Français' },
    { value: 'de', label: 'Deutsch' },
    { value: 'es', label: 'Español' },
  ];

  // 获取翻译值的辅助函数
  const getTranslatedValue = (
    original: string | null | undefined,
    translations: TranslationCache | null | undefined
  ): string => {
    if (!original) return '';
    if (locale === 'zh') return original;
    return translations?.[locale] || original;
  };

  const fetchData = useCallback(async () => {
    if (!currentCollectionPoint) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        search,
        status: statusFilter,
        collectionPointId: currentCollectionPoint.id,
        isVirtual: isVirtualFilter,
        sortField,
        sortOrder,
      });

      const response = await fetch(`/api/stores?${params}`);
      const result = await response.json();

      if (response.ok) {
        setData(result.data);
        setTotal(result.total);
      } else {
        message.error(result.message || t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, statusFilter, currentCollectionPoint, isVirtualFilter, sortField, sortOrder, t, message]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 当收集点变化时，重置页码
  useEffect(() => {
    setPage(1);
    setSelectedRowKeys([]);
  }, [currentCollectionPoint]);

  const handleSearch = () => {
    setPage(1);
    fetchData();
  };

  const handleAdd = () => {
    setEditingItem(null);
    setTranslationLang('en'); // 重置为默认语言
    form.resetFields();
    form.setFieldsValue({ 
      status: 'ACTIVE', 
      isVirtual: false,
      collectionPointId: currentCollectionPoint?.id,
      nameTranslations: {},
      legalPersonTranslations: {},
      addressTranslations: {},
    });
    setModalVisible(true);
  };

  const handleEdit = (item: Store) => {
    setEditingItem(item);
    setTranslationLang('en'); // 重置为默认语言
    form.setFieldsValue({
      ...item,
      collectionPointId: item.collectionPoint.id,
      // 翻译字段 - 存储整个翻译对象
      nameTranslations: item.nameTranslations || {},
      legalPersonTranslations: item.legalPersonTranslations || {},
      addressTranslations: item.addressTranslations || {},
    });
    setModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/stores/${id}`, { method: 'DELETE' });
      const result = await response.json();

      if (response.ok) {
        message.success(t('common.success'));
        fetchData();
      } else {
        message.error(result.message || t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    }
  };

  const handleModalOk = async () => {
    try {
      const values = await form.validateFields();
      const isEditing = !!editingItem;
      const url = isEditing ? `/api/stores/${editingItem.id}` : '/api/stores';
      const method = isEditing ? 'PUT' : 'POST';

      // 清理空的翻译对象
      const cleanTranslations = (obj: TranslationCache | undefined) => {
        if (!obj) return null;
        const cleaned = Object.fromEntries(
          Object.entries(obj).filter(([, v]) => v && v.trim() !== '')
        );
        return Object.keys(cleaned).length > 0 ? cleaned : null;
      };

      const dataToSubmit = {
        ...values,
        nameTranslations: cleanTranslations(values.nameTranslations),
        legalPersonTranslations: cleanTranslations(values.legalPersonTranslations),
        addressTranslations: cleanTranslations(values.addressTranslations),
      };

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSubmit),
      });

      const result = await response.json();

      if (response.ok) {
        message.success(t('common.success'));
        setModalVisible(false);
        fetchData();
      } else {
        message.error(result.message || t('common.error'));
      }
    } catch {
      // 表单验证失败
    }
  };

  // 导出 Excel
  const handleExport = async () => {
    if (!currentCollectionPoint) {
      message.warning(t('ledgers.selectCollectionPointRequired'));
      return;
    }
    
    try {
      const values = await exportForm.validateFields();
      setExporting(true);

      const params = new URLSearchParams();
      params.set('collectionPointId', currentCollectionPoint.id);
      params.set('lang', locale); // 添加语言参数
      if (values.onlyActive) {
        params.set('status', 'ACTIVE');
      }
      if (values.isVirtual !== undefined && values.isVirtual !== '') {
        params.set('isVirtual', values.isVirtual);
      }
      if (values.hasEstimatedTime) {
        params.set('hasEstimatedTime', 'true');
      }
      if (values.includeEstimatedTime !== undefined) {
        params.set('includeEstimatedTime', values.includeEstimatedTime ? 'true' : 'false');
      }

      const response = await fetch(`/api/stores/export?${params}`);

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${t('stores.exportFileName')}_${getTranslatedName(currentCollectionPoint)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        setExportModalVisible(false);
        message.success(t('common.success'));
      } else {
        message.error(t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    } finally {
      setExporting(false);
    }
  };

  // 重置地理坐标
  const handleResetGeocode = async () => {
    if (!editingItem) return;

    setResettingGeocode(true);
    try {
      // 构造完整地址
      const fullAddress = [
        editingItem.province,
        editingItem.city,
        editingItem.district,
        editingItem.address,
      ].filter(Boolean).join('');

      // 1. 调用地理编码 API
      const geocodeResponse = await fetch('/api/stores/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stores: [{ id: editingItem.id, address: fullAddress }],
        }),
      });

      const geocodeResult = await geocodeResponse.json();

      if (!geocodeResponse.ok) {
        message.error(geocodeResult.message || t('stores.resetGeocodeFailed'));
        return;
      }

      const storeResult = geocodeResult.results?.[0];
      if (!storeResult?.success) {
        message.error(storeResult?.error || t('stores.resetGeocodeFailed'));
        return;
      }

      // 2. 调用路径规划 API
      const routeResponse = await fetch('/api/stores/route-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stores: [{
            id: editingItem.id,
            longitude: storeResult.longitude,
            latitude: storeResult.latitude,
          }],
          collectionPointId: editingItem.collectionPoint.id,
        }),
      });

      const routeResult = await routeResponse.json();

      console.log(routeResult);

      if (!routeResponse.ok) {
        // 坐标成功但路径规划失败，仍然提示成功但显示警告
        message.warning(routeResult.message || t('stores.resetGeocodeFailed'));
      }

      const routeStoreResult = routeResult.results?.[0];

      // 更新 editingItem 显示新的坐标和行程
      setEditingItem({
        ...editingItem,
        longitude: storeResult.longitude,
        latitude: storeResult.latitude,
        estimatedTravelMinutes: routeStoreResult?.success 
          ? routeStoreResult.duration 
          : editingItem.estimatedTravelMinutes,
      });

      message.success(t('stores.resetGeocodeSuccess'));
      
      // 刷新列表数据
      fetchData();
    } catch {
      message.error(t('stores.resetGeocodeFailed'));
    } finally {
      setResettingGeocode(false);
    }
  };

  // 导出单个门店 ISCC 声明
  const handleExportSingleIscc = async (storeId: string, storeName: string) => {
    try {
      const response = await fetch(`/api/stores/iscc-export?storeId=${storeId}&lang=${locale}`);

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const contentDisposition = response.headers.get('Content-Disposition');
        let fileName = `ISCC_${storeName}.docx`;
        if (contentDisposition) {
          const match = contentDisposition.match(/filename="?([^"]+)"?/);
          if (match) {
            fileName = decodeURIComponent(match[1]);
          }
        }
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        message.success(t('common.success'));
      } else {
        const result = await response.json();
        message.error(result.message || t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    }
  };

  // 提交 ISCC 异步导出任务，页面关闭后后台仍会继续处理。
  const handleExportIscc = async () => {
    if (!currentCollectionPoint) {
      message.warning(t('ledgers.selectCollectionPointRequired'));
      return;
    }

    try {
      setSubmittingIscc(true);
      const response = await fetch('/api/stores/iscc-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionPointId: currentCollectionPoint.id, lang: locale }),
      });
      const result = await response.json();

      if (!response.ok) {
        message.error(result.message || t('common.error'));
        return;
      }

      setIsccJob(result.data);
      message.success(
        result.reused
          ? t('stores.exportTaskAlreadyRunning')
          : t('stores.exportTaskSubmitted')
      );
    } catch {
      message.error(t('common.error'));
    } finally {
      setSubmittingIscc(false);
    }
  };

  const handleDownloadIscc = () => {
    if (!isccJob) return;
    window.location.href = `/api/stores/iscc-export/jobs/${isccJob.id}/download`;
  };

  // 打开弹窗时恢复最近任务，用户无需一直停留在页面上。
  useEffect(() => {
    if (!isccModalVisible || !currentCollectionPoint) return;

    let cancelled = false;
    const loadLatestJob = async () => {
      setLoadingIsccJob(true);
      try {
        const response = await fetch(
          `/api/stores/iscc-export/jobs?collectionPointId=${currentCollectionPoint.id}&limit=1`
        );
        const result = await response.json();
        if (!cancelled && response.ok) {
          setIsccJob(result.data?.[0] || null);
        }
      } finally {
        if (!cancelled) setLoadingIsccJob(false);
      }
    };

    void loadLatestJob();
    return () => {
      cancelled = true;
    };
  }, [isccModalVisible, currentCollectionPoint]);

  // 只在弹窗展示且任务运行时轮询，关闭弹窗不影响后台任务。
  useEffect(() => {
    if (
      !isccModalVisible ||
      !isccJob ||
      !['PENDING', 'PROCESSING'].includes(isccJob.status)
    ) {
      return;
    }

    let cancelled = false;
    const refreshJob = async () => {
      try {
        const response = await fetch(`/api/stores/iscc-export/jobs/${isccJob.id}`);
        const result = await response.json();
        if (!cancelled && response.ok) setIsccJob(result.data);
      } catch {
        // 短暂网络波动时保留当前进度，下一次轮询会继续。
      }
    };

    const timer = window.setInterval(() => void refreshJob(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isccModalVisible, isccJob]);

  // 批量停用
  const handleBatchDisable = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning(t('common.selectAtLeastOne'));
      return;
    }

    setBatchDisabling(true);
    try {
      const response = await fetch('/api/stores/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'disable',
          ids: selectedRowKeys,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        message.success(t('stores.batchDisableSuccess', { count: result.count }));
        setSelectedRowKeys([]);
        fetchData();
      } else {
        message.error(result.message || t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    } finally {
      setBatchDisabling(false);
    }
  };

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
      width: 180,
      ellipsis: true,
      render: (_, record) => getTranslatedValue(record.name, record.nameTranslations),
    },
    {
      title: t('stores.businessLicense'),
      dataIndex: 'businessLicense',
      key: 'businessLicense',
      width: 180,
      render: (v) => v || '-',
    },
    {
      title: t('stores.address'),
      dataIndex: 'address',
      key: 'address',
      width: 250,
      ellipsis: true,
      render: (_, record) => getTranslatedValue(record.address, record.addressTranslations),
    },
    {
      title: t('stores.estimatedTravelMinutes'),
      dataIndex: 'estimatedTravelMinutes',
      key: 'estimatedTravelMinutes',
      width: 120,
      sorter: true,
      sortOrder: sortField === 'estimatedTravelMinutes' ? (sortOrder as 'ascend' | 'descend') : undefined,
      render: (v) => (
        <span>
          <CarOutlined style={{ marginRight: 4 }} />
          {v} {t('storeCleanup.minutes')}
        </span>
      ),
    },
    {
      title: t('stores.isVirtual'),
      dataIndex: 'isVirtual',
      key: 'isVirtual',
      width: 100,
      render: (v) => (
        <Tag color={v ? 'orange' : 'blue'}>
          {v ? t('common.yes') : t('common.no')}
        </Tag>
      ),
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
    {
      title: t('common.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (date) => dayjs(date).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          {can(STORE.EDIT) ? (
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            />
          ) : (
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => handleEdit(record)}
              title={t('common.view')}
            />
          )}
          {!record.isVirtual && (
            <Button
              type="link"
              size="small"
              icon={<FileWordOutlined />}
              onClick={() => handleExportSingleIscc(record.id, record.name)}
              title={t('stores.exportIscc')}
            />
          )}
          {can(STORE.DELETE) && (
            <Popconfirm
              title={t('stores.deleteConfirm', { name: record.name })}
              onConfirm={() => handleDelete(record.id)}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
              destroyOnHidden
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        <ShopOutlined style={{ marginRight: 8 }} />
        {t('stores.title')}
      </Title>

      <Card variant="borderless">
        <Space style={{ marginBottom: 16 }} wrap>
          <Input
            placeholder={t('common.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 200 }}
            prefix={<SearchOutlined />}
          />
          <Select
            placeholder={t('common.status')}
            value={statusFilter || undefined}
            onChange={setStatusFilter}
            style={{ width: 120 }}
            allowClear
            options={[
              { value: 'ACTIVE', label: t('status.active') },
              { value: 'DISABLED', label: t('status.disabled') },
            ]}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
            {t('common.search')}
          </Button>
          {can(STORE.CREATE) && (
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
              {t('stores.addStore')}
            </Button>
          )}
          <Button
            icon={<DownloadOutlined />}
            onClick={() => {
              exportForm.resetFields();
              exportForm.setFieldsValue({
                isVirtual: 'false',
                onlyActive: true,
                hasEstimatedTime: true,
                includeEstimatedTime: true,
              });
              setExportModalVisible(true);
            }}
          >
            {t('stores.exportExcel')}
          </Button>
          <Button
            icon={<FileWordOutlined />}
            onClick={() => {
              setIsccModalVisible(true);
            }}
          >
            {t('stores.exportIscc')}
          </Button>
          {can(STORE.EDIT) && (
            <Popconfirm
              title={t('stores.batchDisableConfirm', { count: selectedRowKeys.length })}
              onConfirm={handleBatchDisable}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
              disabled={selectedRowKeys.length === 0}
              destroyOnHidden
            >
              <Button
                danger
                icon={<StopOutlined />}
                disabled={selectedRowKeys.length === 0}
                loading={batchDisabling}
              >
                {t('stores.batchDisable')}
                {selectedRowKeys.length > 0 && ` (${selectedRowKeys.length})`}
              </Button>
            </Popconfirm>
          )}
        </Space>

        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1600 }}
          rowSelection={
            can(STORE.EDIT)
              ? {
                  selectedRowKeys,
                  onChange: (keys) => setSelectedRowKeys(keys),
                  getCheckboxProps: (record) => ({
                    disabled: record.status === 'DISABLED',
                  }),
                }
              : undefined
          }
          onRow={
            can(STORE.EDIT)
              ? (record) => ({
                  onClick: () => {
                    if (record.status === 'DISABLED') return;
                    const key = record.id;
                    const newKeys = selectedRowKeys.includes(key)
                      ? selectedRowKeys.filter((k) => k !== key)
                      : [...selectedRowKeys, key];
                    setSelectedRowKeys(newKeys);
                  },
                  style: {
                    cursor: record.status === 'DISABLED' ? 'not-allowed' : 'pointer',
                  },
                })
              : undefined
          }
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (total) => t('common.total', { count: total }),
          }}
          onChange={(pagination, _, sorter) => {
            // 处理分页
            if (pagination.current !== page) {
              setPage(pagination.current || 1);
            }
            if (pagination.pageSize !== pageSize) {
              setPageSize(pagination.pageSize || 10);
            }
            
            // 处理排序
            const s = Array.isArray(sorter) ? sorter[0] : sorter;
            const newSortField = s.field && s.order ? (s.field as string) : '';
            const newSortOrder = s.order || '';
            
            // 只有排序变化时才重置页码
            if (newSortField !== sortField || newSortOrder !== sortOrder) {
              setSortField(newSortField);
              setSortOrder(newSortOrder);
              setPage(1);
            }
          }}
        />
      </Card>

      {/* 新增/编辑/查看门店弹窗 */}
      <Modal
        title={
          editingItem
            ? can(STORE.EDIT)
              ? t('stores.editStore')
              : t('common.detail')
            : t('stores.addStore')
        }
        open={modalVisible}
        onOk={handleModalOk}
        onCancel={() => setModalVisible(false)}
        width={700}
        destroyOnHidden
        footer={
          editingItem && !can(STORE.EDIT)
            ? [
                <Button key="close" onClick={() => setModalVisible(false)}>
                  {t('common.cancel')}
                </Button>,
              ]
            : undefined
        }
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }} disabled={!!editingItem && !can(STORE.EDIT)}>
          {/* 隐藏的收集点字段 */}
          <Form.Item name="collectionPointId" hidden>
            <Input />
          </Form.Item>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item
                name="code"
                label={t('stores.code')}
                rules={[
                  {
                    required: true,
                    message: t('validation.required', { field: t('stores.code') }),
                  },
                ]}
              >
                <Input disabled={!!editingItem} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="name"
            label={t('stores.name')}
            rules={[
              {
                required: true,
                message: t('validation.required', { field: t('stores.name') }),
              },
            ]}
          >
            <Input />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="businessLicense" label={t('stores.businessLicense')}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="legalPerson" label={t('stores.legalPerson')}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="address"
            label={t('stores.address')}
            rules={[
              {
                required: true,
                message: t('validation.required', { field: t('stores.address') }),
              },
            ]}
          >
            <Input />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="province" label={t('stores.province')}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="city" label={t('stores.city')}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="district" label={t('stores.district')}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="contactName" label={t('stores.contactName')}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contactPhone" label={t('stores.contactPhone')}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
          {editingItem && (
            <Descriptions
              bordered
              size="small"
              column={2}
              style={{ marginBottom: 24 }}
            >
              <Descriptions.Item label={t('storeCleanup.coordinates')} span={2}>
                <Space>
                  {editingItem.longitude && editingItem.latitude ? (
                    <span style={{ color: '#52c41a' }}>
                      <EnvironmentOutlined style={{ marginRight: 4 }} />
                      {editingItem.longitude.toFixed(6)}, {editingItem.latitude.toFixed(6)}
                    </span>
                  ) : (
                    <span style={{ color: '#999' }}>-</span>
                  )}
                  <Popconfirm
                    title={t('stores.resetGeocodeConfirm')}
                    onConfirm={handleResetGeocode}
                    okText={t('common.confirm')}
                    cancelText={t('common.cancel')}
                    destroyOnHidden
                  >
                    <Button
                      type="link"
                      size="small"
                      icon={<AimOutlined />}
                      loading={resettingGeocode}
                    >
                      {resettingGeocode ? t('stores.resettingGeocode') : t('stores.resetGeocode')}
                    </Button>
                  </Popconfirm>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label={t('stores.estimatedTravelMinutes')}>
                <span>
                  <CarOutlined style={{ marginRight: 4 }} />
                  {editingItem.estimatedTravelMinutes} {t('storeCleanup.minutes')}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label={t('stores.isVirtual')}>
                <Tag color={editingItem.isVirtual ? 'orange' : 'blue'}>
                  {editingItem.isVirtual ? t('common.yes') : t('common.no')}
                </Tag>
              </Descriptions.Item>
            </Descriptions>
          )}
          {editingItem && (
            <Form.Item name="status" label={t('common.status')}>
              <Select
                options={[
                  { value: 'ACTIVE', label: t('status.active') },
                  { value: 'DISABLED', label: t('status.disabled') },
                ]}
              />
            </Form.Item>
          )}
          
          {/* 翻译编辑区域 */}
          <Divider style={{ margin: '16px 0 8px' }} />
          <Collapse
            ghost
            items={[
              {
                key: 'translations',
                label: (
                  <Space>
                    <TranslationOutlined />
                    {t('stores.translationSection')}
                  </Space>
                ),
                children: (
                  <div style={{ paddingTop: 8 }}>
                    <Form.Item label={t('common.language')} style={{ marginBottom: 16 }}>
                      <Select
                        value={translationLang}
                        onChange={setTranslationLang}
                        style={{ width: 150 }}
                        options={translationLanguages}
                      />
                    </Form.Item>
                    <Form.Item
                      label={t('stores.name')}
                      style={{ marginBottom: 12 }}
                    >
                      <Form.Item name={['nameTranslations', translationLang]} noStyle>
                        <Input placeholder={`${t('stores.name')} (${translationLanguages.find(l => l.value === translationLang)?.label})`} />
                      </Form.Item>
                    </Form.Item>
                    <Form.Item
                      label={t('stores.legalPerson')}
                      style={{ marginBottom: 12 }}
                    >
                      <Form.Item name={['legalPersonTranslations', translationLang]} noStyle>
                        <Input placeholder={`${t('stores.legalPerson')} (${translationLanguages.find(l => l.value === translationLang)?.label})`} />
                      </Form.Item>
                    </Form.Item>
                    <Form.Item
                      label={t('stores.address')}
                      style={{ marginBottom: 8 }}
                    >
                      <Form.Item name={['addressTranslations', translationLang]} noStyle>
                        <Input placeholder={`${t('stores.address')} (${translationLanguages.find(l => l.value === translationLang)?.label})`} />
                      </Form.Item>
                    </Form.Item>
                  </div>
                ),
              },
            ]}
          />
        </Form>
      </Modal>

      {/* 导出 Excel 弹窗 */}
      <Modal
        title={t('stores.exportExcel')}
        open={exportModalVisible}
        onOk={handleExport}
        onCancel={() => setExportModalVisible(false)}
        confirmLoading={exporting}
        okText={t('stores.export')}
        width={500}
      >
        <Form form={exportForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="isVirtual" label={t('stores.isVirtual')}>
            <Select
              placeholder={t('common.all')}
              allowClear
              options={[
                { value: 'true', label: t('common.yes') },
                { value: 'false', label: t('common.no') },
              ]}
            />
          </Form.Item>
          <Form.Item name="onlyActive" valuePropName="checked">
            <Checkbox>{t('stores.onlyActiveStores')}</Checkbox>
          </Form.Item>
          <Form.Item name="hasEstimatedTime" valuePropName="checked">
            <Checkbox>{t('stores.onlyHasEstimatedTime')}</Checkbox>
          </Form.Item>
          <Form.Item name="includeEstimatedTime" valuePropName="checked">
            <Checkbox>{t('stores.includeEstimatedTime')}</Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      {/* 导出 ISCC 声明弹窗 */}
      <Modal
        title={t('stores.exportIsccTitle')}
        open={isccModalVisible}
        onCancel={() => setIsccModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setIsccModalVisible(false)}>
            {t('common.cancel')}
          </Button>,
          isccJob?.status === 'COMPLETED' && (
            <Button
              key="regenerate"
              onClick={handleExportIscc}
              loading={submittingIscc}
            >
              {t('stores.regenerateExport')}
            </Button>
          ),
          isccJob?.status === 'COMPLETED' ? (
            <Button
              key="download"
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleDownloadIscc}
            >
              {t('stores.downloadExport')}
            </Button>
          ) : ['PENDING', 'PROCESSING'].includes(isccJob?.status || '') ? (
            <Button key="processing" type="primary" disabled>
              {t('stores.exportTaskRunning')}
            </Button>
          ) : (
            <Button
              key="submit"
              type="primary"
              onClick={handleExportIscc}
              loading={submittingIscc}
            >
              {isccJob?.status === 'FAILED'
                ? t('stores.retryExport')
                : t('stores.startExport')}
            </Button>
          ),
        ]}
        width={500}
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 16 }}>
          {t('stores.exportIsccDescription')}
        </Typography.Paragraph>

        {loadingIsccJob ? (
          <Typography.Text type="secondary">{t('common.loading')}</Typography.Text>
        ) : isccJob ? (
          <div style={{ marginTop: 16 }}>
            <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
              <Typography.Text>
                {isccJob.phase === 'queued' || isccJob.phase === 'starting'
                  ? t('stores.exportProgress.queued')
                  : isccJob.phase === 'generating'
                    ? t('stores.exportProgress.generating')
                    : isccJob.phase === 'merging'
                      ? t('stores.exportProgress.merging')
                      : isccJob.phase === 'converting'
                        ? t('stores.exportProgress.converting')
                        : isccJob.phase === 'packaging'
                          ? t('stores.exportProgress.packaging')
                          : isccJob.status === 'COMPLETED'
                            ? t('stores.exportProgress.completed')
                            : isccJob.status === 'FAILED'
                              ? t('stores.exportProgress.failed')
                              : t('stores.exportProgress.expired')}
              </Typography.Text>
              <Tag
                color={
                  isccJob.status === 'COMPLETED'
                    ? 'success'
                    : isccJob.status === 'FAILED'
                      ? 'error'
                      : isccJob.status === 'EXPIRED'
                        ? 'default'
                        : 'processing'
                }
              >
                {isccJob.status}
              </Tag>
            </Space>
            <Progress
              percent={isccJob.progress}
              status={
                isccJob.status === 'FAILED'
                  ? 'exception'
                  : isccJob.status === 'COMPLETED'
                    ? 'success'
                    : 'active'
              }
              size="small"
            />
            {isccJob.total > 0 && isccJob.status !== 'COMPLETED' && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('stores.exportProcessed', {
                  processed: isccJob.processed,
                  total: isccJob.total,
                })}
              </Typography.Text>
            )}
            {['PENDING', 'PROCESSING'].includes(isccJob.status) && (
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
                {t('stores.exportBackgroundHint')}
              </Typography.Paragraph>
            )}
            {isccJob.status === 'COMPLETED' && (
              <Typography.Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
                {isccJob.fileName}
                {isccJob.fileSize
                  ? ` (${(isccJob.fileSize / 1024 / 1024).toFixed(1)} MB)`
                  : ''}
              </Typography.Paragraph>
            )}
            {isccJob.status === 'FAILED' && (
              <Typography.Paragraph type="danger" style={{ marginTop: 12, marginBottom: 0 }}>
                {isccJob.errorMessage || t('common.error')}
              </Typography.Paragraph>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
