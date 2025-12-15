'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Button, Card, List, Typography, Empty, Spin, Input } from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  DoubleLeftOutlined,
  DoubleRightOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';

const { Text } = Typography;

interface CollectionPoint {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
}

interface CollectionPointTransferProps {
  value?: string[];
  onChange?: (value: string[]) => void;
  maxCount?: number;
  disabled?: boolean;
}

export default function CollectionPointTransfer({
  value = [],
  onChange,
  maxCount = 5,
  disabled = false,
}: CollectionPointTransferProps) {
  const t = useTranslations();
  const [allPoints, setAllPoints] = useState<CollectionPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [leftSearch, setLeftSearch] = useState('');
  const [rightSearch, setRightSearch] = useState('');
  const [selectedLeft, setSelectedLeft] = useState<string[]>([]);
  const [selectedRight, setSelectedRight] = useState<string[]>([]);

  // 获取所有收集点
  useEffect(() => {
    const fetchAllPoints = async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/collection-points/all');
        const data = await response.json();
        if (response.ok) {
          setAllPoints(data.data || []);
        }
      } catch (error) {
        console.error('Failed to fetch collection points:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAllPoints();
  }, []);

  // 未分配的收集点（左侧）
  const availablePoints = useMemo(() => {
    return allPoints.filter(
      (point) =>
        !value.includes(point.id) &&
        point.status === 'ACTIVE' &&
        (leftSearch === '' ||
          point.name.toLowerCase().includes(leftSearch.toLowerCase()) ||
          point.code.toLowerCase().includes(leftSearch.toLowerCase()))
    );
  }, [allPoints, value, leftSearch]);

  // 已分配的收集点（右侧）
  const assignedPoints = useMemo(() => {
    return allPoints.filter(
      (point) =>
        value.includes(point.id) &&
        (rightSearch === '' ||
          point.name.toLowerCase().includes(rightSearch.toLowerCase()) ||
          point.code.toLowerCase().includes(rightSearch.toLowerCase()))
    );
  }, [allPoints, value, rightSearch]);

  // 移动到右侧
  const moveToRight = () => {
    if (disabled) return;
    const newValue = [...value];
    const canAddCount = maxCount - newValue.length;
    const toAdd = selectedLeft.slice(0, canAddCount);
    toAdd.forEach((id) => {
      if (!newValue.includes(id)) {
        newValue.push(id);
      }
    });
    onChange?.(newValue);
    setSelectedLeft([]);
  };

  // 移动到左侧
  const moveToLeft = () => {
    if (disabled) return;
    const newValue = value.filter((id) => !selectedRight.includes(id));
    onChange?.(newValue);
    setSelectedRight([]);
  };

  // 全部移动到右侧
  const moveAllToRight = () => {
    if (disabled) return;
    const canAddCount = maxCount - value.length;
    const toAdd = availablePoints.slice(0, canAddCount).map((p) => p.id);
    onChange?.([...value, ...toAdd]);
  };

  // 全部移动到左侧
  const moveAllToLeft = () => {
    if (disabled) return;
    onChange?.([]);
  };

  // 切换选中状态
  const toggleLeftSelection = (id: string) => {
    if (disabled) return;
    setSelectedLeft((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleRightSelection = (id: string) => {
    if (disabled) return;
    setSelectedRight((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const renderListItem = (
    point: CollectionPoint,
    isSelected: boolean,
    onToggle: () => void
  ) => (
    <List.Item
      onClick={onToggle}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        backgroundColor: isSelected ? '#e6f4ff' : 'transparent',
        padding: '8px 12px',
        borderRadius: 4,
        marginBottom: 4,
        transition: 'background-color 0.2s',
      }}
      onMouseEnter={(e) => {
        if (!disabled && !isSelected) {
          e.currentTarget.style.backgroundColor = '#f5f5f5';
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = 'transparent';
        }
      }}
    >
      <div style={{ width: '100%' }}>
        <Text strong>{point.name}</Text>
        <br />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {point.code}
        </Text>
      </div>
    </List.Item>
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spin />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
      {/* 左侧：可用收集点 */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{t('users.availableCollectionPoints')}</span>
            <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>
              {availablePoints.length} {t('common.items')}
            </Text>
          </div>
        }
        size="small"
        style={{ flex: 1, minWidth: 200 }}
        styles={{ body: { padding: 8, height: 280, overflow: 'auto' } }}
      >
        <Input
          placeholder={t('common.search')}
          prefix={<SearchOutlined />}
          size="small"
          value={leftSearch}
          onChange={(e) => setLeftSearch(e.target.value)}
          style={{ marginBottom: 8 }}
          allowClear
        />
        {availablePoints.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('common.noData')}
            style={{ marginTop: 40 }}
          />
        ) : (
          <List
            dataSource={availablePoints}
            renderItem={(point) =>
              renderListItem(
                point,
                selectedLeft.includes(point.id),
                () => toggleLeftSelection(point.id)
              )
            }
            split={false}
          />
        )}
      </Card>

      {/* 中间：操作按钮 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <Button
          icon={<DoubleRightOutlined />}
          size="small"
          onClick={moveAllToRight}
          disabled={disabled || availablePoints.length === 0 || value.length >= maxCount}
        />
        <Button
          icon={<RightOutlined />}
          size="small"
          onClick={moveToRight}
          disabled={disabled || selectedLeft.length === 0 || value.length >= maxCount}
        />
        <Button
          icon={<LeftOutlined />}
          size="small"
          onClick={moveToLeft}
          disabled={disabled || selectedRight.length === 0}
        />
        <Button
          icon={<DoubleLeftOutlined />}
          size="small"
          onClick={moveAllToLeft}
          disabled={disabled || value.length === 0}
        />
      </div>

      {/* 右侧：已分配收集点 */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{t('users.assignedCollectionPoints')}</span>
            <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>
              {value.length}/{maxCount}
            </Text>
          </div>
        }
        size="small"
        style={{ flex: 1, minWidth: 200 }}
        styles={{ body: { padding: 8, height: 280, overflow: 'auto' } }}
      >
        <Input
          placeholder={t('common.search')}
          prefix={<SearchOutlined />}
          size="small"
          value={rightSearch}
          onChange={(e) => setRightSearch(e.target.value)}
          style={{ marginBottom: 8 }}
          allowClear
        />
        {assignedPoints.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('common.noData')}
            style={{ marginTop: 40 }}
          />
        ) : (
          <List
            dataSource={assignedPoints}
            renderItem={(point) =>
              renderListItem(
                point,
                selectedRight.includes(point.id),
                () => toggleRightSelection(point.id)
              )
            }
            split={false}
          />
        )}
      </Card>
    </div>
  );
}
