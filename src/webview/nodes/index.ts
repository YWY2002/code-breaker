import type { NodeTypes } from '@xyflow/react';
import { CodeNode } from './CodeNode';

export { CodeNode } from './CodeNode';
export { CODE_NODE_SIZE } from './CodeNode';
export type { CodeNodeData, CodeNodeType } from './CodeNode';

/** Registered with <ReactFlow nodeTypes>. Keys are the node `type` values. */
export const nodeTypes = {
	code: CodeNode,
} satisfies NodeTypes;
