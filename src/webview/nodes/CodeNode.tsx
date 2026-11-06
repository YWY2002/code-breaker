import { useCallback, useEffect, useRef, useState } from 'react';
import { Handle, NodeResizer, Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import type { CodeFile } from '../../shared/messages';
import { postToHost } from '../vscode';
import { useVsCodeColorMode } from '../theme';
import { CodeEditor } from './CodeEditor';
import './CodeNode.css';

export type CodeNodeData = CodeFile & {
	/** Set by App when the host confirms (or rejects) a save. */
	saveState?: 'idle' | 'saving' | 'saved' | 'error';
	saveError?: string;
	/** 'none' = the last link request found no workspace imports either way. */
	linkState?: 'idle' | 'loading' | 'none';
};

export type CodeNodeType = Node<CodeNodeData, 'code'>;

export const CODE_NODE_SIZE = { width: 520, height: 360, minWidth: 280, minHeight: 160 };

export function CodeNode({ id, data }: NodeProps<CodeNodeType>) {
	const { updateNodeData, deleteElements } = useReactFlow<CodeNodeType>();
	const colorMode = useVsCodeColorMode();
	// Removing a node with unsaved edits needs a second click within a few seconds.
	const [confirmRemove, setConfirmRemove] = useState(false);

	// Draft lives in the node; `data.content` is the last known on-disk text.
	const [draft, setDraft] = useState(data.content);
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const lastContent = useRef(data.content);
	// True when the file changed in VS Code while this node had unsaved edits.
	const [stale, setStale] = useState(false);
	const dirty = draft !== data.content;
	const saving = data.saveState === 'saving';

	// When the file changes in VS Code (or a save is confirmed), follow it if
	// the node has no edits of its own; otherwise keep the draft and flag it
	// so the user can choose to reload.
	useEffect(() => {
		if (data.content === lastContent.current) {
			return;
		}
		const previous = lastContent.current;
		lastContent.current = data.content;
		const current = draftRef.current;
		if (current === previous || current === data.content) {
			setDraft(data.content);
			setStale(false);
		} else {
			setStale(true);
		}
	}, [data.content]);

	const reload = useCallback(() => {
		setDraft(data.content);
		setStale(false);
	}, [data.content]);

	const requestLinks = useCallback(() => {
		updateNodeData(id, { linkState: 'loading' });
		postToHost({ type: 'requestLinks', path: data.path });
	}, [id, data.path, updateNodeData]);

	const linkTitle =
		data.linkState === 'loading'
			? 'Finding imports…'
			: data.linkState === 'none'
				? 'No imports to or from this file in the workspace'
				: 'Show files this imports and files that import it';

	useEffect(() => {
		if (!confirmRemove) {
			return;
		}
		const timer = window.setTimeout(() => setConfirmRemove(false), 3000);
		return () => window.clearTimeout(timer);
	}, [confirmRemove]);

	// Removes the node (and its links) from the canvas only; the file is untouched.
	// App's onNodesDelete tells the host to stop watching it.
	const remove = useCallback(() => {
		if (dirty && !confirmRemove) {
			setConfirmRemove(true);
			return;
		}
		void deleteElements({ nodes: [{ id }] });
	}, [dirty, confirmRemove, deleteElements, id]);

	const save = useCallback(() => {
		if (!dirty || saving) {
			return;
		}
		updateNodeData(id, { saveState: 'saving', saveError: undefined });
		postToHost({ type: 'saveFile', path: data.path, content: draft });
	}, [dirty, saving, draft, data.path, id, updateNodeData]);

	return (
		<div className="code-node">
			{/* Invisible ports so dependency edges attach at the sides: imports
			    leave on the right, importers arrive on the left. */}
			<Handle type="target" position={Position.Left} className="code-node__port" isConnectable={false} />
			<Handle type="source" position={Position.Right} className="code-node__port" isConnectable={false} />
			{/* Edge lines resize one axis; corner handles resize both. */}
			<NodeResizer
				minWidth={CODE_NODE_SIZE.minWidth}
				minHeight={CODE_NODE_SIZE.minHeight}
				lineClassName="code-node__resize-line"
				handleClassName="code-node__resize-handle"
			/>
			<div className="code-node__card">
			<header className="code-node__header">
				<div className="code-node__path" title={data.path}>
					<span className="code-node__path-text">{data.relativePath}</span>
					{dirty && <span className="code-node__dirty" aria-label="Unsaved changes">●</span>}
				</div>
				<div className="code-node__tools">
					<button
						type="button"
						className={`code-node__tool nodrag${data.linkState === 'none' ? ' code-node__tool--muted' : ''}`}
						onClick={requestLinks}
						disabled={data.linkState === 'loading'}
						title={linkTitle}
						aria-label="Show links"
					>
						<LinksIcon />
					</button>
					{stale && (
						<button
							type="button"
							className="code-node__tool code-node__tool--attention nodrag"
							onClick={reload}
							title="File changed in VS Code. Reload it here (discards this node's edits)"
							aria-label="Reload from file"
						>
							<ReloadIcon />
						</button>
					)}
					{data.saveState === 'error' && (
						<span className="code-node__status code-node__status--error" title={data.saveError}>
							!
						</span>
					)}
					<button
						type="button"
						className="code-node__tool nodrag"
						onClick={save}
						disabled={!dirty || saving}
						title={dirty ? 'Save (Ctrl+S)' : 'No changes'}
						aria-label="Save"
					>
						<SaveIcon />
					</button>
					<button
						type="button"
						className={`code-node__tool nodrag${confirmRemove ? ' code-node__tool--danger' : ''}`}
						onClick={remove}
						title={
							confirmRemove
								? 'Unsaved edits will be lost. Click again to remove'
								: 'Remove from canvas (the file is not deleted)'
						}
						aria-label="Remove from canvas"
					>
						<RemoveIcon />
					</button>
				</div>
			</header>
			<CodeEditor
				className="code-node__editor nodrag nowheel"
				value={draft}
				language={data.language}
				filename={data.relativePath}
				colorMode={colorMode}
				onChange={setDraft}
				onSave={save}
			/>
			</div>
		</div>
	);
}

function LinksIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<circle cx="3" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
			<circle cx="13" cy="3.5" r="2" stroke="currentColor" strokeWidth="1.5" />
			<circle cx="13" cy="12.5" r="2" stroke="currentColor" strokeWidth="1.5" />
			<path d="M4.8 7.1l6.4-2.7M4.8 8.9l6.4 2.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	);
}

function RemoveIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path d="M2.5 4.5h11M6.5 4.5v-2h3v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M4 4.5l.6 8.5a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
			<path d="M6.7 7v4M9.3 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	);
}

function ReloadIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path
				d="M13 8a5 5 0 1 1-1.5-3.6"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
			<path d="M13 2.5v3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function SaveIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path
				d="M2.5 2.5h8.3l2.7 2.7v8.3h-11v-11z"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinejoin="round"
			/>
			<path d="M5 2.5v3.5h5v-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
			<rect x="4.5" y="9" width="7" height="4.5" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
		</svg>
	);
}
