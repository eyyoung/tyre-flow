import { NextRequest, NextResponse } from "next/server";
import { withMiddlewares, standardMiddlewares } from "@/lib/middleware";
import { getInventorySummary } from "@/lib/inventory";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { id } = await params;
      const { searchParams } = new URL(request.url);
      const startDate = searchParams.get("startDate") || "";
      const endDate = searchParams.get("endDate") || "";

      if (!startDate || !endDate) {
        return NextResponse.json(
          { error: "开始日期和结束日期为必填项" },
          { status: 400 }
        );
      }

      const collectionPoint = await ctx.prisma.collectionPoint.findUnique({
        where: { id },
        select: { id: true },
      });

      if (!collectionPoint) {
        return NextResponse.json({ error: "收集点不存在" }, { status: 404 });
      }

      const summary = await getInventorySummary(ctx.prisma, {
        collectionPointId: id,
        startDate,
        endDate,
      });

      return NextResponse.json({ data: summary });
    } catch (error) {
      console.error("Get inventory summary error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "获取库存失败" },
        { status: 500 }
      );
    }
  });
}
