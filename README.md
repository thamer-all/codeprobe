# codeprobe

**DevTools for AI Coding — Context Engineering Toolkit for Claude, Cursor, Copilot, and more**

`codeprobe` is a developer toolkit for testing, analyzing, and optimizing AI coding workflows. It helps you write better prompts, understand your repository's context footprint, and build production-grade AI pipelines with any major LLM provider. Works with Claude Code, Cursor, GitHub Copilot, Windsurf, Aider, and other AI coding tools.

---

## Why Context Engineering Matters

Claude's effectiveness depends on what you put in the context window. Most developers waste context on irrelevant files, oversized prompts, or poorly structured instructions. `codeprobe` gives you the tools to measure, analyze, and optimize every token you send to Claude.

## Install

```bash
npm install -g codeprobe
```

## Quickstart

```bash
# Instant dashboard — just run codeprobe
codeprobe

# Full project scan in one command
codeprobe scan

# Set up starter files and config
codeprobe init

# Run prompt tests
codeprobe test

# Analyze your repo's context footprint
codeprobe context

# Generate a CLAUDE.md from repo analysis
codeprobe generate-claudemd
```

## How It Works

```bash
# Just type codeprobe — instant dashboard
codeprobe

# Full project scan in one command
codeprobe scan

# Quick summary
codeprobe summary

# CI/CD gate — one command, clear pass/fail
codeprobe check
```

codeprobe is designed to be useful immediately. No setup required for context analysis — just run it in any project directory.

## Core Commands

| Command | Description |
|---------|-------------|
| `init` | Create starter folders, example prompts, and config |
| `test [path]` | Run prompt tests with assertions |
| `diff <a> <b>` | Compare two prompt specs |
| `context [path]` | Analyze repository context usage and token counts |
| `simulate [path]` | Simulate whether a repo fits into Claude context windows |
| `pack [path]` | Build an optimized context packing plan |
| `benchmark [path]` | Benchmark prompts across Anthropic models |
| `agents [path]` | Scan for Claude-related workflow assets |
| `hooks [path]` | Detect hook configurations |
| `mcp [path]` | Detect MCP server configurations |
| `lint [path]` | Lint prompt specs for quality problems |
| `improve <file>` | Suggest prompt improvements |
| `map [path]` | Produce a repository context map |
| `heatmap [path]` | Show token-heavy files and hot spots |
| `explain <file>` | Explain prompt weaknesses and likely failures |
| `validate [path]` | Validate prompt specs and Claude assets |
| `security [path]` | Run prompt security and injection checks |
| `doctor` | Diagnose environment readiness |
| `repl` | Interactive prompt playground |
| `generate-claudemd` | Generate a CLAUDE.md from repo analysis |
| `workflow [path]` | Detect agentic workflow patterns (tasks, plans, lessons) |
| `check [path]` | CI-friendly gate — run all validations, exit 0 or 1 |
| `summary [path]` | Quick one-screen project overview |
| `install-hook` | Install a Claude Code hook for prompt testing |

## Prompt Testing

Write prompt specs as YAML files:

```yaml
name: summarize
description: Summarize text into 3 bullet points
model: claude-sonnet-4-6

system: |
  You are a concise summarizer. Always respond with exactly 3 bullet points.

prompt: |
  Summarize the following text in exactly 3 bullet points:
  {{input}}

tests:
  - name: basic
    input: |
      Claude Code is an agentic coding tool that lives in your terminal.
      It understands your codebase, can edit files, and run commands.
    expect:
      contains:
        - Claude Code
      regex:
        - "^- "

  - name: from-file
    inputFile: ./fixtures/article.txt
    expect:
      contains:
        - context
```

Run tests:

```bash
codeprobe test prompts/

# With watch mode
codeprobe test --watch

# With caching
codeprobe test --cache

# JSON output for CI
codeprobe test --json
```

### Assertions

| Type | Description |
|------|-------------|
| `contains` | Output must include all specified strings |
| `notContains` | Output must not include any specified strings |
| `regex` | Output must match all patterns |
| `equals` | Output must exactly equal the string |
| `jsonSchema` | Output must validate against JSON Schema |

### Dataset Testing

Test prompts against JSONL datasets:

```bash
codeprobe test prompts/summarize.prompt.yaml --dataset datasets/sample.jsonl
```

Dataset format (one JSON object per line):

```json
{"input": "Text to summarize...", "expected": "key phrase"}
```

## Context Engineering

This is where `codeprobe` stands apart. These commands help you understand, measure, and optimize what goes into Claude's context window.

### Analyze Context

```bash
codeprobe context .
```

Shows scanned files, total bytes, estimated tokens, extension breakdown, largest files, and fit estimates for 200k and 1M windows.

### Simulate Context Fit

```bash
codeprobe simulate .
```

Estimates whether your repository fits into Claude's context window with reserved budget for system prompts and tools.

### Pack Context

```bash
codeprobe pack . --target 1m --optimize
```

Builds an optimized context packing plan: which files to include first, which to summarize, which to exclude. Budget breakdown across system prompt, core files, docs, and tool metadata.

### Context Map

```bash
codeprobe map .
```

Token distribution by directory — see where your context budget goes.

### Token Heatmap

```bash
codeprobe heatmap . --top 20
```

Identifies the files consuming the most tokens in your repository.

## Claude Asset Detection

Scan repositories for Claude-related workflow assets.

```bash
# Find all Claude assets (CLAUDE.md, .claude/, skills, hooks, MCP configs)
codeprobe agents .

# Detect hook configurations
codeprobe hooks .

# Find MCP server definitions
codeprobe mcp .
```

## Prompt Quality

```bash
# Lint prompts for common issues
codeprobe lint prompts/

# Get improvement suggestions
codeprobe improve prompts/summarize.prompt.yaml

# Explain potential weaknesses
codeprobe explain prompts/summarize.prompt.yaml

# Security checks for injection risks
codeprobe security prompts/

# Validate prompt spec structure
codeprobe validate .
```

## Configuration

Create `codeprobe.config.yaml` in your project root:

```yaml
defaultModel: claude-sonnet-4-6
defaultContextTarget: 1m

ignorePaths:
  - node_modules
  - .git
  - dist
  - build
  - coverage

caching: true

contextBudgets:
  systemPrompt: 10
  coreFiles: 50
  docs: 20
  toolMeta: 10

benchmarkDefaults:
  models:
    - claude-sonnet-4-6
    - claude-opus-4-6
  runs: 3
```

## CI Integration

The simplest CI setup is a single command:

```yaml
- name: Install codeprobe
  run: npm install -g codeprobe

- name: Run all checks
  run: codeprobe check --json
```

`codeprobe check` runs tests, lint, security, and validation in one shot. Exit code 0 means all clear, 1 means issues found.

For more granular control, run individual commands:

```yaml
- name: Validate prompts
  run: codeprobe validate --json

- name: Run prompt tests
  run: codeprobe test --json

- name: Lint prompts
  run: codeprobe lint --json
```

`codeprobe` exits with non-zero codes on failures, making it CI-friendly.

## Claude Code Integration

### Context Engineering for Claude Code

codeprobe helps you optimize your project for Claude Code:

```bash
# Analyze how much of your repo fits in Claude's context
codeprobe context .

# Get a packing plan -- what to include in CLAUDE.md
codeprobe pack . --target 200k

# Generate a CLAUDE.md from repo analysis
codeprobe generate-claudemd

# See which files consume the most tokens
codeprobe heatmap . --top 20
```

### Hooks

Run prompt tests automatically when working with Claude Code:

```bash
# Install a hook for Claude Code
codeprobe install-hook

# Or configure manually in .claude/settings.json
```

Example `.claude/settings.json`:

```json
{
  "hooks": {
    "PreCommit": [
      {
        "command": "codeprobe test --json",
        "description": "Run prompt regression tests"
      }
    ]
  }
}
```

### Live Mode

Test prompts against the real Claude API:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm install @anthropic-ai/sdk
codeprobe test --mode live
codeprobe benchmark prompts/my-prompt.yaml
```

See [Claude Code Integration Guide](docs/claude-code-integration.md) for the full setup guide.

## AI Tool Detection

codeprobe detects configuration files for all major AI coding tools:

```bash
codeprobe agents .
```

Supported tools: Claude Code, Cursor, Windsurf, GitHub Copilot, Aider, Continue.dev, Cline, OpenAI Codex CLI.

### Agentic Workflow Analysis

```bash
codeprobe workflow .
```

Detects task tracking (todo.md), self-improvement loops (lessons.md), plan files, and AI tool configurations.

## Multi-Provider Support

codeprobe supports models from all major AI providers:

| Provider | Models | API Key |
|----------|--------|---------|
| Anthropic | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | `ANTHROPIC_API_KEY` |
| OpenAI | GPT-4.1, GPT-4o, o3, o4-mini | `OPENAI_API_KEY` |
| Google | Gemini 2.5 Pro, Gemini 2.5 Flash | `GOOGLE_API_KEY` |
| DeepSeek | DeepSeek V3, DeepSeek R1 | `DEEPSEEK_API_KEY` |
| Qwen | Qwen 3 235B, Qwen 3 32B | `DASHSCOPE_API_KEY` |
| Mistral | Codestral, Mistral Large | `MISTRAL_API_KEY` |
| Meta | Llama 4 Maverick, Llama 4 Scout | Via OpenAI-compatible API |
| Local | Ollama, vLLM | No key needed |

Context engineering features (context, simulate, pack, map, heatmap) work offline without any API key.

## Examples

See the `examples/` directory for:

- `basic-test.prompt.yaml` — Simple prompt testing
- `with-dataset.prompt.yaml` — Dataset-based evaluation
- `context-analysis.md` — Example context analysis output

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT
