"use client";

import React, { useState, useEffect, useCallback } from "react";
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
  Statistic,
  Row,
  Col,
  Alert,
  Tooltip,
} from "antd";
import {
  PlusOutlined,
  PlayCircleOutlined,
  DownloadOutlined,
  DeleteOutlined,
  ReloadOutlined,
  FileTextOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
import { useTranslations } from "next-intl";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useCollectionPoint } from "@/contexts/CollectionPointContext";

const { Title } = Typography;
const { RangePicker } = DatePicker;

interface LedgerTask {
  id: string;
  taskNo: string;
  startDate: string;
  endDate: string;
  year?: number;
  month?: number;
  targetTonnage: number;
  actualTonnage: number | null;
  unloadingTonnage: number | null;
  totalLoss: number | null;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
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
    collectionRecords: number;
  };
}

interface CollectionPoint {
  id: string;
  code: string;
  name: string;
}

interface CollectionRecord {
  id: string;
  recordNo: string;
  collectionDate: string;
  loadingTime: string;
  unloadingTime: string;
  tireCount: number;
  loadingNetWeight: number;
  unloadingNetWeight: number;
  loss: number;
  store: { code: string; name: string; address: string };
  vehicle: { plateNumber: string };
}

interface GenerationSummary {
  totalRecords: number;
  totalLoadingWeight: number;
  totalUnloadingWeight: number;
  totalLoss: number;
  storesCount: number;
  vehiclesCount: number;
}

interface TonnageEstimate {
  minTonnage: number;
  maxTonnage: number;
  storeCount: number;
  vehicleCount: number;
  totalDays: number;
  avgTravelMinutes: number;
  tripsPerVehiclePerDay: number;
  avgWeightPerTrip?: number;
  warning?: string;
  details?: {
    maxVehicleLoadKg: number;
    vehicleMaxCapacityKg: number;
  };
}

export default function CollectionLedgerPage() {
  const t = useTranslations();
  const { message } = App.useApp();
  const { currentCollectionPoint } = useCollectionPoint();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LedgerTask[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [modalVisible, setModalVisible] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedTask, setSelectedTask] = useState<LedgerTask | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [collectionRecords, setCollectionRecords] = useState<
    CollectionRecord[]
  >([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordPage, setRecordPage] = useState(1);
  const [recordPageSize, setRecordPageSize] = useState(20);
  const [form] = Form.useForm();
  const [creating, setCreating] = useState(false);
  const [successModalVisible, setSuccessModalVisible] = useState(false);
  const [generationSummary, setGenerationSummary] =
    useState<GenerationSummary | null>(null);
  const [tonnageEstimate, setTonnageEstimate] =
    useState<TonnageEstimate | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);

  // 获取建议吨数区间
  const fetchTonnageEstimate = useCallback(
    async (dateRange: [dayjs.Dayjs, dayjs.Dayjs]) => {
      if (!currentCollectionPoint || !dateRange || dateRange.length !== 2) {
        setTonnageEstimate(null);
        return;
      }

      setEstimateLoading(true);
      try {
        const params = new URLSearchParams({
          collectionPointId: currentCollectionPoint.id,
          startDate: dateRange[0].format("YYYY-MM-DD"),
          endDate: dateRange[1].format("YYYY-MM-DD"),
        });

        const response = await fetch(`/api/ledgers/estimate?${params}`);
        const result = await response.json();

        if (response.ok) {
          setTonnageEstimate(result.data);
        } else {
          setTonnageEstimate(null);
        }
      } catch {
        setTonnageEstimate(null);
      } finally {
        setEstimateLoading(false);
      }
    },
    [currentCollectionPoint]
  );

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

      const response = await fetch(`/api/ledgers?${params}`);
      const result = await response.json();

      if (response.ok) {
        setData(result.data);
        setTotal(result.total);
      } else {
        message.error(result.message || t("common.error"));
      }
    } catch {
      message.error(t("common.error"));
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
    const processingTasks = data.filter((t) => t.status === "PROCESSING");
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

  // 格式化数字，添加千分位
  const formatNumber = (num: number, precision = 2) => {
    return num.toLocaleString("zh-CN", {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  };

  // Modal 打开动画完成后设置默认值
  const handleModalAfterOpenChange = (open: boolean) => {
    if (open) {
      // 使用独立的 dayjs 实例避免循环引用警告
      const defaultDateRange: [dayjs.Dayjs, dayjs.Dayjs] = [
        dayjs().startOf("month"),
        dayjs().endOf("month"),
      ];
      form.setFieldsValue({
        dateRange: defaultDateRange,
        targetTonnage: 10, // 默认目标重量 10 吨
      });
      // 使用当前收集点获取建议吨数
      if (currentCollectionPoint) {
        fetchTonnageEstimate(defaultDateRange);
      }
    } else {
      // 关闭时重置建议值
      setTonnageEstimate(null);
    }
  };

  const handleCreate = async () => {
    if (!currentCollectionPoint) {
      message.warning(t("ledgers.selectCollectionPointRequired"));
      return;
    }
    
    try {
      const values = await form.validateFields();
      const [startDate, endDate] = values.dateRange;

      setCreating(true);

      const response = await fetch("/api/ledgers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionPointId: currentCollectionPoint.id,
          startDate: startDate.format("YYYY-MM-DD"),
          endDate: endDate.format("YYYY-MM-DD"),
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
        message.error(result.message || t("common.error"));
      }
    } catch {
      // 表单验证失败
    } finally {
      setCreating(false);
    }
  };

  const handleGenerate = async (id: string) => {
    try {
      const response = await fetch(`/api/ledgers/${id}/generate`, {
        method: "POST",
      });

      const result = await response.json();

      if (response.ok) {
        message.success("台账生成任务已开始执行");
        fetchData();
      } else {
        message.error(result.message || t("common.error"));
      }
    } catch {
      message.error(t("common.error"));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/ledgers/${id}`, { method: "DELETE" });
      const result = await response.json();

      if (response.ok) {
        message.success(t("common.success"));
        fetchData();
      } else {
        message.error(result.message || t("common.error"));
      }
    } catch {
      message.error(t("common.error"));
    }
  };

  const handleExport = async (task: LedgerTask) => {
    const response = await fetch(
      `/api/ledgers/${task.id}/export?type=collection`
    );

    if (response.ok) {
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const filename = `${task.collectionPoint.name}_${formatDateRange(
        task.startDate,
        task.endDate
      ).replace(" ~ ", "-")}_收集台账.xlsx`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }
  };

  const fetchCollectionRecords = useCallback(
    async (taskId: string, page: number, pageSize: number) => {
      try {
        const response = await fetch(
          `/api/ledgers/${taskId}/records?type=collection&page=${page}&pageSize=${pageSize}`
        );
        const data = await response.json();
        if (response.ok) {
          setCollectionRecords(data.data);
          setRecordsTotal(data.total);
        }
      } catch {
        message.error("获取收集记录失败");
      }
    },
    [message]
  );

  const handleViewDetail = async (task: LedgerTask) => {
    setSelectedTask(task);
    setDetailModalVisible(true);
    setDetailLoading(true);
    setRecordPage(1);

    try {
      await fetchCollectionRecords(task.id, 1, recordPageSize);
    } catch {
      message.error("获取记录失败");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRecordPageChange = (newPage: number, newPageSize: number) => {
    setRecordPage(newPage);
    setRecordPageSize(newPageSize);
    if (selectedTask) {
      fetchCollectionRecords(selectedTask.id, newPage, newPageSize);
    }
  };

  const getStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      PENDING: { color: "default", text: t("ledgers.statusPending") },
      PROCESSING: { color: "processing", text: t("ledgers.statusProcessing") },
      COMPLETED: { color: "success", text: t("ledgers.statusCompleted") },
      FAILED: { color: "error", text: t("ledgers.statusFailed") },
    };
    const { color, text } = statusMap[status] || statusMap.PENDING;
    return <Tag color={color}>{text}</Tag>;
  };

  const formatDateRange = (startDate: string, endDate: string) => {
    return `${dayjs(startDate).format("YYYY-MM-DD")} ~ ${dayjs(endDate).format(
      "YYYY-MM-DD"
    )}`;
  };

  const columns: ColumnsType<LedgerTask> = [
    {
      title: t("ledgers.taskNo"),
      dataIndex: "taskNo",
      key: "taskNo",
      width: 260,
      ellipsis: true,
    },
    {
      title: t("ledgers.dateRange"),
      key: "dateRange",
      width: 200,
      render: (_, record) => formatDateRange(record.startDate, record.endDate),
    },
    {
      title: `${t("ledgers.targetWeight")}(t)`,
      dataIndex: "targetTonnage",
      key: "targetTonnage",
      width: 130,
      render: (v) => formatNumber(v / 1000),
    },
    {
      title: `${t("ledgers.loadingNetWeight")}(t)`,
      dataIndex: "actualTonnage",
      key: "actualTonnage",
      width: 130,
      render: (v) => (v !== null ? formatNumber(v / 1000) : "-"),
    },
    {
      title: `${t("ledgers.unloadingNetWeight")}(t)`,
      dataIndex: "unloadingTonnage",
      key: "unloadingTonnage",
      width: 140,
      render: (v) => (v !== null ? formatNumber(v / 1000) : "-"),
    },
    {
      title: `${t("ledgers.loss")}(t)`,
      dataIndex: "totalLoss",
      key: "totalLoss",
      width: 100,
      render: (v) => (v !== null ? formatNumber(v / 1000, 3) : "-"),
    },
    {
      title: t("ledgers.status"),
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status) => getStatusTag(status),
    },
    {
      title: t("ledgers.collectionRecords"),
      dataIndex: ["_count", "collectionRecords"],
      key: "collectionRecords",
      width: 100,
      align: "center",
    },
    {
      title: t("common.createdAt"),
      dataIndex: "createdAt",
      key: "createdAt",
      width: 160,
      render: (date) => dayjs(date).format("YYYY-MM-DD HH:mm"),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 200,
      fixed: "right",
      render: (_, record) => (
        <Space size="small" wrap>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record)}
            disabled={record.status !== "COMPLETED"}
          >
            {t("common.view")}
          </Button>
          <Popconfirm
            title="确定要删除此任务吗？"
            onConfirm={() => handleDelete(record.id)}
            okText={t("common.confirm")}
            cancelText={t("common.cancel")}
            destroyOnHidden
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={record.status === "PROCESSING"}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const collectionColumns: ColumnsType<CollectionRecord> = [
    {
      title: t("ledgers.recordNo"),
      dataIndex: "recordNo",
      key: "recordNo",
      width: 200,
      ellipsis: true,
    },
    {
      title: t("ledgers.collectionDate"),
      dataIndex: "collectionDate",
      key: "collectionDate",
      width: 120,
      render: (v) => dayjs(v).format("YYYY-MM-DD"),
    },
    {
      title: t("ledgers.loadingTime"),
      dataIndex: "loadingTime",
      key: "loadingTime",
      width: 90,
      render: (v) => dayjs(v).format("HH:mm"),
    },
    {
      title: t("ledgers.unloadingTime"),
      dataIndex: "unloadingTime",
      key: "unloadingTime",
      width: 90,
      render: (v) => (v ? dayjs(v).format("HH:mm") : "-"),
    },
    {
      title: t("stores.code"),
      dataIndex: ["store", "code"],
      key: "storeCode",
      width: 160,
      ellipsis: true,
    },
    {
      title: t("stores.name"),
      dataIndex: ["store", "name"],
      key: "storeName",
      width: 180,
      ellipsis: true,
    },
    {
      title: t("vehicles.plateNumber"),
      dataIndex: ["vehicle", "plateNumber"],
      key: "vehicle",
      width: 110,
    },
    {
      title: t("ledgers.tireCount"),
      dataIndex: "tireCount",
      key: "tireCount",
      width: 100,
      align: "right",
      render: (v) => v.toLocaleString(),
    },
    {
      title: `${t("ledgers.loadingNetWeight")}(kg)`,
      dataIndex: "loadingNetWeight",
      key: "loadingNetWeight",
      width: 140,
      align: "right",
      render: (v) => Math.round(v).toLocaleString(),
    },
    {
      title: `${t("ledgers.unloadingNetWeight")}(kg)`,
      dataIndex: "unloadingNetWeight",
      key: "unloadingNetWeight",
      width: 140,
      align: "right",
      render: (v) => Math.round(v).toLocaleString(),
    },
    {
      title: `${t("ledgers.loss")}(kg)`,
      dataIndex: "loss",
      key: "loss",
      width: 100,
      align: "right",
      render: (v) => formatNumber(v, 2),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        <FileTextOutlined style={{ marginRight: 8 }} />
        {t("ledgers.collectionTitle")}
      </Title>

      <Card variant="borderless">
        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            placeholder={t("ledgers.status")}
            value={statusFilter || undefined}
            onChange={setStatusFilter}
            style={{ width: 120 }}
            allowClear
            options={[
              { value: "PENDING", label: t("ledgers.statusPending") },
              { value: "PROCESSING", label: t("ledgers.statusProcessing") },
              { value: "COMPLETED", label: t("ledgers.statusCompleted") },
              { value: "FAILED", label: t("ledgers.statusFailed") },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => fetchData()}>
            {t("common.refresh")}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            {t("ledgers.createTask")}
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
            showTotal: (total) => t("common.total", { count: total }),
            onChange: (page, pageSize) => {
              setPage(page);
              setPageSize(pageSize);
            },
          }}
        />
      </Card>

      <Modal
        title={t("ledgers.createTask")}
        open={modalVisible}
        onOk={handleCreate}
        onCancel={() => setModalVisible(false)}
        confirmLoading={creating}
        destroyOnHidden
        afterOpenChange={handleModalAfterOpenChange}
        okText={creating ? "生成中..." : t("common.confirm")}
      >
        {modalVisible && (
          <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item
              name="dateRange"
              label={t("ledgers.dateRange")}
              rules={[{ required: true, message: "请选择时间范围" }]}
            >
              <RangePicker
                style={{ width: "100%" }}
                onChange={(dates) => {
                  if (dates && dates.length === 2) {
                    fetchTonnageEstimate(dates as [dayjs.Dayjs, dayjs.Dayjs]);
                  } else {
                    setTonnageEstimate(null);
                  }
                }}
              />
            </Form.Item>

            {/* 建议吨数区间显示 */}
            {estimateLoading && (
              <div
                style={{ marginBottom: 16, textAlign: "center", color: "#999" }}
              >
                <Spin size="small" style={{ marginRight: 8 }} />
                {t("ledgers.loadingEstimate")}
              </div>
            )}

            {tonnageEstimate &&
              !estimateLoading &&
              (tonnageEstimate.warning ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message={t("ledgers.tonnageWarning", {
                    warning: tonnageEstimate.warning,
                  })}
                />
              ) : (
                <div
                  style={{
                    marginBottom: 16,
                    padding: "12px 16px",
                    background:
                      "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)",
                    borderRadius: 8,
                    border: "1px solid #bae6fd",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 12,
                    }}
                  >
                    <Space size={12}>
                      <span style={{ color: "#64748b", fontSize: 13 }}>
                        建议最大吨数
                      </span>
                      <span
                        style={{
                          fontSize: 20,
                          fontWeight: 600,
                          color: "#0369a1",
                        }}
                      >
                        ≤ {tonnageEstimate.maxTonnage}
                      </span>
                      <span style={{ color: "#64748b", fontSize: 13 }}>吨</span>
                    </Space>
                    <Tooltip title="动态算法可精确控制到目标 ±2%">
                      <Tag color="green" style={{ margin: 0, cursor: "help" }}>
                        智能分配
                      </Tag>
                    </Tooltip>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 24,
                      paddingTop: 10,
                      borderTop: "1px dashed #cbd5e1",
                    }}
                  >
                    <Tooltip title="可用门店数量">
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 4,
                          cursor: "help",
                        }}
                      >
                        <span style={{ color: "#94a3b8", fontSize: 12 }}>
                          门店
                        </span>
                        <span style={{ color: "#334155", fontWeight: 500 }}>
                          {tonnageEstimate.storeCount}
                        </span>
                      </div>
                    </Tooltip>
                    <Tooltip title="收集车辆数量">
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 4,
                          cursor: "help",
                        }}
                      >
                        <span style={{ color: "#94a3b8", fontSize: 12 }}>
                          车辆
                        </span>
                        <span style={{ color: "#334155", fontWeight: 500 }}>
                          {tonnageEstimate.vehicleCount}
                        </span>
                      </div>
                    </Tooltip>
                    <Tooltip title="门店到收集点的平均行程时间">
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 4,
                          cursor: "help",
                        }}
                      >
                        <span style={{ color: "#94a3b8", fontSize: 12 }}>
                          行程
                        </span>
                        <span style={{ color: "#334155", fontWeight: 500 }}>
                          {tonnageEstimate.avgTravelMinutes}
                        </span>
                        <span style={{ color: "#94a3b8", fontSize: 12 }}>
                          分钟
                        </span>
                      </div>
                    </Tooltip>
                    <Tooltip title="根据平均行程估算的每车每日趟数">
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 4,
                          cursor: "help",
                        }}
                      >
                        <span style={{ color: "#94a3b8", fontSize: 12 }}>
                          每车/日
                        </span>
                        <span style={{ color: "#334155", fontWeight: 500 }}>
                          {tonnageEstimate.tripsPerVehiclePerDay}
                        </span>
                        <span style={{ color: "#94a3b8", fontSize: 12 }}>
                          趟
                        </span>
                      </div>
                    </Tooltip>
                  </div>
                </div>
              ))}

            <Form.Item
              name="targetTonnage"
              label={
                <Space>
                  {t("ledgers.targetWeight")}
                  {tonnageEstimate && !tonnageEstimate.warning && (
                    <Tooltip
                      title={`建议设置在 ${tonnageEstimate.minTonnage}~${tonnageEstimate.maxTonnage} t 之间，以确保较高的完成率`}
                    >
                      <InfoCircleOutlined style={{ color: "#1890ff" }} />
                    </Tooltip>
                  )}
                </Space>
              }
              rules={[{ required: true }]}
            >
              <Space.Compact>
                <InputNumber
                  min={0.1}
                  max={99999}
                  step={0.1}
                  style={{ width: 160 }}
                  status={
                    tonnageEstimate &&
                    !tonnageEstimate.warning &&
                    form.getFieldValue("targetTonnage") >
                      tonnageEstimate.maxTonnage
                      ? "warning"
                      : undefined
                  }
                />
                <Button disabled style={{ pointerEvents: "none" }}>
                  t (吨)
                </Button>
              </Space.Compact>
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title={
          <Space>
            <CheckCircleOutlined style={{ color: "#52c41a" }} />
            {t("ledgers.generateSuccess")}
          </Space>
        }
        open={successModalVisible}
        onOk={() => setSuccessModalVisible(false)}
        onCancel={() => setSuccessModalVisible(false)}
        footer={[
          <Button
            key="ok"
            type="primary"
            onClick={() => setSuccessModalVisible(false)}
          >
            {t("common.confirm")}
          </Button>,
        ]}
        width={600}
      >
        {generationSummary && (
          <Result
            status="success"
            title={t("ledgers.generateSuccess")}
            subTitle={t("ledgers.generateSummary")}
            extra={
              <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
                <Col span={8}>
                  <Statistic
                    title={t("ledgers.totalRecords")}
                    value={generationSummary.totalRecords}
                    suffix="条"
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title={t("ledgers.storesCount")}
                    value={generationSummary.storesCount}
                    suffix="家"
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title={t("ledgers.vehiclesCount")}
                    value={generationSummary.vehiclesCount}
                    suffix="辆"
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title={t("ledgers.totalLoadingWeight")}
                    value={generationSummary.totalLoadingWeight / 1000}
                    precision={2}
                    suffix="t"
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title={t("ledgers.totalUnloadingWeight")}
                    value={generationSummary.totalUnloadingWeight / 1000}
                    precision={2}
                    suffix="t"
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title={t("ledgers.totalLoss")}
                    value={generationSummary.totalLoss / 1000}
                    precision={3}
                    suffix="t"
                    valueStyle={{ color: "#ff4d4f" }}
                  />
                </Col>
              </Row>
            }
          />
        )}
      </Modal>

      <Modal
        title={t("ledgers.collectionTitle")}
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width={1400}
        destroyOnHidden
        centered
      >
        {selectedTask && (
          <Spin spinning={detailLoading}>
            <Descriptions
              bordered
              size="small"
              column={4}
              style={{ marginBottom: 16 }}
            >
              <Descriptions.Item label={t("ledgers.taskNo")}>
                {selectedTask.taskNo}
              </Descriptions.Item>
              <Descriptions.Item label={t("ledgers.collectionPoint")}>
                {selectedTask.collectionPoint.name}
              </Descriptions.Item>
              <Descriptions.Item label={t("ledgers.dateRange")}>
                {formatDateRange(selectedTask.startDate, selectedTask.endDate)}
              </Descriptions.Item>
              <Descriptions.Item label={t("ledgers.status")}>
                {getStatusTag(selectedTask.status)}
              </Descriptions.Item>
              <Descriptions.Item label={`${t("ledgers.targetWeight")}(t)`}>
                {formatNumber(selectedTask.targetTonnage / 1000)}
              </Descriptions.Item>
              <Descriptions.Item label={`${t("ledgers.loadingNetWeight")}(t)`}>
                {selectedTask.actualTonnage !== null
                  ? formatNumber(selectedTask.actualTonnage / 1000)
                  : "-"}
              </Descriptions.Item>
              <Descriptions.Item
                label={`${t("ledgers.unloadingNetWeight")}(t)`}
              >
                {selectedTask.unloadingTonnage !== null
                  ? formatNumber(selectedTask.unloadingTonnage / 1000)
                  : "-"}
              </Descriptions.Item>
              <Descriptions.Item label={`${t("ledgers.loss")}(t)`}>
                {selectedTask.totalLoss !== null
                  ? formatNumber(selectedTask.totalLoss / 1000, 3)
                  : "-"}
              </Descriptions.Item>
              <Descriptions.Item label="完成度">
                {selectedTask.actualTonnage !== null && (
                  <Progress
                    percent={Math.min(
                      100,
                      Math.round(
                        (selectedTask.actualTonnage /
                          selectedTask.targetTonnage) *
                          100
                      )
                    )}
                    size="small"
                    style={{ width: 100 }}
                  />
                )}
              </Descriptions.Item>
              <Descriptions.Item label="完成时间">
                {selectedTask.completedAt
                  ? dayjs(selectedTask.completedAt).format("YYYY-MM-DD HH:mm")
                  : "-"}
              </Descriptions.Item>
            </Descriptions>

            <Table
              columns={collectionColumns}
              dataSource={collectionRecords}
              rowKey="id"
              size="small"
              scroll={{ x: 1300, y: "calc(100vh - 450px)" }}
              pagination={{
                current: recordPage,
                pageSize: recordPageSize,
                total: recordsTotal,
                showSizeChanger: true,
                showTotal: (total) => t("common.total", { count: total }),
                pageSizeOptions: ["10", "20", "50", "100"],
                onChange: handleRecordPageChange,
              }}
            />

            <div style={{ marginTop: 16, textAlign: "right" }}>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={() => handleExport(selectedTask)}
              >
                {t("ledgers.exportExcel")}
              </Button>
            </div>
          </Spin>
        )}
      </Modal>
    </div>
  );
}
