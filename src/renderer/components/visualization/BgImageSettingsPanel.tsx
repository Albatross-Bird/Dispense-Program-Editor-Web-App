/**
 * Floating settings panel for background image filters (Feature 19).
 * Rendered via React portal; draggable header.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettingsStore, DEFAULT_BG_IMAGE_SETTINGS } from '../../store/settings-store';
import type { BgImageSettings } from '../../store/settings-store';

// ── Local controls ────────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[11px] text-gray-400 w-24 shrink-0">{label}</span>
      <div className="flex-1 flex items-center gap-2">{children}</div>
    </div>
  );
}

function Slider({
  value, onChange, min, max, step = 1,
}: {
  value: number; onChange: (v: number) => void; min: number; max: number; step?: number;
}) {
  return (
    <input
      type="range"
      min={min} max={max} step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="flex-1 h-1.5 accent-blue-500 cursor-pointer"
    />
  );
}

function NumericBadge({ value }: { value: number }) {
  return (
    <span className="text-[10px] text-gray-400 tabular-nums w-8 text-right shrink-0">{value}</span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface BgImageSettingsPanelProps {
  filePath: string;
  anchorRect: DOMRect;
  onClose: () => void;
}

export default function BgImageSettingsPanel({
  filePath,
  anchorRect,
  onClose,
}: BgImageSettingsPanelProps) {
  const getBgImageSettings = useSettingsStore((s) => s.getBgImageSettings);
  const setBgImageSettings = useSettingsStore((s) => s.setBgImageSettings);

  const [settings, setSettings] = useState<BgImageSettings>(() => getBgImageSettings(filePath));

  // Sync local state → store on every change
  const update = useCallback((patch: Partial<BgImageSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      setBgImageSettings(filePath, next);
      return next;
    });
  }, [filePath, setBgImageSettings]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  // ── Panel position & drag ─────────────────────────────────────────────────
  const PANEL_WIDTH = 270;
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (panelPos === null) {
      setPanelPos({ top: anchorRect.bottom + 4, left: anchorRect.left });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dragOriginRef = useRef<{ mouseX: number; mouseY: number; top: number; left: number } | null>(null);

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = panelPos ?? { top: anchorRect.bottom + 4, left: anchorRect.left };
    dragOriginRef.current = { mouseX: e.clientX, mouseY: e.clientY, top: pos.top, left: pos.left };
    const onMove = (ev: MouseEvent) => {
      if (!dragOriginRef.current) return;
      setPanelPos({
        top:  dragOriginRef.current.top  + (ev.clientY - dragOriginRef.current.mouseY),
        left: dragOriginRef.current.left + (ev.clientX - dragOriginRef.current.mouseX),
      });
    };
    const onUp = () => {
      dragOriginRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [panelPos, anchorRect]);

  const resolvedPos = panelPos ?? { top: anchorRect.bottom + 4, left: anchorRect.left };

  // ── Render ────────────────────────────────────────────────────────────────

  const panel = (
    <div
      style={{ position: 'fixed', top: resolvedPos.top, left: resolvedPos.left, width: PANEL_WIDTH, zIndex: 200 }}
      className="bg-gray-900 border border-gray-600 rounded-lg shadow-2xl text-gray-100 overflow-hidden select-none"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700 cursor-move"
        onMouseDown={onHeaderMouseDown}
      >
        <span className="text-xs font-semibold">Background Image Settings</span>
        <button
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()}
          className="text-gray-400 hover:text-gray-100 text-lg leading-none cursor-pointer"
          aria-label="Close"
        >×</button>
      </div>

      {/* Controls */}
      <div className="px-3 py-2 space-y-0.5">

        {/* 1. Black & White */}
        <Row label="Black & White">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.grayscale}
              onChange={(e) => update({ grayscale: e.target.checked })}
              className="accent-blue-500"
            />
            <span className="text-[11px] text-gray-300">Grayscale</span>
          </label>
        </Row>

        {/* 2. Resolution Scale */}
        <Row label="Resolution">
          <Slider
            value={settings.resolutionScale}
            onChange={(v) => update({ resolutionScale: v })}
            min={10} max={100} step={5}
          />
          <NumericBadge value={settings.resolutionScale} />
          <span className="text-[10px] text-gray-500 shrink-0">%</span>
        </Row>

        {/* 3. Brightness */}
        <Row label="Brightness">
          <Slider
            value={settings.brightness}
            onChange={(v) => update({ brightness: v })}
            min={-100} max={100}
          />
          <NumericBadge value={settings.brightness} />
        </Row>

        {/* 4. Contrast */}
        <Row label="Contrast">
          <Slider
            value={settings.contrast}
            onChange={(v) => update({ contrast: v })}
            min={-100} max={100}
          />
          <NumericBadge value={settings.contrast} />
        </Row>

        {/* 5. Threshold */}
        <div className="py-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] text-gray-400 w-24 shrink-0">Threshold</span>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.threshold}
                onChange={(e) => update({ threshold: e.target.checked })}
                className="accent-blue-500"
              />
              <span className="text-[11px] text-gray-300">Enable</span>
            </label>
          </div>
          {settings.threshold && (
            <div className="flex items-center gap-2 pl-[6.5rem]">
              <Slider
                value={settings.thresholdValue}
                onChange={(v) => update({ thresholdValue: v })}
                min={0} max={255}
              />
              <NumericBadge value={settings.thresholdValue} />
            </div>
          )}
        </div>

        {/* 6. Smoothing */}
        <Row label="Smoothing">
          <Slider
            value={settings.smoothing}
            onChange={(v) => update({ smoothing: v })}
            min={0} max={10}
          />
          <NumericBadge value={settings.smoothing} />
        </Row>

        {/* Divider */}
        <div className="border-t border-gray-700 my-2" />

        {/* 7. Reset */}
        <button
          onClick={() => update({ ...DEFAULT_BG_IMAGE_SETTINGS })}
          className="w-full text-[11px] py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
        >
          Reset to Default
        </button>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
