import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth, isAdmin } from '@/lib/auth';

// 中文姓氏库
const surnames = [
  '王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴',
  '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗',
  '梁', '宋', '郑', '谢', '韩', '唐', '冯', '于', '董', '萧',
];

// 轮胎行业相关词库
const businessTypes = [
  '轮胎', '车胎', '汽配', '汽车配件', '轮毂', '车轮', '橡胶',
];

const businessSuffixes = [
  '店', '经营部', '销售部', '批发部', '零售店', '专卖店',
  '维修店', '服务中心', '经销处', '商行', '贸易商行',
];

// 省市数据（简化版）
const regions = [
  { province: '广东省', city: '广州市', districts: ['天河区', '白云区', '番禺区', '花都区', '增城区'] },
  { province: '广东省', city: '深圳市', districts: ['南山区', '福田区', '宝安区', '龙岗区', '龙华区'] },
  { province: '广东省', city: '东莞市', districts: ['东城街道', '南城街道', '莞城街道', '万江街道', '虎门镇'] },
  { province: '广东省', city: '佛山市', districts: ['禅城区', '南海区', '顺德区', '三水区', '高明区'] },
  { province: '浙江省', city: '杭州市', districts: ['西湖区', '滨江区', '萧山区', '余杭区', '拱墅区'] },
  { province: '浙江省', city: '宁波市', districts: ['海曙区', '江北区', '鄞州区', '镇海区', '北仑区'] },
  { province: '江苏省', city: '南京市', districts: ['玄武区', '秦淮区', '鼓楼区', '建邺区', '雨花台区'] },
  { province: '江苏省', city: '苏州市', districts: ['姑苏区', '吴中区', '相城区', '虎丘区', '吴江区'] },
  { province: '山东省', city: '济南市', districts: ['历下区', '市中区', '槐荫区', '天桥区', '历城区'] },
  { province: '山东省', city: '青岛市', districts: ['市南区', '市北区', '黄岛区', '崂山区', '李沧区'] },
];

// 街道名
const streetNames = [
  '中山路', '解放路', '人民路', '建设路', '新华路', '工业大道',
  '科技路', '商业街', '文化路', '振兴路', '繁荣路', '和平路',
];

// 生成随机字符串
function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 生成随机手机号
function randomPhone(): string {
  const prefixes = ['138', '139', '158', '159', '188', '189', '136', '137', '150', '151'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += Math.floor(Math.random() * 10);
  }
  return prefix + suffix;
}

// 生成随机营业执照号（18位统一社会信用代码）
function randomBusinessLicense(): string {
  // 简化版：91 + 6位行政区划代码 + 9位组织机构代码 + 1位校验码
  const adminCode = Math.floor(100000 + Math.random() * 899999);
  const orgCode = randomString(9);
  const checkCode = randomString(1);
  return `91${adminCode}${orgCode}${checkCode}`;
}

// 生成虚拟门店
function generateVirtualStore(
  collectionPointId: string,
  index: number,
  baseCode: string
) {
  const region = regions[Math.floor(Math.random() * regions.length)];
  const district = region.districts[Math.floor(Math.random() * region.districts.length)];
  const street = streetNames[Math.floor(Math.random() * streetNames.length)];
  const streetNo = Math.floor(1 + Math.random() * 500);

  const surname = surnames[Math.floor(Math.random() * surnames.length)];
  const businessType = businessTypes[Math.floor(Math.random() * businessTypes.length)];
  const suffix = businessSuffixes[Math.floor(Math.random() * businessSuffixes.length)];

  // 随机生成门店名称
  const nameStyles = [
    `${surname}氏${businessType}${suffix}`,
    `${surname}记${businessType}${suffix}`,
    `${surname}${surname === '王' ? '王' : ''}${businessType}${suffix}`,
    `鑫${surname}${businessType}${suffix}`,
    `恒${surname}${businessType}${suffix}`,
  ];
  const name = nameStyles[Math.floor(Math.random() * nameStyles.length)];

  // 生成经纬度（中国范围内的随机偏移）
  const baseLongitude = 113.2 + Math.random() * 7; // 113.2 ~ 120.2
  const baseLatitude = 22.5 + Math.random() * 9; // 22.5 ~ 31.5

  // 预估行程时间：15-90分钟（模拟不同距离的门店）
  const estimatedTravelMinutes = Math.floor(15 + Math.random() * 75);

  return {
    code: `${baseCode}-${String(index).padStart(5, '0')}`,
    name,
    businessLicense: randomBusinessLicense(),
    legalPerson: `${surname}${['明', '华', '强', '伟', '刚', '勇', '杰', '军', '波', '涛'][Math.floor(Math.random() * 10)]}`,
    address: `${region.province}${region.city}${district}${street}${streetNo}号`,
    province: region.province,
    city: region.city,
    district,
    longitude: parseFloat(baseLongitude.toFixed(6)),
    latitude: parseFloat(baseLatitude.toFixed(6)),
    contactName: `${surname}先生`,
    contactPhone: randomPhone(),
    estimatedTravelMinutes,
    collectionPointId,
    isVirtual: true,
  };
}

// 批量生成虚拟门店
export async function POST(request: NextRequest) {
  return withAuth(request, async (user) => {
    if (!isAdmin(user)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const body = await request.json();
      const { collectionPointId, count } = body;

      // 验证参数
      if (!collectionPointId || !count) {
        return NextResponse.json(
          { message: 'Collection point ID and count are required' },
          { status: 400 }
        );
      }

      const storeCount = parseInt(count);
      if (isNaN(storeCount) || storeCount < 1 || storeCount > 4000) {
        return NextResponse.json(
          { message: 'Count must be between 1 and 4000' },
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

      // 获取该收集点已有的门店最大编号
      const existingStores = await prisma.store.findMany({
        where: { collectionPointId },
        orderBy: { code: 'desc' },
        take: 1,
        select: { code: true },
      });

      let startIndex = 1;
      if (existingStores.length > 0) {
        const lastCode = existingStores[0].code;
        const match = lastCode.match(/-(\d+)$/);
        if (match) {
          startIndex = parseInt(match[1]) + 1;
        }
      }

      // 基础编码：收集点编码
      const baseCode = `S-${collectionPoint.code}`;

      // 批量生成门店数据
      const storesToCreate = [];
      for (let i = 0; i < storeCount; i++) {
        storesToCreate.push(
          generateVirtualStore(collectionPointId, startIndex + i, baseCode)
        );
      }

      // 批量插入（分批处理以避免超时）
      const batchSize = 500;
      let createdCount = 0;

      for (let i = 0; i < storesToCreate.length; i += batchSize) {
        const batch = storesToCreate.slice(i, i + batchSize);
        await prisma.store.createMany({
          data: batch,
          skipDuplicates: true,
        });
        createdCount += batch.length;
      }

      return NextResponse.json({
        message: `Successfully generated ${createdCount} stores`,
        count: createdCount,
      });
    } catch (error) {
      console.error('Generate stores error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

