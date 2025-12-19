/**
 * 翻译缓存相关类型和工具函数
 * 
 * 用于支持门店名称、法人名称、地址、司机名称等字段的多语言翻译
 */

/**
 * 翻译缓存数据结构
 * 存储为 JSON 字段，key 为语言代码，value 为翻译后的文本
 */
export interface TranslationCache {
  en?: string;  // 英文
  fr?: string;  // 法文
  de?: string;  // 德文
  es?: string;  // 西班牙文
  pt?: string;  // 葡萄牙文
  it?: string;  // 意大利文
  nl?: string;  // 荷兰文
  // 可扩展其他语言
  [locale: string]: string | undefined;
}

/**
 * 支持的语言列表
 */
export const SUPPORTED_LOCALES = ['zh', 'en', 'fr', 'de', 'es', 'pt', 'it', 'nl'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

/**
 * 语言显示名称映射
 */
export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  zh: '中文',
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  pt: 'Português',
  it: 'Italiano',
  nl: 'Nederlands',
};

/**
 * 获取翻译值
 * 优先返回指定语言的翻译，如果没有则回退到原始值
 * 
 * @param original - 原始值（中文）
 * @param translations - 翻译缓存对象
 * @param locale - 目标语言代码
 * @returns 翻译后的值，如果没有翻译则返回原始值
 * 
 * @example
 * ```ts
 * const storeName = getTranslatedValue(
 *   store.name,
 *   store.nameTranslations as TranslationCache | null,
 *   'en'
 * );
 * ```
 */
export function getTranslatedValue(
  original: string | null | undefined,
  translations: TranslationCache | null | undefined,
  locale: string
): string {
  if (!original) return '';
  // 中文使用原始值
  if (locale === 'zh') return original;
  // 尝试获取翻译，没有则回退到原始值
  return translations?.[locale] || original;
}

/**
 * 批量获取翻译值
 * 用于一次性获取多个字段的翻译
 * 
 * @param fields - 字段映射 { fieldName: { original, translations } }
 * @param locale - 目标语言代码
 * @returns 翻译后的字段值映射
 * 
 * @example
 * ```ts
 * const translated = getTranslatedValues({
 *   name: { original: store.name, translations: store.nameTranslations },
 *   address: { original: store.address, translations: store.addressTranslations },
 * }, 'en');
 * // { name: 'English Name', address: 'English Address' }
 * ```
 */
export function getTranslatedValues<T extends string>(
  fields: Record<T, { original: string | null | undefined; translations: TranslationCache | null | undefined }>,
  locale: string
): Record<T, string> {
  const result = {} as Record<T, string>;
  for (const key of Object.keys(fields) as T[]) {
    const field = fields[key];
    result[key] = getTranslatedValue(field.original, field.translations, locale);
  }
  return result;
}

/**
 * 检查是否需要翻译
 * 用于判断是否需要调用翻译服务
 * 
 * @param translations - 现有翻译缓存
 * @param targetLocales - 需要支持的目标语言列表
 * @returns 缺失翻译的语言列表
 */
export function getMissingTranslations(
  translations: TranslationCache | null | undefined,
  targetLocales: string[]
): string[] {
  if (!translations) return targetLocales.filter(l => l !== 'zh');
  return targetLocales.filter(locale => locale !== 'zh' && !translations[locale]);
}

/**
 * 合并翻译缓存
 * 将新的翻译合并到现有缓存中
 * 
 * @param existing - 现有翻译缓存
 * @param newTranslations - 新的翻译
 * @returns 合并后的翻译缓存
 */
export function mergeTranslations(
  existing: TranslationCache | null | undefined,
  newTranslations: TranslationCache
): TranslationCache {
  return {
    ...(existing || {}),
    ...newTranslations,
  };
}

