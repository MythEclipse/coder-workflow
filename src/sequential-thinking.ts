#!/usr/bin/env node
/**
 * Sequential Thinking Engine — Enhanced MCP Tool
 *
 * A custom implementation inspired by @modelcontextprotocol/server-sequential-thinking
 * but with:
 *  - Persistent state to .claude/sequential-thinking/
 *  - Session logging via hooks
 *  - Branch visualization (tree export)
 *  - Thought chain export as Markdown
 *  - Auto-summarization of completed chains
 *  - Integration with coder-workflow's brainstorming skill
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ThoughtData {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
  nextThoughtNeeded: boolean;
}

export interface PersistedSession {
  id: string;
  startedAt: string;
  updatedAt: string;
  thoughtHistory: ThoughtData[];
  branches: Record<string, ThoughtData[]>;
  summary?: string;
  tags: string[];
}

// ─── ANSI styling (no chalk dependency) ──────────────────────────────────────

const style = {
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

// ─── Engine ──────────────────────────────────────────────────────────────────

export class SequentialThinkingEngine {
  private thoughtHistory: ThoughtData[] = [];
  private branches: Record<string, ThoughtData[]> = {};
  private sessionId: string;
  private stateDir: string;
  private disableLogging: boolean;

  constructor(opts?: { stateDir?: string; disableLogging?: boolean }) {
    this.disableLogging = opts?.disableLogging ?? false;
    this.stateDir = opts?.stateDir ?? ".claude/sequential-thinking";
    this.sessionId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

    // Ensure state directory exists
    if (!this.disableLogging) {
      const dir = resolve(this.stateDir);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  // ─── Core thought processing ──────────────────────────────────────────────

  processThought(input: ThoughtData): {
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  } {
    try {
      // Auto-adjust totalThoughts if thoughtNumber exceeds estimate
      if (input.thoughtNumber > input.totalThoughts) {
        input.totalThoughts = input.thoughtNumber;
      }

      this.thoughtHistory.push(input);

      // Track branches
      if (input.branchFromThought && input.branchId) {
        if (!this.branches[input.branchId]) {
          this.branches[input.branchId] = [];
        }
        this.branches[input.branchId].push(input);
      }

      // Pretty-print to stderr for real-time visibility
      if (!this.disableLogging) {
        const formatted = this.formatThought(input);
        console.error(formatted);

        // Persist state after each thought
        this.persistSession();
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                thoughtNumber: input.thoughtNumber,
                totalThoughts: input.totalThoughts,
                nextThoughtNeeded: input.nextThoughtNeeded,
                branches: Object.keys(this.branches),
                thoughtHistoryLength: this.thoughtHistory.length,
                sessionId: this.sessionId,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: error instanceof Error ? error.message : String(error),
                status: "failed",
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
  }

  // ─── Pretty printer ───────────────────────────────────────────────────────

  private formatThought(data: ThoughtData): string {
    const { thoughtNumber, totalThoughts, thought, isRevision, revisesThought, branchFromThought, branchId } = data;

    let prefix: string;
    let context: string;

    if (isRevision) {
      prefix = style.yellow("🔄 Revision");
      context = ` (revising thought ${revisesThought})`;
    } else if (branchFromThought) {
      prefix = style.green("🌿 Branch");
      context = ` (from thought ${branchFromThought}, ID: ${branchId})`;
    } else {
      prefix = style.blue("💭 Thought");
      context = "";
    }

    const header = `${prefix} ${thoughtNumber}/${totalThoughts}${context}`;
    const border = "─".repeat(Math.max(header.replace(/\x1b\[\d+m/g, "").length, thought.length) + 4);

    return [
      "",
      `┌${border}┐`,
      `│ ${header}${" ".repeat(Math.max(0, border.length - header.replace(/\x1b\[\d+m/g, "").length - 2))} │`,
      `├${border}┤`,
      `│ ${thought.padEnd(border.length - 2)} │`,
      `└${border}┘`,
    ].join("\n");
  }

  // ─── State persistence ────────────────────────────────────────────────────

  private persistSession(): void {
    try {
      const session: PersistedSession = {
        id: this.sessionId,
        startedAt: this.sessionId.replace(/-/g, ":").replace(/T/, " ") + ":00",
        updatedAt: new Date().toISOString(),
        thoughtHistory: this.thoughtHistory,
        branches: this.branches,
        tags: [],
      };
      writeFileSync(
        join(this.stateDir, `session-${this.sessionId}.json`),
        JSON.stringify(session, null, 2),
        "utf8",
      );

      // Also update latest symlink via a "latest.json" pointer
      writeFileSync(
        join(this.stateDir, "latest.json"),
        JSON.stringify({ sessionId: this.sessionId, updatedAt: session.updatedAt, thoughtCount: this.thoughtHistory.length }, null, 2),
        "utf8",
      );
    } catch {
      // Silently fail — persistence is best-effort
    }
  }

  // ─── Export: Full thought chain as Markdown ───────────────────────────────

  exportMarkdown(): string {
    const lines: string[] = [];
    lines.push("# Sequential Thinking Session");
    lines.push("");
    lines.push(`- **Session ID:** \`${this.sessionId}\``);
    lines.push(`- **Total Thoughts:** ${this.thoughtHistory.length}`);
    lines.push(`- **Branches:** ${Object.keys(this.branches).length}`);
    lines.push("");

    if (this.thoughtHistory.length === 0) {
      lines.push("*No thoughts recorded yet.*");
      return lines.join("\n");
    }

    let currentBranchId: string | null = null;

    for (const t of this.thoughtHistory) {
      // Print branch header when transitioning
      if (t.branchId && t.branchId !== currentBranchId) {
        currentBranchId = t.branchId;
        lines.push(`## 🌿 Branch: \`${t.branchId}\``);
        lines.push("");
      }

      // Thought marker
      if (t.isRevision) {
        lines.push(`### 🔄 Thought ${t.thoughtNumber} (Revision of #${t.revisesThought})`);
      } else {
        lines.push(`### 💭 Thought ${t.thoughtNumber}/${t.totalThoughts}`);
      }
      lines.push("");
      lines.push(t.thought);
      lines.push("");
    }

    return lines.join("\n");
  }

  // ─── Export: Branch tree (ASCII/Mermaid) ─────────────────────────────────

  exportBranchTree(): { ascii: string; mermaid: string } {
    // Build a tree from thoughtHistory tracking branches
    const mainLine = this.thoughtHistory.filter((t) => !t.branchFromThought);
    const branchMap: Record<string, ThoughtData[]> = {};

    for (const t of this.thoughtHistory) {
      if (t.branchFromThought && t.branchId) {
        if (!branchMap[t.branchId]) branchMap[t.branchId] = [];
        branchMap[t.branchId].push(t);
      }
    }

    // ASCII tree
    const asciiLines: string[] = [];
    asciiLines.push("Thought Tree:");
    for (const t of mainLine) {
      const marker = t.isRevision ? "🔄" : "💭";
      const label = t.isRevision ? `Revise #${t.revisesThought}` : `Step ${t.thoughtNumber}`;
      asciiLines.push(`  ${marker} ${label}: "${truncate(t.thought, 60)}"`);

      // Find branches from this thought
      for (const [branchId, thoughts] of Object.entries(branchMap)) {
        const first = thoughts[0];
        if (first.branchFromThought === t.thoughtNumber) {
          asciiLines.push(`    🌿 Branch ${branchId}:`);
          for (const bt of thoughts) {
            asciiLines.push(`      💭 ${bt.thoughtNumber}: "${truncate(bt.thought, 50)}"`);
          }
        }
      }
    }

    // Mermaid tree
    const mermaidLines: string[] = [];
    mermaidLines.push("graph TD");
    for (const t of mainLine) {
      const id = `T${t.thoughtNumber}`;
      const label = escapeMermaid(t.thought.slice(0, 40));
      if (t.isRevision && t.revisesThought) {
        mermaidLines.push(`  ${id}["🔄 ${label}"]`);
        mermaidLines.push(`  T${t.revisesThought} -.-> ${id}`);
      } else if (t.thoughtNumber > 1) {
        const prev = mainLine
          .slice()
          .reverse()
          .find((p) => p.thoughtNumber < t.thoughtNumber && !p.isRevision);
        if (prev) {
          mermaidLines.push(`  T${prev.thoughtNumber} --> ${id}`);
        } else {
          mermaidLines.push(`  ${id}["💭 ${label}"]`);
        }
      } else {
        mermaidLines.push(`  ${id}["💭 ${label}"]`);
      }

      // Branch connections
      for (const [branchId, thoughts] of Object.entries(branchMap)) {
        const first = thoughts[0];
        if (first.branchFromThought === t.thoughtNumber) {
          const bId = `B${branchId.replace(/[^a-zA-Z0-9]/g, "")}`;
          mermaidLines.push(`  T${t.thoughtNumber} -->|"🌿 ${branchId}"| ${bId}`);
          for (const bt of thoughts) {
            const btId = `B${branchId.replace(/[^a-zA-Z0-9]/g, "")}_${bt.thoughtNumber}`;
            const btLabel = escapeMermaid(bt.thought.slice(0, 30));
            mermaidLines.push(`  ${btId}["💭 ${btLabel}"]`);
            const prevBt = thoughts.find((p) => p.thoughtNumber === bt.thoughtNumber - 1);
            if (prevBt) {
              const prevId = `B${branchId.replace(/[^a-zA-Z0-9]/g, "")}_${prevBt.thoughtNumber}`;
              mermaidLines.push(`  ${prevId} --> ${btId}`);
            } else {
              mermaidLines.push(`  ${bId} --> ${btId}`);
            }
          }
        }
      }
    }

    return { ascii: asciiLines.join("\n"), mermaid: mermaidLines.join("\n") };
  }

  // ─── Session summary / auto-summarize ────────────────────────────────────

  getSummary(): string {
    const thoughtCount = this.thoughtHistory.length;
    const revisionCount = this.thoughtHistory.filter((t) => t.isRevision).length;
    const branchCount = Object.keys(this.branches).length;
    const branchThoughts = Object.values(this.branches).flat().length;

    return [
      `Session: ${this.sessionId}`,
      `  Thoughts: ${thoughtCount} (${revisionCount} revisions, ${branchThoughts} branched)`,
      `  Branches: ${branchCount}`,
      `  Status: ${thoughtCount > 0 && !this.thoughtHistory[thoughtCount - 1]?.nextThoughtNeeded ? "Completed" : "In Progress"}`,
    ].join("\n");
  }

  // ─── Reset ─────────────────────────────────────────────────────────────────

  reset(): { previousThoughtCount: number } {
    const count = this.thoughtHistory.length;
    this.thoughtHistory = [];
    this.branches = {};
    this.sessionId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return { previousThoughtCount: count };
  }

  // ─── Getters ──────────────────────────────────────────────────────────────

  getThoughtHistory(): ReadonlyArray<ThoughtData> {
    return this.thoughtHistory;
  }

  getBranches(): Record<string, ReadonlyArray<ThoughtData>> {
    return this.branches;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getThoughtCount(): number {
    return this.thoughtHistory.length;
  }

  isComplete(): boolean {
    return this.thoughtHistory.length > 0 && !this.thoughtHistory[this.thoughtHistory.length - 1].nextThoughtNeeded;
  }

  // ─── Static: Load a previous session ──────────────────────────────────────

  static loadSession(sessionId: string, stateDir?: string): PersistedSession | null {
    const dir = resolve(stateDir ?? ".claude/sequential-thinking");
    const file = join(dir, `session-${sessionId}.json`);
    if (!existsSync(file)) {
      // Try finding by prefix
      const files = this.listSessions(stateDir);
      const match = files.find((f) => f.startsWith(sessionId));
      if (!match) return null;
      const matchFile = join(dir, `session-${match}.json`);
      if (!existsSync(matchFile)) return null;
      return JSON.parse(readFileSync(matchFile, "utf8"));
    }
    return JSON.parse(readFileSync(file, "utf8"));
  }

  static listSessions(stateDir?: string): string[] {
    const dir = resolve(stateDir ?? ".claude/sequential-thinking");
    if (!existsSync(dir)) return [];
    const entries = readdirSync(dir);
    return entries
      .filter((f) => f.startsWith("session-") && f.endsWith(".json"))
      .map((f) => f.replace("session-", "").replace(".json", ""))
      .sort()
      .reverse();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

function escapeMermaid(s: string): string {
  return s.replace(/[""#()]/g, "").replace(/[<>]/g, " ");
}
