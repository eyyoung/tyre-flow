import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';

// 车辆品牌和型号数据
const vehicleBrands = {
  COLLECTION: [
    { brand: '江淮', models: ['骏铃V6', '帅铃K340', '威铃'] },
    { brand: '福田', models: ['奥铃', '欧马可', '时代领航'] },
    { brand: '东风', models: ['多利卡D6', '凯普特', 'EV350'] },
    { brand: '解放', models: ['虎VN', 'J6F', '骏威'] },
    { brand: '五十铃', models: ['100P', '700P', 'KV100'] },
  ],
  TRANSFER: [
    { brand: '解放', models: ['J6P', 'J7', 'JH6'] },
    { brand: '东风', models: ['天龙', '天锦', 'KL'] },
    { brand: '陕汽', models: ['德龙X3000', 'X5000', 'X6000'] },
    { brand: '重汽', models: ['豪沃T7H', 'TH7', '黄河'] },
    { brand: '福田', models: ['欧曼GTL', '欧曼EST', 'ETX'] },
  ],
};

// 中文姓氏
const surnames = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴'];
const names = ['军', '强', '伟', '刚', '明', '涛', '波', '勇', '杰', '华'];

// 生成随机车牌号
function generatePlateNumber(provinceShort: string): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const letter = letters[Math.floor(Math.random() * letters.length)];
  const number = Math.floor(10000 + Math.random() * 90000);
  return `${provinceShort}${letter}${number}`;
}

// 生成随机手机号
function generatePhone(): string {
  const prefixes = ['138', '139', '158', '159', '188', '189', '136', '137'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += Math.floor(Math.random() * 10);
  }
  return prefix + suffix;
}

// 省份简称映射
const provinceShorts: Record<string, string> = {
  广东省: '粤',
  浙江省: '浙',
  江苏省: '苏',
  山东省: '鲁',
  北京市: '京',
  上海市: '沪',
  四川省: '川',
  湖北省: '鄂',
  湖南省: '湘',
  安徽省: '皖',
  河南省: '豫',
};

// 批量生成车辆
export async function POST(request: NextRequest) {
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const body = await request.json();
      const { collectionPointId, collectionCount, transferCount } = body;

      // 验证参数
      if (!collectionPointId) {
        return NextResponse.json(
          { message: 'Collection point ID is required' },
          { status: 400 }
        );
      }

      const collVehicles = parseInt(collectionCount) || 0;
      const transVehicles = parseInt(transferCount) || 0;

      if (collVehicles < 0 || collVehicles > 50) {
        return NextResponse.json(
          { message: 'Collection vehicle count must be between 0 and 50' },
          { status: 400 }
        );
      }

      if (transVehicles < 0 || transVehicles > 20) {
        return NextResponse.json(
          { message: 'Transfer vehicle count must be between 0 and 20' },
          { status: 400 }
        );
      }

      // 检查收集点是否存在
      const collectionPoint = await prisma.collectionPoint.findUnique({
        where: { id: collectionPointId },
      });

      if (!collectionPoint) {
        return NextResponse.json(
          { message: 'Collection point not found' },
          { status: 400 }
        );
      }

      // 获取省份简称
      const provinceShort = provinceShorts[collectionPoint.province || ''] || '粤';

      // 获取现有车牌号避免重复
      const existingVehicles = await prisma.vehicle.findMany({
        where: { collectionPointId },
        select: { plateNumber: true },
      });
      const existingPlates = new Set(existingVehicles.map((v) => v.plateNumber));

      // 生成唯一车牌号
      const generateUniquePlate = (): string => {
        let plate: string;
        do {
          plate = generatePlateNumber(provinceShort);
        } while (existingPlates.has(plate));
        existingPlates.add(plate);
        return plate;
      };

      const vehiclesToCreate = [];

      // 生成收集车辆
      for (let i = 0; i < collVehicles; i++) {
        const brandData =
          vehicleBrands.COLLECTION[
            Math.floor(Math.random() * vehicleBrands.COLLECTION.length)
          ];
        const model =
          brandData.models[Math.floor(Math.random() * brandData.models.length)];

        const surname = surnames[Math.floor(Math.random() * surnames.length)];
        const name = names[Math.floor(Math.random() * names.length)];

        vehiclesToCreate.push({
          plateNumber: generateUniquePlate(),
          type: 'COLLECTION' as const,
          brand: brandData.brand,
          model,
          // 皮重和载重单位：kg
          tareWeight: parseFloat((2500 + Math.random() * 500).toFixed(0)),
          tareWeightVariance: parseFloat((50 + Math.random() * 50).toFixed(0)),
          maxLoad: 4000, // 4.2米货车最大载重 4000 kg
          driverName: `${surname}${name}`,
          driverPhone: generatePhone(),
          collectionPointId,
        });
      }

      // 生成转移车辆
      for (let i = 0; i < transVehicles; i++) {
        const brandData =
          vehicleBrands.TRANSFER[
            Math.floor(Math.random() * vehicleBrands.TRANSFER.length)
          ];
        const model =
          brandData.models[Math.floor(Math.random() * brandData.models.length)];

        const surname = surnames[Math.floor(Math.random() * surnames.length)];
        const name = names[Math.floor(Math.random() * names.length)];

        vehiclesToCreate.push({
          plateNumber: generateUniquePlate(),
          type: 'TRANSFER' as const,
          brand: brandData.brand,
          model,
          // 皮重和载重单位：kg
          tareWeight: parseFloat((14000 + Math.random() * 2000).toFixed(0)),
          tareWeightVariance: parseFloat((100 + Math.random() * 100).toFixed(0)),
          maxLoad: 33000, // 13米半挂车最大载重 33000 kg
          driverName: `${surname}${name}`,
          driverPhone: generatePhone(),
          collectionPointId,
        });
      }

      // 批量插入
      if (vehiclesToCreate.length > 0) {
        await prisma.vehicle.createMany({
          data: vehiclesToCreate,
          skipDuplicates: true,
        });
      }

      return NextResponse.json({
        message: `Successfully generated ${vehiclesToCreate.length} vehicles`,
        count: vehiclesToCreate.length,
        collectionCount: collVehicles,
        transferCount: transVehicles,
      });
    } catch (error) {
      console.error('Generate vehicles error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

