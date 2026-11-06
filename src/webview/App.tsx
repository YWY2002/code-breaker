import { useEffect, useState } from 'react';
import {
	ReactFlow,
	ReactFlowProvider,
	Background,
	Controls,
	MiniMap,
	Panel,
	useNodesState,
	useEdgesState,
	useReactFlow,
	type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { CodeFile } from '../shared/messages';
import { nodeTypes, CODE_NODE_SIZE, type CodeNodeType } from './nodes';
import { edgeTypes, linkEdgeOptions, toEdge } from './edges';
import { placeBeside } from './layout';
import { onHostMessage, postToHost } from './vscode';
import { useVsCodeColorMode } from './theme';

/** New nodes land on a simple grid so they never stack on top of each other. */
const GRID = { columns: 3, cellWidth: 560, cellHeight: 400 };
function gridPosition(index: number) {
	return {
		x: (index % GRID.columns) * GRID.cellWidth,
		y: Math.floor(index / GRID.columns) * GRID.cellHeight,
	};
}

function makeNode(file: CodeFile, position: { x: number; y: number }): CodeNodeType {
	return {
		id: file.path,
		type: 'code',
		position,
		// Initial size; NodeResizer updates these as the user drags.
		width: CODE_NODE_SIZE.width,
		height: CODE_NODE_SIZE.height,
		data: { ...file, saveState: 'idle', linkState: 'idle' },
	};
}

export function App() {
	return (
		<ReactFlowProvider>
			<Canvas />
		</ReactFlowProvider>
	);
}

function Canvas() {
	const [folder, setFolder] = useState<string | null>(null);
	const colorMode = useVsCodeColorMode();
	const [nodes, setNodes, onNodesChange] = useNodesState<CodeNodeType>([]);
	const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
	const { fitView, getNodes } = useReactFlow();
	const [refreshing, setRefreshing] = useState(false);

	// Re-reads every file on the canvas and recomputes the links among them.
	const refresh = () => {
		const paths = getNodes().map(n => n.id);
		if (!paths.length || refreshing) {
			return;
		}
		setRefreshing(true);
		postToHost({ type: 'refresh', paths });
	};

	useEffect(() => {
		// Short delay so newly added nodes are measured before framing.
		const frame = () => window.setTimeout(() => void fitView({ padding: 0.2, duration: 300 }), 60);

		const unsubscribe = onHostMessage(msg => {
			switch (msg.type) {
				case 'setFolder':
					setFolder(msg.path);
					break;
				case 'openFile':
					setNodes(current => {
						const existing = current.find(n => n.id === msg.file.path);
						if (existing) {
							// Keep the user's draft; just refresh the on-disk content.
							return current.map(n =>
								n.id === msg.file.path ? { ...n, data: { ...n.data, ...msg.file } } : n
							);
						}
						return [...current, makeNode(msg.file, gridPosition(current.length))];
					});
					frame();
					break;
				case 'fileChanged':
					// Only the on-disk content moves; the node decides whether to
					// adopt it or keep the user's draft (see CodeNode).
					setNodes(current =>
						current.map(n =>
							n.id === msg.path && n.data.content !== msg.content
								? { ...n, data: { ...n.data, content: msg.content } }
								: n
						)
					);
					break;
				case 'links':
					setNodes(current => {
						const anchor = current.find(n => n.id === msg.path);
						const have = new Set(current.map(n => n.id));
						const next = current.map(n =>
							n.id === msg.path
								? { ...n, data: { ...n.data, linkState: msg.edges.length ? 'idle' : 'none' } as CodeNodeType['data'] }
								: n
						);
						if (!anchor) {
							return next;
						}
						const newFiles = msg.files.filter(f => !have.has(f.path));
						const dependencyPaths = new Set(msg.edges.filter(e => e.source === msg.path).map(e => e.target));
						const deps = newFiles.filter(f => dependencyPaths.has(f.path));
						const dependents = newFiles.filter(f => !dependencyPaths.has(f.path));

						const rightSpots = placeBeside(anchor, 'right', deps.length, next);
						const added = deps.map((f, i) => makeNode(f, rightSpots[i]));
						const leftSpots = placeBeside(anchor, 'left', dependents.length, [...next, ...added]);
						added.push(...dependents.map((f, i) => makeNode(f, leftSpots[i])));
						return [...next, ...added];
					});
					setEdges(current => {
						const have = new Set(current.map(e => e.id));
						const added = msg.edges.map(toEdge).filter(e => !have.has(e.id));
						return added.length ? [...current, ...added] : current;
					});
					if (msg.files.length) {
						frame();
					}
					break;
				case 'refreshed': {
					const fresh = new Map(msg.files.map(f => [f.path, f]));
					const gone = new Set(msg.missing);
					// New content flows through the same path as a live edit: a
					// node with unsaved edits keeps its draft and offers reload.
					setNodes(current =>
						current
							.filter(n => !gone.has(n.id))
							.map(n => {
								const file = fresh.get(n.id);
								return file ? { ...n, data: { ...n.data, ...file, linkState: 'idle' } } : n;
							})
					);
					// Links among refreshed files are replaced wholesale; links to
					// nodes added while the refresh was in flight are kept.
					// A link that survives keeps its object, and with it any
					// endpoints the user pinned by hand.
					setEdges(current => {
						const previous = new Map(current.map(e => [e.id, e]));
						return [
							...current.filter(
								e =>
									!gone.has(e.source) &&
									!gone.has(e.target) &&
									!(fresh.has(e.source) && fresh.has(e.target))
							),
							...msg.edges.map(toEdge).map(e => previous.get(e.id) ?? e),
						];
					});
					setRefreshing(false);
					break;
				}
				case 'saved':
					setNodes(current =>
						current.map(n => {
							if (n.id !== msg.path) {
								return n;
							}
							return msg.ok
								? { ...n, data: { ...n.data, content: msg.content ?? n.data.content, saveState: 'saved' } }
								: { ...n, data: { ...n.data, saveState: 'error', saveError: msg.error } };
						})
					);
					break;
			}
		});

		// Host queues messages until it hears this.
		postToHost({ type: 'ready' });

		return unsubscribe;
	}, [setNodes, setEdges, fitView]);

	// Anything waiting on the host: a canvas refresh, a link lookup, a save.
	const busy =
		refreshing || nodes.some(n => n.data.linkState === 'loading' || n.data.saveState === 'saving');

	return (
		<div className="canvas">
			{busy && (
				<div className="canvas__progress" role="progressbar" aria-label="Loading" aria-busy="true">
					<div className="canvas__progress-bar" />
				</div>
			)}
			<ReactFlow
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes}
				edgeTypes={edgeTypes}
				defaultEdgeOptions={linkEdgeOptions}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
				// Fires for the node's remove button and for the Delete/Backspace key.
				onNodesDelete={deleted => {
					for (const node of deleted) {
						postToHost({ type: 'closeFile', path: node.id });
					}
				}}
				colorMode={colorMode}
				fitView
				minZoom={0.1}
				nodesConnectable={false}
				proOptions={{ hideAttribution: true }}
			>
				<Background />
				<Controls />
				<MiniMap pannable zoomable />
				{/* Canvas-level tools; more can sit beside Refresh later. */}
				<Panel position="top-right" className="canvas__toolbar">
					<button
						type="button"
						className={`canvas__button${refreshing ? ' canvas__button--busy' : ''}`}
						onClick={refresh}
						disabled={refreshing || nodes.length === 0}
						title="Reload every file on the canvas and recompute their links"
					>
						<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
							<path d="M13 8a5 5 0 1 1-1.5-3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
							<path d="M13 2.5v3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
						Refresh
					</button>
				</Panel>
			</ReactFlow>
			{folder && <div className="canvas__folder" title={folder}>{folder}</div>}
		</div>
	);
}
