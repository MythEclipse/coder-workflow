# Durable Memory Wiki

Consolidated knowledge and long-term facts.

## Core Learnings

- **Topic:** exist current working
  **Context:** Failure observation: File does not exist. Note: your current working directory is /mnt/code/djnaidwhbwda/coder-workflow.
  *Promoted on:* 2026-06-10T11:48:49.368Z

- **Topic:** coderworkflow030 build typecheck
  **Context:** Failure observation: Exit code 1

> coder-workflow@0.3.0 test
> npm run build && npm run typecheck && c8 --reporter=text --lines 80 node --test dist/test/**/*.test.js


> coder-workflow@0.3.0 build
> node esbuild.config.m
  *Promoted on:* 2026-06-10T11:48:49.368Z

- **Topic:** formatadrlist returns empty
  **Context:** Failure observation: Exit code 1
✔ formatADRList returns empty message for empty list (2.613188ms)
✔ formatADRList formats single ADR entry with all fields (0.514308ms)
✔ formatADRList formats all four statuses (0.4
  *Promoted on:* 2026-06-10T11:48:49.368Z

- **Topic:** getprefix returns default
  **Context:** Failure observation: Exit code 1
✔ getPrefix returns default prefix for unknown type (4.176327ms)
✔ getPrefix returns specific agent prefixes (2.091585ms)
✔ getPrefix returns system prefix (0.414583ms)
✔ getPrefix
  *Promoted on:* 2026-06-10T11:48:49.368Z

- **Topic:** compress autodetects array
  **Context:** Failure observation: Exit code 1
✔ compress auto-detects JSON array and applies crushArray (1.643356ms)
✔ compress JSON array with 40 items truncates to 30 with _truncated marker (0.337033ms)
✔ compress JSON array w
  *Promoted on:* 2026-06-10T11:48:49.368Z

- **Topic:** nodeinternalmodulesesmresolve271 throw errmodulenotfound
  **Context:** Failure observation: Exit code 1
node:internal/modules/esm/resolve:271
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/mnt/code/djnaidwhbwda/coder-workflow/dist/src/conf
  *Promoted on:* 2026-06-10T11:48:49.368Z

- **Topic:** coderworkflow030 build esbuildconfigmjs
  **Context:** Failure observation: Exit code 1

> coder-workflow@0.3.0 build
> node esbuild.config.mjs


  dist/cli.js  1.1mb ⚠️

⚡ Done in 37ms

  dist/mcp-server.js  966.2kb

⚡ Done in 35ms

  dist/test/graph.test.js         
  *Promoted on:* 2026-06-10T11:48:49.368Z

- **Topic:** testconfigvalidatortestts1665 error ts2741
  **Context:** Failure observation: Exit code 2
test/config-validator.test.ts(166,5): error TS2741: Property 'required' is missing in type '{ type: "string"; pattern: string; }' but required in type 'EnvSchemaEntry'.
test/doctor.test.ts
  *Promoted on:* 2026-06-10T11:48:49.368Z

- **Topic:** testcompresstestts10530 error ts2339
  **Context:** Failure observation: Exit code 2
test/compress.test.ts(105,30): error TS2339: Property 'x' does not exist on type '{}'.
test/compress.test.ts(106,16): error TS7053: Element implicitly has an 'any' type because expression 
  *Promoted on:* 2026-06-10T11:48:49.368Z

- **Topic:** error stdin5 cannot
  **Context:** Failure observation: Exit code 5
jq: error (at <stdin>:5): Cannot index array with string "orphanFiles"
  *Promoted on:* 2026-06-10T11:48:49.368Z

- **Topic:** eisdir illegal operation
  **Context:** Failure observation: EISDIR: illegal operation on a directory, read '/mnt/code/djnaidwhbwda/coder-workflow/src'
  *Promoted on:* 2026-06-10T11:48:49.368Z
