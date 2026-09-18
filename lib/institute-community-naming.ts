export function instituteCommunityIdentity(value: string) {
  const raw = value.trim().replace(/^(?:ic|c)[\\/]+/i, "");
  const slugBase = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const displayBase = raw.replace(/[\\/]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || slugBase;
  return { name: `ic\\${displayBase}`, slug: `ic\\${slugBase}` };
}
