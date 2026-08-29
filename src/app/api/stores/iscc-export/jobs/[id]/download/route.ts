import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { resolveIsccExportPath } from "@/lib/iscc-export-generator";
import { standardMiddlewares, withMiddlewares } from "@/lib/middleware";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withMiddlewares(request, standardMiddlewares, async (ctx) => {
    try {
      const { id } = await params;
      const job = await ctx.prisma.isccExportJob.findUnique({ where: { id } });
      if (!job) {
        return NextResponse.json({ message: "Export job not found" }, { status: 404 });
      }
      if (job.status === "EXPIRED") {
        return NextResponse.json({ message: "Export file has expired" }, { status: 410 });
      }
      if (job.status !== "COMPLETED" || !job.filePath || !job.fileName) {
        return NextResponse.json(
          { message: "Export file is not ready" },
          { status: 409 }
        );
      }

      const filePath = resolveIsccExportPath(job.filePath);
      const fileInfo = await stat(filePath);
      const nodeStream = createReadStream(filePath);
      const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

      return new NextResponse(webStream, {
        headers: {
          "Content-Type": job.fileType || "application/octet-stream",
          "Content-Length": fileInfo.size.toString(),
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
            job.fileName
          )}`,
          "Cache-Control": "private, no-store",
        },
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return NextResponse.json({ message: "Export file not found" }, { status: 410 });
      }
      console.error("Download ISCC export error:", error);
      return NextResponse.json(
        { message: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
