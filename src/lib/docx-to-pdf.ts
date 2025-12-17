import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const execAsync = promisify(exec);

/**
 * 获取 LibreOffice 命令
 * Mac 上是 soffice，Linux 上是 libreoffice
 */
function getLibreOfficeCommand(): string {
  if (process.platform === 'darwin') {
    // macOS - 优先使用 Homebrew 安装的 soffice
    return 'soffice';
  }
  // Linux
  return 'libreoffice';
}

/**
 * 使用 LibreOffice 将 Word 文档转换为 PDF
 * @param docxBuffer - Word 文档的 Buffer
 * @returns PDF 文件的 Buffer
 */
export async function convertDocxToPdf(docxBuffer: Buffer): Promise<Buffer> {
  // 创建临时目录
  const tempDir = path.join(os.tmpdir(), `docx-pdf-${crypto.randomUUID()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const inputPath = path.join(tempDir, 'input.docx');
  const outputPath = path.join(tempDir, 'input.pdf');

  try {
    // 写入临时 Word 文件
    fs.writeFileSync(inputPath, docxBuffer);

    // 获取对应平台的 LibreOffice 命令
    const libreOfficeCmd = getLibreOfficeCommand();

    // 使用 LibreOffice 转换
    // --headless: 无界面模式
    // --convert-to pdf: 转换为 PDF
    // --outdir: 输出目录
    // 设置环境变量确保在容器中正常运行
    const env = {
      ...process.env,
      HOME: process.env.HOME || '/tmp',
      // 禁用 dconf 写入，避免权限问题
      DCONF_PROFILE: '',
    };
    await execAsync(
      `${libreOfficeCmd} --headless --convert-to pdf --outdir "${tempDir}" "${inputPath}"`,
      { timeout: 60000, env } // 60秒超时
    );

    // 读取生成的 PDF 文件
    if (!fs.existsSync(outputPath)) {
      throw new Error('PDF conversion failed: output file not found');
    }

    const pdfBuffer = fs.readFileSync(outputPath);
    return pdfBuffer;
  } finally {
    // 清理临时文件
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }
}

/**
 * 批量转换多个 Word 文档为 PDF
 * @param documents - 文档数组，包含名称和 Buffer
 * @returns PDF 文件数组
 */
export async function batchConvertDocxToPdf(
  documents: Array<{ name: string; buffer: Buffer }>
): Promise<Array<{ name: string; buffer: Buffer }>> {
  const results: Array<{ name: string; buffer: Buffer }> = [];

  for (const doc of documents) {
    try {
      const pdfBuffer = await convertDocxToPdf(doc.buffer);
      // 将文件扩展名从 .docx 改为 .pdf
      const pdfName = doc.name.replace(/\.docx$/i, '.pdf');
      results.push({ name: pdfName, buffer: pdfBuffer });
    } catch (error) {
      console.error(`Failed to convert ${doc.name} to PDF:`, error);
      throw error;
    }
  }

  return results;
}

