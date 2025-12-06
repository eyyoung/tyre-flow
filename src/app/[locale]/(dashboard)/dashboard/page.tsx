"use client";

import React from "react";
import { Card, Row, Col, Statistic, Typography, Table, Tag } from "antd";
import {
  EnvironmentOutlined,
  ShopOutlined,
  CarOutlined,
  RiseOutlined,
} from "@ant-design/icons";
import { useTranslations } from "next-intl";
import styles from "./dashboard.module.css";

const { Title } = Typography;

export default function DashboardPage() {
  const t = useTranslations();

  // 模拟统计数据
  const stats = [
    {
      key: "collectionPoints",
      title: t("dashboard.totalCollectionPoints"),
      value: 12,
      icon: <EnvironmentOutlined />,
      color: "#1677ff",
      bgColor: "#e6f4ff",
    },
    {
      key: "stores",
      title: t("dashboard.totalStores"),
      value: 24680,
      icon: <ShopOutlined />,
      color: "#52c41a",
      bgColor: "#f6ffed",
    },
    {
      key: "vehicles",
      title: t("dashboard.totalVehicles"),
      value: 156,
      icon: <CarOutlined />,
      color: "#faad14",
      bgColor: "#fffbe6",
    },
    {
      key: "tonnage",
      title: t("dashboard.monthlyTonnage"),
      value: 1250.5,
      suffix: "t",
      icon: <RiseOutlined />,
      color: "#722ed1",
      bgColor: "#f9f0ff",
    },
  ];

  // 模拟最近任务数据
  const recentTasks = [
    {
      key: "1",
      taskNo: "LT-2025-12-001",
      collectionPoint: "广州收集点",
      targetTonnage: 150,
      status: "completed",
      createdAt: "2025-12-05",
    },
    {
      key: "2",
      taskNo: "LT-2025-12-002",
      collectionPoint: "深圳收集点",
      targetTonnage: 200,
      status: "processing",
      createdAt: "2025-12-06",
    },
    {
      key: "3",
      taskNo: "LT-2025-12-003",
      collectionPoint: "东莞收集点",
      targetTonnage: 180,
      status: "pending",
      createdAt: "2025-12-06",
    },
  ];

  const taskColumns = [
    {
      title: t("ledgers.taskNo"),
      dataIndex: "taskNo",
      key: "taskNo",
    },
    {
      title: t("ledgers.collectionPoint"),
      dataIndex: "collectionPoint",
      key: "collectionPoint",
    },
    {
      title: t("ledgers.targetTonnage"),
      dataIndex: "targetTonnage",
      key: "targetTonnage",
      render: (value: number) => `${value} t`,
    },
    {
      title: t("ledgers.status"),
      dataIndex: "status",
      key: "status",
      render: (status: string) => {
        const statusMap: Record<string, { color: string; text: string }> = {
          pending: { color: "default", text: t("ledgers.statusPending") },
          processing: {
            color: "processing",
            text: t("ledgers.statusProcessing"),
          },
          completed: { color: "success", text: t("ledgers.statusCompleted") },
          failed: { color: "error", text: t("ledgers.statusFailed") },
        };
        const { color, text } = statusMap[status] || statusMap.pending;
        return <Tag color={color}>{text}</Tag>;
      },
    },
    {
      title: t("common.createdAt"),
      dataIndex: "createdAt",
      key: "createdAt",
    },
  ];

  return (
    <div className={styles.container}>
      <Title level={4} className={styles.pageTitle}>
        {t("dashboard.welcome")}
      </Title>

      <Row gutter={[24, 24]}>
        {stats.map((stat) => (
          <Col xs={24} sm={12} lg={6} key={stat.key}>
            <Card className={styles.statCard} variant="borderless">
              <div className={styles.statContent}>
                <div
                  className={styles.statIcon}
                  style={{ background: stat.bgColor, color: stat.color }}
                >
                  {stat.icon}
                </div>
                <Statistic
                  title={stat.title}
                  value={stat.value}
                  suffix={stat.suffix}
                  valueStyle={{ color: stat.color }}
                />
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Card
        title={t("dashboard.recentTasks")}
        className={styles.tableCard}
        variant="borderless"
      >
        <Table
          columns={taskColumns}
          dataSource={recentTasks}
          pagination={false}
          size="middle"
        />
      </Card>
    </div>
  );
}
