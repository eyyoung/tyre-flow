import { NextRequest, NextResponse } from "next/server";
import { generateSingleIsccPdf } from "@/lib/iscc-export-generator";
import {
  DEFAULT_ISCC_LANGUAGE,
  DEFAULT_ISCC_TEMPLATE,
  isIsccExportLanguage,
  isIsccTemplateKey,
} from "@/lib/iscc-templates";
import { standardMiddlewares, withMiddlewares } from "@/lib/middleware";

const ACTIVE_JOB_STATUSES = ["PENDING", "PROCESSING"] as const;

function resolveExportOptions(
  template: unknown,
  lang: unknown
):
  | { ok: true; template: string; lang: string }
  | { ok: false; message: string } {
  if (template != null && template !== "" && !isIsccTemplateKey(template)) {
    return { ok: false, message: "Invalid ISCC template" };
  }
  if (lang != null && lang !== "" && !isIsccExportLanguage(lang)) {
    return { ok: false, message: "Invalid export language" };
  }
  return {
    ok: true,
    template: isIsccTemplateKey(template) ? template : DEFAULT_ISCC_TEMPLATE,
    lang: isIsccExportLanguage(lang) ? lang : DEFAULT_ISCC_LANGUAGE,
  };
}

// Keep the existing single-store download behavior.
export async function GET(request: NextRequest) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { searchParams } = new URL(request.url);
      const storeId = searchParams.get("storeId");
      const options = resolveExportOptions(
        searchParams.get("template"),
        searchParams.get("lang")
      );

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

      const result = await generateSingleIsccPdf(
        storeId,
        options.lang,
        isIsccTemplateKey(options.template)
          ? options.template
          : DEFAULT_ISCC_TEMPLATE
      );
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
        template?: string;
      };
      const collectionPointId = body.collectionPointId;
      const options = resolveExportOptions(body.template, body.lang);

      if (!collectionPointId) {
        return NextResponse.json(
          { message: "Collection point ID is required" },
          { status: 400 }
        );
      }
      if (!options.ok) {
        return NextResponse.json({ message: options.message }, { status: 400 });
      }
      const { template, lang } = options;

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

      // 同一收集点、同一模板和语言的进行中任务直接复用
      const existingJob = await ctx.prisma.isccExportJob.findFirst({
        where: {
          collectionPointId,
          template,
          language: lang,
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
          template,
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
