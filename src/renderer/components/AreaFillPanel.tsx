/**
 * Floating configuration panel for the Area Fill tool (Feature 8).
 * Rendered via React portal to avoid being clipped by overflow:hidden containers.
 *
 * Features:
 *  - Fill type: Dots / Lines toggle
 *  - X Spacing, Y Spacing, Z Height numeric inputs
 *  - Rotation dial (SVG) + numeric input (bidirectional)
 *  - Start Corner 2×2 grid (TL/TR/BL/BR)
 *  - Parameter dropdown (1-10)
 *  - Flow Rate (lines only)
 *  - Live preview count
 *  - Apply (wraps in group) / Cancel
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore } from '../store/ui-store';
import { useProgramStore, genId } from '../store/program-store';
import { generateAreaFill, type AreaFillConfig } from '@lib/area-fill';
import type { CommentCommand, GroupNode, PatternCommand } from '@lib/types';
import { extractDefaultZ } from './visualization/renderers';

// ── Area fill config comment — persisted inside the group in the .prg file ────
// Format stored as a CommentCommand with text: "##AREA_FILL_CONFIG:..."
// The file serializes this as "Comment:##AREA_FILL_CONFIG:..." which the parser
// reads back as a plain CommentCommand, giving us free round-trip persistence.

const CONFIG_PREFIX = '##AREA_FILL_CONFIG:';

function serializeConfigComment(polygon: [number, number][], config: PanelConfig): CommentCommand {
  const polyStr = polygon.map(([x, y]) => `${x},${y}`).join(';');
  const text = [
    `${CONFIG_PREFIX}polygon=${polyStr}`,
    `fillType=${config.fillType}`,
    `xSpacing=${config.xSpacing}`,
    `ySpacing=${config.ySpacing}`,
    `zHeight=${config.zHeight}`,
    `rotationDeg=${config.rotationDeg}`,
    `param=${config.param}`,
    `startCorner=${config.startCorner}`,
    `flowRate=${config.flowRate}`,
  ].join('|');
  return { kind: 'Comment', id: genId(), text };
}

function parseConfigComment(
  group: GroupNode,
): { polygon: [number, number][]; config: PanelConfig } | null {
  const comment = group.commands.find(
    (c) => c.kind === 'Comment' && (c as CommentCommand).text.startsWith(CONFIG_PREFIX),
  ) as CommentCommand | undefined;
  if (!comment) return null;

  try {
    const fields: Record<string, string> = {};
    comment.text.slice(CONFIG_PREFIX.length).split('|').forEach((f) => {
      const eq = f.indexOf('=');
      if (eq !== -1) fields[f.slice(0, eq)] = f.slice(eq + 1);
    });

    const polygon: [number, number][] = fields.polygon
      ? fields.polygon.split(';').map((p) => {
          const [x, y] = p.split(',').map(Number);
          return [x, y];
        })
      : [];

    if (polygon.length < 3) return null;

    return {
      polygon,
      config: {
        fillType:    (fields.fillType    as 'dots' | 'lines') ?? 'dots',
        xSpacing:    Number(fields.xSpacing)    || 2,
        ySpacing:    Number(fields.ySpacing)    || 2,
        zHeight:     Number(fields.zHeight)     || 0,
        rotationDeg: Number(fields.rotationDeg) || 0,
        param:       Number(fields.param)       || 1,
        startCorner: (fields.startCorner as 'TL'|'TR'|'BL'|'BR') ?? 'BL',
        flowRate:    Number(fields.flowRate)    || 0.5,
      },
    };
  } catch {
    return null;
  }
}

// ── Config state ──────────────────────────────────────────────────────────────

interface PanelConfig {
  fillType: 'dots' | 'lines';
  xSpacing: number;
  ySpacing: number;
  zHeight: number;
  rotationDeg: number;
  startCorner: 'TL' | 'TR' | 'BL' | 'BR';
  param: number;
  flowRate: number;
}

const DEFAULT_CONFIG: PanelConfig = {
  fillType: 'dots',
  xSpacing: 2,
  ySpacing: 2,
  zHeight: 0,
  rotationDeg: 0,
  startCorner: 'BL',
  param: 1,
  flowRate: 0.5,
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] text-gray-400 mb-0.5">{children}</div>;
}

function NumberInput({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step ?? 0.1}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
      className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-blue-500"
    />
  );
}

// ── Rotation Dial ─────────────────────────────────────────────────────────────

interface RotationDialProps {
  value: number;        // degrees 0-360
  onChange: (deg: number) => void;
}

function RotationDial({ value, onChange }: RotationDialProps) {
  const SIZE = 80;
  const CENTER = SIZE / 2;
  const RADIUS = 30;
  const HANDLE_R = 6;

  // Handle dot position
  const angleRad = ((value - 90) * Math.PI) / 180; // 0° at top
  const hx = CENTER + RADIUS * Math.cos(angleRad);
  const hy = CENTER + RADIUS * Math.sin(angleRad);

  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef(false);

  const getAngleFromEvent = useCallback((clientX: number, clientY: number): number => {
    const svg = svgRef.current;
    if (!svg) return value;
    const rect = svg.getBoundingClientRect();
    const scaleX = SIZE / rect.width;
    const scaleY = SIZE / rect.height;
    const sx = (clientX - rect.left) * scaleX;
    const sy = (clientY - rect.top) * scaleY;
    const dx = sx - CENTER;
    const dy = sy - CENTER;
    // atan2 gives angle from +x axis; add 90° so 0° is at top
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;
    if (deg >= 360) deg -= 360;
    return Math.round(deg);
  }, [value]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    onChange(getAngleFromEvent(e.clientX, e.clientY));

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      onChange(getAngleFromEvent(ev.clientX, ev.clientY));
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [getAngleFromEvent, onChange]);

  // Tick marks every 45°
  const ticks = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    const inner = RADIUS - 4;
    const outer = RADIUS + 2;
    return {
      x1: CENTER + inner * Math.cos(a),
      y1: CENTER + inner * Math.sin(a),
      x2: CENTER + outer * Math.cos(a),
      y2: CENTER + outer * Math.sin(a),
    };
  });

  return (
    <svg
      ref={svgRef}
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="cursor-pointer select-none shrink-0"
      onMouseDown={onMouseDown}
    >
      {/* Track circle */}
      <circle cx={CENTER} cy={CENTER} r={RADIUS} stroke="#4b5563" strokeWidth={2} fill="none" />
      {/* Tick marks */}
      {ticks.map((t, i) => (
        <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="#6b7280" strokeWidth={1} />
      ))}
      {/* Center dot */}
      <circle cx={CENTER} cy={CENTER} r={2} fill="#6b7280" />
      {/* Line from center to handle */}
      <line x1={CENTER} y1={CENTER} x2={hx} y2={hy} stroke="#60a5fa" strokeWidth={1.5} strokeLinecap="round" />
      {/* Handle */}
      <circle
        cx={hx}
        cy={hy}
        r={HANDLE_R}
        fill="#3b82f6"
        stroke="#93c5fd"
        strokeWidth={1.5}
      />
      {/* 0° label */}
      <text x={CENTER} y={10} textAnchor="middle" fontSize={7} fill="#9ca3af">0°</text>
    </svg>
  );
}

// ── Start Corner Grid ─────────────────────────────────────────────────────────

type Corner = 'TL' | 'TR' | 'BL' | 'BR';

function StartCornerGrid({
  value,
  onChange,
}: {
  value: Corner;
  onChange: (c: Corner) => void;
}) {
  const btn = (c: Corner, label: string) => (
    <button
      key={c}
      onClick={() => onChange(c)}
      className={[
        'flex-1 py-1 text-[10px] transition-colors border',
        value === c
          ? 'bg-blue-600 border-blue-400 text-white'
          : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600',
      ].join(' ')}
    >
      {label}
    </button>
  );

  return (
    <div className="rounded overflow-hidden" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
      {btn('TL', 'TL')}
      {btn('TR', 'TR')}
      {btn('BL', 'BL')}
      {btn('BR', 'BR')}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface AreaFillPanelProps {
  anchorRect: DOMRect;
  onCancel: () => void;
}

export default function AreaFillPanel({ anchorRect, onCancel }: AreaFillPanelProps) {
  const areaFillPolygon       = useUIStore((s) => s.areaFillPolygon);
  const areaFillClosed        = useUIStore((s) => s.areaFillClosed);
  const clearAreaFill         = useUIStore((s) => s.clearAreaFill);
  const setActiveTool         = useUIStore((s) => s.setActiveTool);
  const setAreaFillPreviewCmds = useUIStore((s) => s.setAreaFillPreviewCmds);

  const selectedPatternName      = useProgramStore((s) => s.selectedPatternName);
  const bulkInsertAfterSelection = useProgramStore((s) => s.bulkInsertAfterSelection);
  const replaceCommand           = useProgramStore((s) => s.replaceCommand);
  const program                  = useProgramStore((s) => s.program);

  const areaFillEditGroupId = useUIStore((s) => s.areaFillEditGroupId);

  // Find the group being edited (if any) so we can infer its config
  const editGroup = React.useMemo(() => {
    if (!areaFillEditGroupId || !program || !selectedPatternName) return null;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    return pattern?.commands.find(
      (c) => c.kind === 'Group' && c.id === areaFillEditGroupId,
    ) as import('@lib/types').GroupNode | null ?? null;
  }, [areaFillEditGroupId, program, selectedPatternName]);

  // Default Z from the first Mark command in the current pattern (20B)
  const patternCommands = React.useMemo(() => {
    if (!program || !selectedPatternName) return [];
    return program.patterns.find((p) => p.name === selectedPatternName)?.commands ?? [];
  }, [program, selectedPatternName]);
  const defaultZ = React.useMemo(() => extractDefaultZ(patternCommands) ?? 0, [patternCommands]);

  const [config, setConfig] = useState<PanelConfig>(() => {
    // Will be updated via useEffect when editGroup is available.
    // For new fills, seed zHeight from Mark commands.
    return { ...DEFAULT_CONFIG, zHeight: 0 }; // defaultZ not available at init; set via effect below
  });

  const setAreaFillPolygon = useUIStore((s) => s.setAreaFillPolygon);
  const setAreaFillClosed  = useUIStore((s) => s.setAreaFillClosed);

  // Seed zHeight from Mark commands when creating a new fill (not editing an existing one)
  useEffect(() => {
    if (editGroup) return; // editing — let the editGroup effect handle config
    setConfig((prev) => ({ ...prev, zHeight: defaultZ }));
  }, [editGroup, defaultZ]);

  // Restore polygon + full config when opening in edit mode
  useEffect(() => {
    if (!editGroup) return;
    const parsed = parseConfigComment(editGroup);
    if (parsed) {
      setConfig(parsed.config);
      setAreaFillPolygon(parsed.polygon);
      setAreaFillClosed(true);
    } else {
      // Fallback: infer what we can from the fill commands themselves
      const first = editGroup.commands.find((c) => c.kind === 'Dot' || c.kind === 'Line');
      if (!first) return;
      const fillType: 'dots' | 'lines' = first.kind === 'Dot' ? 'dots' : 'lines';
      const param = (first as import('@lib/types').DotCommand | import('@lib/types').LineCommand).valve ?? 1;
      const zHeight = first.kind === 'Dot' ? first.point[2] : first.kind === 'Line' ? first.startPoint[2] : 0;
      const flowRate = first.kind === 'Line' ? (first.flowRate?.value ?? 0.5) : 0.5;
      setConfig((prev) => ({ ...prev, fillType, param, zHeight, flowRate }));
    }
  }, [editGroup, setAreaFillPolygon, setAreaFillClosed]);

  const set = <K extends keyof PanelConfig>(key: K, val: PanelConfig[K]) =>
    setConfig((prev) => ({ ...prev, [key]: val }));

  // ── Live preview (debounced for numeric inputs, immediate for dial) ──────────

  const configRef  = useRef(config);
  const polygonRef = useRef(areaFillPolygon);
  const closedRef  = useRef(areaFillClosed);

  useEffect(() => { configRef.current  = config; },          [config]);
  useEffect(() => { polygonRef.current = areaFillPolygon; }, [areaFillPolygon]);
  useEffect(() => { closedRef.current  = areaFillClosed; },  [areaFillClosed]);

  const computeAndSetPreview = useCallback(() => {
    const poly   = polygonRef.current;
    const closed = closedRef.current;
    const cfg    = configRef.current;
    if (!closed || poly.length < 3) {
      setAreaFillPreviewCmds([]);
      return;
    }
    const fillConfig: AreaFillConfig = {
      polygon: poly,
      fillType: cfg.fillType,
      xSpacing: cfg.xSpacing,
      ySpacing: cfg.ySpacing,
      zHeight: cfg.zHeight,
      rotationDeg: cfg.rotationDeg,
      param: cfg.param,
      startCorner: cfg.startCorner,
      flowRate: { value: cfg.flowRate, unit: 'mg/mm' },
    };
    setAreaFillPreviewCmds(generateAreaFill(fillConfig));
  }, [setAreaFillPreviewCmds]);

  // Debounced update for regular inputs
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedulePreview = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      computeAndSetPreview();
    }, 50);
  }, [computeAndSetPreview]);

  // Immediate update for dial
  const handleDialChange = useCallback((deg: number) => {
    setConfig((prev) => ({ ...prev, rotationDeg: deg }));
    configRef.current = { ...configRef.current, rotationDeg: deg };
    computeAndSetPreview();
  }, [computeAndSetPreview]);

  // Trigger preview whenever config or polygon changes (except dial which is immediate)
  useEffect(() => { schedulePreview(); }, [config, areaFillPolygon, areaFillClosed, schedulePreview]);

  // Clear preview on unmount
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setAreaFillPreviewCmds([]);
  }, [setAreaFillPreviewCmds]);

  // ── Preview count ────────────────────────────────────────────────────────────

  const previewCmds = useUIStore((s) => s.areaFillPreviewCmds);
  const previewCount = previewCmds.length;

  // ── Apply ────────────────────────────────────────────────────────────────────

  const canGenerate = areaFillClosed && areaFillPolygon.length >= 3 && selectedPatternName !== null;

  const handleApply = () => {
    if (!canGenerate) return;
    const fillConfig: AreaFillConfig = {
      polygon: areaFillPolygon,
      fillType: config.fillType,
      xSpacing: config.xSpacing,
      ySpacing: config.ySpacing,
      zHeight: config.zHeight,
      rotationDeg: config.rotationDeg,
      param: config.param,
      startCorner: config.startCorner,
      flowRate: { value: config.flowRate, unit: 'mg/mm' },
    };
    const cmds = generateAreaFill(fillConfig);
    if (cmds.length === 0) return;

    const fillCount = cmds.length;
    const fillKind  = config.fillType === 'dots' ? 'dot' : 'line';
    const label     = `Area Fill: ${fillCount} ${fillKind}${fillCount !== 1 ? 's' : ''}`;

    // Prepend the config comment so the polygon + settings round-trip through the file
    const configComment = serializeConfigComment(areaFillPolygon, config);

    const group: GroupNode = {
      kind: 'Group',
      id: areaFillEditGroupId ?? genId(),
      name: editGroup?.name ?? 'Area Fill',
      commands: [configComment, ...cmds as PatternCommand[]],
      collapsed: false,
    };

    if (areaFillEditGroupId) {
      replaceCommand(areaFillEditGroupId, group, `Edit ${label}`);
    } else {
      bulkInsertAfterSelection([group], label);
    }
    clearAreaFill();
    setActiveTool(null);
  };

  const handleCancel = () => {
    clearAreaFill();
    onCancel();
  };

  // ── Positioning + drag-to-move ───────────────────────────────────────────────

  const PANEL_WIDTH = 290;

  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  // Initialise from anchorRect on first render only
  const anchorInitRef = useRef(false);
  if (!anchorInitRef.current && anchorRect) {
    anchorInitRef.current = true;
    // Will be set via layout effect below to avoid SSR issues
  }
  useEffect(() => {
    if (panelPos === null) {
      setPanelPos({ top: anchorRect.top, left: anchorRect.left - PANEL_WIDTH - 4 });
    }
  // Only run when the panel is first mounted (panelPos starts null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dragOriginRef = useRef<{ mouseX: number; mouseY: number; top: number; left: number } | null>(null);

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag on left-button, ignore clicks on the close button / preview count
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const pos = panelPos ?? { top: anchorRect.top, left: anchorRect.left - PANEL_WIDTH - 4 };
    dragOriginRef.current = { mouseX: e.clientX, mouseY: e.clientY, top: pos.top, left: pos.left };

    const onMove = (ev: MouseEvent) => {
      if (!dragOriginRef.current) return;
      const dx = ev.clientX - dragOriginRef.current.mouseX;
      const dy = ev.clientY - dragOriginRef.current.mouseY;
      setPanelPos({ top: dragOriginRef.current.top + dy, left: dragOriginRef.current.left + dx });
    };
    const onUp = () => {
      dragOriginRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [panelPos, anchorRect]);

  const resolvedPos = panelPos ?? { top: anchorRect.top, left: anchorRect.left - PANEL_WIDTH - 4 };
  const style: React.CSSProperties = {
    position: 'fixed',
    top: resolvedPos.top,
    left: resolvedPos.left,
    width: PANEL_WIDTH,
    zIndex: 100,
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const panel = (
    <div
      style={style}
      className="bg-gray-900 border border-gray-600 rounded-lg shadow-2xl text-gray-100 overflow-hidden select-none"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header — drag handle */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700 cursor-move"
        onMouseDown={onHeaderMouseDown}
      >
        <span className="text-sm font-semibold select-none">
          {areaFillEditGroupId ? 'Edit Area Fill' : 'Area Fill'}
        </span>
        <div className="flex items-center gap-2">
          {previewCount > 0 && (
            <span className="text-[10px] text-blue-300">
              {previewCount} {config.fillType === 'dots' ? 'dot' : 'line'}{previewCount !== 1 ? 's' : ''}
            </span>
          )}
          <button
            onClick={handleCancel}
            onMouseDown={(e) => e.stopPropagation()}
            className="text-gray-400 hover:text-gray-100 text-lg leading-none cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </div>

      <div className="px-3 py-2 space-y-2.5">

        {/* Polygon status */}
        <div className={[
          'rounded px-2 py-1.5 text-xs',
          areaFillClosed
            ? 'bg-green-900/40 border border-green-700 text-green-300'
            : 'bg-blue-900/30 border border-blue-700/60 text-blue-300',
        ].join(' ')}>
          {areaFillClosed
            ? `Polygon ready — ${areaFillPolygon.length} vertices`
            : areaFillPolygon.length === 0
            ? 'Click on the canvas to place polygon vertices'
            : `${areaFillPolygon.length} vert${areaFillPolygon.length === 1 ? 'ex' : 'ices'} placed — double-click to close`}
        </div>

        {/* Fill type */}
        <div>
          <Label>Fill type</Label>
          <div className="flex rounded overflow-hidden border border-gray-600">
            {(['dots', 'lines'] as const).map((t) => (
              <button
                key={t}
                onClick={() => set('fillType', t)}
                className={[
                  'flex-1 py-1 text-xs transition-colors',
                  config.fillType === t
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
                ].join(' ')}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Spacing row */}
        <div className="grid grid-cols-3 gap-1.5">
          <div>
            <Label>X Spacing</Label>
            <NumberInput value={config.xSpacing} min={0.1} max={50} step={0.5} onChange={(v) => set('xSpacing', v)} />
          </div>
          <div>
            <Label>Y Spacing</Label>
            <NumberInput value={config.ySpacing} min={0.1} max={50} step={0.5} onChange={(v) => set('ySpacing', v)} />
          </div>
          <div>
            <Label>Z Height</Label>
            <NumberInput value={config.zHeight} min={-99} max={99} step={0.1} onChange={(v) => set('zHeight', v)} />
          </div>
        </div>

        {/* Rotation */}
        <div>
          <Label>Rotation</Label>
          <div className="flex items-center gap-3">
            <RotationDial value={config.rotationDeg} onChange={handleDialChange} />
            <div className="flex-1">
              <NumberInput
                value={config.rotationDeg}
                min={0}
                max={359}
                step={1}
                onChange={(v) => {
                  let deg = ((v % 360) + 360) % 360;
                  set('rotationDeg', deg);
                }}
              />
              <div className="text-[10px] text-gray-500 mt-0.5 text-center">degrees</div>
            </div>
          </div>
        </div>

        {/* Start corner */}
        <div>
          <Label>Start corner</Label>
          <StartCornerGrid value={config.startCorner} onChange={(c) => set('startCorner', c)} />
        </div>

        {/* Parameter */}
        <div>
          <Label>Parameter</Label>
          <select
            value={config.param}
            onChange={(e) => set('param', parseInt(e.target.value, 10))}
            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-blue-500"
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
              <option key={v} value={v}>Param {v}</option>
            ))}
          </select>
        </div>

        {/* Flow rate (lines only) */}
        {config.fillType === 'lines' && (
          <div>
            <Label>Flow rate (mg/mm)</Label>
            <NumberInput value={config.flowRate} min={0.01} max={10} step={0.05} onChange={(v) => set('flowRate', v)} />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-0.5">
          <button
            onClick={handleApply}
            disabled={!canGenerate || previewCount === 0}
            className="flex-1 py-1.5 rounded text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-default text-white transition-colors"
          >
            Apply
          </button>
          <button
            onClick={handleCancel}
            className="flex-1 py-1.5 rounded text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          >
            Cancel
          </button>
        </div>

        {!selectedPatternName && (
          <div className="text-[10px] text-yellow-400">Select a pattern first to enable apply.</div>
        )}

      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

// ── Hook: track toolbar anchor rect ──────────────────────────────────────────

export function useAnchorRect(ref: React.RefObject<HTMLElement>): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setRect(el.getBoundingClientRect());
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    window.addEventListener('resize', update);
    return () => { obs.disconnect(); window.removeEventListener('resize', update); };
  }, [ref]);

  return rect;
}
