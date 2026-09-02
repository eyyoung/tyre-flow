import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// 部署脚本与外部监控用的健康检查：进程存活且数据库可达才返回 200
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', db: 'ok' });
  } catch (error) {
    console.error('[health] database check failed:', error);
    return NextResponse.json({ status: 'error', db: 'unreachable' }, { status: 503 });
  }
}
