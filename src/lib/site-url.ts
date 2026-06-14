export function getSiteUrl(): string {
  const explicitUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicitUrl) return normalizeUrl(explicitUrl);

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return normalizeUrl(`https://${vercelUrl}`);

  return 'https://openconvo.vercel.app';
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, '');
}
