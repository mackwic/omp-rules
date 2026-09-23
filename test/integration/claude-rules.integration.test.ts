import { readFileSync } from "node:fs";
import path from "node:path";

import type { BeforeAgentStartEvent, SessionStartEvent, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import piRulesExtension from "../../src/index.js";
import { createFakePi, type FakePiHarness } from "../helpers/fake-pi.js";
import { createTempFs, type TempFs } from "../helpers/temp-fs.js";

const ORIGINAL_HOME = process.env["HOME"];
const tempProjects: TempFs[] = [];

/**
 * Claude Code layout: a mix of always-on rules (no `paths`, no frontmatter scope)
 * and file-scoped rules (`paths`), plus the CLAUDE.md single file. This is the
 * shape that made `.claude/rules/*.md` look missing from `/rules list`.
 */
function createClaudeStyleProject(): TempFs {
	const project = createTempFs("pi-rules-claude-");
	tempProjects.push(project);
	project.writeJson("package.json", { name: "fixture" });
	project.write("home", "");
	project.write("CLAUDE.md", "# Project instructions\n\nBase instructions.");
	project.write(
		".claude/rules/project-context.md",
		"# Project context\n\nAlways active rule without frontmatter scope.",
	);
	project.write(".claude/rules/disabled.md", "---\nalwaysApply: false\n---\n\n# Opted out\n\nNever attached.");
	project.write(
		".claude/rules/documentation.md",
		"---\ndescription: documentation rules\npaths: apps/documentation/**\n---\n\n# Documentation\n\nUpdate the docs index when adding a page.",
	);
	project.write(
		".claude/rules/backend/backend-coding-rules.md",
		"---\npaths:\n  - apps/api/src/**\n---\n\n# Backend\n\nKeep domain code pure.",
	);
	project.write("apps/documentation/index.md", "# Docs index\n");
	project.write("apps/api/src/foo.ts", "export const foo = 1;\n");
	return project;
}

function registerExtension(): FakePiHarness {
	const harness = createFakePi();
	piRulesExtension(harness.pi);
	return harness;
}

function sessionStartEvent(): SessionStartEvent {
	return { type: "session_start", reason: "startup" };
}

function beforeAgentStartEvent(cwd: string): BeforeAgentStartEvent {
	return {
		type: "before_agent_start",
		prompt: "Implement the task.",
		systemPrompt: "Base prompt.",
		systemPromptOptions: { cwd, contextFiles: [] },
	};
}

function readToolResultEvent(toolCallId: string, filePath: string): ToolResultEvent {
	return {
		type: "tool_result",
		toolCallId,
		toolName: "read",
		input: { path: filePath },
		content: [{ type: "text", text: readFileSync(filePath, "utf-8") }],
		isError: false,
		details: undefined,
	};
}

function notificationText(harness: FakePiHarness): string {
	return harness.notifications.map((notification) => notification.message).join("\n");
}

describe("claude-style project integration", () => {
	beforeEach(() => {
		const home = createTempFs("pi-rules-home-");
		tempProjects.push(home);
		process.env["HOME"] = home.root;
	});

	afterEach(() => {
		for (const project of tempProjects.splice(0)) {
			project.cleanup();
		}

		if (ORIGINAL_HOME === undefined) {
			delete process.env["HOME"];
		} else {
			process.env["HOME"] = ORIGINAL_HOME;
		}
	});

	it("#given claude-style project #when /rules list invoked #then every rule is listed with its scope", async () => {
		// given
		const project = createClaudeStyleProject();
		const harness = registerExtension();
		const command = harness.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("list", harness.makeCommandCtx({ cwd: project.root }));

		// then
		expect(notificationText(harness)).toBe(
			[
				".claude/rules/backend/backend-coding-rules.md [.claude/rules, globs: apps/api/src/**]",
				".claude/rules/disabled.md [.claude/rules, inactive (alwaysApply: false)]",
				".claude/rules/documentation.md [.claude/rules, globs: apps/documentation/**]",
				".claude/rules/project-context.md [.claude/rules, alwaysApply (default: no scope)]",
				"CLAUDE.md [CLAUDE.md, single-file]",
			].join("\n"),
		);
	});

	it("#given claude-style project #when /rules status invoked #then discovered scoped and unscoped rules are counted", async () => {
		// given
		const project = createClaudeStyleProject();
		const harness = registerExtension();
		const command = harness.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("status", harness.makeCommandCtx({ cwd: project.root }));

		// then
		expect(notificationText(harness)).toBe("pi-rules: 5 rules from 2 sources (2 always applied, 2 file-scoped)");
	});

	it("#given claude-style project #when /rules show invoked for a scoped rule #then its body is returned", async () => {
		// given
		const project = createClaudeStyleProject();
		const harness = registerExtension();
		const command = harness.commands.find((candidate) => candidate.name === "rules");

		// when
		await command?.options.handler("show documentation.md", harness.makeCommandCtx({ cwd: project.root }));

		// then
		expect(notificationText(harness)).toContain("Update the docs index when adding a page.");
	});

	it("#given claude-style project #when before_agent_start emitted #then unscoped rules load and scoped rules stay out", async () => {
		// given
		const project = createClaudeStyleProject();
		const harness = registerExtension();
		const ctx = harness.makeCtx({ cwd: project.root });
		await harness.emit("session_start", sessionStartEvent(), ctx);

		// when
		const result = (await harness.emit("before_agent_start", beforeAgentStartEvent(project.root), ctx)) as {
			systemPrompt: string;
		};

		// then
		expect(result.systemPrompt).toContain("Always active rule without frontmatter scope.");
		expect(result.systemPrompt).toContain("Base instructions.");
		expect(result.systemPrompt).not.toContain("Update the docs index when adding a page.");
		expect(result.systemPrompt).not.toContain("Never attached.");
	});

	it("#given claude-style project #when a scoped file is read #then its rule is injected for that file", async () => {
		// given
		const project = createClaudeStyleProject();
		const harness = registerExtension();
		const ctx = harness.makeCtx({ cwd: project.root });
		const targetPath = path.join(project.root, "apps", "documentation", "index.md");
		await harness.emit("session_start", sessionStartEvent(), ctx);

		// when
		const result = (await harness.emit("tool_result", readToolResultEvent("call-docs", targetPath), ctx)) as {
			content: Array<{ type: "text"; text: string }>;
		};

		// then
		const injectedText = result.content.map((part) => part.text).join("\n");
		expect(injectedText).toContain("Additional project instructions matched for apps/documentation/index.md");
		expect(injectedText).toContain("Update the docs index when adding a page.");
		expect(injectedText).not.toContain("Keep domain code pure.");
	});
});
