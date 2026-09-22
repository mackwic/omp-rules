# omp-rules

[![ci](https://github.com/mackwic/omp-rules/actions/workflows/ci.yml/badge.svg)](https://github.com/mackwic/omp-rules/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Rule context loader for [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi). It discovers rule files from `.omo/rules/`, `.claude/rules/`, `.cursor/rules/`, `.github/instructions/`, `AGENTS.md`, `CLAUDE.md`, and injects them into the agent context.

## Origin

omp-rules is an OMP-focused fork of [pi-rules](https://github.com/code-yeongyu/pi-rules), inspired by [oh-my-openagent (omo)](https://github.com/code-yeongyu/oh-my-openagent) `.omo/rules/` and opencode's `AGENTS.md` / `CLAUDE.md` instruction file mechanisms.

- [omo](https://github.com/code-yeongyu/oh-my-openagent) at https://github.com/code-yeongyu/oh-my-openagent is by Yeongyu Kim, originally SUL-1.0.
- The upstream pi-rules package is an independent pi-coding-agent extension by Yeongyu Kim.
- This fork is maintained at [mackwic/omp-rules](https://github.com/mackwic/omp-rules) and distributed under MIT (see [LICENSE](LICENSE) and [NOTICE](NOTICE)).
- It uses OMP's compatible ExtensionAPI hooks (`before_agent_start`, `tool_result`).

## Installation

Install the OMP fork from GitHub:

```bash
omp install git:github.com/mackwic/omp-rules
```

For local development or a one-shot test:

```bash
omp -e /path/to/omp-rules/src/index.ts
```

Restart OMP after installation.

## OMP compatibility

OMP uses the pi extension API but older OMP releases do not include `systemPromptOptions` on `before_agent_start` events. omp-rules handles both event shapes: it uses native context-file data when OMP provides it and otherwise continues without native-loader deduplication. This lets the extension load rules instead of failing during agent startup.

## What gets loaded

### Project rule directories (recursive `*.md` / `*.mdc`)

| Directory | Style |
|-----------|-------|
| `.omo/rules/` | omo style |
| `.claude/rules/` | Claude Code style |
| `.cursor/rules/` | Cursor style |
| `.github/instructions/` | GitHub Copilot style (only `*.instructions.md`) |

These use **walk-up stack semantics**: from the target file's directory up to the project root, rules at every level are collected. Closer directories win in precedence.

### Project single-file rules

| File | Style |
|------|-------|
| `.github/copilot-instructions.md` | GitHub Copilot |
| `AGENTS.md` | opencode style |
| `CLAUDE.md` | Claude Code style |
| `CONTEXT.md` | deprecated, still supported |

These use **first-match-wins** at the project root: `AGENTS.md` takes priority over `CLAUDE.md`, which takes priority over `CONTEXT.md`.

### User-home rules (always-on, distance 9999)

| Path | Type |
|------|------|
| `~/.omo/rules/` | directory |
| `~/.opencode/rules/` | directory |
| `~/.claude/rules/` | directory |
| `~/.config/opencode/AGENTS.md` | single-file |
| `~/.claude/CLAUDE.md` | single-file |

User-home rules are global and apply to every project with the lowest precedence.

## Rule format

Rules are Markdown files with an optional YAML frontmatter block:

| Field | Type | Description |
|-------|------|-------------|
| `description` | `string` | Optional short description |
| `globs` | `string \| string[]` | Glob patterns; rule applies if target file matches any |
| `paths` | `string \| string[]` | Claude Code alias for globs (merged) |
| `applyTo` | `string \| string[]` | GitHub Copilot alias for globs (merged) |
| `alwaysApply` | `boolean` | If true, rule always applies regardless of target |

Example rule file:

```markdown
---
description: TypeScript-specific rules
globs: ["**/*.ts", "**/*.tsx"]
---

# TypeScript

Prefer `unknown` over `any`. Use exhaustive switch checks.
```

## Precedence and merging

Rules are ordered deterministically before injection:

1. **Local before global** — project rules outrank user-home rules.
2. **Closest distance first** — rules from directories nearer to the target file take priority.
3. **Source priority** — `.omo/rules` > `.claude/rules` > `.cursor/rules` > `.github/instructions` > `AGENTS.md` > `CLAUDE.md` > `CONTEXT.md` > user-home variants.
4. **Lexicographic `relativePath`** — final tiebreaker for same-source, same-distance rules.

Deduplication is in-memory per session by `realPath + content hash`. No filesystem persistence.

## Slash commands

| Command | Purpose |
|---------|---------|
| `/rules` | Summary of active rules |
| `/rules list` | List all rule files with paths |
| `/rules show <id>` | Show body of one rule |
| `/rules paths` | List absolute paths only |
| `/rules status` | Counts and warnings |
| `/reload-rules` | Rescan and clear injection cache |

All commands work in both UI and plain-text modes.

## Configuration

| Flag | Type | Default | Purpose |
|------|------|---------|---------|
| `pi-rules-disabled` | `boolean` | `false` | Disable all injection |
| `pi-rules-mode` | `string` | `both` | `static` \| `dynamic` \| `both` \| `off` |

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PI_RULES_DISABLED` | unset | If `1`, disables injection |
| `PI_RULES_MAX_RULE_CHARS` | `12000` | Per-rule body cap |
| `PI_RULES_MAX_RESULT_CHARS` | `40000` | Total injected per tool result |

## Trust model

Rule files are prompt and context input. Do NOT load untrusted repositories. All rule loading is local filesystem reads. There is no network or remote rule fetching.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Extension not loaded | Run `omp install git:github.com:mackwic/omp-rules` again, or use `omp -e ./src/index.ts` for a one-shot test. |
| Context too large | Adjust `PI_RULES_MAX_RULE_CHARS` and `PI_RULES_MAX_RESULT_CHARS`. |

## Development

```bash
git clone https://github.com/mackwic/omp-rules
cd omp-rules
npm install            # install dev + peer deps
npm test               # 229 unit tests
npm run test:integration  # 43 integration tests
npm run typecheck      # TypeScript type-check
npm run check          # TypeScript + biome
omp -e ./src/index.ts  # smoke-test inside a real OMP session
```

The test suite uses Vitest. Test descriptions follow `#given X #when Y #then Z` style; bodies use `// given / // when / // then` plain comments. No `any` in production code, no enums.

## License

[MIT](LICENSE). See [NOTICE](NOTICE) for re-license disclosure relative to omo.

## Related

- [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) — the supported agent runtime for this fork.
- [pi-rules](https://github.com/code-yeongyu/pi-rules) — upstream extension this fork adapts for OMP.

## Acknowledgements

- **Yeongyu Kim** ([@code-yeongyu](https://github.com/code-yeongyu)) — author of [pi-rules](https://github.com/code-yeongyu/pi-rules) and [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent), which originated the rules-injection idea.
- **Oh My Pi contributors** — maintainers of the runtime and extension API used by this fork.
- **opencode** — for the elegant `Instructions from: <path>` formatting convention adopted here.
