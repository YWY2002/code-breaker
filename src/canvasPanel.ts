import * as vscode from 'vscode';
import { DependencyIndex } from './analysis';
import type { CodeFile, HostToWebview, LinkEdge, WebviewToHost } from './shared/messages';

/**
 * Hosts the React Flow canvas in a webview. One panel at a time; re-invoking
 * the command reveals the existing panel and retargets it to the new folder.
 *
 * Messages are queued until the webview reports `ready`, so files opened
 * before React has mounted are not lost.
 */
export class CanvasPanel {
	public static readonly viewType = 'codeBreaker.canvas';
	private static current: CanvasPanel | undefined;

	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];
	private ready = false;
	private queue: HostToWebview[] = [];

	/** Files currently shown on the canvas, keyed by fsPath, with their disk watcher. */
	private readonly openFiles = new Map<string, vscode.FileSystemWatcher>();
	/** Per-file debounce so a burst of keystrokes in VS Code becomes one update. */
	private readonly pendingSync = new Map<string, ReturnType<typeof setTimeout>>();
	private static readonly SYNC_DELAY_MS = 100;
	private readonly index = new DependencyIndex();

	public static show(extensionUri: vscode.Uri, folder?: vscode.Uri): CanvasPanel {
		const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

		if (CanvasPanel.current) {
			CanvasPanel.current.panel.reveal(column);
			CanvasPanel.current.setFolder(folder);
			return CanvasPanel.current;
		}

		const panel = vscode.window.createWebviewPanel(
			CanvasPanel.viewType,
			'Code Breaker',
			column,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
			}
		);

		CanvasPanel.current = new CanvasPanel(panel, extensionUri, folder);
		return CanvasPanel.current;
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, folder?: vscode.Uri) {
		this.panel = panel;
		this.panel.webview.html = this.getHtml(extensionUri);
		this.setFolder(folder);

		this.panel.webview.onDidReceiveMessage(
			(msg: WebviewToHost) => this.onMessage(msg),
			null,
			this.disposables
		);
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

		// Live edits in a VS Code editor (fires per keystroke, debounced below).
		vscode.workspace.onDidChangeTextDocument(
			e => {
				if (this.openFiles.has(e.document.uri.fsPath)) {
					this.scheduleSync(e.document.uri);
				}
			},
			null,
			this.disposables
		);
	}

	/** Reads a file and asks the webview to add a code node for it. */
	public async openFile(uri: vscode.Uri) {
		this.post({ type: 'openFile', file: await this.readCodeFile(uri) });
		this.watchFile(uri);
	}

	private async readCodeFile(uri: vscode.Uri): Promise<CodeFile> {
		const document = await vscode.workspace.openTextDocument(uri);
		return {
			path: uri.fsPath,
			relativePath: vscode.workspace.asRelativePath(uri, false),
			content: document.getText(),
			language: document.languageId,
		};
	}

	/** Finds what `path` imports and what imports it, and sends both to the canvas. */
	private async sendLinks(path: string) {
		try {
			await this.index.ensureBuilt();
			const dependencies = this.index.dependenciesOf(path);
			const dependents = this.index.dependentsOf(path);
			const edges: LinkEdge[] = [
				...dependencies.map(target => ({ source: path, target })),
				...dependents.map(source => ({ source, target: path })),
			];
			const linked = [...new Set([...dependencies, ...dependents])];
			const files = await Promise.all(linked.map(p => this.readCodeFile(vscode.Uri.file(p))));
			for (const file of files) {
				this.watchFile(vscode.Uri.file(file.path));
			}
			this.post({ type: 'links', path, files, edges });
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			vscode.window.showErrorMessage(`Code Breaker: could not resolve links for ${path}: ${error}`);
			this.post({ type: 'links', path, files: [], edges: [] });
		}
	}

	/**
	 * Watches the file on disk so changes made outside an editor (git
	 * checkout, formatter, another tool) reach the canvas too. Editor edits
	 * are covered by onDidChangeTextDocument.
	 */
	private watchFile(uri: vscode.Uri) {
		if (this.openFiles.has(uri.fsPath)) {
			return;
		}
		const dir = vscode.Uri.joinPath(uri, '..');
		const name = uri.path.slice(uri.path.lastIndexOf('/') + 1);
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, name));
		watcher.onDidChange(() => this.scheduleSync(uri));
		this.openFiles.set(uri.fsPath, watcher);
	}

	private scheduleSync(uri: vscode.Uri) {
		const key = uri.fsPath;
		const pending = this.pendingSync.get(key);
		if (pending) {
			clearTimeout(pending);
		}
		this.pendingSync.set(
			key,
			setTimeout(() => {
				this.pendingSync.delete(key);
				void this.syncFile(uri);
			}, CanvasPanel.SYNC_DELAY_MS)
		);
	}

	/** Pushes the current text of a file to the canvas. Prefers the live editor buffer over disk. */
	private async syncFile(uri: vscode.Uri) {
		try {
			const open = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
			const content = open
				? open.getText()
				: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
			this.post({ type: 'fileChanged', path: uri.fsPath, content });
		} catch {
			// File may have been deleted or be mid-write; the next change event will retry.
		}
	}

	private async onMessage(msg: WebviewToHost) {
		switch (msg.type) {
			case 'ready':
				this.ready = true;
				for (const queued of this.queue.splice(0)) {
					void this.panel.webview.postMessage(queued);
				}
				break;
			case 'saveFile':
				await this.saveFile(msg.path, msg.content);
				break;
			case 'requestLinks':
				await this.sendLinks(msg.path);
				break;
		}
	}

	/**
	 * Writes through a TextDocument + WorkspaceEdit rather than straight to
	 * disk so any open editor for the file updates in place.
	 */
	private async saveFile(path: string, content: string) {
		const uri = vscode.Uri.file(path);
		try {
			const document = await vscode.workspace.openTextDocument(uri);
			const fullRange = new vscode.Range(
				document.positionAt(0),
				document.positionAt(document.getText().length)
			);
			const edit = new vscode.WorkspaceEdit();
			edit.replace(uri, fullRange, content);
			const applied = await vscode.workspace.applyEdit(edit);
			const saved = applied && (await document.save());
			this.post(
				saved
					? { type: 'saved', path, ok: true, content }
					: { type: 'saved', path, ok: false, error: 'Save failed' }
			);
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			this.post({ type: 'saved', path, ok: false, error });
			vscode.window.showErrorMessage(`Code Breaker: could not save ${path}: ${error}`);
		}
	}

	private post(msg: HostToWebview) {
		if (this.ready) {
			void this.panel.webview.postMessage(msg);
		} else {
			this.queue.push(msg);
		}
	}

	private setFolder(folder?: vscode.Uri) {
		const name = folder ? vscode.workspace.asRelativePath(folder, true) : undefined;
		this.panel.title = name ? `Code Breaker — ${name}` : 'Code Breaker';
		this.post({ type: 'setFolder', path: folder?.fsPath ?? null });
	}

	private getHtml(extensionUri: vscode.Uri): string {
		const webview = this.panel.webview;
		const distUri = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'main.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'main.css'));
		const nonce = getNonce();

		// React Flow sets inline styles on nodes/edges, so style-src needs
		// 'unsafe-inline'. Scripts are nonce-locked.
		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${styleUri}">
	<title>Code Breaker</title>
</head>
<body>
	<div id="root"></div>
	<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}

	public dispose() {
		CanvasPanel.current = undefined;
		for (const timer of this.pendingSync.values()) {
			clearTimeout(timer);
		}
		this.pendingSync.clear();
		for (const watcher of this.openFiles.values()) {
			watcher.dispose();
		}
		this.openFiles.clear();
		this.index.dispose();
		this.panel.dispose();
		while (this.disposables.length) {
			this.disposables.pop()?.dispose();
		}
	}
}

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}
