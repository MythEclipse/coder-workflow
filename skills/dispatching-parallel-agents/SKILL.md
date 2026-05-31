---
name: dispatching-parallel-agents
description: Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies
---

# Dispatching Parallel Agents

## Overview

You delegate tasks to specialized agents with isolated context. By precisely crafting their instructions and context, you ensure they stay focused and succeed at their task. They should never inherit your session's context or history — you construct exactly what they need. This also preserves your own context for coordination work.

When you have multiple unrelated tasks (different features, different test files, different subsystems), investigating them sequentially wastes time. Each investigation is independent and can happen in parallel.

**Core principle:** Dispatch one agent per independent problem domain. Let them work concurrently.

## When to Use

**Use when:**
- 3+ test files failing with different root causes
- Multiple subsystems need to be built independently
- Each problem can be understood without context from others
- No shared state between investigations

**Don't use when:**
- Failures are related (fix one might fix others)
- Need to understand full system state
- Agents would interfere with each other (modifying the same files)

## The Pattern

### 1. Identify Independent Domains

Group failures or features by what they affect:
- Component A: Tool approval flow
- Component B: Batch completion behavior
- Component C: Abort functionality

Each domain is independent.

### 2. Create Focused Agent Tasks

Each agent gets:
- **Specific scope:** One test file or subsystem
- **Clear goal:** Make these tests pass or implement this exact feature
- **Constraints:** Don't change other code, do not suppress bugs
- **Expected output:** Summary of what you found and fixed

### 3. Dispatch in Parallel

Launch the sub-agents concurrently. For example:
- Agent 1: `code-implementer` for Component A
- Agent 2: `code-implementer` for Component B

Wait for their completion and review their outputs before continuing.
