import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始数据库初始化...');

  // 创建默认管理员账户
  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: adminPassword,
      name: '系统管理员',
      email: 'admin@example.com',
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  console.log('✅ 管理员账户已创建:', admin.username);

  // 创建默认系统配置
  const defaultConfigs = [
    { key: 'store_count_min', value: '1000', description: '每收集点最小门店数', category: 'store' },
    { key: 'store_count_max', value: '4000', description: '每收集点最大门店数', category: 'store' },
    { key: 'collection_vehicle_count', value: '10', description: '收集车辆默认数量', category: 'vehicle' },
    { key: 'transfer_vehicle_count', value: '5', description: '转移车辆默认数量', category: 'vehicle' },
    { key: 'collection_vehicle_load', value: '2.0', description: '收集车默认载重（吨）', category: 'vehicle' },
    { key: 'transfer_vehicle_load', value: '30.0', description: '转移车默认载重（吨）', category: 'vehicle' },
    { key: 'tire_weight_kg', value: '10', description: '单条轮胎重量（kg）', category: 'ledger' },
    { key: 'collection_tire_limit', value: '200', description: '单次收集条数上限', category: 'ledger' },
    { key: 'collection_interval_min', value: '7', description: '门店收集最小间隔天数', category: 'ledger' },
    { key: 'collection_interval_max', value: '15', description: '门店收集最大间隔天数', category: 'ledger' },
    { key: 'cold_store_ratio', value: '0.1', description: '冷门门店比例（0-1）', category: 'ledger' },
  ];

  for (const config of defaultConfigs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: {},
      create: config,
    });
  }
  console.log('✅ 系统配置已初始化');

  // 创建示例收集点
  const collectionPoint = await prisma.collectionPoint.upsert({
    where: { code: 'CP-GZ-001' },
    update: {},
    create: {
      code: 'CP-GZ-001',
      name: '广州收集点',
      address: '广东省广州市天河区天河路123号',
      province: '广东省',
      city: '广州市',
      district: '天河区',
      longitude: 113.329773,
      latitude: 23.137107,
      certScope: '废旧轮胎回收、加工',
      contactName: '张经理',
      contactPhone: '13800138001',
      status: 'ACTIVE',
    },
  });
  console.log('✅ 示例收集点已创建:', collectionPoint.name);

  // 创建示例车辆
  const vehicles = [
    {
      plateNumber: '粤A12345',
      type: 'COLLECTION' as const,
      brand: '五菱',
      model: '4.2米厢式货车',
      tareWeight: 2.5,
      tareWeightVariance: 0.05,
      maxLoad: 2.0,
      driverName: '李师傅',
      driverPhone: '13800138002',
      collectionPointId: collectionPoint.id,
    },
    {
      plateNumber: '粤A67890',
      type: 'TRANSFER' as const,
      brand: '东风',
      model: '13米半挂',
      tareWeight: 15.0,
      tareWeightVariance: 0.05,
      maxLoad: 30.0,
      driverName: '王师傅',
      driverPhone: '13800138003',
      collectionPointId: collectionPoint.id,
    },
  ];

  for (const vehicle of vehicles) {
    await prisma.vehicle.upsert({
      where: { plateNumber: vehicle.plateNumber },
      update: {},
      create: vehicle,
    });
  }
  console.log('✅ 示例车辆已创建');

  console.log('🎉 数据库初始化完成！');
  console.log('');
  console.log('📝 默认管理员账户:');
  console.log('   用户名: admin');
  console.log('   密码: admin123');
}

main()
  .catch((e) => {
    console.error('❌ 初始化失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

