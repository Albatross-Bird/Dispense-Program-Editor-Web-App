export interface Camera {
  zoom: number;
  panX: number;
  panY: number;
  /**
   * When true the coordinate system is Y-up: positive Y moves upward on screen.
   * Controlled by the active syntax profile's `yAxisUp` flag.
   */
  flipY: boolean;
}

/**
 * World → screen.
 * With flipY=false (default/MYT): screenY = wy * zoom + panY  (Y-down)
 * With flipY=true  (MYD):         screenY = -wy * zoom + panY (Y-up)
 */
export function worldToScreen(wx: number, wy: number, cam: Camera): [number, number] {
  const sy = cam.flipY ? -wy * cam.zoom + cam.panY : wy * cam.zoom + cam.panY;
  return [wx * cam.zoom + cam.panX, sy];
}

/**
 * Screen → world (exact inverse of worldToScreen).
 */
export function screenToWorld(sx: number, sy: number, cam: Camera): [number, number] {
  const wy = cam.flipY ? -(sy - cam.panY) / cam.zoom : (sy - cam.panY) / cam.zoom;
  return [(sx - cam.panX) / cam.zoom, wy];
}

/** Zoom in/out, keeping screen point (sx, sy) stationary. */
export function zoomAt(cam: Camera, sx: number, sy: number, factor: number): Camera {
  const [wx, wy] = screenToWorld(sx, sy, cam);
  const zoom = Math.min(200, Math.max(0.01, cam.zoom * factor));
  // worldToScreen(wx, wy, newCam) must equal (sx, sy):
  //   Y-down: wy * zoom + panY = sy  → panY = sy - wy * zoom
  //   Y-up:  -wy * zoom + panY = sy  → panY = sy + wy * zoom
  const panY = cam.flipY ? sy + wy * zoom : sy - wy * zoom;
  return { zoom, panX: sx - wx * zoom, panY, flipY: cam.flipY };
}

/** Return a camera that centers and fits all given world points in the canvas. */
export function fitCamera(
  points: [number, number][],
  canvasW: number,
  canvasH: number,
  padding = 48,
  flipY = false,
): Camera {
  if (points.length === 0 || canvasW === 0 || canvasH === 0) {
    return { zoom: 1, panX: canvasW / 2, panY: canvasH / 2, flipY };
  }
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const bboxW = maxX - minX || 1;
  const bboxH = maxY - minY || 1;
  const zoom = Math.max(0.01, Math.min(200,
    Math.min((canvasW - padding * 2) / bboxW, (canvasH - padding * 2) / bboxH),
  ));
  const centerY = (minY + maxY) / 2;
  // worldToScreen of centerY must equal canvasH/2:
  //   Y-down: centerY * zoom + panY = canvasH/2  → panY = canvasH/2 - centerY * zoom
  //   Y-up:  -centerY * zoom + panY = canvasH/2  → panY = canvasH/2 + centerY * zoom
  const panY = flipY
    ? canvasH / 2 + centerY * zoom
    : canvasH / 2 - centerY * zoom;
  return {
    zoom,
    panX: canvasW / 2 - ((minX + maxX) / 2) * zoom,
    panY,
    flipY,
  };
}
