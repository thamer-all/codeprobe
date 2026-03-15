# Claude Code Integration Guide

## What is claude-test?

claude-test is a DevTools CLI for Claude -- a context engineering toolkit that helps
you test prompts, analyze repository context, and optimize what Claude sees when
working with your codebase.

It is designed to be used alongside Claude Code (Anthropic's CLI agent) to improve
the quality and consistency of AI-assisted development workflows.

## Installation

```bash
npm install -g claude-test
```

Verify the installation:

```bash
claude-test --version
claude-test doctor
```

The `doctor` command checks that your environment is configured correctly, including
Node.js version, optional dependencies, and API key availability.

## Context Engineering Workflow

Context engineering is the practice of curating what an LLM sees so it produces
better results. claude-test provides several commands for this.

### 1. Analyze Your Repository

```bash
# Analyze context usage across your repo
claude-test context .

# Output as JSON for scripting
claude-test context . --json
```

This scans your project and reports how much context different files, directories,
and configuration files consume. Use it to identify oversized files or missing
documentation.

```bash
# Simulate what Claude sees for a given token budget
claude-test simulate . --budget 100000
```

The simulate command shows which files would fit within a token budget, helping you
understand what Claude can realistically process.

```bash
# Generate a dependency and structure map
claude-test map .
```

The map command produces a structural overview of your codebase -- modules, entry
points, and key relationships.

```bash
# Generate a heatmap of context density
claude-test heatmap .
```

The heatmap command visualizes which parts of your codebase are context-heavy,
helping you find areas that need summarization or splitting.

### 2. Generate a CLAUDE.md

```bash
# Auto-generate a CLAUDE.md for your project
claude-test generate-claudemd

# Specify an output path
claude-test generate-claudemd --output docs/CLAUDE.md
```

A CLAUDE.md file provides persistent instructions that Claude Code reads at the start
of every session. The generator inspects your project structure, package manager,
test configuration, and coding conventions to produce a tailored file.

### 3. Optimize Context Packing

```bash
# Build a context pack plan for a 200k token budget
claude-test pack . --target 200k

# Use a custom config
claude-test pack . --target 150k --config claude-test.config.yaml
```

The pack command analyzes your project and recommends which files to include,
summarize, or exclude to fit within a given token budget. This is useful for
preparing context for long conversations or complex tasks.

## Prompt Testing

### Writing Prompt Specs

Prompt specs are YAML files that define a prompt, its expected behavior, and test
cases. Place them in the `prompts/` directory.

```yaml
name: summarize
description: Summarize an article into bullet points
model: claude-sonnet-4-6

system: |
  You are a concise summarizer. Given an article, produce 3-5 bullet points
  capturing the key ideas.

prompt: |
  Summarize the following article into 3-5 bullet points:

  {{input}}

tests:
  - name: produces bullet points
    input: >
      Artificial intelligence is transforming industries worldwide.
      Healthcare, finance, and transportation are seeing significant
      changes driven by machine learning advances.
    assertions:
      - type: contains
        value: bullet
      - type: minLength
        value: 50
```

### Running Tests

```bash
# Run all prompt tests (mock mode -- no API calls)
claude-test test

# Run a specific spec
claude-test test --spec prompts/summarize.yaml

# Output results as JSON
claude-test test --json

# Run in live mode (requires ANTHROPIC_API_KEY)
claude-test test --mode live

# Watch mode -- re-run on file changes
claude-test test --watch
```

Mock mode validates your test structure and assertions without calling the API.
Live mode sends actual requests to Claude and validates the responses.

## Hooks Integration

Claude Code supports hooks -- scripts that run automatically at specific points
in the development workflow. claude-test can install itself as a hook so your
prompt tests run automatically.

### Automatic Hook Installation

```bash
# Install a PreCommit hook (default)
claude-test install-hook

# Install for a different event
claude-test install-hook --event PostCommit

# Use a custom command
claude-test install-hook --event PreCommit --command "claude-test test --spec prompts/critical.yaml --json"

# Preview without writing
claude-test install-hook --dry-run
```

This adds an entry to `.claude/settings.json` in your project root:

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

### Manual Configuration

You can also edit `.claude/settings.json` directly. The file supports multiple
hooks per event, and each hook has a command and description:

```json
{
  "hooks": {
    "PreCommit": [
      {
        "command": "claude-test test --json",
        "description": "Run prompt regression tests"
      },
      {
        "command": "npm run lint",
        "description": "Run linter"
      }
    ],
    "PostCommit": [
      {
        "command": "claude-test context . --json > .context-snapshot.json",
        "description": "Snapshot context usage after commit"
      }
    ]
  }
}
```

### Available Hook Events

- **PreCommit** -- runs before commits are created
- **PostCommit** -- runs after commits are created
- **PrePush** -- runs before pushes to remote

## Live Mode

Live mode sends real requests to the Anthropic API, enabling end-to-end prompt
validation against actual model responses.

### Setup

1. Install the Anthropic SDK:

```bash
npm install @anthropic-ai/sdk
```

2. Set your API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### Running Live Tests

```bash
# Run all tests against the real API
claude-test test --mode live

# Run a single spec
claude-test test --mode live --spec prompts/summarize.yaml
```

Live tests respect the model specified in each prompt spec. Assertions are evaluated
against the actual model response.

### Benchmarking

```bash
# Benchmark a prompt spec with multiple iterations
claude-test benchmark --spec prompts/summarize.yaml --runs 5

# Live benchmarking (requires API key)
claude-test benchmark --spec prompts/summarize.yaml --runs 5 --mode live
```

Benchmarking runs each test case multiple times and reports statistics on latency,
token usage, and assertion pass rates.

## CI/CD Integration

claude-test works well in CI pipelines. Here is an example GitHub Actions workflow:

```yaml
name: Prompt Tests
on:
  pull_request:
    paths:
      - 'prompts/**'
      - 'CLAUDE.md'
      - 'claude-test.config.yaml'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install claude-test
        run: npm install -g claude-test

      - name: Run prompt tests (mock)
        run: claude-test test --json

      - name: Run prompt tests (live)
        if: github.event_name == 'pull_request'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: claude-test test --mode live --json

      - name: Check context budget
        run: claude-test pack . --target 200k --json
```

This workflow:
1. Runs mock tests on every PR that touches prompt files
2. Runs live tests with a real API key (stored as a GitHub secret)
3. Checks that the project context fits within a 200k token budget

## Commands Reference

| Command           | Description                                        |
| ----------------- | -------------------------------------------------- |
| `init`            | Create starter project with example prompt specs   |
| `test`            | Run prompt regression tests                        |
| `benchmark`       | Benchmark prompts with multiple iterations         |
| `diff`            | Compare test results between runs                  |
| `context`         | Analyze repository context usage                   |
| `simulate`        | Simulate what Claude sees for a token budget       |
| `pack`            | Build a context pack plan for a target budget      |
| `map`             | Generate a structural map of the codebase          |
| `heatmap`         | Visualize context density across the project       |
| `hooks`           | Detect existing hooks in the project               |
| `install-hook`    | Install a Claude Code hook into settings.json      |
| `lint`            | Lint prompt specs for common issues                |
| `validate`        | Validate prompt spec YAML structure                |
| `improve`         | Suggest improvements for prompt specs              |
| `explain`         | Explain what a prompt spec does                    |
| `security`        | Scan for security issues in prompts and context    |
| `agents`          | Manage multi-agent prompt configurations           |
| `mcp`             | Inspect MCP server configurations                  |
| `generate-claudemd` | Auto-generate a CLAUDE.md file                  |
| `doctor`          | Check environment and dependency setup             |
| `repl`            | Interactive prompt testing shell                   |
