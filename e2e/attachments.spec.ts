import path from 'node:path';
import { readFileSync } from 'node:fs';
import { test, expect, composer, setScenario, chatBodies, send } from './fixtures';

const FIXTURES = path.resolve(__dirname, '..', 'audit', 'fixtures');
const PDF = path.join(FIXTURES, 'aurora-synthetic.pdf');
const MEMO = path.join(FIXTURES, 'injection-memo.txt');

function wireText(bodies: Array<Record<string, unknown>>) {
  return JSON.stringify(bodies.at(-1));
}

test('file chooser: a PDF is parsed in the browser and only bounded excerpts are sent', async ({ app }) => {
  const chooser = app.waitForEvent('filechooser');
  await app.getByRole('button', { name: 'Attach files' }).click();
  await (await chooser).setFiles(PDF);
  await expect(app.getByRole('button', { name: 'Remove aurora-synthetic.pdf' })).toBeVisible({ timeout: 20_000 });

  await setScenario(app, { kind: 'complete', text: 'Lina Patel owns the budget [D1:p3].' });
  await send(app, 'Who owns the Aurora budget?');
  await expect(app.getByText('Lina Patel owns the budget').first()).toBeVisible();

  const wire = wireText(await chatBodies(app));
  expect(wire).toContain('Lina Patel');
  expect(wire).not.toContain('documentRecord');
  expect(wire).not.toContain('"chunks"');
  expect(wire.length).toBeLessThan(200_000);
});

test('native drag and drop of a real file from disk attaches it', async ({ app }) => {
  const target = await composer(app).boundingBox();
  if (!target) throw new Error('composer not laid out');
  const x = target.x + target.width / 2;
  const y = target.y + target.height / 2;
  const cdp = await app.context().newCDPSession(app);
  // Input.dispatchDragEvent drives Chrome's browser-side drag pipeline with
  // real file paths, the same path an OS drag from the file manager takes.
  const data = { items: [], files: [MEMO], dragOperationsMask: 1 };
  await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
  await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
  await cdp.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });

  await expect(app.getByRole('button', { name: 'Remove injection-memo.txt' })).toBeVisible();
  await setScenario(app, { kind: 'complete', text: 'Ravi Iyer owns the budget.' });
  await send(app, 'Who owns the budget in this memo?');
  await expect(app.getByText('Ravi Iyer owns the budget.').first()).toBeVisible();
  expect(wireText(await chatBodies(app))).toContain('Ravi Iyer');
});

test('pasting a file attaches it; pasting text inserts text', async ({ app }) => {
  const memo = readFileSync(MEMO, 'utf8');
  const box = composer(app);
  await box.click();
  // Synthetic ClipboardEvent: drives the same onPaste handler without touching
  // the machine's real clipboard.
  await box.evaluate((el, text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'pasted-notes.txt', { type: 'text/plain' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, memo);
  await expect(app.getByRole('button', { name: 'Remove pasted-notes.txt' })).toBeVisible();
  await expect(box).toHaveValue('');

  await app.getByRole('button', { name: 'Remove pasted-notes.txt' }).click();
  await box.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'plain pasted text');
    const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    (window as unknown as { __pasteDefaultPrevented: boolean }).__pasteDefaultPrevented = event.defaultPrevented;
  });
  expect(await app.evaluate(() => (window as unknown as { __pasteDefaultPrevented: boolean }).__pasteDefaultPrevented)).toBe(false);
});

test('Enter while a file is still parsing never sends the message without it', async ({ app }) => {
  await setScenario(app, { kind: 'complete', text: 'Parsed and answered.' });
  await composer(app).fill('Summarise the attached PDF.');
  const chooser = app.waitForEvent('filechooser');
  await app.getByRole('button', { name: 'Attach files' }).click();
  await (await chooser).setFiles(PDF);
  await composer(app).press('Enter');

  // Either the send was held back (text kept) or it went out with the PDF:
  // a message without the attachment must never be sent.
  const bodies = await chatBodies(app);
  if (bodies.length === 0) {
    await expect(composer(app)).toHaveValue('Summarise the attached PDF.');
    await expect(app.getByRole('button', { name: 'Remove aurora-synthetic.pdf' })).toBeVisible({ timeout: 20_000 });
    await app.getByRole('button', { name: 'Send message' }).click();
  }
  await expect(app.getByText('Parsed and answered.').first()).toBeVisible({ timeout: 20_000 });
  const all = await chatBodies(app);
  expect(all).toHaveLength(1);
  expect(wireText(all)).toContain('Lina Patel');
});
