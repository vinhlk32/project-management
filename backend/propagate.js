/**
 * Propagation engine for task date constraints.
 *
 * Dependency types:
 *   FS (Finish-to-Start)  : successor.start_date >= predecessor.due_date   + lag
 *   SS (Start-to-Start)   : successor.start_date >= predecessor.start_date + lag
 *   FF (Finish-to-Finish) : successor.due_date   >= predecessor.due_date   + lag
 *   SF (Start-to-Finish)  : successor.due_date   >= predecessor.start_date + lag
 *
 * Only pushes dates forward (never pulls them earlier).
 * Maintains each task's duration when shifting.
 */

const { addDays, daysBetween } = require('./utils/dates');

async function getTask(db, id) {
  const r = await db.execute({ sql: 'SELECT * FROM tasks WHERE id = ?', args: [id] });
  return r.rows[0] || null;
}

/**
 * Propagate date changes from changedTaskId to all downstream successors.
 * Returns a map { taskId -> updatedTaskRow } of every task that was changed.
 */
async function propagateDates(db, changedTaskId, visited = new Set()) {
  if (visited.has(changedTaskId)) return {};
  visited.add(changedTaskId);

  const updated = {};

  const predecessor = await getTask(db, changedTaskId);
  if (!predecessor) return updated;

  const depsResult = await db.execute({
    sql: 'SELECT * FROM task_dependencies WHERE predecessor_id = ?',
    args: [changedTaskId],
  });

  for (const dep of depsResult.rows) {
    const successor = await getTask(db, dep.successor_id);
    if (!successor) continue;

    const lag = dep.lag || 0;
    const duration = (successor.estimated_days > 0)
      ? successor.estimated_days - 1
      : daysBetween(successor.start_date, successor.due_date);

    let newStart = successor.start_date;
    let newDue = successor.due_date;
    let changed = false;

    switch (dep.type) {
      case 'FS': {
        // successor must start the day after predecessor finishes (+1)
        if (predecessor.due_date) {
          const minStart = addDays(predecessor.due_date, lag + 1);
          if (!newStart || newStart < minStart) {
            newStart = minStart;
            newDue = duration !== null ? addDays(newStart, duration) : newDue;
            changed = true;
          }
        }
        break;
      }
      case 'SS': {
        // successor must start after predecessor starts
        if (predecessor.start_date) {
          const minStart = addDays(predecessor.start_date, lag);
          if (!newStart || newStart < minStart) {
            newStart = minStart;
            newDue = duration !== null ? addDays(newStart, duration) : newDue;
            changed = true;
          }
        }
        break;
      }
      case 'FF': {
        // successor must finish after predecessor finishes
        if (predecessor.due_date) {
          const minDue = addDays(predecessor.due_date, lag);
          if (!newDue || newDue < minDue) {
            newDue = minDue;
            newStart = duration !== null ? addDays(newDue, -duration) : newStart;
            changed = true;
          }
        }
        break;
      }
      case 'SF': {
        // successor must finish after predecessor starts
        if (predecessor.start_date) {
          const minDue = addDays(predecessor.start_date, lag);
          if (!newDue || newDue < minDue) {
            newDue = minDue;
            newStart = duration !== null ? addDays(newDue, -duration) : newStart;
            changed = true;
          }
        }
        break;
      }
    }

    if (changed) {
      await db.execute({
        sql: 'UPDATE tasks SET start_date = ?, due_date = ? WHERE id = ?',
        args: [newStart, newDue, dep.successor_id],
      });
      const refreshed = await getTask(db, dep.successor_id);
      updated[dep.successor_id] = refreshed;

      // Recurse into this successor's successors
      const further = await propagateDates(db, dep.successor_id, visited);
      Object.assign(updated, further);
    }
  }

  return updated;
}

module.exports = { propagateDates, addDays, daysBetween };
