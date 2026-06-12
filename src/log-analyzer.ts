import * as fs from "fs";
import * as path from "path";
import { escapeMarkdown } from "./utils/index.js";

export interface LogEntry {
  timestamp?: string;
  level?: string;
  message?: string;
  [key: string]: any;
}

export interface LogAnalysisReport {
  totalLines: number;
  errorCount: number;
  warnCount: number;
  timeRange: {
    first: string | null;
    last: string | null;
  };
  errorGroups: Array<{
    pattern: string;
    count: number;
    example: string;
    severity: "high" | "medium" | "low";
  }>;
  topErrors: Array<{
    message: string;
    count: number;
  }>;
  frequencyByMinute: Array<{
    time: string;
    count: number;
  }>;
}

export interface AnomalyResult {
  timestamp: string;
  message: string;
  reason: string;
}

export interface AnomalyOptions {
  windowMinutes?: number;
  threshold?: number;
}

const TIMESTAMP_REGEX =
  /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/;

/**
 * Try to extract an ISO-like timestamp from a raw text line.
 */
function extractTimestamp(line: string): string | undefined {
  const match = line.match(TIMESTAMP_REGEX);
  return match ? match[1] : undefined;
}

/**
 * Read a file and parse each line as JSON. Fallback: if a line is not valid JSON,
 * treat it as a raw text LogEntry with timestamp detection.
 */
export function parseLogFile(filePath: string): LogEntry[] {
  const absolutePath = path.resolve(filePath);
  const raw = fs.readFileSync(absolutePath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

  return lines.map((line, index) => {
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as LogEntry;
      }
      throw new Error("Not an object");
    } catch {
      const ts = extractTimestamp(line);
      const entry: LogEntry = {
        _raw: true,
        _lineNumber: index + 1,
        message: line,
      };
      if (ts) {
        entry.timestamp = ts;
      }
      return entry;
    }
  });
}

/**
 * Normalise an error message for grouping:
 * - Remove numeric values (including versions, ports, ids)
 * - Remove ISO timestamps
 * - Collapse whitespace
 * - Lowercase
 */
function normaliseForGrouping(msg: string): string {
  return msg
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, "<TS>")
    .replace(/\b\d+\b/g, "<N>")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Score the severity of an error group based on its frequency and message content.
 */
function assessSeverity(count: number, example: string): "high" | "medium" | "low" {
  const lower = example.toLowerCase();
  const criticalTerms = ["fatal", "crash", "out of memory", "segfault", "panic", "emergency"];
  const hasCritical = criticalTerms.some((t) => lower.includes(t));

  if (hasCritical || count >= 50) return "high";
  if (count >= 10) return "medium";
  return "low";
}

/**
 * Analyze an array of LogEntry objects and produce a LogAnalysisReport.
 *
 * Error grouping logic:
 * 1. Use exact match after removing numerics and timestamps from the message.
 * 2. If the result is empty/too short, fall back to the first 80 characters of the
 *    original message.
 */
export function analyzeLogs(entries: LogEntry[]): LogAnalysisReport {
  const totalLines = entries.length;

  const errorEntries = entries.filter((e) => {
    const level = (e.level || "").toLowerCase();
    return level === "error" || level === "critical" || level === "fatal";
  });
  const warnEntries = entries.filter((e) => {
    const level = (e.level || "").toLowerCase();
    return level === "warn" || level === "warning";
  });

  const errorCount = errorEntries.length;
  const warnCount = warnEntries.length;

  // Time range
  const timestamps = entries
    .map((e) => e.timestamp)
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .sort();

  const timeRange = {
    first: timestamps.length > 0 ? timestamps[0] : null,
    last: timestamps.length > 0 ? timestamps[timestamps.length - 1] : null,
  };

  // Error grouping
  const groupMap = new Map<string, { count: number; examples: string[]; severities: string[] }>();

  for (const err of errorEntries) {
    const rawMsg = err.message || JSON.stringify(err);
    const key = normaliseForGrouping(rawMsg);
    const groupKey = key.length < 5 ? rawMsg.substring(0, 80) : key;

    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, { count: 0, examples: [], severities: [] });
    }
    const group = groupMap.get(groupKey)!;
    group.count += 1;
    if (group.examples.length < 3) {
      group.examples.push(rawMsg);
    }
    group.severities.push(assessSeverity(group.count, rawMsg));
  }

  const errorGroups = Array.from(groupMap.entries())
    .map(([pattern, g]) => {
      const severityCounts = { high: 0, medium: 0, low: 0 };
      for (const s of g.severities) {
        severityCounts[s as "high" | "medium" | "low"] += 1;
      }
      const dominant: "high" | "medium" | "low" =
        severityCounts.high > 0 ? "high" : severityCounts.medium > 0 ? "medium" : "low";

      return {
        pattern,
        count: g.count,
        example: g.examples[0],
        severity: dominant,
      };
    })
    .sort((a, b) => b.count - a.count);

  // Top errors (original message text)
  const messageCounts = new Map<string, number>();
  for (const err of errorEntries) {
    const msg = err.message || JSON.stringify(err);
    messageCounts.set(msg, (messageCounts.get(msg) || 0) + 1);
  }
  const topErrors = Array.from(messageCounts.entries())
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Frequency by minute
  const minuteBuckets = new Map<string, number>();
  for (const entry of entries) {
    const ts = entry.timestamp;
    if (!ts) continue;
    const minuteKey = ts.substring(0, 16); // "YYYY-MM-DDTHH:MM"
    minuteBuckets.set(minuteKey, (minuteBuckets.get(minuteKey) || 0) + 1);
  }
  const frequencyByMinute = Array.from(minuteBuckets.entries())
    .map(([time, count]) => ({ time, count }))
    .sort((a, b) => a.time.localeCompare(b.time));

  return {
    totalLines,
    errorCount,
    warnCount,
    timeRange,
    errorGroups,
    topErrors,
    frequencyByMinute,
  };
}

/**
 * Detect anomalies — sudden spikes in error rate within configurable time windows.
 *
 * The algorithm slides a window of `windowMinutes` across the sorted error entries.
 * If the count in the current window exceeds `threshold` times the rolling average
 * of preceding windows, an anomaly is reported.
 */
export function detectAnomalies(entries: LogEntry[], options?: AnomalyOptions): AnomalyResult[] {
  const { windowMinutes = 5, threshold = 3 } = options || {};

  const errors = entries
    .filter((e) => {
      const level = (e.level || "").toLowerCase();
      return (
        (level === "error" || level === "critical" || level === "fatal") &&
        typeof e.timestamp === "string"
      );
    })
    .map((e) => ({
      timestamp: e.timestamp!,
      message: e.message || JSON.stringify(e),
      date: new Date(e.timestamp!),
    }))
    .filter((e) => !isNaN(e.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (errors.length === 0) return [];

  const anomalies: AnomalyResult[] = [];
  const windowMs = windowMinutes * 60 * 1000;
  const baselineWindows: number[] = [];

  const windowStart = 0;

  for (let i = 0; i < errors.length; i++) {
    const windowEnd = errors[i].date.getTime() + windowMs;

    // Count errors in current sliding window starting at i
    let count = 0;
    let j = i;
    while (j < errors.length && errors[j].date.getTime() <= windowEnd) {
      count++;
      j++;
    }

    // Build baseline from previous windows
    if (baselineWindows.length > 0) {
      const avg = baselineWindows.reduce((sum, c) => sum + c, 0) / baselineWindows.length;

      if (count > threshold * Math.max(avg, 1)) {
        anomalies.push({
          timestamp: errors[i].timestamp,
          message: errors[i].message,
          reason: `Spike detected: ${count} errors in ${windowMinutes}-minute window (${threshold}x baseline average of ${avg.toFixed(1)})`,
        });
      }
    }

    baselineWindows.push(count);

    // Keep baseline limited to recent history (up to 20 windows)
    if (baselineWindows.length > 20) {
      baselineWindows.shift();
    }
  }

  // Deduplicate consecutive anomalies for the same burst
  const deduped: AnomalyResult[] = [];
  const seenKeys = new Set<string>();
  for (const a of anomalies) {
    const key = `${a.timestamp}|${a.message}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      deduped.push(a);
    }
  }

  return deduped;
}

/**
 * Format a LogAnalysisReport as a Markdown string with error breakdown.
 */
export function formatLogReport(report: LogAnalysisReport): string {
  const lines: string[] = [];

  lines.push("# Log Analysis Report");
  lines.push("");
  lines.push("## Overview");
  lines.push("");
  lines.push(`- **Total lines**: ${report.totalLines}`);
  lines.push(`- **Errors**: ${report.errorCount}`);
  lines.push(`- **Warnings**: ${report.warnCount}`);
  lines.push("");

  if (report.timeRange.first && report.timeRange.last) {
    lines.push(`- **Time range**: ${report.timeRange.first} → ${report.timeRange.last}`);
  } else {
    lines.push("- **Time range**: _No timestamps found_");
  }
  lines.push("");

  if (report.topErrors.length > 0) {
    lines.push("## Top Errors");
    lines.push("");
    lines.push("| # | Message | Count |");
    lines.push("|---|---------|-------|");
    report.topErrors.forEach((e, i) => {
      lines.push(`| ${i + 1} | ${escapeMarkdown(e.message)} | ${e.count} |`);
    });
    lines.push("");
  }

  if (report.errorGroups.length > 0) {
    lines.push("## Error Groups");
    lines.push("");
    lines.push("| Pattern | Count | Severity | Example |");
    lines.push("|---------|-------|----------|---------|");
    report.errorGroups.forEach((g) => {
      lines.push(
        `| ${escapeMarkdown(g.pattern)} | ${g.count} | ${g.severity} | ${escapeMarkdown(g.example)} |`,
      );
    });
    lines.push("");
  }

  if (report.frequencyByMinute.length > 0) {
    lines.push("## Frequency by Minute");
    lines.push("");
    lines.push("| Time | Count |");
    lines.push("|------|-------|");
    const maxCount = Math.max(...report.frequencyByMinute.map((f) => f.count), 1);
    const barWidth = 20;

    for (const f of report.frequencyByMinute) {
      const barLen = Math.round((f.count / maxCount) * barWidth);
      const bar = "█".repeat(Math.max(barLen, 1));
      lines.push(`| ${f.time} | ${f.count} ${bar} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Convenience function: parse a log file and analyze in one call.
 */
export function analyzeLogFile(filePath: string): LogAnalysisReport {
  const entries = parseLogFile(filePath);
  return analyzeLogs(entries);
}
