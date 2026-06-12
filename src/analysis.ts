// Analysis barrel — re-exports from consolidated analysis-impl.ts

export type {
  ArchitectureSummary,
  GraphQualityCategory,
  GraphQualityIssue,
  GraphQualityReport,
  GraphQualitySeverity,
  ImpactAnalysisResult,
  QualityGateResult,
  QualityGateThreshold,
  QueryGraphResult,
} from "./analysis-impl.js";
export {
  analyzeGraphQuality,
  analyzeImpact,
  evaluateQualityGate,
  findCycles,
  findOrphans,
  queryGraph,
  summarizeArchitecture,
} from "./analysis-impl.js";
