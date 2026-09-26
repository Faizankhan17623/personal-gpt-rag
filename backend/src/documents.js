import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { CHUNK_SIZE, CHUNK_OVERLAP } from './config.js';
import { UserError } from './errors.js';

export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];

// Extracts plain text from an uploaded file buffer.
export async function extractText(buffer, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new UserError(`Unsupported file type "${ext || 'unknown'}". Upload a PDF, Word (.docx), TXT or Markdown file.`);
  }

  if (ext === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      return (await parser.getText()).text;
    } catch {
      throw new UserError('Could not read this PDF. It may be damaged or password-protected.');
    } finally {
      await parser.destroy();
    }
  }
  if (ext === '.docx') return (await mammoth.extractRawText({ buffer })).value;
  return buffer.toString('utf8');
}

// Splits text into overlapping chunks, preferring paragraph, line and sentence breaks.
export function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0 ||
      !Number.isInteger(overlap) || overlap < 0 || overlap >= chunkSize) {
    throw new Error('chunkSize must be a positive integer, and overlap must be between 0 and chunkSize - 1.');
  }

  const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length);
    if (end < clean.length) {
      // Break at the last natural boundary in the second half of the window.
      const window = clean.slice(start + Math.floor(chunkSize / 2), end);
      const boundary = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf('. '));
      if (boundary !== -1) end = start + Math.floor(chunkSize / 2) + boundary + 1;
    }
    const chunk = clean.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

