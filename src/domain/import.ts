import { emptyProfile, type Profile } from './model';
export async function extractText(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error('请选择小于 10 MB 的文件');
  let text = '';
  if (/\.pdf$/i.test(file.name)) {
    const pdf = await import('pdfjs-dist');
    const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdf.GlobalWorkerOptions.workerSrc = workerUrl;
    const task = pdf.getDocument({ data: await file.arrayBuffer(), useSystemFonts: true });
    const doc = await task.promise;
    try {
      if (doc.numPages > 30) throw new Error('仅支持 30 页以内的简历');
      for (let i = 1; i <= doc.numPages; i++) {
        const content = await (await doc.getPage(i)).getTextContent();
        text +=
          content.items
            .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
            .join('') + '\n';
      }
    } finally {
      await task.destroy();
    }
  } else if (/\.docx$/i.test(file.name)) {
    const mammoth = await import('mammoth');
    text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  } else if (/\.txt$/i.test(file.name)) text = await file.text();
  else throw new Error('支持文本型 PDF、DOCX 和 TXT');
  if (!text.trim()) throw new Error('未提取到文本。扫描版 PDF 请先转为文字，或手工录入');
  if (text.length > 100000) throw new Error('文本过长，请精简后导入');
  return text.trim();
}
export function draftFromText(text: string): Profile {
  const p = emptyProfile('导入的简历');
  p.personal.email = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] || '';
  p.personal.phone = text.match(/(?<!\d)1[3-9]\d{9}(?!\d)/)?.[0] || '';
  p.personal.name = text.match(/(?:姓名|name)\s*[:：]\s*([^\n,，;；]{2,30})/i)?.[1]?.trim() || '';
  p.personal.city =
    text.match(/(?:现居城市|居住地)\s*[:：]\s*([^\n,，;；]{2,30})/)?.[1]?.trim() || '';
  // Full extracted text stays in the import preview, never silently added as resume facts.
  return p;
}
