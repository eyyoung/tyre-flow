'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Select,
  Modal,
  Form,
  InputNumber,
  Typography,
  Popconfirm,
  Descriptions,
  Spin,
  Progress,
  App,
} from 'antd';
import {
  PlusOutlined,
  PlayCircleOutlined,
  DownloadOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SwapOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

interface TransferTask {
  id: string;
  taskNo: string;
  targetTonnage: number;
  actualTonnage: number | null;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  collectionPoint: {
    id: string;
    name: string;
    code: string;
  };
  _count: {
    transferRecords: number;
  };
}

interface CollectionPoint {
  id: string;
  code: string;
  name: string;
}

interface TransferRecord {
  id: string;
  recordNo: string;
  transferDate: string;
  departureTime: string;
  arrivalTime: string;
  tireCount: number;
  grossWeight: number;
  tareWeight: number;
  netWeight: number;
  weighbridgeNo: string | null;
  destination: string;
  vehicle: { plateNumber: string };
}

export default function TransferLedgerPage() {
  const t = useTranslations();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TransferTask[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [cpFilter, setCpFilter] = useState<string>('');
  const [collectionPoints, setCollectionPoints] = useState<CollectionPoint[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TransferTask | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [transferRecords, setTransferRecords] = useState<TransferRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordPage, setRecordPage] = useState(1);
  const [recordPageSize, setRecordPageSize] = useState(20);
  const [form] = Form.useForm();

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
        status: statusFilter,
        collectionPointId: cpFilter,
      });

      const response = await fetch(`/api/transfer-tasks?${params}`);
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
  }, [page, pageSize, statusFilter, cpFilter, t, message]);

  useEffect(() => {
    fetchCollectionPoints();
  }, [fetchCollectionPoints]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const processingTasks = data.filter((t) => t.status === 'PROCESSING');
    if (processingTasks.length > 0) {
      const timer = setInterval(() => {
        fetchData();
      }, 3000);
      return () => clearInterval(timer);
    }
  }, [data, fetchData]);

  const handleAdd = () => {
    form.resetFields();
    form.setFieldsValue({
      targetTonnage: 30,
    });
    setModalVisible(true);
  };

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();

      const response = await fetch('/api/transfer-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      const result = await response.json();

      if (response.ok) {
        message.success(t('common.success'));
        setModalVisible(false);
        fetchData();
      } else {
        message.error(result.error || t('common.error'));
      }
    } catch {
      // 表单验证失败
    }
  };

  const handleGenerate = async (id: string) => {
    try {
      const response = await fetch(`/api/transfer-tasks/${id}/generate`, {
        method: 'POST',
      });

      const result = await response.json();

      if (response.ok) {
        message.success('转移记录生成成功');
        fetchData();
      } else {
        message.error(result.error || t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/transfer-tasks/${id}`, { method: 'DELETE' });
      const result = await response.json();

      if (response.ok) {
        message.success(t('common.success'));
        fetchData();
      } else {
        message.error(result.error || t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    }
  };

  const fetchTransferRecords = useCallback(async (taskId: string, page: number, pageSize: number) => {
    try {
      const response = await fetch(
        `/api/transfer-tasks/${taskId}/records?page=${page}&pageSize=${pageSize}`
      );
      const data = await response.json();
      if (response.ok) {
        setTransferRecords(data.data);
        setRecordsTotal(data.total);
      }
    } catch {
      message.error('获取转移记录失败');
    }
  }, [message]);

  const handleViewDetail = async (task: TransferTask) => {
    setSelectedTask(task);
    setDetailModalVisible(true);
    setDetailLoading(true);
    setRecordPage(1);

    try {
      await fetchTransferRecords(task.id, 1, recordPageSize);
    } catch {
      message.error('获取记录失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRecordPageChange = (newPage: number, newPageSize: number) => {
    setRecordPage(newPage);
    setRecordPageSize(newPageSize);
    if (selectedTask) {
      fetchTransferRecords(selectedTask.id, newPage, newPageSize);
    }
  };

  const getStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      PENDING: { color: 'default', text: t('ledgers.statusPending') },
      PROCESSING: { color: 'processing', text: t('ledgers.statusProcessing') },
      COMPLETED: { color: 'success', text: t('ledgers.statusCompleted') },
      FAILED: { color: 'error', text: t('ledgers.statusFailed') },
    };
    const { color, text } = statusMap[status] || statusMap.PENDING;
    return <Tag color={color}>{text}</Tag>;
  };

  const columns: ColumnsType<TransferTask> = [
    {
      title: t('ledgers.taskNo'),
      dataIndex: 'taskNo',
      key: 'taskNo',
      width: 200,
    },
    {
      title: t('ledgers.collectionPoint'),
      dataIndex: ['collectionPoint', 'name'],
      key: 'collectionPoint',
      width: 120,
    },
    {
      title: t('ledgers.targetTonnage'),
      dataIndex: 'targetTonnage',
      key: 'targetTonnage',
      width: 120,
      render: (v) => `${v} t`,
    },
    {
      title: t('ledgers.actualTonnage'),
      dataIndex: 'actualTonnage',
      key: 'actualTonnage',
      width: 120,
      render: (v) => (v !== null ? `${v} t` : '-'),
    },
    {
      title: t('ledgers.status'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => getStatusTag(status),
    },
    {
      title: t('ledgers.transferRecords'),
      dataIndex: ['_count', 'transferRecords'],
      key: 'transferRecords',
      width: 100,
      align: 'center',
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
      width: 200,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small" wrap>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record)}
            disabled={record.status !== 'COMPLETED'}
          >
            {t('common.view')}
          </Button>
          <Button
            type="link"
            size="small"
            icon={<PlayCircleOutlined />}
            onClick={() => handleGenerate(record.id)}
            disabled={record.status === 'PROCESSING'}
          >
            {t('ledgers.generateTransfer')}
          </Button>
          <Popconfirm
            title="确定要删除此任务吗？"
            onConfirm={() => handleDelete(record.id)}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={record.status === 'PROCESSING'}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const transferColumns: ColumnsType<TransferRecord> = [
    { title: t('ledgers.recordNo'), dataIndex: 'recordNo', key: 'recordNo', width: 200, ellipsis: true },
    {
      title: t('ledgers.transferDate'),
      dataIndex: 'transferDate',
      key: 'transferDate',
      width: 120,
      render: (v) => dayjs(v).format('YYYY-MM-DD'),
    },
    {
      title: t('ledgers.departureTime'),
      dataIndex: 'departureTime',
      key: 'departureTime',
      width: 90,
      render: (v) => dayjs(v).format('HH:mm'),
    },
    {
      title: t('ledgers.arrivalTime'),
      dataIndex: 'arrivalTime',
      key: 'arrivalTime',
      width: 90,
      render: (v) => dayjs(v).format('HH:mm'),
    },
    { title: t('vehicles.plateNumber'), dataIndex: ['vehicle', 'plateNumber'], key: 'vehicle', width: 110 },
    { title: t('ledgers.destination'), dataIndex: 'destination', key: 'destination', width: 160, ellipsis: true },
    { title: t('ledgers.tireCount'), dataIndex: 'tireCount', key: 'tireCount', width: 100, align: 'right' },
    {
      title: t('ledgers.grossWeight'),
      dataIndex: 'grossWeight',
      key: 'grossWeight',
      width: 110,
      align: 'right',
      render: (v) => v.toFixed(3),
    },
    {
      title: t('ledgers.tareWeight'),
      dataIndex: 'tareWeight',
      key: 'tareWeight',
      width: 110,
      align: 'right',
      render: (v) => v.toFixed(3),
    },
    {
      title: t('ledgers.netWeight'),
      dataIndex: 'netWeight',
      key: 'netWeight',
      width: 110,
      align: 'right',
      render: (v) => v.toFixed(3),
    },
    { title: t('ledgers.weighbridgeNo'), dataIndex: 'weighbridgeNo', key: 'weighbridgeNo', width: 160, ellipsis: true },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        <SwapOutlined style={{ marginRight: 8 }} />
        {t('ledgers.transferTitle')}
      </Title>

      <Card variant="borderless">
        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            placeholder={t('ledgers.collectionPoint')}
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
            placeholder={t('ledgers.status')}
            value={statusFilter || undefined}
            onChange={setStatusFilter}
            style={{ width: 120 }}
            allowClear
            options={[
              { value: 'PENDING', label: t('ledgers.statusPending') },
              { value: 'PROCESSING', label: t('ledgers.statusProcessing') },
              { value: 'COMPLETED', label: t('ledgers.statusCompleted') },
              { value: 'FAILED', label: t('ledgers.statusFailed') },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => fetchData()}>
            {t('common.refresh')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            {t('ledgers.createTransferTask')}
          </Button>
        </Space>

        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1000 }}
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
        title={t('ledgers.createTransferTask')}
        open={modalVisible}
        onOk={handleCreate}
        onCancel={() => setModalVisible(false)}
        destroyOnHidden
        forceRender
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="collectionPointId"
            label={t('ledgers.collectionPoint')}
            rules={[{ required: true }]}
          >
            <Select
              options={collectionPoints.map((cp) => ({
                value: cp.id,
                label: cp.name,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="targetTonnage"
            label={t('ledgers.targetTonnage')}
            rules={[{ required: true }]}
            extra={<Text type="secondary">{t('ledgers.transferTonnageHint')}</Text>}
          >
            <Space.Compact>
              <InputNumber min={1} max={1000} style={{ width: 160 }} />
              <Button disabled style={{ pointerEvents: 'none' }}>吨</Button>
            </Space.Compact>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('ledgers.transferTitle')}
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width={1200}
        destroyOnHidden
        centered
      >
        {selectedTask && (
          <Spin spinning={detailLoading}>
            <Descriptions bordered size="small" column={4} style={{ marginBottom: 16 }}>
              <Descriptions.Item label={t('ledgers.taskNo')}>{selectedTask.taskNo}</Descriptions.Item>
              <Descriptions.Item label={t('ledgers.collectionPoint')}>
                {selectedTask.collectionPoint.name}
              </Descriptions.Item>
              <Descriptions.Item label={t('ledgers.status')}>{getStatusTag(selectedTask.status)}</Descriptions.Item>
              <Descriptions.Item label="完成时间">
                {selectedTask.completedAt
                  ? dayjs(selectedTask.completedAt).format('YYYY-MM-DD HH:mm')
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('ledgers.targetTonnage')}>{selectedTask.targetTonnage} t</Descriptions.Item>
              <Descriptions.Item label={t('ledgers.actualTonnage')}>
                {selectedTask.actualTonnage !== null ? `${selectedTask.actualTonnage} t` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="完成度" span={2}>
                {selectedTask.actualTonnage !== null && (
                  <Progress
                    percent={Math.min(
                      100,
                      Math.round((selectedTask.actualTonnage / selectedTask.targetTonnage) * 100)
                    )}
                    size="small"
                    style={{ width: 200 }}
                  />
                )}
              </Descriptions.Item>
            </Descriptions>

            <Table
              columns={transferColumns}
              dataSource={transferRecords}
              rowKey="id"
              size="small"
              scroll={{ x: 1200, y: 'calc(100vh - 450px)' }}
              pagination={{
                current: recordPage,
                pageSize: recordPageSize,
                total: recordsTotal,
                showSizeChanger: true,
                showTotal: (total) => t('common.total', { count: total }),
                pageSizeOptions: ['10', '20', '50', '100'],
                onChange: handleRecordPageChange,
              }}
            />
          </Spin>
        )}
      </Modal>
    </div>
  );
}

