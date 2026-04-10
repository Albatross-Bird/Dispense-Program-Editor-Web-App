import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProgramStore } from './store/program-store';
import { useUIStore } from './store/ui-store';
import { useSettingsStore } from './store/settings-store';
import { useCalibrationStore } from './store/calibration-store';
import { serializeMainBlock, serializePatternCommand } from '@lib/serializer';
import type { Pattern, Program } from '@lib/types';
import Canvas from './components/visualization/Canvas';
import PatternCommandList from './components/PatternCommandList';
import ToolPanel from './components/ToolPanel';
import HistoryPanel from './components/HistoryPanel';

// ── Text annotation ───────────────────────────────────────────────────────────

interface AnnotatedLine {
  text: string;
  commandIndex: number | null;
}

function annotatePattern(pattern: Pattern): AnnotatedLine[] {
  const lines: AnnotatedLine[] = [{ text: `.Patt:${pattern.name}`, commandIndex: null }];
  for (let i = 0; i < pattern.commands.length; i++) {
    for (const text of serializePatternCommand(pattern.commands[i])) {
      lines.push({ text, commandIndex: i });
    }
  }
  lines.push({ text: '.End', commandIndex: null });
  return lines;
}

function mainBlockLines(program: Program): AnnotatedLine[] {
  return serializeMainBlock(program)
    .split('\r\n')
    .map((text) => ({ text, commandIndex: null }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function basename(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
}

// ── File Menu ─────────────────────────────────────────────────────────────────

function FileMenu() {
  const { program, load, save, saveAs } = useProgramStore();
  const filePath = useProgramStore((s) => s.filePath);
  const selectedPatternName = useProgramStore((s) => s.selectedPatternName);
  const { setBackgroundImage } = useUIStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const patternKey = filePath && selectedPatternName ? `${filePath}::${selectedPatternName}` : null;

  const loadBackgroundImage = useCallback(async () => {
    if (!patternKey) return;
    const result = await window.electronAPI.loadImage();
    if (!result) return;
    // Always create a fresh object so Canvas re-triggers calibration even for the same file
    setBackgroundImage(patternKey, { filePath: result.filePath, dataUrl: `data:${result.mime};base64,${result.data}` });
  }, [setBackgroundImage, patternKey]);

  const item = (label: string, action: () => void, disabled = false) => (
    <button
      key={label}
      disabled={disabled}
      onClick={() => { action(); setOpen(false); }}
      className="w-full text-left px-4 py-1.5 text-sm hover:bg-gray-600 disabled:opacity-40 disabled:cursor-default"
    >
      {label}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-1 text-sm rounded hover:bg-gray-700"
      >
        File
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-0.5 bg-gray-800 border border-gray-600 rounded shadow-xl z-50 min-w-44 py-1">
          {item('Open...', load)}
          {item('Save', save, !program)}
          {item('Save As...', saveAs, !program)}
          <div className="my-1 border-t border-gray-700" />
          {item('Load Background Image...', loadBackgroundImage, !patternKey)}
        </div>
      )}
    </div>
  );
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function Toolbar() {
  const { filePath, isDirty } = useProgramStore();
  const { softwareType, version } = useSettingsStore();

  return (
    <header className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border-b border-gray-700 shrink-0">
      <FileMenu />
      <button className="px-3 py-1 text-sm rounded hover:bg-gray-700">Settings</button>
      <div className="w-px h-4 bg-gray-600 mx-1" />
      <span className="text-xs text-gray-400 font-mono">{softwareType} v{version}</span>
      <div className="w-px h-4 bg-gray-600 mx-1" />
      <span className="flex-1 text-sm text-gray-300 truncate">
        {filePath ? (
          <>
            {basename(filePath)}
            {isDirty && <span className="text-yellow-400 ml-1">*</span>}
          </>
        ) : (
          <span className="text-gray-500">No file open</span>
        )}
      </span>
    </header>
  );
}

// ── Pattern Selector ──────────────────────────────────────────────────────────

function HistoryToggleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="7.5" cy="7.5" r="5.5" />
      <line x1="7.5" y1="4" x2="7.5" y2="7.5" />
      <line x1="7.5" y1="7.5" x2="10" y2="9.5" />
    </svg>
  );
}

function PatternSelector() {
  const { program, selectedPatternName, selectPattern } = useProgramStore();
  const historyPanelOpen    = useUIStore((s) => s.historyPanelOpen);
  const setHistoryPanelOpen = useUIStore((s) => s.setHistoryPanelOpen);

  if (!program) return <div className="px-3 py-2 text-xs text-gray-500 shrink-0">No file open</div>;

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-700 shrink-0">
      <select
        value={selectedPatternName ?? '__main__'}
        onChange={(e) => selectPattern(e.target.value === '__main__' ? null : e.target.value)}
        className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
      >
        <option value="__main__">Main</option>
        {program.patterns.map((p) => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
      </select>
      <button
        onClick={() => setHistoryPanelOpen(!historyPanelOpen)}
        title="Toggle history panel"
        className={[
          'shrink-0 w-7 h-7 flex items-center justify-center rounded transition-colors',
          historyPanelOpen
            ? 'bg-amber-600/30 text-amber-300 border border-amber-500/50'
            : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200 border border-transparent',
        ].join(' ')}
      >
        <HistoryToggleIcon />
      </button>
    </div>
  );
}

// ── Text Pane ─────────────────────────────────────────────────────────────────

function TextPane() {
  const { program, selectedPatternName } = useProgramStore();

  // Main-block lines (read-only display; Main block commands are not selectable)
  const lines = useMemo<AnnotatedLine[]>(() => {
    if (!program) return [];
    if (selectedPatternName === null) return mainBlockLines(program);
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    return pattern ? annotatePattern(pattern) : [];
  }, [program, selectedPatternName]);

  if (!program) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
        Open a .prg file to begin
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-2">
      {lines.map((line, i) => (
        <div
          key={i}
          className="whitespace-pre font-mono text-xs leading-relaxed px-1 text-gray-400"
        >
          {line.text || '\u00a0'}
        </div>
      ))}
    </div>
  );
}

// ── Command Pane ──────────────────────────────────────────────────────────────
// Routes to raw text (Main block) or structured command list (patterns)

function CommandPane() {
  const {
    program, selectedPatternName,
    selectedCommandIds, lastSelectedId,
    selectOne, selectToggle, selectRange, clearSelection,
  } = useProgramStore();

  if (!program) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
        Open a .prg file to begin
      </div>
    );
  }

  if (selectedPatternName === null) {
    return <TextPane />;
  }

  const pattern = program.patterns.find((p) => p.name === selectedPatternName);
  if (!pattern) return <div className="flex-1" />;

  return (
    <PatternCommandList
      key={selectedPatternName}
      commands={pattern.commands}
      selectedCommandIds={selectedCommandIds}
      lastSelectedId={lastSelectedId}
      onSelect={(id, mode, allIds) => {
        if (mode === 'toggle') selectToggle(id);
        else if (mode === 'range') selectRange(id, allIds);
        else selectOne(id);
      }}
      onClear={clearSelection}
    />
  );
}

// ── Status Bar ────────────────────────────────────────────────────────────────

function StatusBar() {
  const { program, isDirty } = useProgramStore();
  const { zoomLevel, cursorCoords } = useUIStore();

  return (
    <footer className="flex items-center gap-4 px-3 py-1 bg-gray-800 border-t border-gray-700 text-xs text-gray-400 shrink-0">
      <span className={isDirty ? 'text-yellow-400' : program ? 'text-green-400' : ''}>
        {program ? (isDirty ? 'Modified' : 'Ready') : 'No file'}
      </span>
      <span className="flex-1" />
      {cursorCoords && (
        <span>x: {cursorCoords.x.toFixed(3)}, y: {cursorCoords.y.toFixed(3)}</span>
      )}
      <span>{zoomLevel.toFixed(1)}x</span>
    </footer>
  );
}

// ── Save Error Toast ──────────────────────────────────────────────────────────

function SaveErrorToast() {
  const { saveError, clearSaveError, saveAs } = useProgramStore();
  if (!saveError) return null;
  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-red-900 border border-red-600 text-red-100 text-sm px-4 py-2.5 rounded-lg shadow-xl max-w-lg">
      <span className="flex-1">{saveError}</span>
      <button
        onClick={() => { saveAs(); clearSaveError(); }}
        className="shrink-0 bg-red-700 hover:bg-red-600 px-2 py-0.5 rounded text-xs whitespace-nowrap"
      >
        Save As…
      </button>
      <button
        onClick={clearSaveError}
        className="shrink-0 text-red-300 hover:text-red-100 text-lg leading-none px-1"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  const { filePath, save } = useProgramStore();
  const { splitRatio, setSplitRatio, historyPanelOpen } = useUIStore();
  const { init: initSettings, addRecentFile } = useSettingsStore();
  const { init: initCalibrations } = useCalibrationStore();

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { initSettings(); initCalibrations(); }, []);

  useEffect(() => {
    if (filePath) addRecentFile(filePath);
  }, [filePath]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        useProgramStore.getState().undo();
        return;
      }
      if (
        ((e.ctrlKey || e.metaKey) && e.key === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')
      ) {
        e.preventDefault();
        useProgramStore.getState().redo();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save]);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = Math.min(0.85, Math.max(0.15, (ev.clientX - rect.left) / rect.width));
      setSplitRatio(ratio);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [setSplitRatio]);

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100 overflow-hidden">
      <Toolbar />
      <SaveErrorToast />

      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* Left: canvas */}
        <div style={{ width: `${splitRatio * 100}%` }} className="overflow-hidden shrink-0">
          <Canvas />
        </div>

        {/* Vertical tool panel */}
        <ToolPanel />

        {/* Drag handle */}
        <div
          onMouseDown={onDragStart}
          className="w-1 bg-gray-700 hover:bg-blue-500 cursor-col-resize shrink-0 transition-colors"
        />

        {/* Right: pattern selector + command view */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <PatternSelector />
          <div className="flex flex-1 overflow-hidden">
            <CommandPane />
            {historyPanelOpen && <HistoryPanel />}
          </div>
        </div>
      </div>

      <StatusBar />
    </div>
  );
}
