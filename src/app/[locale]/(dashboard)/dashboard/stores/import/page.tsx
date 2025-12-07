'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Typography,
  Upload,
  Select,
  Steps,
  Result,
  Alert,
  Tag,
  App,
  Descriptions,
  Statistic,
  Row,
  Col,
} from 'antd';
import {
  UploadOutlined,
  FileExcelOutlined,
  CheckCircleOutlined,
  ImportOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile, RcFile } from 'antd/es/upload/interface';

const { Title, Text } = Typography;
const { Dragger } = Upload;

interface CollectionPoint {
  id: string;
  code: string;
  name: string;
}

interface PreviewStore {
  key: string;
  name: string;
  businessStatus: string;
  legalPerson: string;
  phone: string;
  businessLicense: string;
  address: string;
  province: string;
  city: string;
  district: string;
  isValid: boolean;
  errorMsg?: string;
}

interface ImportResult {
  success: number;
  failed: number;
  skipped: number;
  errors: string[];
}

export default function StoreImportPage() {
  const t = useTranslations();
  const { message } = App.useApp();
  const [currentStep, setCurrentStep] = useState(0);
  const [collectionPoints, setCollectionPoints] = useState<CollectionPoint[]>([]);
  const [selectedCollectionPoint, setSelectedCollectionPoint] = useState<string>('');
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [previewData, setPreviewData] = useState<PreviewStore[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

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

  // 解析CSV文件
  const parseCSV = (text: string): PreviewStore[] => {
    const lines = text.split('\n');
    const stores: PreviewStore[] = [];
    
    // 找到表头行（包含"企业名称"的行）
    let headerIndex = -1;
    let headers: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.includes('企业名称')) {
        headerIndex = i;
        headers = line.split(',');
        break;
      }
    }
    
    if (headerIndex === -1) {
      message.error(t('storeImport.invalidFormat'));
      return [];
    }

    // 定义字段映射
    const fieldMap: Record<string, string> = {
      '企业名称': 'name',
      '经营状态': 'businessStatus',
      '法定代表人': 'legalPerson',
      '电话': 'phone',
      '统一社会信用代码': 'businessLicense',
      '注册地址': 'address',
      '所属省份': 'province',
      '所属城市': 'city',
      '所属区县': 'district',
    };

    // 获取字段索引
    const fieldIndexMap: Record<string, number> = {};
    headers.forEach((header, index) => {
      const cleanHeader = header.trim();
      if (fieldMap[cleanHeader]) {
        fieldIndexMap[fieldMap[cleanHeader]] = index;
      }
    });

    // 解析数据行
    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // 简单CSV解析（不处理引号内的逗号）
      const values = line.split(',');
      
      const name = values[fieldIndexMap['name']]?.trim() || '';
      if (!name) continue;

      const businessStatus = values[fieldIndexMap['businessStatus']]?.trim() || '';
      const legalPerson = values[fieldIndexMap['legalPerson']]?.trim() || '';
      const phone = values[fieldIndexMap['phone']]?.trim() || '';
      const businessLicense = values[fieldIndexMap['businessLicense']]?.trim() || '';
      const address = values[fieldIndexMap['address']]?.trim() || '';
      const province = values[fieldIndexMap['province']]?.trim() || '';
      const city = values[fieldIndexMap['city']]?.trim() || '';
      const district = values[fieldIndexMap['district']]?.trim() || '';

      // 验证数据
      const isValid = !!name && !!address;
      const errorMsg = !name ? t('storeImport.errorNoName') : (!address ? t('storeImport.errorNoAddress') : undefined);

      stores.push({
        key: `${i}-${name}`,
        name,
        businessStatus,
        legalPerson,
        phone,
        businessLicense,
        address,
        province,
        city,
        district,
        isValid,
        errorMsg,
      });
    }

    return stores;
  };

  // 文件上传前处理
  const handleBeforeUpload = (file: RcFile) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const stores = parseCSV(text);
      setPreviewData(stores);
      if (stores.length > 0) {
        setCurrentStep(1);
      }
    };
    reader.readAsText(file, 'UTF-8');
    
    setFileList([file]);
    return false; // 阻止自动上传
  };

  // 执行导入
  const handleImport = async () => {
    if (!selectedCollectionPoint) {
      message.error(t('storeImport.selectCollectionPoint'));
      return;
    }

    setImporting(true);
    try {
      const validStores = previewData.filter(s => s.isValid);
      
      const response = await fetch('/api/stores/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionPointId: selectedCollectionPoint,
          stores: validStores.map(s => ({
            name: s.name,
            businessStatus: s.businessStatus,
            legalPerson: s.legalPerson || null,
            contactPhone: s.phone || null,
            businessLicense: s.businessLicense || null,
            address: s.address,
            province: s.province || null,
            city: s.city || null,
            district: s.district || null,
          })),
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setImportResult(result);
        setCurrentStep(2);
        message.success(t('storeImport.importSuccess', { count: result.success }));
      } else {
        message.error(result.message || t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    } finally {
      setImporting(false);
    }
  };

  // 重置
  const handleReset = () => {
    setCurrentStep(0);
    setFileList([]);
    setPreviewData([]);
    setImportResult(null);
    setSelectedCollectionPoint('');
  };

  // 预览表格列
  const columns: ColumnsType<PreviewStore> = [
    {
      title: t('stores.name'),
      dataIndex: 'name',
      key: 'name',
      width: 200,
      ellipsis: true,
    },
    {
      title: t('storeImport.businessStatus'),
      dataIndex: 'businessStatus',
      key: 'businessStatus',
      width: 80,
      render: (v) => (
        <Tag color={v === '开业' ? 'success' : 'default'}>{v || '-'}</Tag>
      ),
    },
    {
      title: t('stores.legalPerson'),
      dataIndex: 'legalPerson',
      key: 'legalPerson',
      width: 100,
      render: (v) => v || '-',
    },
    {
      title: t('stores.contactPhone'),
      dataIndex: 'phone',
      key: 'phone',
      width: 130,
      render: (v) => v || '-',
    },
    {
      title: t('stores.businessLicense'),
      dataIndex: 'businessLicense',
      key: 'businessLicense',
      width: 180,
      ellipsis: true,
      render: (v) => v || '-',
    },
    {
      title: t('stores.address'),
      dataIndex: 'address',
      key: 'address',
      width: 250,
      ellipsis: true,
    },
    {
      title: t('stores.province'),
      dataIndex: 'province',
      key: 'province',
      width: 80,
    },
    {
      title: t('stores.city'),
      dataIndex: 'city',
      key: 'city',
      width: 80,
    },
    {
      title: t('stores.district'),
      dataIndex: 'district',
      key: 'district',
      width: 80,
    },
    {
      title: t('common.status'),
      dataIndex: 'isValid',
      key: 'isValid',
      width: 100,
      fixed: 'right',
      render: (isValid, record) => (
        isValid ? (
          <Tag color="success">{t('storeImport.valid')}</Tag>
        ) : (
          <Tag color="error">{record.errorMsg}</Tag>
        )
      ),
    },
  ];

  const validCount = previewData.filter(s => s.isValid).length;
  const invalidCount = previewData.length - validCount;

  const steps = [
    {
      title: t('storeImport.step1'),
      description: t('storeImport.step1Desc'),
    },
    {
      title: t('storeImport.step2'),
      description: t('storeImport.step2Desc'),
    },
    {
      title: t('storeImport.step3'),
      description: t('storeImport.step3Desc'),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        <ImportOutlined style={{ marginRight: 8 }} />
        {t('storeImport.title')}
      </Title>

      <Card variant="borderless" style={{ marginBottom: 24 }}>
        <Steps current={currentStep} items={steps} style={{ marginBottom: 32 }} />

        {/* 步骤1：上传文件 */}
        {currentStep === 0 && (
          <div>
            <Alert
              message={t('storeImport.uploadTip')}
              description={t('storeImport.uploadTipDesc')}
              type="info"
              showIcon
              style={{ marginBottom: 24 }}
            />
            
            <Row gutter={24}>
              <Col span={12}>
                <div style={{ marginBottom: 16 }}>
                  <Text strong>{t('storeImport.selectCollectionPoint')}</Text>
                  <span style={{ color: 'red' }}> *</span>
                </div>
                <Select
                  placeholder={t('storeImport.selectCollectionPointPlaceholder')}
                  value={selectedCollectionPoint || undefined}
                  onChange={setSelectedCollectionPoint}
                  style={{ width: '100%', marginBottom: 24 }}
                  options={collectionPoints.map((cp) => ({
                    value: cp.id,
                    label: `${cp.name} (${cp.code})`,
                  }))}
                />
              </Col>
            </Row>

            <Dragger
              accept=".csv"
              fileList={fileList}
              beforeUpload={handleBeforeUpload}
              onRemove={() => {
                setFileList([]);
                setPreviewData([]);
              }}
              maxCount={1}
              disabled={!selectedCollectionPoint}
            >
              <p className="ant-upload-drag-icon">
                <FileExcelOutlined style={{ fontSize: 48, color: '#52c41a' }} />
              </p>
              <p className="ant-upload-text">{t('storeImport.uploadText')}</p>
              <p className="ant-upload-hint">{t('storeImport.uploadHint')}</p>
            </Dragger>
          </div>
        )}

        {/* 步骤2：预览数据 */}
        {currentStep === 1 && (
          <div>
            <Alert
              message={t('storeImport.previewTip', { total: previewData.length, valid: validCount, invalid: invalidCount })}
              type={invalidCount > 0 ? 'warning' : 'success'}
              showIcon
              style={{ marginBottom: 24 }}
            />

            <Descriptions bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label={t('stores.collectionPoint')}>
                {collectionPoints.find(cp => cp.id === selectedCollectionPoint)?.name || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('storeImport.totalRecords')}>
                {previewData.length}
              </Descriptions.Item>
              <Descriptions.Item label={t('storeImport.validRecords')}>
                <Text type="success">{validCount}</Text>
              </Descriptions.Item>
            </Descriptions>

            <Table
              columns={columns}
              dataSource={previewData}
              rowKey="key"
              scroll={{ x: 1600, y: 400 }}
              pagination={{
                pageSize: 50,
                showTotal: (total) => t('common.total', { count: total }),
              }}
              size="small"
            />

            <Space style={{ marginTop: 24 }}>
              <Button icon={<ArrowLeftOutlined />} onClick={handleReset}>
                {t('common.back')}
              </Button>
              <Button
                type="primary"
                icon={<ImportOutlined />}
                onClick={handleImport}
                loading={importing}
                disabled={validCount === 0}
              >
                {t('storeImport.importButton', { count: validCount })}
              </Button>
            </Space>
          </div>
        )}

        {/* 步骤3：导入结果 */}
        {currentStep === 2 && importResult && (
          <div>
            <Result
              status="success"
              title={t('storeImport.importComplete')}
              subTitle={t('storeImport.importSummary', {
                success: importResult.success,
                skipped: importResult.skipped,
                failed: importResult.failed,
              })}
              extra={[
                <Button type="primary" key="again" onClick={handleReset}>
                  {t('storeImport.importAgain')}
                </Button>,
              ]}
            />

            <Row gutter={24} style={{ marginTop: 24 }}>
              <Col span={8}>
                <Card>
                  <Statistic
                    title={t('storeImport.successCount')}
                    value={importResult.success}
                    valueStyle={{ color: '#3f8600' }}
                    prefix={<CheckCircleOutlined />}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card>
                  <Statistic
                    title={t('storeImport.skippedCount')}
                    value={importResult.skipped}
                    valueStyle={{ color: '#faad14' }}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card>
                  <Statistic
                    title={t('storeImport.failedCount')}
                    value={importResult.failed}
                    valueStyle={{ color: '#cf1322' }}
                  />
                </Card>
              </Col>
            </Row>

            {importResult.errors.length > 0 && (
              <Alert
                message={t('storeImport.errorDetails')}
                description={
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {importResult.errors.slice(0, 10).map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                    {importResult.errors.length > 10 && (
                      <li>... {t('storeImport.moreErrors', { count: importResult.errors.length - 10 })}</li>
                    )}
                  </ul>
                }
                type="warning"
                style={{ marginTop: 24 }}
              />
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

