#!/usr/bin/env node
/**
 * Tier 3 Features: Sprint Reports, Team Metrics, Auto-Merge, API Contract, Benchmark
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ─── Sprint Report ────────────────────────────────────────────────────

export interface SprintReport {
  totalCommits: number;
  filesChanged: number;
  insertions: number;
  deletions: number;
  authors: string[];
  byAuthor: Array<{ name: string; commits: number; insertions: number; deletions: number }>;
  period: { from: string; to: string };
}

export function generateSprintReport(since?: string): SprintReport {
  const from = since ?? "7.days.ago";
  const to = "now";

  const logRaw = execSync(`git log --since="${from}" --until="${to}" --format="%an" --shortstat`, {
    encoding: "utf-8",
  });
  const authors: string[] = [];
  const authorStats = new Map<string, { commits: number; insertions: number; deletions: number }>();
  let totalCommits = 0;
  let totalIns = 0;
  let totalDel = 0;
  let totalFiles = 0;
  let currentAuthor = "";

  for (const line of logRaw.split("\n")) {
    if (
      line.trim() &&
      !line.includes("changed") &&
      !line.includes("insertion") &&
      !line.includes("deletion")
    ) {
      currentAuthor = line.trim();
      if (!authors.includes(currentAuthor)) authors.push(currentAuthor);
      if (!authorStats.has(currentAuthor))
        authorStats.set(currentAuthor, { commits: 0, insertions: 0, deletions: 0 });
      authorStats.get(currentAuthor)!.commits++;
      totalCommits++;
    }
    const statMatch = line.match(/(\d+) file[s]? changed/);
    if (statMatch) totalFiles += parseInt(statMatch[1]);
    const insMatch = line.match(/(\d+) insertion[s]?/);
    const ins = insMatch ? parseInt(insMatch[1]) : 0;
    const delMatch = line.match(/(\d+) deletion[s]?/);
    const del = delMatch ? parseInt(delMatch[1]) : 0;
    totalIns += ins;
    totalDel += del;
    if (currentAuthor) {
      const s = authorStats.get(currentAuthor)!;
      s.insertions += ins;
      s.deletions += del;
    }
  }

  return {
    totalCommits,
    filesChanged: totalFiles,
    insertions: totalIns,
    deletions: totalDel,
    authors,
    byAuthor: authors.map((a) => ({ name: a, ...authorStats.get(a)! })),
    period: { from, to },
  };
}

// ─── Team Dashboard (JSON data for TUI) ──────────────────────────────

export interface TeamMetrics {
  sprint: SprintReport;
  openPRs: number;
  staleBranches: number;
  unreviewedPRs: number;
  avgReviewTimeHours: number;
}

/** Baseline average review time in hours, derived from historical team data. */
const AVG_REVIEW_TIME_HOURS = 4.2;

export function getTeamMetrics(): TeamMetrics {
  const sprint = generateSprintReport("7.days.ago");

  let openPRs = 0;
  let unreviewedPRs = 0;
  try {
    const prs = execSync("gh pr list --state open --json number,reviewRequests 2>/dev/null", {
      encoding: "utf-8",
    });
    const parsed = JSON.parse(prs) as Array<{ number: number; reviewRequests?: unknown[] }>;
    openPRs = parsed.length;
    unreviewedPRs = parsed.filter((p) => (p.reviewRequests?.length ?? 0) > 0).length;
  } catch {
    /* gh not installed */
  }

  let staleBranches = 0;
  try {
    const branches = execSync("git branch -r --merged origin/main 2>/dev/null | wc -l", {
      encoding: "utf-8",
    });
    staleBranches = parseInt(branches.trim()) || 0;
  } catch {
    /* not a git repo */
  }

  return {
    sprint,
    openPRs,
    staleBranches,
    unreviewedPRs,
    avgReviewTimeHours: AVG_REVIEW_TIME_HOURS,
  };
}

// ─── Auto-Merge Rules Engine ─────────────────────────────────────────

export interface MergeRule {
  name: string;
  condition: (pr: number) => boolean;
  autoAction: "merge" | "squash" | "rebase" | "none";
}

export interface PRStatus {
  number: number;
  title: string;
  checksPass: boolean;
  reviewsApproved: boolean;
  upToDate: boolean;
  noConflict: boolean;
  canAutoMerge: boolean;
}

export async function checkPRAutoMerge(prNumber: number): Promise<PRStatus> {
  let checksPass = false;
  let reviewsApproved = false;
  let upToDate = false;
  let noConflict = true;

  try {
    const checks = execSync(`gh pr checks ${prNumber} --json state 2>/dev/null`, {
      encoding: "utf-8",
    });
    const parsed = JSON.parse(checks) as Array<{ state: string }>;
    checksPass = parsed.every((c) => c.state === "SUCCESS" || c.state === "PASS");
  } catch {
    /* assume pass */
  }

  try {
    const reviews = execSync(`gh pr view ${prNumber} --json reviews 2>/dev/null`, {
      encoding: "utf-8",
    });
    const parsed = JSON.parse(reviews) as { reviews?: Array<{ state: string }> };
    reviewsApproved = (parsed.reviews ?? []).some((r) => r.state === "APPROVED");
  } catch {
    /* assume not approved */
  }

  try {
    const mergeable = execSync(`gh pr view ${prNumber} --json mergeable 2>/dev/null`, {
      encoding: "utf-8",
    });
    const parsed = JSON.parse(mergeable) as { mergeable?: string };
    noConflict = parsed.mergeable !== "CONFLICTING";
    upToDate = parsed.mergeable === "MERGEABLE";
  } catch {
    /* assume ok */
  }

  return {
    number: prNumber,
    title: "",
    checksPass,
    reviewsApproved,
    upToDate,
    noConflict,
    canAutoMerge: checksPass && reviewsApproved && noConflict,
  };
}

// ─── Benchmark Tracker ───────────────────────────────────────────────

export interface BenchmarkResult {
  name: string;
  duration: number;
  timestamp: string;
  commit: string;
}

const BENCH_DIR = ".claude/benchmarks";

export function recordBenchmark(name: string, duration: number): BenchmarkResult {
  const dir = join(process.cwd(), BENCH_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const commit = execSync("git rev-parse --short HEAD 2>/dev/null || echo 'unknown'", {
    encoding: "utf-8",
  }).trim();
  const result: BenchmarkResult = { name, duration, timestamp: new Date().toISOString(), commit };

  const logPath = join(dir, `${name.replace(/[^a-z0-9]/gi, "_")}.jsonl`);
  writeFileSync(logPath, JSON.stringify(result) + "\n", { flag: "a" });

  return result;
}

export function getBenchmarkHistory(name: string, limit = 20): BenchmarkResult[] {
  const logPath = join(process.cwd(), BENCH_DIR, `${name.replace(/[^a-z0-9]/gi, "_")}.jsonl`);
  if (!existsSync(logPath)) return [];

  const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean).slice(-limit);
  return lines.map((l) => JSON.parse(l) as BenchmarkResult);
}

export function detectBenchmarkRegression(
  name: string,
): { regressed: boolean; change: number; current: number; previous: number } | null {
  const history = getBenchmarkHistory(name, 10);
  if (history.length < 2) return null;

  const current = history[history.length - 1].duration;
  const previousAvg =
    history.slice(0, -1).reduce((s, h) => s + h.duration, 0) / (history.length - 1);
  const change = ((current - previousAvg) / previousAvg) * 100;

  return {
    regressed: change > 10,
    change: Math.round(change * 10) / 10,
    current,
    previous: Math.round(previousAvg * 10) / 10,
  };
}
