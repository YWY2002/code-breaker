import { useEffect, useState } from 'react';
import {
	ReactFlow,
	Background,
	Controls,
	MiniMap,
	type ColorMode,
	type Edge,
	type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

/** Messages posted from the extension host (see canvasPanel.ts). */
type HostMessage = { type: 'setFolder'; path: string | null };

const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

/** VS Code marks the webview body with vscode-light / vscode-dark / vscode-high-contrast. */
function readColorMode(): ColorMode {
	return document.body.classList.contains('vscode-light') ? 'light' : 'dark';
}

export function App() {
	const [folder, setFolder] = useState<string | null>(null);
	const [colorMode, setColorMode] = useState<ColorMode>(readColorMode);

	useEffect(() => {
		const onMessage = (event: MessageEvent<HostMessage>) => {
			if (event.data.type === 'setFolder') {
				setFolder(event.data.path);
			}
		};
		window.addEventListener('message', onMessage);

		// Follow theme changes without reloading the webview.
		const observer = new MutationObserver(() => setColorMode(readColorMode()));
		observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

		return () => {
			window.removeEventListener('message', onMessage);
			observer.disconnect();
		};
	}, []);

	return (
		<div className="canvas">
			<ReactFlow
				nodes={initialNodes}
				edges={initialEdges}
				colorMode={colorMode}
				fitView
				proOptions={{ hideAttribution: true }}
			>
				<Background />
				<Controls />
				<MiniMap />
			</ReactFlow>
			{folder && <div className="canvas__folder" title={folder}>{folder}</div>}
		</div>
	);
}
