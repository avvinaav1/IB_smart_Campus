const groups = [
  ["name", "full name", "attendee name", "participant name", "student name", "recipient name", "name of participant", "name of the participant", "name of student"],
  ["email", "email address", "email id", "e-mail", "participant email", "attendee email"],
  ["username", "user name", "campus username"],
  ["course", "course name", "event", "event name", "program", "programme", "workshop", "workshop name", "training", "session"],
];
function normalized(value: string) { return value.trim().toLowerCase().replace(/[\s_-]+/g, ""); }
/** Resolve only exact or unambiguous header matches; never guess between people. */
export function resolveColumn(variable: string, headers: string[]): string | undefined {
  if (headers.includes(variable)) return variable;
  const key = normalized(variable);
  const exact = headers.filter(h => normalized(h) === key);
  if (exact.length) return exact.length === 1 ? exact[0] : undefined;
  const group = groups.find(names => names.some(name => normalized(name) === key));
  if (!group) return undefined;
  const candidates = headers.filter(h => group.some(name => normalized(name) === normalized(h)));
  return candidates.length === 1 ? candidates[0] : undefined;
}
export function replaceVariable(text: string, variable: string, column: string) {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (token, key: string) => key === variable ? `{{${column}}}` : token);
}
export function looksLikeHeader(value: string) { return groups.some(group => group.some(name => normalized(name) === normalized(value))); }
