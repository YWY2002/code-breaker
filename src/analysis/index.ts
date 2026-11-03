import * as vscode from 'vscode';
import { pythonAnalyzer } from './python';
import type { DependencyAnalyzer, ResolveContext } from './types';

export type { DependencyAnalyzer, ImportSpec, ResolveContext } from './types';

/** Registered analyzers. Add a language by appending here. */
const analyzers: readonly DependencyAnalyzer[] = [pythonAnalyzer];

export function analyzerForLanguage(languageId: string | undefined): DependencyAnalyzer | undefined {
	return languageId ? analyzers.find(a => a.languageIds.includes(languageId)) : undefined;
}

const EXCLUDE_GLOB = '**/{node_modules,.git,.venv,venv,env,__pycache__,site-packages,dist,build,out}/**';
const MAX_FILES = 5000;
const CONCURRENCY = 16;

/**
 * Workspace-wide import graph. Built lazily on the first link request and
 * kept fresh by file watchers afterwards, so "who imports this file?" is a
 * map lookup rather than a scan.
 */
export class DependencyIndex implements vscode.Disposable {
	/** importer → imported */
	private readonly deps = new Map<string, Set<string>>();
	/** imported → importers */
	private readonly dependents = new Map<string, Set<string>>();
	private readonly statCache = new Map<string, Promise<boolean>>();
	private readonly disposables: vscode.Disposable[] = [];
	private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
	private building: Promise<void> | undefined;

	/** Builds the index once; later calls await the same build. */
	public ensureBuilt(): Promise<void> {
		this.building ??= this.build();
		return this.building;
	}

	public dependenciesOf(path: string): string[] {
		return [...(this.deps.get(path) ?? [])];
	}

	public dependentsOf(path: string): string[] {
		return [...(this.dependents.get(path) ?? [])];
	}

	private async build() {
		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Window, title: 'Code Breaker: indexing imports' },
			async () => {
				for (const analyzer of analyzers) {
					const files = await vscode.workspace.findFiles(analyzer.fileGlob, EXCLUDE_GLOB, MAX_FILES);
					await mapWithConcurrency(files, CONCURRENCY, uri => this.analyze(uri, analyzer));
					this.watch(analyzer);
				}
			}
		);
	}

	private watch(analyzer: DependencyAnalyzer) {
		const watcher = vscode.workspace.createFileSystemWatcher(analyzer.fileGlob);
		watcher.onDidCreate(uri => this.schedule(uri, analyzer));
		watcher.onDidChange(uri => this.schedule(uri, analyzer));
		watcher.onDidDelete(uri => this.remove(uri.fsPath));
		this.disposables.push(watcher);

		// Unsaved editor edits count too, so links reflect what the user sees.
		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument(e => {
				if (analyzer.languageIds.includes(e.document.languageId)) {
					this.schedule(e.document.uri, analyzer);
				}
			})
		);
	}

	private schedule(uri: vscode.Uri, analyzer: DependencyAnalyzer) {
		const key = uri.fsPath;
		const timer = this.pending.get(key);
		if (timer) {
			clearTimeout(timer);
		}
		this.pending.set(
			key,
			setTimeout(() => {
				this.pending.delete(key);
				// A new file changes what paths exist, so forget cached stats.
				this.statCache.clear();
				void this.analyze(uri, analyzer);
			}, 300)
		);
	}

	private async analyze(uri: vscode.Uri, analyzer: DependencyAnalyzer) {
		let content: string;
		try {
			const open = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
			content = open ? open.getText() : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
		} catch {
			this.remove(uri.fsPath);
			return;
		}

		const ctx: ResolveContext = {
			workspaceFolder: vscode.workspace.getWorkspaceFolder(uri)?.uri,
			exists: target => this.exists(target),
		};
		const targets = new Set<string>();
		for (const spec of analyzer.extractImports(content)) {
			for (const hit of await analyzer.resolve(spec, uri, ctx)) {
				targets.add(hit.fsPath);
			}
		}
		this.set(uri.fsPath, targets);
	}

	private set(importer: string, targets: Set<string>) {
		for (const old of this.deps.get(importer) ?? []) {
			this.dependents.get(old)?.delete(importer);
		}
		this.deps.set(importer, targets);
		for (const target of targets) {
			let set = this.dependents.get(target);
			if (!set) {
				set = new Set();
				this.dependents.set(target, set);
			}
			set.add(importer);
		}
	}

	private remove(path: string) {
		this.set(path, new Set());
		this.deps.delete(path);
		this.dependents.delete(path);
	}

	private exists(uri: vscode.Uri): Promise<boolean> {
		const cached = this.statCache.get(uri.fsPath);
		if (cached) {
			return cached;
		}
		const check: Promise<boolean> = Promise.resolve(vscode.workspace.fs.stat(uri)).then(
			stat => (stat.type & vscode.FileType.File) !== 0,
			() => false
		);
		this.statCache.set(uri.fsPath, check);
		return check;
	}

	public dispose() {
		for (const timer of this.pending.values()) {
			clearTimeout(timer);
		}
		this.pending.clear();
		for (const d of this.disposables.splice(0)) {
			d.dispose();
		}
	}
}

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			await fn(items[next++]);
		}
	});
	await Promise.all(workers);
}
