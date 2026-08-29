import { NextRequest, NextResponse } from "next/server";
import { standardMiddlewares, withMiddlewares } from "@/lib/middleware";

export async function GET(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const collectionPointId = searchParams.get("collectionPointId");
      const requestedLimit = Number(searchParams.get("limit") || 10);
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(20, Math.floor(requestedLimit)))
        : 10;

      if (!collectionPointId) {
        return NextResponse.json(
          { message: "Collection point ID is required" },
          { status: 400 }
        );
      }

      const jobs = await ctx.prisma.isccExportJob.findMany({
        where: { collectionPointId },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return NextResponse.json({ data: jobs });
    } catch (error) {
      console.error("List ISCC export jobs error:", error);
      return NextResponse.json(
        { message: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
