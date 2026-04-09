export interface Camera {
  zoom: number;
  panX: number;
  panY: number;
}

export function worldToScreen(wx: number, wy: number, cam: Camera): [number, number] {
  return [wx * cam.zoom + cam.panX, wy * cam.zoom + cam.panY];
}

export function screenToWorld(sx: number, sy: number, cam: Camera): [number, number] {
  return [(sx - cam.panX) / cam.zoom, (sy - cam.panY) / cam.zoom];
}

/** Zoom in/out, keeping screen point (sx, sy) stationary. */
export function zoomAt(cam: Camera, sx: number, sy: number, factor: number): Camera {
  const [wx, wy] = screenToWorld(sx, sy, cam);
  const zoom = Math.min(200, Math.max(0.01, cam.zoom * factor));
  return { zoom, panX: sx - wx * zoom, panY: sy - wy * zoom };
}

/** Return a camera that centers and fits all given world points in the canvas. */
export function fitCamera(
  points: [number, number][],
  canvasW: number,
  canvasH: number,
  padding = 48,
): Camera {
  if (points.length === 0 || canvasW === 0 || canvasH === 0) {
    return { zoom: 1, panX: canvasW / 2, panY: canvasH / 2 };
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
  return {
    zoom,
    panX: canvasW / 2 - ((minX + maxX) / 2) * zoom,
    panY: canvasH / 2 - ((minY + maxY) / 2) * zoom,
  };
}
