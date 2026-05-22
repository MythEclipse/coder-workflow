param(
  [switch]$Project,
  [switch]$Link,
  [switch]$DryRun,
  [switch]$SkillsOnly,
  [switch]$AgentsOnly,
  [Parameter(ValueFromRemainingArguments = $true)] [string[]]$Components
)

if ($SkillsOnly -and $AgentsOnly) {
  Write-Error "--skills-only and --agents-only cannot be combined"
  exit 1
}

$PluginRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dest = Join-Path $env:USERPROFILE ".claude"
if ($Project) { $Dest = Join-Path (Get-Location) ".claude" }

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

if (-not $AgentsOnly) {
  Install-DirectoryItems (Join-Path $PluginRoot "skills") "skills"
}

if (-not $SkillsOnly) {
  Install-DirectoryItems (Join-Path $PluginRoot "agents") "agents"
}

Write-Host "Install complete: $Dest"
Write-Host "Restart Claude Code or run /reload."
