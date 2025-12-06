'use client';

import React from 'react';
import { Card, Typography, Empty, Button } from 'antd';
import { FileTextOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';

const { Title, Text } = Typography;

export default function LedgersPage() {
  const t = useTranslations();

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        <FileTextOutlined style={{ marginRight: 8 }} />
        {t('ledgers.title')}
      </Title>

      <Card variant="borderless">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Text type="secondary">
              台账生成功能将在 Phase 3 实现
            </Text>
          }
        >
          <Button type="primary" icon={<PlusOutlined />} disabled>
            {t('ledgers.createTask')}
          </Button>
        </Empty>
      </Card>
    </div>
  );
}

