/**
 * Floating configuration panel for the Contour Fill tool.
 * Rendered via React portal to avoid being clipped by overflow:hidden containers.
 *
 * Generates toolpaths that follow the shape of a user-defined polygon,
 * offsetting inward at a specified spacing.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore } from '../store/ui-store';
import { useSettingsStore } from '../store/settings-store';
import { useProgramStore, genId } from '../store/program-store';
import NumberInput from './NumberInput';
import { generateContourFillCommands, type ContourFillConfig } from '@lib/contour-fill';
import type { CommentCommand, GroupNode, PatternCommand } from '@lib/types';
import { extractDefaultZ } from './visualization/renderers';
import { useT } from '../hooks/useT';

// ── Config comment — persisted inside the group in the .prg file ──────────────
// Format: "##CONTOUR_FILL_CONFIG:polygon=x,y;x,y|spacing=2|..."

const CONFIG_PREFIX = '##CONTOUR_FILL_CONFIG:';

function serializeConfigComment(
  polygon: [number, number][],
  config: PanelConfig,
): CommentCommand {
  const polyStr = polygon.map(([x, y]) => `${x},${y}`).join(';');
  const text = [
    `${CONFIG_PREFIX}polygon=${polyStr}`,
    `spacing=${config.spacing}`,
    `start=${config.start}`,
    `fillType=${config.fillType}`,
    `dotSpacing=${config.dotSpacing}`,
    `zHeight=${config.zHeight}`,
    `param=${config.param}`,
    `flowRate=${config.flowRate}`,
    `name=${config.name}`,
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

    const raw = fields.name ?? '';
    const parsedName = raw === 'Contour Fill'
      ? ''
      : raw.startsWith('Contour Fill - ')
      ? raw.slice('Contour Fill - '.length)
      : raw;

    // Handle legacy 'direction' field (inward→outside, outward-inward→inside)
    const rawStart = fields.start ?? fields.direction ?? 'outside';
    const start: 'outside' | 'inside' =
      rawStart === 'inside' || rawStart === 'outward-inward' ? 'inside' : 'outside';

    return {
      polygon,
      config: {
        spacing:    Number(fields.spacing)    || 2,
        start,
        fillType:   (fields.fillType as 'dots' | 'lines') ?? 'lines',
        dotSpacing: Number(fields.dotSpacing) || 1,
        zHeight:    Number(fields.zHeight)    || 0,
        param:      Number(fields.param)      || 1,
        flowRate:   Number(fields.flowRate)   || 0.5,
        name:       parsedName,
      },
    };
  } catch {
    return null;
  }
}

// ── Config state ──────────────────────────────────────────────────────────────

interface PanelConfig {
  spacing: number;
  start: 'outside' | 'inside';
  fillType: 'dots' | 'lines';
  dotSpacing: number;
  zHeight: number;
  param: number;
  flowRate: number;
  name: string;
}

const DEFAULT_CONFIG: PanelConfig = {
  spacing: 2,
  start: 'outside',
  fillType: 'lines',
  dotSpacing: 1,
  zHeight: 0,
  param: 1,
  flowRate: 0.5,
  name: '',
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] text-gray-400 mb-0.5">{children}</div>;
}

// ── Main Component ────────────────────────────────────────────────────────────

interface ContourFillPanelProps {
  anchorRect: DOMRect;
  onCancel: () => void;
}

export default function ContourFillPanel({ anchorRect, onCancel }: ContourFillPanelProps) {
  const t = useT();

  const contourFillPolygon      = useUIStore((s) => s.contourFillPolygon);
  const contourFillClosed       = useUIStore((s) => s.contourFillClosed);
  const clearContourFill        = useUIStore((s) => s.clearContourFill);
  const setActiveTool           = useUIStore((s) => s.setActiveTool);
  const setContourFillPreviewCmds = useUIStore((s) => s.setContourFillPreviewCmds);
  const contourFillEditGroupId  = useUIStore((s) => s.contourFillEditGroupId);

  const setContourFillPolygon = useUIStore((s) => s.setContourFillPolygon);
  const setContourFillClosed  = useUIStore((s) => s.setContourFillClosed);

  const selectedPatternName      = useProgramStore((s) => s.selectedPatternName);
  const bulkInsertAfterSelection = useProgramStore((s) => s.bulkInsertAfterSelection);
  const replaceCommand           = useProgramStore((s) => s.replaceCommand);
  const program                  = useProgramStore((s) => s.program);

  // Find the group being edited (if any)
  const editGroup = useMemo(() => {
    if (!contourFillEditGroupId || !program || !selectedPatternName) return null;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    return pattern?.commands.find(
      (c) => c.kind === 'Group' && c.id === contourFillEditGroupId,
    ) as GroupNode | null ?? null;
  }, [contourFillEditGroupId, program, selectedPatternName]);

  // Default Z from Mark commands in current pattern
  const patternCommands = useMemo(() => {
    if (!program || !selectedPatternName) return [];
    return program.patterns.find((p) => p.name === selectedPatternName)?.commands ?? [];
  }, [program, selectedPatternName]);
  const defaultZ = useMemo(() => extractDefaultZ(patternCommands) ?? 0, [patternCommands]);

  const [config, setConfig] = useState<PanelConfig>(() => {
    const ap = useUIStore.getState().activeParam;
    const ds = useSettingsStore.getState().dotSizes;
    const size = ds[ap - 1] ?? 1.0;
    const spacing = Math.max(0.5, parseFloat((size * 2.0).toFixed(2)));
    return { ...DEFAULT_CONFIG, param: ap, spacing };
  });

  const set = <K extends keyof PanelConfig>(key: K, val: PanelConfig[K]) =>
    setConfig((prev) => ({ ...prev, [key]: val }));

  // Seed zHeight from Mark commands when creating a new fill
  useEffect(() => {
    if (editGroup) return;
    setConfig((prev) => ({ ...prev, zHeight: defaultZ }));
  }, [editGroup, defaultZ]);

  // Restore polygon + full config when opening in edit mode
  useEffect(() => {
    if (!editGroup) return;
    const parsed = parseConfigComment(editGroup);
    if (parsed) {
      setConfig(parsed.config);
      setContourFillPolygon(parsed.polygon);
      setContourFillClosed(true);
    }
  }, [editGroup, setContourFillPolygon, setContourFillClosed]);

  // ── Live preview ──────────────────────────────────────────────────────────

  const configRef  = useRef(config);
  const polygonRef = useRef(contourFillPolygon);
  const closedRef  = useRef(contourFillClosed);

  useEffect(() => { configRef.current  = config; },              [config]);
  useEffect(() => { polygonRef.current = contourFillPolygon; }, [contourFillPolygon]);
  useEffect(() => { closedRef.current  = contourFillClosed; },  [contourFillClosed]);

  const computeAndSetPreview = useCallback(() => {
    const poly   = polygonRef.current;
    const closed = closedRef.current;
    const cfg    = configRef.current;
    if (!closed || poly.length < 3) {
      setContourFillPreviewCmds([]);
      return;
    }
    const fillConfig: ContourFillConfig = {
      polygon: poly,
      spacing: cfg.spacing,
      start: cfg.start,
      fillType: cfg.fillType,
      dotSpacing: cfg.dotSpacing,
      zHeight: cfg.zHeight,
      param: cfg.param,
      flowRate: cfg.flowRate,
      name: cfg.name,
    };
    setContourFillPreviewCmds(generateContourFillCommands(fillConfig));
  }, [setContourFillPreviewCmds]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePreview = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(computeAndSetPreview, 50);
  }, [computeAndSetPreview]);

  useEffect(() => { schedulePreview(); }, [config, contourFillPolygon, contourFillClosed, schedulePreview]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setContourFillPreviewCmds([]);
  }, [setContourFillPreviewCmds]);

  // ── Preview count ─────────────────────────────────────────────────────────

  const previewCmds = useUIStore((s) => s.contourFillPreviewCmds);
  const previewCount = previewCmds.length;

  // ── Apply ─────────────────────────────────────────────────────────────────

  const canGenerate = contourFillClosed && contourFillPolygon.length >= 3 && selectedPatternName !== null;

  const handleApply = () => {
    if (!canGenerate) return;
    const fillConfig: ContourFillConfig = {
      polygon: contourFillPolygon,
      spacing: config.spacing,
      start: config.start,
      fillType: config.fillType,
      dotSpacing: config.dotSpacing,
      zHeight: config.zHeight,
      param: config.param,
      flowRate: config.flowRate,
      name: config.name,
    };
    const cmds = generateContourFillCommands(fillConfig);
    if (cmds.length === 0) return;

    const fillCount = cmds.length;
    const fillKind  = config.fillType === 'dots' ? 'dot' : 'line';
    const label     = `Contour Fill: ${fillCount} ${fillKind}${fillCount !== 1 ? 's' : ''}`;

    const configComment = serializeConfigComment(contourFillPolygon, config);

    const groupName = config.name.trim() ? `Contour Fill - ${config.name.trim()}` : 'Contour Fill';

    const group: GroupNode = {
      kind: 'Group',
      id: contourFillEditGroupId ?? genId(),
      name: groupName,
      commands: [configComment, ...(cmds as PatternCommand[])],
      collapsed: false,
    };

    if (contourFillEditGroupId) {
      replaceCommand(contourFillEditGroupId, group, `Edit ${label}`);
    } else {
      bulkInsertAfterSelection([group], label);
    }
    clearContourFill();
    setActiveTool(null);
  };

  const handleCancel = () => {
    clearContourFill();
    onCancel();
  };

  // ── Positioning + drag-to-move ────────────────────────────────────────────

  const PANEL_WIDTH = 270;

  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (panelPos === null) {
      setPanelPos({ top: anchorRect.top, left: anchorRect.left - PANEL_WIDTH - 4 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dragOriginRef = useRef<{ mouseX: number; mouseY: number; top: number; left: number } | null>(null);

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
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

  // ── Render ────────────────────────────────────────────────────────────────

  const panel = (
    <div
      style={style}
      className="bg-gray-900 border border-gray-600 rounded-lg shadow-2xl text-gray-100 overflow-hidden select-none"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header — drag handle */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700 cursor-move"
        onMouseDown={onHeaderMouseDown}
      >
        <span className="text-sm font-semibold select-none shrink-0">
          {contourFillEditGroupId ? t('cf.editTitle') : t('cf.title')}
        </span>
        <input
          type="text"
          value={config.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder={t('cf.fillNamePh')}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-gray-700/60 border border-gray-600/50 rounded px-2 py-0.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500 cursor-text"
        />
        <div className="flex items-center gap-2 shrink-0">
          {previewCount > 0 && (
            <span className="text-[10px] text-blue-300">
              {previewCount} {config.fillType === 'dots'
                ? (previewCount !== 1 ? t('cf.previewDots') : t('cf.previewDot'))
                : (previewCount !== 1 ? t('cf.previewLines') : t('cf.previewLine'))}
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
          contourFillClosed
            ? 'bg-green-900/40 border border-green-700 text-green-300'
            : 'bg-blue-900/30 border border-blue-700/60 text-blue-300',
        ].join(' ')}>
          {contourFillClosed
            ? t('cf.polyReady', { n: String(contourFillPolygon.length) })
            : contourFillPolygon.length === 0
            ? t('cf.polyStart')
            : t('cf.polyProgress', {
                n: String(contourFillPolygon.length),
                v: contourFillPolygon.length === 1 ? t('cf.vertex') : t('cf.vertices'),
              })}
        </div>

        {/* Spacing */}
        <div>
          <Label>{t('cf.spacing')}</Label>
          <NumberInput
            value={config.spacing}
            min={0.1} max={50} step={0.5}
            onChange={(v) => set('spacing', v)}
          />
        </div>

        {/* Start */}
        <div>
          <Label>{t('cf.start')}</Label>
          <div className="flex rounded overflow-hidden border border-gray-600">
            {(['outside', 'inside'] as const).map((s) => (
              <button
                key={s}
                onClick={() => set('start', s)}
                className={[
                  'flex-1 py-1 text-[10px] transition-colors',
                  config.start === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
                ].join(' ')}
              >
                {s === 'outside' ? t('cf.outside') : t('cf.inside')}
              </button>
            ))}
          </div>
        </div>

        {/* Fill type */}
        <div>
          <Label>{t('cf.fillType')}</Label>
          <div className="flex rounded overflow-hidden border border-gray-600">
            {(['lines', 'dots'] as const).map((ft) => (
              <button
                key={ft}
                onClick={() => set('fillType', ft)}
                className={[
                  'flex-1 py-1 text-xs transition-colors',
                  config.fillType === ft
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
                ].join(' ')}
              >
                {ft === 'dots' ? t('cf.dots') : t('cf.lines')}
              </button>
            ))}
          </div>
        </div>

        {/* Dot spacing (dots only) */}
        {config.fillType === 'dots' && (
          <div>
            <Label>{t('cf.dotSpacing')}</Label>
            <NumberInput value={config.dotSpacing} min={0.1} max={50} step={0.5} onChange={(v) => set('dotSpacing', v)} />
          </div>
        )}

        {/* Z Height */}
        <div>
          <Label>{t('cf.zHeight')}</Label>
          <NumberInput value={config.zHeight} min={-99} max={99} step={0.1} onChange={(v) => set('zHeight', v)} />
        </div>

        {/* Parameter */}
        <div>
          <Label>{t('cf.parameter')}</Label>
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
            <Label>{t('cf.flowRate')}</Label>
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
            {t('cf.apply')}
          </button>
          <button
            onClick={handleCancel}
            className="flex-1 py-1.5 rounded text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          >
            {t('cf.cancel')}
          </button>
        </div>

        {!selectedPatternName && (
          <div className="text-[10px] text-yellow-400">{t('cf.selectFirst')}</div>
        )}

      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
