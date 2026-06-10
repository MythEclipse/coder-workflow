import re

with open('/mnt/code/djnaidwhbwda/coder-workflow/src/consistency-enforcer.ts', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if '//' in line or '/*' in line or '*/' in line or '*' in line:
        if 'Memvalidasi' in line or 'Cek' in line or 'Daftar' in line or 'library' in line:
            # already found some, let's just print all comments to see
            pass

indo_keywords = ['yang', 'untuk', 'dengan', 'ini', 'itu', 'dari', 'ke', 'di', 'dan', 'cek', 'daftar', 'memvalidasi', 'jika', 'apakah', 'ada', 'tidak', 'lebih']
for i, line in enumerate(lines):
    if '//' in line or '*' in line:
        lower_line = line.lower()
        if any(re.search(rf'\b{kw}\b', lower_line) for kw in indo_keywords):
            print(f"{i+1}: {line.strip()}")
