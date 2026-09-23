import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Resolve a path to its canonical absolute form.
 *
 * Rule discovery canonicalizes the project root (`findProjectRoot` uses
 * `realpathSync`) and every candidate path, so target paths must be canonical
 * too. Otherwise glob matching compares a canonical root against a symlinked
 * target and `relative()` produces `../../..`-style escapes that no pattern
 * matches — for example `/tmp` vs `/private/tmp` on macOS.
 *
 * Paths that do not exist yet (a `write` target) are canonicalized through their
 * directory, which is the only part that can be a symlink.
 */
export function canonicalPath(filePath: string): string {
	const resolvedPath = resolve(filePath);

	try {
		return realpathSync.native(resolvedPath);
	} catch {
		// Missing path: fall through to directory canonicalization.
	}

	try {
		return join(realpathSync.native(dirname(resolvedPath)), basename(resolvedPath));
	} catch {
		return resolvedPath;
	}
}
