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
const searchRoute = read('src/app/api/search/route.ts');
const searchLib = read('src/lib/search.ts');
const db = read('src/lib/db.ts');
const exportLib = read('src/lib/export.ts');
const markdown = read('src/lib/markdown.tsx');
const messageComponent = read('src/components/message.tsx');
const useSettings = read('src/hooks/use-settings.ts');
const useChat = read('src/hooks/use-chat.ts');
const useConversations = read('src/hooks/use-conversations.ts');
const useDeploymentConfig = read('src/hooks/use-deployment-config.ts');
const appShell = read('src/components/app-shell.tsx');
const sidebar = read('src/components/sidebar.tsx');
const emptyState = read('src/components/empty-state.tsx');
const composer = read('src/components/composer.tsx');
const workflowStarters = read('src/lib/workflow-starters.ts');
const layout = read('src/app/layout.tsx');
const ogImage = read('src/app/opengraph-image.tsx');
const globals = read('src/app/globals.css');
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
check('hosted quota commits after provider acceptance', /commitHostedQuota\(hostedQuota\)/.test(chatRoute) && /getHostedQuotaStatus/.test(chatRoute));
check('hosted quota response omits internal identity', /publicHostedUsage/.test(chatRoute) && /Omit<HostedQuota, 'identity'>/.test(chatRoute));
check('hosted search quota commits after search success', /commitHostedSearchQuota\(hostedQuota\)/.test(searchRoute) && /getHostedSearchQuotaStatus/.test(searchRoute));
check('hosted search quota has response headers', /X-OpenConvo-Search-Limit/.test(searchRoute) && /X-OpenConvo-Search-Remaining/.test(searchRoute));
check('web search has a keyless fallback', /searchDuckDuckGo/.test(searchLib) && /TAVILY_API_KEY/.test(searchLib));
check('database migration repairs artifact indexes', /artifactStore\.indexNames\.contains\('by-project'\)/.test(db));
check('imports repair unsafe model ids', /resolveSafeModelId/.test(exportLib));
check('imports cap large text fields', /MAX_MESSAGE_CHARS/.test(exportLib) && /MAX_ARTIFACT_CHARS/.test(exportLib));
check('imports reject oversized files before reading', /MAX_IMPORT_BYTES/.test(exportLib) && /file\.size > MAX_IMPORT_BYTES/.test(exportLib));
check('markdown links are sanitized', /safeExternalUrl/.test(markdown));
check('search result links are sanitized', /safeExternalUrl/.test(messageComponent));
check('settings loaded from localStorage are normalized', /normalizeSettings/.test(useSettings) && /normalizePromptSnippets/.test(useSettings));
check('app shell uses dynamic viewport height', /h-dvh/.test(appShell));
check('app logos link to homepage', /href="\/"/.test(sidebar) && /href="\/"/.test(appShell) && /href="\/"/.test(emptyState));
check('site metadata includes social previews', /openGraph/.test(layout) && /twitter/.test(layout) && /metadataBase/.test(layout));
check('Open Graph image route exists', /ImageResponse/.test(ogImage) && /1200/.test(ogImage) && /630/.test(ogImage));
check('mobile sidebar has wide overlay', /92vw/.test(sidebar));
check('empty state has mobile and short viewport rules', /empty-features/.test(globals) && /max-height: 760px/.test(globals) && /max-width: 640px/.test(globals));
check('chat streaming uses display smoothing', /createStreamingDisplay/.test(useChat) && /takeStreamingChunk/.test(useChat));
check('active conversation survives refresh', /openconvo\.activeConversationId/.test(useConversations) && /getStoredConversationId/.test(useConversations) && /if \(loading\) return/.test(useConversations));
check('deployment config gates first render', /loaded:\s*false/.test(useDeploymentConfig) && /deploymentConfig\.loaded/.test(appShell));
check('workflow starters are rendered on empty state', /WORKFLOW_STARTERS/.test(emptyState) && /onStartWorkflow/.test(emptyState));
check('workflow starters create editable composer drafts', /workflowDraft/.test(composer) && /setContent\(workflowDraft\.starter\.prompt\)/.test(composer));
check('workflow starter prompts cover core task modes', /research-brief/.test(workflowStarters) && /file-analysis/.test(workflowStarters) && /code-review/.test(workflowStarters) && /compare-models/.test(workflowStarters));
check('test script is wired', packageJson.scripts?.test === 'node scripts/launch-checks.mjs');
check('.env.example documents OpenRouter', /OPENROUTER_API_KEY/.test(envExample));
check('.env.example documents Tavily', /TAVILY_API_KEY/.test(envExample));
check('.env.example documents hosted free limit', /OPENCONVO_HOSTED_FREE_DAILY_LIMIT/.test(envExample));
check('.env.example documents hosted search limit', /OPENCONVO_HOSTED_SEARCH_DAILY_LIMIT/.test(envExample));
check('.env.example documents GitHub URL', /NEXT_PUBLIC_GITHUB_URL/.test(envExample));
check('.env.example documents site URL', /NEXT_PUBLIC_SITE_URL/.test(envExample));
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
