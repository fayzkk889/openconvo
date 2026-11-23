import { test, expect, composer, assistantMessages, userMessages, setScenario, chatBodies, send } from './fixtures';

test('streams an answer, keeps it after reload, and sends no key', async ({ app }) => {
  await setScenario(app, { kind: 'complete', text: 'Idempotent operations can be retried safely.' });
  await send(app, 'Explain idempotency in one sentence.');

  await expect(assistantMessages(app).last()).toContainText('Idempotent operations can be retried safely.');
  await expect(assistantMessages(app).last()).toHaveAttribute('data-message-status', 'complete');

  const [body] = await chatBodies(app);
  expect(JSON.stringify(body)).toContain('Explain idempotency in one sentence.');

  await app.reload();
  await expect(userMessages(app).last()).toContainText('Explain idempotency in one sentence.');
  await expect(assistantMessages(app).last()).toContainText('Idempotent operations can be retried safely.');
});

test('Stop keeps exactly the streamed partial, labels it, and it survives reload', async ({ app }) => {
  const chunks = Array.from({ length: 40 }, (_, i) => `word${i} `);
  await setScenario(app, { kind: 'slow', chunks, delayMs: 120 });
  await send(app, 'Write a long list of words.');

  const answer = assistantMessages(app).last();
  await expect(answer).toContainText('word3');
  await app.getByRole('button', { name: 'Stop generating' }).click();

  await expect(answer.getByRole('status')).toHaveText('Stopped before the answer finished.');
  await expect(answer).toHaveAttribute('data-message-status', 'interrupted');
  const shown = (await answer.textContent()) || '';
  const lastWord = Math.max(...[...shown.matchAll(/word(\d+)/g)].map((m) => Number(m[1])));
  expect(lastWord).toBeLessThan(39);

  // No further text arrives after Stop.
  await app.waitForTimeout(600);
  expect(await answer.textContent()).toBe(shown);

  await app.reload();
  const persisted = assistantMessages(app).last();
  await expect(persisted).toContainText(`word${lastWord}`);
  await expect(persisted).not.toContainText(`word${lastWord + 1} `);
  await expect(persisted.getByRole('status')).toHaveText('Stopped before the answer finished.');
});

test('an interrupted stream is labelled as possibly incomplete', async ({ app }) => {
  await setScenario(app, { kind: 'interrupted', text: 'The first half of an answer' });
  await send(app, 'Tell me a story.');
  const answer = assistantMessages(app).last();
  await expect(answer).toContainText('The first half of an answer');
  await expect(answer.getByRole('status')).toHaveText('The model connection ended early, so this answer may be incomplete.');
});

test('regenerate replaces a complete answer, but a failed regenerate keeps it', async ({ app }) => {
  await setScenario(app, { kind: 'complete', text: 'Original answer A.' });
  await send(app, 'Give me an answer.');
  await expect(assistantMessages(app).last()).toContainText('Original answer A.');

  await setScenario(app, { kind: 'error', message: 'All free models are busy.' });
  await app.getByRole('button', { name: 'Regenerate response' }).click();
  await expect(app.getByText('All free models are busy.').first()).toBeVisible();
  await expect(app.getByText('Original answer A.').first()).toBeVisible();

  await setScenario(app, { kind: 'interrupted', text: 'Half of a replacement' });
  await app.getByRole('button', { name: 'Regenerate response' }).last().click();
  await expect(app.getByText(/Regeneration was interrupted before it finished/).first()).toBeVisible();
  await expect(app.getByText('Original answer A.').first()).toBeVisible();
  await expect(app.getByText('Half of a replacement')).toHaveCount(0);

  await setScenario(app, { kind: 'complete', text: 'Replacement answer B.' });
  await app.getByRole('button', { name: 'Regenerate response' }).last().click();
  await expect(app.getByText('Replacement answer B.').first()).toBeVisible();
  await expect(app.getByText('Original answer A.')).toHaveCount(0);

  // The regenerated request carried the original question, not a duplicate.
  const bodies = await chatBodies(app);
  const last = bodies.at(-1) as { messages: Array<{ role: string; content: string }> };
  const userTurns = last.messages.filter((m) => m.role === 'user');
  expect(userTurns).toHaveLength(1);
  expect(userTurns[0].content).toContain('Give me an answer.');
});

test('Enter during IME composition does not send; Enter after commit does', async ({ app }) => {
  const cdp = await app.context().newCDPSession(app);
  const box = composer(app);
  await box.click();

  // Chrome's own IME pipeline: starts a real composition session in the renderer.
  await box.evaluate((el) => {
    (window as unknown as { __enterComposing: boolean[] }).__enterComposing = [];
    el.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        (window as unknown as { __enterComposing: boolean[] }).__enterComposing.push((e as KeyboardEvent).isComposing);
      }
    });
  });
  await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
  await app.keyboard.press('Enter');
  await app.waitForTimeout(300);
  const flags = await app.evaluate(() => (window as unknown as { __enterComposing: boolean[] }).__enterComposing);
  expect(flags[0], 'the browser reported the Enter as part of an IME composition').toBe(true);
  expect(await chatBodies(app)).toHaveLength(0);
  await expect(userMessages(app)).toHaveCount(0);

  await cdp.send('Input.insertText', { text: '日本' });
  // A real IME consumes the composing Enter; CDP's synthetic key still lets the
  // textarea insert a newline, so allow (only) that.
  await expect(box).toHaveValue(/^日本\n?$/);

  await setScenario(app, { kind: 'complete', text: 'Japan.' });
  await app.keyboard.press('Enter');
  await expect(userMessages(app).last()).toContainText('日本');
  await expect(assistantMessages(app).last()).toContainText('Japan.');
});
