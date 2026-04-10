/**
 * Unit tests for the structured history system in program-store.
 *
 * We test the pure `pushEntry` helper indirectly by exercising the
 * exported store actions. We use `useProgramStore.setState` / `getState`
 * to set up state without going through `load()` (which needs Electron IPC).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProgramStore, type HistoryEntry } from '../renderer/store/program-store';
import type { Program } from '../lib/types';

// Minimal valid Program for testing
function makeProgram(tag: string): Program {
  return {
    header: { softwareType: 'MYD', version: '1.0', extras: [] },
    globalParameters: [],
    patterns: [{ name: tag, commands: [], rawHeader: '', rawEnd: '' }],
    mainBlock: { lines: [] },
  };
}

function makeEntry(label: string, tag: string): HistoryEntry {
  return {
    id: `test-${Math.random()}`,
    label,
    timestamp: Date.now(),
    snapshot: makeProgram(tag),
  };
}

// Reset store before each test
beforeEach(() => {
  useProgramStore.setState({
    program: null,
    filePath: null,
    isDirty: false,
    saveError: null,
    selectedPatternName: null,
    selectedCommandIds: new Set(),
    lastSelectedId: null,
    historyEntries: [],
    historyCurrentIndex: -1,
  });
});

// ── Helper to inject history state directly ────────────────────────────────────

function seedHistory(entries: HistoryEntry[], currentIndex: number, program?: Program) {
  useProgramStore.setState({
    historyEntries: entries,
    historyCurrentIndex: currentIndex,
    program: program ?? entries[currentIndex]?.snapshot ?? null,
    isDirty: false,
  });
}

// ── Test 1: Push 5 entries, undo 2, verify navigation ─────────────────────────

describe('history — undo/redo navigation', () => {
  it('undo decrements currentIndex and restores snapshot', () => {
    const entries = [0, 1, 2, 3, 4].map((i) => makeEntry(`Step ${i}`, `p${i}`));
    seedHistory(entries, 4);

    useProgramStore.getState().undo();
    expect(useProgramStore.getState().historyCurrentIndex).toBe(3);
    expect(useProgramStore.getState().program?.patterns[0].name).toBe('p3');

    useProgramStore.getState().undo();
    expect(useProgramStore.getState().historyCurrentIndex).toBe(2);
    expect(useProgramStore.getState().program?.patterns[0].name).toBe('p2');
  });

  it('redo increments currentIndex and restores snapshot', () => {
    const entries = [0, 1, 2, 3, 4].map((i) => makeEntry(`Step ${i}`, `p${i}`));
    seedHistory(entries, 2); // sitting at index 2 after undo

    useProgramStore.getState().redo();
    expect(useProgramStore.getState().historyCurrentIndex).toBe(3);
    expect(useProgramStore.getState().program?.patterns[0].name).toBe('p3');

    useProgramStore.getState().redo();
    expect(useProgramStore.getState().historyCurrentIndex).toBe(4);
    expect(useProgramStore.getState().program?.patterns[0].name).toBe('p4');
  });

  it('undo does not go below 0', () => {
    const entries = [makeEntry('Start', 'p0')];
    seedHistory(entries, 0);
    useProgramStore.getState().undo();
    expect(useProgramStore.getState().historyCurrentIndex).toBe(0);
  });

  it('redo does not go past last entry', () => {
    const entries = [0, 1, 2].map((i) => makeEntry(`Step ${i}`, `p${i}`));
    seedHistory(entries, 2);
    useProgramStore.getState().redo();
    expect(useProgramStore.getState().historyCurrentIndex).toBe(2);
  });

  it('push 5, undo 2: currentIndex is 2, future entries still exist', () => {
    const entries = [0, 1, 2, 3, 4].map((i) => makeEntry(`Step ${i}`, `p${i}`));
    seedHistory(entries, 4);

    useProgramStore.getState().undo();
    useProgramStore.getState().undo();

    const state = useProgramStore.getState();
    expect(state.historyCurrentIndex).toBe(2);
    expect(state.historyEntries.length).toBe(5); // future entries preserved
  });
});

// ── Test 2: Undo 2, new edit → future entries discarded ───────────────────────

describe('history — future branch discarded on new edit', () => {
  it('setProgram discards entries after currentIndex', () => {
    const entries = [0, 1, 2, 3, 4].map((i) => makeEntry(`Step ${i}`, `p${i}`));
    seedHistory(entries, 4);

    // Undo twice → currentIndex = 2
    useProgramStore.getState().undo();
    useProgramStore.getState().undo();
    expect(useProgramStore.getState().historyCurrentIndex).toBe(2);
    expect(useProgramStore.getState().historyEntries.length).toBe(5);

    // Make a new edit
    useProgramStore.getState().setProgram(makeProgram('newEdit'), 'New action');

    const state = useProgramStore.getState();
    // Entries 3 and 4 should be gone; new entry appended
    expect(state.historyEntries.length).toBe(4); // 0,1,2 + newEdit
    expect(state.historyCurrentIndex).toBe(3);
    expect(state.historyEntries[3].label).toBe('New action');
  });
});

// ── Test 3: Undo 2, click future entry → jumpToHistory works ──────────────────

describe('history — jumpToHistory', () => {
  it('can jump to a future entry directly', () => {
    const entries = [0, 1, 2, 3, 4].map((i) => makeEntry(`Step ${i}`, `p${i}`));
    seedHistory(entries, 4);

    // Undo twice → currentIndex = 2
    useProgramStore.getState().undo();
    useProgramStore.getState().undo();
    expect(useProgramStore.getState().historyCurrentIndex).toBe(2);

    // Jump forward to index 4 (future entry)
    useProgramStore.getState().jumpToHistory(4);
    const state = useProgramStore.getState();
    expect(state.historyCurrentIndex).toBe(4);
    expect(state.program?.patterns[0].name).toBe('p4');
    // Entries still intact (jump does NOT discard future)
    expect(state.historyEntries.length).toBe(5);
  });

  it('can jump to a past entry', () => {
    const entries = [0, 1, 2, 3, 4].map((i) => makeEntry(`Step ${i}`, `p${i}`));
    seedHistory(entries, 4);

    useProgramStore.getState().jumpToHistory(1);
    expect(useProgramStore.getState().historyCurrentIndex).toBe(1);
    expect(useProgramStore.getState().program?.patterns[0].name).toBe('p1');
  });

  it('ignores out-of-bounds index', () => {
    const entries = [makeEntry('Step 0', 'p0')];
    seedHistory(entries, 0);
    useProgramStore.getState().jumpToHistory(99);
    expect(useProgramStore.getState().historyCurrentIndex).toBe(0);
  });
});

// ── Test 4: Push 201 entries → capped at 200 ─────────────────────────────────

describe('history — cap at 200 entries', () => {
  it('drops the oldest non-zero entry when cap is exceeded', () => {
    // Seed with entry 0 = "File opened"
    const e0 = makeEntry('File opened', 'p0');
    seedHistory([e0], 0, e0.snapshot);

    // Push 200 more entries (total would be 201 without cap)
    for (let i = 1; i <= 200; i++) {
      useProgramStore.getState().setProgram(makeProgram(`p${i}`), `Step ${i}`);
    }

    const state = useProgramStore.getState();
    expect(state.historyEntries.length).toBe(200);
    // Entry 0 should still be "File opened"
    expect(state.historyEntries[0].label).toBe('File opened');
    // Current index should be at the last entry
    expect(state.historyCurrentIndex).toBe(199);
    // The most recent entry should be Step 200
    expect(state.historyEntries[199].label).toBe('Step 200');
  });
});

// ── Test 5: Entry labels ───────────────────────────────────────────────────────

describe('history — entry labels', () => {
  it('setProgram with no label defaults to "Edit"', () => {
    const e0 = makeEntry('File opened', 'p0');
    seedHistory([e0], 0, e0.snapshot);
    useProgramStore.getState().setProgram(makeProgram('x'));
    const state = useProgramStore.getState();
    expect(state.historyEntries[1].label).toBe('Edit');
  });

  it('setProgram with a label uses that label', () => {
    const e0 = makeEntry('File opened', 'p0');
    seedHistory([e0], 0, e0.snapshot);
    useProgramStore.getState().setProgram(makeProgram('x'), 'Custom label');
    expect(useProgramStore.getState().historyEntries[1].label).toBe('Custom label');
  });
});
