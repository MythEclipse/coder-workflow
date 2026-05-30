import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CodeGraph } from "./types.js";

export function exportGraph(root: string, graph: CodeGraph, formats: string[]): string[] {
  const dir = join(root, ".codegraph", "exports");
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];

  if (formats.includes("json")) {
    const path = join(dir, "graph.json");
    writeFileSync(path, JSON.stringify(graph, null, 2));
    written.push(path);
  }
  if (formats.includes("mermaid")) {
    const path = join(dir, "graph.mmd");
    writeFileSync(path, toMermaid(graph));
    written.push(path);
  }
  if (formats.includes("dot")) {
    const path = join(dir, "graph.dot");
    writeFileSync(path, toDot(graph));
    written.push(path);
  }
  if (formats.includes("markdown")) {
    const path = join(dir, "architecture.md");
    writeFileSync(path, toMarkdown(graph));
    written.push(path);
  }
  if (formats.includes("html")) {
    const path = join(dir, "graph.html");
    writeFileSync(path, toHtml(graph));
    written.push(path);
  }

  return written;
}

function toMermaid(graph: CodeGraph): string {
  return [
    "graph TD",
    ...graph.edges
      .slice(0, 500)
      .map(
        (edge) =>
          `  ${mermaidId(edge.source)} -->|${mermaidLabel(edge.type)}| ${mermaidId(edge.target)}`,
      ),
  ].join("\n");
}

function toDot(graph: CodeGraph): string {
  return [
    "digraph CodeGraph {",
    ...graph.edges.map(
      (edge) =>
        `  ${dotString(edge.source)} -> ${dotString(edge.target)} [label=${dotString(edge.type)}];`,
    ),
    "}",
  ].join("\n");
}

function toMarkdown(graph: CodeGraph): string {
  const topNodes = [...graph.nodes]
    .map((node) => ({
      node,
      degree: graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id)
        .length,
    }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 20);

  return `# CodeGraph Architecture Summary\n\nGenerated: ${graph.generatedAt}\n\nFiles scanned: ${graph.metadata.filesScanned}\nNodes: ${graph.nodes.length}\nEdges: ${graph.edges.length}\nLanguages: ${graph.metadata.languages.join(", ")}\n\n## Hotspots\n\n${topNodes.map((item) => `- ${item.node.path} ${item.node.name} (${item.node.type}) degree=${item.degree}`).join("\n")}\n`;
}

function toHtml(graph: CodeGraph): string {
  const interactiveData = safeScriptJson({
    nodes: graph.nodes,
    edges: graph.edges,
    metadata: graph.metadata,
  });
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CodeGraph</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
  header { padding: 16px 20px; border-bottom: 1px solid #334155; }
  main { display: grid; grid-template-columns: 360px 1fr; min-height: calc(100vh - 73px); }
  aside { border-right: 1px solid #334155; padding: 16px; overflow: auto; }
  section { padding: 16px; overflow: auto; }
  input, select { width: 100%; box-sizing: border-box; margin: 0 0 12px; padding: 8px; background: #020617; color: #e2e8f0; border: 1px solid #475569; border-radius: 6px; }
  button { display: block; width: 100%; text-align: left; margin: 0 0 8px; padding: 8px; color: #e2e8f0; background: #1e293b; border: 1px solid #334155; border-radius: 6px; cursor: pointer; }
  button:hover { background: #334155; }
  .meta { color: #94a3b8; font-size: 12px; }
  .pill { display: inline-block; margin: 0 6px 6px 0; padding: 2px 8px; border-radius: 999px; background: #334155; font-size: 12px; }
  pre { white-space: pre-wrap; word-break: break-word; background: #020617; border: 1px solid #334155; border-radius: 6px; padding: 12px; }
</style>
<header>
  <h1>CodeGraph</h1>
  <div class="meta">${graph.nodes.length} nodes · ${graph.edges.length} edges · ${graph.metadata.filesScanned} files</div>
</header>
<main>
  <aside>
    <input id="search" placeholder="Search nodes by name, path, or type" autocomplete="off">
    <select id="typeFilter"><option value="">All node types</option></select>
    <div id="nodeList"></div>
  </aside>
  <section>
    <h2>Node Details</h2>
    <div id="nodeDetails" class="meta">Select a node.</div>
    <h2>Connected Edges</h2>
    <div id="edgeList"></div>
  </section>
</main>
<script>
window.__CODEGRAPH__ = ${interactiveData};
const graph = window.__CODEGRAPH__;
const search = document.getElementById('search');
const typeFilter = document.getElementById('typeFilter');
const nodeList = document.getElementById('nodeList');
const nodeDetails = document.getElementById('nodeDetails');
const edgeList = document.getElementById('edgeList');
const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
for (const type of [...new Set(graph.nodes.map(node => node.type))].sort()) {
  const option = document.createElement('option');
  option.value = type;
  option.textContent = type;
  typeFilter.appendChild(option);
}
function matches(node) {
  const needle = search.value.toLowerCase();
  const type = typeFilter.value;
  const text = [node.id, node.name, node.path, node.type, node.language || ''].join(' ').toLowerCase();
  return (!type || node.type === type) && (!needle || text.includes(needle));
}
function render() {
  nodeList.textContent = '';
  const nodes = graph.nodes.filter(matches).slice(0, 500);
  for (const node of nodes) {
    const button = document.createElement('button');
    button.innerHTML = '<strong>' + escapeHtml(node.name) + '</strong><div class="meta">' + escapeHtml(node.type + ' · ' + node.path) + '</div>';
    button.addEventListener('click', () => selectNode(node));
    nodeList.appendChild(button);
  }
  if (nodes.length === 0) nodeList.textContent = 'No matching nodes.';
}
function selectNode(node) {
  nodeDetails.innerHTML = '<div class="pill">' + escapeHtml(node.type) + '</div><pre>' + escapeHtml(JSON.stringify(node, null, 2)) + '</pre>';
  edgeList.textContent = '';
  const edges = graph.edges.filter(edge => edge.source === node.id || edge.target === node.id);
  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const div = document.createElement('div');
    div.innerHTML = '<div class="pill">' + escapeHtml(edge.type) + '</div><pre>' + escapeHtml((source?.name || edge.source) + ' -> ' + (target?.name || edge.target) + (edge.evidence ? ' [' + edge.evidence + ']' : '')) + '</pre>';
    edgeList.appendChild(div);
  }
  if (edges.length === 0) edgeList.textContent = 'No connected edges.';
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}
search.addEventListener('input', render);
typeFilter.addEventListener('change', render);
render();
</script>
</html>`;
}

function dotString(value: string): string {
  return JSON.stringify(value);
}

function mermaidId(value: string): string {
  return `n_${value.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function mermaidLabel(value: string): string {
  return value.replace(/[|[\]{}<>`]/g, "_");
}

function safeScriptJson(value: unknown): string {
  return [...JSON.stringify(value)]
    .map((char) => {
      switch (char.charCodeAt(0)) {
        case 60:
          return "\\u003c";
        case 62:
          return "\\u003e";
        case 38:
          return "\\u0026";
        case 0x2028:
          return "\\u2028";
        case 0x2029:
          return "\\u2029";
        default:
          return char;
      }
    })
    .join("");
}
