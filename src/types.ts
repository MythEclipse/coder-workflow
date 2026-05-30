export type CodeGraphNodeType =
  | "file"
  | "module"
  | "class"
  | "function"
  | "method"
  | "component"
  | "route"
  | "handler";

export type CodeGraphEdgeType =
  | "imports"
  | "exports"
  | "calls"
  | "extends"
  | "implements"
  | "depends-on"
  | "route-handler"
  | "component-usage";

export interface CodeGraphNode {
  id: string;
  type: CodeGraphNodeType;
  name: string;
  path: string;
  language?: string;
  line?: number;
  startLine?: number;
  endLine?: number;
  summary?: string;
}

export interface CodeGraphEdge {
  id: string;
  type: CodeGraphEdgeType;
  source: string;
  target: string;
  evidence?: string;
  confidence?: number;
  resolution?: string;
  candidates?: string[];
}

export interface CodeGraph {
  version: "0.1.0";
  generatedAt: string;
  root: string;
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  metadata: {
    languages: string[];
    filesScanned: number;
    ignoredPaths: string[];
    nodesCount?: number;
    edgesCount?: number;
    nodeTypes?: Partial<Record<CodeGraphNodeType, number>>;
    edgeTypes?: Partial<Record<CodeGraphEdgeType, number>>;
    relationshipCoverage?: number;
    qualityScore?: number;
  };
}

export interface CodeGraphSettings {
  languages: string[];
  ignorePaths: string[];
  updateOnStop: boolean;
  updateOnEdit: boolean;
  commitGraphJson: boolean;
  maxDepth: number;
  uiPort: number;
  exports: string[];
  onParseFile?: (path: string) => void;
}
