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
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  ShopOutlined,
  CarOutlined,
  EnvironmentOutlined,
  DownloadOutlined,
  AimOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { ColumnsType, TableProps } from 'antd/es/table';
import dayjs from 'dayjs';

const { Title } = Typography;

interface Store {
  id: string;
  code: string;
  name: string;
  businessLicense: string | null;
  legalPerson: string | null;
  address: string;
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

interface CollectionPoint {
  id: string;
  code: string;
  name: string;
}

export default function StoresPage() {
  const t = useTranslations();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Store[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [cpFilter, setCpFilter] = useState<string>('');
  const [isVirtualFilter, setIsVirtualFilter] = useState<string>('');
  const [collectionPoints, setCollectionPoints] = useState<CollectionPoint[]>([]);
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

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        search,
        status: statusFilter,
        collectionPointId: cpFilter,
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
  }, [page, pageSize, search, statusFilter, cpFilter, isVirtualFilter, sortField, sortOrder, t, message]);

  useEffect(() => {
    fetchCollectionPoints();
  }, [fetchCollectionPoints]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearch = () => {
    setPage(1);
    fetchData();
  };

  const handleReset = () => {
    setSearch('');
    setStatusFilter('');
    setCpFilter('');
    setIsVirtualFilter('');
    setSortField('');
    setSortOrder('');
    setPage(1);
  };

  const handleAdd = () => {
    setEditingItem(null);
    form.resetFields();
    form.setFieldsValue({ status: 'ACTIVE', isVirtual: false });
    setModalVisible(true);
  };

  const handleEdit = (item: Store) => {
    setEditingItem(item);
    form.setFieldsValue({
      ...item,
      collectionPointId: item.collectionPoint.id,
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

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
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
    try {
      const values = await exportForm.validateFields();
      setExporting(true);

      const params = new URLSearchParams();
      if (values.collectionPointId) {
        params.set('collectionPointId', values.collectionPointId);
      }
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
        a.download = `门店列表_${new Date().toISOString().slice(0, 10)}.xlsx`;
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
    },
    {
      title: t('stores.collectionPoint'),
      dataIndex: ['collectionPoint', 'name'],
      key: 'collectionPoint',
      width: 120,
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
      width: 120,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title={t('stores.deleteConfirm', { name: record.name })}
            onConfirm={() => handleDelete(record.id)}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
            destroyOnHidden
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
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
            placeholder={t('stores.collectionPoint')}
            value={cpFilter || undefined}
            onChange={setCpFilter}
            style={{ width: 160 }}
            allowClear
            options={collectionPoints.map((cp) => ({
              value: cp.id,
              label: cp.name,
            }))}
          />
          <Select
            placeholder={t('stores.isVirtual')}
            value={isVirtualFilter || undefined}
            onChange={setIsVirtualFilter}
            style={{ width: 120 }}
            allowClear
            options={[
              { value: 'true', label: t('common.yes') },
              { value: 'false', label: t('common.no') },
            ]}
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
          <Button icon={<ReloadOutlined />} onClick={handleReset}>
            {t('common.reset')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            {t('stores.addStore')}
          </Button>
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
        </Space>

        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1600 }}
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

      {/* 新增/编辑门店弹窗 */}
      <Modal
        title={editingItem ? t('stores.editStore') : t('stores.addStore')}
        open={modalVisible}
        onOk={handleModalOk}
        onCancel={() => setModalVisible(false)}
        width={700}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
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
            <Col span={12}>
              <Form.Item
                name="collectionPointId"
                label={t('stores.collectionPoint')}
                rules={[
                  {
                    required: true,
                    message: t('validation.required', {
                      field: t('stores.collectionPoint'),
                    }),
                  },
                ]}
              >
                <Select
                  disabled={!!editingItem}
                  options={collectionPoints.map((cp) => ({
                    value: cp.id,
                    label: cp.name,
                  }))}
                />
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
          <Form.Item name="collectionPointId" label={t('stores.collectionPoint')}>
            <Select
              placeholder={t('stores.allCollectionPoints')}
              allowClear
              options={collectionPoints.map((cp) => ({
                value: cp.id,
                label: cp.name,
              }))}
            />
          </Form.Item>
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
    </div>
  );
}
