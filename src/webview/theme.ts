import { useEffect, useState } from 'react';
import type { ColorMode } from '@xyflow/react';

/** VS Code marks the webview body with vscode-light / vscode-dark / vscode-high-contrast. */
export function readColorMode(): ColorMode {
	return document.body.classList.contains('vscode-light') ? 'light' : 'dark';
}

/** Follows VS Code theme changes without reloading the webview. */
export function useVsCodeColorMode(): ColorMode {
	const [colorMode, setColorMode] = useState<ColorMode>(readColorMode);

	useEffect(() => {
		const observer = new MutationObserver(() => setColorMode(readColorMode()));
		observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
		return () => observer.disconnect();
	}, []);

	return colorMode;
}
