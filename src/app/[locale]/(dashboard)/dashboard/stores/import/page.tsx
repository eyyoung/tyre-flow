"use client";

import React, { useState } from "react";
import {
  Card,
  Table,
  Button,
  Space,
  Typography,
  Upload,
  Steps,
  Result,
  Alert,
  Tag,
  App,
  Descriptions,
  Statistic,
  Row,
  Col,
} from "antd";
import {
  FileExcelOutlined,
  CheckCircleOutlined,
  ImportOutlined,
  ArrowLeftOutlined,
} from "@ant-design/icons";
import { useTranslations } from "next-intl";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile, RcFile } from "antd/es/upload/interface";
import { useCollectionPoint } from "@/contexts/CollectionPointContext";

const { Title, Text } = Typography;
const { Dragger } = Upload;

interface PreviewStore {
  key: string;
  name: string;
  businessStatus: string; // 经营状态：开业/停业/注销等
  category: string; // 来源分类：机动车回收拆解等
  legalPerson: string;
  phone: string;
  businessLicense: string;
  address: string;
  province: string;
  city: string;
  district: string;
  longitude: number | null;
  latitude: number | null;
  estimatedTravelMinutes: number | null; // 预估行程（分钟）
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
  const { currentCollectionPoint } = useCollectionPoint();
  const [currentStep, setCurrentStep] = useState(0);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [previewData, setPreviewData] = useState<PreviewStore[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // 清理企业名称：移除括号内的内容（支持中英文括号）
  const cleanCompanyName = (name: string): string => {
    if (!name) return "";
    return name
      .replace(/（[^）]*）/g, "") // 中文括号
      .replace(/\([^)]*\)/g, "") // 英文括号
      .trim();
  };

  // 轮胎回收相关关键词（白名单）
  const TIRE_RELATED_KEYWORDS = [
    "轮胎",
    "补胎",
    "汽车",
    "汽修",
    "汽车修理",
    "汽车服务",
    "汽车配件",
    "汽配",
    "汽贸",
    "车胎",
    "换胎",
    "修车",
    "洗车",
    "胎",
  ];

  // 排除关键词（黑名单）- 虽然包含白名单关键词但与轮胎回收无关
  const BLACKLIST_KEYWORDS = [
    "汽车租赁",
    "汽车金融",
    "汽车保险",
    "车行",
  ];

  // 检查企业名称是否包含轮胎回收相关关键词（排除黑名单）
  const isTireRelated = (name: string): boolean => {
    if (!name) return false;
    // 先检查黑名单
    if (BLACKLIST_KEYWORDS.some((keyword) => name.includes(keyword))) {
      return false;
    }
    // 再检查白名单
    return TIRE_RELATED_KEYWORDS.some((keyword) => name.includes(keyword));
  };

  // 解析CSV行（正确处理引号内的逗号）
  const parseCSVLine = (line: string): string[] => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // 双引号转义：两个连续双引号表示一个双引号
          current += '"';
          i++; // 跳过下一个引号
        } else {
          // 切换引号状态
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        // 字段分隔符（不在引号内）
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    // 添加最后一个字段
    values.push(current.trim());

    return values;
  };

  // 解析CSV文件
  const parseCSV = (text: string): PreviewStore[] => {
    const lines = text.split("\n");
    const stores: PreviewStore[] = [];

    // 找到表头行（包含"企业名称"的行）
    let headerIndex = -1;
    let headers: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.includes("企业名称")) {
        headerIndex = i;
        headers = parseCSVLine(line);
        break;
      }
    }

    if (headerIndex === -1) {
      message.error(t("storeImport.invalidFormat"));
      return [];
    }

    // 定义字段映射
    const fieldMap: Record<string, string> = {
      企业名称: "name",
      经营状态: "businessStatus", // 爱企查格式：开业/停业/注销等
      来源分类: "category", // stores.csv 格式：机动车回收拆解等（非经营状态）
      法定代表人: "legalPerson",
      电话: "phone",
      统一社会信用代码: "businessLicense",
      注册地址: "address",
      所属省份: "province",
      所属城市: "city",
      所属区县: "district",
      经度: "longitude",
      纬度: "latitude",
      预估行程: "estimatedTravelMinutes", // 预估行程（分钟）
      "预估行程(分钟)": "estimatedTravelMinutes", // 兼容导出格式
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
    let filteredByLength = 0;
    let filteredByKeyword = 0;
    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // 使用正确的CSV解析（处理引号内的逗号）
      const values = parseCSVLine(line);

      const rawName = values[fieldIndexMap["name"]]?.trim() || "";
      if (!rawName) continue;

      // 清理企业名称（移除括号内容）
      const name = cleanCompanyName(rawName);

      // 过滤掉名称长度 <= 5 的记录
      if (name.length <= 5) {
        filteredByLength++;
        continue;
      }

      // 过滤掉不包含轮胎回收相关关键词的记录
      if (!isTireRelated(name)) {
        filteredByKeyword++;
        continue;
      }

      const businessStatus =
        values[fieldIndexMap["businessStatus"]]?.trim() || ""; // 经营状态
      const category = values[fieldIndexMap["category"]]?.trim() || ""; // 来源分类
      const legalPerson = values[fieldIndexMap["legalPerson"]]?.trim() || "";
      const phone = values[fieldIndexMap["phone"]]?.trim() || "";
      const businessLicense =
        values[fieldIndexMap["businessLicense"]]?.trim() || "";
      const address = values[fieldIndexMap["address"]]?.trim() || "";
      const province = values[fieldIndexMap["province"]]?.trim() || "";
      const city = values[fieldIndexMap["city"]]?.trim() || "";
      const district = values[fieldIndexMap["district"]]?.trim() || "";

      // 解析经纬度
      const longitudeStr = values[fieldIndexMap["longitude"]]?.trim() || "";
      const latitudeStr = values[fieldIndexMap["latitude"]]?.trim() || "";
      const longitude = longitudeStr ? parseFloat(longitudeStr) : null;
      const latitude = latitudeStr ? parseFloat(latitudeStr) : null;

      // 解析预估行程
      const estimatedTravelStr =
        values[fieldIndexMap["estimatedTravelMinutes"]]?.trim() || "";
      const estimatedTravelMinutes = estimatedTravelStr
        ? parseInt(estimatedTravelStr, 10)
        : null;

      // 验证数据
      const isValid = !!name && !!address;
      const errorMsg = !name
        ? t("storeImport.errorNoName")
        : !address
        ? t("storeImport.errorNoAddress")
        : undefined;

      stores.push({
        key: `${i}-${name}`,
        name,
        businessStatus,
        category,
        legalPerson,
        phone,
        businessLicense,
        address,
        province,
        city,
        district,
        longitude: longitude && !isNaN(longitude) ? longitude : null,
        latitude: latitude && !isNaN(latitude) ? latitude : null,
        estimatedTravelMinutes:
          estimatedTravelMinutes && !isNaN(estimatedTravelMinutes)
            ? estimatedTravelMinutes
            : null,
        isValid,
        errorMsg,
      });
    }

    // 显示过滤信息
    if (filteredByLength > 0 || filteredByKeyword > 0) {
      message.info(
        t("storeImport.filteredSummary", {
          lengthCount: filteredByLength,
          keywordCount: filteredByKeyword,
        })
      );
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
    reader.readAsText(file, "UTF-8");

    setFileList([file]);
    return false; // 阻止自动上传
  };

  // 执行导入
  const handleImport = async () => {
    if (!currentCollectionPoint) {
      message.error(t("ledgers.selectCollectionPointRequired"));
      return;
    }

    setImporting(true);
    try {
      const validStores = previewData.filter((s) => s.isValid);

      const response = await fetch("/api/stores/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionPointId: currentCollectionPoint.id,
          stores: validStores.map((s) => ({
            name: s.name,
            businessStatus: s.businessStatus,
            legalPerson: s.legalPerson || null,
            contactPhone: s.phone || null,
            businessLicense: s.businessLicense || null,
            address: s.address,
            province: s.province || null,
            city: s.city || null,
            district: s.district || null,
            longitude: s.longitude,
            latitude: s.latitude,
            estimatedTravelMinutes: s.estimatedTravelMinutes,
          })),
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setImportResult(result);
        setCurrentStep(2);
        message.success(
          t("storeImport.importSuccess", { count: result.success })
        );
      } else {
        message.error(result.message || t("common.error"));
      }
    } catch {
      message.error(t("common.error"));
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
  };

  // 预览表格列
  const columns: ColumnsType<PreviewStore> = [
    {
      title: t("stores.name"),
      dataIndex: "name",
      key: "name",
      width: 200,
      ellipsis: true,
    },
    {
      title: t("storeImport.businessStatus"),
      dataIndex: "businessStatus",
      key: "businessStatus",
      width: 80,
      render: (v) => {
        if (!v) return <Text type="secondary">-</Text>;
        const color =
          v === "开业"
            ? "success"
            : v === "停业" || v === "注销" || v === "吊销"
            ? "error"
            : "default";
        return <Tag color={color}>{v}</Tag>;
      },
    },
    {
      title: t("storeImport.category"),
      dataIndex: "category",
      key: "category",
      width: 120,
      ellipsis: true,
      render: (v) => v || "-",
    },
    {
      title: t("stores.legalPerson"),
      dataIndex: "legalPerson",
      key: "legalPerson",
      width: 100,
      render: (v) => v || "-",
    },
    {
      title: t("stores.contactPhone"),
      dataIndex: "phone",
      key: "phone",
      width: 130,
      render: (v) => v || "-",
    },
    {
      title: t("stores.businessLicense"),
      dataIndex: "businessLicense",
      key: "businessLicense",
      width: 180,
      ellipsis: true,
      render: (v) => v || "-",
    },
    {
      title: t("stores.address"),
      dataIndex: "address",
      key: "address",
      width: 250,
      ellipsis: true,
    },
    {
      title: t("stores.province"),
      dataIndex: "province",
      key: "province",
      width: 80,
    },
    {
      title: t("stores.city"),
      dataIndex: "city",
      key: "city",
      width: 80,
    },
    {
      title: t("stores.district"),
      dataIndex: "district",
      key: "district",
      width: 80,
    },
    {
      title: t("storeCleanup.coordinates"),
      key: "coordinates",
      width: 180,
      render: (_, record) =>
        record.longitude && record.latitude ? (
          <Text type="success">
            {record.longitude.toFixed(6)}, {record.latitude.toFixed(6)}
          </Text>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: t("stores.estimatedTravelMinutes"),
      dataIndex: "estimatedTravelMinutes",
      key: "estimatedTravelMinutes",
      width: 100,
      render: (v) => (v !== null ? `${v} ${t("storeCleanup.minutes")}` : "-"),
    },
    {
      title: t("common.status"),
      dataIndex: "isValid",
      key: "isValid",
      width: 100,
      fixed: "right",
      render: (isValid, record) =>
        isValid ? (
          <Tag color="success">{t("storeImport.valid")}</Tag>
        ) : (
          <Tag color="error">{record.errorMsg}</Tag>
        ),
    },
  ];

  const validCount = previewData.filter((s) => s.isValid).length;
  const invalidCount = previewData.length - validCount;

  const steps = [
    {
      title: t("storeImport.step1"),
      description: t("storeImport.step1Desc"),
    },
    {
      title: t("storeImport.step2"),
      description: t("storeImport.step2Desc"),
    },
    {
      title: t("storeImport.step3"),
      description: t("storeImport.step3Desc"),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        <ImportOutlined style={{ marginRight: 8 }} />
        {t("storeImport.title")}
      </Title>

      <Card variant="borderless" style={{ marginBottom: 24 }}>
        <Steps
          current={currentStep}
          items={steps}
          style={{ marginBottom: 32 }}
        />

        {/* 步骤1：上传文件 */}
        {currentStep === 0 && (
          <div>
            <Alert
              message={t("storeImport.uploadTip")}
              description={t("storeImport.uploadTipDesc")}
              type="info"
              showIcon
              style={{ marginBottom: 24 }}
            />

            <Dragger
              accept=".csv"
              fileList={fileList}
              beforeUpload={handleBeforeUpload}
              onRemove={() => {
                setFileList([]);
                setPreviewData([]);
              }}
              maxCount={1}
              disabled={!currentCollectionPoint}
            >
              <p className="ant-upload-drag-icon">
                <FileExcelOutlined style={{ fontSize: 48, color: "#52c41a" }} />
              </p>
              <p className="ant-upload-text">{t("storeImport.uploadText")}</p>
              <p className="ant-upload-hint">{t("storeImport.uploadHint")}</p>
            </Dragger>
          </div>
        )}

        {/* 步骤2：预览数据 */}
        {currentStep === 1 && (
          <div>
            <Alert
              message={t("storeImport.previewTip", {
                total: previewData.length,
                valid: validCount,
                invalid: invalidCount,
              })}
              type={invalidCount > 0 ? "warning" : "success"}
              showIcon
              style={{ marginBottom: 24 }}
            />

            <Descriptions bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label={t("stores.collectionPoint")}>
                {currentCollectionPoint?.name || "-"}
              </Descriptions.Item>
              <Descriptions.Item label={t("storeImport.totalRecords")}>
                {previewData.length}
              </Descriptions.Item>
              <Descriptions.Item label={t("storeImport.validRecords")}>
                <Text type="success">{validCount}</Text>
              </Descriptions.Item>
            </Descriptions>

            <Table
              columns={columns}
              dataSource={previewData}
              rowKey="key"
              scroll={{ x: 1920, y: 400 }}
              pagination={{
                pageSize: 50,
                showTotal: (total) => t("common.total", { count: total }),
              }}
              size="small"
            />

            <Space style={{ marginTop: 24 }}>
              <Button icon={<ArrowLeftOutlined />} onClick={handleReset}>
                {t("common.back")}
              </Button>
              <Button
                type="primary"
                icon={<ImportOutlined />}
                onClick={handleImport}
                loading={importing}
                disabled={validCount === 0}
              >
                {t("storeImport.importButton", { count: validCount })}
              </Button>
            </Space>
          </div>
        )}

        {/* 步骤3：导入结果 */}
        {currentStep === 2 && importResult && (
          <div>
            <Result
              status="success"
              title={t("storeImport.importComplete")}
              subTitle={t("storeImport.importSummary", {
                success: importResult.success,
                skipped: importResult.skipped,
                failed: importResult.failed,
              })}
              extra={[
                <Button type="primary" key="again" onClick={handleReset}>
                  {t("storeImport.importAgain")}
                </Button>,
              ]}
            />

            <Row gutter={24} style={{ marginTop: 24 }}>
              <Col span={8}>
                <Card>
                  <Statistic
                    title={t("storeImport.successCount")}
                    value={importResult.success}
                    valueStyle={{ color: "#3f8600" }}
                    prefix={<CheckCircleOutlined />}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card>
                  <Statistic
                    title={t("storeImport.skippedCount")}
                    value={importResult.skipped}
                    valueStyle={{ color: "#faad14" }}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card>
                  <Statistic
                    title={t("storeImport.failedCount")}
                    value={importResult.failed}
                    valueStyle={{ color: "#cf1322" }}
                  />
                </Card>
              </Col>
            </Row>

            {importResult.errors.length > 0 && (
              <Alert
                message={t("storeImport.errorDetails")}
                description={
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {importResult.errors.slice(0, 10).map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                    {importResult.errors.length > 10 && (
                      <li>
                        ...{" "}
                        {t("storeImport.moreErrors", {
                          count: importResult.errors.length - 10,
                        })}
                      </li>
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
