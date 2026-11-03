import { useEffect, useState } from 'react';
import {
	ReactFlow,
	ReactFlowProvider,
	Background,
	Controls,
	MiniMap,
	useNodesState,
	useEdgesState,
	useReactFlow,
	type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { CodeFile } from '../shared/messages';
import { nodeTypes, CODE_NODE_SIZE, type CodeNodeType } from './nodes';
import { linkEdgeOptions, toEdge } from './edges';
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
	const { fitView } = useReactFlow();

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

	return (
		<div className="canvas">
			<ReactFlow
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes}
				defaultEdgeOptions={linkEdgeOptions}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
				colorMode={colorMode}
				fitView
				minZoom={0.1}
				nodesConnectable={false}
				proOptions={{ hideAttribution: true }}
			>
				<Background />
				<Controls />
				<MiniMap pannable zoomable />
			</ReactFlow>
			{folder && <div className="canvas__folder" title={folder}>{folder}</div>}
		</div>
	);
}
