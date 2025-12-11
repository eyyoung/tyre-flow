/**
 * 位置服务抽象层
 * 支持腾讯LBS和高德地图API
 * 通过环境变量 LBS_PROVIDER 控制使用哪个服务提供商
 * 默认使用腾讯LBS
 */

import crypto from "crypto";
import prisma from "./db";

// ==================== 接口定义 ====================

export interface GeocodeResult {
  success: boolean;
  longitude?: number;
  latitude?: number;
  error?: string;
}

export interface RoutePlanResult {
  success: boolean;
  duration?: number; // 分钟
  distance?: number; // 米
  error?: string;
}

export interface LocationServiceProvider {
  name: string;
  geocode(address: string): Promise<GeocodeResult>;
  planRoute(
    originLng: number,
    originLat: number,
    destLng: number,
    destLat: number
  ): Promise<RoutePlanResult>;
}

// ==================== 腾讯LBS实现 ====================

interface TencentGeocodeResponse {
  status: number;
  message: string;
  result?: {
    title: string;
    location: {
      lat: number;
      lng: number;
    };
    ad_info: {
      adcode: string;
    };
    address_components: {
      province: string;
      city: string;
      district: string;
      street: string;
      street_number: string;
    };
    reliability: number;
    level: number;
  };
}

interface TencentDirectionResponse {
  status: number;
  message: string;
  result?: {
    routes: Array<{
      mode: string;
      distance: number;
      duration: number;
      traffic_light_count: number;
      toll: number;
    }>;
  };
}

/**
 * 腾讯LBS签名计算
 * 按照腾讯文档：请求路径+"?"+请求参数+SK进行拼接，计算md5值
 * 注意：参数必须是未进行任何编码的原始数据
 */
function calculateTencentSignature(
  path: string,
  params: Record<string, string>,
  secretKey: string
): string {
  // 按参数名升序排序
  const sortedKeys = Object.keys(params).sort();
  const queryString = sortedKeys
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  // 拼接：路径 + ? + 排序后的参数 + SK（不含任何URL编码）
  // 确保 SK 没有前后空白字符
  const sk = secretKey.trim();
  const signString = `${path}?${queryString}${sk}`;

  // 使用 Buffer 确保 UTF-8 编码后再计算 MD5
  const signBuffer = Buffer.from(signString, "utf8");
  const sig = crypto.createHash("md5").update(signBuffer).digest("hex");

  return sig;
}

class TencentLBSProvider implements LocationServiceProvider {
  name = "tencent";
  private apiKey: string;
  private secretKey: string | null;

  constructor(apiKey: string, secretKey: string | null = null) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
  }

  async geocode(address: string): Promise<GeocodeResult> {
    try {
      // 注意：路径不能有尾部斜杠，否则签名计算会失败
      const path = "/ws/geocoder/v1";
      const params: Record<string, string> = {
        address,
        key: this.apiKey,
        output: "json",
      };

      // 如果有SK，计算签名（必须在URL编码之前，使用原始参数值）
      if (this.secretKey) {
        const sig = calculateTencentSignature(path, params, this.secretKey);
        params.sig = sig;
      }

      // 构建URL（参数需要URL编码）
      const sortedKeys = Object.keys(params).sort();
      const queryString = sortedKeys
        .map((key) => `${key}=${encodeURIComponent(params[key])}`)
        .join("&");
      const url = `https://apis.map.qq.com${path}?${queryString}`;

      const response = await fetch(url);
      const data: TencentGeocodeResponse = await response.json();

      if (data.status !== 0) {
        return { success: false, error: `腾讯API错误: ${data.message}` };
      }

      if (!data.result || !data.result.location) {
        return { success: false, error: "未找到匹配的地址" };
      }

      const { lat, lng } = data.result.location;

      // 检查可信度，level >= 9 表示精度较高
      if (data.result.level < 7) {
        console.warn(
          `[TencentLBS] 地址解析可信度较低: level=${data.result.level}, reliability=${data.result.reliability}`
        );
      }

      return { success: true, longitude: lng, latitude: lat };
    } catch (error) {
      return {
        success: false,
        error: `请求失败: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  async planRoute(
    originLng: number,
    originLat: number,
    destLng: number,
    destLat: number
  ): Promise<RoutePlanResult> {
    try {
      // 注意：路径不能有尾部斜杠，否则签名计算会失败
      const path = "/ws/direction/v1/driving";
      // 腾讯API坐标格式：纬度在前，经度在后
      const params: Record<string, string> = {
        from: `${originLat},${originLng}`,
        to: `${destLat},${destLng}`,
        key: this.apiKey,
        output: "json",
      };

      // 如果有SK，计算签名（必须在URL编码之前，使用原始参数值）
      if (this.secretKey) {
        const sig = calculateTencentSignature(path, params, this.secretKey);
        params.sig = sig;
      }

      // 构建URL（参数需要URL编码）
      const sortedKeys = Object.keys(params).sort();
      const queryString = sortedKeys
        .map((key) => `${key}=${encodeURIComponent(params[key])}`)
        .join("&");
      const url = `https://apis.map.qq.com${path}?${queryString}`;

      const response = await fetch(url);
      const data: TencentDirectionResponse = await response.json();

      if (data.status !== 0) {
        return { success: false, error: `腾讯API错误: ${data.message}` };
      }

      if (
        !data.result ||
        !data.result.routes ||
        data.result.routes.length === 0
      ) {
        return { success: false, error: "未找到可行路线" };
      }

      const route = data.result.routes[0];
      // 腾讯API返回的duration单位是分钟
      const durationMinutes = Math.ceil(route.duration);

      return {
        success: true,
        duration: durationMinutes,
        distance: route.distance,
      };
    } catch (error) {
      return {
        success: false,
        error: `请求失败: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }
}

// ==================== 高德地图实现 ====================

interface AmapGeocodeResponse {
  status: string;
  info: string;
  infocode: string;
  count: string;
  geocodes: Array<{
    location: string;
    formatted_address: string;
    province: string;
    city: string;
    district: string;
  }>;
}

interface AmapDirectionResponse {
  status: string;
  info: string;
  infocode: string;
  count: string;
  route: {
    origin: string;
    destination: string;
    paths: Array<{
      distance: string;
      duration: string;
      strategy: string;
    }>;
  };
}

class AmapProvider implements LocationServiceProvider {
  name = "amap";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async geocode(address: string): Promise<GeocodeResult> {
    try {
      const url = new URL("https://restapi.amap.com/v3/geocode/geo");
      url.searchParams.set("address", address);
      url.searchParams.set("key", this.apiKey);
      url.searchParams.set("output", "JSON");

      const response = await fetch(url.toString());
      const data: AmapGeocodeResponse = await response.json();

      if (data.status !== "1") {
        return { success: false, error: `高德API错误: ${data.info}` };
      }

      if (!data.geocodes || data.geocodes.length === 0) {
        return { success: false, error: "未找到匹配的地址" };
      }

      const location = data.geocodes[0].location;
      if (!location) {
        return { success: false, error: "地址解析结果无坐标" };
      }

      const [lng, lat] = location.split(",").map(Number);

      if (isNaN(lng) || isNaN(lat)) {
        return { success: false, error: "坐标格式无效" };
      }

      return { success: true, longitude: lng, latitude: lat };
    } catch (error) {
      return {
        success: false,
        error: `请求失败: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  async planRoute(
    originLng: number,
    originLat: number,
    destLng: number,
    destLat: number
  ): Promise<RoutePlanResult> {
    try {
      const url = new URL("https://restapi.amap.com/v3/direction/driving");
      // 高德API坐标格式：经度在前，纬度在后
      url.searchParams.set("origin", `${originLng},${originLat}`);
      url.searchParams.set("destination", `${destLng},${destLat}`);
      url.searchParams.set("key", this.apiKey);
      url.searchParams.set("output", "JSON");
      url.searchParams.set("strategy", "0"); // 速度优先

      const response = await fetch(url.toString());
      const data: AmapDirectionResponse = await response.json();

      if (data.status !== "1") {
        return { success: false, error: `高德API错误: ${data.info}` };
      }

      if (!data.route || !data.route.paths || data.route.paths.length === 0) {
        return { success: false, error: "未找到可行路线" };
      }

      const path = data.route.paths[0];
      const durationSeconds = parseInt(path.duration);
      const distanceMeters = parseInt(path.distance);

      if (isNaN(durationSeconds)) {
        return { success: false, error: "时间格式无效" };
      }

      // 转换为分钟，向上取整
      const durationMinutes = Math.ceil(durationSeconds / 60);

      return {
        success: true,
        duration: durationMinutes,
        distance: distanceMeters,
      };
    } catch (error) {
      return {
        success: false,
        error: `请求失败: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }
}

// ==================== 服务工厂 ====================

export type LBSProviderType = "tencent" | "amap";

/**
 * 获取当前配置的LBS服务提供商类型
 * 默认使用腾讯
 */
export function getLBSProviderType(): LBSProviderType {
  const provider = process.env.LBS_PROVIDER?.toLowerCase();
  if (provider === "amap") {
    return "amap";
  }
  return "tencent"; // 默认腾讯
}

/**
 * 从环境变量或数据库获取API Key
 */
async function getApiKeys(): Promise<{
  tencentKey: string | null;
  tencentSK: string | null;
  amapKey: string | null;
}> {
  let tencentKey = process.env.TENCENT_LBS_KEY || null;
  let tencentSK = process.env.TENCENT_LBS_SK || null;
  let amapKey = process.env.AMAP_API_KEY || null;

  // 尝试从数据库获取
  try {
    if (!tencentKey) {
      const config = await prisma.systemConfig.findUnique({
        where: { key: "tencent_lbs_key" },
      });
      tencentKey = config?.value || null;
    }
    if (!tencentSK) {
      const config = await prisma.systemConfig.findUnique({
        where: { key: "tencent_lbs_sk" },
      });
      tencentSK = config?.value || null;
    }
    if (!amapKey) {
      const config = await prisma.systemConfig.findUnique({
        where: { key: "amap_api_key" },
      });
      amapKey = config?.value || null;
    }
  } catch {
    // 忽略数据库错误
  }

  return { tencentKey, tencentSK, amapKey };
}

/**
 * 获取位置服务提供商实例
 * 根据环境变量 LBS_PROVIDER 决定使用哪个服务
 */
export async function getLocationService(): Promise<LocationServiceProvider | null> {
  const providerType = getLBSProviderType();
  const { tencentKey, tencentSK, amapKey } = await getApiKeys();

  if (providerType === "tencent") {
    if (!tencentKey) {
      console.error(
        "[LocationService] 未配置腾讯LBS Key，请设置环境变量 TENCENT_LBS_KEY"
      );
      return null;
    }
    return new TencentLBSProvider(tencentKey, tencentSK);
  } else {
    if (!amapKey) {
      console.error(
        "[LocationService] 未配置高德地图API Key，请设置环境变量 AMAP_API_KEY"
      );
      return null;
    }
    return new AmapProvider(amapKey);
  }
}

/**
 * 获取未配置错误信息
 */
export function getApiKeyErrorMessage(): string {
  const providerType = getLBSProviderType();
  if (providerType === "tencent") {
    return "未配置腾讯LBS Key，请在系统设置或环境变量中配置 TENCENT_LBS_KEY";
  }
  return "未配置高德地图API Key，请在系统设置或环境变量中配置 AMAP_API_KEY";
}

/**
 * QPS延迟时间（毫秒）
 * 腾讯个人开发者 5QPS，高德免费 3QPS
 * 保守设置约 2QPS
 */
export function getQPSDelay(): number {
  const providerType = getLBSProviderType();
  if (providerType === "tencent") {
    return 300; // 腾讯 5QPS，设置 ~3QPS
  }
  return 500; // 高德 3QPS，设置 ~2QPS
}
