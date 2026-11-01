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

	// Explorer right-click on a file → "Use with Code Breaker". Adds one code
	// node for that file to the canvas.
	context.subscriptions.push(
		vscode.commands.registerCommand('code-breaker.openFile', async (file?: vscode.Uri) => {
			const uri = file ?? vscode.window.activeTextEditor?.document.uri;
			if (!uri) {
				vscode.window.showWarningMessage('Code Breaker: no file selected.');
				return;
			}
			const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri;
			const panel = CanvasPanel.show(context.extensionUri, folder);
			await panel.openFile(uri);
		})
	);
}

export function deactivate() {}
