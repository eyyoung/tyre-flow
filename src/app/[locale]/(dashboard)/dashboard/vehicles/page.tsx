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
  InputNumber,
  App,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  CarOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { Title } = Typography;

interface Vehicle {
  id: string;
  plateNumber: string;
  type: 'COLLECTION' | 'TRANSFER';
  brand: string | null;
  model: string | null;
  tareWeight: number;
  tareWeightVariance: number;
  maxLoad: number;
  driverName: string | null;
  driverPhone: string | null;
  status: 'ACTIVE' | 'DISABLED';
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

export default function VehiclesPage() {
  const t = useTranslations();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Vehicle[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [cpFilter, setCpFilter] = useState<string>('');
  const [collectionPoints, setCollectionPoints] = useState<CollectionPoint[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<Vehicle | null>(null);
  const [form] = Form.useForm();

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
        type: typeFilter,
        collectionPointId: cpFilter,
      });

      const response = await fetch(`/api/vehicles?${params}`);
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
  }, [page, pageSize, search, statusFilter, typeFilter, cpFilter, t]);

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
    setTypeFilter('');
    setCpFilter('');
    setPage(1);
  };

  const handleAdd = () => {
    setEditingItem(null);
    form.resetFields();
    form.setFieldsValue({
      status: 'ACTIVE',
      type: 'COLLECTION',
      tareWeight: 2.5, // 显示吨
      tareWeightVariance: 0.05,
      maxLoad: 4.0, // 显示吨
    });
    setModalVisible(true);
  };

  const handleEdit = (item: Vehicle) => {
    setEditingItem(item);
    form.setFieldsValue({
      ...item,
      collectionPointId: item.collectionPoint.id,
      // 将 kg 转换为吨显示
      tareWeight: item.tareWeight / 1000,
      tareWeightVariance: item.tareWeightVariance / 1000,
      maxLoad: item.maxLoad / 1000,
    });
    setModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/vehicles/${id}`, { method: 'DELETE' });
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
      const url = isEditing ? `/api/vehicles/${editingItem.id}` : '/api/vehicles';
      const method = isEditing ? 'PUT' : 'POST';

      // 将表单中的吨转换为 kg 存储
      const dataToSubmit = {
        ...values,
        tareWeight: values.tareWeight * 1000,
        tareWeightVariance: values.tareWeightVariance * 1000,
        maxLoad: values.maxLoad * 1000,
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

  // 根据车辆类型更新默认值（显示吨）
  const handleTypeChange = (type: string) => {
    if (type === 'COLLECTION') {
      form.setFieldsValue({
        tareWeight: 2.5,
        maxLoad: 4.0,
      });
    } else if (type === 'TRANSFER') {
      form.setFieldsValue({
        tareWeight: 15.0,
        maxLoad: 33.0,
      });
    }
  };

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
      width: 150,
      render: (type) => (
        <Tag color={type === 'COLLECTION' ? 'blue' : 'green'}>
          {type === 'COLLECTION'
            ? t('vehicles.typeCollection')
            : t('vehicles.typeTransfer')}
        </Tag>
      ),
    },
    {
      title: t('vehicles.collectionPoint'),
      dataIndex: ['collectionPoint', 'name'],
      key: 'collectionPoint',
      width: 120,
    },
    {
      title: t('vehicles.brand'),
      dataIndex: 'brand',
      key: 'brand',
      width: 100,
      render: (v) => v || '-',
    },
    {
      title: t('vehicles.tareWeight'),
      dataIndex: 'tareWeight',
      key: 'tareWeight',
      width: 100,
      render: (v) => `${(v / 1000).toFixed(2)} t`,
    },
    {
      title: t('vehicles.maxLoad'),
      dataIndex: 'maxLoad',
      key: 'maxLoad',
      width: 100,
      render: (v) => `${(v / 1000).toFixed(2)} t`,
    },
    {
      title: t('vehicles.driverName'),
      dataIndex: 'driverName',
      key: 'driverName',
      width: 100,
      render: (v) => v || '-',
    },
    {
      title: t('vehicles.driverPhone'),
      dataIndex: 'driverPhone',
      key: 'driverPhone',
      width: 130,
      render: (v) => v || '-',
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
            title={t('vehicles.deleteConfirm', { plateNumber: record.plateNumber })}
            onConfirm={() => handleDelete(record.id)}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
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
        <CarOutlined style={{ marginRight: 8 }} />
        {t('vehicles.title')}
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
            placeholder={t('vehicles.collectionPoint')}
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
            placeholder={t('vehicles.type')}
            value={typeFilter || undefined}
            onChange={setTypeFilter}
            style={{ width: 160 }}
            allowClear
            options={[
              { value: 'COLLECTION', label: t('vehicles.typeCollection') },
              { value: 'TRANSFER', label: t('vehicles.typeTransfer') },
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
            {t('vehicles.addVehicle')}
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
        title={editingItem ? t('vehicles.editVehicle') : t('vehicles.addVehicle')}
        open={modalVisible}
        onOk={handleModalOk}
        onCancel={() => setModalVisible(false)}
        width={700}
        destroyOnHidden
      >
        {modalVisible && (
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="plateNumber"
                label={t('vehicles.plateNumber')}
                rules={[
                  {
                    required: true,
                    message: t('validation.required', {
                      field: t('vehicles.plateNumber'),
                    }),
                  },
                ]}
              >
                <Input disabled={!!editingItem} placeholder="例如：粤A12345" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="collectionPointId"
                label={t('vehicles.collectionPoint')}
                rules={[
                  {
                    required: true,
                    message: t('validation.required', {
                      field: t('vehicles.collectionPoint'),
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
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="type"
                label={t('vehicles.type')}
                rules={[
                  {
                    required: true,
                    message: t('validation.required', { field: t('vehicles.type') }),
                  },
                ]}
              >
                <Select
                  onChange={handleTypeChange}
                  options={[
                    { value: 'COLLECTION', label: t('vehicles.typeCollection') },
                    { value: 'TRANSFER', label: t('vehicles.typeTransfer') },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="brand" label={t('vehicles.brand')}>
                <Input placeholder="例如：五菱、东风" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="tareWeight"
                label={t('vehicles.tareWeight')}
                rules={[
                  {
                    required: true,
                    message: t('validation.required', {
                      field: t('vehicles.tareWeight'),
                    }),
                  },
                ]}
              >
                <InputNumber min={0} step={0.1} addonAfter="t" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="tareWeightVariance"
                label={t('vehicles.tareWeightVariance')}
              >
                <InputNumber min={0} max={1} step={0.01} addonAfter="t" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="maxLoad"
                label={t('vehicles.maxLoad')}
                rules={[
                  {
                    required: true,
                    message: t('validation.required', { field: t('vehicles.maxLoad') }),
                  },
                ]}
              >
                <InputNumber min={0} step={0.5} addonAfter="t" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="driverName" label={t('vehicles.driverName')}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="driverPhone" label={t('vehicles.driverPhone')}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
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
        )}
      </Modal>
    </div>
  );
}

