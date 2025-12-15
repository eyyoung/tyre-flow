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
  DatePicker,
  Result,
  Row,
  Col,
  Statistic,
} from 'antd';
import {
  PlusOutlined,
  PlayCircleOutlined,
  DownloadOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SwapOutlined,
  EyeOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useCollectionPoint } from '@/contexts/CollectionPointContext';
import { useAuth } from '@/contexts/AuthContext';
import { TRANSFER_TASK } from '@/lib/permissions';

const { Title } = Typography;
const { RangePicker } = DatePicker;

interface TransferTask {
  id: string;
  taskNo: string;
  startDate: string;
  endDate: string;
  targetTonnage: number;
  actualTonnage: number | null;
  unloadingTonnage: number | null;
  totalLoss: number | null;
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
  tireCount: number;
  loadingNetWeight: number;
  grossWeight: number;
  tareWeight: number;
  unloadingNetWeight: number;
  loss: number;
  weighbridgeNo: string | null;
  vehicle: { plateNumber: string };
}

interface GenerationSummary {
  totalRecords: number;
  totalLoadingWeight: number;
  totalUnloadingWeight: number;
  totalLoss: number;
  vehiclesCount: number;
}

export default function TransferLedgerPage() {
  const t = useTranslations();
  const { message } = App.useApp();
  const { currentCollectionPoint, collectionPoints } = useCollectionPoint();
  const { can } = useAuth();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TransferTask[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [modalVisible, setModalVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [successModalVisible, setSuccessModalVisible] = useState(false);
  const [generationSummary, setGenerationSummary] = useState<GenerationSummary | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TransferTask | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [transferRecords, setTransferRecords] = useState<TransferRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordPage, setRecordPage] = useState(1);
  const [recordPageSize, setRecordPageSize] = useState(20);
  const [form] = Form.useForm();

  // 格式化数字，添加千分位
  const formatNumber = (num: number, precision = 2) => {
    return num.toLocaleString('zh-CN', { minimumFractionDigits: precision, maximumFractionDigits: precision });
  };

  const fetchData = useCallback(async () => {
    if (!currentCollectionPoint) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        status: statusFilter,
        collectionPointId: currentCollectionPoint.id,
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
  }, [page, pageSize, statusFilter, currentCollectionPoint, t, message]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 当收集点变化时，重置页码
  useEffect(() => {
    setPage(1);
  }, [currentCollectionPoint]);

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
    setModalVisible(true);
  };

  // Modal 打开动画完成后设置默认值
  const handleModalAfterOpenChange = (open: boolean) => {
    if (open) {
      form.setFieldsValue({
        dateRange: [dayjs().startOf('month'), dayjs().endOf('month')],
        targetTonnage: 30, // 默认目标重量 30 吨
      });
    }
  };

  const handleCreate = async () => {
    if (!currentCollectionPoint) {
      message.warning(t('ledgers.selectCollectionPointRequired'));
      return;
    }
    
    try {
      const values = await form.validateFields();
      const [startDate, endDate] = values.dateRange;

      setCreating(true);

      const response = await fetch('/api/transfer-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionPointId: currentCollectionPoint.id,
          startDate: startDate.format('YYYY-MM-DD'),
          endDate: endDate.format('YYYY-MM-DD'),
          targetTonnage: values.targetTonnage * 1000, // 吨转换为 kg
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setModalVisible(false);
        setGenerationSummary(result.summary);
        setSuccessModalVisible(true);
        fetchData();
      } else {
        message.error(result.error || t('common.error'));
      }
    } catch {
      // 表单验证失败
    } finally {
      setCreating(false);
    }
  };

  const handleGenerate = async (id: string) => {
    try {
      const response = await fetch(`/api/transfer-tasks/${id}/generate`, {
        method: 'POST',
      });

      const result = await response.json();

      if (response.ok) {
        setGenerationSummary(result.summary);
        setSuccessModalVisible(true);
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

  const handleExport = async (id: string) => {
    try {
      const response = await fetch(`/api/transfer-tasks/${id}/export`);

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        // 从响应头获取文件名
        const contentDisposition = response.headers.get('Content-Disposition');
        let fileName = `转移台账_${new Date().toISOString().slice(0, 10)}.xlsx`;
        if (contentDisposition) {
          const match = contentDisposition.match(/filename\*=UTF-8''(.+)/);
          if (match) {
            fileName = decodeURIComponent(match[1]);
          }
        }
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        message.error('导出失败');
      }
    } catch {
      message.error('导出失败');
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

  const formatDateRange = (startDate: string, endDate: string) => {
    return `${dayjs(startDate).format('YYYY-MM-DD')} ~ ${dayjs(endDate).format('YYYY-MM-DD')}`;
  };

  const columns: ColumnsType<TransferTask> = [
    {
      title: t('ledgers.taskNo'),
      dataIndex: 'taskNo',
      key: 'taskNo',
      width: 260,
      ellipsis: true,
    },
    {
      title: t('ledgers.dateRange'),
      key: 'dateRange',
      width: 200,
      render: (_, record) => formatDateRange(record.startDate, record.endDate),
    },
    {
      title: `${t('ledgers.targetWeight')}(t)`,
      dataIndex: 'targetTonnage',
      key: 'targetTonnage',
      width: 130,
      render: (v) => formatNumber(v / 1000),
    },
    {
      title: `${t('ledgers.loadingNetWeight')}(t)`,
      dataIndex: 'actualTonnage',
      key: 'actualTonnage',
      width: 130,
      render: (v) => (v !== null ? formatNumber(v / 1000) : '-'),
    },
    {
      title: `${t('ledgers.unloadingNetWeight')}(t)`,
      dataIndex: 'unloadingTonnage',
      key: 'unloadingTonnage',
      width: 140,
      render: (v) => (v !== null ? formatNumber(v / 1000) : '-'),
    },
    {
      title: `${t('ledgers.loss')}(t)`,
      dataIndex: 'totalLoss',
      key: 'totalLoss',
      width: 100,
      render: (v) => (v !== null ? formatNumber(v / 1000, 3) : '-'),
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
      width: 280,
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
          {can(TRANSFER_TASK.CREATE) && (
            <Button
              type="link"
              size="small"
              icon={<PlayCircleOutlined />}
              onClick={() => handleGenerate(record.id)}
              disabled={record.status === 'PROCESSING'}
            >
              {t('ledgers.generateTransfer')}
            </Button>
          )}
          <Button
            type="link"
            size="small"
            icon={<DownloadOutlined />}
            onClick={() => handleExport(record.id)}
            disabled={record.status !== 'COMPLETED'}
          >
            {t('ledgers.exportExcel')}
          </Button>
          {can(TRANSFER_TASK.DELETE) && (
            <Popconfirm
              title="确定要删除此任务吗？"
              onConfirm={() => handleDelete(record.id)}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
              destroyOnHidden
            >
              <Button
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={record.status === 'PROCESSING'}
              />
            </Popconfirm>
          )}
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
    { title: t('vehicles.plateNumber'), dataIndex: ['vehicle', 'plateNumber'], key: 'vehicle', width: 110 },
    { title: t('ledgers.tireCount'), dataIndex: 'tireCount', key: 'tireCount', width: 100, align: 'right', render: (v) => v.toLocaleString() },
    {
      title: `${t('ledgers.loadingNetWeight')}(kg)`,
      dataIndex: 'loadingNetWeight',
      key: 'loadingNetWeight',
      width: 140,
      align: 'right',
      render: (v) => Math.round(v).toLocaleString(),
    },
    {
      title: `${t('ledgers.grossWeight')}(kg)`,
      dataIndex: 'grossWeight',
      key: 'grossWeight',
      width: 130,
      align: 'right',
      render: (v) => Math.round(v).toLocaleString(),
    },
    {
      title: `${t('ledgers.tareWeight')}(kg)`,
      dataIndex: 'tareWeight',
      key: 'tareWeight',
      width: 120,
      align: 'right',
      render: (v) => Math.round(v).toLocaleString(),
    },
    {
      title: `${t('ledgers.unloadingNetWeight')}(kg)`,
      dataIndex: 'unloadingNetWeight',
      key: 'unloadingNetWeight',
      width: 140,
      align: 'right',
      render: (v) => Math.round(v).toLocaleString(),
    },
    {
      title: `${t('ledgers.loss')}(kg)`,
      dataIndex: 'loss',
      key: 'loss',
      width: 100,
      align: 'right',
      render: (v) => formatNumber(v, 2),
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
          {can(TRANSFER_TASK.CREATE) && (
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
              {t('ledgers.createTransferTask')}
            </Button>
          )}
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
        title={t('ledgers.createTransferTask')}
        open={modalVisible}
        onOk={handleCreate}
        onCancel={() => setModalVisible(false)}
        confirmLoading={creating}
        destroyOnHidden
        afterOpenChange={handleModalAfterOpenChange}
        okText={creating ? '生成中...' : t('common.confirm')}
      >
        {modalVisible && (
          <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item
              name="dateRange"
              label={t('ledgers.dateRange')}
              rules={[{ required: true, message: '请选择时间范围' }]}
            >
              <RangePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="targetTonnage"
              label={t('ledgers.targetWeight')}
              rules={[{ required: true }]}
            >
              <Space.Compact>
                <InputNumber min={0.1} max={999999} step={0.1} style={{ width: 160 }} />
                <Button disabled style={{ pointerEvents: 'none' }}>t (吨)</Button>
              </Space.Compact>
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title={
          <Space>
            <CheckCircleOutlined style={{ color: '#52c41a' }} />
            {t('ledgers.generateSuccess')}
          </Space>
        }
        open={successModalVisible}
        onOk={() => setSuccessModalVisible(false)}
        onCancel={() => setSuccessModalVisible(false)}
        footer={[
          <Button key="ok" type="primary" onClick={() => setSuccessModalVisible(false)}>
            {t('common.confirm')}
          </Button>,
        ]}
        width={600}
      >
        {generationSummary && (
          <Result
            status="success"
            title={t('ledgers.generateSuccess')}
            subTitle={t('ledgers.generateSummary')}
            extra={
              <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
                <Col span={12}>
                  <Statistic title={t('ledgers.totalRecords')} value={generationSummary.totalRecords} suffix="条" />
                </Col>
                <Col span={12}>
                  <Statistic title={t('ledgers.vehiclesCount')} value={generationSummary.vehiclesCount} suffix="辆" />
                </Col>
                <Col span={8}>
                  <Statistic
                    title={t('ledgers.totalLoadingWeight')}
                    value={generationSummary.totalLoadingWeight / 1000}
                    precision={2}
                    suffix="t"
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title={t('ledgers.totalUnloadingWeight')}
                    value={generationSummary.totalUnloadingWeight / 1000}
                    precision={2}
                    suffix="t"
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title={t('ledgers.totalLoss')}
                    value={generationSummary.totalLoss / 1000}
                    precision={3}
                    suffix="t"
                    valueStyle={{ color: '#ff4d4f' }}
                  />
                </Col>
              </Row>
            }
          />
        )}
      </Modal>

      <Modal
        title={t('ledgers.transferTitle')}
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width={1500}
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
              <Descriptions.Item label={t('ledgers.dateRange')}>
                {formatDateRange(selectedTask.startDate, selectedTask.endDate)}
              </Descriptions.Item>
              <Descriptions.Item label={t('ledgers.status')}>{getStatusTag(selectedTask.status)}</Descriptions.Item>
              <Descriptions.Item label={`${t('ledgers.targetWeight')}(t)`}>{formatNumber(selectedTask.targetTonnage / 1000)}</Descriptions.Item>
              <Descriptions.Item label={`${t('ledgers.loadingNetWeight')}(t)`}>
                {selectedTask.actualTonnage !== null ? formatNumber(selectedTask.actualTonnage / 1000) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label={`${t('ledgers.unloadingNetWeight')}(t)`}>
                {selectedTask.unloadingTonnage !== null ? formatNumber(selectedTask.unloadingTonnage / 1000) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label={`${t('ledgers.loss')}(t)`}>
                {selectedTask.totalLoss !== null ? formatNumber(selectedTask.totalLoss / 1000, 3) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="完成度">
                {selectedTask.actualTonnage !== null && (
                  <Progress
                    percent={Math.min(
                      100,
                      Math.round((selectedTask.actualTonnage / selectedTask.targetTonnage) * 100)
                    )}
                    size="small"
                    style={{ width: 100 }}
                  />
                )}
              </Descriptions.Item>
              <Descriptions.Item label="完成时间">
                {selectedTask.completedAt
                  ? dayjs(selectedTask.completedAt).format('YYYY-MM-DD HH:mm')
                  : '-'}
              </Descriptions.Item>
            </Descriptions>

            <Table
              columns={transferColumns}
              dataSource={transferRecords}
              rowKey="id"
              size="small"
              scroll={{ x: 1600, y: 'calc(100vh - 450px)' }}
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

            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={() => handleExport(selectedTask.id)}
              >
                {t('ledgers.exportExcel')}
              </Button>
            </div>
          </Spin>
        )}
      </Modal>
    </div>
  );
}
