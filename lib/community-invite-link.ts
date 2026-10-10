/** Path every community invite (link, notification, email, QR) points to. */
export function communityInvitePath(communityId: string, token: string) {
  return `/?view=explore&community=${encodeURIComponent(communityId)}&invite=${encodeURIComponent(token)}`;
}
