export type Recipient = { id: string; email: string; username: string };
export function matchRecipient(users: Recipient[], email: string, username: string) {
  email = email.trim().toLowerCase(); username = username.trim().toLowerCase();
  const validEmail = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) && email.length <= 254;
  const byEmail = email ? users.filter(u => u.email.toLowerCase() === email) : [];
  const byName = username ? users.filter(u => u.username.toLowerCase() === username) : [];
  if (email && !validEmail) return { status: "invalid", email: "", reason: "Invalid email address" };
  if (byEmail.length > 1 || byName.length > 1) return { status: "ambiguous", email, reason: "More than one account matches" };
  if (email && username && byName[0]?.id !== byEmail[0]?.id && (byName.length || byEmail.length)) return { status: "conflict", email, reason: "Email and username do not identify the same account" };
  const user = email ? byEmail[0] : byName[0];
  return user ? { status: "matched", userId: user.id, email: email || user.email, reason: "Exact account match" } : { status: "unmatched", email, reason: "No internal account matched" };
}
