import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');
const failures = [];
let checkCount = 0;

function check(name, condition) {
  checkCount += 1;
  if (!condition) failures.push(name);
}

const models = read('src/lib/models.ts');
const openrouter = read('src/lib/openrouter.ts');
const chatRoute = read('src/app/api/chat/route.ts');
const exportLib = read('src/lib/export.ts');
const packageJson = JSON.parse(read('package.json'));
const envExample = read('.env.example');
const readme = read('README.md');
const deployment = read('DEPLOYMENT.md');
const privacyPage = read('src/app/privacy/page.tsx');
const securityPage = read('src/app/security/page.tsx');
const roadmap = read('ROADMAP.md');
const githubSetup = read('GITHUB_SETUP.md');
const bugTemplate = read('.github/ISSUE_TEMPLATE/bug_report.yml');
const featureTemplate = read('.github/ISSUE_TEMPLATE/feature_request.yml');
const prTemplate = read('.github/pull_request_template.md');

const curatedIds = [...models.matchAll(/id:\s*'([^']+)'/g)].map((match) => match[1]);
const defaultMatch = models.match(/DEFAULT_MODEL_ID\s*=\s*'([^']+)'/);
const fallbackBlock = models.match(/FALLBACK_CHAIN\s*=\s*\[([\s\S]*?)\]/)?.[1] || '';

check('curated model list is present', curatedIds.length > 0);
check('every curated model id is explicitly free', curatedIds.every((id) => id.endsWith(':free')));
check('default model id is explicitly free', Boolean(defaultMatch?.[1].endsWith(':free')));
check('fallback chain does not use router aliases', !/openrouter\/(auto|free)/.test(fallbackBlock));
check('OpenRouter requests enforce zero max price', /max_price:\s*\{[\s\S]*prompt:\s*0[\s\S]*completion:\s*0/.test(openrouter));
check('dynamic model fetch requires :free ids', /id\.endsWith\(':free'\)/.test(openrouter));
check('chat route rejects non-free model ids', /isFreeModelId\(model\)/.test(chatRoute));
check('imports repair unsafe model ids', /resolveSafeModelId/.test(exportLib));
check('imports cap large text fields', /MAX_MESSAGE_CHARS/.test(exportLib) && /MAX_ARTIFACT_CHARS/.test(exportLib));
check('test script is wired', packageJson.scripts?.test === 'node scripts/launch-checks.mjs');
check('.env.example documents OpenRouter', /OPENROUTER_API_KEY/.test(envExample));
check('.env.example documents Tavily', /TAVILY_API_KEY/.test(envExample));
check('.env.example documents hosted free limit', /OPENCONVO_HOSTED_FREE_DAILY_LIMIT/.test(envExample));
check('.env.example documents GitHub URL', /NEXT_PUBLIC_GITHUB_URL/.test(envExample));
check('README has setup instructions', /npm install/.test(readme) && /npm run dev/.test(readme));
check('README has deploy button', /Deploy with Vercel/.test(readme));
check('README links deployment guide', /DEPLOYMENT\.md/.test(readme));
check('README links roadmap and contributing guide', /ROADMAP\.md/.test(readme) && /CONTRIBUTING\.md/.test(readme));
check('deployment guide documents Vercel', /Vercel/.test(deployment) && /OPENROUTER_API_KEY/.test(deployment));
check('privacy page documents local storage', /browser/.test(privacyPage) && /API keys/.test(privacyPage));
check('security page documents hosted limits', /Hosted limits/.test(securityPage) && /rate limiting/.test(securityPage));
check('roadmap documents non-goals', /Non-Goals/.test(roadmap));
check('GitHub setup documents repo topics', /Topics/.test(githubSetup) && /openrouter/.test(githubSetup));
check('GitHub issue templates exist', /Bug report/.test(bugTemplate) && /Feature request/.test(featureTemplate));
check('pull request template requires safety checks', /Free-model routing/.test(prTemplate) && /npm run build/.test(prTemplate));
check('license file exists', existsSync(join(root, 'LICENSE')));

if (failures.length > 0) {
  console.error('Launch checks failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Launch checks passed (${checkCount} checks).`);
