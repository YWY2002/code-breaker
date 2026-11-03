import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeResizer, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import type { CodeFile } from '../../shared/messages';
import { postToHost } from '../vscode';
import { useVsCodeColorMode } from '../theme';
import { CodeEditor } from './CodeEditor';
import './CodeNode.css';

export type CodeNodeData = CodeFile & {
	/** Set by App when the host confirms (or rejects) a save. */
	saveState?: 'idle' | 'saving' | 'saved' | 'error';
	saveError?: string;
};

export type CodeNodeType = Node<CodeNodeData, 'code'>;

export const CODE_NODE_SIZE = { width: 520, height: 360, minWidth: 280, minHeight: 160 };

export function CodeNode({ id, data }: NodeProps<CodeNodeType>) {
	const { updateNodeData } = useReactFlow<CodeNodeType>();
	const colorMode = useVsCodeColorMode();

	// Draft lives in the node; `data.content` is the last known on-disk text.
	const [draft, setDraft] = useState(data.content);
	const lastContent = useRef(data.content);
	const dirty = draft !== data.content;
	const saving = data.saveState === 'saving';

	// When on-disk content changes (save confirmed, or file re-opened), adopt
	// it unless the draft has edits relative to the previous content.
	useEffect(() => {
		if (data.content !== lastContent.current) {
			const previous = lastContent.current;
			lastContent.current = data.content;
			setDraft(prev => (prev === previous ? data.content : prev));
		}
	}, [data.content]);

	const save = useCallback(() => {
		if (!dirty || saving) {
			return;
		}
		updateNodeData(id, { saveState: 'saving', saveError: undefined });
		postToHost({ type: 'saveFile', path: data.path, content: draft });
	}, [dirty, saving, draft, data.path, id, updateNodeData]);

	return (
		<div className="code-node">
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
