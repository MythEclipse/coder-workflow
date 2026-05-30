import type { CodeGraphEdge, CodeGraphNode } from "../../types.js";
import { dedupeEdges, edge, nodeId } from "../ids.js";
import { joinRoute } from "../parsers/utils.js";

export function extractRouteHandlerEdges(
  source: string,
  path: string,
  symbolByName: Map<string, CodeGraphNode[]>,
): CodeGraphEdge[] {
  const edges: CodeGraphEdge[] = [];

  const routePatterns = [
    /(?:app|router|http)\.(?:get|post|put|patch|delete|HandleFunc)\(["']([^"']+)["']\s*,\s*(?:[A-Za-z_$][\w$]*{}\.)?([A-Za-z_$][\w$]*)/g,
    /@(\w+)\.(?:get|post|put|patch|delete)\(["']([^"']+)["']\)\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/g,
    /@(?:GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\(["']([^"']+)["']\)\s*(?:public|private|protected)?\s*(?:static\s+)?[A-Za-z_<>,.?[\]]+\s+([A-Za-z_]\w*)\s*\(/g,
  ];

  for (const match of source.matchAll(routePatterns[0])) {
    pushRouteEdges(edges, path, match[1], match[2], symbolByName);
  }

  for (const match of source.matchAll(routePatterns[1])) {
    pushRouteEdges(edges, path, match[2], match[3], symbolByName);
  }

  const javaClassRoute = source.match(/@RequestMapping\(["']([^"']+)["']\)/)?.[1];
  for (const match of source.matchAll(routePatterns[2])) {
    pushRouteEdges(edges, path, joinRoute(javaClassRoute, match[1]), match[2], symbolByName);
  }

  return dedupeEdges(edges);
}

function pushRouteEdges(
  edges: CodeGraphEdge[],
  path: string,
  route: string,
  handler: string,
  symbolByName: Map<string, CodeGraphNode[]>,
): void {
  for (const target of symbolByName.get(handler) ?? []) {
    edges.push(edge("route-handler", nodeId("route", `${path}:${route}`), target.id, handler));
  }
}
