/**
 * Message protocol between the extension host (canvasPanel.ts) and the
 * webview (src/webview). Shared so both sides type-check against one source.
 */

// A type alias (not an interface) so it satisfies React Flow's
// Record<string, unknown> constraint on node data.
export type CodeFile = {
	/** Absolute path; doubles as the node id. */
	path: string;
	/** Path relative to the workspace root, shown in the node header. */
	relativePath: string;
	content: string;
	/** VS Code language id (e.g. "python"), when known. */
	language?: string;
};

export type HostToWebview =
	| { type: 'setFolder'; path: string | null }
	| { type: 'openFile'; file: CodeFile }
	/** The file changed in VS Code (editor edit, save, or on disk) after it was opened on the canvas. */
	| { type: 'fileChanged'; path: string; content: string }
	/** `content` echoes what was written so the webview can mark the node clean. */
	| { type: 'saved'; path: string; ok: boolean; content?: string; error?: string };

export type WebviewToHost =
	| { type: 'ready' }
	| { type: 'saveFile'; path: string; content: string };
