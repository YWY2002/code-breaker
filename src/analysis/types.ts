import type * as vscode from 'vscode';

/** One import statement, language-neutral. */
export interface ImportSpec {
	/** Dotted / slashed module path as written, without relative prefix. */
	module: string;
	/** Relative depth (Python: number of leading dots). 0 = absolute. */
	level: number;
	/** Names imported from the module, if the syntax has them (`from m import a, b`). */
	names: string[];
	/** 1-based line of the statement, for diagnostics. */
	line: number;
}

/** What a resolver needs to know about the workspace. */
export interface ResolveContext {
	/** Workspace folder containing the importing file, if any. */
	workspaceFolder: vscode.Uri | undefined;
	/** Cached existence check. */
	exists(uri: vscode.Uri): Promise<boolean>;
}

/**
 * Per-language dependency analysis. The graph code only talks to this
 * interface; adding a language means adding one implementation and
 * registering it in ./index.ts.
 */
export interface DependencyAnalyzer {
	/** Short id, e.g. "python". */
	readonly id: string;
	/** VS Code language ids this analyzer handles. */
	readonly languageIds: readonly string[];
	/** Glob for the files to index, e.g. "**​/*.py". */
	readonly fileGlob: string;
	/** Pull import statements out of a file's text. */
	extractImports(content: string): ImportSpec[];
	/** Map one import to the workspace files it refers to (none for stdlib / third-party). */
	resolve(spec: ImportSpec, from: vscode.Uri, ctx: ResolveContext): Promise<vscode.Uri[]>;
}
