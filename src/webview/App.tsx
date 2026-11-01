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
	type ColorMode,
	type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { nodeTypes, type CodeNodeType } from './nodes';
import { onHostMessage, postToHost } from './vscode';

/** VS Code marks the webview body with vscode-light / vscode-dark / vscode-high-contrast. */
function readColorMode(): ColorMode {
	return document.body.classList.contains('vscode-light') ? 'light' : 'dark';
}

/** New nodes land on a simple grid so they never stack on top of each other. */
const GRID = { columns: 3, cellWidth: 560, cellHeight: 400 };
function gridPosition(index: number) {
	return {
		x: (index % GRID.columns) * GRID.cellWidth,
		y: Math.floor(index / GRID.columns) * GRID.cellHeight,
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
	const [colorMode, setColorMode] = useState<ColorMode>(readColorMode);
	const [nodes, setNodes, onNodesChange] = useNodesState<CodeNodeType>([]);
	const [edges, , onEdgesChange] = useEdgesState<Edge>([]);
	const { fitView } = useReactFlow();

	useEffect(() => {
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
						return [
							...current,
							{
								id: msg.file.path,
								type: 'code',
								position: gridPosition(current.length),
								data: { ...msg.file, saveState: 'idle' },
							},
						];
					});
					// Let the node mount before framing it.
					window.requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 300 }));
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

		// Follow theme changes without reloading the webview.
		const observer = new MutationObserver(() => setColorMode(readColorMode()));
		observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

		// Host queues messages until it hears this.
		postToHost({ type: 'ready' });

		return () => {
			unsubscribe();
			observer.disconnect();
		};
	}, [setNodes, fitView]);

	return (
		<div className="canvas">
			<ReactFlow
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
				colorMode={colorMode}
				fitView
				minZoom={0.1}
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
