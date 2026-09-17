/**
 * The Mongo filter for "messages strictly before this cursor" — not a bare
 * `occurredAt: { $lt }`, since two messages landing in the same webhook batch
 * can share an identical timestamp, and a plain timestamp cursor would either
 * skip or double-return whichever of them fell on a page boundary. The id
 * (a real total order, unlike the timestamp) tie-breaks.
 */
export function beforeCursorFilter({ occurredAt, _id }) {
  return {
    $or: [
      { occurredAt: { $lt: occurredAt } },
      { occurredAt, _id: { $lt: _id } },
    ],
  };
}
