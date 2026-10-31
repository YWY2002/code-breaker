import * as vscode from 'vscode';

/**
 * Hosts the React Flow canvas in a webview. One panel at a time; re-invoking
 * the command reveals the existing panel and retargets it to the new folder.
 */
export class CanvasPanel {
	public static readonly viewType = 'codeBreaker.canvas';
	private static current: CanvasPanel | undefined;

	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];

	public static show(extensionUri: vscode.Uri, folder?: vscode.Uri) {
		const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

		if (CanvasPanel.current) {
			CanvasPanel.current.panel.reveal(column);
			CanvasPanel.current.setFolder(folder);
			return;
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
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, folder?: vscode.Uri) {
		this.panel = panel;
		this.panel.webview.html = this.getHtml(extensionUri);
		this.setFolder(folder);

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	private setFolder(folder?: vscode.Uri) {
		const name = folder ? vscode.workspace.asRelativePath(folder, true) : undefined;
		this.panel.title = name ? `Code Breaker — ${name}` : 'Code Breaker';
		void this.panel.webview.postMessage({ type: 'setFolder', path: folder?.fsPath ?? null });
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
