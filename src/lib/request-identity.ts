/**
 * Resolve the client identity used for hosted-free quota accounting.
 *
 * Only `x-forwarded-for` is trusted: Vercel's edge overwrites it with the TCP
 * peer address, so its leftmost entry is the client IP. Headers such as
 * `cf-connecting-ip` or `x-real-ip` are not documented as sanitized when the
 * app is not behind those proxies, so a visitor could rotate them to mint
 * unlimited quota identities.
 */
export function getUsageIdentity(headers: Headers): string {
  const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor || 'local';
}
