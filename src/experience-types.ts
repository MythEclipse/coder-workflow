/**
 * Shared types for the experience system
 * (dreaming, experience-journal, learn).
 *
 * Extracted to break circular dependencies.
 * NO business logic — types only.
 */

// ─── From dreaming.ts ────────────────────────────────────────────────────

export interface MemoryCandidate {
  id: string;
  topic: string;
  context: string;
  confidence: number;
  firstSeen: string;
  lastSeen: string;
}

// ─── From experience-journal.ts ──────────────────────────────────────────

/** Final outcome of a task. */
export type ExperienceOutcome = "success" | "failure" | "partial";

/**
 * Record of an architectural or technical decision.
 */
export interface DecisionRecord {
  /** Unique decision ID. */
  id: string;
  /** ISO 8601 timestamp when the decision was made. */
  timestamp: string;
  /** Context when the decision was made. */
  context: string;
  /** Options that were considered. */
  options: string[];
  /** The selected option. */
  selected: string;
  /** Rationale for selecting that option. */
  rationale: string;
  /** Decision outcome after evaluation (optional). */
  outcome?: ExperienceOutcome;
}

/**
 * Record of a task completion.
 */
export interface ExperienceEntry {
  /** Unique entry ID. */
  id: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Task type (e.g., "implement", "debug", "refactor", "test", "deploy"). */
  taskType: string;
  /** Short task description. */
  taskDesc: string;
  /** Final task outcome. */
  outcome: ExperienceOutcome;
  /** Root cause of failure (if outcome=failure). */
  rootCause?: string;
  /** Lessons learned. */
  lessons: string[];
  /** Identified patterns. */
  patterns: string[];
  /** Decisions made during the task. */
  decisions: DecisionRecord[];
  /** Tags for categorization. */
  tags: string[];
  /** Timestamp when this entry was processed by the Dreaming phase. */
  dreamedAt?: string;
}

/**
 * Summary statistics from the journal.
 */
export interface Stats {
  /** Total entries in the journal. */
  total: number;
  /** Number of entries per outcome. */
  byOutcome: Record<ExperienceOutcome, number>;
  /** Most frequently occurring patterns. */
  topPatterns: Array<{ pattern: string; frequency: number; avgSuccessRate: number }>;
  /** Recent decisions. */
  recentDecisions: DecisionRecord[];
}

// ─── From learn.ts ───────────────────────────────────────────────────────

export interface FailureRecord {
  id: string;
  timestamp: string;
  type: "tool_failure" | "stop_failure" | "session_failure" | "test_failure";
  tool?: string;
  error?: string;
  context?: string;
  resolved: boolean;
  resolution?: string;
  correctionWritten?: boolean;
  /** Timestamp when this failure was processed by the Dreaming phase. */
  dreamedAt?: string;
}

export interface CorrectionEntry {
  id: string;
  pattern: string;
  symptom: RegExp;
  fix: string;
  source: "learn" | "manual";
  createdAt: string;
  appliedCount: number;
}

export interface LearnReport {
  totalFailures: number;
  unresolvedFailures: number;
  correctionsWritten: number;
  activePatterns: number;
  recentFailures: FailureRecord[];
}
