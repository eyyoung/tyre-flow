"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card, Row, Col, Statistic, Typography, Table, Tag, Spin } from "antd";
import {
  EnvironmentOutlined,
  ShopOutlined,
  CarOutlined,
  RiseOutlined,
} from "@ant-design/icons";
import { useTranslations } from "next-intl";
import styles from "./dashboard.module.css";

const { Title } = Typography;

interface DashboardStats {
  collectionPoints: number;
  stores: number;
  vehicles: number;
  monthlyTonnage: number;
}

interface RecentTask {
  key: string;
  taskNo: string;
  collectionPoint: string;
  targetTonnage: number;
  actualTonnage: number | null;
  status: string;
  createdAt: string;
}

export default function DashboardPage() {
  const t = useTranslations();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    collectionPoints: 0,
    stores: 0,
    vehicles: 0,
    monthlyTonnage: 0,
  });
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/dashboard');
      const result = await response.json();
      
      if (response.ok) {
        setStats(result.stats);
        setRecentTasks(result.recentTasks);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const statCards = [
    {
      key: "collectionPoints",
      title: t("dashboard.totalCollectionPoints"),
      value: stats.collectionPoints,
      icon: <EnvironmentOutlined />,
      color: "#1677ff",
      bgColor: "#e6f4ff",
    },
    {
      key: "stores",
      title: t("dashboard.totalStores"),
      value: stats.stores,
      icon: <ShopOutlined />,
      color: "#52c41a",
      bgColor: "#f6ffed",
    },
    {
      key: "vehicles",
      title: t("dashboard.totalVehicles"),
      value: stats.vehicles,
      icon: <CarOutlined />,
      color: "#faad14",
      bgColor: "#fffbe6",
    },
    {
      key: "tonnage",
      title: t("dashboard.monthlyTonnage"),
      value: stats.monthlyTonnage,
      suffix: "t",
      icon: <RiseOutlined />,
      color: "#722ed1",
      bgColor: "#f9f0ff",
    },
  ];

  const taskColumns = [
    {
      title: t("ledgers.taskNo"),
      dataIndex: "taskNo",
      key: "taskNo",
      width: 200,
    },
    {
      title: t("ledgers.collectionPoint"),
      dataIndex: "collectionPoint",
      key: "collectionPoint",
      width: 150,
    },
    {
      title: t("ledgers.targetTonnage"),
      dataIndex: "targetTonnage",
      key: "targetTonnage",
      width: 120,
      render: (value: number) => `${value} t`,
    },
    {
      title: t("ledgers.actualTonnage"),
      dataIndex: "actualTonnage",
      key: "actualTonnage",
      width: 120,
      render: (value: number | null) => value !== null ? `${value} t` : '-',
    },
    {
      title: t("ledgers.status"),
      dataIndex: "status",
      key: "status",
      width: 100,
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
      width: 120,
    },
  ];

  return (
    <div className={styles.container}>
      <Title level={4} className={styles.pageTitle}>
        {t("dashboard.welcome")}
      </Title>

      <Spin spinning={loading}>
        <Row gutter={[24, 24]}>
          {statCards.map((stat) => (
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
            locale={{ emptyText: t("common.noData") }}
          />
        </Card>
      </Spin>
    </div>
  );
}
