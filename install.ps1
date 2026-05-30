param(
  [switch]$Project,
  [switch]$Link,
  [switch]$DryRun,
  [switch]$McpOnly,
  [switch]$SkillsOnly,
  [switch]$AgentsOnly,
  [switch]$HooksOnly,
  [switch]$CommandsOnly,
  [Parameter(ValueFromRemainingArguments = $true)] [string[]]$Components
)

# Validate mutually exclusive flags
$exclusiveCount = @($SkillsOnly, $AgentsOnly, $HooksOnly, $CommandsOnly) | Where-Object { $_ } | Measure-Object | Select-Object -ExpandProperty Count
if ($exclusiveCount -gt 1) {
  Write-Error "Only one of -SkillsOnly, -AgentsOnly, -HooksOnly, -CommandsOnly may be used at a time."
  exit 1
}

$PluginRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dest = Join-Path $env:USERPROFILE ".claude\skills\coder-workflow"
if ($Project) { $Dest = Join-Path (Get-Location) ".claude" }

# Warn if jq is missing — required by hook guard scripts
if (-not (Get-Command jq -ErrorAction SilentlyContinue)) {
  Write-Warning "jq not found. Hook guard scripts (rm-guard, force-push-guard, env-write-guard) require jq."
  Write-Warning "Install from https://jqlang.org for full hook functionality."
}

function Test-Selected($Name) {
  if (-not $Components -or $Components.Count -eq 0) { return $true }
  return $Components -contains $Name
}

function Invoke-Step($ScriptBlock, $Message) {
  if ($DryRun) {
    Write-Host "dry-run: $Message"
  } else {
    & $ScriptBlock
  }
}

function Install-ItemToClaude($Src, $Dst) {
  $Parent = Split-Path -Parent $Dst
  Invoke-Step { New-Item -ItemType Directory -Path $Parent -Force | Out-Null } "mkdir $Parent"

  if ($Link) {
    Invoke-Step { if (Test-Path $Dst) { Remove-Item $Dst -Recurse -Force } } "remove $Dst"
    Invoke-Step { New-Item -ItemType SymbolicLink -Path $Dst -Target (Resolve-Path $Src) | Out-Null } "link $Src -> $Dst"
    if ($DryRun) { Write-Host "would link $Src -> $Dst" } else { Write-Host "linked $Src -> $Dst" }
  } else {
    Invoke-Step { if (Test-Path $Dst) { Remove-Item $Dst -Recurse -Force } } "remove $Dst"
    Invoke-Step { Copy-Item $Src -Destination $Dst -Recurse -Force } "copy $Src -> $Dst"
    if ($DryRun) { Write-Host "would copy $Src -> $Dst" } else { Write-Host "copied $Src -> $Dst" }
  }
}

function Install-DirectoryItems($SrcDir, $DestSub) {
  if (-not (Test-Path $SrcDir)) { return }
  $DestDir = Join-Path $Dest $DestSub
  Invoke-Step { New-Item -ItemType Directory -Path $DestDir -Force | Out-Null } "mkdir $DestDir"

  Get-ChildItem $SrcDir | ForEach-Object {
    if (-not (Test-Selected $_.Name)) { return }
    Install-ItemToClaude $_.FullName (Join-Path $DestDir $_.Name)
  }
}

# --- MCP-only mode ---
if ($McpOnly) {
  $BinPath = (Get-Command coder-workflow -ErrorAction SilentlyContinue)?.Source
  if (-not $BinPath) {
    Write-Error "coder-workflow is not installed globally. Run the full installer first."
    exit 1
  }
  Write-Host "MCP-only: coder-workflow at $BinPath"
  Write-Host "Restart Claude Code to pick up MCP configuration."
  exit 0
}

# --- Link entire plugin root for development ---
if ($Link -and -not $Project -and -not $SkillsOnly -and -not $AgentsOnly -and -not $HooksOnly -and -not $CommandsOnly -and (-not $Components -or $Components.Count -eq 0)) {
  Write-Host "Linking entire plugin directory to Claude Code skills..."
  $Parent = Split-Path -Parent $Dest
  Invoke-Step { New-Item -ItemType Directory -Path $Parent -Force | Out-Null } "mkdir $Parent"
  Invoke-Step { if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force } } "remove $Dest"
  Invoke-Step { New-Item -ItemType SymbolicLink -Path $Dest -Target (Resolve-Path $PluginRoot) | Out-Null } "link $PluginRoot -> $Dest"
  if ($DryRun) { Write-Host "would link $PluginRoot -> $Dest" } else { Write-Host "linked $PluginRoot -> $Dest" }
  Write-Host ""
  Write-Host "Installation complete! (Whole repository linked for development)"
  exit 0
}

# --- Plugin files installation ---
if (-not $AgentsOnly -and -not $HooksOnly -and -not $CommandsOnly) {
  Install-DirectoryItems (Join-Path $PluginRoot "skills") "skills"
}

if (-not $SkillsOnly -and -not $HooksOnly -and -not $CommandsOnly) {
  Install-DirectoryItems (Join-Path $PluginRoot "agents") "agents"
}

if (-not $SkillsOnly -and -not $AgentsOnly -and -not $CommandsOnly) {
  Install-DirectoryItems (Join-Path $PluginRoot "hooks") "hooks"
  # Note: hooks/scripts/*.sh are bash scripts intended for Linux/macOS.
  # On Windows, Claude Code hook commands using bash exec form require Git Bash
  # or WSL on PATH. The hooks still install correctly — only bash availability
  # at runtime determines whether guard scripts can execute.
}

if (-not $SkillsOnly -and -not $AgentsOnly -and -not $HooksOnly) {
  Install-DirectoryItems (Join-Path $PluginRoot "commands") "commands"
}

# Install plugin.json for Claude Code plugin discovery (non-project installs)
if (-not $SkillsOnly -and -not $AgentsOnly -and -not $HooksOnly -and -not $CommandsOnly -and -not $Project) {
  $PluginJsonSrc = Join-Path $PluginRoot ".claude-plugin\plugin.json"
  $PluginJsonDst = Join-Path $Dest ".claude-plugin\plugin.json"
  if (Test-Path $PluginJsonSrc) {
    Install-ItemToClaude $PluginJsonSrc $PluginJsonDst
  }
  $McpJsonSrc = Join-Path $PluginRoot ".mcp.json"
  $McpJsonDst = Join-Path $Dest ".mcp.json"
  if (Test-Path $McpJsonSrc) {
    Install-ItemToClaude $McpJsonSrc $McpJsonDst
  }
}

Write-Host ""
Write-Host "Installation complete: $Dest"
Write-Host ""
Write-Host "Active hooks (36 entries across 15 events):"
Write-Host "  SessionStart  startup  -> banner + graph status + async auto-scan"
Write-Host "  SessionStart  resume   -> graph age check + task-state reminder"
Write-Host "  PreToolUse    Bash     -> rm-guard + force-push-guard (require bash + jq)"
Write-Host "  PreToolUse    Write    -> env-write-guard (require bash + jq + git)"
Write-Host "  PostToolUse   Write/*  -> bug tracking reminder + async graph update"
Write-Host "  Stop                   -> verification checklist + async graph update"
Write-Host "  FileChanged   *        -> package, .env, CLAUDE.md, tsconfig watchers"
Write-Host "  TaskCreated/Completed  -> task lifecycle echo + log"
Write-Host "  SessionEnd             -> session summary + log cleanup"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Restart Claude Code (or run /reload-plugins)"
Write-Host "  2. Start any coding task -- /coder-workflow:coder-orchestrator is your entry point"
Write-Host "  3. On Windows: ensure Git Bash is on PATH for hook guard scripts to run"
Write-Host ""
