import { readFile, writeFile, rename } from 'fs/promises';

export async function readPrgFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8');
}

export async function writePrgFileAtomic(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, filePath);
}

export async function readImageAsBuffer(filePath: string): Promise<{ buffer: Buffer; mime: string }> {
  const buffer = await readFile(filePath);
  const ext = filePath.split('.').pop()?.toLowerCase();
  const mime = ext === 'png' ? 'image/png' : 'image/bmp';
  return { buffer, mime };
}
