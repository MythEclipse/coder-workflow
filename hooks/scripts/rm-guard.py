#!/usr/bin/env python3
import sys
import json
import shlex

def main():
    try:
        input_data = json.load(sys.stdin)
        command = input_data.get("tool_input", {}).get("command", "")
    except Exception:
        sys.exit(0)

    if not command:
        sys.exit(0)

    # Split command safely using shlex
    try:
        tokens = shlex.split(command)
    except Exception:
        tokens = command.split()

    if not tokens:
        sys.exit(0)

    # Find the 'rm' command in the tokens (it might be prefixed with env vars or run via sudo/bash)
    rm_idx = -1
    for i, token in enumerate(tokens):
        if token == "rm" or token.endswith("/rm"):
            rm_idx = i
            break

    if rm_idx == -1:
        sys.exit(0)

    # Parse options and targets after the 'rm' command
    has_r = False
    has_f = False
    targets = []
    double_dash = False

    for token in tokens[rm_idx + 1:]:
        if double_dash:
            targets.append(token)
        elif token == "--":
            double_dash = True
        elif token.startswith("-") and token != "-":
            if token.startswith("--"):
                if "recursive" in token:
                    has_r = True
                if "force" in token:
                    has_f = True
            else:
                for char in token[1:]:
                    if char in "rR":
                        has_r = True
                    elif char in "f":
                        has_f = True
        else:
            targets.append(token)

    # Dangerous targets that should never be deleted recursively
    dangerous_targets = {"/", "*", ".", "./", "./*", "/*", "~", "~/", "~/*", "$HOME", "$HOME/", "$HOME/*"}

    is_dangerous = False
    blocked_target = ""
    for t in targets:
        # Strip trailing slashes/quotes for comparison
        norm_t = t.rstrip("/").rstrip("'").rstrip('"')
        if not norm_t:
            norm_t = "/"
        
        if t in dangerous_targets or norm_t in dangerous_targets:
            is_dangerous = True
            blocked_target = t
            break

    # We block if it is recursive (-r/-R/--recursive) and targeting a dangerous path
    if is_dangerous and has_r:
        reason = f"coder-workflow safety guard: rm command targeting '{blocked_target}' with recursive flag is blocked. This would destroy critical filesystem paths. Narrow the target explicitly (e.g. rm -rf ./dist/specific-file) and re-run."
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason
            }
        }
        print(json.dumps(output))
        sys.exit(0)

    sys.exit(0)

if __name__ == "__main__":
    main()
