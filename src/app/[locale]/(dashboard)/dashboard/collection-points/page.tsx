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
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  EnvironmentOutlined,
  AimOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { Title } = Typography;

interface CollectionPoint {
  id: string;
  code: string;
  name: string;
  companyName: string | null;
  address: string;
  province: string | null;
  city: string | null;
  district: string | null;
  postcode: string | null;
  longitude: number | null;
  latitude: number | null;
  certScope: string | null;
  contactName: string | null;
  contactPhone: string | null;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  _count: {
    stores: number;
    vehicles: number;
  };
}

export default function CollectionPointsPage() {
  const t = useTranslations();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CollectionPoint[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<CollectionPoint | null>(null);
  const [form] = Form.useForm();
  
  // 重置坐标相关状态
  const [resettingGeocode, setResettingGeocode] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        search,
        status: statusFilter,
      });

      const response = await fetch(`/api/collection-points?${params}`);
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
  }, [page, pageSize, search, statusFilter, t, message]);

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
    setPage(1);
  };

  const handleAdd = () => {
    setEditingItem(null);
    form.resetFields();
    form.setFieldsValue({ status: 'ACTIVE' });
    setModalVisible(true);
  };

  const handleEdit = (item: CollectionPoint) => {
    setEditingItem(item);
    form.setFieldsValue({
      code: item.code,
      name: item.name,
      companyName: item.companyName,
      address: item.address,
      province: item.province,
      city: item.city,
      district: item.district,
      postcode: item.postcode,
      longitude: item.longitude,
      latitude: item.latitude,
      certScope: item.certScope,
      contactName: item.contactName,
      contactPhone: item.contactPhone,
      status: item.status,
    });
    setModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/collection-points/${id}`, {
        method: 'DELETE',
      });
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
      const url = isEditing
        ? `/api/collection-points/${editingItem.id}`
        : '/api/collection-points';
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

      // 调用地理编码 API
      const geocodeResponse = await fetch('/api/collection-points/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionPoints: [{ id: editingItem.id, address: fullAddress }],
        }),
      });

      const geocodeResult = await geocodeResponse.json();

      if (!geocodeResponse.ok) {
        message.error(geocodeResult.message || t('collectionPoints.resetGeocodeFailed'));
        return;
      }

      const cpResult = geocodeResult.results?.[0];
      if (!cpResult?.success) {
        message.error(cpResult?.error || t('collectionPoints.resetGeocodeFailed'));
        return;
      }

      // 更新 editingItem 显示新的坐标
      setEditingItem({
        ...editingItem,
        longitude: cpResult.longitude,
        latitude: cpResult.latitude,
      });

      message.success(t('collectionPoints.resetGeocodeSuccess'));
      
      // 刷新列表数据
      fetchData();
    } catch {
      message.error(t('collectionPoints.resetGeocodeFailed'));
    } finally {
      setResettingGeocode(false);
    }
  };

  const columns: ColumnsType<CollectionPoint> = [
    {
      title: t('collectionPoints.code'),
      dataIndex: 'code',
      key: 'code',
      width: 120,
    },
    {
      title: t('collectionPoints.name'),
      dataIndex: 'name',
      key: 'name',
      width: 150,
    },
    {
      title: t('collectionPoints.address'),
      dataIndex: 'address',
      key: 'address',
      width: 250,
      ellipsis: true,
    },
    {
      title: t('collectionPoints.contactName'),
      dataIndex: 'contactName',
      key: 'contactName',
      width: 100,
      render: (v) => v || '-',
    },
    {
      title: t('collectionPoints.contactPhone'),
      dataIndex: 'contactPhone',
      key: 'contactPhone',
      width: 130,
      render: (v) => v || '-',
    },
    {
      title: t('collectionPoints.storeCount'),
      dataIndex: ['_count', 'stores'],
      key: 'storeCount',
      width: 100,
      align: 'center',
    },
    {
      title: t('collectionPoints.vehicleCount'),
      dataIndex: ['_count', 'vehicles'],
      key: 'vehicleCount',
      width: 100,
      align: 'center',
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
            title={t('collectionPoints.deleteConfirm', { name: record.name })}
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
        <EnvironmentOutlined style={{ marginRight: 8 }} />
        {t('collectionPoints.title')}
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
          <Button icon={<ReloadOutlined />} onClick={handleReset}>
            {t('common.reset')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            {t('collectionPoints.addCollectionPoint')}
          </Button>
        </Space>

        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1400 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (total) => t('common.total', { count: total }),
            onChange: (page, pageSize) => {
              setPage(page);
              setPageSize(pageSize);
            },
          }}
        />
      </Card>

      <Modal
        title={
          editingItem
            ? t('collectionPoints.editCollectionPoint')
            : t('collectionPoints.addCollectionPoint')
        }
        open={modalVisible}
        onOk={handleModalOk}
        onCancel={() => setModalVisible(false)}
        width={700}
        destroyOnHidden
        forceRender
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="code"
                label={t('collectionPoints.code')}
                rules={[
                  {
                    required: true,
                    message: t('validation.required', {
                      field: t('collectionPoints.code'),
                    }),
                  },
                ]}
              >
                <Input disabled={!!editingItem} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="name"
                label={t('collectionPoints.name')}
                rules={[
                  {
                    required: true,
                    message: t('validation.required', {
                      field: t('collectionPoints.name'),
                    }),
                  },
                ]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="companyName"
                label={t('collectionPoints.companyName')}
                tooltip={t('collectionPoints.companyNameTooltip')}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="address"
            label={t('collectionPoints.address')}
            rules={[
              {
                required: true,
                message: t('validation.required', {
                  field: t('collectionPoints.address'),
                }),
              },
            ]}
          >
            <Input />
          </Form.Item>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="province" label={t('collectionPoints.province')}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="city" label={t('collectionPoints.city')}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="district" label={t('collectionPoints.district')}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="postcode" label={t('collectionPoints.postcode')}>
                <Input placeholder="e.g. 100000" />
              </Form.Item>
            </Col>
          </Row>
          {editingItem ? (
            <Descriptions
              bordered
              size="small"
              column={2}
              style={{ marginBottom: 24 }}
            >
              <Descriptions.Item label={t('collectionPoints.coordinates')} span={2}>
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
                    title={t('collectionPoints.resetGeocodeConfirm')}
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
                      {resettingGeocode ? t('collectionPoints.resettingGeocode') : t('collectionPoints.resetGeocode')}
                    </Button>
                  </Popconfirm>
                </Space>
              </Descriptions.Item>
            </Descriptions>
          ) : (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="longitude" label={t('collectionPoints.longitude')}>
                  <Input type="number" step="0.000001" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="latitude" label={t('collectionPoints.latitude')}>
                  <Input type="number" step="0.000001" />
                </Form.Item>
              </Col>
            </Row>
          )}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="contactName"
                label={t('collectionPoints.contactName')}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="contactPhone"
                label={t('collectionPoints.contactPhone')}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="certScope" label={t('collectionPoints.certScope')}>
            <Input.TextArea rows={2} />
          </Form.Item>
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
    </div>
  );
}

