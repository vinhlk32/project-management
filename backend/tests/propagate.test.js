const { addDays, daysBetween } = require('../utils/dates');
const { propagateDates } = require('../propagate');
const { wouldCreateCycle } = require('../utils/graph');

// ── addDays ───────────────────────────────────────────────────────────────────

describe('addDays', () => {
  test('adds positive days', () => {
    expect(addDays('2024-01-01', 5)).toBe('2024-01-06');
  });

  test('subtracts negative days', () => {
    expect(addDays('2024-01-10', -3)).toBe('2024-01-07');
  });

  test('crosses month boundary', () => {
    expect(addDays('2024-01-30', 5)).toBe('2024-02-04');
  });

  test('handles zero days', () => {
    expect(addDays('2024-06-15', 0)).toBe('2024-06-15');
  });

  test('returns null for null input', () => {
    expect(addDays(null, 5)).toBeNull();
  });

  test('no timezone drift — UTC+X stays on correct date', () => {
    // Critical regression guard — was off-by-1 in UTC+ timezones
    expect(addDays('2024-03-01', 1)).toBe('2024-03-02');
  });
});

// ── daysBetween ───────────────────────────────────────────────────────────────

describe('daysBetween', () => {
  test('same date → 0', () => {
    expect(daysBetween('2024-01-01', '2024-01-01')).toBe(0);
  });

  test('5 days apart', () => {
    expect(daysBetween('2024-01-01', '2024-01-06')).toBe(5);
  });

  test('negative when b < a', () => {
    expect(daysBetween('2024-01-10', '2024-01-05')).toBe(-5);
  });

  test('returns null if either arg is null', () => {
    expect(daysBetween(null, '2024-01-01')).toBeNull();
    expect(daysBetween('2024-01-01', null)).toBeNull();
  });
});

// ── wouldCreateCycle ──────────────────────────────────────────────────────────

describe('wouldCreateCycle', () => {
  function makeDb(edges) {
    // edges = { predecessorId: [successorId, ...] }
    return {
      execute: jest.fn(({ args }) => {
        const predecessorId = args[0];
        const successors = (edges[predecessorId] || []).map(id => ({ successor_id: id }));
        return Promise.resolve({ rows: successors });
      }),
    };
  }

  // The function signature: wouldCreateCycle(db, successorId, predecessorId)
  // Checks: "starting from successorId, following existing edges, can we reach predecessorId?"
  // If yes, adding predecessorId→successorId would complete a cycle.

  test('chain A→B→C: adding C→A would cycle — detected via wouldCreateCycle(db, A, C)', async () => {
    // Existing edges: A(1)→B(2)→C(3). Proposed new edge: C(3)→A(1).
    // New edge: predecessor=C(3), successor=A(1). Call: wouldCreateCycle(db, 1, 3).
    // From A(1): 1→2→3 = targetId → returns true.
    const db = makeDb({ 1: [2], 2: [3], 3: [] });
    expect(await wouldCreateCycle(db, 1, 3)).toBe(true);
  });

  test('no existing path — returns false', async () => {
    // A(1)→B(2). Proposed: C(3)→B(2). From B(2): no path to C(3).
    const db = makeDb({ 1: [2], 2: [] });
    expect(await wouldCreateCycle(db, 2, 3)).toBe(false);
  });

  test('self-dependency — task pointing to itself', async () => {
    const db = makeDb({ 1: [] });
    // BFS enqueues startId=1, immediately current===targetId=1 → true
    expect(await wouldCreateCycle(db, 1, 1)).toBe(true);
  });

  test('diamond A→B, A→C, B→D, C→D: adding D→A would cycle', async () => {
    // Proposed: predecessor=D(4), successor=A(1). Call: wouldCreateCycle(db, 1, 4).
    // From A(1): 1→2→4 = targetId → returns true.
    const db = makeDb({ 1: [2, 3], 2: [4], 3: [4], 4: [] });
    expect(await wouldCreateCycle(db, 1, 4)).toBe(true);
  });

  test('unrelated nodes — no cycle', async () => {
    // A(1)→B(2), C(3)→D(4). Proposed: B(2)→C(3). From B(2): no path to C.
    const db = makeDb({ 1: [2], 2: [], 3: [4], 4: [] });
    expect(await wouldCreateCycle(db, 2, 3)).toBe(false);
  });
});

// ── propagateDates ─────────────────────────────────────────────────────────────

describe('propagateDates', () => {
  function makeDb(tasks, deps) {
    return {
      execute: jest.fn(({ sql, args }) => {
        if (sql.startsWith('SELECT * FROM tasks')) {
          const id = args[0];
          return Promise.resolve({ rows: tasks[id] ? [tasks[id]] : [] });
        }
        if (sql.startsWith('SELECT * FROM task_dependencies')) {
          const predId = args[0];
          return Promise.resolve({ rows: deps[predId] || [] });
        }
        if (sql.startsWith('UPDATE tasks')) {
          const [start, due, id] = args;
          if (tasks[id]) { tasks[id].start_date = start; tasks[id].due_date = due; }
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };
  }

  test('FS: pushes successor start date forward', async () => {
    const tasks = {
      1: { id: 1, start_date: '2024-01-01', due_date: '2024-01-05', estimated_days: 5 },
      2: { id: 2, start_date: '2024-01-03', due_date: '2024-01-07', estimated_days: 5 },
    };
    const deps = {
      1: [{ successor_id: 2, type: 'FS', lag: 0 }],
      2: [],
    };
    const db = makeDb(tasks, deps);
    await propagateDates(db, 1);

    // Successor must start day after predecessor ends: 2024-01-06
    expect(tasks[2].start_date).toBe('2024-01-06');
    expect(tasks[2].due_date).toBe('2024-01-10'); // +4 days duration
  });

  test('FS with lag: applies lag offset', async () => {
    const tasks = {
      1: { id: 1, start_date: '2024-01-01', due_date: '2024-01-05', estimated_days: 5 },
      2: { id: 2, start_date: '2024-01-03', due_date: '2024-01-07', estimated_days: 3 },
    };
    const deps = {
      1: [{ successor_id: 2, type: 'FS', lag: 2 }],
      2: [],
    };
    const db = makeDb(tasks, deps);
    await propagateDates(db, 1);

    // minStart = due(1) + lag + 1 = 2024-01-05 + 2 + 1 = 2024-01-08
    expect(tasks[2].start_date).toBe('2024-01-08');
  });

  test('no update when successor already scheduled after constraint', async () => {
    const tasks = {
      1: { id: 1, start_date: '2024-01-01', due_date: '2024-01-05', estimated_days: 5 },
      2: { id: 2, start_date: '2024-01-10', due_date: '2024-01-14', estimated_days: 5 },
    };
    const deps = {
      1: [{ successor_id: 2, type: 'FS', lag: 0 }],
      2: [],
    };
    const db = makeDb(tasks, deps);
    await propagateDates(db, 1);

    // Successor already starts after predecessor ends — no change
    expect(tasks[2].start_date).toBe('2024-01-10');
  });

  test('no successors — returns empty object', async () => {
    const tasks = {
      1: { id: 1, start_date: '2024-01-01', due_date: '2024-01-05', estimated_days: 5 },
    };
    const db = makeDb(tasks, { 1: [] });
    const result = await propagateDates(db, 1);
    expect(result).toEqual({});
  });

  test('visited guard prevents infinite loop in cyclic graph', async () => {
    const tasks = {
      1: { id: 1, start_date: '2024-01-01', due_date: '2024-01-05', estimated_days: 3 },
      2: { id: 2, start_date: '2024-01-01', due_date: '2024-01-03', estimated_days: 3 },
    };
    // Artificially create a cycle (shouldn't exist in prod, but guard must hold)
    const deps = {
      1: [{ successor_id: 2, type: 'FS', lag: 0 }],
      2: [{ successor_id: 1, type: 'FS', lag: 0 }],
    };
    const db = makeDb(tasks, deps);
    await expect(propagateDates(db, 1)).resolves.toBeDefined();
  });
});
