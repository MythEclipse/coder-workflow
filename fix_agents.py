import os
import re
import glob

# List of agent names
agents = [
    "architecture-auditor",
    "code-implementer",
    "code-reviewer",
    "codebase-qa-agent",
    "db-architect",
    "debugging-engineer",
    "devops-engineer",
    "diagram-engineer",
    "docs-engineer",
    "docs-generator",
    "memory-librarian",
    "multi-repo-orchestrator",
    "refactoring-engineer",
    "rollback-engineer",
    "secret-scanner",
    "test-engineer",
    "todo-checker",
    "ui-engineer",
    "vulnerability-scanner",
    "workflow-planner"
]

files_to_check = glob.glob('agents/*.md') + glob.glob('skills/**/*.md', recursive=True)

modified_files = 0

for filepath in files_to_check:
    with open(filepath, 'r') as f:
        content = f.read()

    new_content = content
    # Replace all occurrences of agent names with their prefixed version
    # Only if they are not already prefixed and not following 'name: '
    
    for agent in agents:
        # Regex explanation:
        # (?<!name:\s)  -> not preceded by 'name: ' (with space)
        # (?<!coder-workflow:) -> not preceded by 'coder-workflow:'
        # \b -> word boundary
        # agent -> the agent name
        # \b -> word boundary
        pattern = r"(?<!name: )(?<!name:)(?<!coder-workflow:)\b" + re.escape(agent) + r"\b"
        
        new_content = re.sub(pattern, f"coder-workflow:{agent}", new_content)
        
    if new_content != content:
        with open(filepath, 'w') as f:
            f.write(new_content)
        modified_files += 1
        print(f"Modified {filepath}")

print(f"Total modified files: {modified_files}")
