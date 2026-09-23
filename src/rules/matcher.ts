import { createHash } from "node:crypto";
import picomatch from "picomatch";
import type { MatchReason, RuleFrontmatter, RuleScope } from "./types.js";

export interface PathBases {
	projectRelative: string;
	scopeRelative?: string;
	basename: string;
}

export interface MatcherInput {
	frontmatter: RuleFrontmatter;
	isSingleFile: boolean;
	/**
	 * True when the rule's frontmatter could not be parsed. The declared scope is
	 * unknown, so the rule never matches instead of defaulting to always-apply.
	 */
	frontmatterMalformed?: boolean;
	/**
	 * Path bases to try matching against (POSIX-normalized), or `null` when no
	 * target file is known (static load). With `null`, glob-scoped rules report
	 * no match while every unscoped rule still matches.
	 */
	pathBases: PathBases | null;
}

export interface MatchResult {
	matched: boolean;
	reason: MatchReason;
}

interface CompiledPatternSet {
	positiveMatchers: ReadonlyArray<{ pattern: string; isMatch: PathMatcher }>;
	negativeMatchers: ReadonlyArray<PathMatcher>;
}

export interface MatcherCacheStats {
	entries: number;
	compiledPatterns: number;
}

type PathMatcher = (path: string) => boolean;

const PICOMATCH_OPTIONS = { bash: true, dot: true };
const MAX_COMPILED_PATTERN_SET_CACHE_ENTRIES = 256;
const compiledPatternSets = new Map<string, CompiledPatternSet>();

/**
 * Derive a rule's applicability from its frontmatter alone.
 *
 * This is the single source of truth for both static and dynamic loads: static
 * loading calls `matchRule` with `pathBases: null`, so a rule can never be
 * "static only" or "dynamic only" by accident.
 */
export function deriveRuleScope(
	frontmatter: RuleFrontmatter,
	isSingleFile: boolean,
	frontmatterMalformed = false,
): RuleScope {
	// Single-file rules (AGENTS.md, CLAUDE.md, …) ignore frontmatter entirely.
	if (isSingleFile) {
		return { kind: "single-file" };
	}

	if (frontmatterMalformed) {
		return { kind: "malformed-frontmatter" };
	}

	if (frontmatter.alwaysApply === true) {
		return { kind: "always-apply" };
	}

	const patterns = normalizeGlobs(frontmatter);
	if (patterns.length > 0) {
		return { kind: "globs", patterns };
	}

	return frontmatter.alwaysApply === false ? { kind: "inactive" } : { kind: "always-apply-default" };
}

export function matchRule(input: MatcherInput): MatchResult {
	const scope = deriveRuleScope(input.frontmatter, input.isSingleFile, input.frontmatterMalformed === true);

	if (scope.kind === "single-file") {
		return { matched: true, reason: "single-file" };
	}

	if (scope.kind === "always-apply") {
		return { matched: true, reason: "alwaysApply" };
	}

	if (scope.kind === "always-apply-default") {
		return { matched: true, reason: "always-apply-default" };
	}

	if (scope.kind === "inactive" || scope.kind === "malformed-frontmatter" || input.pathBases === null) {
		return noMatch();
	}

	const pathBases = [
		normalizePath(input.pathBases.projectRelative),
		input.pathBases.scopeRelative ? normalizePath(input.pathBases.scopeRelative) : undefined,
		normalizePath(input.pathBases.basename),
	].filter((pathBase): pathBase is string => pathBase !== undefined);

	const { positiveMatchers, negativeMatchers } = compiledPatternSetFor(scope.patterns);

	for (const { pattern, isMatch } of positiveMatchers) {
		for (const pathBase of pathBases) {
			if (!isMatch(pathBase)) {
				continue;
			}

			if (isExcluded(pathBase, negativeMatchers)) {
				return noMatch();
			}

			return { matched: true, reason: { kind: "glob", pattern } };
		}
	}

	return noMatch();
}

export function normalizeGlobs(frontmatter: RuleFrontmatter): string[] {
	const patterns = [
		...normalizePatternList(frontmatter.globs),
		...normalizePatternList(frontmatter.paths),
		...normalizePatternList(frontmatter.applyTo),
	];

	return [...new Set(patterns.map(normalizePath))];
}

export function hashContent(body: string): string {
	return createHash("sha256").update(body).digest("hex");
}

export function resetMatcherCache(): void {
	compiledPatternSets.clear();
}

export function getMatcherCacheStats(): MatcherCacheStats {
	let compiledPatterns = 0;
	for (const patternSet of compiledPatternSets.values()) {
		compiledPatterns += patternSet.positiveMatchers.length + patternSet.negativeMatchers.length;
	}

	return { entries: compiledPatternSets.size, compiledPatterns };
}

function compiledPatternSetFor(patterns: ReadonlyArray<string>): CompiledPatternSet {
	const cacheKey = patterns.join("\0");
	const cached = compiledPatternSets.get(cacheKey);
	if (cached !== undefined) {
		compiledPatternSets.delete(cacheKey);
		compiledPatternSets.set(cacheKey, cached);
		return cached;
	}

	const positiveMatchers: Array<{ pattern: string; isMatch: PathMatcher }> = [];
	const negativeMatchers: PathMatcher[] = [];
	for (const pattern of patterns) {
		if (pattern.startsWith("!")) {
			negativeMatchers.push(picomatch(pattern.slice(1), PICOMATCH_OPTIONS));
			continue;
		}

		positiveMatchers.push({ pattern, isMatch: picomatch(pattern, PICOMATCH_OPTIONS) });
	}

	const compiledPatternSet = { positiveMatchers, negativeMatchers } satisfies CompiledPatternSet;
	setCompiledPatternSet(cacheKey, compiledPatternSet);
	return compiledPatternSet;
}

function setCompiledPatternSet(cacheKey: string, compiledPatternSet: CompiledPatternSet): void {
	if (compiledPatternSets.size >= MAX_COMPILED_PATTERN_SET_CACHE_ENTRIES) {
		const oldestCacheKey = compiledPatternSets.keys().next().value;
		if (oldestCacheKey !== undefined) {
			compiledPatternSets.delete(oldestCacheKey);
		}
	}
	compiledPatternSets.set(cacheKey, compiledPatternSet);
}

function normalizePatternList(patterns: string | string[] | undefined): string[] {
	if (patterns === undefined) {
		return [];
	}

	return Array.isArray(patterns) ? patterns : [patterns];
}

function normalizePath(path: string): string {
	return path.replaceAll("\\", "/");
}

function isExcluded(pathBase: string, negativeMatchers: ReadonlyArray<(path: string) => boolean>): boolean {
	for (const isMatch of negativeMatchers) {
		if (isMatch(pathBase)) {
			return true;
		}
	}

	return false;
}

function noMatch(): MatchResult {
	return { matched: false, reason: { kind: "no-match" } };
}
