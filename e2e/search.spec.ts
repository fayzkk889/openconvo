import { test, expect, assistantMessages, setScenario, chatBodies, send } from './fixtures';

test('the model searches on its own: live status, cited sources, saved after reload', async ({ app }) => {
  await setScenario(app, {
    kind: 'tools',
    query: 'Google India layoffs',
    searchDelayMs: 1200,
    sources: [
      {
        title: 'Google Cloud cuts 30 jobs in India, dismisses wider layoff speculation',
        url: 'https://www.business-standard.example/google-cloud-india',
        snippet: 'Business Standard. Google said only 30 roles were affected.',
        publishedAt: '2026-11-23',
      },
    ],
    text: 'Google denied mass layoffs in India; about 30 Cloud roles were cut [1].',
  });
  await send(app, 'whats with those google india layoff rumours?');

  await expect(app.getByText('Searching the news for "Google India layoffs"')).toBeVisible();
  const answer = assistantMessages(app).last();
  await expect(answer).toContainText('about 30 Cloud roles were cut');
  await expect(app.getByText('Searching the news for "Google India layoffs"')).toHaveCount(0);
  await expect(answer.getByRole('button', { name: 'Sources (1)' })).toBeVisible();

  // The client asked the model to decide (no forced search, no pre-search).
  const [body] = await chatBodies(app);
  expect((body as { webSearch?: string }).webSearch).toBe('auto');
  expect(body).not.toHaveProperty('searchResults');

  await answer.getByRole('button', { name: 'Sources (1)' }).click();
  await expect(answer.getByText('chosen by the model')).toBeVisible();
  await expect(answer.getByText('1. Google India layoffs')).toBeVisible();

  await app.reload();
  const persisted = assistantMessages(app).last();
  await expect(persisted).toContainText('about 30 Cloud roles were cut');
  await expect(persisted.getByRole('button', { name: 'Sources (1)' })).toBeVisible();
});

test('a greeting goes to the model instead of a canned reply', async ({ app }) => {
  await setScenario(app, { kind: 'complete', text: 'Hello! What are you working on today?' });
  await send(app, 'hi');
  await expect(assistantMessages(app).last()).toContainText('What are you working on today?');
  expect(await chatBodies(app)).toHaveLength(1);
});
