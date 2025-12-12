import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

// 获取转移记录
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    const [total, data] = await Promise.all([
      prisma.transferRecord.count({ where: { taskId: id } }),
      prisma.transferRecord.findMany({
        where: { taskId: id },
        include: {
          vehicle: {
            select: { plateNumber: true },
          },
        },
        orderBy: { transferDate: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({
      data,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('Error fetching transfer records:', error);
    return NextResponse.json(
      { error: '获取转移记录失败' },
      { status: 500 }
    );
  }
}

