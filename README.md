# claude-test

**DevTools for Claude — Context Engineering Toolkit for Claude Code**

`claude-test` is a developer toolkit for testing, analyzing, and optimizing Claude workflows. It helps you write better prompts, understand your repository's context footprint, and build production-grade AI pipelines with Anthropic's Claude.

Built exclusively for the Anthropic / Claude ecosystem.

---

## Why Context Engineering Matters

Claude's effectiveness depends on what you put in the context window. Most developers waste context on irrelevant files, oversized prompts, or poorly structured instructions. `claude-test` gives you the tools to measure, analyze, and optimize every token you send to Claude.

## Install

```bash
npm install -g claude-test
```

## Quickstart

```bash
# Set up starter files and config
claude-test init

# Run prompt tests
claude-test test

# Analyze your repo's context footprint
claude-test context

# Simulate whether your repo fits in Claude's context window
claude-test simulate

# Build an optimized context packing plan
claude-test pack --target 1m

# Lint your prompts for quality issues
claude-test lint

# Check environment readiness
claude-test doctor

# Generate a CLAUDE.md from repo analysis
claude-test generate-claudemd
```

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
claude-test test prompts/

# With watch mode
claude-test test --watch

# With caching
claude-test test --cache

# JSON output for CI
claude-test test --json
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
claude-test test prompts/summarize.prompt.yaml --dataset datasets/sample.jsonl
```

Dataset format (one JSON object per line):

```json
{"input": "Text to summarize...", "expected": "key phrase"}
```

## Context Engineering

This is where `claude-test` stands apart. These commands help you understand, measure, and optimize what goes into Claude's context window.

### Analyze Context

```bash
claude-test context .
```

Shows scanned files, total bytes, estimated tokens, extension breakdown, largest files, and fit estimates for 200k and 1M windows.

### Simulate Context Fit

```bash
claude-test simulate .
```

Estimates whether your repository fits into Claude's context window with reserved budget for system prompts and tools.

### Pack Context

```bash
claude-test pack . --target 1m --optimize
```

Builds an optimized context packing plan: which files to include first, which to summarize, which to exclude. Budget breakdown across system prompt, core files, docs, and tool metadata.

### Context Map

```bash
claude-test map .
```

Token distribution by directory — see where your context budget goes.

### Token Heatmap

```bash
claude-test heatmap . --top 20
```

Identifies the files consuming the most tokens in your repository.

## Claude Asset Detection

Scan repositories for Claude-related workflow assets.

```bash
# Find all Claude assets (CLAUDE.md, .claude/, skills, hooks, MCP configs)
claude-test agents .

# Detect hook configurations
claude-test hooks .

# Find MCP server definitions
claude-test mcp .
```

## Prompt Quality

```bash
# Lint prompts for common issues
claude-test lint prompts/

# Get improvement suggestions
claude-test improve prompts/summarize.prompt.yaml

# Explain potential weaknesses
claude-test explain prompts/summarize.prompt.yaml

# Security checks for injection risks
claude-test security prompts/

# Validate prompt spec structure
claude-test validate .
```

## Configuration

Create `claude-test.config.yaml` in your project root:

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

Add to your GitHub Actions workflow:

```yaml
- name: Install claude-test
  run: npm install -g claude-test

- name: Validate prompts
  run: claude-test validate --json

- name: Run prompt tests
  run: claude-test test --json

- name: Lint prompts
  run: claude-test lint --json
```

`claude-test` exits with non-zero codes on failures, making it CI-friendly.

## Claude Code Integration

### Context Engineering for Claude Code

claude-test helps you optimize your project for Claude Code:

```bash
# Analyze how much of your repo fits in Claude's context
claude-test context .

# Get a packing plan -- what to include in CLAUDE.md
claude-test pack . --target 200k

# Generate a CLAUDE.md from repo analysis
claude-test generate-claudemd

# See which files consume the most tokens
claude-test heatmap . --top 20
```

### Hooks

Run prompt tests automatically when working with Claude Code:

```bash
# Install a hook for Claude Code
claude-test install-hook

# Or configure manually in .claude/settings.json
```

Example `.claude/settings.json`:

```json
{
  "hooks": {
    "PreCommit": [
      {
        "command": "claude-test test --json",
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
claude-test test --mode live
claude-test benchmark prompts/my-prompt.yaml
```

See [Claude Code Integration Guide](docs/claude-code-integration.md) for the full setup guide.

## Anthropic-Only Focus

`claude-test` is built exclusively for the Anthropic / Claude ecosystem. There are no multi-provider abstractions, no OpenAI compatibility layers, and no generic LLM platform shims. This focus means deeper integration with Claude's capabilities, accurate token estimation, and tooling that understands how Claude actually works.

Supported models: `claude-sonnet-4-6`, `claude-opus-4-6`

## Examples

See the `examples/` directory for:

- `basic-test.prompt.yaml` — Simple prompt testing
- `with-dataset.prompt.yaml` — Dataset-based evaluation
- `context-analysis.md` — Example context analysis output

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT
