# Multi-Provider Expansion Plan

**Goal:** Transform claude-test from a Claude-only tool into a universal DevTools for ALL AI coding assistants — Claude Code, Cursor, Windsurf, GitHub Copilot, Aider, Continue.dev, Cline, and any AI-powered coding workflow.

**Key Insight from the image:** Agentic coding workflows (plan mode, subagent strategy, self-improvement loops, verification, task management) are universal patterns. The tool should detect and validate these patterns regardless of which AI tool created them.

---

## Changes Overview

### 1. Model Registry (new)
Universal model database with context windows and pricing for all major providers.

### 2. Provider Abstraction (new)
Multi-provider API client supporting Anthropic, OpenAI, Google, DeepSeek, and local models.

### 3. Universal AI Tool Detection (expand agentTracer)
Detect config files for ALL AI coding tools, not just Claude Code.

### 4. Universal Context Windows (expand simulate/pack)
Support context window sizes for all models, not just Claude's 200k/1M.

### 5. Agentic Workflow Detection (new)
Detect agentic workflow patterns: tasks/todo.md, tasks/lessons.md, plan files.

### 6. Update branding and docs
Position as universal "DevTools for AI Coding" while keeping the claude-test name.

---

## Task 1: Model Registry

Create `src/core/modelRegistry.ts` with complete model data:

```typescript
interface ModelInfo {
  id: string;
  provider: 'anthropic' | 'openai' | 'google' | 'deepseek' | 'qwen' | 'meta' | 'mistral' | 'local';
  name: string;
  contextWindow: number;
  maxOutput: number;
  inputPricePer1M: number;  // USD
  outputPricePer1M: number; // USD
}
```

Models to include:
- Anthropic: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5
- OpenAI: gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, gpt-4o, o3, o4-mini
- Google: gemini-2.5-pro, gemini-2.5-flash
- DeepSeek: deepseek-v3, deepseek-r1
- Qwen: qwen-3-235b, qwen-3-32b
- Meta: llama-4-maverick, llama-4-scout
- Mistral: codestral-25.01
- Local: ollama (configurable)

## Task 2: Provider Abstraction

Create `src/core/providers/` with:
- `base.ts` — ProviderClient interface
- `anthropic.ts` — Uses existing anthropicClient logic
- `openai.ts` — OpenAI-compatible client (also works for DeepSeek, local)
- `google.ts` — Google Gemini client
- `factory.ts` — Creates the right client from model name

Update benchmark and test live mode to use the factory.

## Task 3: Universal AI Tool Detection

Expand agentTracer to detect ALL AI coding tool configs:

| Tool | Files to detect |
|------|----------------|
| Claude Code | CLAUDE.md, .claude/, .claude/settings.json |
| Cursor | .cursorrules, .cursor/rules/, .cursor/mcp.json |
| Windsurf | .windsurfrules, .windsurf/rules/ |
| GitHub Copilot | .github/copilot-instructions.md, .copilot/ |
| Aider | .aider.conf.yml, .aiderignore, .aider.model.settings.yml |
| Continue.dev | .continue/, .continue/config.json |
| Cline | .clinerules, .cline/ |
| OpenAI Codex | codex.md, .codex/ |
| General | AGENTS.md, CONTEXT.md, AI.md, .ai/ |
| Agentic | tasks/todo.md, tasks/lessons.md, plans/, PLAN.md |

Add new asset types: 'cursor-config', 'windsurf-config', 'copilot-config', 'aider-config', 'continue-config', 'cline-config', 'codex-config', 'agentic-workflow'.

## Task 4: Universal Context Windows

Update simulate and pack to support all model context windows:
- `--model <model>` flag to use that model's context window
- Default still 200k/1M for backward compat
- Show fit estimates for multiple popular models at once

## Task 5: Agentic Workflow Features

Add new command: `claude-test workflow [path]`
Detect and validate agentic workflow patterns:
- tasks/todo.md — parse checkboxes, report completion %
- tasks/lessons.md — detect self-improvement entries
- Plan files — detect and summarize
- Verify workspace hygiene

## Task 6: Update Docs and Branding

Update README, CLAUDE.md, and help text:
- "DevTools for AI Coding" (subtitle)
- "Works with Claude Code, Cursor, Windsurf, Copilot, Aider, and more"
- Keep `claude-test` as the CLI name (it's the brand)
- Update examples to show multi-provider usage
