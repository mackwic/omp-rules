import { describe, expect, it, vi } from "vitest";
import { registerSlashCommands } from "../src/commands.js";
import type { Engine } from "../src/rules/engine.js";
import { defaultConfig } from "../src/rules/engine.js";
import { deriveRuleScope, matchRule } from "../src/rules/matcher.js";
import type { LoadedRule, RuleDiagnostic, RuleInspection } from "../src/rules/types.js";
import { createFakePi } from "./helpers/fake-pi.js";
import { makeLoadedRule, makeRuleInspection } from "./helpers/rule-fixtures.js";

function ruleToInspection(rule: LoadedRule): RuleInspection {
	return {
		path: rule.path,
		realPath: rule.realPath,
		relativePath: rule.relativePath,
		source: rule.source,
		scope: deriveRuleScope(rule.frontmatter, rule.isSingleFile, rule.frontmatterMalformed),
		appliesStatically: matchRule({
			frontmatter: rule.frontmatter,
			isSingleFile: rule.isSingleFile,
			frontmatterMalformed: rule.frontmatterMalformed,
			pathBases: null,
		}).matched,
		injectedStatically: false,
		body: rule.body,
		diagnostics: [],
	};
}

function createStubEngine(
	options: {
		rules?: LoadedRule[];
		inspections?: RuleInspection[];
		diagnostics?: RuleDiagnostic[];
		resetSession?: (cwd?: string) => void;
		loadStaticRules?: (cwd: string) => { rules: LoadedRule[]; diagnostics: RuleDiagnostic[] };
	} = {},
): Engine {
	const rules = options.rules ?? [
		makeLoadedRule({ path: "/tmp/test/foo.md", relativePath: "foo.md", body: "Rule body" }),
	];
	const diagnostics = options.diagnostics ?? [];
	const inspections = options.inspections ?? rules.map(ruleToInspection);

	return {
		state: {
			cwd: "/tmp/test",
			staticDedup: new Set(),
			dynamicDedup: new Map(),
			dynamicTargetFingerprints: new Map(),
			loadedRules: rules,
			diagnostics,
		},
		config: defaultConfig(),
		loadStaticRules: options.loadStaticRules ?? (() => ({ rules, diagnostics })),
		loadDynamicRules: () => ({ rules: [], diagnostics: [] }),
		inspectRules: () => ({ rules: inspections, diagnostics }),
		formatStatic: () => "static block",
		formatDynamic: () => "dynamic block",
		resetSession: options.resetSession ?? (() => {}),
		isStaticInjected: () => false,
		isDynamicInjected: () => false,
		markStaticInjected: () => true,
		markDynamicInjected: () => true,
		fingerprintDynamicTargets: () => [],
		isDynamicTargetFingerprintCurrent: () => true,
		commitDynamicTargetFingerprints: () => {},
	};
}

function registerCommands(engine: Engine = createStubEngine()) {
	const fakePi = createFakePi();
	registerSlashCommands(fakePi.pi, engine);
	return fakePi;
}

describe("registerSlashCommands", () => {
	it("#given fake pi #when registerSlashCommands called #then 2 commands registered (rules, reload-rules)", () => {
		// given
		const fakePi = createFakePi();
		const engine = createStubEngine();

		// when
		registerSlashCommands(fakePi.pi, engine);

		// then
		expect(fakePi.commands.map((command) => command.name)).toEqual(["rules", "reload-rules"]);
	});

	it("#given /rules command registered #when invoked with empty args in UI mode #then ctx.ui.notify called with summary text", async () => {
		// given
		const fakePi = registerCommands();
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("", fakePi.makeCommandCtx({ cwd: "/tmp/test", hasUI: true }));

		// then
		expect(fakePi.notifications).toEqual([
			{ message: "pi-rules: 1 rules from 1 sources (1 always applied, 0 file-scoped)", severity: "info" },
		]);
	});

	it('#given /rules with "list" subcommand #when invoked #then notify text contains rule paths', async () => {
		// given
		const rule = makeLoadedRule({ path: "/tmp/test/foo.md", relativePath: "foo.md", source: ".omo/rules" });
		const fakePi = registerCommands(createStubEngine({ rules: [rule] }));
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("list", fakePi.makeCommandCtx({ cwd: "/tmp/test" }));

		// then
		expect(fakePi.notifications[0]?.message).toContain("foo.md");
		expect(fakePi.notifications[0]?.message).toContain(".omo/rules");
	});

	it('#given /rules with "show foo.md" subcommand and matching rule #when invoked #then notify text contains rule body', async () => {
		// given
		const rule = makeLoadedRule({ relativePath: "foo.md", body: "Use concise TypeScript." });
		const fakePi = registerCommands(createStubEngine({ rules: [rule] }));
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("show foo.md", fakePi.makeCommandCtx({ cwd: "/tmp/test" }));

		// then
		expect(fakePi.notifications).toEqual([{ message: "Use concise TypeScript.", severity: "info" }]);
	});

	it('#given /rules with "show <unknown>" #when invoked #then notify error severity', async () => {
		// given
		const fakePi = registerCommands();
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("show missing.md", fakePi.makeCommandCtx({ cwd: "/tmp/test" }));

		// then
		expect(fakePi.notifications).toEqual([{ message: "Rule not found: missing.md", severity: "error" }]);
	});

	it('#given /rules with "show" and one loaded rule #when invoked without an id #then notify error severity', async () => {
		// given
		const fakePi = registerCommands();
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("show", fakePi.makeCommandCtx({ cwd: "/tmp/test" }));

		// then
		expect(fakePi.notifications).toEqual([{ message: "Rule ID is required", severity: "error" }]);
	});

	it('#given /rules with "paths" subcommand #when invoked #then notify with absolute paths', async () => {
		// given
		const firstRule = makeLoadedRule({ path: "/tmp/test/foo.md", relativePath: "foo.md" });
		const secondRule = makeLoadedRule({ path: "/tmp/test/bar.md", relativePath: "bar.md" });
		const fakePi = registerCommands(createStubEngine({ rules: [firstRule, secondRule] }));
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("paths", fakePi.makeCommandCtx({ cwd: "/tmp/test" }));

		// then
		expect(fakePi.notifications).toEqual([{ message: "/tmp/test/foo.md\n/tmp/test/bar.md", severity: "info" }]);
	});

	it('#given /rules with no discovered rules #when invoked #then summary shows "0 rules"', async () => {
		// given
		const fakePi = registerCommands(createStubEngine({ rules: [] }));
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("", fakePi.makeCommandCtx({ cwd: "/tmp/test" }));

		// then
		expect(fakePi.notifications).toEqual([
			{ message: "pi-rules: 0 rules from 0 sources (0 always applied, 0 file-scoped)", severity: "info" },
		]);
	});

	it("#given /reload-rules invoked #when called #then engine.resetSession called", async () => {
		// given
		const resetSession = vi.fn();
		const fakePi = registerCommands(createStubEngine({ resetSession }));
		const command = fakePi.commands.find((candidate) => candidate.name === "reload-rules");

		// when
		await command?.options.handler("", fakePi.makeCommandCtx({ cwd: "/tmp/test" }));

		// then
		expect(resetSession).toHaveBeenCalledWith("/tmp/test");
	});

	it("#given /reload-rules invoked #when called #then loadStaticRules called", async () => {
		// given
		const loadStaticRules = vi.fn((_cwd: string) => ({ rules: [], diagnostics: [] }));
		const fakePi = registerCommands(createStubEngine({ loadStaticRules }));
		const command = fakePi.commands.find((candidate) => candidate.name === "reload-rules");

		// when
		await command?.options.handler("", fakePi.makeCommandCtx({ cwd: "/tmp/test" }));

		// then
		expect(loadStaticRules).toHaveBeenCalledWith("/tmp/test");
	});

	it("#given /reload-rules in UI mode #when invoked #then notify called with reload status", async () => {
		// given
		const fakePi = registerCommands();
		const command = fakePi.commands.find((candidate) => candidate.name === "reload-rules");

		// when
		await command?.options.handler("", fakePi.makeCommandCtx({ cwd: "/tmp/test", hasUI: true }));

		// then
		expect(fakePi.notifications).toEqual([
			{ message: "Reloaded: 1 rules from 1 sources (1 always applied, 0 file-scoped)", severity: "info" },
		]);
	});

	it('#given /rules getArgumentCompletions("li") #when called #then returns ["list"]', async () => {
		// given
		const fakePi = registerCommands();
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		const completions = await command?.options.getArgumentCompletions?.("li");

		// then
		expect(completions?.map((completion) => completion.value)).toEqual(["list"]);
	});

	it('#given /rules getArgumentCompletions("") #when called #then returns all 4 subcommands', async () => {
		// given
		const fakePi = registerCommands();
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		const completions = await command?.options.getArgumentCompletions?.("");

		// then
		expect(completions?.map((completion) => completion.value)).toEqual(["list", "show", "paths", "status"]);
	});

	it('#given /rules getArgumentCompletions("xyz") #when called #then returns null', async () => {
		// given
		const fakePi = registerCommands();
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		const completions = await command?.options.getArgumentCompletions?.("xyz");

		// then
		expect(completions).toBeNull();
	});

	it("#given hasUI=false context #when /rules invoked #then notify still called (commands work in non-UI mode)", async () => {
		// given
		const fakePi = registerCommands();
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("status", fakePi.makeCommandCtx({ cwd: "/tmp/test", hasUI: false }));

		// then
		expect(fakePi.notifications).toEqual([
			{ message: "pi-rules: 1 rules from 1 sources (1 always applied, 0 file-scoped)", severity: "info" },
		]);
	});

	it("#given hasUI=false #when /reload-rules invoked #then engine.resetSession still called and notify still works", async () => {
		// given
		const resetSession = vi.fn();
		const fakePi = registerCommands(createStubEngine({ resetSession }));
		const command = fakePi.commands.find((candidate) => candidate.name === "reload-rules");

		// when
		await command?.options.handler("", fakePi.makeCommandCtx({ cwd: "/tmp/test", hasUI: false }));

		// then
		expect(resetSession).toHaveBeenCalledWith("/tmp/test");
		expect(fakePi.notifications).toEqual([
			{ message: "Reloaded: 1 rules from 1 sources (1 always applied, 0 file-scoped)", severity: "info" },
		]);
	});

	it("#given glob-scoped rule #when /rules list invoked #then scope patterns are listed", async () => {
		// given
		const globRule = makeRuleInspection({
			path: "/tmp/test/.claude/rules/documentation.md",
			relativePath: ".claude/rules/documentation.md",
			source: ".claude/rules",
			scope: { kind: "globs", patterns: ["apps/documentation/**"] },
			appliesStatically: false,
		});
		const fakePi = registerCommands(createStubEngine({ inspections: [globRule] }));
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("list", fakePi.makeCommandCtx({ cwd: "/tmp/test" }));

		// then
		expect(fakePi.notifications).toEqual([
			{ message: ".claude/rules/documentation.md [.claude/rules, globs: apps/documentation/**]", severity: "info" },
		]);
	});

	it("#given injected unscoped rule #when /rules list invoked #then default scope and injection marker are listed", async () => {
		// given
		const plainRule = makeRuleInspection({
			path: "/tmp/test/.claude/rules/project-context.md",
			relativePath: ".claude/rules/project-context.md",
			source: ".claude/rules",
			scope: { kind: "always-apply-default" },
			injectedStatically: true,
		});
		const fakePi = registerCommands(createStubEngine({ inspections: [plainRule] }));
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("list", fakePi.makeCommandCtx({ cwd: "/tmp/test" }));

		// then
		expect(fakePi.notifications).toEqual([
			{
				message:
					".claude/rules/project-context.md [.claude/rules, alwaysApply (default: no scope), in system prompt]",
				severity: "info",
			},
		]);
	});

	it("#given shadowed single-file rule #when /rules list invoked #then the shadowing rule is listed", async () => {
		// given
		const shadowed = makeRuleInspection({
			path: "/tmp/test/CLAUDE.md",
			relativePath: "CLAUDE.md",
			source: "CLAUDE.md",
			scope: { kind: "single-file" },
			shadowedBy: "AGENTS.md",
		});
		const fakePi = registerCommands(createStubEngine({ inspections: [shadowed] }));
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("list", fakePi.makeCommandCtx({ cwd: "/tmp/test" }));

		// then
		expect(fakePi.notifications).toEqual([
			{ message: "CLAUDE.md [CLAUDE.md, single-file, shadowed by AGENTS.md]", severity: "info" },
		]);
	});

	it("#given mixed rules #when /rules status invoked #then applied and file-scoped counts are reported", async () => {
		// given
		const plainRule = makeRuleInspection({
			relativePath: ".claude/rules/project-context.md",
			source: ".claude/rules",
			scope: { kind: "always-apply-default" },
		});
		const globRule = makeRuleInspection({
			relativePath: ".cursor/rules/documentation.mdc",
			source: ".cursor/rules",
			scope: { kind: "globs", patterns: ["apps/documentation/**"] },
			appliesStatically: false,
		});
		const fakePi = registerCommands(createStubEngine({ inspections: [plainRule, globRule] }));
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("status", fakePi.makeCommandCtx({ cwd: "/tmp/test" }));

		// then
		expect(fakePi.notifications).toEqual([
			{ message: "pi-rules: 2 rules from 2 sources (1 always applied, 1 file-scoped)", severity: "info" },
		]);
	});

	it("#given glob-scoped rule #when /rules show invoked with a unique suffix #then the body is returned", async () => {
		// given
		const globRule = makeRuleInspection({
			relativePath: ".claude/rules/documentation.md",
			source: ".claude/rules",
			scope: { kind: "globs", patterns: ["apps/documentation/**"] },
			body: "Update the docs index when adding a page.",
		});
		const fakePi = registerCommands(createStubEngine({ inspections: [globRule] }));
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("show documentation.md", fakePi.makeCommandCtx({ cwd: "/tmp/test" }));

		// then
		expect(fakePi.notifications).toEqual([
			{ message: "Update the docs index when adding a page.", severity: "info" },
		]);
	});

	it("#given unreadable rule #when /rules show invoked #then error notify with the load diagnostics", async () => {
		// given
		const unreadable = makeRuleInspection({
			path: "/tmp/test/.omo/rules/broken.md",
			relativePath: ".omo/rules/broken.md",
			scope: null,
			body: "",
			diagnostics: ["Unable to read rule file"],
		});
		const fakePi = registerCommands(createStubEngine({ inspections: [unreadable] }));
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("show .omo/rules/broken.md", fakePi.makeCommandCtx({ cwd: "/tmp/test" }));

		// then
		expect(fakePi.notifications).toEqual([
			{ message: "Rule not readable: .omo/rules/broken.md (Unable to read rule file)", severity: "error" },
		]);
	});

	it("#given malformed-frontmatter rule #when /rules list invoked #then it is reported as not loaded", async () => {
		// given
		const malformed = makeRuleInspection({
			path: "/tmp/test/.omo/rules/bad.md",
			relativePath: ".omo/rules/bad.md",
			source: ".omo/rules",
			scope: { kind: "malformed-frontmatter" },
			appliesStatically: false,
			diagnostics: ["Malformed frontmatter: Unclosed inline array"],
		});
		const fakePi = registerCommands(createStubEngine({ inspections: [malformed] }));
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("list", fakePi.makeCommandCtx({ cwd: "/tmp/test" }));

		// then
		expect(fakePi.notifications).toEqual([
			{
				message: ".omo/rules/bad.md [.omo/rules, malformed frontmatter (not loaded), 1 diagnostics]",
				severity: "info",
			},
		]);
	});

	it("#given glob-scoped rule #when /rules paths invoked #then its absolute path is included", async () => {
		// given
		const globRule = makeRuleInspection({
			path: "/tmp/test/.claude/rules/documentation.md",
			relativePath: ".claude/rules/documentation.md",
			scope: { kind: "globs", patterns: ["apps/documentation/**"] },
			appliesStatically: false,
		});
		const fakePi = registerCommands(createStubEngine({ inspections: [globRule] }));
		const command = fakePi.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("paths", fakePi.makeCommandCtx({ cwd: "/tmp/test" }));

		// then
		expect(fakePi.notifications).toEqual([{ message: "/tmp/test/.claude/rules/documentation.md", severity: "info" }]);
	});
});
