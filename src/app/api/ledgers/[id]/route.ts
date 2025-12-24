import { NextRequest, NextResponse } from "next/server";
import { withMiddlewares, standardMiddlewares } from "@/lib/middleware";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 获取单个台账任务详情
export async function GET(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    const { id } = await params;

    try {
      // ctx.prisma 已自动带收集点权限过滤
      // findUnique 会自动检查结果是否在权限范围内
      const task = await ctx.prisma.ledgerTask.findUnique({
        where: { id },
        include: {
          collectionPoint: {
            select: { id: true, name: true, code: true, address: true },
          },
          _count: {
            select: {
              collectionRecords: true,
            },
          },
        },
      });

      if (!task) {
        return NextResponse.json(
          { message: "Task not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({ data: task });
    } catch (error) {
      console.error("Get ledger task error:", error);
      return NextResponse.json(
        { message: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

// 删除台账任务
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    // 只有管理员可以删除任务
    if (ctx.user?.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    try {
      const task = await ctx.prisma.ledgerTask.findUnique({
        where: { id },
      });

      if (!task) {
        return NextResponse.json(
          { message: "Task not found" },
          { status: 404 }
        );
      }

      // 删除任务（级联删除会自动删除关联的记录）
      await ctx.prisma.ledgerTask.delete({
        where: { id },
      });

      return NextResponse.json({ message: "Task deleted successfully" });
    } catch (error) {
      console.error("Delete ledger task error:", error);
      return NextResponse.json(
        { message: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
