import * as vscode from 'vscode';
import type { CodeFile, HostToWebview, WebviewToHost } from './shared/messages';

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
	}

	/** Reads a file and asks the webview to add a code node for it. */
	public async openFile(uri: vscode.Uri) {
		const document = await vscode.workspace.openTextDocument(uri);
		const file: CodeFile = {
			path: uri.fsPath,
			relativePath: vscode.workspace.asRelativePath(uri, false),
			content: document.getText(),
			language: document.languageId,
		};
		this.post({ type: 'openFile', file });
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
