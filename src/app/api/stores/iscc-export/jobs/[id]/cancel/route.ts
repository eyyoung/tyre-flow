import { NextRequest, NextResponse } from "next/server";
import { standardMiddlewares, withMiddlewares } from "@/lib/middleware";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 停止导出任务。
 *  - 排队中（PENDING）的任务直接标记为已停止
 *  - 处理中（PROCESSING）的任务只写入停止标记，worker 在两份文档之间检查到后自行收尾并标记为已停止
 * 重复调用是幂等的；任务已结束时返回 409。
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { id } = await params;
      // findUnique 经过收集点范围过滤，无权访问的任务视为不存在
      const job = await ctx.prisma.isccExportJob.findUnique({ where: { id } });
      if (!job) {
        return NextResponse.json({ message: "Export job not found" }, { status: 404 });
      }

      const now = new Date();
      const cancelledWhilePending = await ctx.prisma.isccExportJob.updateMany({
        where: { id, status: "PENDING" },
        data: {
          status: "CANCELLED",
          phase: "cancelled",
          cancelRequestedAt: now,
          completedAt: now,
        },
      });

      if (cancelledWhilePending.count === 0) {
        // 已被 worker 领取（或在上一步之后刚被领取）：只能请求停止
        const requested = await ctx.prisma.isccExportJob.updateMany({
          where: { id, status: "PROCESSING", cancelRequestedAt: null },
          data: { cancelRequestedAt: now, phase: "cancelling" },
        });
        if (requested.count === 0) {
          const current = await ctx.prisma.isccExportJob.findUnique({ where: { id } });
          const alreadyStopping = current?.status === "PROCESSING" && current.cancelRequestedAt;
          if (!alreadyStopping) {
            return NextResponse.json(
              { message: "Export job is not running", data: current },
              { status: 409 }
            );
          }
        }
      }

      const updated = await ctx.prisma.isccExportJob.findUnique({ where: { id } });
      return NextResponse.json({ data: updated });
    } catch (error) {
      console.error("Cancel ISCC export job error:", error);
      return NextResponse.json(
        { message: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
