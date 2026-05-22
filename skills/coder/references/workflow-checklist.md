# Coder Workflow Checklist

## Before editing

- Read project instructions.
- Check git status.
- Identify user-owned uncommitted files.
- Enter plan mode for significant changes.
- Locate existing patterns before adding new abstractions.

## During implementation

- Keep changes scoped.
- Prefer editing existing files.
- Validate at boundaries only.
- Avoid compatibility shims unless explicitly required.
- Avoid comments unless the reason is non-obvious.

## Verification

- Run relevant typecheck.
- Run relevant lint/format check.
- Run focused tests first, then full suite when appropriate.
- For UI changes, run the app and manually test the path.
- Report any skipped verification clearly.
