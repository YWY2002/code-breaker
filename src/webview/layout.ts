import type { Node, XYPosition } from '@xyflow/react';
import { CODE_NODE_SIZE } from './nodes';

type Rect = { x: number; y: number; width: number; height: number };

const GAP_X = 120;
const GAP_Y = 40;

function rectOf(node: Node): Rect {
	return {
		x: node.position.x,
		y: node.position.y,
		width: node.width ?? node.measured?.width ?? CODE_NODE_SIZE.width,
		height: node.height ?? node.measured?.height ?? CODE_NODE_SIZE.height,
	};
}

function overlaps(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.width + GAP_Y && a.x + a.width + GAP_Y > b.x
		&& a.y < b.y + b.height + GAP_Y && a.y + a.height + GAP_Y > b.y;
}

/**
 * Places new nodes in a column beside `anchor`: dependencies to the right,
 * dependents to the left, so arrows read left → right. Each node slides down
 * until it clears everything already on the canvas.
 */
export function placeBeside(
	anchor: Node,
	side: 'left' | 'right',
	count: number,
	existing: Node[]
): XYPosition[] {
	const a = rectOf(anchor);
	const taken = existing.map(rectOf);
	const size = { width: CODE_NODE_SIZE.width, height: CODE_NODE_SIZE.height };
	const x = side === 'right' ? a.x + a.width + GAP_X : a.x - size.width - GAP_X;

	const positions: XYPosition[] = [];
	let y = a.y;
	for (let i = 0; i < count; i++) {
		let candidate: Rect = { x, y, ...size };
		while (taken.some(t => overlaps(candidate, t))) {
			candidate = { ...candidate, y: candidate.y + GAP_Y };
		}
		positions.push({ x: candidate.x, y: candidate.y });
		taken.push(candidate);
		y = candidate.y + size.height + GAP_Y;
	}
	return positions;
}
