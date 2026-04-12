import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProgramStore } from './store/program-store';
import { useUIStore } from './store/ui-store';
import { useSettingsStore } from './store/settings-store';
import { useCalibrationStore } from './store/calibration-store';
import { serializeMainBlock, serializePattern, serializePatternCommand } from '@lib/serializer';
import type { Pattern, Program } from '@lib/types';
import { parsePatternBlock, parseMainBlockText } from '@lib/parser';
import { searchProgram } from '@lib/search';
import type { SearchScope } from '@lib/search';
import { PROFILES, profileLabel, getProfile, type SyntaxProfile } from '@lib/syntax-profiles';
import Canvas from './components/visualization/Canvas';
import PatternCommandList from './components/PatternCommandList';
import ToolPanel from './components/ToolPanel';
import HistoryPanel from './components/HistoryPanel';
import ContextMenu, { useCommandContextMenu } from './components/ContextMenu';
import SettingsPanel from './components/SettingsPanel';
import { useT } from './hooks/useT';

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
  const t = useT();
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
        {t('menu.file')}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-0.5 bg-gray-800 border border-gray-600 rounded shadow-xl z-50 min-w-44 py-1">
          {item(t('menu.open'), load)}
          {item(t('menu.save'), save, !program)}
          {item(t('menu.saveAs'), saveAs, !program)}
          <div className="my-1 border-t border-gray-700" />
          {item(t('menu.loadBg'), loadBackgroundImage, !patternKey)}
        </div>
      )}
    </div>
  );
}

// ── Version Selector ──────────────────────────────────────────────────────────

function VersionSelector() {
  const t = useT();
  const softwareType    = useSettingsStore((s) => s.softwareType);
  const version         = useSettingsStore((s) => s.version);
  const setSoftwareType = useSettingsStore((s) => s.setSoftwareType);
  const setVersion      = useSettingsStore((s) => s.setVersion);
  const reloadWithProfile = useProgramStore((s) => s.reloadWithProfile);

  const [open, setOpen]             = useState(false);
  const [errorDialog, setErrorDialog] = useState<{ profile: string; previous: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const currentLabel = `${softwareType} V${version}`;

  const handleSelect = useCallback(async (profile: SyntaxProfile) => {
    setOpen(false);
    if (profile.softwareType === softwareType && profile.version === version) return;

    const previousLabel = currentLabel;
    const newLabel = profileLabel(profile);

    // Optimistically update settings
    await setSoftwareType(profile.softwareType);
    await setVersion(profile.version);

    // Re-parse the current file with the new profile
    const ok = await reloadWithProfile(profile);
    if (!ok) {
      // Revert settings
      const prev = getProfile(softwareType, version);
      await setSoftwareType(prev.softwareType);
      await setVersion(prev.version);
      setErrorDialog({ profile: newLabel, previous: previousLabel });
    }
  }, [softwareType, version, currentLabel, setSoftwareType, setVersion, reloadWithProfile]);

  return (
    <>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 px-2 py-0.5 text-xs text-gray-400 font-mono rounded hover:bg-gray-700 hover:text-gray-200 transition-colors"
        >
          {currentLabel}
          <span className="text-[8px] text-gray-500">▾</span>
        </button>
        {open && (
          <div className="absolute top-full left-0 mt-0.5 bg-gray-800 border border-gray-600 rounded shadow-xl z-50 py-1 min-w-[110px]">
            {PROFILES.map((p) => {
              const label = profileLabel(p);
              const active = p.softwareType === softwareType && p.version === version;
              return (
                <button
                  key={label}
                  onClick={() => handleSelect(p)}
                  className={[
                    'w-full text-left px-4 py-1.5 text-xs font-mono transition-colors',
                    active
                      ? 'text-blue-300 bg-blue-900/30'
                      : 'text-gray-300 hover:bg-gray-600',
                  ].join(' ')}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {errorDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-5 w-80">
            <h3 className="text-sm font-semibold text-gray-100 mb-3">{t('version.err.title')}</h3>
            <p className="text-sm text-gray-300 mb-5">
              {t('version.err.body', { profile: errorDialog.profile, previous: errorDialog.previous })}
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setErrorDialog(null)}
                className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
              >
                {t('version.err.ok')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function Toolbar() {
  const t = useT();
  const { filePath, isDirty } = useProgramStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <header className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border-b border-gray-700 shrink-0">
        <FileMenu />
        <button
          onClick={() => setSettingsOpen(true)}
          className="px-3 py-1 text-sm rounded hover:bg-gray-700"
        >
          {t('menu.settings')}
        </button>
        <div className="w-px h-4 bg-gray-600 mx-1" />
        <VersionSelector />
        <div className="w-px h-4 bg-gray-600 mx-1" />
        <span className="flex-1 text-sm text-gray-300 truncate">
          {filePath ? (
            <>
              {basename(filePath)}
              {isDirty && <span className="text-yellow-400 ml-1">*</span>}
            </>
          ) : (
            <span className="text-gray-500">{t('toolbar.noFile')}</span>
          )}
        </span>
      </header>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </>
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

// ── New Subpattern Dialog ─────────────────────────────────────────────────────

function NewSubpatternDialog({
  patterns,
  onConfirm,
  onCancel,
}: {
  patterns: Pattern[];
  onConfirm: (name: string, copyFrom: string | null) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [copyFrom, setCopyFrom] = useState('__empty__');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const existingNames = useMemo(() => new Set(patterns.map((p) => p.name)), [patterns]);
  const nameError = !name.trim()
    ? t('dialog.newSub.errEmpty')
    : existingNames.has(name.trim())
    ? t('dialog.newSub.errExists')
    : null;

  const handleConfirm = () => {
    if (nameError) return;
    onConfirm(name.trim(), copyFrom === '__empty__' ? null : copyFrom);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-5 w-72">
        <h3 className="text-sm font-semibold text-gray-100 mb-4">{t('dialog.newSub.title')}</h3>

        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">{t('dialog.newSub.name')}</label>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); e.stopPropagation(); }}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            placeholder="e.g. Pattern1"
          />
          {nameError && <p className="text-xs text-red-400 mt-1">{nameError}</p>}
        </div>

        <div className="mb-5">
          <label className="block text-xs text-gray-400 mb-1">{t('dialog.newSub.copyFrom')}</label>
          <select
            value={copyFrom}
            onChange={(e) => setCopyFrom(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          >
            <option value="__empty__">{t('dialog.newSub.empty')}</option>
            {patterns.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
          >
            {t('dialog.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={Boolean(nameError)}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-default text-white rounded"
          >
            {t('dialog.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Subpattern Dialog ──────────────────────────────────────────────────

function DeleteSubpatternDialog({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); e.stopPropagation(); }
      if (e.key === 'Enter')  { onConfirm(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onConfirm, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-5 w-72">
        <h3 className="text-sm font-semibold text-gray-100 mb-3">{t('dialog.delSub.title')}</h3>
        <p className="text-sm text-gray-300 mb-5">
          {t('dialog.delSub.body', { name: `'${name}'` })}
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
          >
            {t('dialog.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-500 text-white rounded"
          >
            {t('dialog.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Pattern Selector ──────────────────────────────────────────────────────────

function PatternSelector() {
  const t = useT();
  const { program, selectedPatternName, selectPattern,
          createSubpattern, deleteSubpattern } = useProgramStore();
  const historyPanelOpen    = useUIStore((s) => s.historyPanelOpen);
  const setHistoryPanelOpen = useUIStore((s) => s.setHistoryPanelOpen);

  const [showNewDialog, setShowNewDialog]       = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [dropdownOpen, setDropdownOpen]         = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close the mini dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [dropdownOpen]);

  if (!program) return <div className="px-3 py-2 text-xs text-gray-500 shrink-0">{t('pattern.noFile')}</div>;

  const canDelete = selectedPatternName !== null;

  return (
    <>
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-700 shrink-0">
        {/* Split [+|▾] button */}
        <div className="flex items-center shrink-0">
          {/* + part: open New dialog directly */}
          <button
            onClick={() => { setDropdownOpen(false); setShowNewDialog(true); }}
            title={t('pattern.newSubpattern')}
            className="flex items-center justify-center w-6 h-7 rounded-l bg-gray-700 hover:bg-gray-600 border border-gray-600 border-r-0 text-gray-200 text-base leading-none"
          >
            +
          </button>
          {/* ▾ part: open mini dropdown */}
          <div ref={dropdownRef} className="relative">
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className="flex items-center justify-center w-[14px] h-7 rounded-r bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-400 text-[9px]"
            >
              ▾
            </button>
            {dropdownOpen && (
              <div className="absolute left-0 top-full mt-0.5 bg-gray-900 border border-gray-700 rounded shadow-xl py-0.5 z-50 whitespace-nowrap min-w-[190px]">
                <button
                  onClick={() => { setDropdownOpen(false); setShowNewDialog(true); }}
                  className="flex items-center w-full px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700/60 text-left"
                >
                  {t('pattern.newSubpattern')}
                </button>
                <button
                  onClick={() => {
                    if (!canDelete) return;
                    setDropdownOpen(false);
                    setShowDeleteDialog(true);
                  }}
                  disabled={!canDelete}
                  title={!canDelete ? 'Cannot delete Main block' : undefined}
                  className="flex items-center w-full px-3 py-1.5 text-xs text-red-400 hover:bg-gray-700/60 disabled:opacity-40 disabled:cursor-default text-left"
                >
                  {t('pattern.deleteSubpattern')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Pattern dropdown */}
        <select
          value={selectedPatternName ?? '__main__'}
          onChange={(e) => selectPattern(e.target.value === '__main__' ? null : e.target.value)}
          className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
        >
          <option value="__main__">{t('pattern.main')}</option>
          {program.patterns.map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </select>

        {/* History toggle */}
        <button
          onClick={() => setHistoryPanelOpen(!historyPanelOpen)}
          title={t('pattern.historyToggle')}
          className={[
            'shrink-0 w-7 h-7 flex items-center justify-center rounded transition-colors',
            historyPanelOpen
              ? 'bg-amber-600/30 text-amber-300 border border-amber-500/50'
              : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200 border border-transparent',
          ].join(' ')}
        >
          <HistoryToggleIcon />
        </button>

        {/* Raw mode toggle */}
        <div className="w-px h-4 bg-gray-600 shrink-0" />
        <RawModeToggle />
      </div>

      {showNewDialog && (
        <NewSubpatternDialog
          patterns={program.patterns}
          onConfirm={(name, copyFrom) => { createSubpattern(name, copyFrom); setShowNewDialog(false); }}
          onCancel={() => setShowNewDialog(false)}
        />
      )}

      {showDeleteDialog && selectedPatternName !== null && (
        <DeleteSubpatternDialog
          name={selectedPatternName}
          onConfirm={() => { deleteSubpattern(selectedPatternName); setShowDeleteDialog(false); }}
          onCancel={() => setShowDeleteDialog(false)}
        />
      )}
    </>
  );
}

// ── Text Pane ─────────────────────────────────────────────────────────────────

function TextPane() {
  const t = useT();
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
        {t('app.openFile')}
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

// ── Expand/collapse all helpers ───────────────────────────────────────────────

/** Collect all positional group keys in depth-first order, mirroring the key
 *  scheme used by buildFlatItemsInner in PatternCommandList.tsx. */
function collectAllGroupKeys(
  commands: import('@lib/types').PatternCommand[],
  keyPrefix = '',
  result: string[] = [],
): string[] {
  commands.forEach((cmd, i) => {
    if (cmd.kind === 'Group') {
      const key = keyPrefix ? `${keyPrefix}-${i}` : String(i);
      result.push(key);
      collectAllGroupKeys(cmd.commands, key, result);
    }
  });
  return result;
}

// ── Command Pane ──────────────────────────────────────────────────────────────
// Routes to raw text (Main block) or structured command list (patterns),
// or to PlainTextEditor when plain text mode is active.

function CommandPane() {
  const t = useT();
  const {
    program, selectedPatternName, filePath,
    selectedCommandIds, lastSelectedId,
    selectOne, selectToggle, selectRange, clearSelection,
    reorderCommands,
  } = useProgramStore();
  const { showMenu } = useCommandContextMenu();
  const plainTextMode       = useUIStore((s) => s.plainTextMode);
  const expandAllTrigger    = useUIStore((s) => s.expandAllTrigger);
  const collapseAllTrigger  = useUIStore((s) => s.collapseAllTrigger);

  // Per-pattern expanded-group tracking. Lives here (not in PatternCommandList) so
  // state persists when switching to the main block view and back.
  const [expandedByPattern, setExpandedByPattern] = useState<Map<string, Set<string>>>(new Map());

  // Reset when a new file is opened.
  useEffect(() => {
    setExpandedByPattern(new Map());
  }, [filePath]);

  const expandedGroups: Set<string> =
    expandedByPattern.get(selectedPatternName ?? '') ?? new Set();

  const setExpandedGroups = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      setExpandedByPattern((prev) => {
        const key = selectedPatternName ?? '';
        const current = prev.get(key) ?? new Set<string>();
        return new Map(prev).set(key, updater(current));
      });
    },
    [selectedPatternName],
  );

  // Expand all groups in the current pattern when triggered from the context menu
  useEffect(() => {
    if (expandAllTrigger === 0) return;
    const { program: prog, selectedPatternName: patName } = useProgramStore.getState();
    if (!prog || !patName) return;
    const pattern = prog.patterns.find((p) => p.name === patName);
    if (!pattern) return;
    const allKeys = collectAllGroupKeys(pattern.commands);
    setExpandedGroups(() => new Set(allKeys));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandAllTrigger, setExpandedGroups]);

  // Collapse all groups in the current pattern when triggered from the context menu
  useEffect(() => {
    if (collapseAllTrigger === 0) return;
    setExpandedGroups(() => new Set());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseAllTrigger, setExpandedGroups]);

  if (!program) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
        {t('app.openFile')}
      </div>
    );
  }

  // Plain text mode — show editable textarea for the current block
  if (plainTextMode) {
    return (
      <PlainTextEditor
        key={selectedPatternName ?? '__main__'}
        selectedPatternName={selectedPatternName}
      />
    );
  }

  if (selectedPatternName === null) {
    return <TextPane />;
  }

  const pattern = program.patterns.find((p) => p.name === selectedPatternName);
  if (!pattern) return <div className="flex-1" />;

  return (
    <PatternCommandList
      commands={pattern.commands}
      selectedCommandIds={selectedCommandIds}
      lastSelectedId={lastSelectedId}
      expandedGroups={expandedGroups}
      setExpandedGroups={setExpandedGroups}
      onSelect={(id, mode, allIds) => {
        if (mode === 'toggle') selectToggle(id);
        else if (mode === 'range') selectRange(id, allIds);
        else selectOne(id);
      }}
      onClear={clearSelection}
      onReorder={reorderCommands}
      onContextMenu={(e, cmdId) => {
        e.preventDefault();
        // Select the row first if not already in selection
        if (cmdId) {
          const { selectedCommandIds: ids } = useProgramStore.getState();
          if (!ids.has(cmdId)) selectOne(cmdId);
        }
        showMenu(e.clientX, e.clientY, pattern.commands);
      }}
    />
  );
}

// ── Plain Text Editor ─────────────────────────────────────────────────────────

// text-xs (12px) × leading-relaxed (1.625) = 19.5px per line; p-3 = 12px padding
const RAW_LINE_HEIGHT = 12 * 1.625; // px
const RAW_PADDING     = 12;         // px (p-3)

/**
 * Renders a monospace textarea with line numbers and (at mount time) highlights
 * for any lines that correspond to the current selection.
 *
 * Mount with a key equal to the pattern name (or "__main__") so the component
 * fully resets when the user switches patterns.
 */
function PlainTextEditor({ selectedPatternName }: { selectedPatternName: string | null }) {
  const applyPatternTextEdit    = useProgramStore((s) => s.applyPatternTextEdit);
  const applyMainTextEdit       = useProgramStore((s) => s.applyMainTextEdit);
  const setPlainTextParseStatus = useUIStore((s) => s.setPlainTextParseStatus);

  // Derive the initial text and highlighted lines once from the current program snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { initialText, selectedLineIndices } = useMemo(() => {
    const { program: prog, selectedCommandIds: selIds } = useProgramStore.getState();
    if (!prog) return { initialText: '', selectedLineIndices: new Set<number>() };

    if (selectedPatternName === null) {
      return { initialText: serializeMainBlock(prog), selectedLineIndices: new Set<number>() };
    }

    const pat = prog.patterns.find((p) => p.name === selectedPatternName);
    if (!pat) return { initialText: '', selectedLineIndices: new Set<number>() };

    const annotated = annotatePattern(pat);
    const highlighted = new Set<number>();
    annotated.forEach((line, i) => {
      if (line.commandIndex !== null) {
        const cmd = pat.commands[line.commandIndex];
        if (cmd?.id && selIds.has(cmd.id)) highlighted.add(i);
      }
    });
    return { initialText: serializePattern(pat), selectedLineIndices: highlighted };
  }, []); // intentionally empty — only run once on mount; key prop handles resets

  const [text, setText] = useState(initialText);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const lineNumRef   = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const lines = text.split('\n');

  // Sync line-number gutter + highlight overlay scroll to textarea scroll
  const syncScroll = useCallback(() => {
    const st = textareaRef.current?.scrollTop ?? 0;
    if (lineNumRef.current)   lineNumRef.current.scrollTop   = st;
    if (highlightRef.current) highlightRef.current.scrollTop = st;
  }, []);

  // Clear debounce on unmount
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // Reset parse status to idle when this editor instance is fresh
  useEffect(() => { setPlainTextParseStatus('idle', null); }, [setPlainTextParseStatus]);

  const attemptParse = useCallback((value: string) => {
    try {
      if (selectedPatternName === null) {
        const main = parseMainBlockText(value);
        applyMainTextEdit(main);
      } else {
        const commands = parsePatternBlock(value);
        applyPatternTextEdit(selectedPatternName, commands);
      }
      setPlainTextParseStatus('valid', null);
    } catch (err) {
      setPlainTextParseStatus('error', err instanceof Error ? err.message : String(err));
    }
  }, [selectedPatternName, applyPatternTextEdit, applyMainTextEdit, setPlainTextParseStatus]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    setPlainTextParseStatus('idle', null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => attemptParse(val), 500);
  };

  return (
    <div className="flex flex-1 overflow-hidden bg-gray-950">
      {/* Line-number gutter */}
      <div
        ref={lineNumRef}
        className="overflow-hidden shrink-0 select-none bg-gray-900 border-r border-gray-700/60"
        style={{ paddingTop: RAW_PADDING, paddingBottom: RAW_PADDING }}
      >
        {lines.map((_, i) => (
          <div
            key={i}
            style={{
              height: RAW_LINE_HEIGHT,
              lineHeight: `${RAW_LINE_HEIGHT}px`,
              paddingLeft: 8,
              paddingRight: 10,
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              color: selectedLineIndices.has(i) ? '#93c5fd' : '#4b5563',
              backgroundColor: selectedLineIndices.has(i) ? 'rgba(59,130,246,0.15)' : 'transparent',
              textAlign: 'right',
            }}
          >
            {i + 1}
          </div>
        ))}
      </div>

      {/* Highlight overlay + editable textarea */}
      <div className="relative flex-1 overflow-hidden">
        {/* Per-line highlight bands (pointer-events: none so textarea stays interactive) */}
        {selectedLineIndices.size > 0 && (
          <div
            ref={highlightRef}
            className="absolute inset-0 overflow-hidden pointer-events-none"
            style={{ paddingTop: RAW_PADDING }}
          >
            {lines.map((_, i) => (
              <div
                key={i}
                style={{
                  height: RAW_LINE_HEIGHT,
                  backgroundColor: selectedLineIndices.has(i) ? 'rgba(59,130,246,0.18)' : 'transparent',
                }}
              />
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="w-full h-full bg-transparent text-gray-200 font-mono text-xs leading-relaxed resize-none focus:outline-none border-0 relative z-10"
          style={{ padding: RAW_PADDING, caretColor: 'white' }}
          value={text}
          onChange={handleChange}
          onScroll={syncScroll}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>
    </div>
  );
}

// ── Raw Mode Toggle ───────────────────────────────────────────────────────────

/** Checkbox + parse-status indicator that live in the pattern-selector bar. */
function RawModeToggle() {
  const t                    = useT();
  const plainTextMode        = useUIStore((s) => s.plainTextMode);
  const setPlainTextMode     = useUIStore((s) => s.setPlainTextMode);
  const plainTextParseStatus = useUIStore((s) => s.plainTextParseStatus);
  const plainTextParseError  = useUIStore((s) => s.plainTextParseError);
  const setParseStatus       = useUIStore((s) => s.setPlainTextParseStatus);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  const handleToggle = (checked: boolean) => {
    if (!checked && plainTextParseStatus === 'error') {
      setShowDiscardDialog(true);
    } else {
      setPlainTextMode(checked);
      if (!checked) setParseStatus('idle', null);
    }
  };

  const handleDiscard = () => {
    setShowDiscardDialog(false);
    setPlainTextMode(false);
    setParseStatus('idle', null);
  };

  return (
    <>
      {showDiscardDialog && (
        <DiscardPlainTextDialog
          onDiscard={handleDiscard}
          onStay={() => setShowDiscardDialog(false)}
        />
      )}
      <div className="flex items-center gap-1 shrink-0">
        {plainTextMode && plainTextParseStatus !== 'idle' && (
          plainTextParseStatus === 'valid' ? (
            <span className="text-green-400 text-[10px] font-medium leading-none">✓</span>
          ) : (
            <span
              className="text-red-400 text-[10px] font-medium leading-none cursor-help"
              title={plainTextParseError ?? 'Parse error'}
            >✗</span>
          )
        )}
        <label className="flex items-center gap-1 cursor-pointer select-none">
          <span className="text-xs text-gray-400">{t('raw.label')}</span>
          <input
            type="checkbox"
            checked={plainTextMode}
            onChange={(e) => handleToggle(e.target.checked)}
            className="w-3 h-3 rounded accent-blue-500 cursor-pointer"
          />
        </label>
      </div>
    </>
  );
}

// ── Search Bar ────────────────────────────────────────────────────────────────

function SearchBar() {
  const t           = useT();
  const inputRef    = useRef<HTMLInputElement>(null);
  const replaceRef  = useRef<HTMLInputElement>(null);

  const program             = useProgramStore((s) => s.program);
  const selectedPatternName = useProgramStore((s) => s.selectedPatternName);
  const selectedCommandIds  = useProgramStore((s) => s.selectedCommandIds);
  const selectPattern       = useProgramStore((s) => s.selectPattern);
  const applySearchReplace  = useProgramStore((s) => s.applySearchReplace);

  const searchQuery      = useUIStore((s) => s.searchQuery);
  const searchScope      = useUIStore((s) => s.searchScope);
  const searchMatchList  = useUIStore((s) => s.searchMatchList);
  const searchFocusedIdx = useUIStore((s) => s.searchFocusedIdx);
  const setSearchQuery   = useUIStore((s) => s.setSearchQuery);
  const setSearchScope   = useUIStore((s) => s.setSearchScope);
  const setSearchResults = useUIStore((s) => s.setSearchResults);
  const stepSearchFocus  = useUIStore((s) => s.stepSearchFocus);
  const clearSearch      = useUIStore((s) => s.clearSearch);

  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceText, setReplaceText] = useState('');
  const [toast, setToast] = useState<{ message: string; key: number } | null>(null);

  const showToast = (message: string) => {
    const key = Date.now();
    setToast({ message, key });
    setTimeout(() => setToast((t) => (t?.key === key ? null : t)), 2500);
  };

  // Debounced search computation
  useEffect(() => {
    if (!program || !searchQuery.trim()) { setSearchResults([]); return; }
    const id = setTimeout(() => {
      const results = searchProgram(program, selectedPatternName, searchScope, searchQuery, selectedCommandIds);
      setSearchResults(results);
    }, 100);
    return () => clearTimeout(id);
  }, [program, selectedPatternName, searchScope, searchQuery, selectedCommandIds, setSearchResults]);

  // Ctrl+F / Ctrl+H — focus input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        if (document.activeElement === inputRef.current) {
          inputRef.current?.select();
        } else {
          inputRef.current?.focus();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault();
        setReplaceOpen(true);
        setTimeout(() => replaceRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      clearSearch();
      setReplaceOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchMatchList.length === 0) return;
      const dir: 1 | -1 = e.shiftKey ? -1 : 1;
      const nextIdx = ((searchFocusedIdx + dir) % searchMatchList.length + searchMatchList.length) % searchMatchList.length;
      const next = searchMatchList[nextIdx];
      if (next?.patternName && next.patternName !== selectedPatternName) {
        selectPattern(next.patternName);
      }
      stepSearchFocus(dir);
    }
    e.stopPropagation();
  };

  const handleReplace = () => {
    const focused = searchMatchList[searchFocusedIdx];
    if (!focused) return;
    applySearchReplace([focused], searchQuery, replaceText, 'Replace');
    stepSearchFocus(1);
  };

  const handleReplaceAll = () => {
    if (searchMatchList.length === 0) return;
    const n = searchMatchList.length;
    const count = applySearchReplace(
      searchMatchList,
      searchQuery,
      replaceText,
      `Replace All: ${n} occurrence${n !== 1 ? 's' : ''}`,
    );
    showToast(t('search.replacedCount', { count: String(count) }));
  };

  const totalCount = searchMatchList.length;
  const currentCount = searchQuery.trim() && totalCount > 0 ? searchFocusedIdx + 1 : null;

  return (
    <div className="flex flex-col gap-0.5 shrink-0">
      {/* ── Search row ── */}
      <div className="flex items-center gap-1.5">
        {/* Chevron toggle */}
        <button
          onClick={() => setReplaceOpen((v) => !v)}
          title={replaceOpen ? t('search.hideReplace') : t('search.showReplace')}
          className="text-gray-500 hover:text-gray-300 w-3 h-3 flex items-center justify-center shrink-0 leading-none"
          tabIndex={-1}
        >
          {replaceOpen ? '▾' : '▸'}
        </button>

        {/* Input with magnifier + clear */}
        <div className="relative flex items-center">
          <svg className="absolute left-1.5 text-gray-500 pointer-events-none" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <circle cx="4.5" cy="4.5" r="3.5" />
            <line x1="7.5" y1="7.5" x2="10" y2="10" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('search.placeholder')}
            className={[
              'w-[160px] pl-6 pr-6 py-0.5 bg-gray-700 border rounded text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors',
              searchQuery.trim() && totalCount === 0
                ? 'border-red-500/70'
                : 'border-gray-600',
            ].join(' ')}
          />
          {searchQuery && (
            <button
              onClick={() => clearSearch()}
              className="absolute right-1.5 text-gray-500 hover:text-gray-300 leading-none"
              tabIndex={-1}
            >
              ×
            </button>
          )}
        </div>

        {/* Match count */}
        {searchQuery.trim() && (
          <span className={`text-[10px] shrink-0 tabular-nums ${totalCount === 0 ? 'text-red-400' : 'text-gray-400'}`}>
            {totalCount === 0 ? t('search.noMatches') : `${currentCount ?? 0}/${totalCount}`}
          </span>
        )}

        {/* Scope dropdown */}
        <select
          value={searchScope}
          onChange={(e) => setSearchScope(e.target.value as SearchScope)}
          className="bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-[10px] text-gray-300 focus:outline-none focus:border-blue-500 cursor-pointer"
        >
          {(['pattern', 'program', 'selection'] as SearchScope[]).map((s) => (
            <option
              key={s}
              value={s}
              disabled={s === 'selection' && selectedCommandIds.size === 0}
            >
              {t(`search.scope.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {/* ── Replace row ── */}
      {replaceOpen && (
        <div className="flex items-center gap-1.5 pl-4">
          <div className="relative flex items-center">
            <svg className="absolute left-1.5 text-gray-500 pointer-events-none" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 3 C1 1.5 2 1 3.5 1 C5 1 6 2 6 3.5 C6 5 4 6 3 7 L3 8" />
              <path d="M1 9 L5 9" />
              <path d="M8 4 L9 5 L8 6" />
              <path d="M4 5 L9 5" />
            </svg>
            <input
              ref={replaceRef}
              type="text"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleReplace(); }
                if (e.key === 'Escape') { setReplaceOpen(false); inputRef.current?.focus(); }
                e.stopPropagation();
              }}
              placeholder={t('search.replacePh')}
              className="w-[160px] pl-6 py-0.5 bg-gray-700 border border-gray-600 rounded text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <button
            onClick={handleReplace}
            disabled={!searchQuery.trim() || searchMatchList.length === 0}
            className="px-2 py-0.5 text-[10px] bg-gray-700 border border-gray-600 rounded hover:bg-gray-600 disabled:opacity-40 disabled:cursor-default text-gray-300 shrink-0"
          >
            {t('search.replaceBtn')}
          </button>
          <button
            onClick={handleReplaceAll}
            disabled={!searchQuery.trim() || searchMatchList.length === 0}
            className="px-2 py-0.5 text-[10px] bg-gray-700 border border-gray-600 rounded hover:bg-gray-600 disabled:opacity-40 disabled:cursor-default text-gray-300 shrink-0"
          >
            {t('search.allBtn')}
          </button>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-600 rounded shadow-xl px-4 py-2 text-xs text-gray-200 z-50 pointer-events-none">
          {toast.message}
        </div>
      )}
    </div>
  );
}

// ── Discard Plain Text Dialog ─────────────────────────────────────────────────

function DiscardPlainTextDialog({
  onDiscard,
  onStay,
}: {
  onDiscard: () => void;
  onStay: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onStay(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onStay]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-5 w-80">
        <h3 className="text-sm font-semibold text-gray-100 mb-3">{t('dialog.discard.title')}</h3>
        <p className="text-sm text-gray-300 mb-5">
          {t('dialog.discard.body')}
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onStay}
            className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
          >
            {t('dialog.discard.stay')}
          </button>
          <button
            onClick={onDiscard}
            className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-500 text-white rounded"
          >
            {t('dialog.discard.discard')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Status Bar ────────────────────────────────────────────────────────────────

function StatusBar() {
  const t = useT();
  const { program, isDirty } = useProgramStore();
  const { zoomLevel, cursorCoords, splitRatio, triggerFitToView } = useUIStore();

  // Mirror the main split: canvas% + ToolPanel (40px) + drag handle (4px)
  const leftWidth = `calc(${splitRatio * 100}% + 44px)`;

  return (
    <footer className="flex items-start bg-gray-800 border-t border-gray-700 text-xs text-gray-400 shrink-0">
      {/* Left section — aligns with the canvas */}
      <div
        className="flex items-center gap-3 px-3 py-1 shrink-0 min-w-0"
        style={{ width: leftWidth }}
      >
        <span className={isDirty ? 'text-yellow-400' : program ? 'text-green-400' : ''}>
          {program ? (isDirty ? t('status.modified') : t('status.ready')) : t('status.noFile')}
        </span>
        {cursorCoords && (
          <span>x: {cursorCoords.x.toFixed(3)}, y: {cursorCoords.y.toFixed(3)}</span>
        )}
      </div>

      {/* Right section — aligns with the command pane */}
      <div className="flex flex-1 items-start gap-3 px-3 py-1 min-w-0">
        {program && <SearchBar />}
        <span className="flex-1" />
        <button
          onClick={triggerFitToView}
          title={t('status.fitView')}
          className="shrink-0 self-center hover:text-blue-300 transition-colors cursor-pointer"
        >
          {zoomLevel.toFixed(1)}x
        </button>
      </div>
    </footer>
  );
}

// ── Save Error Toast ──────────────────────────────────────────────────────────

function SaveErrorToast() {
  const t = useT();
  const { saveError, clearSaveError, saveAs } = useProgramStore();
  if (!saveError) return null;
  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-red-900 border border-red-600 text-red-100 text-sm px-4 py-2.5 rounded-lg shadow-xl max-w-lg">
      <span className="flex-1">{saveError}</span>
      <button
        onClick={() => { saveAs(); clearSaveError(); }}
        className="shrink-0 bg-red-700 hover:bg-red-600 px-2 py-0.5 rounded text-xs whitespace-nowrap"
      >
        {t('error.saveAs')}
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
      // Skip shortcuts when typing in an input / textarea
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

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
      if (!inInput) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
          useProgramStore.getState().copySelection();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
          e.preventDefault();
          useProgramStore.getState().cutSelection();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
          e.preventDefault();
          useProgramStore.getState().pasteAboveSelection();
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          useProgramStore.getState().deleteSelection();
          return;
        }
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
      <ContextMenu />

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
