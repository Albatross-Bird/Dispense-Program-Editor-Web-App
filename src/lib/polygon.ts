/**
 * Pure polygon geometry utilities.
 * No React, no store access — all functions are side-effect free.
 */

// ── Core predicates ────────────────────────────────────────────────────────────

/**
 * Standard ray-casting point-in-polygon test.
 * Returns false for degenerate polygons (< 3 vertices).
 * Points exactly on an edge may return true or false (boundary undefined).
 */
export function pointInPolygon(
  point: [number, number],
  vertices: [number, number][],
): boolean {
  if (vertices.length < 3) return false;
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i];
    const [xj, yj] = vertices[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Shoelace (Gauss) formula. Returns the absolute area in world-space square units.
 * Works for both CW and CCW windings.
 */
export function polygonArea(vertices: [number, number][]): number {
  let area = 0;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    area += (vertices[j][0] + vertices[i][0]) * (vertices[j][1] - vertices[i][1]);
  }
  return Math.abs(area / 2);
}

// ── Edge helpers ──────────────────────────────────────────────────────────────

export interface NearestPointResult {
  /** Closest point on the segment. */
  point: [number, number];
  /** Parameter 0..1 along the edge (0 = edgeStart, 1 = edgeEnd). */
  t: number;
  /** Distance from the query point to the nearest point. */
  distance: number;
}

/**
 * Closest point on segment [edgeStart, edgeEnd] to `point`.
 * Returns t=0 for zero-length edges.
 */
export function nearestPointOnEdge(
  point: [number, number],
  edgeStart: [number, number],
  edgeEnd: [number, number],
): NearestPointResult {
  const [px, py] = point;
  const [ax, ay] = edgeStart;
  const [bx, by] = edgeEnd;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const distance = Math.hypot(px - ax, py - ay);
    return { point: [ax, ay], t: 0, distance };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { point: [cx, cy], t, distance: Math.hypot(px - cx, py - cy) };
}

// ── Transform ─────────────────────────────────────────────────────────────────

/** Shift all vertices by (dx, dy). Returns a new array. */
export function translatePolygon(
  vertices: [number, number][],
  dx: number,
  dy: number,
): [number, number][] {
  return vertices.map(([x, y]): [number, number] => [x + dx, y + dy]);
}

// ── Bounding box ──────────────────────────────────────────────────────────────

/** Axis-aligned bounding box of the polygon vertices. */
export function polygonBoundingBox(
  vertices: [number, number][],
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of vertices) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

// ── Fill generation ───────────────────────────────────────────────────────────

export interface FillLine {
  start: [number, number];
  end: [number, number];
}

/**
 * Generate parallel fill lines inside the polygon.
 *
 * @param vertices  Polygon vertices (world coords, at least 3).
 * @param spacing   Distance between parallel lines (world units, > 0).
 * @param angleDeg  Angle of fill lines in degrees.
 *                  0° = horizontal, 90° = vertical.
 */
export function generateLineFill(
  vertices: [number, number][],
  spacing: number,
  angleDeg: number,
): FillLine[] {
  if (vertices.length < 3 || spacing <= 0) return [];

  const angle = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  // Rotate polygon so that fill lines become horizontal (y = const)
  const rotated: [number, number][] = vertices.map(([x, y]) => [
    x * cosA + y * sinA,
    -x * sinA + y * cosA,
  ]);

  const bbox = polygonBoundingBox(rotated);
  const lines: FillLine[] = [];

  const yStart = Math.ceil(bbox.minY / spacing) * spacing;

  for (let y = yStart; y <= bbox.maxY + 1e-9; y += spacing) {
    // Find all x-intersections of this horizontal scan line with polygon edges
    const xs: number[] = [];
    for (let i = 0, j = rotated.length - 1; i < rotated.length; j = i++) {
      const [x0, y0] = rotated[j];
      const [x1, y1] = rotated[i];
      // Intersect edge with y = const (exclusive at top endpoint to avoid double-counting vertices)
      if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) {
        xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);

    // Pair intersections (inside = between pairs)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xL = xs[k];
      const xR = xs[k + 1];
      // Rotate the endpoints back to world space
      const sx = xL * cosA - y * sinA;
      const sy = xL * sinA + y * cosA;
      const ex = xR * cosA - y * sinA;
      const ey = xR * sinA + y * cosA;
      lines.push({ start: [sx, sy], end: [ex, ey] });
    }
  }

  return lines;
}

export interface FillDot {
  point: [number, number];
}

/**
 * Generate a grid of dots inside the polygon.
 *
 * @param vertices  Polygon vertices (world coords, at least 3).
 * @param spacingX  Column spacing (world units, > 0).
 * @param spacingY  Row spacing (world units, > 0).
 */
export function generateDotFill(
  vertices: [number, number][],
  spacingX: number,
  spacingY: number,
): FillDot[] {
  if (vertices.length < 3 || spacingX <= 0 || spacingY <= 0) return [];

  const bbox = polygonBoundingBox(vertices);
  const dots: FillDot[] = [];

  const xStart = Math.ceil(bbox.minX / spacingX) * spacingX;
  const yStart = Math.ceil(bbox.minY / spacingY) * spacingY;

  for (let y = yStart; y <= bbox.maxY + 1e-9; y += spacingY) {
    for (let x = xStart; x <= bbox.maxX + 1e-9; x += spacingX) {
      if (pointInPolygon([x, y], vertices)) {
        dots.push({ point: [x, y] });
      }
    }
  }

  return dots;
}
