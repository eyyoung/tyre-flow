import { NextRequest, NextResponse } from "next/server";
import { standardMiddlewares, withMiddlewares } from "@/lib/middleware";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { id } = await params;
      const job = await ctx.prisma.isccExportJob.findUnique({
        where: { id },
      });
      if (!job) {
        return NextResponse.json({ message: "Export job not found" }, { status: 404 });
      }
      return NextResponse.json({ data: job });
    } catch (error) {
      console.error("Get ISCC export job error:", error);
      return NextResponse.json(
        { message: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
