import { readFile, writeFile, rename } from 'fs/promises';

export async function readPrgFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8');
}

export async function writePrgFileAtomic(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, filePath);
}

export async function readImageAsBase64(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return buf.toString('base64');
}
