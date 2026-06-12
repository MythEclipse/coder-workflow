import { join } from "node:path";
import { cwd } from "node:process";
import { SequentialThinkingEngine } from "../sequential-thinking.js";

const _thinkingEngines = new Map<string, SequentialThinkingEngine>();

export function getThinkingEngine(sessionId?: string): SequentialThinkingEngine {
  const sid = sessionId || "default";
  if (!_thinkingEngines.has(sid)) {
    _thinkingEngines.set(
      sid,
      new SequentialThinkingEngine({
        stateDir: join(cwd(), ".claude", "sequential-thinking"),
      }),
    );
  }
  return _thinkingEngines.get(sid)!;
}

export function exportFromEngine(engine: SequentialThinkingEngine, format: string): string {
  if (format === "markdown") return engine.exportMarkdown();
  if (format === "ascii") return engine.exportBranchTree().ascii;
  if (format === "mermaid") return engine.exportBranchTree().mermaid;
  if (format === "json") {
    const session = SequentialThinkingEngine.loadSession(
      engine.getSessionId(),
      join(cwd(), ".claude", "sequential-thinking"),
    );
    return JSON.stringify(session, null, 2);
  }
  return engine.exportMarkdown();
}
