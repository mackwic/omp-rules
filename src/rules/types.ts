/**
 * Public types for pi-rules.
 *
 * These types are stable contracts between modules. The frontmatter type
 * mirrors omo's `RuleMetadata` plus Claude (`paths`) and Copilot (`applyTo`)
 * aliases that are normalized into `globs` internally.
 */

/**
 * YAML frontmatter parsed from a rule markdown file.
 * `paths` (Claude alias) and `applyTo` (Copilot alias) are normalized into
 * `globs` by the parser before any matcher sees this struct.
 */
export interface RuleFrontmatter {
	description?: string;
	globs?: string | string[];
	paths?: string | string[];
	applyTo?: string | string[];
	alwaysApply?: boolean;
}

/**
 * Result of parsing a rule markdown file.
 * `body` excludes the frontmatter delimiters and the YAML payload.
 */
export interface ParsedRule {
	frontmatter: RuleFrontmatter;
	body: string;
	/**
	 * Diagnostic message if frontmatter parsing failed but the body was salvaged.
	 * Empty when parsing succeeded.
	 */
	diagnostic?: string;
}

/**
 * A discovered rule file candidate before parsing/matching.
 *
 * `path` is the absolute path as discovered (possibly via symlink).
 * `realPath` is the canonical resolved path used for dedup.
 * `source` identifies which discovery source produced this candidate.
 */
export interface RuleCandidate {
	path: string;
	realPath: string;
	source: RuleSource;
	/**
	 * Distance from the target file directory to the directory containing this rule.
	 * 0 = same directory, 9999 = global/user-home rule.
	 */
	distance: number;
	isGlobal: boolean;
	/**
	 * True when this candidate is a SINGLE-FILE rule like AGENTS.md or
	 * `.github/copilot-instructions.md` (frontmatter optional, applies always).
	 */
	isSingleFile: boolean;
	/**
	 * Path relative to project root, POSIX-normalized. Used for matcher and display.
	 * Empty string for user-home global rules.
	 */
	relativePath: string;
}

/**
 * A fully-loaded rule ready for injection.
 */
export interface LoadedRule extends RuleCandidate {
	frontmatter: RuleFrontmatter;
	body: string;
	contentHash: string;
	/** True when the frontmatter could not be parsed; scope is unknown, so it never loads. */
	frontmatterMalformed: boolean;
	matchReason: MatchReason;
}

/**
 * Source identifier for rule files. Used for deterministic ordering and display.
 */
export type RuleSource =
	| ".omo/rules"
	| ".claude/rules"
	| ".cursor/rules"
	| ".github/instructions"
	| ".github/copilot-instructions.md"
	| "AGENTS.md"
	| "CLAUDE.md"
	| "CONTEXT.md"
	| "~/.omo/rules"
	| "~/.opencode/rules"
	| "~/.claude/rules"
	| "~/.config/opencode/AGENTS.md"
	| "~/.claude/CLAUDE.md";

/**
 * Why a candidate matched the target file. Surfaced in the injection block so
 * the model can attribute its behavior to a specific rule.
 *
 * `always-apply-default` marks a directory rule with no scope in its frontmatter:
 * no `globs`/`paths`/`applyTo` and no explicit `alwaysApply: false`. Claude Code,
 * Cursor and Copilot all treat "no scope" as "every file", so these rules load
 * without any target file.
 */
export type MatchReason =
	| "alwaysApply"
	| "always-apply-default"
	| "single-file"
	| { kind: "glob"; pattern: string }
	| { kind: "no-match" };

/**
 * Applicability of a discovered rule, derived from frontmatter alone.
 */
export type RuleScope =
	| { kind: "single-file" }
	| { kind: "always-apply" }
	| { kind: "always-apply-default" }
	| { kind: "globs"; patterns: readonly string[] }
	/** Explicit `alwaysApply: false` without globs: no target can ever match it. */
	| { kind: "inactive" }
	/**
	 * Frontmatter could not be parsed, so the scope is unknown. The rule never
	 * loads — an author who wrote a broken `paths:` must not get an always-on rule.
	 */
	| { kind: "malformed-frontmatter" };

/**
 * One discovered rule as reported by `engine.inspectRules`. This is the
 * observability surface behind `/rules list`, `/rules paths` and `/rules show`:
 * it covers every candidate, including rules that are scoped to globs and
 * therefore never load statically.
 */
export interface RuleInspection {
	path: string;
	realPath: string;
	relativePath: string;
	source: RuleSource;
	/** Derived applicability; `null` when the rule file could not be loaded. */
	scope: RuleScope | null;
	/** Whether the rule loads without any target file (static injection). */
	appliesStatically: boolean;
	/** Whether this session already injected the rule into the system prompt. */
	injectedStatically: boolean;
	/** Relative path of the nearer rule that wins over this one, when shadowed. */
	shadowedBy?: string;
	/** Rule body, empty when the file could not be read. */
	body: string;
	/** Per-rule load problems (unreadable file, outside project root, malformed frontmatter). */
	diagnostics: readonly string[];
}

export interface RuleDiscoveryReport {
	rules: RuleInspection[];
	diagnostics: RuleDiagnostic[];
}

/**
 * Truncation result.
 */
export interface TruncationResult {
	body: string;
	truncated: boolean;
	originalLength: number;
}

/**
 * Configuration knobs resolved from defaults, environment variables, and CLI flags.
 */
export interface PiRulesConfig {
	disabled: boolean;
	mode: "static" | "dynamic" | "both" | "off";
	maxRuleChars: number;
	maxResultChars: number;
	enabledSources: RuleSource[] | "auto";
}

/**
 * Per-session in-memory dedup state.
 *
 * `staticDedup` keys are `{cwd}::{rulePath}::{contentHash}` strings.
 * `dynamicDedup` stores `{targetPath}::{rulePath}::{contentHash}` strings grouped by target file.
 * `dynamicTargetFingerprints` maps a target file cache key to a digest of its
 * discovered rule candidates + file stats; loadDynamicRules short-circuits
 * targets whose fingerprint has not changed since the previous load.
 */
export interface SessionState {
	cwd: string | undefined;
	staticDedup: Set<string>;
	dynamicDedup: Map<string, Set<string>>;
	dynamicTargetFingerprints: Map<string, string>;
	loadedRules: LoadedRule[];
	diagnostics: RuleDiagnostic[];
}

export interface RuleDiagnostic {
	severity: "warning" | "error";
	source: string;
	message: string;
}
