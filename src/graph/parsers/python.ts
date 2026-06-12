import { spawn, type ChildProcess } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { CodeGraphEdge, CodeGraphNode } from "../../types.js";
import { dedupeById, edge, nodeId } from "../ids.js";
import type { LanguageParser } from "./LanguageParser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKER_PATH = join(__dirname, "python-worker.py");

let pythonWorker: ChildProcess | null = null;
let msgIdCounter = 0;
const pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

function getPythonWorker(): ChildProcess {
  if (!pythonWorker) {
    pythonWorker = spawn("python3", [WORKER_PATH], { stdio: ["pipe", "pipe", "inherit"] });
    pythonWorker.unref();
    pythonWorker.stdout?.unref();
    pythonWorker.stdin?.unref();
    let buffer = "";
    pythonWorker.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const pending = pendingRequests.get(msg.id);
          if (pending) {
            pendingRequests.delete(msg.id);
            if (msg.error) pending.reject(new Error(msg.error));
            else pending.resolve(msg.result);
          }
        } catch (err) {
          console.error("Python worker output parse error:", err);
        }
      }
    });
    pythonWorker.on("error", (err) => {
      console.error("[Graph] Python worker error:", err);
      for (const pending of pendingRequests.values()) pending.reject(err);
      pendingRequests.clear();
      pythonWorker = null;
    });
    pythonWorker.on("exit", () => {
      for (const pending of pendingRequests.values()) pending.reject(new Error("Worker exited"));
      pendingRequests.clear();
      pythonWorker = null;
    });
  }
  return pythonWorker;
}

async function parsePythonAST(source: string, path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++msgIdCounter;
    pendingRequests.set(id, { resolve, reject });
    const worker = getPythonWorker();
    const payload = JSON.stringify({ id, action: "parse", source, path }) + "\n";
    worker.stdin?.write(payload);
  });
}

const astCache = new Map<string, Promise<any>>();

async function getAST(source: string, path: string): Promise<any> {
  const key = createHash("sha256").update(source).digest("hex");
  if (astCache.has(key)) return astCache.get(key);
  
  const promise = parsePythonAST(source, path);
  astCache.set(key, promise);
  if (astCache.size > 200) {
    const firstKey = astCache.keys().next().value;
    if (firstKey) astCache.delete(firstKey);
  }
  return promise;
}

export const pythonParser: LanguageParser = {
  language: "python",

  sanitize(source: string): string {
    return source; // Handled correctly by actual Python AST
  },

  async extractSymbols(source: string, path: string): Promise<CodeGraphNode[]> {
    const ast = await getAST(source, path);
    return ast.nodes ?? [];
  },

  async extractImports(source: string): Promise<string[]> {
    const ast = await getAST(source, "dummy.py");
    return ast.imports ?? [];
  },

  async parseImports(source: string): Promise<Map<string, string>> {
    const ast = await getAST(source, "dummy.py");
    const map = new Map<string, string>();
    for (const [alias, full] of ast.importMap ?? []) {
      map.set(alias, full);
    }
    return map;
  },

  async extractRoutes(source: string, path: string): Promise<CodeGraphNode[]> {
    const ast = await getAST(source, path);
    return ast.routes ?? [];
  },

  async extractRelationshipEdges(
    source: string,
    symbols: CodeGraphNode[],
    symbolByName: Map<string, CodeGraphNode[]>,
  ): Promise<CodeGraphEdge[]> {
    const ast = await getAST(source, "dummy.py");
    return ast.edges ?? [];
  },

  resolveSymbolRanges(
    source: string,
    symbols: CodeGraphNode[],
  ): Map<string, { startLine: number; endLine: number }> {
    const ranges = new Map<string, { startLine: number; endLine: number }>();
    for (const symbol of symbols) {
      if (symbol.startLine && symbol.endLine) {
        ranges.set(symbol.id, { startLine: symbol.startLine, endLine: symbol.endLine });
      }
    }
    return ranges;
  },

  resolveImportTarget(
    imported: string,
    _sourcePath: string,
    filePaths: Set<string>,
  ): string | undefined {
    const importSlash = imported.replace(/\./g, "/");
    for (const ext of [".py"]) {
      const direct = `${importSlash}${ext}`;
      for (const fp of filePaths) {
        if (fp === direct || fp.endsWith(`/${direct}`)) return fp;
      }
    }
    return undefined;
  },

  matchImport(imported: string, targetPath: string, _sourcePath?: string): boolean {
    const targetClean = targetPath.replace(/\.py$/, "");
    const targetNormalized = targetClean.replace(/\\/g, "/");
    let importNormalized = imported.replace(/\\/g, "/");
    importNormalized = importNormalized.replace(/^(\.\/|\.\.\/)+/, "");
    importNormalized = importNormalized.replace(/\.py$/, "");
    const importSlash = importNormalized.replace(/\./g, "/");
    return targetNormalized.endsWith(importSlash);
  },
};
