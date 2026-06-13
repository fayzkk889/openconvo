import { Attachment } from '@/types/chat';
import { generateId } from './utils';

interface PdfTextItem {
  str?: string;
}

const TEXT_EXTENSIONS = [
  '.txt', '.md', '.json', '.csv', '.py', '.js', '.ts', '.tsx', '.jsx',
  '.html', '.css', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.sh', '.bash', '.sql', '.r', '.go', '.rs', '.java', '.c', '.cpp',
  '.h', '.hpp', '.rb', '.php', '.swift', '.kt', '.scala', '.env',
  '.gitignore', '.dockerfile', '.makefile', '.log',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function parseFile(file: File): Promise<Attachment> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File is too large: ${file.name}`);
  }

  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  let content: string;

  if (ext === '.pdf') {
    content = await extractPdfText(file);
  } else if (TEXT_EXTENSIONS.includes(ext) || file.type.startsWith('text/')) {
    content = await file.text();
  } else {
    // Try reading as text, fallback to noting it's unsupported
    try {
      content = await file.text();
      // Check if it looks like binary
      if (/[\x00-\x08\x0E-\x1F]/.test(content.slice(0, 1000))) {
        content = `[Binary file: ${file.name} (${file.type || 'unknown type'}, ${formatSize(file.size)})]`;
      }
    } catch {
      content = `[Unable to read file: ${file.name}]`;
    }
  }

  return {
    id: generateId(),
    name: file.name,
    type: file.type || ext,
    size: file.size,
    content: content.slice(0, 50000), // Cap at 50k chars
  };
}

async function extractPdfText(file: File): Promise<string> {
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    
    // Set worker source
    if (typeof window !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages: string[] = [];

    for (let i = 1; i <= Math.min(pdf.numPages, 50); i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => ('str' in item ? (item as PdfTextItem).str || '' : ''))
        .join(' ');
      if (text.trim()) pages.push(text);
    }

    return pages.join('\n\n') || '[PDF contained no extractable text]';
  } catch (error) {
    console.error('PDF extraction failed:', error);
    return `[Failed to extract text from PDF: ${file.name}]`;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export const ACCEPTED_FILE_TYPES = [
  '.txt', '.md', '.pdf', '.json', '.csv',
  '.py', '.js', '.ts', '.tsx', '.jsx',
  '.html', '.css', '.xml', '.yaml', '.yml',
  '.sql', '.sh', '.go', '.rs', '.java',
  '.c', '.cpp', '.rb', '.php', '.log',
].join(',');
