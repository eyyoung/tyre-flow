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

// 转换超时时间（毫秒）- 大文档可能需要较长时间
const CONVERSION_TIMEOUT = 5 * 60 * 1000; // 5 分钟

/**
 * 使用 LibreOffice 将 Word 文档转换为 PDF
 * @param docxBuffer - Word 文档的 Buffer
 * @returns PDF 文件的 Buffer
 */
export async function convertDocxToPdf(docxBuffer: Buffer): Promise<Buffer> {
  // 创建临时目录（同时用于文档和 LibreOffice 用户配置）
  const sessionId = crypto.randomUUID();
  const tempDir = path.join(os.tmpdir(), `docx-pdf-${sessionId}`);
  const userInstallDir = path.join(os.tmpdir(), `lo-profile-${sessionId}`);
  
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(userInstallDir, { recursive: true });

  const inputPath = path.join(tempDir, 'input.docx');
  const outputPath = path.join(tempDir, 'input.pdf');

  try {
    // 写入临时 Word 文件
    fs.writeFileSync(inputPath, docxBuffer);

    // 获取对应平台的 LibreOffice 命令
    const libreOfficeCmd = getLibreOfficeCommand();

    // 设置环境变量确保在容器中正常运行
    const env = {
      ...process.env,
      HOME: process.env.HOME || '/tmp',
      // 禁用 dconf 写入，避免权限问题
      DCONF_PROFILE: '',
    };

    // 使用 LibreOffice 转换
    // --headless: 无界面模式
    // --convert-to pdf: 转换为 PDF
    // --outdir: 输出目录
    // -env:UserInstallation: 独立的用户配置目录，避免并发冲突
    // --nofirststartwizard: 跳过首次启动向导
    // --norestore: 不恢复之前的会话
    const command = [
      libreOfficeCmd,
      '--headless',
      '--nofirststartwizard',
      '--norestore',
      `-env:UserInstallation=file://${userInstallDir}`,
      '--convert-to pdf',
      `--outdir "${tempDir}"`,
      `"${inputPath}"`,
    ].join(' ');

    await execAsync(command, { 
      timeout: CONVERSION_TIMEOUT,
      env,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
    });

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
    try {
      fs.rmSync(userInstallDir, { recursive: true, force: true });
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

