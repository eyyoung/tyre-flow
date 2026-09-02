/**
 * ISCC 自我声明模板注册表
 *
 * 同时供服务端（生成器 / API）与客户端（导出弹窗）使用，因此不要在这里引入 Node 专属模块。
 * 模板文件位于 template/ 目录，占位符使用 docxtemplater 语法（{tag}）。
 */

export const ISCC_TEMPLATE_KEYS = ["PLUS_V1", "PLUS_V2", "EU_V2"] as const;
export type IsccTemplateKey = (typeof ISCC_TEMPLATE_KEYS)[number];

export interface IsccTemplateDefinition {
  /** template/ 目录下的文件名 */
  file: string;
  /** 下拉框显示名称 */
  label: string;
  /** 导出文件名前缀 */
  filePrefix: string;
}

export const ISCC_TEMPLATES: Record<IsccTemplateKey, IsccTemplateDefinition> = {
  PLUS_V1: {
    file: "ISCC.docx",
    label: "ISCC PLUS v1.2 (2024)",
    filePrefix: "ISCC",
  },
  PLUS_V2: {
    file: "ISCC_PLUS.docx",
    label: "ISCC PLUS v2.0 (2025)",
    filePrefix: "ISCC_PLUS",
  },
  EU_V2: {
    file: "ISCC_EU.docx",
    label: "ISCC EU v2.3 (2025)",
    filePrefix: "ISCC_EU",
  },
};

/** 未指定模板时沿用原有的 ISCC.docx */
export const DEFAULT_ISCC_TEMPLATE: IsccTemplateKey = "PLUS_V1";

/** 自我声明统一按英文生成（门店 / 收集点字段走翻译缓存，缺失时回退中文原文） */
export const ISCC_EXPORT_LANGUAGE = "en";

/** 「仅测试用」导出只处理收集点下前 N 家门店 */
export const ISCC_TEST_EXPORT_STORE_LIMIT = 10;

export function isIsccTemplateKey(value: unknown): value is IsccTemplateKey {
  return (
    typeof value === "string" &&
    (ISCC_TEMPLATE_KEYS as readonly string[]).includes(value)
  );
}

export function getIsccTemplate(key: string | null | undefined): IsccTemplateDefinition {
  return ISCC_TEMPLATES[isIsccTemplateKey(key) ? key : DEFAULT_ISCC_TEMPLATE];
}
