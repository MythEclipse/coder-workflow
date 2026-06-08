#!/usr/bin/env node
/**
 * Trade-Off Analyzer
 *
 * Compares technical approaches on multiple criteria, records decisions,
 * validates outcomes over time, and surfaces patterns of what works best.
 *
 * Storage: .claude/trade-off-analyzer/entries.jsonl  (one JSON TradeoffEntry per line)
 *
 * Follows the same storage / formatting pattern as todo-tracker.ts:
 *   - JSONL append-only log for writes, full rewrite for updates
 *   - Pure functions, sync I/O, no external dependencies
 *   - Markdown formatting for human-readable output
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComplexityLevel = "low" | "medium" | "high";
export type OutcomeType = "validated" | "wrong" | "unknown";

export interface Approach {
  /** Short label (e.g. "Microservices", "Monolith") */
  name: string;
  /** One-line description */
  description: string;
  /** List of advantages */
  pros: string[];
  /** List of disadvantages */
  cons: string[];
  /** Implementation complexity */
  complexity: ComplexityLevel;
  /** Runtime performance */
  performance: ComplexityLevel;
  /** Ease of maintenance */
  maintainability: ComplexityLevel;
  /** Security posture */
  security: ComplexityLevel;
}

export interface TradeoffEntry {
  /** Unique identifier (tradeoff-{timestamp}-{random}) */
  id: string;
  /** Creation ISO-8601 timestamp */
  timestamp: string;
  /** Decision context (e.g. "Choosing a database for the logging system") */
  context: string;
  /** Approaches under consideration */
  approaches: Approach[];
  /** Evaluation criteria used */
  criteria: string[];
  /** Name of the recommended approach */
  recommended: string;
  /** Explanation of why this approach was chosen */
  rationale: string;
  /** Outcome recorded after the fact (filled in later) */
  outcome?: OutcomeType;
}

export interface RecommendationResult {
  recommended: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Human-readable reasoning */
  reasoning: string;
}

export interface Stats {
  total: number;
  /** Breakdown of entries by outcome */
  byOutcome: Record<string, number>;
  /** Approaches ranked by validated accuracy */
  bestPatterns: Array<{
    approach: string;
    validated: number;
    wrong: number;
    total: number;
    accuracy: number;
  }>;
}

export interface SimilarEntry {
  entry: TradeoffEntry;
  /** Similarity score 0-1 */
  similarity: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_DIR = ".claude/trade-off-analyzer";
const ENTRIES_FILE = "entries.jsonl";

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/** Ensure the storage directory exists, creating it if needed. Returns absolute path. */
function ensureStorageDir(): string {
  const dir = join(process.cwd(), STORAGE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Load all entries from the JSONL file. Corrupt lines are silently skipped.
 * Returns an empty array if the file does not exist or cannot be read.
 */
export function loadEntries(): TradeoffEntry[] {
  const dir = ensureStorageDir();
  const filePath = join(dir, ENTRIES_FILE);

  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, "utf-8");
    const entries: TradeoffEntry[] = [];

    for (const line of content.trim().split("\n")) {
      if (!line) continue;
      try {
        entries.push(JSON.parse(line) as TradeoffEntry);
      } catch {
        // skip corrupt line
      }
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Append a single entry as a new line in the JSONL file.
 */
export function saveEntry(entry: TradeoffEntry): void {
  const dir = ensureStorageDir();
  const filePath = join(dir, ENTRIES_FILE);

  try {
    appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // non-critical — fail silently
  }
}

/**
 * Overwrite the entire JSONL file with the given entries.
 * Used when updating an existing entry (e.g. recording an outcome).
 */
function writeAllEntries(entries: TradeoffEntry[]): void {
  const dir = ensureStorageDir();
  const filePath = join(dir, ENTRIES_FILE);

  try {
    const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    writeFileSync(filePath, content, "utf-8");
  } catch {
    // non-critical — fail silently
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Generate a unique ID: tradeoff-{ms}-{random-6-chars} */
function generateId(): string {
  return `tradeoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Compute a numeric score for an approach.
 *
 *   complexity: low=3, medium=2, high=1  (lower is better → higher score)
 *   performance / maintainability / security: high=3, medium=2, low=1
 *   pros/cons: +1 per pro, -1 per con
 */
function scoreApproach(approach: Approach): number {
  const levelWeight: Record<ComplexityLevel, number> = {
    low: 3,
    medium: 2,
    high: 1,
  };

  // For complexity, low scores higher (simpler is better).
  // For the other three, high scores higher.
  return (
    levelWeight[approach.complexity] +
    levelWeight[approach.performance] +
    levelWeight[approach.maintainability] +
    levelWeight[approach.security] +
    approach.pros.length -
    approach.cons.length
  );
}

/**
 * Calculate confidence based on the score gap between the top candidate
 * and the runner-up. Wider gaps produce higher confidence.
 */
function calculateConfidence(entry: TradeoffEntry): number {
  if (entry.approaches.length === 0) return 0;

  const scored = entry.approaches.map((a) => ({
    name: a.name,
    score: scoreApproach(a),
  }));

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 1) return 0.5;

  const topScore = scored[0].score;
  const secondScore = scored[1].score;
  const maxPossible = Math.max(...scored.map((s) => s.score), 1);
  const gap = topScore - secondScore;

  return Math.min(gap / maxPossible, 1);
}

/**
 * Compute Jaccard-style similarity between two context strings.
 * Tokenizes on alphanumeric words longer than 2 characters.
 */
function contextSimilarity(contextA: string, contextB: string): number {
  const tokenize = (text: string): Set<string> => {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((t) => t.length > 2),
    );
  };

  const tokensA = tokenize(contextA);
  const tokensB = tokenize(contextB);

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Normalize an approach name for grouping statistics. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Create a comparison matrix entry for the given context and approaches.
 * Scores each approach, picks the best one, records rationale, and persists
 * the entry to storage.
 *
 * @param context - Decision context (e.g. "Choosing a database for logging").
 * @param approaches - At least one `Approach` to compare.
 * @param criteria - Evaluation criteria labels (defaults to
 *   `["complexity", "performance", "maintainability", "security"]`).
 * @returns The newly created and persisted TradeoffEntry.
 *
 * @example
 * ```ts
 * const entry = generateMatrix("Frontend framework", [
 *   { name: "React", description: "UI library by Meta", pros: ["Ecosystem"], cons: ["Boilerplate"],
 *     complexity: "medium", performance: "high", maintainability: "medium", security: "medium" },
 * ]);
 * ```
 */
export function generateMatrix(
  context: string,
  approaches: Approach[],
  criteria?: string[],
): TradeoffEntry {
  if (!context || context.trim().length === 0) {
    throw new Error("Context must not be empty");
  }
  if (!approaches || approaches.length === 0) {
    throw new Error("At least one approach is required");
  }

  const resolvedCriteria = criteria ?? ["complexity", "performance", "maintainability", "security"];

  // Score and rank
  const scored = approaches
    .map((a) => ({ name: a.name, score: scoreApproach(a) }))
    .sort((a, b) => b.score - a.score);

  const recommendedName = scored[0].name;
  const best = approaches.find((a) => a.name === recommendedName);

  const totalPros = approaches.reduce((s, a) => s + a.pros.length, 0);
  const rationale = best
    ? `${recommendedName} was chosen with ${best.pros.length} pros (out of ${totalPros} total across all approaches), ` +
      `complexity=${best.complexity}, performance=${best.performance}, ` +
      `maintainability=${best.maintainability}, security=${best.security}.`
    : `${recommendedName} scored highest among ${approaches.length} approaches.`;

  const entry: TradeoffEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    context: context.trim(),
    approaches,
    criteria: resolvedCriteria,
    recommended: recommendedName,
    rationale,
  };

  saveEntry(entry);

  return entry;
}

/**
 * Analyse a `TradeoffEntry` and return a detailed recommendation with
 * confidence score and human-readable reasoning.
 *
 * @param entry - The entry to analyse.
 * @returns A `RecommendationResult` with `recommended`, `confidence`, and
 *   `reasoning` fields.
 *
 * @example
 * ```ts
 * const r = recommend(entry);
 * console.log(r.recommended);       // "React"
 * console.log(r.confidence);        // 0.85
 * console.log(r.reasoning);         // multi-line breakdown
 * ```
 */
export function recommend(entry: TradeoffEntry): RecommendationResult {
  if (entry.approaches.length === 0) {
    return {
      recommended: "",
      confidence: 0,
      reasoning: "No approaches available to analyse.",
    };
  }

  try {
    const scored = entry.approaches.map((a) => ({
      approach: a,
      score: scoreApproach(a),
    }));
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const confidence = calculateConfidence(entry);

    const lines: string[] = [];

    lines.push(`"${best.approach.name}" has the highest score (${best.score}).`);
    lines.push("");

    // Per-criteria breakdown
    lines.push("Score breakdown:");
    const fmt = (field: keyof Approach, label: string, invert?: boolean) => {
      const raw = best.approach[field] as ComplexityLevel;
      const pts = invert
        ? { low: 3, medium: 2, high: 1 }[raw]
        : { low: 1, medium: 2, high: 3 }[raw];
      lines.push(`  - ${label}: ${raw} (${pts} pts)`);
    };
    fmt("complexity", "Complexity", true);
    fmt("performance", "Performance");
    fmt("maintainability", "Maintainability");
    fmt("security", "Security");
    lines.push(
      `  - Pros/Cons: +${best.approach.pros.length} / -${best.approach.cons.length} ` +
        `(${best.approach.pros.length - best.approach.cons.length} pts)`,
    );
    lines.push("");

    // Comparison table
    if (scored.length > 1) {
      lines.push("Comparison with other approaches:");
      for (let i = 1; i < scored.length; i++) {
        const gap = best.score - scored[i].score;
        lines.push(`  - "${scored[i].approach.name}": score ${scored[i].score} (gap ${gap})`);
      }
      lines.push("");
    }

    const confidenceLabel = confidence >= 0.7 ? "high" : confidence >= 0.4 ? "medium" : "low";
    lines.push(
      `Confidence: ${confidenceLabel} (${(confidence * 100).toFixed(1)}%). ` +
        `Based on multi-criteria analysis of ${entry.approaches.length} approach(es).`,
    );

    return {
      recommended: best.approach.name,
      confidence,
      reasoning: lines.join("\n"),
    };
  } catch (err) {
    return {
      recommended: "",
      confidence: 0,
      reasoning: `Failed to analyse trade-off: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Record the real-world outcome for a previously created trade-off entry.
 *
 * @param id - The entry ID returned by `generateMatrix`.
 * @param outcome - One of `"validated"` (the choice held up),
 *   `"wrong"` (the choice turned out poorly), or `"unknown"` (reset).
 *
 * @example
 * ```ts
 * recordOutcome("tradeoff-1712345678900-a1b2c3", "validated");
 * ```
 */
export function recordOutcome(id: string, outcome: OutcomeType): void {
  if (!id) throw new Error("Entry ID must not be empty");

  const valid: OutcomeType[] = ["validated", "wrong", "unknown"];
  if (!valid.includes(outcome)) {
    throw new Error(`Outcome must be one of: ${valid.join(", ")}. Got: "${outcome}".`);
  }

  const entries = loadEntries();
  let found = false;

  const updated = entries.map((e) => {
    if (e.id === id) {
      found = true;
      return { ...e, outcome };
    }
    return e;
  });

  if (!found) throw new Error(`Entry with ID "${id}" not found`);

  writeAllEntries(updated);
}

/**
 * Search for trade-off entries whose context is semantically similar to
 * `context`. Uses Jaccard-style word overlap on tokenised text.
 *
 * @param context - The context string to match.
 * @param limit - Maximum results (default 5).
 * @returns An array of `SimilarEntry` items sorted by descending similarity.
 *
 * @example
 * ```ts
 * const similar = querySimilar("Choosing a database for logging");
 * console.log(similar[0].entry.recommended);
 * ```
 */
export function querySimilar(context: string, limit?: number): SimilarEntry[] {
  if (!context || context.trim().length === 0) {
    throw new Error("Search context must not be empty");
  }

  const entries = loadEntries();
  const maxResults = typeof limit === "number" && limit > 0 ? limit : 5;

  const scored = entries
    .map((e) => ({
      entry: e,
      similarity: contextSimilarity(context, e.context),
    }))
    .filter((s) => s.similarity > 0.1) // at least 10% overlap
    .sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, maxResults);
}

/**
 * Aggregate statistics across all stored trade-off entries.
 *
 * @returns A `Stats` object with `total`, `byOutcome` breakdown, and
 *   `bestPatterns` (approach names ranked by validated accuracy).
 *
 * @example
 * ```ts
 * const s = getStats();
 * console.log(s.total);            // 42
 * console.log(s.bestPatterns[0]);  // { approach: "Monolith", accuracy: 0.88, ... }
 * ```
 */
export function getStats(): Stats {
  const entries = loadEntries();

  const byOutcome: Record<string, number> = {};
  for (const e of entries) {
    const o = e.outcome ?? "unknown";
    byOutcome[o] = (byOutcome[o] ?? 0) + 1;
  }

  // Group outcomes by normalised approach name
  const patternMap = new Map<string, { validated: number; wrong: number; total: number }>();

  for (const e of entries) {
    if (!e.outcome || e.outcome === "unknown") continue;

    const key = normalizeName(e.recommended);
    const cur = patternMap.get(key) ?? { validated: 0, wrong: 0, total: 0 };
    cur.total++;
    if (e.outcome === "validated") cur.validated++;
    else if (e.outcome === "wrong") cur.wrong++;
    patternMap.set(key, cur);
  }

  const bestPatterns: Stats["bestPatterns"] = [];
  for (const [key, stats] of patternMap) {
    if (stats.total === 0) continue;

    // Use the original casing from the first entry that matches
    const originalName =
      entries.find((e) => normalizeName(e.recommended) === key)?.recommended ?? key;

    bestPatterns.push({
      approach: originalName,
      validated: stats.validated,
      wrong: stats.wrong,
      total: stats.total,
      accuracy: stats.total > 0 ? stats.validated / stats.total : 0,
    });
  }

  bestPatterns.sort((a, b) => b.accuracy - a.accuracy);

  return { total: entries.length, byOutcome, bestPatterns };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/**
 * Render a `TradeoffEntry` as a Markdown comparison matrix table.
 *
 * @param entry - The entry to format.
 * @returns A Markdown string with a criteria-vs-approach table and
 *   detailed per-approach sections.
 *
 * @example
 * ```ts
 * console.log(formatMatrix(entry));
 * ```
 */
export function formatMatrix(entry: TradeoffEntry): string {
  const lines: string[] = [];

  lines.push(`## Trade-Off Matrix: ${entry.context}`);
  lines.push("");
  lines.push(`**ID:** ${entry.id}`);
  lines.push(`**Date:** ${new Date(entry.timestamp).toLocaleString()}`);
  lines.push(`**Recommended:** ${entry.recommended}`);
  lines.push(`**Outcome:** ${entry.outcome ?? "not yet validated"}`);
  lines.push("");

  // Criteria table
  lines.push("### Approach Comparison");
  lines.push("");
  lines.push("| Criteria | " + entry.approaches.map((a) => a.name).join(" | ") + " |");
  lines.push("|----------|" + entry.approaches.map(() => "------").join("|") + "|");

  const criteriaFields: Record<
    string,
    keyof Pick<Approach, "complexity" | "performance" | "maintainability" | "security">
  > = {
    Complexity: "complexity",
    Performance: "performance",
    Maintainability: "maintainability",
    Security: "security",
  };

  for (const [label, field] of Object.entries(criteriaFields)) {
    const vals = entry.approaches.map((a) => {
      const v = a[field] as ComplexityLevel;
      const icon =
        v === "high" ? ":green_circle:" : v === "medium" ? ":yellow_circle:" : ":red_circle:";
      return `${icon} ${v}`;
    });
    lines.push(`| ${label} | ${vals.join(" | ")} |`);
  }

  lines.push(`| Pros | ${entry.approaches.map((a) => String(a.pros.length)).join(" | ")} |`);
  lines.push(`| Cons | ${entry.approaches.map((a) => String(a.cons.length)).join(" | ")} |`);
  lines.push("");

  // Per-approach detail
  lines.push("### Approach Details");
  lines.push("");

  for (const approach of entry.approaches) {
    const isRec = approach.name === entry.recommended;
    lines.push(`#### ${approach.name}${isRec ? " **(Recommended)**" : ""}`);
    lines.push("");
    lines.push(approach.description);
    lines.push("");

    if (approach.pros.length > 0) {
      lines.push("**Pros:**");
      for (const p of approach.pros) lines.push(`- :white_check_mark: ${p}`);
      lines.push("");
    }

    if (approach.cons.length > 0) {
      lines.push("**Cons:**");
      for (const c of approach.cons) lines.push(`- :x: ${c}`);
      lines.push("");
    }
  }

  lines.push("### Rationale");
  lines.push("");
  lines.push(entry.rationale);
  lines.push("");

  return lines.join("\n");
}

/**
 * Render a `TradeoffEntry` as a complete Markdown report, including the
 * matrix, the recommendation with reasoning, and optional outcome section.
 *
 * @param entry - The entry to format.
 * @returns A Markdown string suitable for writing to a file or printing.
 *
 * @example
 * ```ts
 * const report = formatReport(entry);
 * fs.writeFileSync("report.md", report);
 * ```
 */
export function formatReport(entry: TradeoffEntry): string {
  const lines: string[] = [];

  lines.push("# Trade-Off Analysis Report");
  lines.push("");
  lines.push(`**Context:** ${entry.context}`);
  lines.push(`**ID:** ${entry.id}`);
  lines.push(`**Created:** ${new Date(entry.timestamp).toLocaleString()}`);
  lines.push(`**Status:** ${entry.outcome ?? "not yet validated"}`);
  lines.push("");

  // Executive summary
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(
    `After analysing ${entry.approaches.length} approach(es) against ` +
      `${entry.criteria.length} criteria, **"${entry.recommended}"** is recommended.`,
  );
  lines.push("");

  const rec = recommend(entry);
  lines.push(`**Confidence:** ${(rec.confidence * 100).toFixed(1)}%`);
  lines.push("");
  lines.push(rec.reasoning);
  lines.push("");

  // Matrix
  lines.push("---");
  lines.push("");
  lines.push(formatMatrix(entry));
  lines.push("");

  // Criteria list
  lines.push("## Evaluation Criteria");
  lines.push("");
  for (const c of entry.criteria) lines.push(`- ${c}`);
  lines.push("");

  // Outcome
  if (entry.outcome && entry.outcome !== "unknown") {
    lines.push("## Validation Result");
    lines.push("");
    if (entry.outcome === "validated") {
      lines.push(
        ":tada: This decision **held up in practice**. The chosen approach " +
          "delivered the expected results.",
      );
    } else {
      lines.push(
        ":warning: This decision **turned out suboptimal**. Consider a " +
          "different approach for similar contexts in the future.",
      );
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(
    "*Report generated by Trade-Off Analyzer - document decisions, validate outcomes, learn from the past*",
  );
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Stats formatter
// ---------------------------------------------------------------------------

/**
 * Render a `Stats` object as a readable Markdown report.
 *
 * @param stats - The stats object from `getStats()`.
 * @returns A Markdown string.
 */
export function formatStats(stats: Stats): string {
  const lines: string[] = [];

  lines.push("# Trade-Off Statistics");
  lines.push("");
  lines.push(`**Total Decisions:** ${stats.total}`);
  lines.push("");

  lines.push("## Outcome Breakdown");
  lines.push("");
  lines.push("| Outcome | Count | Percent |");
  lines.push("|---------|-------|---------|");

  const outcomeLabels: Record<string, string> = {
    validated: ":white_check_mark: Validated",
    wrong: ":x: Wrong",
    unknown: ":grey_question: Unknown",
  };

  for (const [outcome, count] of Object.entries(stats.byOutcome).sort((a, b) => b[1] - a[1])) {
    const label = outcomeLabels[outcome] ?? outcome;
    const pct = stats.total > 0 ? ((count / stats.total) * 100).toFixed(1) : "0.0";
    lines.push(`| ${label} | ${count} | ${pct}% |`);
  }
  lines.push("");

  if (stats.bestPatterns.length > 0) {
    lines.push("## Best Patterns");
    lines.push("");
    lines.push("| Approach | Validated | Wrong | Total | Accuracy |");
    lines.push("|----------|-----------|-------|-------|----------|");

    for (const p of stats.bestPatterns) {
      const bar = progressBar(p.accuracy, 10);
      const pct = (p.accuracy * 100).toFixed(1);
      lines.push(`| ${p.approach} | ${p.validated} | ${p.wrong} | ${p.total} | ${bar} ${pct}% |`);
    }
    lines.push("");
  }

  // Insights
  if (stats.total > 0) {
    lines.push("## Insights");
    lines.push("");

    const validated = stats.byOutcome["validated"] ?? 0;
    const wrong = stats.byOutcome["wrong"] ?? 0;
    const known = validated + wrong;

    if (known > 0) {
      const overallAccuracy = (validated / known) * 100;
      lines.push(
        `- **Overall accuracy:** ${overallAccuracy.toFixed(1)}% ` +
          `(${validated} correct out of ${known} validated decisions)`,
      );
    }

    const unknown = stats.byOutcome["unknown"] ?? 0;
    if (unknown > 0) {
      lines.push(
        `- **Pending validation:** ${unknown} decision(s) have no recorded outcome. ` +
          "Use recordOutcome() to complete them.",
      );
    }

    if (stats.bestPatterns.length > 0 && stats.bestPatterns[0].accuracy > 0.7) {
      lines.push(
        `- **Top pattern:** "${stats.bestPatterns[0].approach}" ` +
          `has ${(stats.bestPatterns[0].accuracy * 100).toFixed(1)}% accuracy ` +
          "-- consider this approach for similar contexts.",
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Simple ASCII progress bar. */
function progressBar(fraction: number, width: number): string {
  const filled = Math.round(fraction * width);
  return "[" + "#".repeat(filled) + "-".repeat(width - filled) + "]";
}
