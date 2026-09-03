/**
 * 用样例数据填充三份 ISCC 表单模板，输出到 data/iscc-exports/preview/，
 * 用于改模板或字段映射后肉眼核对效果：
 *   npm run iscc:preview
 * 签名用程序画的曲线代替（不依赖签名服务）。
 */
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import { fillIsccForm, mergePdfDocuments, type IsccFormData } from "../src/lib/iscc-pdf-form";
import { ISCC_TEMPLATES, ISCC_TEMPLATE_KEYS } from "../src/lib/iscc-templates";

const OUTPUT_DIR = path.join(process.cwd(), "data", "iscc-exports", "preview");

const SAMPLE: IsccFormData = {
  storeName: "广州市白云区新苗轮胎店 (Xinmiao Tyre Store, a deliberately long name to test auto-shrink)",
  legalPerson: "张三",
  address: "No. 88 Jichang Road, Baiyun District",
  postcodeCity: "510000, Guangzhou",
  cityPostcode: "Guangzhou, 510000",
  country: "China",
  phone: "020-88886666",
  geoCoordinates: "23.123456, 113.234567",
  position: "Legal Representative",
  minVolumeCheck: false,
  maxCapacity: "50",
  maxSustainableCapacity: "50",
  collectionPoint: "Guangdong Xinmiao Rubber Co., Ltd.",
  placeDate: "Guangzhou, 2026/09/03",
  deliveredMaterial: "Biogenic fraction of end-of-life tires",
};

/** 300x100 透明底 PNG，上面一条深蓝曲线 */
function fakeSignaturePng(): Uint8Array {
  const width = 300;
  const height = 100;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let x = 10; x < width - 10; x++) {
    const y = Math.round(50 + 25 * Math.sin(x / 18) + 10 * Math.sin(x / 5));
    for (let dy = -2; dy <= 2; dy++) {
      const i = (y + dy) * (width * 4 + 1) + 1 + x * 4;
      raw[i] = 20;
      raw[i + 1] = 20;
      raw[i + 2] = 80;
      raw[i + 3] = 255;
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ])
  );
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const signature = fakeSignaturePng();
  const outputs: Uint8Array[] = [];
  for (const key of ISCC_TEMPLATE_KEYS) {
    const { file, label } = ISCC_TEMPLATES[key];
    const template = fs.readFileSync(path.join(process.cwd(), "template", file));
    const started = Date.now();
    const pdf = await fillIsccForm(template, key, SAMPLE, signature);
    const outFile = path.join(OUTPUT_DIR, `${key}.pdf`);
    fs.writeFileSync(outFile, pdf);
    outputs.push(pdf);
    console.log(`${label.padEnd(24)} -> ${path.relative(process.cwd(), outFile)} (${Date.now() - started} ms, ${(pdf.length / 1024).toFixed(0)} KB)`);
  }
  const merged = await mergePdfDocuments(outputs);
  fs.writeFileSync(path.join(OUTPUT_DIR, "merged.pdf"), merged);
  console.log(`merged.pdf: ${(merged.length / 1024).toFixed(0)} KB`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
