'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Select,
  Typography,
  Tag,
  DatePicker,
  Statistic,
  Row,
  Col,
  App,
} from 'antd';
import {
  DownloadOutlined,
  ReloadOutlined,
  IdcardOutlined,
  CarOutlined,
  ScissorOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { Title } = Typography;
const { RangePicker } = DatePicker;

interface Driver {
  id: string;
  vehicleId: string;
  name: string;
  phone: string;
  vehicles: Array<{ plateNumber: string; type: string }>;
  collectionPointName: string;
}

interface CollectionPoint {
  id: string;
  code: string;
  name: string;
}

interface LedgerRecord {
  id: string;
  recordNo: string;
  date: string;
  loadingTime: string;
  unloadingTime: string;
  type: 'collection' | 'transfer';
  driverName: string;
  driverPhone: string;
  vehiclePlate: string;
  weight: number; // kg
  tireCount: number;
  storeName: string | null;
  destination: string | null;
}

interface Summary {
  totalTrips: number;
  totalWeight: number;
}

export default function DriverLedgerPage() {
  const t = useTranslations();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LedgerRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [summary, setSummary] = useState<Summary>({ totalTrips: 0, totalWeight: 0 });
  
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [collectionPoints, setCollectionPoints] = useState<CollectionPoint[]>([]);
  
  const [selectedDriver, setSelectedDriver] = useState<string>('');
  const [selectedCp, setSelectedCp] = useState<string>('');
  const [recordType, setRecordType] = useState<string>('all');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([null, null]);

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

  // 获取司机列表
  const fetchDrivers = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedCp) {
        params.set('collectionPointId', selectedCp);
      }
      const response = await fetch(`/api/driver-ledger/drivers?${params}`);
      const result = await response.json();
      if (response.ok) {
        setDrivers(result.data);
      }
    } catch {
      // ignore
    }
  }, [selectedCp]);

  // 获取台账数据
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        recordType,
      });

      if (selectedDriver) {
        params.set('driverId', selectedDriver);
      }
      if (selectedCp) {
        params.set('collectionPointId', selectedCp);
      }
      if (dateRange[0]) {
        params.set('startDate', dateRange[0].format('YYYY-MM-DD'));
      }
      if (dateRange[1]) {
        params.set('endDate', dateRange[1].format('YYYY-MM-DD'));
      }

      const response = await fetch(`/api/driver-ledger?${params}`);
      const result = await response.json();

      if (response.ok) {
        setData(result.data);
        setTotal(result.total);
        setSummary(result.summary);
      } else {
        message.error(result.error || t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, selectedDriver, selectedCp, recordType, dateRange, t, message]);

  useEffect(() => {
    fetchCollectionPoints();
  }, [fetchCollectionPoints]);

  useEffect(() => {
    fetchDrivers();
  }, [fetchDrivers]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 当收集点改变时，重置司机选择
  useEffect(() => {
    setSelectedDriver('');
  }, [selectedCp]);

  const handleExport = async () => {
    try {
      const params = new URLSearchParams({ recordType });

      if (selectedDriver) {
        params.set('driverId', selectedDriver);
      }
      if (selectedCp) {
        params.set('collectionPointId', selectedCp);
      }
      if (dateRange[0]) {
        params.set('startDate', dateRange[0].format('YYYY-MM-DD'));
      }
      if (dateRange[1]) {
        params.set('endDate', dateRange[1].format('YYYY-MM-DD'));
      }

      const response = await fetch(`/api/driver-ledger/export?${params}`);

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `司机台账_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        message.success('导出成功');
      } else {
        message.error('导出失败');
      }
    } catch {
      message.error('导出失败');
    }
  };

  const columns: ColumnsType<LedgerRecord> = [
    {
      title: t('ledgers.recordNo'),
      dataIndex: 'recordNo',
      key: 'recordNo',
      width: 200,
      fixed: 'left',
      ellipsis: true,
    },
    {
      title: t('ledgers.recordType'),
      dataIndex: 'type',
      key: 'type',
      width: 130,
      render: (type) => (
        <Tag color={type === 'collection' ? 'blue' : 'green'}>
          {type === 'collection' ? t('ledgers.collectionRecords') : t('ledgers.transferRecords')}
        </Tag>
      ),
    },
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      width: 120,
      render: (v) => dayjs(v).format('YYYY-MM-DD'),
    },
    {
      title: t('ledgers.loadingTime'),
      dataIndex: 'loadingTime',
      key: 'loadingTime',
      width: 90,
      render: (v) => dayjs(v).format('HH:mm'),
    },
    {
      title: t('ledgers.unloadingTime'),
      dataIndex: 'unloadingTime',
      key: 'unloadingTime',
      width: 90,
      render: (v) => dayjs(v).format('HH:mm'),
    },
    {
      title: t('ledgers.driverName'),
      dataIndex: 'driverName',
      key: 'driverName',
      width: 110,
      ellipsis: true,
    },
    {
      title: t('ledgers.driverPhone'),
      dataIndex: 'driverPhone',
      key: 'driverPhone',
      width: 140,
    },
    {
      title: t('vehicles.plateNumber'),
      dataIndex: 'vehiclePlate',
      key: 'vehiclePlate',
      width: 120,
    },
    {
      title: t('ledgers.store') + '/' + t('ledgers.destination'),
      key: 'location',
      width: 200,
      ellipsis: true,
      render: (_, record) => record.storeName || record.destination || '-',
    },
    {
      title: t('ledgers.tireCount'),
      dataIndex: 'tireCount',
      key: 'tireCount',
      width: 110,
      align: 'right',
    },
    {
      title: `${t('ledgers.unloadingNetWeight')}(kg)`,
      dataIndex: 'weight',
      key: 'weight',
      width: 140,
      align: 'right',
      render: (v) => Math.round(v).toLocaleString(),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        <IdcardOutlined style={{ marginRight: 8 }} />
        {t('ledgers.driverTitle')}
      </Title>

      <Card variant="borderless" style={{ marginBottom: 16 }}>
        <Space style={{ marginBottom: 16 }} wrap size="middle">
          <Select
            placeholder={t('ledgers.collectionPoint')}
            value={selectedCp || undefined}
            onChange={setSelectedCp}
            style={{ width: 160 }}
            allowClear
            options={collectionPoints.map((cp) => ({
              value: cp.id,
              label: cp.name,
            }))}
          />
          <Select
            placeholder={t('ledgers.selectDriver')}
            value={selectedDriver || undefined}
            onChange={setSelectedDriver}
            style={{ width: 200 }}
            allowClear
            showSearch
            optionFilterProp="label"
            options={[
              { value: '', label: t('ledgers.allDrivers') },
              ...drivers.map((d) => ({
                value: d.vehicleId,
                label: `${d.name} (${d.phone})`,
              })),
            ]}
          />
          <Select
            placeholder={t('ledgers.recordType')}
            value={recordType}
            onChange={setRecordType}
            style={{ width: 140 }}
            options={[
              { value: 'all', label: t('ledgers.allRecords') },
              { value: 'collection', label: t('ledgers.collectionRecords') },
              { value: 'transfer', label: t('ledgers.transferRecords') },
            ]}
          />
          <RangePicker
            value={dateRange}
            onChange={(dates) => setDateRange(dates as [dayjs.Dayjs | null, dayjs.Dayjs | null])}
            placeholder={[t('ledgers.dateRange'), '']}
          />
          <Button icon={<ReloadOutlined />} onClick={() => fetchData()}>
            {t('common.refresh')}
          </Button>
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport}>
            {t('ledgers.exportDriverLedger')}
          </Button>
        </Space>

        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title={t('ledgers.totalTrips')}
                value={summary.totalTrips}
                prefix={<CarOutlined />}
                suffix="趟"
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title={t('ledgers.totalWeight')}
                value={summary.totalWeight}
                precision={2}
                prefix={<ScissorOutlined />}
                suffix="t"
              />
            </Card>
          </Col>
        </Row>

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
            pageSizeOptions: ['10', '20', '50', '100'],
            onChange: (page, pageSize) => {
              setPage(page);
              setPageSize(pageSize);
            },
          }}
        />
      </Card>
    </div>
  );
}

