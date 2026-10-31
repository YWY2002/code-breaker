import * as vscode from 'vscode';
import { CanvasPanel } from './canvasPanel';

export function activate(context: vscode.ExtensionContext) {
	// Ctrl+Shift+P → "Code Breaker: Open Canvas". Targets the first workspace
	// folder, if any.
	context.subscriptions.push(
		vscode.commands.registerCommand('code-breaker.open', () => {
			const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
			CanvasPanel.show(context.extensionUri, folder);
		})
	);

	// Explorer right-click on a folder → "Use with Code Breaker".
	context.subscriptions.push(
		vscode.commands.registerCommand('code-breaker.openFolder', (folder?: vscode.Uri) => {
			CanvasPanel.show(context.extensionUri, folder);
		})
	);
}

export function deactivate() {}
