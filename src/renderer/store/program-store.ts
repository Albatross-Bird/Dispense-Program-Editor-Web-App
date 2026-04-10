import { create } from 'zustand';
import type { Program, PatternCommand, LineCommand, GroupNode } from '@lib/types';
import { parse } from '@lib/parser';
import { serialize } from '@lib/serializer';
import { MYD_DEFAULT } from '@lib/syntax-profiles';

const MAX_HISTORY = 200;

// ── History ───────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  label: string;
  timestamp: number;
  snapshot: Program;
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
  mergeEndToStart: () => void;
  mergeStartToEnd: () => void;
  disconnectLines: () => void;
  groupSelection: (name: string) => void;
  ungroupSelection: () => void;
  /** Replace the top-level command matching `id` in the selected pattern. */
  replaceCommand: (id: string, newCmd: PatternCommand, label: string) => void;
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

  load: async () => {
    const result = await window.electronAPI.openFile();
    if (!result) return;
    const program = parse(result.content, MYD_DEFAULT);
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

    get().setProgram(
      { ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) },
      'Merge End→Start',
    );
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

    get().setProgram(
      { ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) },
      'Merge Start←End',
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
    get().setProgram(
      { ...program, patterns: program.patterns.map((p) => p.name === selectedPatternName ? { ...p, commands: newCmds } : p) },
      'Disconnect lines',
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
}));
