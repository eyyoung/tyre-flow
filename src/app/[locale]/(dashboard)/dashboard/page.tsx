"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card, Statistic, Typography, Table, Tag, Spin } from "antd";
import {
  ShopOutlined,
  CarOutlined,
  RiseOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { useCollectionPoint } from "@/contexts/CollectionPointContext";
import styles from "./dashboard.module.css";

const { Title } = Typography;

interface DashboardStats {
  stores: number;
  vehicles: number;
  monthlyCollectionWeight: number;
  monthlyTransferWeight: number;
}

interface RecentTask {
  key: string;
  taskNo: string;
  targetTonnage: number;
  actualTonnage: number | null;
  status: string;
  createdAt: string;
}

export default function DashboardPage() {
  const t = useTranslations();
  const { currentCollectionPoint } = useCollectionPoint();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    stores: 0,
    vehicles: 0,
    monthlyCollectionWeight: 0,
    monthlyTransferWeight: 0,
  });
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>([]);

  const fetchData = useCallback(async () => {
    if (!currentCollectionPoint) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams({
        collectionPointId: currentCollectionPoint.id,
      });
      const response = await fetch(`/api/dashboard?${params}`);
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
  }, [currentCollectionPoint]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const statCards = [
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
      key: "collectionWeight",
      title: t("dashboard.monthlyCollectionWeight"),
      value: stats.monthlyCollectionWeight,
      suffix: t("dashboard.ton"),
      icon: <RiseOutlined />,
      color: "#722ed1",
      bgColor: "#f9f0ff",
    },
    {
      key: "transferWeight",
      title: t("dashboard.monthlyTransferWeight"),
      value: stats.monthlyTransferWeight,
      suffix: t("dashboard.ton"),
      icon: <SwapOutlined />,
      color: "#13c2c2",
      bgColor: "#e6fffb",
    },
  ];

  const taskColumns = [
    {
      title: t("ledgers.taskNo"),
      dataIndex: "taskNo",
      key: "taskNo",
      width: 260,
    },
    {
      title: t("ledgers.targetWeight"),
      dataIndex: "targetTonnage",
      key: "targetTonnage",
      width: 130,
      render: (value: number) => `${(value / 1000).toFixed(2)} t`,
    },
    {
      title: t("ledgers.actualWeight"),
      dataIndex: "actualTonnage",
      key: "actualTonnage",
      width: 130,
      render: (value: number | null) => value !== null ? `${(value / 1000).toFixed(2)} t` : '-',
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
        <div className={styles.statGrid}>
          {statCards.map((stat) => (
            <Card className={styles.statCard} variant="borderless" key={stat.key}>
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
          ))}
        </div>

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
