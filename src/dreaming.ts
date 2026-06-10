#!/usr/bin/env node
/**
 * Dreaming Phase (Memory Consolidation)
 *
 * Simulates OpenClaw's sleep cycles to process short-term memory
 * from the experience journal and failure logs, extracting
 * candidates and promoting repeated observations to durable memory.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getUnprocessedMemories, markAsDreamed } from "./experience-journal.js";
import { getUnprocessedFailures, markFailureAsDreamed } from "./learn.js";

const MEMORY_DIR = ".claude/memory-core";
const CANDIDATES_FILE = "candidates.json";
const DURABLE_MEMORY_FILE = "MEMORY.md";
const PROMOTION_THRESHOLD = 3;

interface MemoryCandidate {
  id: string;
  topic: string;
  context: string;
  confidence: number;
  firstSeen: string;
  lastSeen: string;
}

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

function extractTopic(text: string): string {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, "");
  const words = normalized.split(/\s+/).filter((w) => w.length > 4);
  // Simple heuristic: return the first 3 significant words as a topic
  return words.slice(0, 3).join(" ");
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
          id: `cand-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
        id: `cand-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        topic,
        context: `Failure observation: ${failure.error}`,
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
  const memoryFile = join(process.cwd(), DURABLE_MEMORY_FILE);

  let currentMemory = "";
  if (existsSync(memoryFile)) {
    currentMemory = readFileSync(memoryFile, "utf-8");
  } else {
    currentMemory =
      "# Durable Memory Wiki\n\nConsolidated knowledge and long-term facts.\n\n## Core Learnings\n";
  }

  let promotedCount = 0;
  const remainingCandidates: MemoryCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.confidence >= PROMOTION_THRESHOLD) {
      // Promote
      const newFact = `\n- **Topic:** ${candidate.topic}\n  **Context:** ${candidate.context}\n  *Promoted on:* ${new Date().toISOString()}\n`;
      if (!currentMemory.includes(candidate.context)) {
        currentMemory += newFact;
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
