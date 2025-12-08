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
  DownloadOutlined,
  CarOutlined,
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

interface PreviewVehicle {
  key: string;
  plateNumber: string;
  type: 'COLLECTION' | 'TRANSFER';
  brand: string;
  model: string;
  tareWeight: number;  // 吨
  tareWeightVariance: number;  // 吨
  maxLoad: number;  // 吨
  driverName: string;
  driverPhone: string;
  isValid: boolean;
  errorMsg?: string;
}

interface ImportResult {
  success: number;
  failed: number;
  skipped: number;
  errors: string[];
}

// 生成 CSV 模板内容
const generateTemplateCSV = (): string => {
  const headers = [
    '车牌号',
    '车辆类型',
    '品牌',
    '型号',
    '皮重(吨)',
    '皮重微调(吨)',
    '最大载重(吨)',
    '司机姓名',
    '司机电话',
  ];
  
  const exampleData = [
    ['粤A12345', '收集车辆', '五菱', '小货车', '2.5', '0.05', '4.0', '张三', '13800138000'],
    ['粤B67890', '转移车辆', '东风', '半挂车', '15.0', '0.1', '33.0', '李四', '13900139000'],
  ];
  
  const csvContent = [
    headers.join(','),
    ...exampleData.map(row => row.join(','))
  ].join('\n');
  
  return csvContent;
};

// 下载 CSV 模板
const downloadTemplate = () => {
  const content = generateTemplateCSV();
  const BOM = '\uFEFF';  // UTF-8 BOM
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'vehicle_import_template.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export default function VehicleImportPage() {
  const t = useTranslations();
  const { message } = App.useApp();
  const [currentStep, setCurrentStep] = useState(0);
  const [collectionPoints, setCollectionPoints] = useState<CollectionPoint[]>([]);
  const [selectedCollectionPoint, setSelectedCollectionPoint] = useState<string>('');
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [previewData, setPreviewData] = useState<PreviewVehicle[]>([]);
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

  // 解析 CSV 文件
  const parseCSV = (text: string): PreviewVehicle[] => {
    const lines = text.split('\n');
    const vehicles: PreviewVehicle[] = [];
    
    // 找到表头行（包含"车牌号"的行）
    let headerIndex = -1;
    let headers: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.includes('车牌号')) {
        headerIndex = i;
        headers = line.split(',');
        break;
      }
    }
    
    if (headerIndex === -1) {
      message.error(t('vehicleImport.invalidFormat'));
      return [];
    }

    // 定义字段映射
    const fieldMap: Record<string, string> = {
      '车牌号': 'plateNumber',
      '车辆类型': 'type',
      '品牌': 'brand',
      '型号': 'model',
      '皮重(吨)': 'tareWeight',
      '皮重微调(吨)': 'tareWeightVariance',
      '最大载重(吨)': 'maxLoad',
      '司机姓名': 'driverName',
      '司机电话': 'driverPhone',
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
      
      const values = line.split(',');
      
      const plateNumber = values[fieldIndexMap['plateNumber']]?.trim() || '';
      if (!plateNumber) continue;

      const typeStr = values[fieldIndexMap['type']]?.trim() || '';
      const type: 'COLLECTION' | 'TRANSFER' = typeStr.includes('转移') || typeStr.includes('TRANSFER') ? 'TRANSFER' : 'COLLECTION';
      
      const brand = values[fieldIndexMap['brand']]?.trim() || '';
      const model = values[fieldIndexMap['model']]?.trim() || '';
      
      const tareWeightStr = values[fieldIndexMap['tareWeight']]?.trim() || '';
      const tareWeightVarianceStr = values[fieldIndexMap['tareWeightVariance']]?.trim() || '';
      const maxLoadStr = values[fieldIndexMap['maxLoad']]?.trim() || '';
      
      const tareWeight = parseFloat(tareWeightStr) || (type === 'COLLECTION' ? 2.5 : 15.0);
      const tareWeightVariance = parseFloat(tareWeightVarianceStr) || 0.05;
      const maxLoad = parseFloat(maxLoadStr) || (type === 'COLLECTION' ? 4.0 : 33.0);
      
      const driverName = values[fieldIndexMap['driverName']]?.trim() || '';
      const driverPhone = values[fieldIndexMap['driverPhone']]?.trim() || '';

      // 验证数据
      const isValid = !!plateNumber && tareWeight > 0 && maxLoad > 0;
      let errorMsg: string | undefined;
      if (!plateNumber) {
        errorMsg = t('vehicleImport.errorNoPlateNumber');
      } else if (tareWeight <= 0) {
        errorMsg = t('vehicleImport.errorInvalidTareWeight');
      } else if (maxLoad <= 0) {
        errorMsg = t('vehicleImport.errorInvalidMaxLoad');
      }

      vehicles.push({
        key: `${i}-${plateNumber}`,
        plateNumber,
        type,
        brand,
        model,
        tareWeight,
        tareWeightVariance,
        maxLoad,
        driverName,
        driverPhone,
        isValid,
        errorMsg,
      });
    }

    return vehicles;
  };

  // 文件上传前处理
  const handleBeforeUpload = (file: RcFile) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const vehicles = parseCSV(text);
      setPreviewData(vehicles);
      if (vehicles.length > 0) {
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
      message.error(t('vehicleImport.selectCollectionPoint'));
      return;
    }

    setImporting(true);
    try {
      const validVehicles = previewData.filter(v => v.isValid);
      
      const response = await fetch('/api/vehicles/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionPointId: selectedCollectionPoint,
          vehicles: validVehicles.map(v => ({
            plateNumber: v.plateNumber,
            type: v.type,
            brand: v.brand || null,
            model: v.model || null,
            tareWeight: v.tareWeight * 1000,  // 转为 kg
            tareWeightVariance: v.tareWeightVariance * 1000,  // 转为 kg
            maxLoad: v.maxLoad * 1000,  // 转为 kg
            driverName: v.driverName || null,
            driverPhone: v.driverPhone || null,
          })),
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setImportResult(result);
        setCurrentStep(2);
        message.success(t('vehicleImport.importSuccess', { count: result.success }));
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
  const columns: ColumnsType<PreviewVehicle> = [
    {
      title: t('vehicles.plateNumber'),
      dataIndex: 'plateNumber',
      key: 'plateNumber',
      width: 120,
      fixed: 'left',
    },
    {
      title: t('vehicles.type'),
      dataIndex: 'type',
      key: 'type',
      width: 150,
      render: (type) => (
        <Tag color={type === 'COLLECTION' ? 'blue' : 'green'}>
          {type === 'COLLECTION'
            ? t('vehicles.typeCollection')
            : t('vehicles.typeTransfer')}
        </Tag>
      ),
    },
    {
      title: t('vehicles.brand'),
      dataIndex: 'brand',
      key: 'brand',
      width: 100,
      render: (v) => v || '-',
    },
    {
      title: t('vehicles.model'),
      dataIndex: 'model',
      key: 'model',
      width: 100,
      render: (v) => v || '-',
    },
    {
      title: t('vehicles.tareWeight'),
      dataIndex: 'tareWeight',
      key: 'tareWeight',
      width: 100,
      render: (v) => `${v.toFixed(2)} t`,
    },
    {
      title: t('vehicles.tareWeightVariance'),
      dataIndex: 'tareWeightVariance',
      key: 'tareWeightVariance',
      width: 120,
      render: (v) => `${v.toFixed(2)} t`,
    },
    {
      title: t('vehicles.maxLoad'),
      dataIndex: 'maxLoad',
      key: 'maxLoad',
      width: 120,
      render: (v) => `${v.toFixed(2)} t`,
    },
    {
      title: t('vehicles.driverName'),
      dataIndex: 'driverName',
      key: 'driverName',
      width: 100,
      render: (v) => v || '-',
    },
    {
      title: t('vehicles.driverPhone'),
      dataIndex: 'driverPhone',
      key: 'driverPhone',
      width: 130,
      render: (v) => v || '-',
    },
    {
      title: t('common.status'),
      dataIndex: 'isValid',
      key: 'isValid',
      width: 100,
      fixed: 'right',
      render: (isValid, record) => (
        isValid ? (
          <Tag color="success">{t('vehicleImport.valid')}</Tag>
        ) : (
          <Tag color="error">{record.errorMsg}</Tag>
        )
      ),
    },
  ];

  const validCount = previewData.filter(v => v.isValid).length;
  const invalidCount = previewData.length - validCount;

  const steps = [
    {
      title: t('vehicleImport.step1'),
      description: t('vehicleImport.step1Desc'),
    },
    {
      title: t('vehicleImport.step2'),
      description: t('vehicleImport.step2Desc'),
    },
    {
      title: t('vehicleImport.step3'),
      description: t('vehicleImport.step3Desc'),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        <CarOutlined style={{ marginRight: 8 }} />
        {t('vehicleImport.title')}
      </Title>

      <Card variant="borderless" style={{ marginBottom: 24 }}>
        <Steps current={currentStep} items={steps} style={{ marginBottom: 32 }} />

        {/* 步骤1：上传文件 */}
        {currentStep === 0 && (
          <div>
            <Alert
              message={t('vehicleImport.uploadTip')}
              description={t('vehicleImport.uploadTipDesc')}
              type="info"
              showIcon
              style={{ marginBottom: 24 }}
            />
            
            <Row gutter={24}>
              <Col span={12}>
                <div style={{ marginBottom: 16 }}>
                  <Text strong>{t('vehicleImport.selectCollectionPoint')}</Text>
                  <span style={{ color: 'red' }}> *</span>
                </div>
                <Select
                  placeholder={t('vehicleImport.selectCollectionPointPlaceholder')}
                  value={selectedCollectionPoint || undefined}
                  onChange={setSelectedCollectionPoint}
                  style={{ width: '100%', marginBottom: 24 }}
                  options={collectionPoints.map((cp) => ({
                    value: cp.id,
                    label: `${cp.name} (${cp.code})`,
                  }))}
                />
              </Col>
              <Col span={12}>
                <div style={{ marginBottom: 16 }}>
                  <Text strong>{t('vehicleImport.downloadTemplate')}</Text>
                </div>
                <Button 
                  icon={<DownloadOutlined />} 
                  onClick={downloadTemplate}
                  style={{ marginBottom: 24 }}
                >
                  {t('vehicleImport.downloadTemplateButton')}
                </Button>
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
                <FileExcelOutlined style={{ fontSize: 48, color: '#1890ff' }} />
              </p>
              <p className="ant-upload-text">{t('vehicleImport.uploadText')}</p>
              <p className="ant-upload-hint">{t('vehicleImport.uploadHint')}</p>
            </Dragger>
          </div>
        )}

        {/* 步骤2：预览数据 */}
        {currentStep === 1 && (
          <div>
            <Alert
              message={t('vehicleImport.previewTip', { total: previewData.length, valid: validCount, invalid: invalidCount })}
              type={invalidCount > 0 ? 'warning' : 'success'}
              showIcon
              style={{ marginBottom: 24 }}
            />

            <Descriptions bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label={t('vehicles.collectionPoint')}>
                {collectionPoints.find(cp => cp.id === selectedCollectionPoint)?.name || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('vehicleImport.totalRecords')}>
                {previewData.length}
              </Descriptions.Item>
              <Descriptions.Item label={t('vehicleImport.validRecords')}>
                <Text type="success">{validCount}</Text>
              </Descriptions.Item>
            </Descriptions>

            <Table
              columns={columns}
              dataSource={previewData}
              rowKey="key"
              scroll={{ x: 1400, y: 400 }}
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
                {t('vehicleImport.importButton', { count: validCount })}
              </Button>
            </Space>
          </div>
        )}

        {/* 步骤3：导入结果 */}
        {currentStep === 2 && importResult && (
          <div>
            <Result
              status="success"
              title={t('vehicleImport.importComplete')}
              subTitle={t('vehicleImport.importSummary', {
                success: importResult.success,
                skipped: importResult.skipped,
                failed: importResult.failed,
              })}
              extra={[
                <Button type="primary" key="again" onClick={handleReset}>
                  {t('vehicleImport.importAgain')}
                </Button>,
              ]}
            />

            <Row gutter={24} style={{ marginTop: 24 }}>
              <Col span={8}>
                <Card>
                  <Statistic
                    title={t('vehicleImport.successCount')}
                    value={importResult.success}
                    valueStyle={{ color: '#3f8600' }}
                    prefix={<CheckCircleOutlined />}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card>
                  <Statistic
                    title={t('vehicleImport.skippedCount')}
                    value={importResult.skipped}
                    valueStyle={{ color: '#faad14' }}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card>
                  <Statistic
                    title={t('vehicleImport.failedCount')}
                    value={importResult.failed}
                    valueStyle={{ color: '#cf1322' }}
                  />
                </Card>
              </Col>
            </Row>

            {importResult.errors.length > 0 && (
              <Alert
                message={t('vehicleImport.errorDetails')}
                description={
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {importResult.errors.slice(0, 10).map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                    {importResult.errors.length > 10 && (
                      <li>... {t('vehicleImport.moreErrors', { count: importResult.errors.length - 10 })}</li>
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
