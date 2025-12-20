import {
  atomicWriteFile as atomicWriteFileImpl,
  atomicWriteJson as atomicWriteJsonImpl,
  ensureDirForFile as ensureDirForFileImpl,
  fileExists as fileExistsImpl,
  readJsonFile as readJsonFileImpl,
  readTextFile as readTextFileImpl,
} from './cache-core.mjs';

export const fileExists: (filePath: string) => Promise<boolean> = fileExistsImpl as any;
export const ensureDirForFile: (filePath: string) => Promise<void> = ensureDirForFileImpl as any;
export const readTextFile: (filePath: string) => Promise<string | null> = readTextFileImpl as any;
export const readJsonFile: <T>(filePath: string) => Promise<T | null> = readJsonFileImpl as any;
export const atomicWriteFile: (filePath: string, contents: string) => Promise<void> =
  atomicWriteFileImpl as any;
export const atomicWriteJson: (filePath: string, value: unknown) => Promise<void> =
  atomicWriteJsonImpl as any;

export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}
