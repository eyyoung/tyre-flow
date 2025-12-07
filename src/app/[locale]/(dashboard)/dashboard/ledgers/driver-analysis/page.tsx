'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  Space,
  Select,
  Typography,
  DatePicker,
  App,
  Empty,
  Spin,
  Row,
  Col,
  Tag,
} from 'antd';
import {
  SearchOutlined,
  LineChartOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import dayjs from 'dayjs';
import dynamic from 'next/dynamic';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

// 动态导入图表组件以避免 SSR 问题
const Line = dynamic(
  () => import('@ant-design/charts').then((mod) => mod.Line),
  { ssr: false, loading: () => <Spin size="large" /> }
);

interface CollectionPoint {
  id: string;
  code: string;
  name: string;
}

interface ChartDataPoint {
  date: string;
  driverId: string;
  driverName: string;
  weight: number;
  loadingTime: string;
  unloadingTime: string;
}

interface DriverInfo {
  id: string;
  name: string;
  phone: string;
}

// 预定义颜色列表，确保不同司机有不同颜色
const DRIVER_COLORS = [
  '#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1',
  '#13c2c2', '#eb2f96', '#fa8c16', '#a0d911', '#2f54eb',
  '#fadb14', '#ff4d4f', '#9254de', '#36cfc9', '#f759ab',
  '#ffa940', '#bae637', '#597ef7', '#ffec3d', '#ff7a45',
];

export default function DriverAnalysisPage() {
  const t = useTranslations();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [collectionPoints, setCollectionPoints] = useState<CollectionPoint[]>([]);
  const [selectedDriverIds, setSelectedDriverIds] = useState<Set<string>>(new Set());
  
  const [selectedCp, setSelectedCp] = useState<string>('');
  const [recordType, setRecordType] = useState<string>('collection');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([
    dayjs().subtract(30, 'day'),
    dayjs(),
  ]);

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

  useEffect(() => {
    fetchCollectionPoints();
  }, [fetchCollectionPoints]);

  // 查询图表数据
  const fetchChartData = async () => {
    if (!selectedCp) {
      message.warning(t('ledgers.selectCollectionPointRequired'));
      return;
    }

    if (!dateRange[0] || !dateRange[1]) {
      message.warning(t('ledgers.selectDateRangeRequired'));
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        collectionPointId: selectedCp,
        recordType,
        startDate: dateRange[0].format('YYYY-MM-DD'),
        endDate: dateRange[1].format('YYYY-MM-DD'),
      });

      const response = await fetch(`/api/driver-ledger/analysis?${params}`);
      const result = await response.json();

      if (response.ok) {
        setChartData(result.data);
        setDrivers(result.drivers);
        // 默认只选中第一个司机
        if (result.drivers.length > 0) {
          setSelectedDriverIds(new Set([result.drivers[0].id]));
        }
      } else {
        message.error(result.error || t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  // 切换司机选中状态
  const toggleDriver = (driverId: string) => {
    setSelectedDriverIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(driverId)) {
        // 至少保留一个司机被选中
        if (newSet.size > 1) {
          newSet.delete(driverId);
        }
      } else {
        newSet.add(driverId);
      }
      return newSet;
    });
  };

  // 全选/取消全选
  const toggleAllDrivers = () => {
    if (selectedDriverIds.size === drivers.length) {
      // 如果全部选中，则只保留第一个
      setSelectedDriverIds(new Set([drivers[0]?.id].filter(Boolean)));
    } else {
      // 否则全选
      setSelectedDriverIds(new Set(drivers.map((d) => d.id)));
    }
  };

  // 过滤后的图表数据
  const filteredChartData = chartData.filter((d) => selectedDriverIds.has(d.driverId));

  // 获取选中司机的颜色映射
  const selectedDrivers = drivers.filter((d) => selectedDriverIds.has(d.id));

  // 图表配置
  const chartConfig = {
    data: filteredChartData,
    xField: 'date',
    yField: 'weight',
    colorField: 'driverName',
    smooth: true,
    point: {
      shapeField: 'circle',
      sizeField: 4,
    },
    style: {
      lineWidth: 2,
    },
    axis: {
      x: {
        title: t('ledgers.collectionDate'),
        labelAutoRotate: true,
      },
      y: {
        title: `${t('ledgers.loadingWeight')} (kg)`,
        labelFormatter: (v: number) => `${v.toLocaleString()} kg`,
      },
    },
    legend: false,
    tooltip: {
      title: (d: ChartDataPoint) => `${d.date} - ${d.driverName}`,
      items: [
        {
          field: 'loadingTime',
          name: t('ledgers.loadingTime'),
        },
        {
          field: 'unloadingTime',
          name: t('ledgers.unloadingTime'),
        },
      ],
    },
    scale: {
      color: {
        range: selectedDrivers.map((_, index) => {
          const originalIndex = drivers.findIndex((d) => d.id === selectedDrivers[index]?.id);
          return DRIVER_COLORS[originalIndex % DRIVER_COLORS.length];
        }),
      },
    },
    animate: {
      enter: { type: 'fadeIn' },
    },
  };

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        <LineChartOutlined style={{ marginRight: 8 }} />
        {t('ledgers.driverAnalysisTitle')}
      </Title>

      <Card variant="borderless" style={{ marginBottom: 16 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Text type="secondary">{t('ledgers.analysisDescription')}</Text>
          
          <Row gutter={[16, 16]} align="middle">
            <Col xs={24} sm={12} md={6}>
              <Select
                placeholder={t('ledgers.collectionPoint')}
                value={selectedCp || undefined}
                onChange={setSelectedCp}
                style={{ width: '100%' }}
                options={collectionPoints.map((cp) => ({
                  value: cp.id,
                  label: cp.name,
                }))}
              />
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Select
                placeholder={t('ledgers.recordType')}
                value={recordType}
                onChange={setRecordType}
                style={{ width: '100%' }}
                options={[
                  { value: 'collection', label: t('ledgers.collectionRecords') },
                  { value: 'transfer', label: t('ledgers.transferRecords') },
                ]}
              />
            </Col>
            <Col xs={24} sm={24} md={8}>
              <RangePicker
                value={dateRange}
                onChange={(dates) => setDateRange(dates as [dayjs.Dayjs | null, dayjs.Dayjs | null])}
                style={{ width: '100%' }}
                placeholder={[t('ledgers.startDate'), t('ledgers.endDate')]}
              />
            </Col>
            <Col xs={24} sm={24} md={4}>
              <Button 
                type="primary" 
                icon={<SearchOutlined />} 
                onClick={fetchChartData}
                loading={loading}
                block
              >
                {t('ledgers.queryChart')}
              </Button>
            </Col>
          </Row>
        </Space>
      </Card>

      <Card variant="borderless">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <Spin size="large" />
          </div>
        ) : chartData.length > 0 ? (
          <>
            {/* 司机标签 */}
            <div style={{ marginBottom: 16 }}>
              <Space wrap size={[8, 8]}>
                <Text strong>司机列表：</Text>
                <Tag
                  style={{ cursor: 'pointer' }}
                  color={selectedDriverIds.size === drivers.length ? 'blue' : 'default'}
                  onClick={toggleAllDrivers}
                >
                  {selectedDriverIds.size === drivers.length ? '取消全选' : '全选'}
                </Tag>
                {drivers.map((driver, index) => {
                  const isSelected = selectedDriverIds.has(driver.id);
                  const color = DRIVER_COLORS[index % DRIVER_COLORS.length];
                  return (
                    <Tag 
                      key={driver.id} 
                      color={isSelected ? color : 'default'}
                      onClick={() => toggleDriver(driver.id)}
                      style={{ 
                        cursor: 'pointer',
                        opacity: isSelected ? 1 : 0.5,
                        borderColor: isSelected ? color : undefined,
                      }}
                    >
                      {driver.name} {driver.phone && `(${driver.phone})`}
                    </Tag>
                  );
                })}
              </Space>
            </div>
            
            {/* 图表 */}
            <div style={{ height: 500 }}>
              <Line {...chartConfig} />
            </div>
          </>
        ) : (
          <Empty
            description={t('ledgers.noDataForChart')}
            style={{ padding: '60px 0' }}
          />
        )}
      </Card>
    </div>
  );
}

