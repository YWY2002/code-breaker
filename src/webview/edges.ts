import { MarkerType, type DefaultEdgeOptions, type Edge } from '@xyflow/react';
import type { LinkEdge } from '../shared/messages';

/** Dependency links: importer → imported. */
export const LINK_COLOR = '#480058';

export const linkEdgeOptions: DefaultEdgeOptions = {
	type: 'default',
	style: { stroke: LINK_COLOR, strokeWidth: 2 },
	markerEnd: { type: MarkerType.ArrowClosed, color: LINK_COLOR, width: 18, height: 18 },
};

export function linkEdgeId(link: LinkEdge): string {
	return `${link.source}->${link.target}`;
}

export function toEdge(link: LinkEdge): Edge {
	return { id: linkEdgeId(link), source: link.source, target: link.target };
}
