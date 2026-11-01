import type { HostToWebview, WebviewToHost } from '../shared/messages';

interface VsCodeApi {
	postMessage(msg: WebviewToHost): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// acquireVsCodeApi may only be called once per webview.
const api = acquireVsCodeApi();

export function postToHost(msg: WebviewToHost) {
	api.postMessage(msg);
}

/** Subscribes to host messages; returns an unsubscribe function. */
export function onHostMessage(handler: (msg: HostToWebview) => void): () => void {
	const listener = (event: MessageEvent<HostToWebview>) => handler(event.data);
	window.addEventListener('message', listener);
	return () => window.removeEventListener('message', listener);
}
