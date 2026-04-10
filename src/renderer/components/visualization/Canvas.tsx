import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProgramStore, genId } from '../../store/program-store';
import { useUIStore } from '../../store/ui-store';
import { pointInPolygon, nearestPointOnEdge } from '@lib/polygon';
import { useCalibrationStore } from '../../store/calibration-store';
import type { PatternCommand, LineCommand, DotCommand } from '@lib/types';
import type { AffineTransform } from '@lib/affine';
import { computeAffine } from '@lib/affine';
import type { Camera } from './camera';
import { fitCamera, screenToWorld, worldToScreen, zoomAt } from './camera';
import { collectPoints, drawCommand, extractMarkFiducials, hitTest, valveColor } from './renderers';
import {
  computeHandles, drawHandles, hitTestHandle,
  deepCloneCommands, clearRawForModified, findCmdById,
} from './handles';
import type { Handle } from './handles';
import CalibrationOverlay from './Calibration';

// ── Canvas rendering ──────────────────────────────────────────────────────────

function drawUncalibratedImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cam: Camera) {
  const [sx, sy] = worldToScreen(0, 0, cam);
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.drawImage(img, sx, sy, img.width * cam.zoom, img.height * cam.zoom);
  ctx.restore();
}

function drawCalibratedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  t: AffineTransform,
  cam: Camera,
) {
  ctx.save();
  ctx.setTransform(
    cam.zoom * t.a,              // a
    cam.zoom * t.b,              // b
    -cam.zoom * t.b,             // c
    cam.zoom * t.a,              // d
    cam.zoom * t.tx + cam.panX,  // e
    cam.zoom * t.ty + cam.panY,  // f
  );
  ctx.globalAlpha = 0.6;
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/**
 * Draw calibration crosshairs.
 * `scales` stores world-unit radii — multiplied by cam.zoom to get screen pixels
 * so the symbol scales naturally with zoom (larger when zoomed in).
 */
const CALIB_HANDLE_OFFSET_PX = 8; // screen px beyond circle edge for scale handles
const CALIB_HANDLE_SIZE_PX   = 5;

function drawCalibPoints(
  ctx: CanvasRenderingContext2D,
  pixels: ([number, number] | null)[],
  cam: Camera,
  scales: number[],
  scalingIdx: number | null,
  activeIdx: number | null,
) {
  for (let i = 0; i < pixels.length; i++) {
    const pt = pixels[i];
    if (!pt) continue;
    const [sx, sy] = worldToScreen(pt[0], pt[1], cam);
    // World-space radius → screen pixels; clamp so it stays visible even when tiny
    const r = Math.max(6, (scales[i] ?? 10) * cam.zoom);
    const isActive = activeIdx === i;
    const isScaling = scalingIdx === i;

    ctx.save();
    ctx.strokeStyle = isActive ? '#86efac' : '#22c55e';
    ctx.lineWidth = isActive ? 2 : 1.5;

    // Circle
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Cross lines spanning the full diameter inside the circle
    ctx.beginPath();
    ctx.moveTo(sx - r, sy); ctx.lineTo(sx + r, sy);
    ctx.moveTo(sx, sy - r); ctx.lineTo(sx, sy + r);
    ctx.stroke();

    // Amber scale handles at cardinal points beyond the circle edge
    if (isScaling) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.5;
      const ho = r + CALIB_HANDLE_OFFSET_PX;
      const hs = CALIB_HANDLE_SIZE_PX;
      for (const [hx, hy] of [
        [sx + ho, sy], [sx - ho, sy],
        [sx, sy - ho], [sx, sy + ho],
      ]) {
        ctx.beginPath();
        ctx.rect(hx - hs, hy - hs, hs * 2, hs * 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}

// ── Area fill overlay ─────────────────────────────────────────────────────────

const POLY_COLOR       = '#06b6d4'; // cyan-500
const POLY_FILL_COLOR  = 'rgba(6, 182, 212, 0.12)';
const POLY_VERTEX_R    = 7;         // screen px radius for vertex handles

function drawAreaFillOverlay(
  ctx: CanvasRenderingContext2D,
  vertices: [number, number][],
  closed: boolean,
  cursorWorld: [number, number] | null,
  cam: Camera,
  activeVertexIdx: number | null,
) {
  if (vertices.length === 0) return;

  const sv = vertices.map(([wx, wy]) => worldToScreen(wx, wy, cam));

  ctx.save();

  if (closed) {
    // Semi-transparent fill
    ctx.beginPath();
    ctx.moveTo(sv[0][0], sv[0][1]);
    for (let i = 1; i < sv.length; i++) ctx.lineTo(sv[i][0], sv[i][1]);
    ctx.closePath();
    ctx.fillStyle = POLY_FILL_COLOR;
    ctx.fill();

    // Dashed outline
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = POLY_COLOR;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);

    // Vertex handles
    for (let i = 0; i < sv.length; i++) {
      const [sx, sy] = sv[i];
      const isActive = activeVertexIdx === i;
      ctx.beginPath();
      ctx.arc(sx, sy, POLY_VERTEX_R, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? '#ffffff' : POLY_COLOR;
      ctx.fill();
      ctx.strokeStyle = '#1e2433';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

  } else {
    // ── Drawing phase ────────────────────────────────────────────────────────

    // Placed edges
    if (sv.length >= 2) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = POLY_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sv[0][0], sv[0][1]);
      for (let i = 1; i < sv.length; i++) ctx.lineTo(sv[i][0], sv[i][1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Rubber-band + closure hint
    if (cursorWorld) {
      const [csx, csy] = worldToScreen(cursorWorld[0], cursorWorld[1], cam);
      const last = sv[sv.length - 1];

      // Line from last vertex to cursor
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = POLY_COLOR;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(last[0], last[1]);
      ctx.lineTo(csx, csy);
      ctx.stroke();

      // Dashed closure hint back to first vertex
      if (sv.length >= 2) {
        ctx.setLineDash([2, 6]);
        ctx.strokeStyle = POLY_COLOR;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.moveTo(csx, csy);
        ctx.lineTo(sv[0][0], sv[0][1]);
        ctx.stroke();
      }

      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Vertex handles
    for (let i = 0; i < sv.length; i++) {
      const [sx, sy] = sv[i];
      ctx.beginPath();
      ctx.arc(sx, sy, POLY_VERTEX_R, 0, Math.PI * 2);
      ctx.fillStyle = POLY_COLOR;
      ctx.fill();
      ctx.strokeStyle = '#1e2433';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Larger ring around first vertex (closure target indicator)
    if (sv.length >= 2) {
      ctx.beginPath();
      ctx.arc(sv[0][0], sv[0][1], POLY_VERTEX_R + 4, 0, Math.PI * 2);
      ctx.strokeStyle = POLY_COLOR;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  ctx.restore();
}

// ── Polygon hit testing ───────────────────────────────────────────────────────

/** Returns index of vertex within threshold screen-px, or -1. */
function hitTestPolyVertex(
  sx: number, sy: number,
  vertices: [number, number][],
  cam: Camera,
  threshold = POLY_VERTEX_R + 4,
): number {
  for (let i = 0; i < vertices.length; i++) {
    const [hsx, hsy] = worldToScreen(vertices[i][0], vertices[i][1], cam);
    if (Math.hypot(sx - hsx, sy - hsy) < threshold) return i;
  }
  return -1;
}

/**
 * Returns { edgeIdx, point } for the nearest edge within threshold, or null.
 * `edgeIdx` is the index of the start vertex of the edge.
 */
function hitTestPolyEdge(
  sx: number, sy: number,
  vertices: [number, number][],
  cam: Camera,
  threshold = 6,
): { edgeIdx: number; worldPt: [number, number] } | null {
  let best: { edgeIdx: number; worldPt: [number, number] } | null = null;
  let bestDist = threshold;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const [asx, asy] = worldToScreen(vertices[i][0], vertices[i][1], cam);
    const [bsx, bsy] = worldToScreen(vertices[j][0], vertices[j][1], cam);
    const res = nearestPointOnEdge([sx, sy], [asx, asy], [bsx, bsy]);
    if (res.distance < bestDist) {
      bestDist = res.distance;
      // Convert screen nearest-point back to world
      const [wx, wy] = [(res.point[0] - cam.panX) / cam.zoom, (res.point[1] - cam.panY) / cam.zoom];
      best = { edgeIdx: i, worldPt: [wx, wy] };
    }
  }
  return best;
}

/**
 * Expand selectedIds to include children of any selected Group so that the
 * children are rendered as highlighted when their parent group is selected.
 */
export function expandSelectedIds(
  commands: PatternCommand[],
  selectedIds: Set<string>,
): Set<string> {
  if (selectedIds.size === 0) return selectedIds;
  const expanded = new Set(selectedIds);
  function recurse(cmds: PatternCommand[]) {
    for (const cmd of cmds) {
      if (cmd.kind === 'Group' && cmd.id && selectedIds.has(cmd.id)) {
        for (const child of cmd.commands) {
          if (child.id) expanded.add(child.id);
        }
      } else if (cmd.kind === 'Group') {
        recurse(cmd.commands);
      }
    }
  }
  recurse(commands);
  return expanded;
}


function renderFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cam: Camera,
  commands: PatternCommand[],
  selectedIds: Set<string>,
  imgEl: HTMLImageElement | null,
  calibTransform: AffineTransform | null,
  isCalibrating: boolean,
  calibPixels: ([number, number] | null)[],
  calibScales: number[],
  scalingCalibIdx: number | null,
  activeCalibIdx: number | null,
  hiddenValves: Set<number>,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#374151';
  ctx.fillRect(0, 0, w, h);

  if (imgEl) {
    if (isCalibrating || !calibTransform) {
      drawUncalibratedImage(ctx, imgEl, cam);
    } else {
      drawCalibratedImage(ctx, imgEl, calibTransform, cam);
    }
  }

  if (!isCalibrating) {
    if (commands.length > 0) {
      const expandedIds = expandSelectedIds(commands, selectedIds);

      for (const cmd of commands) {
        drawCommand(ctx, cmd, cam, expandedIds, hiddenValves);
      }
    } else if (!imgEl) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No drawable commands in this block', w / 2, h / 2);
    }
  }

  if (isCalibrating && calibPixels.some((p) => p !== null)) {
    drawCalibPoints(ctx, calibPixels, cam, calibScales, scalingCalibIdx, activeCalibIdx);
  }
}

// ── Layers box ────────────────────────────────────────────────────────────────

interface LayersBoxProps {
  valves: Set<number>;
  hiddenValves: Set<number>;
  onToggleValve: (v: number) => void;
  hasImage: boolean;
  imageVisible: boolean;
  onToggleImage: () => void;
}

function LayersBox({ valves, hiddenValves, onToggleValve, hasImage, imageVisible, onToggleImage }: LayersBoxProps) {
  if (valves.size === 0 && !hasImage) return null;

  return (
    <div className="absolute top-2 left-2 bg-gray-900/85 border border-gray-700/60 rounded-md py-1.5 px-1 select-none z-10 min-w-[7rem]">
      <div className="text-[9px] font-semibold text-gray-500 uppercase tracking-widest px-1.5 pb-1">Layers</div>

      {hasImage && (
        <LayerRow
          label="Background"
          color="#9ca3af"
          visible={imageVisible}
          onToggle={onToggleImage}
        />
      )}

      {[...valves].sort((a, b) => a - b).map((v) => (
        <LayerRow
          key={v}
          label={`Param ${v}`}
          color={valveColor(v)}
          visible={!hiddenValves.has(v)}
          onToggle={() => onToggleValve(v)}
        />
      ))}
    </div>
  );
}

function LayerRow({ label, color, visible, onToggle }: { label: string; color: string; visible: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 w-full text-left rounded px-1.5 py-0.5 hover:bg-gray-700/50 transition-colors"
    >
      <div
        className="w-3 h-3 rounded-sm shrink-0 transition-colors"
        style={visible
          ? { backgroundColor: color }
          : { backgroundColor: 'transparent', border: `1.5px solid ${color}`, opacity: 0.4 }
        }
      />
      <span className={`text-xs transition-colors ${visible ? 'text-gray-200' : 'text-gray-500'}`}>
        {label}
      </span>
    </button>
  );
}

// ── Canvas ────────────────────────────────────────────────────────────────────

function getCommands(
  program: ReturnType<typeof useProgramStore.getState>['program'],
  patternName: string | null,
): PatternCommand[] {
  if (!program || patternName === null) return [];
  return program.patterns.find((p) => p.name === patternName)?.commands ?? [];
}

// ── Drag state type ───────────────────────────────────────────────────────────

interface InitialCoord {
  field: string;
  coords: [number, number, number];
}

interface DragState {
  handle: Handle;
  startMouseWx: number;
  startMouseWy: number;
  startHandleWx: number;
  startHandleWy: number;
  startHandleWz: number;
  draggedCmds: Map<string, import('@lib/types').LineCommand | import('@lib/types').DotCommand>;
  initialCoords: Map<string, InitialCoord>; // key = "cmdId:field"
}

// ── Coord display format (matches PatternCommandList) ─────────────────────────

function fmtCoord(p: [number, number, number]): string {
  return `(${p[0].toFixed(3)}, ${p[1].toFixed(3)}, ${p[2].toFixed(3)})`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const cameraRef    = useRef<Camera>({ zoom: 1, panX: 0, panY: 0 });
  const drawRef      = useRef<() => void>(() => {});
  const tooltipRef   = useRef<HTMLDivElement>(null);

  // Drag-related refs (no React state — never trigger re-renders during drag)
  const isDraggingRef        = useRef(false);
  const dragStateRef         = useRef<DragState | null>(null);
  const dragWorkingCmdsRef   = useRef<PatternCommand[] | null>(null);
  const dragCleanupRef       = useRef<(() => void) | null>(null);

  // Stable mirrors of React state for use inside callbacks attached to window
  const commandsRef          = useRef<PatternCommand[]>([]);
  const selectedCommandIdsRef= useRef<Set<string>>(new Set());

  // ── Store subscriptions ───────────────────────────────────────────────────

  const program              = useProgramStore((s) => s.program);
  const selectedPatternName  = useProgramStore((s) => s.selectedPatternName);
  const selectedCommandIds   = useProgramStore((s) => s.selectedCommandIds);
  const lastSelectedId       = useProgramStore((s) => s.lastSelectedId);
  const selectOne            = useProgramStore((s) => s.selectOne);
  const selectToggle         = useProgramStore((s) => s.selectToggle);
  const selectRange          = useProgramStore((s) => s.selectRange);
  const clearSelection       = useProgramStore((s) => s.clearSelection);
  const setProgram           = useProgramStore((s) => s.setProgram);
  const filePath             = useProgramStore((s) => s.filePath);

  const setZoomLevel       = useUIStore((s) => s.setZoomLevel);
  const setCursorCoords    = useUIStore((s) => s.setCursorCoords);
  const backgroundImages   = useUIStore((s) => s.backgroundImages);
  const setBackgroundImage = useUIStore((s) => s.setBackgroundImage);
  const activeTool         = useUIStore((s) => s.activeTool);
  const setActiveTool      = useUIStore((s) => s.setActiveTool);

  // Per-pattern image: key = `${filePath}::${patternName}` so each subpattern is independent
  const patternKey = filePath !== null && selectedPatternName !== null
    ? `${filePath}::${selectedPatternName}`
    : null;
  const backgroundImage = useMemo(
    () => (patternKey ? (backgroundImages[patternKey] ?? null) : null),
    [backgroundImages, patternKey],
  );

  const insertAfterSelection = useProgramStore((s) => s.insertAfterSelection);

  // Placement mode refs (must be after activeTool declaration)
  const placementLineStartRef = useRef<[number, number, number] | null>(null);
  const [placementPhase, setPlacementPhase] = useState<'line-start' | 'line-end' | 'dot' | null>(null);
  const placementPhaseRef = useRef(placementPhase);
  useEffect(() => { placementPhaseRef.current = placementPhase; }, [placementPhase]);
  const activeToolRef = useRef(activeTool);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  // ── Area fill state ────────────────────────────────────────────────────────
  const areaFillPolygon        = useUIStore((s) => s.areaFillPolygon);
  const areaFillClosed         = useUIStore((s) => s.areaFillClosed);
  const areaFillPreviewCmds    = useUIStore((s) => s.areaFillPreviewCmds);
  const setAreaFillPolygon     = useUIStore((s) => s.setAreaFillPolygon);
  const setAreaFillClosed      = useUIStore((s) => s.setAreaFillClosed);
  const clearAreaFill          = useUIStore((s) => s.clearAreaFill);

  // Stable refs for use inside window-level callbacks
  const areaFillPolygonRef      = useRef(areaFillPolygon);
  const areaFillClosedRef       = useRef(areaFillClosed);
  const areaFillPreviewCmdsRef  = useRef(areaFillPreviewCmds);
  useEffect(() => { areaFillPolygonRef.current = areaFillPolygon; }, [areaFillPolygon]);
  useEffect(() => { areaFillClosedRef.current = areaFillClosed; }, [areaFillClosed]);
  useEffect(() => { areaFillPreviewCmdsRef.current = areaFillPreviewCmds; }, [areaFillPreviewCmds]);

  // Cursor world position for rubber-band (ref only — no React state)
  const polygonCursorRef = useRef<[number, number] | null>(null);

  // Active vertex index while dragging/hovering (only for editing mode)
  const [polyActiveVertIdx, setPolyActiveVertIdx] = useState<number | null>(null);
  const polyActiveVertIdxRef = useRef<number | null>(null);
  useEffect(() => { polyActiveVertIdxRef.current = polyActiveVertIdx; }, [polyActiveVertIdx]);

  // Area fill drag state (vertex drag or whole-polygon move)
  interface PolyDragState {
    type: 'vertex' | 'polygon';
    vertexIdx?: number;
    startMouseWx: number;
    startMouseWy: number;
    startVerts: [number, number][];
  }
  const polyDragRef = useRef<PolyDragState | null>(null);
  const polyDragCleanupRef = useRef<(() => void) | null>(null);

  // Sync placementPhase with activeTool
  useEffect(() => {
    if (activeTool === 'new-line') { setPlacementPhase('line-start'); placementLineStartRef.current = null; }
    else if (activeTool === 'new-dot') { setPlacementPhase('dot'); }
    else { setPlacementPhase(null); placementLineStartRef.current = null; }
  }, [activeTool]);

  const getCalibration      = useCalibrationStore((s) => s.getCalibration);
  const setCalibrationData  = useCalibrationStore((s) => s.setCalibration);
  const clearCalibrationData= useCalibrationStore((s) => s.clearCalibration);

  // ── Derived state ─────────────────────────────────────────────────────────

  const commands = useMemo(
    () => getCommands(program, selectedPatternName),
    [program, selectedPatternName],
  );

  // Keep stable refs in sync
  useEffect(() => { commandsRef.current = commands; }, [commands]);
  useEffect(() => { selectedCommandIdsRef.current = selectedCommandIds; }, [selectedCommandIds]);

  const fiducials  = useMemo(() => extractMarkFiducials(commands), [commands]);

  const usedValves = useMemo(() => {
    const s = new Set<number>();
    for (const c of commands) if (c.kind === 'Line' || c.kind === 'Dot') s.add(c.valve);
    return s;
  }, [commands]);

  const calibration = patternKey ? getCalibration(patternKey) : null;

  // ── Layer visibility ──────────────────────────────────────────────────────

  const [hiddenValves, setHiddenValves]   = useState<Set<number>>(new Set());
  const [bgImageVisible, setBgImageVisible] = useState(true);

  const toggleValve = (v: number) =>
    setHiddenValves((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });

  // ── Background image element ──────────────────────────────────────────────

  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);

  // ── Calibration state ─────────────────────────────────────────────────────

  const [isCalibrating, setIsCalibrating]     = useState(false);
  const [calibPixels, setCalibPixels]         = useState<([number, number] | null)[]>([]);
  const [activeCalibIdx, setActiveCalibIdx]   = useState<number | null>(null);
  const [calibScales, setCalibScales]         = useState<number[]>([]);
  const [scalingCalibIdx, setScalingCalibIdx] = useState<number | null>(null);

  // Stable refs for use inside window-level mouse callbacks
  const isCalibRef         = useRef(false);
  const calibPixelsRef     = useRef<([number, number] | null)[]>([]);
  const activeCalibIdxRef  = useRef<number | null>(null);
  const calibScalesRef     = useRef<number[]>([]);
  const scalingCalibIdxRef = useRef<number | null>(null);
  const fiducialsRef       = useRef(fiducials);
  const patternKeyRef      = useRef(patternKey);

  useEffect(() => { isCalibRef.current = isCalibrating; }, [isCalibrating]);
  useEffect(() => { calibPixelsRef.current = calibPixels; }, [calibPixels]);
  useEffect(() => { activeCalibIdxRef.current = activeCalibIdx; }, [activeCalibIdx]);
  useEffect(() => { calibScalesRef.current = calibScales; }, [calibScales]);
  useEffect(() => { scalingCalibIdxRef.current = scalingCalibIdx; }, [scalingCalibIdx]);
  useEffect(() => { fiducialsRef.current = fiducials; }, [fiducials]);
  useEffect(() => { patternKeyRef.current = patternKey; }, [patternKey]);

  useEffect(() => {
    if (!backgroundImage) { setImgEl(null); return; }
    const img = new Image();
    img.onload = () => {
      setImgEl(img);
      // Use the pattern key (captured at load time) to check for existing calibration
      const key = patternKeyRef.current;
      const hasCalib = key && getCalibration(key)?.transform;
      if (!hasCalib) {
        const fids = fiducialsRef.current;
        setIsCalibrating(true);
        setCalibPixels(new Array(fids.length).fill(null));
        setActiveCalibIdx(fids.length > 0 ? 0 : null);
        setCalibScales(new Array(fids.length).fill(10));
        setScalingCalibIdx(null);
        const canvas = canvasRef.current;
        if (canvas && canvas.width > 0) {
          cameraRef.current = fitCamera([[0, 0], [img.width, img.height]], canvas.width, canvas.height);
          setZoomLevel(cameraRef.current.zoom);
        }
      }
    };
    img.src = backgroundImage.dataUrl;
  // Depend on the whole object — a new object is created each time setBackgroundImage is
  // called, so the same file loaded again will still re-trigger calibration.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundImage]);

  const handleCalibComplete = useCallback(async () => {
    const key = patternKey;
    if (!key) return;
    const pairs = calibPixels
      .map((px, i) => (px !== null ? { imagePixel: px, programCoord: fiducials[i].coord } : null))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    if (pairs.length < 2) return;
    const transform = computeAffine(pairs);
    await setCalibrationData(key, { points: pairs, transform });
    setIsCalibrating(false);
    setCalibPixels([]);
    setActiveCalibIdx(null);
    setCalibScales([]);
    setScalingCalibIdx(null);
  }, [calibPixels, fiducials, patternKey, setCalibrationData]);

  const handleCalibCancel = useCallback(() => {
    setIsCalibrating(false);
    setCalibPixels([]);
    setActiveCalibIdx(null);
    setCalibScales([]);
    setScalingCalibIdx(null);
    // Remove the image entirely so the pattern returns to a clean state
    if (patternKey) setBackgroundImage(patternKey, null);
    setImgEl(null);
  }, [patternKey, setBackgroundImage]);

  const handleRecalibrate = useCallback(() => {
    const key = patternKey;
    if (!key) return;
    clearCalibrationData(key);
    const fids = fiducialsRef.current;
    setCalibPixels(new Array(fids.length).fill(null));
    setActiveCalibIdx(fids.length > 0 ? 0 : null);
    setCalibScales(new Array(fids.length).fill(10));
    setScalingCalibIdx(null);
    setIsCalibrating(true);
    if (imgEl) {
      const canvas = canvasRef.current;
      if (canvas && canvas.width > 0) {
        cameraRef.current = fitCamera([[0, 0], [imgEl.width, imgEl.height]], canvas.width, canvas.height);
        setZoomLevel(cameraRef.current.zoom);
      }
    }
  }, [patternKey, clearCalibrationData, imgEl, setZoomLevel]);

  // ── Pan to single selected command if off-screen ──────────────────────────

  useEffect(() => {
    if (selectedCommandIds.size !== 1 || isCalibrating) return;
    const [id] = selectedCommandIds;
    function findById(cmds: PatternCommand[]): PatternCommand | null {
      for (const c of cmds) {
        if (c.id === id) return c;
        if (c.kind === 'Group') { const f = findById(c.commands); if (f) return f; }
      }
      return null;
    }
    const cmd = findById(commands);
    if (!cmd) return;
    let wx: number, wy: number;
    if (cmd.kind === 'Line') {
      wx = (cmd.startPoint[0] + cmd.endPoint[0]) / 2;
      wy = (cmd.startPoint[1] + cmd.endPoint[1]) / 2;
    } else if (cmd.kind === 'Dot') {
      wx = cmd.point[0]; wy = cmd.point[1];
    } else return;

    const canvas = canvasRef.current;
    if (!canvas || canvas.width === 0) return;
    const [sx, sy] = worldToScreen(wx, wy, cameraRef.current);
    const margin = 40;
    if (sx < margin || sx > canvas.width - margin || sy < margin || sy > canvas.height - margin) {
      const z = cameraRef.current.zoom;
      cameraRef.current = { ...cameraRef.current, panX: canvas.width / 2 - wx * z, panY: canvas.height / 2 - wy * z };
      requestAnimationFrame(drawRef.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCommandIds]);

  // ── Draw loop ─────────────────────────────────────────────────────────────

  useEffect(() => {
    drawRef.current = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // During drag use the working copy so React state isn't touched
      const cmdsToRender =
        isDraggingRef.current && dragWorkingCmdsRef.current !== null
          ? dragWorkingCmdsRef.current
          : commands;

      renderFrame(
        ctx, canvas.width, canvas.height, cameraRef.current,
        cmdsToRender, selectedCommandIds,
        bgImageVisible ? imgEl : null,
        calibration?.transform ?? null, isCalibrating, calibPixels,
        calibScales, scalingCalibIdx, activeCalibIdx,
        hiddenValves,
      );

      // Draw handles on top of the toolpath
      if (!isCalibrating && selectedCommandIds.size > 0) {
        const expandedIds = expandSelectedIds(cmdsToRender, selectedCommandIds);
        if (expandedIds.size > 0) {
          const handles = computeHandles(cmdsToRender, expandedIds);
          if (handles.length > 0) drawHandles(ctx, handles, cameraRef.current);
        }
      }

      // Draw area fill polygon overlay (always on top)
      if (activeToolRef.current === 'area-fill') {
        // Live preview commands (semi-transparent)
        const previewCmds = areaFillPreviewCmdsRef.current;
        if (previewCmds.length > 0) {
          ctx.save();
          ctx.globalAlpha = 0.45;
          const noSelection = new Set<string>();
          for (const cmd of previewCmds) {
            drawCommand(ctx, cmd, cameraRef.current, noSelection);
          }
          ctx.restore();
        }

        drawAreaFillOverlay(
          ctx,
          areaFillPolygonRef.current,
          areaFillClosedRef.current,
          areaFillClosedRef.current ? null : polygonCursorRef.current,
          cameraRef.current,
          polyActiveVertIdxRef.current,
        );
      }
    };
    requestAnimationFrame(drawRef.current);
  }, [commands, selectedCommandIds, imgEl, bgImageVisible, hiddenValves, calibration, isCalibrating, calibPixels, calibScales, scalingCalibIdx, activeCalibIdx, areaFillPolygon, areaFillClosed, polyActiveVertIdx, areaFillPreviewCmds]);

  // Fit to view only when the selected pattern or file changes — not on every edit
  const fittedRef = useRef(false);
  useEffect(() => { fittedRef.current = false; }, [selectedPatternName, filePath]);

  // Cancel any in-progress calibration when switching patterns
  useEffect(() => {
    setIsCalibrating(false);
    setCalibPixels([]);
    setActiveCalibIdx(null);
    setCalibScales([]);
    setScalingCalibIdx(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatternName, filePath]);

  useEffect(() => {
    if (isCalibrating) return;
    const canvas = canvasRef.current;
    if (!canvas || canvas.width === 0) return;
    const pts = collectPoints(commands);
    if (pts.length > 0) {
      cameraRef.current = fitCamera(pts, canvas.width, canvas.height);
      setZoomLevel(cameraRef.current.zoom);
      fittedRef.current = true;
    }
    requestAnimationFrame(drawRef.current);
  // `commands` is intentionally read but not listed as a dep: we fit on pattern/file
  // switch only, not on every drag commit or toolbar edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatternName, filePath, isCalibrating, setZoomLevel]);

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver(([entry]) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { width, height } = entry.contentRect;
      canvas.width = Math.floor(width);
      canvas.height = Math.floor(height);
      if (!fittedRef.current) {
        const pts = isCalibrating && imgEl
          ? [[0, 0], [imgEl.width, imgEl.height]] as [number, number][]
          : collectPoints(commands);
        if (pts.length > 0) {
          cameraRef.current = fitCamera(pts, canvas.width, canvas.height);
          setZoomLevel(cameraRef.current.zoom);
          fittedRef.current = true;
        }
      }
      requestAnimationFrame(drawRef.current);
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, [commands, isCalibrating, imgEl, setZoomLevel]);

  // Cleanup any in-progress drag on unmount
  useEffect(() => {
    return () => {
      if (dragCleanupRef.current) dragCleanupRef.current();
    };
  }, []);

  // ── Interaction ───────────────────────────────────────────────────────────

  const isPanning    = useRef(false);
  const lastMouse    = useRef({ x: 0, y: 0 });
  const spaceHeld    = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeToolRef.current) {
        if (activeToolRef.current === 'area-fill') clearAreaFill();
        setActiveTool(null);
        return;
      }
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        spaceHeld.current = true;
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld.current = false;
        isPanning.current = false;
        if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [setActiveTool]);

  // Wheel zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      cameraRef.current = zoomAt(cameraRef.current, e.clientX - rect.left, e.clientY - rect.top, factor);
      setZoomLevel(cameraRef.current.zoom);
      requestAnimationFrame(drawRef.current);
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, [setZoomLevel]);

  // ── Calibration scale drag ────────────────────────────────────────────────

  const calibScaleDragRef = useRef<{ idx: number; centerSx: number; centerSy: number } | null>(null);

  const startCalibScaleDrag = useCallback((
    idx: number, centerSx: number, centerSy: number,
  ) => {
    calibScaleDragRef.current = { idx, centerSx, centerSy };

    const handleMove = (e: MouseEvent) => {
      if (!calibScaleDragRef.current || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { centerSx: csx, centerSy: csy } = calibScaleDragRef.current;
      const distPx = Math.max(6, Math.hypot(sx - csx, sy - csy));
      // distPx / zoom converts screen pixels back to world units, matching drawCalibPoints
      const newScale = Math.max(1, distPx / cameraRef.current.zoom);
      setCalibScales((prev) => {
        const next = [...prev];
        next[calibScaleDragRef.current!.idx] = newScale;
        return next;
      });
      requestAnimationFrame(drawRef.current);
    };

    const handleUp = () => {
      calibScaleDragRef.current = null;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, []);

  // ── Area fill polygon drag helper ─────────────────────────────────────────

  const startPolyDrag = useCallback((
    type: 'vertex' | 'polygon',
    startSx: number,
    startSy: number,
    vertexIdx?: number,
  ) => {
    const [startWx, startWy] = screenToWorld(startSx, startSy, cameraRef.current);
    polyDragRef.current = {
      type,
      vertexIdx,
      startMouseWx: startWx,
      startMouseWy: startWy,
      startVerts: areaFillPolygonRef.current.map((v): [number, number] => [...v]),
    };
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';

    const handleMove = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || !polyDragRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const [wx, wy] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, cameraRef.current);
      const ds = polyDragRef.current;
      const dx = wx - ds.startMouseWx;
      const dy = wy - ds.startMouseWy;

      let newVerts: [number, number][];
      if (ds.type === 'vertex' && ds.vertexIdx !== undefined) {
        newVerts = ds.startVerts.map((v, i): [number, number] =>
          i === ds.vertexIdx ? [v[0] + dx, v[1] + dy] : [...v],
        );
      } else {
        newVerts = ds.startVerts.map(([x, y]): [number, number] => [x + dx, y + dy]);
      }
      setAreaFillPolygon(newVerts);
      requestAnimationFrame(drawRef.current);
    };

    const handleUp = () => {
      polyDragRef.current = null;
      if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      polyDragCleanupRef.current = null;
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    polyDragCleanupRef.current = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [setAreaFillPolygon]);

  // ── Command handle drag helper ────────────────────────────────────────────

  const startHandleDrag = useCallback((
    hitHandle: Handle,
    startSx: number,
    startSy: number,
  ) => {
    const cmds = commandsRef.current;
    const workingCopy = deepCloneCommands(cmds);
    dragWorkingCmdsRef.current = workingCopy;
    isDraggingRef.current = true;

    // Build maps for targets
    const draggedCmds = new Map<string, import('@lib/types').LineCommand | import('@lib/types').DotCommand>();
    const initialCoords = new Map<string, InitialCoord>();

    for (const target of hitHandle.targets) {
      const found = findCmdById(workingCopy, target.cmdId);
      if (!found || (found.kind !== 'Line' && found.kind !== 'Dot')) continue;
      const cmd = found as import('@lib/types').LineCommand | import('@lib/types').DotCommand;
      draggedCmds.set(target.cmdId, cmd);

      const raw =
        target.field === 'startPoint' ? (cmd as import('@lib/types').LineCommand).startPoint :
        target.field === 'endPoint'   ? (cmd as import('@lib/types').LineCommand).endPoint :
                                        (cmd as import('@lib/types').DotCommand).point;
      initialCoords.set(`${target.cmdId}:${target.field}`, {
        field: target.field,
        coords: [raw[0], raw[1], raw[2]],
      });
    }

    const [startWx, startWy] = screenToWorld(startSx, startSy, cameraRef.current);

    dragStateRef.current = {
      handle: hitHandle,
      startMouseWx: startWx,
      startMouseWy: startWy,
      startHandleWx: hitHandle.wx,
      startHandleWy: hitHandle.wy,
      startHandleWz: hitHandle.wz,
      draggedCmds,
      initialCoords,
    };

    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';

    // ── Window-level drag handlers ──────────────────────────────────────────

    const handleDragMove = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || !dragStateRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const [wx, wy] = screenToWorld(sx, sy, cameraRef.current);
      const ds = dragStateRef.current;
      const dx = wx - ds.startMouseWx;
      const dy = wy - ds.startMouseWy;

      // Apply delta to each target using its recorded initial position
      for (const target of ds.handle.targets) {
        const key = `${target.cmdId}:${target.field}`;
        const init = ds.initialCoords.get(key);
        if (!init) continue;
        const cmd = ds.draggedCmds.get(target.cmdId);
        if (!cmd) continue;

        const newX = init.coords[0] + dx;
        const newY = init.coords[1] + dy;

        if (target.field === 'startPoint' && cmd.kind === 'Line') {
          (cmd.startPoint as number[])[0] = newX;
          (cmd.startPoint as number[])[1] = newY;
        } else if (target.field === 'endPoint' && cmd.kind === 'Line') {
          (cmd.endPoint as number[])[0] = newX;
          (cmd.endPoint as number[])[1] = newY;
        } else if (target.field === 'point' && cmd.kind === 'Dot') {
          (cmd.point as number[])[0] = newX;
          (cmd.point as number[])[1] = newY;
        }

        // Right-pane DOM update (no React re-render)
        const coordAttr =
          target.field === 'startPoint' ? `start:${target.cmdId}` :
          target.field === 'endPoint'   ? `end:${target.cmdId}`   :
                                          `dot:${target.cmdId}`;
        const el = document.querySelector<HTMLElement>(`[data-coord="${coordAttr}"]`);
        if (el) {
          const p =
            target.field === 'startPoint' ? (cmd as import('@lib/types').LineCommand).startPoint :
            target.field === 'endPoint'   ? (cmd as import('@lib/types').LineCommand).endPoint   :
                                            (cmd as import('@lib/types').DotCommand).point;
          el.textContent = fmtCoord(p as [number, number, number]);
        }
      }

      // Tooltip
      if (tooltipRef.current) {
        tooltipRef.current.style.display = 'block';
        tooltipRef.current.style.left = `${sx + 14}px`;
        tooltipRef.current.style.top  = `${sy - 28}px`;
        const newHx = ds.startHandleWx + dx;
        const newHy = ds.startHandleWy + dy;
        tooltipRef.current.textContent = `${newHx.toFixed(3)}, ${newHy.toFixed(3)}`;
      }

      requestAnimationFrame(drawRef.current);
    };

    const handleDragUp = () => {
      isDraggingRef.current = false;

      // Commit: clear _raw then push to store history
      const wc = dragWorkingCmdsRef.current;
      const ds = dragStateRef.current;
      if (wc && ds) {
        const modifiedIds = new Set<string>(ds.draggedCmds.keys());
        clearRawForModified(wc, modifiedIds);

        const { program: prog, selectedPatternName: patName } = useProgramStore.getState();
        if (prog && patName) {
          const newProgram = {
            ...prog,
            patterns: prog.patterns.map((p) =>
              p.name === patName ? { ...p, commands: wc } : p,
            ),
          };
          // Compute a descriptive label from the drag state
          const role = ds.handle.role;
          const dragLabel =
            role === 'junction' ? 'Move shared junction' :
            role === 'dot'      ? 'Move dot'             :
                                  'Move line endpoint';
          setProgram(newProgram, dragLabel);
        }
      }

      dragStateRef.current      = null;
      dragWorkingCmdsRef.current= null;

      if (tooltipRef.current) tooltipRef.current.style.display = 'none';
      if (canvasRef.current)  canvasRef.current.style.cursor = 'crosshair';

      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup',   handleDragUp);
      dragCleanupRef.current = null;
    };

    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup',   handleDragUp);
    dragCleanupRef.current = () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup',   handleDragUp);
    };
  }, [setProgram]);

  // ── Mouse down ────────────────────────────────────────────────────────────

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      const startPan = () => {
        isPanning.current = true;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
      };

      if (e.button === 1) { e.preventDefault(); startPan(); return; }
      if (e.button === 0 && spaceHeld.current) { startPan(); return; }

      if (e.button === 0) {
        if (isCalibrating) {
          const cam = cameraRef.current;

          // 1. Scale handle hit (only when a crosshair is in scaling mode)
          const scIdx = scalingCalibIdx;
          if (scIdx !== null && calibPixels[scIdx] != null) {
            const [csx, csy] = worldToScreen(calibPixels[scIdx]![0], calibPixels[scIdx]![1], cam);
            const r = Math.max(6, (calibScales[scIdx] ?? 10) * cam.zoom);
            const ho = r + CALIB_HANDLE_OFFSET_PX;
            const scaleHandles: [number, number][] = [
              [csx + ho, csy], [csx - ho, csy],
              [csx, csy - ho], [csx, csy + ho],
            ];
            for (const [hsx, hsy] of scaleHandles) {
              if (Math.hypot(sx - hsx, sy - hsy) < 12) {
                startCalibScaleDrag(scIdx, csx, csy);
                return;
              }
            }
          }

          // 2. Click near a placed crosshair → activate that fiducial
          for (let i = 0; i < calibPixels.length; i++) {
            const pt = calibPixels[i];
            if (!pt) continue;
            const [csx, csy] = worldToScreen(pt[0], pt[1], cam);
            const r = Math.max(6, (calibScales[i] ?? 10) * cam.zoom);
            if (Math.hypot(sx - csx, sy - csy) < r + 8) {
              setActiveCalibIdx(i);
              setScalingCalibIdx(null);
              return;
            }
          }

          // 3. Place pixel coordinate for the active fiducial
          if (activeCalibIdx !== null) {
            const [px, py] = screenToWorld(sx, sy, cam);
            if (!imgEl || (px >= 0 && py >= 0 && px <= imgEl.width && py <= imgEl.height)) {
              const newPixels = [...calibPixels];
              newPixels[activeCalibIdx] = [px, py];
              setCalibPixels(newPixels);

              // Auto-advance to next unplaced fiducial
              let next: number | null = null;
              for (let i = 1; i < newPixels.length; i++) {
                const idx = (activeCalibIdx + i) % newPixels.length;
                if (newPixels[idx] === null) { next = idx; break; }
              }
              if (next !== null) setActiveCalibIdx(next);
            }
          }
          return;
        }

        // ── Area fill polygon interaction ─────────────────────────────────
        if (activeToolRef.current === 'area-fill') {
          const verts = areaFillPolygonRef.current;
          const closed = areaFillClosedRef.current;

          if (closed) {
            // ── Editing mode ───────────────────────────────────────────────

            // 1. Vertex handle hit
            const vIdx = hitTestPolyVertex(sx, sy, verts, cameraRef.current);
            if (vIdx !== -1) {
              startPolyDrag('vertex', sx, sy, vIdx);
              return;
            }

            // 2. Edge click — insert new vertex
            const edgeHit = hitTestPolyEdge(sx, sy, verts, cameraRef.current);
            if (edgeHit) {
              const newVerts = [...verts];
              newVerts.splice(edgeHit.edgeIdx + 1, 0, edgeHit.worldPt);
              setAreaFillPolygon(newVerts);
              // Immediately start dragging the new vertex
              startPolyDrag('vertex', sx, sy, edgeHit.edgeIdx + 1);
              return;
            }

            // 3. Interior — move whole polygon
            const [wx, wy] = screenToWorld(sx, sy, cameraRef.current);
            if (pointInPolygon([wx, wy], verts)) {
              startPolyDrag('polygon', sx, sy);
              return;
            }
          } else {
            // ── Drawing mode — place vertex ────────────────────────────────
            const [wx, wy] = screenToWorld(sx, sy, cameraRef.current);
            setAreaFillPolygon([...verts, [wx, wy]]);
          }
          return;
        }

        // ── Placement mode ────────────────────────────────────────────────
        if (activeToolRef.current) {
          const [wx, wy] = screenToWorld(sx, sy, cameraRef.current);
          const phase = placementPhaseRef.current;

          if (activeToolRef.current === 'new-dot') {
            const newCmd: DotCommand = {
              kind: 'Dot', id: genId(),
              valve: 1, point: [wx, wy, 0],
              disabled: false, valveState: 'ValveOn',
            };
            insertAfterSelection(newCmd, 'Create dot');
            setActiveTool(null);
            return;
          }

          if (activeToolRef.current === 'new-line') {
            if (phase === 'line-start') {
              placementLineStartRef.current = [wx, wy, 0];
              setPlacementPhase('line-end');
            } else if (phase === 'line-end' && placementLineStartRef.current) {
              const newCmd: LineCommand = {
                kind: 'Line', id: genId(),
                valve: 1,
                startPoint: placementLineStartRef.current,
                endPoint: [wx, wy, 0],
                disabled: false,
                flowRate: { value: 0.5, unit: 'mg/mm' },
              };
              insertAfterSelection(newCmd, 'Create line');
              setActiveTool(null);
            }
            return;
          }
        }

        // ── Handle hit check (before selection logic) ─────────────────────
        if (selectedCommandIds.size > 0) {
          const expandedIds = expandSelectedIds(commands, selectedCommandIds);
          if (expandedIds.size > 0) {
            const handles = computeHandles(commands, expandedIds);
            const hitHandle = hitTestHandle(sx, sy, handles, cameraRef.current);
            if (hitHandle) {
              startHandleDrag(hitHandle, sx, sy);
              return; // don't touch selection
            }
          }
        }

        // ── Regular click-to-select ───────────────────────────────────────
        const hitIdx = hitTest(sx, sy, commands, cameraRef.current);
        if (hitIdx === null) {
          clearSelection();
        } else {
          const hitCmd = commands[hitIdx];
          const hitId  = hitCmd.id;
          if (!hitId) { clearSelection(); return; }
          if (e.ctrlKey || e.metaKey) {
            selectToggle(hitId);
          } else if (e.shiftKey) {
            const allIds = commands
              .map((c) => c.id)
              .filter((id): id is string => Boolean(id));
            selectRange(hitId, allIds);
          } else {
            selectOne(hitId);
          }
        }
      }
    },
    [
      isCalibrating, calibPixels, calibScales, scalingCalibIdx, activeCalibIdx,
      commands, selectedCommandIds,
      selectOne, selectToggle, selectRange, clearSelection,
      imgEl, startHandleDrag, startCalibScaleDrag,
      insertAfterSelection, setActiveTool, placementPhase,
      setAreaFillPolygon, startPolyDrag,
    ],
  );

  // ── Mouse move ────────────────────────────────────────────────────────────

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const [wx, wy] = screenToWorld(sx, sy, cameraRef.current);
      setCursorCoords({ x: wx, y: wy });

      if (isPanning.current) {
        const dx = e.clientX - lastMouse.current.x;
        const dy = e.clientY - lastMouse.current.y;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        cameraRef.current = {
          ...cameraRef.current,
          panX: cameraRef.current.panX + dx,
          panY: cameraRef.current.panY + dy,
        };
        requestAnimationFrame(drawRef.current);
        return;
      }

      // ── Area fill hover / rubber-band ──────────────────────────────────
      if (activeToolRef.current === 'area-fill') {
        polygonCursorRef.current = [wx, wy];
        const verts = areaFillPolygonRef.current;
        const closed = areaFillClosedRef.current;

        if (closed && canvasRef.current) {
          // Cursor feedback for editing mode
          const vIdx = hitTestPolyVertex(sx, sy, verts, cameraRef.current);
          if (vIdx !== -1) {
            canvasRef.current.style.cursor = 'grab';
            setPolyActiveVertIdx(vIdx);
          } else {
            const edgeHit = hitTestPolyEdge(sx, sy, verts, cameraRef.current);
            if (edgeHit) {
              canvasRef.current.style.cursor = 'copy';
              setPolyActiveVertIdx(null);
            } else if (pointInPolygon([wx, wy], verts)) {
              canvasRef.current.style.cursor = 'move';
              setPolyActiveVertIdx(null);
            } else {
              canvasRef.current.style.cursor = 'crosshair';
              setPolyActiveVertIdx(null);
            }
          }
        }

        requestAnimationFrame(drawRef.current);
        return;
      }

      // Change cursor when hovering over a handle
      if (!isDraggingRef.current && !isCalibrating && selectedCommandIdsRef.current.size > 0) {
        const cmds = commandsRef.current;
        const expIds = expandSelectedIds(cmds, selectedCommandIdsRef.current);
        if (expIds.size > 0) {
          const handles = computeHandles(cmds, expIds);
          const onHandle = hitTestHandle(sx, sy, handles, cameraRef.current) !== null;
          if (canvasRef.current) {
            canvasRef.current.style.cursor = onHandle ? 'grab' : 'crosshair';
          }
        }
      }
    },
    [setCursorCoords, isCalibrating, setPolyActiveVertIdx],
  );

  // ── Mouse up ──────────────────────────────────────────────────────────────

  const onMouseUp = useCallback(() => {
    if (isPanning.current) {
      isPanning.current = false;
      if (canvasRef.current) {
        canvasRef.current.style.cursor = spaceHeld.current ? 'grab' : 'crosshair';
      }
    }
    // Drag commits via the window-level handleDragUp — nothing extra needed here
  }, []);

  const onMouseLeave = useCallback(() => {
    setCursorCoords(null);
    isPanning.current = false;
    polygonCursorRef.current = null;
    requestAnimationFrame(drawRef.current);
  }, [setCursorCoords]);

  const onDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ── Area fill: close polygon ──────────────────────────────────────────
    if (activeToolRef.current === 'area-fill' && !areaFillClosedRef.current) {
      // The second click of the double-click already placed a vertex via
      // onMouseDown. Remove that last vertex then close if ≥ 3 remain.
      const verts = areaFillPolygonRef.current;
      const trimmed = verts.slice(0, -1);
      if (trimmed.length >= 3) {
        setAreaFillPolygon(trimmed);
        setAreaFillClosed(true);
      }
      return;
    }

    if (isCalibrating) {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      // Toggle scale handles for the crosshair nearest to the double-click
      for (let i = 0; i < calibPixels.length; i++) {
        const pt = calibPixels[i];
        if (!pt) continue;
        const [csx, csy] = worldToScreen(pt[0], pt[1], cameraRef.current);
        const r = Math.max(6, (calibScalesRef.current[i] ?? 10) * cameraRef.current.zoom);
        if (Math.hypot(sx - csx, sy - csy) < r + 10) {
          setScalingCalibIdx((prev) => (prev === i ? null : i));
          return;
        }
      }
      return;
    }
  }, [isCalibrating, calibPixels, setAreaFillPolygon, setAreaFillClosed]);

  // ── Drag-drop (file / image) ──────────────────────────────────────────────

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext !== 'bmp' && ext !== 'png') return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const fp = (file as File & { path?: string }).path ?? file.name;
        if (patternKey) setBackgroundImage(patternKey, { filePath: fp, dataUrl });
      };
      reader.readAsDataURL(file);
    },
    [setBackgroundImage, patternKey],
  );

  // ── Right-click: remove polygon vertex ───────────────────────────────────

  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (activeToolRef.current !== 'area-fill' || !areaFillClosedRef.current) return;
      e.preventDefault();
      const rect = canvasRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const verts = areaFillPolygonRef.current;
      const vIdx = hitTestPolyVertex(sx, sy, verts, cameraRef.current);
      if (vIdx === -1) return;
      if (verts.length <= 3) return; // minimum 3 enforced
      const newVerts = verts.filter((_, i) => i !== vIdx);
      setAreaFillPolygon(newVerts);
    },
    [setAreaFillPolygon],
  );

  // Cleanup poly drag on unmount
  useEffect(() => {
    return () => { if (polyDragCleanupRef.current) polyDragCleanupRef.current(); };
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        style={{ display: 'block', cursor: 'crosshair' }}
      />

      {/* Drag coordinate tooltip — positioned and updated via direct DOM */}
      <div
        ref={tooltipRef}
        style={{ display: 'none', pointerEvents: 'none' }}
        className="absolute bg-gray-900/90 text-gray-100 text-[10px] font-mono px-1.5 py-0.5 rounded border border-gray-600 select-none whitespace-nowrap z-10"
      />

      {/* Placement mode banner */}
      {placementPhase && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-blue-900/90 border border-blue-500 text-blue-100 text-xs px-3 py-1.5 rounded-full pointer-events-none select-none z-20 whitespace-nowrap">
          {placementPhase === 'line-start' && 'Click to place start point'}
          {placementPhase === 'line-end'   && 'Click to place end point'}
          {placementPhase === 'dot'        && 'Click to place dot'}
          <span className="text-blue-300 ml-2">— Esc to cancel</span>
        </div>
      )}

      {!isCalibrating && (
        <LayersBox
          valves={usedValves}
          hiddenValves={hiddenValves}
          onToggleValve={toggleValve}
          hasImage={Boolean(imgEl)}
          imageVisible={bgImageVisible}
          onToggleImage={() => setBgImageVisible((v) => !v)}
        />
      )}

      {isCalibrating && (
        <CalibrationOverlay
          fiducials={fiducials}
          calibPixels={calibPixels}
          activeCalibIdx={activeCalibIdx}
          onSelectFiducial={(i) => { setActiveCalibIdx(i); setScalingCalibIdx(null); }}
          onComplete={handleCalibComplete}
          onCancel={handleCalibCancel}
        />
      )}

      {backgroundImage && calibration?.transform && !isCalibrating && (
        <button
          onClick={handleRecalibrate}
          className="absolute top-2 right-2 bg-gray-800/80 hover:bg-gray-700 border border-gray-600 text-xs text-gray-300 px-2 py-1 rounded"
        >
          Recalibrate
        </button>
      )}
    </div>
  );
}
