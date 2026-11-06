import * as vscode from 'vscode';
import type { DependencyAnalyzer, ImportSpec, ResolveContext } from './types';

/**
 * Python imports.
 *
 * Extraction is line-based: Python imports are statements, so joining
 * continuation lines and matching `import …` / `from … import …` is enough
 * for real-world code. Triple-quoted strings are skipped so docstrings that
 * mention imports don't count. (Swap for Tree-sitter when more languages
 * land; the interface stays the same.)
 *
 * Resolution follows CPython's lookup order loosely: relative imports from
 * the importing file's package, absolute imports from a set of roots
 * (workspace folder, `src/`, and every ancestor directory of the file).
 * Anything that doesn't land on a workspace file is treated as external.
 */
export const pythonAnalyzer: DependencyAnalyzer = {
	id: 'python',
	languageIds: ['python'],
	fileExtensions: ['.py'],
	fileGlob: '**/*.py',
	extractImports,
	resolve,
};

const IMPORT_RE = /^import\s+(.+)$/;
const FROM_RE = /^from\s+(\.*)([\w.]*)\s+import\s+(.+)$/;

function extractImports(content: string): ImportSpec[] {
	const specs: ImportSpec[] = [];
	const lines = content.split(/\r?\n/);
	let inTripleQuote: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];

		// Track docstrings / multi-line strings (approximate: toggles per fence).
		if (inTripleQuote) {
			if (raw.includes(inTripleQuote)) {
				inTripleQuote = null;
			}
			continue;
		}
		const fence = raw.match(/"""|'''/g);
		if (fence && fence.length % 2 === 1) {
			inTripleQuote = fence[0];
			continue;
		}

		const trimmed = stripComment(raw).trim();
		if (!trimmed.startsWith('import ') && !trimmed.startsWith('from ')) {
			continue;
		}

		// Join continuation lines: trailing backslash or an open parenthesis.
		const startLine = i + 1;
		let statement = trimmed;
		while (i + 1 < lines.length && needsContinuation(statement)) {
			i++;
			statement = statement.replace(/\\$/, '') + ' ' + stripComment(lines[i]).trim();
		}
		statement = statement.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();

		const fromMatch = statement.match(FROM_RE);
		if (fromMatch) {
			const [, dots, module, names] = fromMatch;
			specs.push({
				module,
				level: dots.length,
				names: splitNames(names),
				line: startLine,
			});
			continue;
		}
		const importMatch = statement.match(IMPORT_RE);
		if (importMatch) {
			for (const part of importMatch[1].split(',')) {
				const module = part.trim().split(/\s+as\s+/)[0].trim();
				if (module) {
					specs.push({ module, level: 0, names: [], line: startLine });
				}
			}
		}
	}
	return specs;
}

function stripComment(line: string): string {
	const hash = line.indexOf('#');
	return hash === -1 ? line : line.slice(0, hash);
}

function needsContinuation(statement: string): boolean {
	if (statement.endsWith('\\')) {
		return true;
	}
	const open = (statement.match(/\(/g) ?? []).length;
	const close = (statement.match(/\)/g) ?? []).length;
	return open > close;
}

function splitNames(names: string): string[] {
	return names
		.split(',')
		.map(n => n.trim().split(/\s+as\s+/)[0].trim())
		.filter(n => n && n !== '*');
}

async function resolve(spec: ImportSpec, from: vscode.Uri, ctx: ResolveContext): Promise<vscode.Uri[]> {
	const moduleParts = spec.module.split('.').filter(Boolean);
	const roots = spec.level > 0 ? [relativeBase(from, spec.level)] : absoluteRoots(from, ctx.workspaceFolder);

	const found: vscode.Uri[] = [];
	const seen = new Set<string>();
	const add = (uri: vscode.Uri) => {
		if (uri.fsPath !== from.fsPath && !seen.has(uri.fsPath)) {
			seen.add(uri.fsPath);
			found.push(uri);
		}
	};

	for (const root of roots) {
		// `import a.b` / `from a.b import x` → the module (or package) a.b itself.
		const moduleHit = moduleParts.length ? await firstExisting(candidates(root, moduleParts), ctx) : null;
		if (moduleParts.length && !moduleHit) {
			continue;
		}
		if (moduleHit) {
			add(moduleHit);
		}
		// `from a.b import x` where x is a submodule a/b/x.py (vs. a symbol inside a/b.py).
		for (const name of spec.names) {
			const hit = await firstExisting(candidates(root, [...moduleParts, name]), ctx);
			if (hit) {
				add(hit);
			}
		}
		// First root that resolves wins, like sys.path.
		if (found.length) {
			break;
		}
	}
	return found;
}

/** For `from ..x import y` in /a/b/c.py: level 1 → /a/b, level 2 → /a. */
function relativeBase(from: vscode.Uri, level: number): vscode.Uri {
	let base = vscode.Uri.joinPath(from, '..');
	for (let i = 1; i < level; i++) {
		base = vscode.Uri.joinPath(base, '..');
	}
	return base;
}

/** Workspace folder, its src/, and every ancestor dir of the file up to the folder. */
function absoluteRoots(from: vscode.Uri, workspaceFolder: vscode.Uri | undefined): vscode.Uri[] {
	const roots: vscode.Uri[] = [];
	const push = (uri: vscode.Uri) => {
		if (!roots.some(r => r.fsPath === uri.fsPath)) {
			roots.push(uri);
		}
	};

	let dir = vscode.Uri.joinPath(from, '..');
	const stopAt = workspaceFolder?.fsPath;
	// Nearest directories first: a script usually imports siblings.
	for (let guard = 0; guard < 32; guard++) {
		push(dir);
		if (!stopAt || dir.fsPath === stopAt || dir.fsPath.length <= stopAt.length) {
			break;
		}
		const parent = vscode.Uri.joinPath(dir, '..');
		if (parent.fsPath === dir.fsPath) {
			break;
		}
		dir = parent;
	}
	if (workspaceFolder) {
		push(workspaceFolder);
		push(vscode.Uri.joinPath(workspaceFolder, 'src'));
	}
	return roots;
}

function candidates(root: vscode.Uri, parts: string[]): vscode.Uri[] {
	return [
		vscode.Uri.joinPath(root, ...parts.slice(0, -1), `${parts[parts.length - 1]}.py`),
		vscode.Uri.joinPath(root, ...parts, '__init__.py'),
	];
}

async function firstExisting(uris: vscode.Uri[], ctx: ResolveContext): Promise<vscode.Uri | null> {
	for (const uri of uris) {
		if (await ctx.exists(uri)) {
			return uri;
		}
	}
	return null;
}
