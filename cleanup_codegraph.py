import os, glob, re

files = glob.glob('agents/*.md') + glob.glob('commands/*.md') + glob.glob('skills/**/*.md', recursive=True)

for f in files:
    with open(f, 'r') as file:
        content = file.read()
    
    # 1. Strip `mcp__codegraph__*` from allowed-tools / tools list
    content = re.sub(r',\s*"mcp__codegraph__\*"', '', content)
    content = re.sub(r',\s*mcp__codegraph__\*', '', content)
    content = re.sub(r'"mcp__codegraph__\*",\s*', '', content)
    content = re.sub(r'mcp__codegraph__\*,\s*', '', content)
    
    # 2. Remove the IMPORTANT warning blocks about MCP TOOL UPDATES
    # Matches "> [!IMPORTANT]\n> MCP TOOL UPDATES:" and any subsequent lines starting with ">"
    content = re.sub(r'>\s*\[!IMPORTANT\]\s*\n>\s*MCP TOOL UPDATES:(?:\n>.*)*', '', content)
    
    # 3. Generalize specific tool references in text.
    content = re.sub(r'(?i)Use `?mcp__codegraph__[a-zA-Z0-9_]+`?', 'Use your graph/mapping tools', content)
    content = re.sub(r'(?i)Run `?mcp__codegraph__[a-zA-Z0-9_]+`?', 'Run your graph/mapping tools', content)
    content = re.sub(r'`mcp__codegraph__[a-zA-Z0-9_]+`', 'graph/mapping tools', content)
    content = re.sub(r'mcp__codegraph__[a-zA-Z0-9_]+', 'graph/mapping tools', content)
    
    # 4. Replace capitalized generic phrases
    content = re.sub(r'(?i)CodeGraph MCP', 'Graph-based MCP tools', content)
    content = re.sub(r'(?i)CodeGraph tools', 'Graph-based MCP tools', content)
    content = re.sub(r'CodeGraph', 'Graph-based MCP tools', content)

    # 5. Fix double newlines at end of file if any were introduced
    content = re.sub(r'\n{3,}', '\n\n', content)
    
    with open(f, 'w') as file:
        file.write(content)

print(f"Cleaned up {len(files)} files.")
