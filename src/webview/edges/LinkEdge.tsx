import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
	BaseEdge,
	ViewportPortal,
	getStraightPath,
	useInternalNode,
	useReactFlow,
	type Edge,
	type EdgeProps,
	type InternalNode,
} from '@xyflow/react';
import { initialAnchors, projectToBorder, resolveEndpoints, type Anchor, type Rect } from './geometry';
import './LinkEdge.css';

export type LinkEdgeData = {
	/** Where each end is pinned on its node. Filled in when the link first renders. */
	sourceAnchor?: Anchor;
	targetAnchor?: Anchor;
};

export type LinkEdgeType = Edge<LinkEdgeData, 'link'>;

type End = 'source' | 'target';

function rectOf(node: InternalNode | undefined): Rect | null {
	const width = node?.measured.width ?? node?.width;
	const height = node?.measured.height ?? node?.height;
	if (!node || !width || !height) {
		return null;
	}
	return { x: node.internals.positionAbsolute.x, y: node.internals.positionAbsolute.y, width, height };
}

/**
 * Dependency link drawn as a straight line between two nodes' borders.
 *
 * Both ends are pinned to a spot on their node (stored relative to the node,
 * so they travel and scale with it). They never re-route on their own: the
 * starting spots are chosen once, when the link first appears, and from then
 * on an end only moves when the user drags it along its own node's border.
 */
export function LinkEdge({ id, source, target, markerEnd, style, selected, data }: EdgeProps<LinkEdgeType>) {
	const sourceRect = rectOf(useInternalNode(source));
	const targetRect = rectOf(useInternalNode(target));
	const { screenToFlowPosition, updateEdgeData } = useReactFlow();
	const [hovered, setHovered] = useState(false);
	const [dragging, setDragging] = useState<End | null>(null);

	// Latest rects for the drag listeners, which outlive a single render.
	const rects = useRef({ source: sourceRect, target: targetRect });
	rects.current = { source: sourceRect, target: targetRect };

	// Pin both ends the first time the link can be laid out.
	const sourceAnchor = data?.sourceAnchor;
	const targetAnchor = data?.targetAnchor;
	const needsAnchors = sourceRect !== null && targetRect !== null && (!sourceAnchor || !targetAnchor);
	useEffect(() => {
		const { source: from, target: to } = rects.current;
		if (!needsAnchors || !from || !to) {
			return;
		}
		const [initialSource, initialTarget] = initialAnchors(from, to);
		updateEdgeData(id, {
			sourceAnchor: sourceAnchor ?? initialSource,
			targetAnchor: targetAnchor ?? initialTarget,
		});
	}, [needsAnchors, id, sourceAnchor, targetAnchor, updateEdgeData]);

	const startDrag = useCallback(
		(end: End) => (event: ReactPointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			const handle = event.currentTarget;
			handle.setPointerCapture(event.pointerId);
			setDragging(end);

			const move = (e: PointerEvent) => {
				const rect = rects.current[end];
				if (!rect) {
					return;
				}
				// Always projected onto this end's own node, so it can never land on another.
				const anchor = projectToBorder(rect, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
				updateEdgeData(id, end === 'source' ? { sourceAnchor: anchor } : { targetAnchor: anchor });
			};
			const stop = () => {
				handle.removeEventListener('pointermove', move);
				handle.removeEventListener('pointerup', stop);
				handle.removeEventListener('pointercancel', stop);
				setDragging(null);
			};
			handle.addEventListener('pointermove', move);
			handle.addEventListener('pointerup', stop);
			handle.addEventListener('pointercancel', stop);
		},
		[id, screenToFlowPosition, updateEdgeData]
	);

	if (!sourceRect || !targetRect) {
		return null;
	}

	// Until the effect above has stored them, draw with the same starting anchors.
	const [initialSource, initialTarget] = needsAnchors ? initialAnchors(sourceRect, targetRect) : [undefined, undefined];
	const [from, to] = resolveEndpoints(
		sourceRect,
		targetRect,
		sourceAnchor ?? initialSource ?? { x: 1, y: 0.5 },
		targetAnchor ?? initialTarget ?? { x: 0, y: 0.5 }
	);
	const [path] = getStraightPath({ sourceX: from.x, sourceY: from.y, targetX: to.x, targetY: to.y });
	const active = hovered || selected || dragging !== null;

	const handle = (end: End, point: { x: number; y: number }) => (
		<div
			className={[
				'link-edge__handle nodrag nopan',
				active ? 'link-edge__handle--visible' : '',
				dragging === end ? 'link-edge__handle--dragging' : '',
			].join(' ')}
			style={{ transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)` }}
			onPointerDown={startDrag(end)}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			title="Drag to move this end along the node's border"
		/>
	);

	return (
		<>
			<g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
				<BaseEdge
					id={id}
					path={path}
					markerEnd={markerEnd}
					style={{ ...style, strokeWidth: active ? 3 : style?.strokeWidth }}
					interactionWidth={16}
				/>
			</g>
			<ViewportPortal>
				{handle('source', from)}
				{handle('target', to)}
			</ViewportPortal>
		</>
	);
}
