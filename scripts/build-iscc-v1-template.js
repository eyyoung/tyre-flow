#!/usr/bin/env node
/**
 * 由 template/ISCC.docx（ISCC PLUS v1.2 自我声明）生成带命名字段的 PDF 表单 template/ISCC.pdf。
 *
 * 官方只对 v2 版本发布了可填写的 PDF 表单；v1.2 只有我们自己维护的 docx，
 * 这里把它转换成同样形态的 AcroForm，运行时三个模板走同一套填充逻辑（src/lib/iscc-pdf-form.ts）。
 *
 * 做法：用 docxtemplater 渲染两遍 docx 并交给 LibreOffice 转 PDF
 *   A. 占位符原样保留（{storeName} ...）→ 用 pdftotext 量出每个占位符的坐标
 *   B. 文本占位符置空 → 作为干净的底稿
 *   两遍都用同尺寸的透明图占住签名位置，保证布局一致；最后用 pdf-lib 在 B 上按 A 的坐标创建字段。
 *   签名行（"Signature:"）只贴签名图、不写姓名：docx 里的 {legalPerson} 渲染时置空，不生成字段。
 *
 * 只在模板变化时手动执行一次，生成的 template/ISCC.pdf 提交进仓库：
 *   npm run iscc:build-v1-template
 * 本机需要 libreoffice、pdftotext、pdftohtml（poppler-utils）。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const ImageModule = require("docxtemplater-image-module-free");
const { PDFDocument } = require("pdf-lib");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_DOCX = path.join(ROOT, "template", "ISCC.docx");
const OUTPUT_PDF = path.join(ROOT, "template", "ISCC.pdf");

/** docx 里的文本占位符；生成的字段名与之相同（也是 IsccFormData 的键） */
const TEXT_KEYS = ["storeName", "address", "postcodeCity", "country", "collectionPoint", "placeDate"];
/** docx 里还有但不再填写的占位符，两遍渲染都置空 */
const BLANK_KEYS = ["legalPerson"];
/** 签名图占位尺寸：图片模块按 96dpi 像素计，[120, 40] px = 90 x 30 pt。只用它的高度和纵向位置，横向从 "Signature:" 标签排到右边距 */
const SIGNATURE_SIZE_PX = [120, 40];
/** 字段相对文字 bbox 的上下留白（pt） */
const FIELD_PADDING_Y = 4;
/** 页面右边距（pt）：表格值列的字段一直延伸到这里 */
const RIGHT_MARGIN = 39;
/** 底稿里 "Place, Date:" 之后留出的空白宽度（空格数），决定 "Signature:" 标签的位置 */
const PLACE_DATE_BLANK_SPACES = 21;

function transparentPng(width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const table = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function renderDocx(values, png) {
  const zip = new PizZip(fs.readFileSync(SOURCE_DOCX));
  // fontTable 里 Wingdings 2 的 charset 是 00，LibreOffice 会当普通字体把复选框渲染成 R / *；
  // 改成 02（符号字体）即可正确映射为 ☑ / ☐
  const fontTable = zip.file("word/fontTable.xml").asText();
  zip.file(
    "word/fontTable.xml",
    fontTable.replace(/(<w:font w:name="Wingdings[^"]*">[^]*?<w:charset w:val=")00("\/>)/g, "$102$2")
  );
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    modules: [
      new ImageModule({
        centered: false,
        fileType: "docx",
        getImage: () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
        getSize: () => SIGNATURE_SIZE_PX,
      }),
    ],
  });
  doc.render({ ...values, signature: `data:image/png;base64,${png.toString("base64")}` });
  return doc.getZip().generate({ type: "nodebuffer" });
}

function docxToPdf(docxPath, outDir) {
  execFileSync("libreoffice", ["--headless", "--convert-to", "pdf", "--outdir", outDir, docxPath], { stdio: "ignore" });
  const pdfPath = path.join(outDir, path.basename(docxPath, ".docx") + ".pdf");
  if (!fs.existsSync(pdfPath)) throw new Error(`LibreOffice 没有生成 ${pdfPath}`);
  return pdfPath;
}

/** pdftotext -bbox-layout：返回 { pageWidth, pageHeight, words: [{text, xMin, yMin, xMax, yMax}] }（左上角原点） */
function readWords(pdfPath) {
  const xml = execFileSync("pdftotext", ["-bbox-layout", pdfPath, "-"]).toString();
  const page = xml.match(/<page width="([\d.]+)" height="([\d.]+)">/);
  const words = [];
  for (const m of xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
    words.push({ xMin: +m[1], yMin: +m[2], xMax: +m[3], yMax: +m[4], text: m[5] });
  }
  return { pageWidth: +page[1], pageHeight: +page[2], words };
}

/** pdftohtml -xml：找出签名占位图（按 3:1 的宽高比识别），返回 pt 坐标（左上角原点） */
function findSignatureSlot(pdfPath) {
  const xml = execFileSync("pdftohtml", ["-xml", "-stdout", pdfPath], { stdio: ["ignore", "pipe", "ignore"] }).toString();
  const page = xml.match(/<page [^>]*height="([\d.]+)" width="([\d.]+)"/);
  const zoom = +page[2] / readWords(pdfPath).pageWidth; // pdftohtml 默认 1.5 倍缩放
  for (const m of xml.matchAll(/<image top="([\d.]+)" left="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
    const [top, left, width, height] = [+m[1], +m[2], +m[3], +m[4]].map((v) => v / zoom);
    if (Math.abs(width / height - SIGNATURE_SIZE_PX[0] / SIGNATURE_SIZE_PX[1]) < 0.05) return { top, left, width, height };
  }
  throw new Error("没有在底稿里找到签名占位图");
}

async function main() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "iscc-v1-"));
  const png = transparentPng(300, 100);

  const passA = path.join(workDir, "passA.docx");
  const passB = path.join(workDir, "passB.docx");
  const blanks = Object.fromEntries(BLANK_KEYS.map((k) => [k, ""]));
  fs.writeFileSync(passA, renderDocx({ ...blanks, ...Object.fromEntries(TEXT_KEYS.map((k) => [k, `{${k}}`])) }, png));
  fs.writeFileSync(
    passB,
    renderDocx(
      { ...blanks, ...Object.fromEntries(TEXT_KEYS.map((k) => [k, " "])), placeDate: " ".repeat(PLACE_DATE_BLANK_SPACES) },
      png
    )
  );
  const pdfA = docxToPdf(passA, workDir);
  const pdfB = docxToPdf(passB, workDir);

  const a = readWords(pdfA);
  const b = readWords(pdfB);
  const H = b.pageHeight;
  const RIGHT = b.pageWidth - RIGHT_MARGIN;
  const findWord = (words, text) => {
    const w = words.find((x) => x.text === text);
    if (!w) throw new Error(`没找到文字 "${text}"`);
    return w;
  };
  // 两遍渲染的静态文字位置必须一致，否则 A 量出的坐标对 B 无效
  for (const anchor of ["Country", "Recipient", "Copyright"]) {
    const wa = findWord(a.words, anchor);
    const wb = findWord(b.words, anchor);
    if (Math.abs(wa.yMin - wb.yMin) > 0.5 || Math.abs(wa.xMin - wb.xMin) > 0.5) {
      throw new Error(`两遍渲染布局不一致（${anchor}: A ${wa.xMin},${wa.yMin} vs B ${wb.xMin},${wb.yMin}）`);
    }
  }

  const pdf = await PDFDocument.load(fs.readFileSync(pdfB));
  const page = pdf.getPage(0);
  const form = pdf.getForm();
  const rectFromWord = (w, xMin, xMax) => ({
    x: xMin,
    y: H - w.yMax - FIELD_PADDING_Y,
    width: xMax - xMin,
    height: w.yMax - w.yMin + FIELD_PADDING_Y * 2,
  });
  const dateLabel = findWord(b.words, "Date:");
  const signatureLabel = findWord(b.words, "Signature:");
  const rects = {};
  for (const key of TEXT_KEYS) {
    const w = findWord(a.words, `{${key}}`);
    if (key === "placeDate") rects[key] = rectFromWord(w, dateLabel.xMax + 6, signatureLabel.xMin - 6);
    else rects[key] = rectFromWord(w, w.xMin - 2, RIGHT);
  }
  const slot = findSignatureSlot(pdfB);
  const signatureX = signatureLabel.xMax + 6;
  rects.signature = { x: signatureX, y: H - slot.top - slot.height, width: RIGHT - signatureX, height: slot.height };

  for (const [name, rect] of Object.entries(rects)) {
    const field = form.createTextField(name);
    // 透明背景、无边框：不遮住表格线和下划线
    field.addToPage(page, { ...rect, borderWidth: 0, backgroundColor: undefined, borderColor: undefined });
    field.setFontSize(10);
    console.log(`${name.padEnd(16)} x=${rect.x.toFixed(1)} y=${rect.y.toFixed(1)} w=${rect.width.toFixed(1)} h=${rect.height.toFixed(1)}`);
  }
  pdf.setTitle("ISCC PLUS Self-Declaration for Waste and Residues (v1.2)");
  pdf.setProducer("tyre-flow build-iscc-v1-template");
  fs.writeFileSync(OUTPUT_PDF, await pdf.save());
  fs.rmSync(workDir, { recursive: true, force: true });
  console.log(`\n已生成 ${path.relative(ROOT, OUTPUT_PDF)}（${Object.keys(rects).length} 个字段）`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
