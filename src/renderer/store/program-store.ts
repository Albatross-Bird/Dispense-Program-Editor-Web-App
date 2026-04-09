import { create } from 'zustand';
import type { Program, PatternCommand, LineCommand, GroupNode } from '@lib/types';
import { parse } from '@lib/parser';
import { serialize } from '@lib/serializer';
import { MYD_DEFAULT } from '@lib/syntax-profiles';

const MAX_HISTORY = 50;

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

// ── Re-export genId so Canvas can use the same generator ─────────────────────
export { genId };

interface ProgramStore {
  program: Program | null;
  filePath: string | null;
  isDirty: boolean;
  /** Non-null when the last save attempt failed (e.g. read-only file). */
  saveError: string | null;
  selectedPatternName: string | null; // null = Main block
  /** IDs of all currently selected PatternCommands. */
  selectedCommandIds: Set<string>;
  /** The anchor ID for shift-click range selection. */
  lastSelectedId: string | null;
  history: Program[];
  historyIndex: number;

  load: () => Promise<void>;
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  clearSaveError: () => void;
  setProgram: (program: Program) => void;
  selectPattern: (name: string | null) => void;
  /** Replace selection with exactly one ID (or clear if null). */
  selectOne: (id: string | null) => void;
  /** Toggle a single ID in/out of the selection. */
  selectToggle: (id: string) => void;
  /**
   * Extend selection from the last anchor to `id`, using `allIds` as the
   * ordered list defining the range.  Falls back to single-select when
   * there is no anchor or the anchor is not in `allIds`.
   */
  selectRange: (id: string, allIds: string[]) => void;
  /** Clear all selections. */
  clearSelection: () => void;
  undo: () => void;
  redo: () => void;
  /** Insert a command after the last selected command (or at pattern end). Selects the new command. */
  insertAfterSelection: (cmd: PatternCommand) => void;
  /** Requires exactly 2 selected Lines: moves first.endPoint → second.startPoint. */
  mergeEndToStart: () => void;
  /** Requires exactly 2 selected Lines: moves second.startPoint → first.endPoint. */
  mergeStartToEnd: () => void;
  /** Adds an epsilon offset to the endPoint of the first line in each connected junction among selected lines. */
  disconnectLines: () => void;
  /** Wraps top-level selected commands in a new GroupNode with the given name. */
  groupSelection: (name: string) => void;
  /** Expands the first selected GroupNode back to its parent level. */
  ungroupSelection: () => void;
}

declare global {
  interface Window {
    electronAPI: {
      openFile: () => Promise<{ filePath: string; content: string } | null>;
      saveFile: (filePath: string, content: string) => Promise<string | null>;
      saveFileAs: (content: string, defaultPath?: string) => Promise<string | null>;
      loadImage: () => Promise<{ filePath: string; data: string; mime: string } | null>;
      storeGet: (key: string) => Promise<unknown>;
      storeSet: (key: string, value: unknown) => Promise<void>;
    };
  }
}

export const useProgramStore = create<ProgramStore>((set, get) => ({
  program: null,
  filePath: null,
  isDirty: false,
  saveError: null,
  selectedPatternName: null,
  selectedCommandIds: new Set<string>(),
  lastSelectedId: null,
  history: [],
  historyIndex: -1,

  load: async () => {
    const result = await window.electronAPI.openFile();
    if (!result) return;
    const program = parse(result.content, MYD_DEFAULT);
    set({
      program,
      filePath: result.filePath,
      isDirty: false,
      selectedPatternName: null,
      selectedCommandIds: new Set<string>(),
      lastSelectedId: null,
      history: [program],
      historyIndex: 0,
    });
  },

  save: async () => {
    const { program, filePath } = get();
    if (!program) return;
    if (!filePath) return get().saveAs();
    const content = serialize(program, MYD_DEFAULT);
    try {
      const result = await window.electronAPI.saveFile(filePath, content);
      if (result === null) {
        set({ saveError: 'Could not save the file — it may be read-only. Use File → Save As to save a copy.' });
      } else {
        set({ isDirty: false, saveError: null });
      }
    } catch {
      set({ saveError: 'Save failed. Use File → Save As to save a copy.' });
    }
  },

  saveAs: async () => {
    const { program, filePath } = get();
    if (!program) return;
    const content = serialize(program, MYD_DEFAULT);
    const savedPath = await window.electronAPI.saveFileAs(content, filePath ?? undefined);
    if (savedPath) set({ filePath: savedPath, isDirty: false });
  },

  setProgram: (program: Program) => {
    const { history, historyIndex } = get();
    const newHistory = [...history.slice(0, historyIndex + 1), program].slice(-MAX_HISTORY);
    set({ program, isDirty: true, history: newHistory, historyIndex: newHistory.length - 1 });
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
    // lastSelectedId stays as anchor — don't update it on shift-click
  },

  clearSaveError: () => set({ saveError: null }),

  clearSelection: () => set({ selectedCommandIds: new Set<string>(), lastSelectedId: null }),

  insertAfterSelection: (cmd: PatternCommand) => {
    const { program, selectedPatternName, lastSelectedId, history, historyIndex } = get();
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
    const newHistory = [...history.slice(0, historyIndex + 1), newProgram].slice(-MAX_HISTORY);
    set({
      program: newProgram, isDirty: true,
      history: newHistory, historyIndex: newHistory.length - 1,
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
    if (lines.length !== 2 || !lines[0].id) return;
    const [first, second] = lines;

    const newCmds = cloneCmds(pattern.commands);
    const clone = findById(newCmds, first.id!) as LineCommand;
    if (!clone || clone.kind !== 'Line') return;
    clone.endPoint = [second.startPoint[0], second.startPoint[1], second.startPoint[2]];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clone as any)._raw = undefined;

    get().setProgram({ ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) });
  },

  mergeStartToEnd: () => {
    const { program, selectedPatternName, selectedCommandIds } = get();
    if (!program || !selectedPatternName) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;

    const lines = collectSelectedLines(pattern.commands, selectedCommandIds);
    if (lines.length !== 2 || !lines[1].id) return;
    const [first, second] = lines;

    const newCmds = cloneCmds(pattern.commands);
    const clone = findById(newCmds, second.id!) as LineCommand;
    if (!clone || clone.kind !== 'Line') return;
    clone.startPoint = [first.endPoint[0], first.endPoint[1], first.endPoint[2]];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (clone as any)._raw = undefined;

    get().setProgram({ ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) });
  },

  disconnectLines: () => {
    const { program, selectedPatternName, selectedCommandIds } = get();
    if (!program || !selectedPatternName) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;

    const lines = collectSelectedLines(pattern.commands, selectedCommandIds);
    if (lines.length < 2) return;

    const newCmds = cloneCmds(pattern.commands);
    let modified = false;

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
          modified = true;
        }
      }
    }

    if (!modified) return;
    get().setProgram({ ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) });
  },

  groupSelection: (name: string) => {
    const { program, selectedPatternName, selectedCommandIds, history, historyIndex } = get();
    if (!program || !selectedPatternName || selectedCommandIds.size === 0) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;

    // Collect top-level selected commands in document order
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
    const newHistory = [...history.slice(0, historyIndex + 1), newProgram].slice(-MAX_HISTORY);
    set({
      program: newProgram, isDirty: true,
      history: newHistory, historyIndex: newHistory.length - 1,
      selectedCommandIds: new Set([groupNode.id!]),
      lastSelectedId: groupNode.id!,
    });
  },

  ungroupSelection: () => {
    const { program, selectedPatternName, selectedCommandIds, history, historyIndex } = get();
    if (!program || !selectedPatternName) return;
    const pattern = program.patterns.find((p) => p.name === selectedPatternName);
    if (!pattern) return;

    let ungrouped = false;
    const newCmds: PatternCommand[] = [];
    for (const cmd of pattern.commands) {
      if (!ungrouped && cmd.kind === 'Group' && cmd.id && selectedCommandIds.has(cmd.id)) {
        newCmds.push(...cmd.commands);
        ungrouped = true;
      } else {
        newCmds.push(cmd);
      }
    }
    if (!ungrouped) return;

    const newProgram = { ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) };
    const newHistory = [...history.slice(0, historyIndex + 1), newProgram].slice(-MAX_HISTORY);
    set({
      program: newProgram, isDirty: true,
      history: newHistory, historyIndex: newHistory.length - 1,
      selectedCommandIds: new Set<string>(), lastSelectedId: null,
    });
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex <= 0) return;
    const i = historyIndex - 1;
    set({ program: history[i], historyIndex: i, isDirty: true });
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;
    const i = historyIndex + 1;
    set({ program: history[i], historyIndex: i, isDirty: true });
  },
}));
