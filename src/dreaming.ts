/**
 * Dreaming Phase (Memory Consolidation)
 *
 * Simulates OpenClaw's sleep cycles to process short-term memory
 * from the experience journal and failure logs, extracting
 * candidates and promoting repeated observations to durable memory.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryCandidate } from "./experience-types.js";
import { getUnprocessedMemories, markAsDreamed } from "./experience-journal.js";
import { getUnprocessedFailures, markFailureAsDreamed } from "./learn.js";

const MEMORY_DIR = ".claude/memory-core";
const CANDIDATES_FILE = "candidates.json";
const DURABLE_MEMORY_FILE = "MEMORY.md";
const PROMOTION_THRESHOLD = 3;

function ensureMemoryDir(): string {
  const dir = join(process.cwd(), MEMORY_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function loadCandidates(): MemoryCandidate[] {
  const dir = ensureMemoryDir();
  const file = join(dir, CANDIDATES_FILE);
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as MemoryCandidate[];
  } catch {
    return [];
  }
}

function saveCandidates(candidates: MemoryCandidate[]): void {
  const dir = ensureMemoryDir();
  writeFileSync(join(dir, CANDIDATES_FILE), JSON.stringify(candidates, null, 2), "utf-8");
}

const STOP_WORDS = new Set([
  "error", "failed", "failure", "while", "trying", "cannot", "could", "not", "during", "the", "a", "an", "is", "are",
  "was", "were", "to", "from", "in", "on", "at", "by", "for", "with", "about", "against", "between", "into", "through",
  "after", "before", "of", "and", "or", "but", "if", "then", "else", "when", "where", "why", "how", "all", "any",
  "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor", "only", "own", "same", "so", "than",
  "too", "very", "can", "will", "just", "should", "now", "it", "this", "that", "these", "those", "we", "you", "they",
  "has", "have", "had", "do", "does", "did", "be", "been", "being", "am", "as", "their", "there", "here",
  "occurred", "happened", "found", "unexpected", "invalid", "undefined", "null", "missing", "provided", "expected",
  "received", "returned", "called", "execution", "execute", "run", "running", "start", "starting", "stop", "stopping",
  "fail", "fails", "crashing", "crashed", "issue", "problem", "bug", "fix", "fixed", "resolving", "resolved"
]);

function extractTopic(text: string): string {
  // 1. Remove file paths, URLs, and stack trace noise
  let cleanText = text.replace(/(?:https?|ftp):\/\/[\n\S]+/g, " "); // Remove URLs
  cleanText = cleanText.replace(/(?:\/[a-zA-Z0-9_.-]+)+/g, " "); // Remove absolute/relative file paths
  cleanText = cleanText.replace(/at\s+.*:\d+:\d+/g, " "); // Remove stack traces
  cleanText = cleanText.replace(/[a-fA-F0-9-]{16,}/g, " "); // Remove UUIDs and long hashes
  
  // 2. Tokenize and filter out non-alphanumeric noise, very short words, and stop words
  const normalized = cleanText.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const words = normalized.split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  
  // 3. Deduplicate to get distinct key terms
  const distinctWords = [...new Set(words)];
  
  if (distinctWords.length === 0) {
    return "general_operations";
  }
  
  // Return the top 3-4 distinct words combined to form a technical topic identifier
  return distinctWords.slice(0, 4).join("_");
}

function updateDurableMemory(candidate: MemoryCandidate, currentMemory: string, seenHashes: Set<string>): string {
  const sectionHeader = `## Topic: ${candidate.topic}`;
  const cleanContext = candidate.context.replace(/\n/g, " ").trim();
  const ctxHash = createHash("sha256").update(cleanContext).digest("hex").slice(0, 16);

  if (seenHashes.has(ctxHash)) {
    return currentMemory; // Already exists (content-hash dedup)
  }
  seenHashes.add(ctxHash);

  const newFact = `- **Context:** ${cleanContext}\n  *First Seen:* ${candidate.firstSeen} | *Promoted:* ${new Date().toISOString()}`;
  
  if (currentMemory.includes(sectionHeader)) {
    // Inject right after the section header
    const parts = currentMemory.split(sectionHeader);
    return `${parts[0]}${sectionHeader}\n${newFact}\n${parts[1]}`;
  } else {
    // Append new section entirely
    return `${currentMemory}\n\n${sectionHeader}\n${newFact}\n`;
  }
}

/**
 * Phase 1: Light Sleep
 * Reads unprocessed logs and extracts memory candidates.
 */
export function runLightSleep(): { extracted: number; candidates: MemoryCandidate[] } {
  const entries = getUnprocessedMemories();
  const failures = getUnprocessedFailures();

  if (entries.length === 0 && failures.length === 0) {
    return { extracted: 0, candidates: loadCandidates() };
  }

  const candidates = loadCandidates();
  let newSignals = 0;

  // Process Experience Journal
  for (const entry of entries) {
    for (const lesson of entry.lessons) {
      const topic = extractTopic(lesson);
      if (!topic) continue;

      let candidate = candidates.find((c) => c.topic === topic);
      if (candidate) {
        candidate.confidence += 1;
        candidate.lastSeen = new Date().toISOString();
      } else {
        candidate = {
          id: `cand-${Date.now()}-${randomUUID().slice(0, 8)}`,
          topic,
          context: lesson,
          confidence: 1,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        };
        candidates.push(candidate);
      }
      newSignals++;
    }
  }

  // Process Failures
  for (const failure of failures) {
    if (!failure.error) continue;
    const topic = extractTopic(failure.error);
    if (!topic) continue;

    let candidate = candidates.find((c) => c.topic === topic);
    if (candidate) {
      candidate.confidence += 1;
      candidate.lastSeen = new Date().toISOString();
    } else {
      candidate = {
        id: `cand-${Date.now()}-${randomUUID().slice(0, 8)}`,
        topic,
        context: `Failure observation: ${failure.error.substring(0, 300)}...`, // Truncate huge errors
        confidence: 1,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      };
      candidates.push(candidate);
    }
    newSignals++;
  }

  saveCandidates(candidates);

  // Mark as dreamed
  markAsDreamed(entries.map((e) => e.id));
  markFailureAsDreamed(failures.map((f) => f.id));

  return { extracted: newSignals, candidates };
}

/**
 * Phase 2: REM Sleep
 * Evaluates candidates and promotes those that cross the threshold to MEMORY.md.
 */
export function runRemSleep(): { promoted: number } {
  let candidates = loadCandidates();
  const memoryFile = join(ensureMemoryDir(), DURABLE_MEMORY_FILE);

  let currentMemory = "";
  if (existsSync(memoryFile)) {
    currentMemory = readFileSync(memoryFile, "utf-8");
  } else {
    currentMemory =
      "# Durable Memory Wiki\n\nConsolidated knowledge and long-term facts.\n\n## Core Learnings\n";
  }

  let promotedCount = 0;
  const remainingCandidates: MemoryCandidate[] = [];
  const seenHashes = new Set<string>();

  for (const candidate of candidates) {
    if (candidate.confidence >= PROMOTION_THRESHOLD) {
      const prevMemoryLength = currentMemory.length;
      currentMemory = updateDurableMemory(candidate, currentMemory, seenHashes);
      if (currentMemory.length > prevMemoryLength) {
        promotedCount++;
      }
    } else {
      // Keep in staging
      remainingCandidates.push(candidate);
    }
  }

  if (promotedCount > 0) {
    writeFileSync(memoryFile, currentMemory, "utf-8");
    saveCandidates(remainingCandidates);
  }

  return { promoted: promotedCount };
}

/**
 * Runs the full dreaming cycle.
 */
export function runDreamingCycle(): { signals: number; promoted: number } {
  const { extracted } = runLightSleep();
  const { promoted } = runRemSleep();
  return { signals: extracted, promoted };
}
