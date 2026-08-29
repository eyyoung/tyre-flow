import { NextRequest, NextResponse } from "next/server";
import { generateSingleIsccPdf } from "@/lib/iscc-export-generator";
import { standardMiddlewares, withMiddlewares } from "@/lib/middleware";

const ACTIVE_JOB_STATUSES = ["PENDING", "PROCESSING"] as const;

// Keep the existing single-store download behavior.
export async function GET(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const storeId = searchParams.get("storeId");
      const lang = searchParams.get("lang") || "zh";

      if (!storeId) {
        return NextResponse.json(
          { message: "Store ID is required" },
          { status: 400 }
        );
      }

      // The scoped client verifies that the user can access this store.
      const accessibleStore = await ctx.prisma.store.findUnique({
        where: { id: storeId },
        select: { id: true },
      });
      if (!accessibleStore) {
        return NextResponse.json({ message: "Store not found" }, { status: 404 });
      }

      const result = await generateSingleIsccPdf(storeId, lang);
      if (!result) {
        return NextResponse.json({ message: "Store not found" }, { status: 404 });
      }

      return new NextResponse(new Uint8Array(result.buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
            result.fileName
          )}`,
          "Content-Length": result.buffer.length.toString(),
        },
      });
    } catch (error) {
      console.error("Export single ISCC error:", error);
      return NextResponse.json(
        { message: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

// Submit a persistent background export job.
export async function POST(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const body = (await request.json()) as {
        collectionPointId?: string;
        lang?: string;
      };
      const collectionPointId = body.collectionPointId;
      const lang = body.lang || "zh";

      if (!collectionPointId) {
        return NextResponse.json(
          { message: "Collection point ID is required" },
          { status: 400 }
        );
      }

      const collectionPoint = await ctx.prisma.collectionPoint.findUnique({
        where: { id: collectionPointId },
        select: { id: true },
      });
      if (!collectionPoint) {
        return NextResponse.json(
          { message: "Collection point not found" },
          { status: 404 }
        );
      }

      const total = await ctx.prisma.store.count({
        where: {
          collectionPointId,
          status: "ACTIVE",
          isVirtual: false,
        },
      });
      if (total === 0) {
        return NextResponse.json(
          { message: "No active non-virtual stores found" },
          { status: 400 }
        );
      }

      const existingJob = await ctx.prisma.isccExportJob.findFirst({
        where: {
          collectionPointId,
          status: { in: [...ACTIVE_JOB_STATUSES] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (existingJob) {
        return NextResponse.json({ data: existingJob, reused: true });
      }

      const job = await ctx.prisma.isccExportJob.create({
        data: {
          collectionPointId,
          requestedById: ctx.user?.userId,
          language: lang,
          total,
        },
      });

      return NextResponse.json({ data: job, reused: false }, { status: 202 });
    } catch (error) {
      console.error("Create ISCC export job error:", error);
      return NextResponse.json(
        { message: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
