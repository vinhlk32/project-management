/**
 * Detects whether adding an edge (startId → targetId) would create a cycle
 * in the task dependency graph.
 *
 * Uses BFS: starting from startId, follows successor edges.
 * If targetId is reachable, adding the reverse edge would form a cycle.
 */
async function wouldCreateCycle(db, startId, targetId) {
  const visited = new Set();
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const result = await db.execute({
      sql: 'SELECT successor_id FROM task_dependencies WHERE predecessor_id = ?',
      args: [current],
    });
    for (const row of result.rows) queue.push(row.successor_id);
  }
  return false;
}

module.exports = { wouldCreateCycle };
