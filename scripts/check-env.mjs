import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

loadLocalEnv();

const warnings = [];
const failures = [];

function hasValue(name) {
  return typeof process.env[name] === 'string' && process.env[name].trim().length > 0;
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function loadLocalEnv() {
  const envPath = join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

if (!hasValue('OPENROUTER_API_KEY')) {
  warnings.push('OPENROUTER_API_KEY is not set. Hosted free mode will be unavailable; users must bring their own key.');
}

if (hasValue('OPENCONVO_HOSTED_FREE_DAILY_LIMIT')) {
  const limit = Number(process.env.OPENCONVO_HOSTED_FREE_DAILY_LIMIT);
  if (!Number.isFinite(limit) || limit <= 0) {
    failures.push('OPENCONVO_HOSTED_FREE_DAILY_LIMIT must be a positive number.');
  }
}

if (hasValue('OPENCONVO_HOSTED_SEARCH_DAILY_LIMIT')) {
  const limit = Number(process.env.OPENCONVO_HOSTED_SEARCH_DAILY_LIMIT);
  if (!Number.isFinite(limit) || limit <= 0) {
    failures.push('OPENCONVO_HOSTED_SEARCH_DAILY_LIMIT must be a positive number.');
  }
}

for (const name of ['OPENCONVO_HOSTED_FREE_GLOBAL_DAILY_LIMIT', 'OPENCONVO_HOSTED_SEARCH_GLOBAL_DAILY_LIMIT']) {
  if (hasValue(name)) {
    const limit = Number(process.env[name]);
    if (!Number.isFinite(limit) || limit <= 0) {
      failures.push(`${name} must be a positive number.`);
    }
  }
}

const hostedSetting = (process.env.OPENCONVO_HOSTED_FREE || '').trim().toLowerCase();
if (hostedSetting && hostedSetting !== 'on' && hostedSetting !== 'off') {
  failures.push('OPENCONVO_HOSTED_FREE must be "on" or "off" when set.');
}
const storeUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const storeToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
if (Boolean(storeUrl) !== Boolean(storeToken)) {
  failures.push('Set both the quota store URL and token (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN).');
}
if (storeUrl && !validUrl(storeUrl)) {
  failures.push('The quota store URL must be a valid https URL.');
}
if (hostedSetting === 'on' && !storeUrl) {
  warnings.push('OPENCONVO_HOSTED_FREE=on without a shared quota store: Vercel production will stay BYOK-only; other hosts count quotas per instance only.');
}

if (hasValue('NEXT_PUBLIC_GITHUB_URL') && !validUrl(process.env.NEXT_PUBLIC_GITHUB_URL)) {
  failures.push('NEXT_PUBLIC_GITHUB_URL must be a valid https URL.');
}

if (!hasValue('NEXT_PUBLIC_GITHUB_URL')) {
  warnings.push('NEXT_PUBLIC_GITHUB_URL is not set. The app will use the built-in OpenConvo repository URL.');
}

if (hasValue('NEXT_PUBLIC_SITE_URL') && !validUrl(process.env.NEXT_PUBLIC_SITE_URL)) {
  failures.push('NEXT_PUBLIC_SITE_URL must be a valid https URL.');
}

const newsFeeds = (process.env.OPENCONVO_NEWS_FEEDS || '').trim().toLowerCase();
if (newsFeeds && newsFeeds !== 'on' && newsFeeds !== 'off') {
  failures.push('OPENCONVO_NEWS_FEEDS must be "on" or "off" when set.');
}
const pageExtraction = (process.env.OPENCONVO_ENABLE_PAGE_EXTRACTION || '').trim().toLowerCase();
if (pageExtraction && pageExtraction !== 'true' && pageExtraction !== 'false') {
  failures.push('OPENCONVO_ENABLE_PAGE_EXTRACTION must be "true" or "false" when set.');
}

if (hasValue('SEARXNG_URL') && !validUrl(process.env.SEARXNG_URL)) {
  failures.push('SEARXNG_URL must be a valid https URL.');
}

if (failures.length > 0) {
  console.error('Environment check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn('Environment check passed with warnings:');
  for (const warning of warnings) console.warn(`- ${warning}`);
} else {
  console.log('Environment check passed.');
}
