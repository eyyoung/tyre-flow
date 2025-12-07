import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';

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
}

// 生成门店编码
function generateStoreCode(collectionPointCode: string, index: number): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const indexStr = index.toString().padStart(4, '0');
  return `${collectionPointCode}-IMP${timestamp}${indexStr}`;
}

// 生成随机预估距离（10-120分钟）
function generateEstimatedTravelMinutes(): number {
  return Math.floor(Math.random() * 111) + 10; // 10 to 120 minutes
}

// 批量导入门店
export async function POST(request: NextRequest) {
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const body = await request.json();
      const { collectionPointId, stores } = body as {
        collectionPointId: string;
        stores: ImportStore[];
      };

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

        // 确定状态：开业=ACTIVE，其他=DISABLED
        const status = store.businessStatus === '开业' ? 'ACTIVE' : 'DISABLED';

        storesToCreate.push({
          code: generateStoreCode(collectionPoint.code, storesToCreate.length),
          name: store.name,
          businessLicense: store.businessLicense || null,
          legalPerson: store.legalPerson || null,
          address: store.address,
          province: store.province || null,
          city: store.city || null,
          district: store.district || null,
          contactPhone: store.contactPhone || null,
          estimatedTravelMinutes: generateEstimatedTravelMinutes(),
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

