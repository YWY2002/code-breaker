/** Geometry for link endpoints. All coordinates are in flow space. */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * A user-placed endpoint, stored relative to its node's box (0..1 on each
 * axis, always on the border) so it travels and scales with the node.
 */
export type Anchor = { x: number; y: number };

/** Matches --cn-radius in CodeNode.css. */
const CORNER_RADIUS = 10;
/** How far the rounded corner's 45° point sits inside the square corner. */
const CORNER_INSET = CORNER_RADIUS * (1 - Math.SQRT1_2);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function anchorToPoint(rect: Rect, anchor: Anchor): Point {
	return { x: rect.x + anchor.x * rect.width, y: rect.y + anchor.y * rect.height };
}

/** Snaps any point to the nearest spot on the rect's border, as an anchor. */
export function projectToBorder(rect: Rect, point: Point): Anchor {
	const right = rect.x + rect.width;
	const bottom = rect.y + rect.height;
	let x = clamp(point.x, rect.x, right);
	let y = clamp(point.y, rect.y, bottom);

	// Inside the box: push out to the closest side.
	const toLeft = x - rect.x;
	const toRight = right - x;
	const toTop = y - rect.y;
	const toBottom = bottom - y;
	const nearest = Math.min(toLeft, toRight, toTop, toBottom);
	if (nearest > 0) {
		if (nearest === toLeft) {
			x = rect.x;
		} else if (nearest === toRight) {
			x = right;
		} else if (nearest === toTop) {
			y = rect.y;
		} else {
			y = bottom;
		}
	}
	return { x: (x - rect.x) / rect.width, y: (y - rect.y) / rect.height };
}

function closestBorderPoint(rect: Rect, point: Point): Point {
	return anchorToPoint(rect, projectToBorder(rect, point));
}

/**
 * Per axis: if the two spans overlap, both ends sit at the middle of the
 * overlap (a straight horizontal/vertical link); otherwise they sit on the
 * facing edges.
 */
function closestOnAxis(aMin: number, aMax: number, bMin: number, bMax: number): [number, number] {
	if (aMax < bMin) {
		return [aMax, bMin];
	}
	if (bMax < aMin) {
		return [aMin, bMax];
	}
	const middle = (Math.max(aMin, bMin) + Math.min(aMax, bMax)) / 2;
	return [middle, middle];
}

/** The shortest segment joining the borders of two rects. */
function shortestBetween(a: Rect, b: Rect): [Point, Point] {
	const [ax, bx] = closestOnAxis(a.x, a.x + a.width, b.x, b.x + b.width);
	const [ay, by] = closestOnAxis(a.y, a.y + a.height, b.y, b.y + b.height);
	if (ax === bx && ay === by) {
		// Overlapping nodes: no gap to span, so aim each end at the other's centre.
		const centre = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
		return [closestBorderPoint(a, centre(b)), closestBorderPoint(b, centre(a))];
	}
	return [{ x: ax, y: ay }, { x: bx, y: by }];
}

/** Pulls a point at a square corner onto the node's rounded corner. */
function ontoRoundedCorner(rect: Rect, point: Point): Point {
	const epsilon = 0.5;
	const atLeft = Math.abs(point.x - rect.x) < epsilon;
	const atRight = Math.abs(point.x - (rect.x + rect.width)) < epsilon;
	const atTop = Math.abs(point.y - rect.y) < epsilon;
	const atBottom = Math.abs(point.y - (rect.y + rect.height)) < epsilon;
	if ((atLeft || atRight) && (atTop || atBottom)) {
		return {
			x: point.x + (atLeft ? CORNER_INSET : -CORNER_INSET),
			y: point.y + (atTop ? CORNER_INSET : -CORNER_INSET),
		};
	}
	return point;
}

/**
 * Starting anchors for a new link: the shortest span between the two nodes
 * as they are laid out right now. Used once, when the link first appears;
 * after that both ends are pinned and only move when the user drags them.
 */
export function initialAnchors(source: Rect, target: Rect): [Anchor, Anchor] {
	const [from, to] = shortestBetween(source, target);
	return [projectToBorder(source, from), projectToBorder(target, to)];
}

/** Where a link's two pinned ends are drawn, given each node's current box. */
export function resolveEndpoints(
	source: Rect,
	target: Rect,
	sourceAnchor: Anchor,
	targetAnchor: Anchor
): [Point, Point] {
	return [
		ontoRoundedCorner(source, anchorToPoint(source, sourceAnchor)),
		ontoRoundedCorner(target, anchorToPoint(target, targetAnchor)),
	];
}
