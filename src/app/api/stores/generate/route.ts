import { NextRequest, NextResponse } from 'next/server';
import { withMiddlewares, adminMiddlewares } from '@/lib/middleware';

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

// 省市区数据（按省份分组，包含周边城市概念）
interface CityData {
  city: string;
  districts: string[];
  centerLng: number;
  centerLat: number;
}

interface ProvinceData {
  province: string;
  cities: CityData[];
}

const regionData: ProvinceData[] = [
  {
    province: '广东省',
    cities: [
      { city: '广州市', districts: ['天河区', '白云区', '番禺区', '花都区', '增城区', '黄埔区', '海珠区', '荔湾区', '越秀区', '从化区'], centerLng: 113.26, centerLat: 23.13 },
      { city: '深圳市', districts: ['南山区', '福田区', '宝安区', '龙岗区', '龙华区', '罗湖区', '盐田区', '光明区', '坪山区', '大鹏新区'], centerLng: 114.06, centerLat: 22.55 },
      { city: '东莞市', districts: ['东城街道', '南城街道', '莞城街道', '万江街道', '虎门镇', '长安镇', '厚街镇', '塘厦镇', '常平镇', '樟木头镇'], centerLng: 113.75, centerLat: 23.05 },
      { city: '佛山市', districts: ['禅城区', '南海区', '顺德区', '三水区', '高明区'], centerLng: 113.12, centerLat: 23.02 },
      { city: '惠州市', districts: ['惠城区', '惠阳区', '博罗县', '惠东县', '龙门县', '大亚湾区'], centerLng: 114.41, centerLat: 23.11 },
      { city: '中山市', districts: ['石岐区', '东区', '西区', '南区', '五桂山', '小榄镇', '古镇镇', '横栏镇'], centerLng: 113.39, centerLat: 22.52 },
      { city: '珠海市', districts: ['香洲区', '斗门区', '金湾区', '横琴新区'], centerLng: 113.58, centerLat: 22.27 },
      { city: '江门市', districts: ['蓬江区', '江海区', '新会区', '台山市', '开平市', '鹤山市', '恩平市'], centerLng: 113.08, centerLat: 22.58 },
    ],
  },
  {
    province: '浙江省',
    cities: [
      { city: '杭州市', districts: ['西湖区', '滨江区', '萧山区', '余杭区', '拱墅区', '上城区', '江干区', '下城区', '临安区', '富阳区'], centerLng: 120.16, centerLat: 30.29 },
      { city: '宁波市', districts: ['海曙区', '江北区', '鄞州区', '镇海区', '北仑区', '奉化区', '余姚市', '慈溪市'], centerLng: 121.55, centerLat: 29.87 },
      { city: '温州市', districts: ['鹿城区', '龙湾区', '瓯海区', '洞头区', '瑞安市', '乐清市'], centerLng: 120.70, centerLat: 28.00 },
      { city: '嘉兴市', districts: ['南湖区', '秀洲区', '嘉善县', '海盐县', '海宁市', '平湖市', '桐乡市'], centerLng: 120.76, centerLat: 30.75 },
      { city: '绍兴市', districts: ['越城区', '柯桥区', '上虞区', '新昌县', '诸暨市', '嵊州市'], centerLng: 120.58, centerLat: 30.00 },
    ],
  },
  {
    province: '江苏省',
    cities: [
      { city: '南京市', districts: ['玄武区', '秦淮区', '鼓楼区', '建邺区', '雨花台区', '栖霞区', '浦口区', '江宁区', '六合区', '溧水区'], centerLng: 118.78, centerLat: 32.06 },
      { city: '苏州市', districts: ['姑苏区', '吴中区', '相城区', '虎丘区', '吴江区', '昆山市', '太仓市', '常熟市', '张家港市'], centerLng: 120.62, centerLat: 31.30 },
      { city: '无锡市', districts: ['锡山区', '惠山区', '滨湖区', '梁溪区', '新吴区', '江阴市', '宜兴市'], centerLng: 120.31, centerLat: 31.57 },
      { city: '常州市', districts: ['天宁区', '钟楼区', '新北区', '武进区', '金坛区', '溧阳市'], centerLng: 119.95, centerLat: 31.78 },
      { city: '南通市', districts: ['崇川区', '港闸区', '通州区', '海门市', '启东市', '如皋市'], centerLng: 120.86, centerLat: 32.01 },
    ],
  },
  {
    province: '山东省',
    cities: [
      { city: '济南市', districts: ['历下区', '市中区', '槐荫区', '天桥区', '历城区', '长清区', '章丘区', '济阳区'], centerLng: 117.00, centerLat: 36.65 },
      { city: '青岛市', districts: ['市南区', '市北区', '黄岛区', '崂山区', '李沧区', '城阳区', '即墨区', '胶州市'], centerLng: 120.38, centerLat: 36.07 },
      { city: '烟台市', districts: ['芝罘区', '福山区', '牟平区', '莱山区', '龙口市', '莱阳市', '莱州市', '招远市'], centerLng: 121.45, centerLat: 37.46 },
      { city: '潍坊市', districts: ['潍城区', '寒亭区', '坊子区', '奎文区', '青州市', '诸城市', '寿光市', '高密市'], centerLng: 119.16, centerLat: 36.71 },
      { city: '临沂市', districts: ['兰山区', '罗庄区', '河东区', '沂南县', '郯城县', '沂水县', '苍山县'], centerLng: 118.35, centerLat: 35.05 },
    ],
  },
  {
    province: '四川省',
    cities: [
      { city: '成都市', districts: ['锦江区', '青羊区', '金牛区', '武侯区', '成华区', '龙泉驿区', '青白江区', '新都区', '温江区', '双流区'], centerLng: 104.07, centerLat: 30.67 },
      { city: '绵阳市', districts: ['涪城区', '游仙区', '安州区', '江油市', '三台县', '盐亭县'], centerLng: 104.74, centerLat: 31.47 },
      { city: '德阳市', districts: ['旌阳区', '罗江区', '广汉市', '什邡市', '绵竹市', '中江县'], centerLng: 104.40, centerLat: 31.13 },
      { city: '宜宾市', districts: ['翠屏区', '南溪区', '叙州区', '江安县', '长宁县', '高县'], centerLng: 104.64, centerLat: 28.75 },
    ],
  },
  {
    province: '湖北省',
    cities: [
      { city: '武汉市', districts: ['江岸区', '江汉区', '硚口区', '汉阳区', '武昌区', '青山区', '洪山区', '东西湖区', '蔡甸区', '江夏区'], centerLng: 114.31, centerLat: 30.59 },
      { city: '宜昌市', districts: ['西陵区', '伍家岗区', '点军区', '猇亭区', '夷陵区', '远安县', '兴山县'], centerLng: 111.29, centerLat: 30.69 },
      { city: '襄阳市', districts: ['襄城区', '樊城区', '襄州区', '南漳县', '谷城县', '保康县'], centerLng: 112.14, centerLat: 32.01 },
    ],
  },
  {
    province: '湖南省',
    cities: [
      { city: '长沙市', districts: ['芙蓉区', '天心区', '岳麓区', '开福区', '雨花区', '望城区', '长沙县', '浏阳市', '宁乡市'], centerLng: 112.94, centerLat: 28.23 },
      { city: '株洲市', districts: ['荷塘区', '芦淞区', '石峰区', '天元区', '渌口区', '醴陵市'], centerLng: 113.13, centerLat: 27.83 },
      { city: '湘潭市', districts: ['雨湖区', '岳塘区', '湘潭县', '湘乡市', '韶山市'], centerLng: 112.94, centerLat: 27.83 },
    ],
  },
];

// 街道名
const streetNames = [
  '中山路', '解放路', '人民路', '建设路', '新华路', '工业大道',
  '科技路', '商业街', '文化路', '振兴路', '繁荣路', '和平路',
  '胜利路', '光明路', '民主路', '团结路', '友谊路', '复兴路',
  '兴业路', '创业路', '发展大道', '幸福路', '富强路', '文明路',
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
  const adminCode = Math.floor(100000 + Math.random() * 899999);
  const orgCode = randomString(9);
  const checkCode = randomString(1);
  return `91${adminCode}${orgCode}${checkCode}`;
}

// 根据收集点城市获取可用的城市列表（同城市 + 同省周边城市）
function getAvailableCities(province: string | null, city: string | null): CityData[] {
  // 查找收集点所在省份
  const provinceData = regionData.find(p => p.province === province);
  
  if (provinceData) {
    // 找到同省的城市，优先返回同城市
    const sameCity = provinceData.cities.find(c => c.city === city);
    if (sameCity) {
      // 80% 概率返回同城市，20% 概率返回周边城市
      return [sameCity, ...provinceData.cities.filter(c => c.city !== city)];
    }
    return provinceData.cities;
  }
  
  // 如果找不到省份，返回所有城市
  return regionData.flatMap(p => p.cities);
}

// 根据城市中心点生成随机经纬度（模拟周边位置）
function generateCoordinates(centerLng: number, centerLat: number): { lng: number; lat: number } {
  // 生成 ±0.3 度范围内的随机偏移（约 30 公里范围）
  const lngOffset = (Math.random() - 0.5) * 0.6;
  const latOffset = (Math.random() - 0.5) * 0.6;
  
  return {
    lng: parseFloat((centerLng + lngOffset).toFixed(6)),
    lat: parseFloat((centerLat + latOffset).toFixed(6)),
  };
}

// 生成虚拟门店
function generateVirtualStore(
  collectionPointId: string,
  index: number,
  baseCode: string,
  availableCities: CityData[],
  collectionPointProvince: string | null
) {
  // 选择城市：80% 同城市（第一个），20% 周边城市
  const cityIndex = Math.random() < 0.8 ? 0 : Math.floor(Math.random() * availableCities.length);
  const cityData = availableCities[cityIndex];
  const district = cityData.districts[Math.floor(Math.random() * cityData.districts.length)];
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

  // 根据城市中心点生成经纬度
  const coords = generateCoordinates(cityData.centerLng, cityData.centerLat);

  // 预估行程时间：根据是否同城市调整
  // 同城市：15-45分钟，周边城市：30-90分钟
  const isSameCity = cityIndex === 0;
  const estimatedTravelMinutes = isSameCity 
    ? Math.floor(15 + Math.random() * 30)
    : Math.floor(30 + Math.random() * 60);

  return {
    code: `${baseCode}-${String(index).padStart(5, '0')}`,
    name,
    businessLicense: randomBusinessLicense(),
    legalPerson: `${surname}${['明', '华', '强', '伟', '刚', '勇', '杰', '军', '波', '涛'][Math.floor(Math.random() * 10)]}`,
    address: `${collectionPointProvince || cityData.city.slice(0, -1) + '省'}${cityData.city}${district}${street}${streetNo}号`,
    province: collectionPointProvince || cityData.city.slice(0, -1) + '省',
    city: cityData.city,
    district,
    longitude: coords.lng,
    latitude: coords.lat,
    contactName: `${surname}先生`,
    contactPhone: randomPhone(),
    estimatedTravelMinutes,
    collectionPointId,
    isVirtual: true,
  };
}

// 批量生成虚拟门店（管理员专用）
export async function POST(request: NextRequest) {
  return withMiddlewares(request, adminMiddlewares, async (ctx) => {
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
      const collectionPoint = await ctx.prisma.collectionPoint.findUnique({
        where: { id: collectionPointId },
      });

      if (!collectionPoint) {
        return NextResponse.json(
          { message: 'Collection point not found' },
          { status: 400 }
        );
      }

      // 获取该收集点已有的门店最大编号
      const existingStores = await ctx.prisma.store.findMany({
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

      // 获取可用的城市列表（基于收集点位置）
      const availableCities = getAvailableCities(collectionPoint.province, collectionPoint.city);

      // 批量生成门店数据
      const storesToCreate = [];
      for (let i = 0; i < storeCount; i++) {
        storesToCreate.push(
          generateVirtualStore(
            collectionPointId,
            startIndex + i,
            baseCode,
            availableCities,
            collectionPoint.province
          )
        );
      }

      // 批量插入（分批处理以避免超时）
      const batchSize = 500;
      let createdCount = 0;

      for (let i = 0; i < storesToCreate.length; i += batchSize) {
        const batch = storesToCreate.slice(i, i + batchSize);
        await ctx.prisma.store.createMany({
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
