# codeprobe

**The safety net for AI-generated code.**

AI coding tools (Claude Code, Cursor, Copilot) break things. They change one file and break three others. They write code that looks right but fails at runtime. They say "done" without running tests.

`codeprobe` fixes this. Snapshot your project before AI codes, verify nothing broke after.

```bash
npm install -g codeprobe
```

---

## The Workflow

```bash
codeprobe guard          # 1. Snapshot before AI coding
# ... use Claude/Cursor/Copilot ...
codeprobe verify         # 2. Did AI break anything?
```

That's it. Two commands. Here's what happens:

### `codeprobe guard` — Snapshot before

```
  codeprobe guard

  ✓ TypeScript           Compiles cleanly              (1200ms)
  ✓ Tests (vitest)       38 passing                    (800ms)
  ✓ Lint (eslint)        No issues                     (600ms)

  Files tracked: 128
  Contracts: 47 exports, 142 imports

  Baseline saved to .codeprobe/baseline.json
```

Auto-detects your tooling (tsc, vitest/jest/mocha/pytest, eslint/biome). Hashes every source file. Extracts all exported types and functions.

### `codeprobe verify` — Check after

```
  codeprobe verify

  ✓ TypeScript           Compiles cleanly
  ✗ Tests (vitest)       2 tests failing (REGRESSION)
  ✓ Lint (eslint)        No issues

  File Changes
    5 modified
    2 added

  Contract Changes
    1 export signature changed
      parsePromptSpec (src/core/promptRunner.ts)

  Regressions
    ✗ Tests: Was passing, now failing: 2 tests failing

  Health Score: 4/10
```

The AI broke 2 tests and changed a function signature that 11 files depend on. Without codeprobe, you wouldn't know until production.

---

## Before Editing Critical Files

```bash
codeprobe impact src/core/promptRunner.ts
```

```
  Exported Symbols
    function   parsePromptSpec (filePath: string): Promise<PromptSpec>
    function   runPromptTests (specPath: string, options: RunOptions): Promise<TestResult[]>
    function   evaluateAssertions (output: string, expect: TestExpectation): Promise<AssertionResult[]>

  Dependents (11)
    src/commands/test.ts
    src/commands/ab.ts
    src/commands/check.ts
    ... 8 more

  Risk: CRITICAL (11 dependents, 26 usages)
```

Now you know exactly what's at stake before the AI touches this file.

---

## Full Project Analysis

```bash
codeprobe scan
```

One command, full picture:

```
  Context
    128 files | 45.2k tokens | 312.5 KB
    GPT-4o 128k: fits (35%)  |  200k: fits (23%)  |  1M: fits (5%)

  AI Tools
    Claude Code: CLAUDE.md
    Cursor: .cursorrules

  Quality
    Lint: 0 issues
    Security: 0 issues

  Overall Health: 8/10
```

---

## All Commands

### Daily Use (top-level)

| Command | What it does |
|---------|-------------|
| `guard [path]` | Snapshot project health before AI coding |
| `verify [path]` | Verify nothing broke after AI changes |
| `scan [path]` | Full project analysis — context, security, quality |
| `impact <file>` | Show blast radius — who depends on this file |
| `init` | First-time setup — config, examples, starter files |
| `doctor` | Check your environment is ready |
| `serve` | Start as MCP server for Cursor/other AI tools |

### Command Groups

Deeper tools are organized into groups:

```bash
codeprobe test --help       # Prompt testing
codeprobe context --help    # Context window analysis
codeprobe prompt --help     # Prompt quality tools
codeprobe detect --help     # AI tool & security scanning
codeprobe generate --help   # Generate AI config files
codeprobe ui --help         # Dashboards
```

#### `codeprobe test`

| Subcommand | What it does |
|------------|-------------|
| `test run [path]` | Run prompt tests against YAML specs |
| `test ab <a> <b>` | A/B test two prompts side by side |
| `test score <file>` | Score prompt outputs (A-F grades) |
| `test flaky [path]` | Detect flaky tests |
| `test regression [path]` | Compare against saved baselines |
| `test history` | View test run trends |
| `test autotest <file>` | Auto-generate test cases (offline) |
| `test benchmark [path]` | Benchmark across models |
| `test check [path]` | CI gate — all validations in one shot |

#### `codeprobe context`

| Subcommand | What it does |
|------------|-------------|
| `context analyze [path]` | Token counts, extension breakdown, fit estimates |
| `context pack [path]` | Optimized context packing plan |
| `context map [path]` | Token distribution by directory |
| `context heatmap [path]` | Largest files by token count |
| `context simulate [path]` | Does your repo fit in the context window? |
| `context cost [path]` | How much does it cost to send this repo to AI? |
| `context quality [path]` | Signal-to-noise, redundancy, AI readiness score |
| `context export [path]` | Pack repo into single AI-friendly file |
| `context summary [path]` | Quick one-screen overview |

#### `codeprobe detect`

| Subcommand | What it does |
|------------|-------------|
| `detect security [path]` | Scan for prompt injection & leaked secrets |
| `detect contracts [path]` | Extract type/API contracts |
| `detect agents [path]` | Find AI tool configs (Claude, Cursor, Copilot...) |
| `detect models` | List all supported models with pricing |
| `detect hooks [path]` | Detect hook configurations |
| `detect mcp [path]` | Detect MCP servers |
| `detect workflow [path]` | Detect agentic workflow patterns |

#### `codeprobe generate`

| Subcommand | What it does |
|------------|-------------|
| `generate claudemd [path]` | Generate CLAUDE.md from repo analysis |
| `generate rules [path]` | Generate .cursorrules, .windsurfrules, copilot config |
| `generate hook` | Install a Claude Code pre-commit hook |

#### `codeprobe prompt`

| Subcommand | What it does |
|------------|-------------|
| `prompt lint [path]` | Lint prompt specs for quality issues |
| `prompt improve <file>` | Suggest prompt improvements |
| `prompt explain <file>` | Explain prompt structure & weaknesses |
| `prompt diff <a> <b>` | Compare two prompt specs |
| `prompt validate [path]` | Validate YAML structure |
| `prompt repl` | Interactive prompt playground |

---

## Prompt Testing

Write prompt specs as YAML:

```yaml
name: summarize
model: claude-sonnet-4-6

system: |
  You are a concise summarizer. Respond with exactly 3 bullet points.

prompt: |
  Summarize: {{input}}

tests:
  - name: basic
    input: "Claude Code is an agentic coding tool in your terminal."
    expect:
      contains: ["Claude Code"]
      regex: ["^- "]
      minLength: 50
```

Run them:

```bash
codeprobe test run prompts/         # mock mode (offline, no API key)
codeprobe test run --mode live      # live mode (needs ANTHROPIC_API_KEY)
codeprobe test run --json           # JSON output for CI
```

### Assertion Types

| Type | Example |
|------|---------|
| `contains` | `["Claude", "API"]` — must include these strings |
| `notContains` | `["error"]` — must not include these |
| `regex` | `["^- ", "\\d+"]` — must match patterns |
| `equals` | `"exact match"` — must equal exactly |
| `jsonSchema` | `{type: "object", required: ["id"]}` — validate JSON output |
| `minLength` / `maxLength` | `50` / `500` — length bounds |
| `judge` | `[{criteria: "Is helpful?", threshold: 0.8}]` — LLM-as-judge |

---

## CI Integration

### GitHub Action

```yaml
- uses: thamer-all/codeprobe@main
  with:
    command: check
    post-comment: 'true'
```

### Manual

```yaml
- run: npm install -g codeprobe && codeprobe test check --json
```

### Pre-commit Hook (Claude Code)

```bash
codeprobe generate hook
```

Adds `codeprobe verify --json` as a pre-commit check.

---

## Multi-Provider Support

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

All analysis commands (guard, verify, scan, impact, context) work **offline** — no API key needed.

---

## MCP Server

Expose codeprobe to AI assistants (Cursor, Claude Desktop) via Model Context Protocol:

```bash
codeprobe serve
```

Add to your MCP config:

```json
{
  "mcpServers": {
    "codeprobe": {
      "command": "codeprobe",
      "args": ["serve", "--stdio"]
    }
  }
}
```

---

## Configuration

`codeprobe.config.yaml` in your project root:

```yaml
defaultModel: claude-sonnet-4-6
defaultContextTarget: 1m
ignorePaths: [node_modules, .git, dist, build, coverage]
caching: true
contextBudgets:
  systemPrompt: 10
  coreFiles: 50
  docs: 20
  toolMeta: 10
```

---

## License

MIT
