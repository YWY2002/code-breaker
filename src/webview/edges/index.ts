import { MarkerType, type DefaultEdgeOptions, type Edge, type EdgeTypes } from '@xyflow/react';
import type { LinkEdge as LinkMessage } from '../../shared/messages';
import { LinkEdge } from './LinkEdge';

export { LinkEdge } from './LinkEdge';
export type { LinkEdgeData, LinkEdgeType } from './LinkEdge';

/** Dependency links: importer → imported. */
export const LINK_COLOR = '#480058';

/** Registered with <ReactFlow edgeTypes>. Keys are the edge `type` values. */
export const edgeTypes = {
	link: LinkEdge,
} satisfies EdgeTypes;

export const linkEdgeOptions: DefaultEdgeOptions = {
	type: 'link',
	style: { stroke: LINK_COLOR, strokeWidth: 2 },
	markerEnd: { type: MarkerType.ArrowClosed, color: LINK_COLOR, width: 18, height: 18 },
};

export function linkEdgeId(link: LinkMessage): string {
	return `${link.source}->${link.target}`;
}

export function toEdge(link: LinkMessage): Edge {
	return { id: linkEdgeId(link), type: 'link', source: link.source, target: link.target };
}
