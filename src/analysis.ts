// Analysis barrel — re-exports from consolidated analysis-impl.ts
export {
  analyzeGraphQuality,
  analyzeImpact,
  evaluateQualityGate,
  findCycles,
  findOrphans,
  queryGraph,
  summarizeArchitecture,
} from "./analysis-impl.js";
export type {
  GraphQualityIssue,
  GraphQualityReport,
  GraphQualitySeverity,
  GraphQualityCategory,
  QualityGateResult,
  QualityGateThreshold,
} from "./analysis-impl.js";
export type { ImpactAnalysisResult } from "./analysis-impl.js";
export type { QueryGraphResult } from "./analysis-impl.js";
export type { ArchitectureSummary } from "./analysis-impl.js";
