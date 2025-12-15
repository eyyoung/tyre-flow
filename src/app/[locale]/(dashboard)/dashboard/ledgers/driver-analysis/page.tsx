'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  Tooltip,
} from 'antd';
import {
  SearchOutlined,
  LineChartOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import dayjs from 'dayjs';
import { useCollectionPoint } from '@/contexts/CollectionPointContext';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

interface TripRecord {
  id: string;
  date: string;
  driverId: string;
  driverName: string;
  loadingTimeMinutes: number;
  unloadingTimeMinutes: number | null;  // null 表示中间站点无卸车
  loadingTimeStr: string;
  unloadingTimeStr: string;             // '-' 表示无卸车时间
  weight: number;
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

// 将分钟数转换为时间字符串
function minutesToTimeStr(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

export default function DriverAnalysisPage() {
  const t = useTranslations();
  const { message } = App.useApp();
  const { currentCollectionPoint } = useCollectionPoint();
  const [loading, setLoading] = useState(false);
  const [tripRecords, setTripRecords] = useState<TripRecord[]>([]);
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [selectedDriverIds, setSelectedDriverIds] = useState<Set<string>>(new Set());
  
  const [recordType, setRecordType] = useState<string>('collection');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([
    dayjs().subtract(7, 'day'),
    dayjs(),
  ]);

  // 查询图表数据
  const fetchChartData = async () => {
    if (!currentCollectionPoint) {
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
        collectionPointId: currentCollectionPoint.id,
        recordType,
        startDate: dateRange[0].format('YYYY-MM-DD'),
        endDate: dateRange[1].format('YYYY-MM-DD'),
      });

      const response = await fetch(`/api/driver-ledger/analysis?${params}`);
      const result = await response.json();

      if (response.ok) {
        setTripRecords(result.data);
        setDrivers(result.drivers);
        // 默认选中所有司机
        if (result.drivers.length > 0) {
          setSelectedDriverIds(new Set(result.drivers.map((d: DriverInfo) => d.id)));
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

  // 当收集点变化时，清空图表数据
  useEffect(() => {
    setTripRecords([]);
    setDrivers([]);
    setSelectedDriverIds(new Set());
  }, [currentCollectionPoint]);

  // 切换司机选中状态
  const toggleDriver = (driverId: string) => {
    setSelectedDriverIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(driverId)) {
        newSet.delete(driverId);
      } else {
        newSet.add(driverId);
      }
      return newSet;
    });
  };

  // 全选/取消全选
  const toggleAllDrivers = () => {
    if (selectedDriverIds.size === drivers.length) {
      // 如果全部选中，则清空
      setSelectedDriverIds(new Set());
    } else {
      // 否则全选
      setSelectedDriverIds(new Set(drivers.map((d) => d.id)));
    }
  };

  // 过滤后的行程数据
  const filteredTripRecords = tripRecords.filter((d) => selectedDriverIds.has(d.driverId));

  // 获取所有唯一日期
  const uniqueDates = useMemo(() => {
    const dates = [...new Set(filteredTripRecords.map((r) => r.date))];
    return dates.sort();
  }, [filteredTripRecords]);

  // 获取司机颜色
  const getDriverColor = useCallback((driverId: string) => {
    const index = drivers.findIndex((d) => d.id === driverId);
    return DRIVER_COLORS[index % DRIVER_COLORS.length];
  }, [drivers]);

  // 计算时间范围（找出所有行程的最早和最晚时间，留一些 padding）
  const timeRange = useMemo(() => {
    if (filteredTripRecords.length === 0) return { min: 0, max: 1440 };
    
    let minTime = Math.min(...filteredTripRecords.map((r) => r.loadingTimeMinutes));
    // 过滤掉 null 的 unloadingTimeMinutes，用 loadingTimeMinutes 作为备选
    const unloadingTimes = filteredTripRecords.map((r) => r.unloadingTimeMinutes ?? r.loadingTimeMinutes);
    let maxTime = Math.max(...unloadingTimes);
    
    // 增加 30 分钟的 padding
    minTime = Math.max(0, minTime - 30);
    maxTime = Math.min(1440, maxTime + 30);
    
    return { min: minTime, max: maxTime };
  }, [filteredTripRecords]);

  // 生成时间刻度
  const timeLabels = useMemo(() => {
    const labels: number[] = [];
    // 每小时一个刻度
    const startHour = Math.floor(timeRange.min / 60);
    const endHour = Math.ceil(timeRange.max / 60);
    for (let h = startHour; h <= endHour; h++) {
      labels.push(h * 60);
    }
    return labels;
  }, [timeRange]);

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
            <Col xs={24} sm={24} md={10}>
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
        ) : tripRecords.length > 0 ? (
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
            
            {/* 时间线图表 */}
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: Math.max(800, uniqueDates.length * 120 + 80) }}>
                {/* 图表区域 */}
                <svg
                  width="100%"
                  height={500}
                  viewBox={`0 0 ${Math.max(800, uniqueDates.length * 120 + 80)} 500`}
                  preserveAspectRatio="xMinYMin meet"
                >
                  {/* Y轴时间刻度 */}
                  <g className="y-axis">
                    {timeLabels.map((minutes) => {
                      const y = 40 + ((minutes - timeRange.min) / (timeRange.max - timeRange.min)) * 420;
                      return (
                        <g key={minutes}>
                          <line
                            x1={60}
                            y1={y}
                            x2={Math.max(800, uniqueDates.length * 120 + 80) - 20}
                            y2={y}
                            stroke="#e8e8e8"
                            strokeDasharray="4,4"
                          />
                          <text
                            x={55}
                            y={y + 4}
                            textAnchor="end"
                            fontSize={12}
                            fill="#666"
                          >
                            {minutesToTimeStr(minutes)}
                          </text>
                        </g>
                      );
                    })}
                  </g>

                  {/* X轴日期标签 */}
                  <g className="x-axis">
                    {uniqueDates.map((date, index) => {
                      const x = 80 + index * 120 + 50; // 每个日期列宽度120px，居中
                      return (
                        <text
                          key={date}
                          x={x}
                          y={480}
                          textAnchor="middle"
                          fontSize={12}
                          fill="#666"
                        >
                          {date.slice(5)} {/* 只显示 MM-DD */}
                        </text>
                      );
                    })}
                  </g>

                  {/* 绘制每个日期列的行程线段 */}
                  {uniqueDates.map((date, dateIndex) => {
                    const dateRecords = filteredTripRecords.filter((r) => r.date === date);
                    const columnX = 80 + dateIndex * 120;
                    
                    // 为同一天的不同司机分配不同的 x 偏移
                    const driverOffsets = new Map<string, number>();
                    const driversInDate = [...new Set(dateRecords.map((r) => r.driverId))];
                    const offsetStep = 100 / (driversInDate.length + 1);
                    driversInDate.forEach((dId, i) => {
                      driverOffsets.set(dId, (i + 1) * offsetStep);
                    });
                    
                    return (
                      <g key={date} className="date-column">
                        {/* 日期列背景 */}
                        <rect
                          x={columnX}
                          y={40}
                          width={100}
                          height={420}
                          fill={dateIndex % 2 === 0 ? '#fafafa' : '#fff'}
                          stroke="#f0f0f0"
                        />
                        
                        {/* 绘制行程线段 */}
                        {dateRecords.map((record) => {
                          const color = getDriverColor(record.driverId);
                          const xOffset = driverOffsets.get(record.driverId) || 50;
                          const x = columnX + xOffset;
                          const y1 = 40 + ((record.loadingTimeMinutes - timeRange.min) / (timeRange.max - timeRange.min)) * 420;
                          // 如果没有卸车时间，只显示装车点
                          const hasUnloadingTime = record.unloadingTimeMinutes !== null;
                          const y2 = hasUnloadingTime 
                            ? 40 + ((record.unloadingTimeMinutes! - timeRange.min) / (timeRange.max - timeRange.min)) * 420
                            : y1;
                          
                          return (
                            <Tooltip
                              key={record.id}
                              title={
                                <div>
                                  <div><strong>{record.driverName}</strong></div>
                                  <div>{t('ledgers.loadingTime')}: {record.loadingTimeStr}</div>
                                  <div>{t('ledgers.unloadingTime')}: {record.unloadingTimeStr}</div>
                                  <div>{t('ledgers.loadingWeight')}: {record.weight.toLocaleString()} kg</div>
                                </div>
                              }
                            >
                              <g style={{ cursor: 'pointer' }}>
                                {/* 主线段（只有有卸车时间才显示） */}
                                {hasUnloadingTime && (
                                  <line
                                    x1={x}
                                    y1={y1}
                                    x2={x}
                                    y2={y2}
                                    stroke={color}
                                    strokeWidth={6}
                                    strokeLinecap="round"
                                  />
                                )}
                                {/* 起点圆点（装车点） */}
                                <circle
                                  cx={x}
                                  cy={y1}
                                  r={5}
                                  fill={hasUnloadingTime ? color : '#fff'}
                                  stroke={color}
                                  strokeWidth={hasUnloadingTime ? 1 : 2}
                                />
                                {/* 终点圆点（卸车点，只有有卸车时间才显示） */}
                                {hasUnloadingTime && (
                                  <circle
                                    cx={x}
                                    cy={y2}
                                    r={5}
                                    fill={color}
                                    stroke="#fff"
                                    strokeWidth={1}
                                  />
                                )}
                              </g>
                            </Tooltip>
                          );
                        })}
                      </g>
                    );
                  })}

                  {/* Y轴标题 */}
                  <text
                    x={15}
                    y={250}
                    textAnchor="middle"
                    fontSize={14}
                    fill="#333"
                    transform="rotate(-90, 15, 250)"
                  >
                    {t('ledgers.timeOfDay')}
                  </text>
                </svg>
              </div>
            </div>

            {/* 图例说明 */}
            <div style={{ marginTop: 16, padding: '12px', background: '#fafafa', borderRadius: 4 }}>
              <Text type="secondary">
                💡 提示：每条竖线代表一次行程，从装车时间到卸车时间。同一天内，如果同一司机的线段存在时间重叠，说明数据可能有问题。
              </Text>
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

