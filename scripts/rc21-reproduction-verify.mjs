import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveWorkflow,
  needsWebResearch,
  hasExplicitNegativeSearchConstraint,
  isObviouslyLocalOrPersonal,
} from '@/lib/tasks';
import {
  planResearchQueries,
  stripNegativeExclusions,
} from '@/lib/research-planner';
import {
  applySourceQuality,
  extractPrimarySubjects,
} from '@/lib/source-quality';
import {
  buildResearchFallbackAnswer,
} from '@/lib/research-fallback';
import {
  OpenRouterError,
  formatOpenRouterError,
} from '@/lib/openrouter';
import {
  extractPdfPages,
} from '@/lib/file-parser';
import {
  chunkDocument,
} from '@/lib/document-chunker';
import {
  retrieveDocumentExcerpts,
} from '@/lib/document-retrieval';
import {
  validateDocumentCitations,
} from '@/lib/document-citations';

console.log('================================================================');
console.log('OPENCONVO RC-2.1 — PRODUCTION PATH VERIFICATION HARNESS');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// VERIFICATION A: TWO-TURN POLARIS LABS CONVERSATION-ONLY FOLLOW-UP
// -----------------------------------------------------------------------------
console.log('--- Verification A: Two-Turn Polaris Labs Follow-Up ---');

let simulatedSearchCalls = 0;
const mockSendBoundary = (content, options = {}) => {
  const workflow = resolveWorkflow({
    content,
    taskType: options.taskType || 'auto',
    searchEnabled: options.searchEnabled || false,
    researchEnabled: options.researchEnabled || false,
  });
  if (workflow.shouldSearch) {
    simulatedSearchCalls++;
  }
  return workflow;
};

// Turn 1
const turn1Prompt = "My fictional startup is called Polaris Labs. Its latest release date is September 21, 2027, its subscription price is $0, and its database is SQLite. Summarize these facts using only this message. Do not use web search.";
const wf1 = mockSendBoundary(turn1Prompt);
console.log(`Turn 1: shouldSearch=${wf1.shouldSearch}, searchMode=${wf1.searchMode}, taskType=${wf1.taskType}`);
assert.equal(wf1.shouldSearch, false, 'Turn 1 must not trigger search');
assert.equal(wf1.searchMode, 'none');

// Turn 2
const turn2Prompt = "What are Polaris Labs' database and release date? Answer using only our conversation, in one sentence.";
const wf2 = mockSendBoundary(turn2Prompt);
console.log(`Turn 2: shouldSearch=${wf2.shouldSearch}, searchMode=${wf2.searchMode}, taskType=${wf2.taskType}, isQuickTask=${wf2.isQuickTask}`);
assert.equal(wf2.shouldSearch, false, 'Turn 2 must not trigger search');
assert.equal(wf2.searchMode, 'none');
assert.equal(wf2.isQuickTask, true);
assert.equal(needsWebResearch(turn2Prompt), false, 'needsWebResearch must return false for conversation-only follow-up');
assert.equal(simulatedSearchCalls, 0, 'Total outbound /api/search calls across both turns must be exactly 0');
console.log('[PASS] Verification A: 0 search calls across 2 turns, routed to Quick/none.\n');

// -----------------------------------------------------------------------------
// VERIFICATION B: NEXT.JS ROUTE HANDLERS SEARCH & SOURCE QUALITY
// -----------------------------------------------------------------------------
console.log('--- Verification B: Next.js Route Handlers Search Quality ---');
const routeHandlersQuery = "Research the official Next.js Route Handlers documentation. Explain how route.ts handles GET, POST, and dynamic segments. This question is unrelated to Polaris Labs.";

// Query planning
const planned = planResearchQueries(routeHandlersQuery);
console.log('Planned Queries:', planned.queries);
for (const q of planned.queries) {
  assert.ok(!q.toLowerCase().includes('polaris'), `Planned query '${q}' must NOT contain 'polaris'`);
}
assert.ok(planned.queries.some((q) => q.toLowerCase().includes('next') || q.toLowerCase().includes('route')), 'Planned queries must retain Next.js Route topics');

// Source scoring
const routeDotCom = {
  title: 'Route: Package Tracking and Protection Platform',
  url: 'https://route.com/features/protection',
  snippet: 'Route automatically connects to everything you order from all your favorite apps and stores.',
};
const polarisGithub = {
  title: 'caribou/polaris: A lightweight job scheduler',
  url: 'https://github.com/caribou/polaris',
  snippet: 'Polaris is an internal distributed cron scheduler written in Rust.',
};
const nextjsOfficial = {
  title: 'Routing: Route Handlers | Next.js',
  url: 'https://nextjs.org/docs/app/building-your-application/routing/route-handlers',
  snippet: 'Route Handlers allow you to create custom request handlers for a given route using the Web Request and Response APIs. Supports GET, POST, PUT, PATCH, DELETE.',
  publishedAt: '2024-10-15T00:00:00.000Z',
};

const scoredRoute = applySourceQuality(routeDotCom, routeHandlersQuery);
const scoredPolaris = applySourceQuality(polarisGithub, routeHandlersQuery);
const scoredOfficial = applySourceQuality(nextjsOfficial, routeHandlersQuery);

console.log(`route.com: score=${scoredRoute.sourceScore}, label=${scoredRoute.sourceLabel}, reason=${scoredRoute.sourceReason}`);
console.log(`github.com/caribou/polaris: score=${scoredPolaris.sourceScore}, label=${scoredPolaris.sourceLabel}, reason=${scoredPolaris.sourceReason}`);
console.log(`nextjs.org docs: score=${scoredOfficial.sourceScore}, label=${scoredOfficial.sourceLabel}, reason=${scoredOfficial.sourceReason}`);

assert.equal(scoredRoute.sourceLabel, 'Weak', 'route.com must be ranked Weak');
assert.ok((scoredRoute.sourceScore || 0) <= 40, `route.com score must be <= 40, got ${scoredRoute.sourceScore}`);

assert.equal(scoredPolaris.sourceLabel, 'Weak', 'github.com/caribou/polaris must be ranked Weak');
assert.ok((scoredPolaris.sourceScore || 0) <= 40, `polaris score must be <= 40, got ${scoredPolaris.sourceScore}`);

assert.equal(scoredOfficial.sourceLabel, 'Strong', 'Official Next.js doc must be ranked Strong');
assert.ok((scoredOfficial.sourceScore || 0) >= 78, `Official Next.js score must be >= 78, got ${scoredOfficial.sourceScore}`);
console.log('[PASS] Verification B: Irrelevant sources ranked Weak; official docs ranked Strong.\n');

// -----------------------------------------------------------------------------
// VERIFICATION C: RESEARCH 429 FALLBACK & ERROR SANITIZATION
// -----------------------------------------------------------------------------
console.log('--- Verification C: Research 429 Fallback & Error Sanitization ---');
const raw429Body = JSON.stringify({
  error: {
    message: 'Provider capacity reached on cluster node us-east-prod-12',
    code: 429,
    metadata: {
      raw: 'internal_cluster_id_9941',
      upstream_url: 'https://internal.openrouter.priv/v1/models',
      api_key: 'sk-or-v1-abcdef1234567890abcdef1234567890',
    },
  },
});

const err = new OpenRouterError(429, raw429Body);
const formattedError = formatOpenRouterError(err, 'google/gemini-2.0-flash:free');
console.log('Sanitized Error Message:', formattedError);

assert.ok(!formattedError.includes('sk-or-v1'), 'Must not contain API key');
assert.ok(!formattedError.includes('internal_cluster_id'), 'Must not contain internal cluster ID');
assert.ok(!formattedError.includes('openrouter.priv'), 'Must not contain internal upstream URL');
assert.ok(!formattedError.includes('{'), 'Must not contain raw JSON curly braces');

// Fallback with all weak sources
const fallbackAllWeak = buildResearchFallbackAnswer({
  question: routeHandlersQuery,
  sources: [scoredRoute, scoredPolaris],
  reason: formattedError,
});
console.log('Fallback Output (All Weak Sources):');
console.log(fallbackAllWeak);

assert.ok(fallbackAllWeak.includes('did not meet evidence quality standards for this topic'), 'Must display evidence quality warning notice');
assert.ok(!fallbackAllWeak.includes('https://route.com'), 'Must NOT cite or link to route.com');
assert.ok(!fallbackAllWeak.includes('https://github.com/caribou/polaris'), 'Must NOT cite or link to polaris');

// Fallback with mixed sources (one Weak, one Strong)
const fallbackMixed = buildResearchFallbackAnswer({
  question: routeHandlersQuery,
  sources: [scoredRoute, scoredOfficial],
  reason: formattedError,
});
assert.ok(fallbackMixed.includes('https://nextjs.org/docs'), 'Must include Strong official doc link');
assert.ok(!fallbackMixed.includes('https://route.com'), 'Must exclude Weak route.com link from mixed output');
console.log('[PASS] Verification C: No raw JSON/secrets leaked; weak sources excluded from fallback.\n');

// -----------------------------------------------------------------------------
// VERIFICATION D: REAL BINARY PDF.JS EXTRACTION ON PROJECT-AURORA.PDF
// -----------------------------------------------------------------------------
console.log('--- Verification D: Binary PDF.js Extraction (project-aurora.pdf) ---');
const pdfPath = join(process.cwd(), '..', 'openconvo-audit', 'project-aurora.pdf');
const buffer = readFileSync(pdfPath);
const file = new File([buffer], 'project-aurora.pdf', { type: 'application/pdf' });

const extracted = await extractPdfPages(file);
console.log(`Extracted ${extracted.pageCount} pages from binary PDF.`);
assert.equal(extracted.pageCount, 3, 'Must extract exactly 3 pages');

console.log('Page 1 Text:', extracted.pages[0].text);
console.log('Page 2 Text:', extracted.pages[1].text);
console.log('Page 3 Text:', extracted.pages[2].text);

assert.ok(extracted.pages[2].text.includes('AURORA-7319'), 'Page 3 must contain verification code AURORA-7319');
assert.ok(extracted.pages[2].text.includes('Lina Patel'), 'Page 3 must contain Lina Patel');
assert.ok(extracted.pages[2].text.includes('February 14, 2027'), 'Page 3 must contain February 14, 2027');

// Chunking and Retrieval
const { chunks } = chunkDocument({
  documentId: 'doc_aurora_real',
  conversationId: 'conv_real_pdf',
  content: extracted.pages.map((p) => p.text).join('\n\n'),
  pages: extracted.pages,
  mediaType: 'application/pdf',
});

const retrievalResult = retrieveDocumentExcerpts({
  query: 'Who is the lead systems engineer for Project Aurora and what is the target release date? Use the attached PDF.',
  chunks,
  documents: [{
    id: 'doc_aurora_real',
    filename: 'project-aurora.pdf',
    mimeType: 'application/pdf',
    totalPages: 3,
    size: buffer.length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }],
});

assert.ok(retrievalResult.excerpts.length > 0, 'Retrieval must return excerpts');
const topExcerpt = retrievalResult.excerpts[0];
console.log(`Top Retrieved Excerpt: ID=${topExcerpt.chunkId}, Page=${topExcerpt.pageNumber}, Citation=[${topExcerpt.citationId}]`);
console.log(`Top Excerpt Text: "${topExcerpt.text}"`);

assert.equal(topExcerpt.pageNumber, 3, 'Top excerpt must be from Page 3');
assert.equal(topExcerpt.citationId, 'D1:p3', 'Citation must be formatted as [D1:p3]');
assert.ok(topExcerpt.text.includes('Lina Patel'), 'Excerpt text must contain Lina Patel');
assert.ok(topExcerpt.text.includes('February 14, 2027'), 'Excerpt text must contain February 14, 2027');
assert.ok(topExcerpt.text.includes('AURORA-7319'), 'Excerpt text must contain AURORA-7319');

// Citation validation
const responseWithDocCitation = `Based on the document [D1:p3], the lead systems engineer for Project Aurora is Lina Patel, and the target release date is February 14, 2027.`;
const citationValidation = validateDocumentCitations(responseWithDocCitation, retrievalResult.excerpts);
console.log(`Citation Validation: Valid=[${citationValidation.validCitations.join(', ')}], Unknown=[${citationValidation.unknownCitations.join(', ')}], Fabricated=${citationValidation.hasFabricatedCitations}`);

assert.equal(citationValidation.validCitations.includes('D1:p3'), true, '[D1:p3] must be recognized as valid');
assert.equal(citationValidation.hasFabricatedCitations, false, 'Must have zero fabricated citations');
console.log('[PASS] Verification D: Binary PDF extracted, Lina Patel retrieved from Page 3 with [D1:p3].\n');

console.log('================================================================');
console.log('ALL RC-2.1 VERIFICATIONS PASSED ON REAL PRODUCTION PATHS!');
console.log('================================================================');
