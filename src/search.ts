import { readFileSync, statSync } from "node:fs";
import { relative } from "node:path";
import { listSourceFiles } from "./graph/files.js";
import { rankHybridSearchResults } from "./search/semantic.js";
import type { CodeGraphSettings } from "./types.js";

const DEFAULT_MAX_RESULTS = 100;
const MAX_RESULTS_LIMIT = 10_000;
const MAX_CONTEXT_LINES = 100;
const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const BINARY_SAMPLE_BYTES = 512;

export interface SearchOptions {
  pattern: string;
  regex?: boolean;
  caseSensitive?: boolean;
  contextLines?: number;
  maxResults?: number;
  maxFileSizeBytes?: number;
  include?: string[];
  exclude?: string[];
}

export interface SearchResult {
  file: string;
  line: number;
  column: number;
  text: string;
  contextBefore: string[];
  contextAfter: string[];
  fileSizeBytes: number;
  matchLength: number;
  lexicalScore?: number;
  graphScore?: number;
}

export interface SearchReadError {
  file: string;
  reason: string;
}

export interface SearchStats {
  filesConsidered: number;
  filesSearched: number;
  filesSkipped: number;
  binaryFilesSkipped: number;
  oversizedFilesSkipped: number;
  readErrors: SearchReadError[];
  totalMatches: number;
  truncated: boolean;
}

export interface SearchOutput {
  results: SearchResult[];
  stats: SearchStats;
}

interface NormalizedSearchOptions extends Required<SearchOptions> {}

interface MatchColumn {
  column: number;
  length: number;
}

export function searchCodebase(
  root: string,
  settings: CodeGraphSettings,
  options: SearchOptions,
): SearchOutput {
  const normalized = normalizeSearchOptions(options);
  const matcher = createMatcher(normalized);
  const results: SearchResult[] = [];
  const stats: SearchStats = {
    filesConsidered: 0,
    filesSearched: 0,
    filesSkipped: 0,
    binaryFilesSkipped: 0,
    oversizedFilesSkipped: 0,
    readErrors: [],
    totalMatches: 0,
    truncated: false,
  };

  for (const file of listSourceFiles(root, settings)) {
    const rel = relative(root, file);
    if (!matchesSearchScope(rel, normalized)) {
      stats.filesSkipped += 1;
      continue;
    }

    stats.filesConsidered += 1;
    const fileData = readSearchableFile(file, rel, normalized, stats);
    if (!fileData) continue;

    stats.filesSearched += 1;
    const lines = fileData.text.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      for (const match of matcher(lines[index])) {
        stats.totalMatches += 1;
        results.push({
          file: rel,
          line: index + 1,
          column: match.column,
          text: lines[index],
          contextBefore: lines.slice(Math.max(0, index - normalized.contextLines), index),
          contextAfter: lines.slice(index + 1, index + 1 + normalized.contextLines),
          fileSizeBytes: fileData.size,
          matchLength: match.length,
          lexicalScore: 1.0,
          graphScore: 0,
        });

        if (results.length >= normalized.maxResults) {
          stats.truncated = true;
          return applyHybridRanking({ results, stats });
        }
      }
    }
  }

  return applyHybridRanking({ results, stats });
}

function applyHybridRanking(output: SearchOutput): SearchOutput {
  if (output.results.length === 0) return output;

  const candidates = output.results.map((result, index) => ({
    id: `${index}`,
    lexicalScore: result.lexicalScore ?? 1.0,
    graphScore: result.graphScore ?? 0,
  }));

  const weights = { lexicalWeight: 0.7, graphWeight: 0.3 };
  const ranked = rankHybridSearchResults(candidates, weights);

  const rankedResults = ranked.map((candidate) => output.results[parseInt(candidate.id, 10)]!);

  return { results: rankedResults, stats: output.stats };
}

export function normalizeSearchOptions(options: SearchOptions): NormalizedSearchOptions {
  const pattern = options.pattern;
  if (!pattern) throw new Error("Search pattern is required.");

  return {
    pattern,
    regex: options.regex === true,
    caseSensitive: options.caseSensitive === true,
    contextLines: boundedInteger(options.contextLines ?? 0, "contextLines", 0, MAX_CONTEXT_LINES),
    maxResults: boundedInteger(
      options.maxResults ?? DEFAULT_MAX_RESULTS,
      "maxResults",
      1,
      MAX_RESULTS_LIMIT,
    ),
    maxFileSizeBytes: boundedInteger(
      options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES,
      "maxFileSizeBytes",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    include: options.include ?? [],
    exclude: options.exclude ?? [],
  };
}

function readSearchableFile(
  file: string,
  rel: string,
  options: NormalizedSearchOptions,
  stats: SearchStats,
): { text: string; size: number } | undefined {
  try {
    const size = statSync(file).size;
    if (size > options.maxFileSizeBytes) {
      stats.filesSkipped += 1;
      stats.oversizedFilesSkipped += 1;
      return undefined;
    }

    const buffer = readFileSync(file);
    if (isBinaryBuffer(buffer)) {
      stats.filesSkipped += 1;
      stats.binaryFilesSkipped += 1;
      return undefined;
    }

    return { text: buffer.toString("utf8"), size };
  } catch (error) {
    stats.filesSkipped += 1;
    stats.readErrors.push({
      file: rel,
      reason: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function createMatcher(options: NormalizedSearchOptions): (line: string) => MatchColumn[] {
  if (!options.regex)
    return (line) => literalColumns(line, options.pattern, options.caseSensitive === true);

  const flags = options.caseSensitive === true ? "g" : "gi";
  let regex: RegExp;
  try {
    regex = new RegExp(options.pattern, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid regex pattern: ${message}`);
  }

  return (line) => regexColumns(line, regex);
}

function literalColumns(line: string, pattern: string, caseSensitive: boolean): MatchColumn[] {
  const source = caseSensitive ? line : line.toLowerCase();
  const needle = caseSensitive ? pattern : pattern.toLowerCase();
  const columns: MatchColumn[] = [];
  let index = source.indexOf(needle);

  while (index !== -1) {
    columns.push({ column: index + 1, length: pattern.length });
    index = source.indexOf(needle, index + Math.max(needle.length, 1));
  }

  return columns;
}

function regexColumns(line: string, regex: RegExp): MatchColumn[] {
  regex.lastIndex = 0;
  const columns: MatchColumn[] = [];
  let match = regex.exec(line);

  while (match) {
    columns.push({ column: match.index + 1, length: match[0].length });
    if (match[0].length === 0) regex.lastIndex += 1;
    match = regex.exec(line);
  }

  return columns;
}

function matchesSearchScope(file: string, options: NormalizedSearchOptions): boolean {
  if (options.include.length > 0 && !options.include.some((pattern) => globMatches(file, pattern)))
    return false;
  return !options.exclude.some((pattern) => globMatches(file, pattern));
}

function globMatches(file: string, pattern: string): boolean {
  return globToRegExp(pattern).test(file);
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegExp(char);
    }
  }

  return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const sampleLength = Math.min(buffer.length, BINARY_SAMPLE_BYTES);
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
}

function boundedInteger(value: number, name: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}
