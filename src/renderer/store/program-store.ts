import { create } from 'zustand';
import type { Program, Pattern, PatternCommand, LineCommand, DotCommand, CommentCommand, GroupNode } from '@lib/types';
import { parse } from '@lib/parser';
import { serialize } from '@lib/serializer';
import { getProfile, type SyntaxProfile } from '@lib/syntax-profiles';
import { applyReplace } from '@lib/search';
import type { SearchMatch } from '@lib/search';
import { useSettingsStore } from './settings-store';
import { useUIStore } from './ui-store';
import { computeAffine } from '@lib/affine';
import { useCalibrationStore } from './calibration-store';

function activeProfile(): SyntaxProfile {
  const { softwareType, version } = useSettingsStore.getState();
  return getProfile(softwareType, version);
}

const MAX_HISTORY = 200;

// ── History ───────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  label: string;
  timestamp: number;
  snapshot: Program;
  /** True for the synthetic "Saved to disk" marker inserted after a successful save. */
  isSaveMarker?: boolean;
}

// ── Local helpers ─────────────────────────────────────────────────────────────

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function ptKey(p: [number, number, number]): string {
  return `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`;
}

function cloneCmds(cmds: PatternCommand[]): PatternCommand[] {
  return cmds.map((cmd): PatternCommand => {
    if (cmd.kind === 'Line') return {
      ...cmd,
      startPoint: [cmd.startPoint[0], cmd.startPoint[1], cmd.startPoint[2]],
      endPoint: [cmd.endPoint[0], cmd.endPoint[1], cmd.endPoint[2]],
      _raw: cmd._raw ? { ...cmd._raw } : undefined,
    };
    if (cmd.kind === 'Dot') return { ...cmd, point: [cmd.point[0], cmd.point[1], cmd.point[2]] };
    if (cmd.kind === 'Group') return { ...cmd, commands: cloneCmds(cmd.commands) };
    return { ...cmd };
  });
}

function findById(cmds: PatternCommand[], id: string): PatternCommand | null {
  for (const c of cmds) {
    if (c.id === id) return c;
    if (c.kind === 'Group') { const f = findById(c.commands, id); if (f) return f; }
  }
  return null;
}

function collectSelectedLines(cmds: PatternCommand[], ids: Set<string>): LineCommand[] {
  const result: LineCommand[] = [];
  for (const c of cmds) {
    if (c.kind === 'Line' && c.id && ids.has(c.id)) result.push(c);
    else if (c.kind === 'Group') result.push(...collectSelectedLines(c.commands, ids));
  }
  return result;
}

function makeEntry(label: string, snapshot: Program): HistoryEntry {
  return { id: genId(), label, timestamp: Date.now(), snapshot };
}

/** Recursively collect commands whose IDs are in `ids`. If a group is selected,
 *  the whole group is included (children not collected separately). */
function collectSelected(cmds: PatternCommand[], ids: Set<string>): PatternCommand[] {
  const result: PatternCommand[] = [];
  for (const c of cmds) {
    if (c.id && ids.has(c.id)) {
      result.push(c);
    } else if (c.kind === 'Group') {
      result.push(...collectSelected(c.commands, ids));
    }
  }
  return result;
}

/** Remove commands matching `ids` recursively. */
function removeSelected(cmds: PatternCommand[], ids: Set<string>): PatternCommand[] {
  return cmds
    .filter((c) => !c.id || !ids.has(c.id))
    .map((c) =>
      c.kind === 'Group' ? { ...c, commands: removeSelected(c.commands, ids) } : c,
    );
}

/**
 * Replace the command identified by `id` anywhere in the tree with the
 * result of applying `applyReplace`. Returns the modified list or null if
 * the command was not found or the replacement was not applicable.
 */
function replaceSearchMatch(
  cmds: PatternCommand[],
  id: string,
  queryLower: string,
  replacement: string,
): PatternCommand[] | null {
  for (let i = 0; i < cmds.length; i++) {
    if (cmds[i].id === id) {
      const replaced = applyReplace(cmds[i], queryLower, replacement);
      if (!replaced) return null;
      return [...cmds.slice(0, i), replaced, ...cmds.slice(i + 1)];
    }
    if (cmds[i].kind === 'Group') {
      const inner = replaceSearchMatch(
        (cmds[i] as GroupNode).commands, id, queryLower, replacement,
      );
      if (inner) {
        return [
          ...cmds.slice(0, i),
          { ...(cmds[i] as GroupNode), commands: inner },
          ...cmds.slice(i + 1),
        ];
      }
    }
  }
  return null;
}

/** Deep-clone and assign fresh IDs to a command list. */
function reIdCommands(cmds: PatternCommand[]): PatternCommand[] {
  return cmds.map((cmd): PatternCommand => {
    const newId = genId();
    if (cmd.kind === 'Group') return { ...cmd, id: newId, commands: reIdCommands(cmd.commands) };
    return { ...cmd, id: newId };
  });
}

// ── Re-export genId so Canvas can use the same generator ─────────────────────
export { genId };

interface ProgramStore {
  program: Program | null;
  filePath: string | null;
  isDirty: boolean;
  saveError: string | null;
  selectedPatternName: string | null;
  selectedCommandIds: Set<string>;
  lastSelectedId: string | null;

  // ── History ──────────────────────────────────────────────────────────────
  historyEntries: HistoryEntry[];
  historyCurrentIndex: number;

  load: () => Promise<void>;
  /** Re-read the current file from disk and re-parse with the given profile.
   *  Returns true on success, false if the file could not be parsed. */
  reloadWithProfile: (profile: SyntaxProfile) => Promise<boolean>;
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  clearSaveError: () => void;
  /** Push a new history entry and update the program. Discards any future branch. */
  setProgram: (program: Program, label?: string) => void;
  selectPattern: (name: string | null) => void;
  selectOne: (id: string | null) => void;
  selectToggle: (id: string) => void;
  selectRange: (id: string, allIds: string[]) => void;
  clearSelection: () => void;
  undo: () => void;
  redo: () => void;
  /** Jump to a specific history entry by index (works for past and future). */
  jumpToHistory: (index: number) => void;
  insertAfterSelection: (cmd: PatternCommand, label?: string) => void;
  bulkInsertAfterSelection: (cmds: PatternCommand[], label?: string) => void;
  /**
   * Insert a single command ABOVE the first selected command (or at the end
   * if nothing is selected). Used by New Line, New Dot, and New Comment tools.
   * After insertion the new command becomes the selection.
   */
  insertAboveSelection: (cmd: PatternCommand, label?: string) => void;
  mergeEndToStart: () => void;
  mergeStartToEnd: () => void;
  disconnectLines: () => void;
  groupSelection: (name: string) => void;
  ungroupSelection: () => void;
  /** Replace the top-level command matching `id` in the selected pattern. */
  replaceCommand: (id: string, newCmd: PatternCommand, label: string) => void;
  /** Split a Line command into two at the given world-space point. */
  splitLine: (cmdId: string, splitPoint: [number, number, number]) => void;
  /** Join an ordered list of connected Line commands into one. */
  joinLines: (cmdIds: string[]) => void;

  // ── Subpattern management ─────────────────────────────────────────────────
  createSubpattern: (name: string, copyFromName: string | null) => void;
  deleteSubpattern: (name: string) => void;

  // ── Reorder / Delete ─────────────────────────────────────────────────────
  /** Move a set of commands to a new position in the AST. */
  reorderCommands: (draggedIds: string[], insertBeforeId: string | null, targetGroupId: string | null) => void;
  /** Delete a single command by ID (does not require it to be selected). */
  deleteCommand: (id: string) => void;
  /** Rename a Group command by ID. */
  renameGroup: (id: string, newName: string) => void;
  /**
   * Shift all selected dispense commands (Line, Dot) and selected Groups by
   * (dx, dy) in world-space mm. Area-fill polygon metadata is updated in-place
   * so re-editing the group loads the correct polygon position.
   * Creates one undo history entry: "Move N commands".
   */
  moveSelection: (dx: number, dy: number) => void;

  // ── Search Replace ────────────────────────────────────────────────────────
  /**
   * Apply a text replacement to each of the given search matches.
   * Matches that cannot be replaced (metadata, unrecognised kind) are skipped.
   * Returns the number of successfully replaced commands.
   * Pushes a single history entry with the provided label.
   */
  applySearchReplace: (
    matches: SearchMatch[],
    query: string,
    replacement: string,
    label: string,
  ) => number;

  // ── Background image metadata ─────────────────────────────────────────────
  /**
   * Insert, update, or remove the `##BG_IMAGE:` metadata comment in the named
   * pattern's command list. Does NOT push a history entry — this is side-channel
   * metadata that the user never touches directly.
   * Pass `imgFilePath = null` to remove any existing comment.
   */
  setBgImageComment: (
    patternName: string,
    imgFilePath: string | null,
    points: import('@lib/affine').CalibPoint[],
  ) => void;

  // ── Plain-text editing ────────────────────────────────────────────────────
  /**
   * Apply a successful parse result from the plain-text editor for a named
   * pattern. Coalesces into the previous history entry when it was also a
   * text edit within the last 2 seconds.
   */
  applyPatternTextEdit: (patternName: string, commands: PatternCommand[]) => void;
  /**
   * Apply a successful parse result from the plain-text editor for the main
   * block. Same coalescing behaviour as applyPatternTextEdit.
   */
  applyMainTextEdit: (newMain: import('@lib/types').MainBlock) => void;

  // ── Clipboard ────────────────────────────────────────────────────────────
  clipboard: PatternCommand[] | null;
  copySelection: () => void;
  cutSelection: () => void;
  /** Paste clipboard contents above the first selected command. */
  pasteAboveSelection: () => void;
  deleteSelection: () => void;
}

declare global {
  interface Window {
    electronAPI: {
      openFile: () => Promise<{ filePath: string; content: string } | null>;
      saveFile: (filePath: string, content: string) => Promise<string | null>;
      saveFileAs: (content: string, defaultPath?: string) => Promise<string | null>;
      loadImage: () => Promise<{ filePath: string; buffer: ArrayBuffer; mime: string } | null>;
      readFile: (filePath: string) => Promise<string | null>;
      readImage: (filePath: string) => Promise<{ buffer: ArrayBuffer; mime: string } | null>;
      storeGet: (key: string) => Promise<unknown>;
      storeSet: (key: string, value: unknown) => Promise<void>;
      getProfiles: () => Promise<SyntaxProfile[]>;
      getUserProfilesDir: () => Promise<string>;
      reloadProfiles: () => Promise<SyntaxProfile[]>;
      openPath: (path: string) => Promise<void>;
    };
  }
}

// ── Internal helper: push a history entry, discard future branch, cap at MAX ──

function pushEntry(
  entries: HistoryEntry[],
  currentIndex: number,
  label: string,
  program: Program,
): { entries: HistoryEntry[]; currentIndex: number } {
  // Discard future branch
  const base = entries.slice(0, currentIndex + 1);
  base.push(makeEntry(label, structuredClone(program)));
  // Cap: always keep entry 0; drop entry 1 if over limit
  while (base.length > MAX_HISTORY && base.length > 1) {
    base.splice(1, 1);
  }
  return { entries: base, currentIndex: base.length - 1 };
}

export const useProgramStore = create<ProgramStore>((set, get) => ({
  program: null,
  filePath: null,
  isDirty: false,
  saveError: null,
  selectedPatternName: null,
  selectedCommandIds: new Set<string>(),
  lastSelectedId: null,
  historyEntries: [],
  historyCurrentIndex: -1,
  clipboard: null,

  load: async () => {
    const result = await window.electronAPI.openFile();
    if (!result) return;
    const profile = activeProfile();
    const program = parse(result.content, profile);
    const entry = makeEntry('File opened', structuredClone(program));
    set({
      program,
      filePath: result.filePath,
      isDirty: false,
      selectedPatternName: null,
      selectedCommandIds: new Set<string>(),
      lastSelectedId: null,
      historyEntries: [entry],
      historyCurrentIndex: 0,
    });

    // Scan all patterns for ##BG_IMAGE: metadata comments and populate
    // pendingBgImages (deferred — image file is NOT read from disk yet).
    const BG_PREFIX = '##BG_IMAGE:';
    for (const pattern of program.patterns) {
      const comment = pattern.commands.find(
        (c) => c.kind === 'Comment' && c.text.startsWith(BG_PREFIX),
      );
      if (!comment || comment.kind !== 'Comment') continue;
      try {
        const body = comment.text.slice(BG_PREFIX.length);
        const fields: Record<string, string> = {};
        body.split('|').forEach((f) => {
          const eq = f.indexOf('=');
          if (eq !== -1) fields[f.slice(0, eq)] = f.slice(eq + 1);
        });
        if (!fields.path || !fields.points) continue;
        const points = fields.points.split(';').map((seg) => {
          const [px, py, wx, wy] = seg.split(',').map(Number);
          return { imagePixel: [px, py] as [number, number], programCoord: [wx, wy] as [number, number] };
        }).filter((p) => p.imagePixel.every(isFinite) && p.programCoord.every(isFinite));
        if (points.length < 2) continue;
        const key = `${result.filePath}::${pattern.name}`;
        useUIStore.getState().setPendingBgImage(key, { filePath: fields.path, points });
        // Pre-load calibration data so the transform is available if the user enables the image
        const transform = computeAffine(points);
        useCalibrationStore.getState().setCalibration(key, { points, transform });
      } catch {
        // Malformed comment — ignore
      }
    }
  },

  reloadWithProfile: async (profile: SyntaxProfile) => {
    const { filePath } = get();
    if (!filePath) return true; // no file open — nothing to re-parse
    try {
      const content = await window.electronAPI.readFile(filePath);
      if (content === null) return false;
      const program = parse(content, profile);
      const entry = makeEntry('File opened', structuredClone(program));
      set({
        program,
        isDirty: false,
        selectedPatternName: null,
        selectedCommandIds: new Set<string>(),
        lastSelectedId: null,
        historyEntries: [entry],
        historyCurrentIndex: 0,
      });
      return true;
    } catch {
      return false;
    }
  },

  save: async () => {
    const { program, filePath } = get();
    if (!program) return;
    if (!filePath) return get().saveAs();
    const content = serialize(program, activeProfile());
    try {
      const result = await window.electronAPI.saveFile(filePath, content);
      if (result === null) {
        set({ saveError: 'Could not save the file — it may be read-only. Use File → Save As to save a copy.' });
      } else {
        set({ isDirty: false, saveError: null });
        // Insert a "Saved to disk" marker into history at the current position
        // without discarding the future branch (undone entries remain navigable).
        const { historyEntries, historyCurrentIndex } = get();
        const currentEntry = historyEntries[historyCurrentIndex];
        if (currentEntry) {
          const marker: HistoryEntry = {
            id: genId(),
            label: 'Saved to disk',
            timestamp: Date.now(),
            snapshot: currentEntry.snapshot,
            isSaveMarker: true,
          };
          const next = [
            ...historyEntries.slice(0, historyCurrentIndex + 1),
            marker,
            ...historyEntries.slice(historyCurrentIndex + 1),
          ];
          set({ historyEntries: next, historyCurrentIndex: historyCurrentIndex + 1 });
        }
      }
    } catch {
      set({ saveError: 'Save failed. Use File → Save As to save a copy.' });
    }
  },

  saveAs: async () => {
    const { program, filePath } = get();
    if (!program) return;
    const content = serialize(program, activeProfile());
    const savedPath = await window.electronAPI.saveFileAs(content, filePath ?? undefined);
    if (savedPath) set({ filePath: savedPath, isDirty: false });
  },

  setProgram: (program: Program, label = 'Edit') => {
    const { historyEntries, historyCurrentIndex } = get();
    const h = pushEntry(historyEntries, historyCurrentIndex, label, program);
    set({ program, isDirty: true, historyEntries: h.entries, historyCurrentIndex: h.currentIndex });
  },

  selectPattern: (name: string | null) =>
    set({ selectedPatternName: name, selectedCommandIds: new Set<string>(), lastSelectedId: null }),

  selectOne: (id: string | null) => {
    if (id === null) {
      set({ selectedCommandIds: new Set<string>(), lastSelectedId: null });
    } else {
      set({ selectedCommandIds: new Set([id]), lastSelectedId: id });
    }
  },

  selectToggle: (id: string) => {
    const { selectedCommandIds } = get();
    const next = new Set(selectedCommandIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    set({ selectedCommandIds: next, lastSelectedId: id });
  },

  selectRange: (id: string, allIds: string[]) => {
    const { lastSelectedId } = get();
    const anchorIdx = lastSelectedId ? allIds.indexOf(lastSelectedId) : -1;
    const targetIdx = allIds.indexOf(id);
    if (anchorIdx === -1 || targetIdx === -1) {
      set({ selectedCommandIds: new Set([id]), lastSelectedId: id });
      return;
    }
    const [lo, hi] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
    set({ selectedCommandIds: new Set(allIds.slice(lo, hi + 1)) });
  },

  clearSaveError: () => set({ saveError: null }),

  clearSelection: () => set({ selectedCommandIds: new Set<string>(), lastSelectedId: null }),

  undo: () => {
    const { historyEntries, historyCurrentIndex } = get();
    if (historyCurrentIndex <= 0) return;
    const i = historyCurrentIndex - 1;
    set({ program: structuredClone(historyEntries[i].snapshot), historyCurrentIndex: i, isDirty: true });
  },

  redo: () => {
    const { historyEntries, historyCurrentIndex } = get();
    if (historyCurrentIndex >= historyEntries.length - 1) return;
    const i = historyCurrentIndex + 1;
    set({ program: structuredClone(historyEntries[i].snapshot), historyCurrentIndex: i, isDirty: true });
  },

  jumpToHistory: (index: number) => {
    const { historyEntries } = get();
    if (index < 0 || index >= historyEntries.length) return;
    set({ program: structuredClone(historyEntries[index].snapshot), historyCurrentIndex: index, isDirty: true });
  },

  insertAfterSelection: (cmd: PatternCommand, label = 'Insert command') => {
    const { program, selectedPatternName, lastSelectedId, historyEntries, historyCurrentIndex } = get();
    if (!program || !selectedPatternName) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;

    let newCmds: PatternCommand[];
    if (lastSelectedId) {
      const idx = pattern.commands.findIndex((c) => c.id === lastSelectedId);
      newCmds = idx !== -1
        ? [...pattern.commands.slice(0, idx + 1), cmd, ...pattern.commands.slice(idx + 1)]
        : [...pattern.commands, cmd];
    } else {
      newCmds = [...pattern.commands, cmd];
    }

    const newProgram = {
      ...program,
      patterns: program.patterns.map((p) =>
        p.name === selectedPatternName ? { ...p, commands: newCmds } : p,
      ),
    };
    const h = pushEntry(historyEntries, historyCurrentIndex, label, newProgram);
    set({
      program: newProgram, isDirty: true,
      historyEntries: h.entries, historyCurrentIndex: h.currentIndex,
      selectedCommandIds: cmd.id ? new Set([cmd.id]) : new Set<string>(),
      lastSelectedId: cmd.id ?? null,
    });
  },

  bulkInsertAfterSelection: (cmds: PatternCommand[], label = 'Insert commands') => {
    if (cmds.length === 0) return;
    const { program, selectedPatternName, lastSelectedId, historyEntries, historyCurrentIndex } = get();
    if (!program || !selectedPatternName) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;

    let newCmds: PatternCommand[];
    if (lastSelectedId) {
      const idx = pattern.commands.findIndex((c) => c.id === lastSelectedId);
      newCmds = idx !== -1
        ? [...pattern.commands.slice(0, idx + 1), ...cmds, ...pattern.commands.slice(idx + 1)]
        : [...pattern.commands, ...cmds];
    } else {
      newCmds = [...pattern.commands, ...cmds];
    }

    const newProgram = {
      ...program,
      patterns: program.patterns.map((p) =>
        p.name === selectedPatternName ? { ...p, commands: newCmds } : p,
      ),
    };
    const h = pushEntry(historyEntries, historyCurrentIndex, label, newProgram);
    const insertedIds = cmds.map((c) => c.id).filter((id): id is string => Boolean(id));
    set({
      program: newProgram, isDirty: true,
      historyEntries: h.entries, historyCurrentIndex: h.currentIndex,
      selectedCommandIds: new Set(insertedIds),
      lastSelectedId: insertedIds[insertedIds.length - 1] ?? null,
    });
  },

  insertAboveSelection: (cmd: PatternCommand, label = 'Insert command') => {
    const { program, selectedPatternName, selectedCommandIds, historyEntries, historyCurrentIndex } = get();
    if (!program || !selectedPatternName) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;

    let insertIdx = pattern.commands.findIndex((c) => c.id && selectedCommandIds.has(c.id));
    if (insertIdx === -1) insertIdx = pattern.commands.length;
    const newCmds = [
      ...pattern.commands.slice(0, insertIdx),
      cmd,
      ...pattern.commands.slice(insertIdx),
    ];
    const newProgram = {
      ...program,
      patterns: program.patterns.map((p) =>
        p.name === selectedPatternName ? { ...p, commands: newCmds } : p,
      ),
    };
    const h = pushEntry(historyEntries, historyCurrentIndex, label, newProgram);
    set({
      program: newProgram, isDirty: true,
      historyEntries: h.entries, historyCurrentIndex: h.currentIndex,
      selectedCommandIds: cmd.id ? new Set([cmd.id]) : new Set<string>(),
      lastSelectedId: cmd.id ?? null,
    });
  },

  mergeEndToStart: () => {
    const { program, selectedPatternName, selectedCommandIds } = get();
    if (!program || !selectedPatternName) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;

    const lines = collectSelectedLines(pattern.commands, selectedCommandIds);
    if (lines.length < 2) return;

    const newCmds = cloneCmds(pattern.commands);
    let count = 0;
    for (let i = 0; i < lines.length - 1; i++) {
      const a = lines[i];
      const b = lines[i + 1];
      if (!a.id) continue;
      const clone = findById(newCmds, a.id) as LineCommand;
      if (!clone || clone.kind !== 'Line') continue;
      clone.endPoint = [b.startPoint[0], b.startPoint[1], b.startPoint[2]];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (clone as any)._raw = undefined;
      count++;
    }
    if (count === 0) return;

    get().setProgram(
      { ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) },
      `Merge Forward ${count} pair${count !== 1 ? 's' : ''}`,
    );
  },

  mergeStartToEnd: () => {
    const { program, selectedPatternName, selectedCommandIds } = get();
    if (!program || !selectedPatternName) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;

    const lines = collectSelectedLines(pattern.commands, selectedCommandIds);
    if (lines.length < 2) return;

    const newCmds = cloneCmds(pattern.commands);
    let count = 0;
    for (let i = 0; i < lines.length - 1; i++) {
      const a = lines[i];
      const b = lines[i + 1];
      if (!b.id) continue;
      const clone = findById(newCmds, b.id) as LineCommand;
      if (!clone || clone.kind !== 'Line') continue;
      clone.startPoint = [a.endPoint[0], a.endPoint[1], a.endPoint[2]];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (clone as any)._raw = undefined;
      count++;
    }
    if (count === 0) return;

    get().setProgram(
      { ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) },
      `Merge Backward ${count} pair${count !== 1 ? 's' : ''}`,
    );
  },

  disconnectLines: () => {
    const { program, selectedPatternName, selectedCommandIds } = get();
    if (!program || !selectedPatternName) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;

    const lines = collectSelectedLines(pattern.commands, selectedCommandIds);
    if (lines.length < 2) return;

    const newCmds = cloneCmds(pattern.commands);
    let junctions = 0;

    for (let i = 0; i < lines.length - 1; i++) {
      const a = lines[i];
      const b = lines[i + 1];
      if (!a.id) continue;
      if (ptKey(a.endPoint) === ptKey(b.startPoint)) {
        const clone = findById(newCmds, a.id) as LineCommand;
        if (clone && clone.kind === 'Line') {
          clone.endPoint = [clone.endPoint[0] + 0.001, clone.endPoint[1], clone.endPoint[2]];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (clone as any)._raw = undefined;
          junctions++;
        }
      }
    }

    if (junctions === 0) return;
    get().setProgram(
      { ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) },
      `Disconnect ${junctions} junction${junctions !== 1 ? 's' : ''}`,
    );
  },

  groupSelection: (name: string) => {
    const { program, selectedPatternName, selectedCommandIds, historyEntries, historyCurrentIndex } = get();
    if (!program || !selectedPatternName || selectedCommandIds.size === 0) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;

    const selected: PatternCommand[] = [];
    const selectedIndices = new Set<number>();
    for (let i = 0; i < pattern.commands.length; i++) {
      const cmd = pattern.commands[i];
      if (cmd.id && selectedCommandIds.has(cmd.id)) {
        selected.push(cmd);
        selectedIndices.add(i);
      }
    }
    if (selected.length === 0) return;

    const groupNode: GroupNode = {
      kind: 'Group', id: genId(), name, commands: selected, collapsed: false,
    };

    const newCmds: PatternCommand[] = [];
    let inserted = false;
    for (let i = 0; i < pattern.commands.length; i++) {
      if (selectedIndices.has(i)) {
        if (!inserted) { newCmds.push(groupNode); inserted = true; }
      } else {
        newCmds.push(pattern.commands[i]);
      }
    }

    const newProgram = { ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) };
    const h = pushEntry(historyEntries, historyCurrentIndex, `Group: ${name}`, newProgram);
    set({
      program: newProgram, isDirty: true,
      historyEntries: h.entries, historyCurrentIndex: h.currentIndex,
      selectedCommandIds: new Set([groupNode.id!]),
      lastSelectedId: groupNode.id!,
    });
  },

  ungroupSelection: () => {
    const { program, selectedPatternName, selectedCommandIds, historyEntries, historyCurrentIndex } = get();
    if (!program || !selectedPatternName) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;

    let ungroupedName = '';
    let ungrouped = false;
    const newCmds: PatternCommand[] = [];
    for (const cmd of pattern.commands) {
      if (!ungrouped && cmd.kind === 'Group' && cmd.id && selectedCommandIds.has(cmd.id)) {
        ungroupedName = cmd.name;
        newCmds.push(...cmd.commands);
        ungrouped = true;
      } else {
        newCmds.push(cmd);
      }
    }
    if (!ungrouped) return;

    const newProgram = { ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) };
    const h = pushEntry(historyEntries, historyCurrentIndex, `Ungroup: ${ungroupedName}`, newProgram);
    set({
      program: newProgram, isDirty: true,
      historyEntries: h.entries, historyCurrentIndex: h.currentIndex,
      selectedCommandIds: new Set<string>(), lastSelectedId: null,
    });
  },

  replaceCommand: (id: string, newCmd: PatternCommand, label: string) => {
    const { program, selectedPatternName, historyEntries, historyCurrentIndex } = get();
    if (!program || !selectedPatternName) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;

    const idx = pattern.commands.findIndex((c) => c.id === id);
    if (idx === -1) return;

    const newCmds = [
      ...pattern.commands.slice(0, idx),
      newCmd,
      ...pattern.commands.slice(idx + 1),
    ];
    const newProgram = {
      ...program,
      patterns: program.patterns.map((p) =>
        p.name === selectedPatternName ? { ...p, commands: newCmds } : p,
      ),
    };
    const h = pushEntry(historyEntries, historyCurrentIndex, label, newProgram);
    set({
      program: newProgram, isDirty: true,
      historyEntries: h.entries, historyCurrentIndex: h.currentIndex,
      selectedCommandIds: newCmd.id ? new Set([newCmd.id]) : new Set<string>(),
      lastSelectedId: newCmd.id ?? null,
    });
  },

  applySearchReplace: (matches, query, replacement, label) => {
    const { program, selectedPatternName, historyEntries, historyCurrentIndex } = get();
    if (!program) return 0;

    const queryLower = query.trim().toLowerCase();
    if (!queryLower) return 0;

    // Work on mutable copies of each pattern's command list
    const patternCmds = new Map<string, PatternCommand[]>();
    for (const p of program.patterns) patternCmds.set(p.name, [...p.commands]);

    let count = 0;
    for (const match of matches) {
      const pName = match.patternName ?? selectedPatternName;
      if (!pName) continue;
      const cmds = patternCmds.get(pName);
      if (!cmds) continue;
      const next = replaceSearchMatch(cmds, match.id, queryLower, replacement);
      if (next) { patternCmds.set(pName, next); count++; }
    }

    if (count === 0) return 0;

    const newProgram = {
      ...program,
      patterns: program.patterns.map((p) => {
        const newCmds = patternCmds.get(p.name);
        return newCmds && newCmds !== p.commands ? { ...p, commands: newCmds } : p;
      }),
    };
    const h = pushEntry(historyEntries, historyCurrentIndex, label, newProgram);
    set({ program: newProgram, isDirty: true, historyEntries: h.entries, historyCurrentIndex: h.currentIndex });
    return count;
  },

  splitLine: (cmdId: string, splitPoint: [number, number, number]) => {
    const { program, selectedPatternName, historyEntries, historyCurrentIndex } = get();
    if (!program || !selectedPatternName) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;

    // Flatten search: also look inside groups
    function splitInCmds(cmds: PatternCommand[]): PatternCommand[] | null {
      for (let i = 0; i < cmds.length; i++) {
        const cmd = cmds[i];
        if (cmd.kind === 'Line' && cmd.id === cmdId) {
          const keyword = cmd.commandKeyword ?? 'Line';
          const idA = genId(), idB = genId();
          const cmdA: LineCommand = {
            kind: 'Line', id: idA, commandKeyword: keyword,
            disabled: cmd.disabled, valve: cmd.valve,
            startPoint: [...cmd.startPoint] as [number,number,number],
            endPoint: [...splitPoint] as [number,number,number],
            flowRate: { ...cmd.flowRate },
          };
          const cmdB: LineCommand = {
            kind: 'Line', id: idB, commandKeyword: keyword,
            disabled: cmd.disabled, valve: cmd.valve,
            startPoint: [...splitPoint] as [number,number,number],
            endPoint: [...cmd.endPoint] as [number,number,number],
            flowRate: { ...cmd.flowRate },
          };
          return [...cmds.slice(0, i), cmdA, cmdB, ...cmds.slice(i + 1)];
        }
        if (cmd.kind === 'Group') {
          const inner = splitInCmds(cmd.commands);
          if (inner) return [...cmds.slice(0, i), { ...cmd, commands: inner }, ...cmds.slice(i + 1)];
        }
      }
      return null;
    }

    const newCmds = splitInCmds(pattern.commands);
    if (!newCmds) return;

    // Find keyword for label
    const origCmd = findById(pattern.commands, cmdId) as LineCommand | null;
    const label = `Split ${origCmd?.commandKeyword === 'LineFix' ? 'linefix' : 'line'}`;

    const newProgram = { ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) };
    const h = pushEntry(historyEntries, historyCurrentIndex, label, newProgram);
    set({
      program: newProgram, isDirty: true,
      historyEntries: h.entries, historyCurrentIndex: h.currentIndex,
      selectedCommandIds: new Set<string>(), lastSelectedId: null,
    });
  },

  joinLines: (cmdIds: string[]) => {
    if (cmdIds.length < 2) return;
    const { program, selectedPatternName, historyEntries, historyCurrentIndex } = get();
    if (!program || !selectedPatternName) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;

    // Collect ordered lines from flat command list (groups not supported for join)
    const cmds = pattern.commands;
    const lineMap = new Map<string, LineCommand>();
    for (const c of cmds) {
      if (c.kind === 'Line' && c.id && cmdIds.includes(c.id)) lineMap.set(c.id, c);
    }
    if (lineMap.size < 2) return;

    const ordered = cmdIds.map((id) => lineMap.get(id)).filter((c): c is LineCommand => !!c);
    if (ordered.length < 2) return;

    const first = ordered[0];
    const last  = ordered[ordered.length - 1];
    const keyword = first.commandKeyword ?? 'Line';

    const merged: LineCommand = {
      kind: 'Line', id: genId(), commandKeyword: keyword,
      disabled: first.disabled, valve: first.valve,
      startPoint: [...first.startPoint] as [number,number,number],
      endPoint:   [...last.endPoint]    as [number,number,number],
      flowRate: { ...first.flowRate },
    };

    const idSet = new Set(cmdIds);
    let inserted = false;
    const newCmds: PatternCommand[] = [];
    for (const c of cmds) {
      if (c.id && idSet.has(c.id)) {
        if (!inserted) { newCmds.push(merged); inserted = true; }
      } else {
        newCmds.push(c);
      }
    }

    const n = ordered.length;
    const label = n === 2
      ? `Join ${keyword === 'LineFix' ? 'linefixes' : 'lines'}`
      : `Join ${n} ${keyword === 'LineFix' ? 'linefixes' : 'lines'}`;

    const newProgram = { ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) };
    const h = pushEntry(historyEntries, historyCurrentIndex, label, newProgram);
    set({
      program: newProgram, isDirty: true,
      historyEntries: h.entries, historyCurrentIndex: h.currentIndex,
      selectedCommandIds: merged.id ? new Set([merged.id]) : new Set<string>(),
      lastSelectedId: merged.id ?? null,
    });
  },

  createSubpattern: (name: string, copyFromName: string | null) => {
    const { program, historyEntries, historyCurrentIndex } = get();
    if (!program) return;
    let commands: PatternCommand[] = [];
    if (copyFromName !== null) {
      const src = program.patterns.find((p) => p.name === copyFromName);
      if (src) commands = reIdCommands(cloneCmds(src.commands));
    }
    const newPattern: Pattern = { name, commands };
    const newProgram = { ...program, patterns: [...program.patterns, newPattern] };
    const h = pushEntry(historyEntries, historyCurrentIndex, `Create subpattern: ${name}`, newProgram);
    set({
      program: newProgram, isDirty: true,
      historyEntries: h.entries, historyCurrentIndex: h.currentIndex,
      selectedPatternName: name,
      selectedCommandIds: new Set<string>(), lastSelectedId: null,
    });
  },

  deleteSubpattern: (name: string) => {
    const { program, selectedPatternName, historyEntries, historyCurrentIndex } = get();
    if (!program) return;
    const newPatterns = program.patterns.filter((p) => p.name !== name);
    const newProgram = { ...program, patterns: newPatterns };
    const h = pushEntry(historyEntries, historyCurrentIndex, `Delete subpattern: ${name}`, newProgram);
    const newSelected = selectedPatternName === name
      ? (newPatterns[0]?.name ?? null)
      : selectedPatternName;
    set({
      program: newProgram, isDirty: true,
      historyEntries: h.entries, historyCurrentIndex: h.currentIndex,
      selectedPatternName: newSelected,
      selectedCommandIds: new Set<string>(), lastSelectedId: null,
    });
  },

  reorderCommands: (draggedIds: string[], insertBeforeId: string | null, targetGroupId: string | null) => {
    const { program, selectedPatternName } = get();
    if (!program || !selectedPatternName || draggedIds.length === 0) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;

    const draggedSet = new Set(draggedIds);

    function extractDragged(cmds: PatternCommand[]): PatternCommand[] {
      const result: PatternCommand[] = [];
      for (const c of cmds) {
        if (c.id && draggedSet.has(c.id)) result.push(c);
        else if (c.kind === 'Group') result.push(...extractDragged(c.commands));
      }
      return result;
    }

    function removeDragged(cmds: PatternCommand[]): PatternCommand[] {
      return cmds
        .filter((c) => !c.id || !draggedSet.has(c.id))
        .map((c) => c.kind === 'Group' ? { ...c, commands: removeDragged(c.commands) } : c);
    }

    function insertBefore(cmds: PatternCommand[], toInsert: PatternCommand[], beforeId: string | null): PatternCommand[] {
      if (beforeId === null) return [...cmds, ...toInsert];
      const idx = cmds.findIndex((c) => c.id === beforeId);
      if (idx === -1) return [...cmds, ...toInsert];
      return [...cmds.slice(0, idx), ...toInsert, ...cmds.slice(idx)];
    }

    function insertInto(cmds: PatternCommand[], groupId: string | null, toInsert: PatternCommand[], beforeId: string | null): PatternCommand[] {
      if (groupId === null) return insertBefore(cmds, toInsert, beforeId);
      return cmds.map((c) => {
        if (c.kind === 'Group' && c.id === groupId) {
          return { ...c, commands: insertBefore(c.commands, toInsert, beforeId) };
        }
        if (c.kind === 'Group') {
          return { ...c, commands: insertInto(c.commands, groupId, toInsert, beforeId) };
        }
        return c;
      });
    }

    const dragged = extractDragged(pattern.commands);
    if (dragged.length === 0) return;

    const stripped = removeDragged(pattern.commands);
    const reordered = insertInto(stripped, targetGroupId, dragged, insertBeforeId);
    const n = dragged.length;

    get().setProgram(
      { ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: reordered } : p) },
      `Reorder ${n} command${n !== 1 ? 's' : ''}`,
    );
  },

  deleteCommand: (id: string) => {
    const { program, selectedPatternName, historyEntries, historyCurrentIndex } = get();
    if (!program || !selectedPatternName) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;
    const newCmds = removeSelected(pattern.commands, new Set([id]));
    const newProgram = { ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) };
    const h = pushEntry(historyEntries, historyCurrentIndex, 'Delete command', newProgram);
    set({
      program: newProgram, isDirty: true,
      historyEntries: h.entries, historyCurrentIndex: h.currentIndex,
      selectedCommandIds: new Set<string>(), lastSelectedId: null,
    });
  },

  renameGroup: (id: string, newName: string) => {
    const { program, selectedPatternName, historyEntries, historyCurrentIndex } = get();
    if (!program || !selectedPatternName) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;
    function applyRename(cmds: PatternCommand[]): PatternCommand[] {
      return cmds.map((c) => {
        if (c.kind === 'Group' && c.id === id) return { ...c, name: newName };
        if (c.kind === 'Group') return { ...c, commands: applyRename(c.commands) };
        return c;
      });
    }
    const newCmds = applyRename(pattern.commands);
    const newProgram = { ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) };
    const h = pushEntry(historyEntries, historyCurrentIndex, `Rename group "${newName}"`, newProgram);
    set({ program: newProgram, isDirty: true, historyEntries: h.entries, historyCurrentIndex: h.currentIndex });
  },

  moveSelection: (dx: number, dy: number) => {
    const { program, selectedPatternName, selectedCommandIds, historyEntries, historyCurrentIndex } = get();
    if (!program || !selectedPatternName) return;
    if (selectedCommandIds.size === 0) return;
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;

    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;

    const AREA_FILL_PREFIX    = '##AREA_FILL_CONFIG:';
    const CONTOUR_FILL_PREFIX = '##CONTOUR_FILL_CONFIG:';

    /** Shift polygon coords in a fill config comment (area fill or contour fill). */
    function shiftFillComment(cmd: CommentCommand, prefix: string): CommentCommand {
      if (!cmd.text.startsWith(prefix)) return cmd;
      try {
        const body = cmd.text.slice(prefix.length);
        const fields: Record<string, string> = {};
        body.split('|').forEach((f) => {
          const eq = f.indexOf('=');
          if (eq !== -1) fields[f.slice(0, eq)] = f.slice(eq + 1);
        });
        if (!fields.polygon) return cmd;
        const shiftedPoly = fields.polygon
          .split(';')
          .map((pt) => {
            const [x, y] = pt.split(',').map(Number);
            return `${x + dx},${y + dy}`;
          })
          .join(';');
        fields.polygon = shiftedPoly;
        const newBody = Object.entries(fields)
          .map(([k, v]) => `${k}=${v}`)
          .join('|');
        return { ...cmd, text: `${prefix}${newBody}` };
      } catch {
        return cmd;
      }
    }

    function applyMoveToCmd(cmd: PatternCommand): PatternCommand {
      if (cmd.kind === 'Line') {
        return {
          ...cmd,
          startPoint: [cmd.startPoint[0] + dx, cmd.startPoint[1] + dy, cmd.startPoint[2]],
          endPoint:   [cmd.endPoint[0]   + dx, cmd.endPoint[1]   + dy, cmd.endPoint[2]],
          _raw: undefined,
        };
      }
      if (cmd.kind === 'Dot') {
        return {
          ...cmd,
          point: [cmd.point[0] + dx, cmd.point[1] + dy, cmd.point[2]],
          _rawPoint: undefined,
        };
      }
      if (cmd.kind === 'Comment') {
        const shifted = shiftFillComment(cmd, AREA_FILL_PREFIX);
        if (shifted !== cmd) return shifted;
        return shiftFillComment(cmd, CONTOUR_FILL_PREFIX);
      }
      if (cmd.kind === 'Group') {
        return { ...cmd, commands: cmd.commands.map(applyMoveToCmd) };
      }
      return cmd;
    }

    function applyMoveToList(cmds: PatternCommand[]): PatternCommand[] {
      return cmds.map((cmd) => {
        if (cmd.id && selectedCommandIds.has(cmd.id)) return applyMoveToCmd(cmd);
        if (cmd.kind === 'Group') {
          return { ...cmd, commands: applyMoveToList(cmd.commands) };
        }
        return cmd;
      });
    }

    const newCmds = applyMoveToList(pattern.commands);
    const newProgram = {
      ...program,
      patterns: program.patterns.map((p) =>
        p.name === selectedPatternName ? { ...p, commands: newCmds } : p,
      ),
    };
    const n = selectedCommandIds.size;
    const h = pushEntry(historyEntries, historyCurrentIndex, `Move ${n} command${n > 1 ? 's' : ''}`, newProgram);
    set({ program: newProgram, isDirty: true, historyEntries: h.entries, historyCurrentIndex: h.currentIndex });
  },

  applyPatternTextEdit: (patternName, commands) => {
    const { program, historyEntries, historyCurrentIndex } = get();
    if (!program) return;
    const newProgram = {
      ...program,
      patterns: program.patterns.map((p) =>
        p.name === patternName ? { ...p, commands } : p,
      ),
    };
    const lastEntry = historyEntries[historyCurrentIndex];
    if (lastEntry && lastEntry.label === 'Edit pattern text' && Date.now() - lastEntry.timestamp < 2000) {
      const newEntries = [...historyEntries];
      newEntries[historyCurrentIndex] = { ...lastEntry, snapshot: structuredClone(newProgram), timestamp: Date.now() };
      set({ program: newProgram, isDirty: true, historyEntries: newEntries });
    } else {
      const h = pushEntry(historyEntries, historyCurrentIndex, 'Edit pattern text', newProgram);
      set({ program: newProgram, isDirty: true, historyEntries: h.entries, historyCurrentIndex: h.currentIndex });
    }
  },

  applyMainTextEdit: (newMain) => {
    const { program, historyEntries, historyCurrentIndex } = get();
    if (!program) return;
    const newProgram = { ...program, main: newMain };
    const lastEntry = historyEntries[historyCurrentIndex];
    if (lastEntry && lastEntry.label === 'Edit pattern text' && Date.now() - lastEntry.timestamp < 2000) {
      const newEntries = [...historyEntries];
      newEntries[historyCurrentIndex] = { ...lastEntry, snapshot: structuredClone(newProgram), timestamp: Date.now() };
      set({ program: newProgram, isDirty: true, historyEntries: newEntries });
    } else {
      const h = pushEntry(historyEntries, historyCurrentIndex, 'Edit pattern text', newProgram);
      set({ program: newProgram, isDirty: true, historyEntries: h.entries, historyCurrentIndex: h.currentIndex });
    }
  },

  setBgImageComment: (patternName, imgFilePath, points) => {
    const { program, filePath } = get();
    if (!program) return;
    const pattern = program.patterns.find((p) => p.name === patternName);
    if (!pattern) return;

    const BG_PREFIX = '##BG_IMAGE:';

    // Remove any existing bg-image comment from top-level commands
    const withoutComment = pattern.commands.filter(
      (c) => !(c.kind === 'Comment' && c.text.startsWith(BG_PREFIX)),
    );

    let newCmds: PatternCommand[];
    if (imgFilePath === null || points.length < 2) {
      // Removal only
      newCmds = withoutComment;
    } else {
      // Serialize: ##BG_IMAGE:path=<path>|points=px1,py1,wx1,wy1;px2,...
      const pointsStr = points
        .map((p) => `${p.imagePixel[0]},${p.imagePixel[1]},${p.programCoord[0]},${p.programCoord[1]}`)
        .join(';');
      const commentText = `${BG_PREFIX}path=${imgFilePath}|points=${pointsStr}`;
      const commentCmd: import('@lib/types').CommentCommand = {
        kind: 'Comment',
        id: genId(),
        text: commentText,
      };
      // Insert at the start of commands
      newCmds = [commentCmd, ...withoutComment];
    }

    const newProgram = {
      ...program,
      patterns: program.patterns.map((p) =>
        p.name === patternName ? { ...p, commands: newCmds } : p,
      ),
    };

    // Update history snapshot in-place (no new entry, no isDirty flip for metadata)
    // Also update the program silently so the comment persists in subsequent saves.
    const { historyEntries, historyCurrentIndex } = get();
    const currentEntry = historyEntries[historyCurrentIndex];
    if (currentEntry) {
      const newEntries = [...historyEntries];
      newEntries[historyCurrentIndex] = { ...currentEntry, snapshot: structuredClone(newProgram) };
      set({ program: newProgram, historyEntries: newEntries });
    } else {
      set({ program: newProgram });
    }

    // Keep pendingBgImages in ui-store in sync
    if (filePath) {
      const key = `${filePath}::${patternName}`;
      if (imgFilePath === null || points.length < 2) {
        useUIStore.getState().setPendingBgImage(key, null);
      } else {
        useUIStore.getState().setPendingBgImage(key, { filePath: imgFilePath, points });
      }
    }
  },

  copySelection: () => {
    const { program, selectedPatternName, selectedCommandIds } = get();
    if (!program || !selectedPatternName || selectedCommandIds.size === 0) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;
    const copied = cloneCmds(collectSelected(pattern.commands, selectedCommandIds));
    set({ clipboard: copied });
  },

  cutSelection: () => {
    const { program, selectedPatternName, selectedCommandIds, historyEntries, historyCurrentIndex } = get();
    if (!program || !selectedPatternName || selectedCommandIds.size === 0) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;
    const copied = cloneCmds(collectSelected(pattern.commands, selectedCommandIds));
    const newCmds = removeSelected(pattern.commands, selectedCommandIds);
    const n = selectedCommandIds.size;
    const newProgram = { ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) };
    const h = pushEntry(historyEntries, historyCurrentIndex, `Cut ${n} command${n > 1 ? 's' : ''}`, newProgram);
    set({
      clipboard: copied,
      program: newProgram, isDirty: true,
      historyEntries: h.entries, historyCurrentIndex: h.currentIndex,
      selectedCommandIds: new Set<string>(), lastSelectedId: null,
    });
  },

  pasteAboveSelection: () => {
    const { clipboard, program, selectedPatternName, selectedCommandIds, historyEntries, historyCurrentIndex } = get();
    if (!clipboard || clipboard.length === 0) return;
    if (!program || !selectedPatternName || selectedCommandIds.size === 0) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;
    const pasted = reIdCommands(cloneCmds(clipboard));
    // Insert before the first selected top-level command
    let insertIdx = pattern.commands.findIndex((c) => c.id && selectedCommandIds.has(c.id));
    if (insertIdx === -1) insertIdx = pattern.commands.length;
    const newCmds = [
      ...pattern.commands.slice(0, insertIdx),
      ...pasted,
      ...pattern.commands.slice(insertIdx),
    ];
    const n = pasted.length;
    const newProgram = { ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) };
    const h = pushEntry(historyEntries, historyCurrentIndex, `Paste ${n} command${n > 1 ? 's' : ''}`, newProgram);
    const pastedIds = pasted.map((c) => c.id).filter((id): id is string => Boolean(id));
    set({
      program: newProgram, isDirty: true,
      historyEntries: h.entries, historyCurrentIndex: h.currentIndex,
      selectedCommandIds: new Set(pastedIds),
      lastSelectedId: pastedIds[pastedIds.length - 1] ?? null,
    });
  },

  deleteSelection: () => {
    const { program, selectedPatternName, selectedCommandIds, historyEntries, historyCurrentIndex } = get();
    if (!program || !selectedPatternName || selectedCommandIds.size === 0) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;
    const newCmds = removeSelected(pattern.commands, selectedCommandIds);
    const n = selectedCommandIds.size;
    const newProgram = { ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) };
    const h = pushEntry(historyEntries, historyCurrentIndex, `Delete ${n} command${n > 1 ? 's' : ''}`, newProgram);
    set({
      program: newProgram, isDirty: true,
      historyEntries: h.entries, historyCurrentIndex: h.currentIndex,
      selectedCommandIds: new Set<string>(), lastSelectedId: null,
    });
  },
}));
