import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';

// 旧格式（原有格式，现在也支持经纬度和预估行程）
interface ImportStoreOld {
  name: string;
  businessStatus: string;
  legalPerson: string | null;
  contactPhone: string | null;
  businessLicense: string | null;
  address: string;
  province: string | null;
  city: string | null;
  district: string | null;
  // 新增支持经纬度直接导入
  longitude?: string | number | null;
  latitude?: string | number | null;
  // 新增支持预估行程导入
  estimatedTravelMinutes?: string | number | null;
}

// 新格式（stores.csv 格式，带经纬度和预估行程）
// CSV 表头: 序号,自我声明签署情况,企业名称,来源分类,统一社会信用代码,所属省份,所属城市,所属区县,法定代表人,注册地址,经度,纬度,邮政编码,电话,更多电话,预估行程(分钟)
interface ImportStoreNew {
  序号?: string | number;
  自我声明签署情况?: string;
  企业名称: string;
  来源分类?: string;
  统一社会信用代码?: string;
  所属省份?: string;
  所属城市?: string;
  所属区县?: string;
  法定代表人?: string;
  注册地址: string;
  经度?: string | number;
  纬度?: string | number;
  邮政编码?: string;
  电话?: string;
  更多电话?: string;
  预估行程?: string | number;
  '预估行程(分钟)'?: string | number;
}

// 统一内部格式
interface ImportStore {
  name: string;
  businessStatus: string;
  legalPerson: string | null;
  contactPhone: string | null;
  businessLicense: string | null;
  address: string;
  province: string | null;
  city: string | null;
  district: string | null;
  longitude: number | null;
  latitude: number | null;
  estimatedTravelMinutes: number | null;
}

// 检测并转换数据格式
function normalizeStoreData(store: ImportStoreOld | ImportStoreNew): ImportStore {
  // 检测是否为新格式（stores.csv 格式）
  if ('企业名称' in store || '注册地址' in store) {
    const newStore = store as ImportStoreNew;
    const phones = [newStore.电话, newStore.更多电话].filter(Boolean).join(',');
    
    return {
      name: newStore.企业名称 || '',
      businessStatus: newStore.来源分类 || '开业', // 默认为开业
      legalPerson: newStore.法定代表人 || null,
      contactPhone: phones || null,
      businessLicense: newStore.统一社会信用代码 || null,
      address: newStore.注册地址 || '',
      province: newStore.所属省份 || null,
      city: newStore.所属城市 || null,
      district: newStore.所属区县 || null,
      longitude: parseCoordinate(newStore.经度),
      latitude: parseCoordinate(newStore.纬度),
      estimatedTravelMinutes: parseEstimatedTime(newStore.预估行程 || newStore['预估行程(分钟)']),
    };
  }
  
  // 旧格式（也支持经纬度和预估行程）
  const oldStore = store as ImportStoreOld;
  return {
    name: oldStore.name || '',
    businessStatus: oldStore.businessStatus || '开业',
    legalPerson: oldStore.legalPerson || null,
    contactPhone: oldStore.contactPhone || null,
    businessLicense: oldStore.businessLicense || null,
    address: oldStore.address || '',
    province: oldStore.province || null,
    city: oldStore.city || null,
    district: oldStore.district || null,
    longitude: parseCoordinate(oldStore.longitude),
    latitude: parseCoordinate(oldStore.latitude),
    estimatedTravelMinutes: parseEstimatedTime(oldStore.estimatedTravelMinutes),
  };
}

// 解析坐标值
function parseCoordinate(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const num = typeof value === 'number' ? value : parseFloat(value);
  return isNaN(num) ? null : num;
}

// 解析预估行程时间
function parseEstimatedTime(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const num = typeof value === 'number' ? value : parseInt(value, 10);
  return isNaN(num) || num < 0 ? null : num;
}

// 清理地址中的重复省市区信息
// 如果详细地址已经包含省市区信息，则将 province/city/district 设为 null，避免二次拼接
function cleanupAddressFields(store: ImportStore): ImportStore {
  const { address, province, city, district } = store;
  
  if (!address) return store;
  
  // 检查地址是否已经包含省市区信息
  const hasProvince = province && address.includes(province);
  const hasCity = city && address.includes(city);
  const hasDistrict = district && address.includes(district);
  
  // 如果地址已经包含省市区信息，则清除这些字段避免重复
  if (hasProvince || hasCity || hasDistrict) {
    return {
      ...store,
      province: hasProvince ? null : province,
      city: hasCity ? null : city,
      district: hasDistrict ? null : district,
    };
  }
  
  return store;
}

// 生成门店编码
function generateStoreCode(collectionPointCode: string, index: number): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const indexStr = index.toString().padStart(4, '0');
  return `${collectionPointCode}-IMP${timestamp}${indexStr}`;
}

function generateEstimatedTravelMinutes(): number {
  return 0; 
}

// 批量导入门店
export async function POST(request: NextRequest) {
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const body = await request.json();
      const { collectionPointId, stores: rawStores } = body as {
        collectionPointId: string;
        stores: (ImportStoreOld | ImportStoreNew)[];
      };
      
      // 统一转换所有门店数据格式，并清理重复的省市区信息
      const stores: ImportStore[] = rawStores.map(normalizeStoreData).map(cleanupAddressFields);

      // 验证收集点
      if (!collectionPointId) {
        return NextResponse.json(
          { message: 'Collection point ID is required' },
          { status: 400 }
        );
      }

      const collectionPoint = await prisma.collectionPoint.findUnique({
        where: { id: collectionPointId },
      });

      if (!collectionPoint) {
        return NextResponse.json(
          { message: 'Collection point not found' },
          { status: 400 }
        );
      }

      // 验证门店数据
      if (!stores || !Array.isArray(stores) || stores.length === 0) {
        return NextResponse.json(
          { message: 'No stores data provided' },
          { status: 400 }
        );
      }

      // 获取已存在的营业执照号（用于去重）
      const existingLicenses = await prisma.store.findMany({
        where: {
          businessLicense: { in: stores.filter(s => s.businessLicense).map(s => s.businessLicense!) },
        },
        select: { businessLicense: true },
      });
      const existingLicenseSet = new Set(existingLicenses.map(s => s.businessLicense));

      // 获取已存在的门店名称+地址组合（用于去重）
      const existingStores = await prisma.store.findMany({
        where: {
          collectionPointId,
          OR: stores.map(s => ({
            name: s.name,
            address: s.address,
          })),
        },
        select: { name: true, address: true },
      });
      const existingStoreSet = new Set(existingStores.map(s => `${s.name}|${s.address}`));

      let success = 0;
      let failed = 0;
      let skipped = 0;
      const errors: string[] = [];

      // 准备批量创建的数据
      const storesToCreate: Array<{
        code: string;
        name: string;
        businessLicense: string | null;
        legalPerson: string | null;
        address: string;
        province: string | null;
        city: string | null;
        district: string | null;
        longitude: number | null;
        latitude: number | null;
        contactPhone: string | null;
        estimatedTravelMinutes: number;
        status: 'ACTIVE' | 'DISABLED';
        collectionPointId: string;
        isVirtual: boolean;
      }> = [];

      for (let i = 0; i < stores.length; i++) {
        const store = stores[i];

        // 验证必填字段
        if (!store.name || !store.address) {
          errors.push(`Row ${i + 1}: Missing name or address`);
          failed++;
          continue;
        }

        // 检查营业执照号是否重复
        if (store.businessLicense && existingLicenseSet.has(store.businessLicense)) {
          skipped++;
          continue;
        }

        // 检查门店名称+地址是否重复
        const storeKey = `${store.name}|${store.address}`;
        if (existingStoreSet.has(storeKey)) {
          skipped++;
          continue;
        }

        // 添加到已处理集合，避免本批次重复
        if (store.businessLicense) {
          existingLicenseSet.add(store.businessLicense);
        }
        existingStoreSet.add(storeKey);

        // 确定状态：
        // - "开业" 或默认值 "开业" -> ACTIVE
        // - "停业"/"注销"/"吊销" 等 -> DISABLED
        // - 对于新格式（stores.csv），来源分类不是经营状态，默认为 ACTIVE
        const disabledStatuses = ['停业', '注销', '吊销', '歇业', '迁出'];
        const status = disabledStatuses.includes(store.businessStatus) ? 'DISABLED' : 'ACTIVE';

        storesToCreate.push({
          code: generateStoreCode(collectionPoint.code, storesToCreate.length),
          name: store.name,
          businessLicense: store.businessLicense || null,
          legalPerson: store.legalPerson || null,
          address: store.address,
          province: store.province || null,
          city: store.city || null,
          district: store.district || null,
          longitude: store.longitude,
          latitude: store.latitude,
          contactPhone: store.contactPhone || null,
          // 优先使用导入的预估行程，如果没有则使用默认值
          estimatedTravelMinutes: store.estimatedTravelMinutes ?? generateEstimatedTravelMinutes(),
          status,
          collectionPointId,
          isVirtual: false, // 导入的门店不是虚拟门店
        });
      }

      // 批量创建门店
      if (storesToCreate.length > 0) {
        try {
          await prisma.store.createMany({
            data: storesToCreate,
            skipDuplicates: true,
          });
          success = storesToCreate.length;
        } catch (error) {
          console.error('Batch create stores error:', error);
          failed = storesToCreate.length;
          errors.push('Batch create failed, please try again');
        }
      }

      return NextResponse.json({
        success,
        failed,
        skipped,
        errors,
        message: `Successfully imported ${success} stores`,
      });
    } catch (error) {
      console.error('Import stores error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

