import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withAuth } from '@/lib/auth';
import * as fs from 'fs';
import * as path from 'path';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import JSZip from 'jszip';
import dayjs from 'dayjs';

// 生成单个门店的 ISCC 声明 Word 文件
async function generateIsccDocument(
  store: {
    code: string;
    name: string;
    legalPerson: string | null;
    address: string;
    province: string | null;
    city: string | null;
    district: string | null;
  },
  collectionPoint: {
    name: string;
    companyName: string | null;
    city: string | null;
    province: string | null;
    postcode: string | null;
  },
  templateContent: string
): Promise<Buffer> {
  // 创建新的 PizZip 实例
  const zipDoc = new PizZip(templateContent);
  
  // 创建 Docxtemplater 实例
  const doc = new Docxtemplater(zipDoc, {
    paragraphLoop: true,
    linebreaks: true,
  });

  // 当前日期
  const currentDate = dayjs().format('YYYY-MM-DD');
  // 地点精确到市
  const place = collectionPoint.city || collectionPoint.province || 'China';
  const placeDate = `${place}, ${currentDate}`;

  // 邮编+城市
  const postcodeCity = [
    collectionPoint.postcode,
    collectionPoint.city,
  ].filter(Boolean).join(', ') || '-';

  // 构造完整地址
  const fullAddress = [
    store.province,
    store.city,
    store.district,
    store.address,
  ].filter(Boolean).join(' ');

  // 填充数据（使用公司名，如果没有则回退到简称）
  doc.render({
    storeName: store.name,
    legalPerson: store.legalPerson || '-',
    address: fullAddress || store.address,
    postcodeCity: postcodeCity,
    country: 'China',
    collectionPoint: collectionPoint.companyName || collectionPoint.name,
    placeDate: placeDate,
  });

  // 生成文件
  return doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
}

// 导出 ISCC 声明
export async function GET(request: NextRequest) {
  return withAuth(request, async () => {
    try {
      const { searchParams } = new URL(request.url);
      const collectionPointId = searchParams.get('collectionPointId');
      const storeId = searchParams.get('storeId');

      // 读取 Word 模板
      const templatePath = path.join(process.cwd(), 'template', 'ISCC.docx');
      const templateContent = fs.readFileSync(templatePath, 'binary');

      // 单个门店导出
      if (storeId) {
        const store = await prisma.store.findUnique({
          where: { id: storeId },
          include: {
            collectionPoint: true,
          },
        });

        if (!store) {
          return NextResponse.json(
            { message: 'Store not found' },
            { status: 404 }
          );
        }

        const buf = await generateIsccDocument(
          store,
          store.collectionPoint,
          templateContent
        );

        const fileName = `ISCC_${store.code}_${store.name.replace(/[/\\?%*:|"<>]/g, '_')}.docx`;

        return new NextResponse(buf, {
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
            'Content-Length': buf.length.toString(),
          },
        });
      }

      // 批量导出（按收集点）
      if (!collectionPointId) {
        return NextResponse.json(
          { message: 'Collection point ID or Store ID is required' },
          { status: 400 }
        );
      }

      // 获取收集点信息
      const collectionPoint = await prisma.collectionPoint.findUnique({
        where: { id: collectionPointId },
      });

      if (!collectionPoint) {
        return NextResponse.json(
          { message: 'Collection point not found' },
          { status: 404 }
        );
      }

      // 获取所有活跃且非虚拟的门店
      const stores = await prisma.store.findMany({
        where: {
          collectionPointId,
          status: 'ACTIVE',
          isVirtual: false,
        },
        orderBy: { code: 'asc' },
      });

      if (stores.length === 0) {
        return NextResponse.json(
          { message: 'No stores found for this collection point' },
          { status: 404 }
        );
      }

      // 创建 ZIP 文件
      const zip = new JSZip();
      const currentDate = dayjs().format('YYYY-MM-DD');

      // 为每个门店生成 Word 文件
      for (const store of stores) {
        try {
          const buf = await generateIsccDocument(
            store,
            collectionPoint,
            templateContent
          );

          // 添加到 ZIP，使用门店编码作为文件名
          const fileName = `ISCC_${store.code}_${store.name.replace(/[/\\?%*:|"<>]/g, '_')}.docx`;
          zip.file(fileName, buf);
        } catch (error) {
          console.error(`Error generating ISCC for store ${store.code}:`, error);
          // 继续处理其他门店
        }
      }

      // 生成 ZIP 文件
      const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
      });

      // 返回 ZIP 文件
      const zipFileName = `ISCC_${collectionPoint.code}_${currentDate}.zip`;
      
      return new NextResponse(zipBuffer, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(zipFileName)}"`,
          'Content-Length': zipBuffer.length.toString(),
        },
      });
    } catch (error) {
      console.error('Export ISCC error:', error);
      return NextResponse.json(
        { message: 'Internal server error' },
        { status: 500 }
      );
    }
  });
}

