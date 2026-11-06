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

/** A dependency edge: `source` imports `target`. Both are absolute paths (node ids). */
export type LinkEdge = {
	source: string;
	target: string;
};

export type HostToWebview =
	| { type: 'setFolder'; path: string | null }
	| { type: 'openFile'; file: CodeFile }
	/** The file changed in VS Code (editor edit, save, or on disk) after it was opened on the canvas. */
	| { type: 'fileChanged'; path: string; content: string }
	/**
	 * Answer to `requestLinks`: every file linked to `path` (the webview adds
	 * nodes for ones it doesn't have) and the edges touching `path`.
	 */
	| { type: 'links'; path: string; files: CodeFile[]; edges: LinkEdge[] }
	/**
	 * Answer to `refresh`: current content of every requested file that still
	 * exists, the ones that no longer do, and the links among the survivors.
	 */
	| { type: 'refreshed'; files: CodeFile[]; missing: string[]; edges: LinkEdge[] }
	/** `content` echoes what was written so the webview can mark the node clean. */
	| { type: 'saved'; path: string; ok: boolean; content?: string; error?: string };

export type WebviewToHost =
	| { type: 'ready' }
	| { type: 'saveFile'; path: string; content: string }
	/** Pull the dependencies and dependents of a file onto the canvas. */
	| { type: 'requestLinks'; path: string }
	/** The node was removed from the canvas; stop syncing the file. */
	| { type: 'closeFile'; path: string }
	/** Re-read these files and recompute the links among them. */
	| { type: 'refresh'; paths: string[] };
