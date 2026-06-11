---
description: Parse and analyze JSONL log files — error patterns, latency, anomaly detection
argument-hint: [log-file-or-path]
allowed-tools: Read, Grep, Glob, Bash, mcp__codegraph__*, mcp__code-review-graph__*
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T1] → Workflow(log-analysis): Parse and analyze JSONL log files

∴ Workflow({
  name: 'log-analysis',
  description: 'Parse logs, detect error patterns, latency spikes, anomalies',
  phases: [
    { title: 'Ingest',   detail: 'parallel: error extraction + latency stats + anomaly scan' },
    { title: 'Correlate', detail: 'correlate errors with code paths via CodeGraph' },
    { title: 'Report',   detail: 'ranked findings + root cause hypotheses' },
  ],
})

phase('Ingest')
const [errorPatterns, latencyData, anomalies] = await parallel([
  () => agent(
    `Run mcp__codegraph__analyze_logs on: ${$ARGUMENTS || '/tmp/cw-session.log'}.
    Extract: error messages, stack traces, error codes, frequency counts.
    Group by error type and source module.`,
    { label: 'error-extract', phase: 'Ingest', agent: 'coder-workflow:debugging-engineer' }
  ),
  () => agent(
    `Parse latency/timing data from logs: response times, slow queries, timeout events.
    Compute: p50, p95, p99 latencies. Identify requests >1s, >5s.
    Logs: ${$ARGUMENTS || '/tmp/cw-session.log'}`,
    { label: 'latency-stats', phase: 'Ingest', agent: 'coder-workflow:debugging-engineer' }
  ),
  () => agent(
    `Detect anomalies: error rate spikes, sudden latency jumps, unusual patterns.
    Use time-window analysis on log timestamps.
    Logs: ${$ARGUMENTS || '/tmp/cw-session.log'}`,
    { label: 'anomaly-scan', phase: 'Ingest', agent: 'coder-workflow:debugging-engineer' }
  ),
])

phase('Correlate')
const correlation = await agent(
  `Correlate log errors with source code via CodeGraph:
  - Match error messages to throwing functions
  - Trace call path from error to entry point
  - Identify which module is root cause
  Errors: ${errorPatterns}
  Anomalies: ${anomalies}`,
  { label: 'code-correlation', phase: 'Correlate', agent: 'coder-workflow:debugging-engineer' }
)

phase('Report')
const report = await agent(
  `Log analysis report:
  1. Error frequency table: error type | count | first seen | last seen
  2. Latency profile: p50/p95/p99 + slow query list
  3. Anomaly timeline
  4. Root cause hypotheses with code path references
  5. Recommended actions
  Errors: ${errorPatterns}
  Latency: ${latencyData}
  Anomalies: ${anomalies}
  Correlation: ${correlation}`,
  { label: 'log-report', phase: 'Report' }
)

return { report }
```
