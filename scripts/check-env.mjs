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

if (hasValue('NEXT_PUBLIC_GITHUB_URL') && !validUrl(process.env.NEXT_PUBLIC_GITHUB_URL)) {
  failures.push('NEXT_PUBLIC_GITHUB_URL must be a valid https URL.');
}

if (!hasValue('NEXT_PUBLIC_GITHUB_URL')) {
  warnings.push('NEXT_PUBLIC_GITHUB_URL is not set. The app will use the built-in OpenConvo repository URL.');
}

if (!hasValue('TAVILY_API_KEY')) {
  warnings.push('TAVILY_API_KEY is not set. Web search will require users to add their own key in Settings.');
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
