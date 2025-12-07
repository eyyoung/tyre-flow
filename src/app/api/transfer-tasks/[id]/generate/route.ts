import { NextRequest, NextResponse } from 'next/server';
import { executeTransferTask } from '@/lib/transfer-generator';

// 触发生成转移记录
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const summary = await executeTransferTask(id);

    return NextResponse.json({ message: '转移记录生成成功', summary });
  } catch (error) {
    console.error('Error generating transfer records:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '生成转移记录失败' },
      { status: 500 }
    );
  }
}

