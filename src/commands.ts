import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { Engine } from "./rules/engine.js";
import type { RuleDiagnostic, RuleDiscoveryReport, RuleInspection, RuleScope } from "./rules/types.js";

const RULE_SUBCOMMANDS = ["list", "show", "paths", "status"] as const;

export function registerSlashCommands(pi: ExtensionAPI, engine: Engine): void {
	pi.registerCommand("rules", {
		description: "Inspect discovered pi-rules.",
		getArgumentCompletions: (prefix) => {
			const completions = RULE_SUBCOMMANDS.filter((subcommand) => subcommand.startsWith(prefix)).map(
				(subcommand) => ({
					value: subcommand,
					label: subcommand,
				}),
			);
			return completions.length > 0 ? completions : null;
		},
		handler: async (args, ctx) => {
			const tokens = args.trim().length === 0 ? [] : args.trim().split(/\s+/);
			const subcommand = tokens[0] ?? "";
			const report = engine.inspectRules(ctx.cwd);

			if (subcommand === "" || subcommand === "status") {
				notify(ctx, reportText("pi-rules", report));
				return;
			}

			if (subcommand === "list") {
				notify(ctx, formatRuleList(report.rules));
				return;
			}

			if (subcommand === "show") {
				const id = tokens[1];
				if (id === undefined) {
					notify(ctx, "Rule ID is required", "error");
					return;
				}

				const rule = findRuleById(report.rules, id);
				if (rule === null) {
					notify(ctx, `Rule not found: ${id}`, "error");
					return;
				}

				if (rule.scope === null) {
					notify(ctx, `Rule not readable: ${rule.relativePath} (${rule.diagnostics.join("; ")})`, "error");
					return;
				}

				notify(ctx, rule.body);
				return;
			}

			if (subcommand === "paths") {
				notify(ctx, report.rules.map((rule) => rule.path).join("\n"));
				return;
			}

			notify(ctx, `Unknown /rules subcommand: ${subcommand}`, "error");
		},
	});

	pi.registerCommand("reload-rules", {
		description: "Reload pi-rules for the current session.",
		handler: async (_args, ctx) => {
			engine.resetSession(ctx.cwd);
			engine.loadStaticRules(ctx.cwd);
			notify(ctx, reportText("Reloaded", engine.inspectRules(ctx.cwd)));
		},
	});
}

function notify(ctx: ExtensionCommandContext, message: string, severity: "info" | "warning" | "error" = "info"): void {
	ctx.ui.notify(message, severity);
}

/**
 * Summarize a discovery report.
 *
 * Counts cover every discovered rule, not just the ones injected: a rule scoped
 * to globs is loaded on demand, and reporting only the static set is what made
 * `.claude/rules/*.md` look missing.
 */
function reportText(prefix: string, report: RuleDiscoveryReport): string {
	const applied = report.rules.filter((rule) => rule.appliesStatically).length;
	const scoped = report.rules.filter((rule) => rule.scope?.kind === "globs").length;
	const text = `${prefix}: ${report.rules.length} rules from ${countSources(report.rules)} sources (${applied} always applied, ${scoped} file-scoped)`;
	return appendDiagnostics(text, report.diagnostics);
}

function appendDiagnostics(text: string, diagnostics: ReadonlyArray<RuleDiagnostic>): string {
	return diagnostics.length === 0 ? text : `${text}, ${diagnostics.length} diagnostics`;
}

function countSources(rules: ReadonlyArray<RuleInspection>): number {
	return new Set(rules.map((rule) => rule.source)).size;
}

function formatRuleList(rules: ReadonlyArray<RuleInspection>): string {
	return rules.map(formatRuleLine).join("\n");
}

function formatRuleLine(rule: RuleInspection): string {
	const markers = [describeScope(rule.scope)];
	if (rule.shadowedBy !== undefined) {
		markers.push(`shadowed by ${rule.shadowedBy}`);
	}
	if (rule.injectedStatically) {
		markers.push("in system prompt");
	}
	if (rule.diagnostics.length > 0) {
		markers.push(`${rule.diagnostics.length} diagnostics`);
	}

	return `${rule.relativePath} [${rule.source}, ${markers.join(", ")}]`;
}

function describeScope(scope: RuleScope | null): string {
	if (scope === null) {
		return "unreadable";
	}

	switch (scope.kind) {
		case "single-file":
			return "single-file";
		case "always-apply":
			return "alwaysApply";
		case "always-apply-default":
			return "alwaysApply (default: no scope)";
		case "globs":
			return `globs: ${scope.patterns.join(", ")}`;
		case "inactive":
			return "inactive (alwaysApply: false)";
		case "malformed-frontmatter":
			return "malformed frontmatter (not loaded)";
	}
}

function findRuleById(rules: ReadonlyArray<RuleInspection>, id: string): RuleInspection | null {
	const exactMatch = rules.find((rule) => rule.relativePath === id);
	if (exactMatch !== undefined) {
		return exactMatch;
	}

	const suffixMatches = rules.filter((rule) => rule.relativePath.endsWith(id));
	return suffixMatches.length === 1 ? (suffixMatches[0] ?? null) : null;
}
