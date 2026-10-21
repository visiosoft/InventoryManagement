// Claude's effort levels, in the order offered everywhere a model is picked.
// Mirrors CLAUDE_EFFORTS in server/src/services/claude.js.
export const CLAUDE_EFFORTS: [string, string][] = [
  ['low', 'Low — quickest replies'],
  ['medium', 'Medium'],
  ['high', 'High — more careful, slower'],
  ['xhigh', 'Extra high — slower again'],
  ['max', 'Max — most careful, slowest'],
]
