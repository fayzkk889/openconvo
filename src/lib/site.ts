export const SITE_NAME = 'OpenConvo';
export const DEFAULT_GITHUB_URL = 'https://github.com/fayzkk889/openconvo';

export function getGithubUrl(): string {
  return process.env.NEXT_PUBLIC_GITHUB_URL || DEFAULT_GITHUB_URL;
}
