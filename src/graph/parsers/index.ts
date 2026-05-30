import { goParser } from "./go.js";
import { javaParser } from "./java.js";
import { javascriptParser, typescriptParser } from "./javascript.js";
import { kotlinParser } from "./kotlin.js";
import type { LanguageParser } from "./LanguageParser.js";
import { pythonParser } from "./python.js";
import { rustParser } from "./rust.js";

const parsers: Record<string, LanguageParser> = {
  java: javaParser,
  kotlin: kotlinParser,
  go: goParser,
  python: pythonParser,
  rust: rustParser,
  javascript: javascriptParser,
  typescript: typescriptParser,
};

export function getParser(language: string): LanguageParser | undefined {
  return parsers[language];
}

export type { LanguageParser };
