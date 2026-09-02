import { NextRequest, NextResponse } from "next/server";
import { generateSingleIsccPdf } from "@/lib/iscc-export-generator";
import {
  DEFAULT_ISCC_TEMPLATE,
  ISCC_EXPORT_LANGUAGE,
  ISCC_TEST_EXPORT_STORE_LIMIT,
  isIsccTemplateKey,
  type IsccTemplateKey,
} from "@/lib/iscc-templates";
import { standardMiddlewares, withMiddlewares } from "@/lib/middleware";

const ACTIVE_JOB_STATUSES = ["PENDING", "PROCESSING"] as const;

function resolveTemplate(
  template: unknown
): { ok: true; template: IsccTemplateKey } | { ok: false; message: string } {
  if (template != null && template !== "" && !isIsccTemplateKey(template)) {
    return { ok: false, message: "Invalid ISCC template" };
  }
  return {
    ok: true,
    template: isIsccTemplateKey(template) ? template : DEFAULT_ISCC_TEMPLATE,
  };
}

// Keep the existing single-store download behavior.
export async function GET(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const storeId = searchParams.get("storeId");
      const options = resolveTemplate(searchParams.get("template"));

      if (!storeId) {
        return NextResponse.json(
          { message: "Store ID is required" },
          { status: 400 }
        );
      }
      if (!options.ok) {
        return NextResponse.json({ message: options.message }, { status: 400 });
      }

      // The scoped client verifies that the user can access this store.
      const accessibleStore = await ctx.prisma.store.findUnique({
        where: { id: storeId },
        select: { id: true },
      });
      if (!accessibleStore) {
        return NextResponse.json({ message: "Store not found" }, { status: 404 });
      }

      const result = await generateSingleIsccPdf(storeId, options.template);
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
        template?: string;
        testMode?: boolean;
      };
      const collectionPointId = body.collectionPointId;
      const options = resolveTemplate(body.template);
      const testMode = body.testMode === true;

      if (!collectionPointId) {
        return NextResponse.json(
          { message: "Collection point ID is required" },
          { status: 400 }
        );
      }
      if (!options.ok) {
        return NextResponse.json({ message: options.message }, { status: 400 });
      }
      const { template } = options;

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

      const storeCount = await ctx.prisma.store.count({
        where: {
          collectionPointId,
          status: "ACTIVE",
          isVirtual: false,
        },
      });
      if (storeCount === 0) {
        return NextResponse.json(
          { message: "No active non-virtual stores found" },
          { status: 400 }
        );
      }
      // 「仅测试用」只导出前 N 家门店
      const total = testMode
        ? Math.min(storeCount, ISCC_TEST_EXPORT_STORE_LIMIT)
        : storeCount;

      // 同一收集点、同一模板、同一模式的进行中任务直接复用
      const existingJob = await ctx.prisma.isccExportJob.findFirst({
        where: {
          collectionPointId,
          template,
          testMode,
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
          language: ISCC_EXPORT_LANGUAGE,
          template,
          testMode,
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
