---
description: Validate .env, JSON, YAML configs against schema; detect missing env vars
argument-hint: [env|json|missing-env]
allowed-tools: Read, Bash
---

Always execute via the Workflow engine.

```
∴ coder-orchestrator [T1] → Workflow(config-validate): Validate env/config files against schema

∴ Workflow({
  name: 'config-validate',
  description: 'Validate .env, JSON, YAML configs; detect missing/invalid env vars',
  phases: [
    { title: 'Validate', detail: 'parallel: env validation + json/yaml schema check + missing vars' },
    { title: 'Report',   detail: 'compliance status + remediation instructions' },
  ],
})

phase('Validate')
const [envResult, schemaResult, missingVars] = await parallel([
  () => agent(
    `Run mcp__codegraph__validate_env_file on .env files for: ${$ARGUMENTS || 'full project'}.
    Check: all vars in .env.example exist in .env, no extra vars, correct types.`,
    { label: 'env-validate', phase: 'Validate', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Run mcp__codegraph__validate_json_file or validate YAML configs in: ${$ARGUMENTS || 'full project'}.
    Check: valid JSON/YAML syntax, required fields present, type correctness.`,
    { label: 'schema-validate', phase: 'Validate', agent: 'coder-workflow:explore-codebase' }
  ),
  () => agent(
    `Run mcp__codegraph__detect_missing_env_vars: scan source code for process.env.X references.
    Cross-reference against .env + .env.example. List all referenced vars that are missing.`,
    { label: 'missing-vars', phase: 'Validate', agent: 'coder-workflow:explore-codebase' }
  ),
])

phase('Report')
const report = await agent(
  `Config validation report:
  1. FAIL: missing required vars + invalid types + schema violations
  2. WARN: extra vars not in .env.example + deprecated keys
  3. PASS: all validations passed
  4. Remediation: exact lines to add/fix
  Env: ${envResult}
  Schema: ${schemaResult}
  Missing: ${missingVars}`,
  { label: 'config-report', phase: 'Report' }
)

return { report }
```

CLI: `coder-workflow validate env --schema <file> [--env .env]` or `validate json` or `validate missing-env`
MCP: `validate_env_file`, `validate_json_file`, `detect_missing_env_vars`
