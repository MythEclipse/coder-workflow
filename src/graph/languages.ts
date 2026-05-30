import { extname } from "node:path";

const languageByExtension = new Map([
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".py", "python"],
  [".go", "go"],
  [".rs", "rust"],
  [".java", "java"],
  [".kt", "kotlin"],
  [".kts", "kotlin"],
]);

export function languageForPath(filePath: string): string | undefined {
  return languageByExtension.get(extname(filePath));
}
