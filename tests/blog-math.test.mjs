import test from 'node:test';
import assert from 'node:assert/strict';
import { exportNote } from '../src/lib/blog/export.mjs';
import { renderPost } from '../src/lib/blog/render.mjs';
import { presentPostForReading } from '../src/lib/blog/code-upgrade.mjs';

const count = (html, name) => (html.match(new RegExp(`class="${name}"`, 'g')) || []).length;

test('Obsidian same-line double dollars stay display math through repeated exports', async () => {
  const source = String.raw`Before.

$$p(x) = \frac{E[x]}{\sum_{y \in V} E[y]}$$
After.

The inline expression $x^2$ stays inline.`;
  const first = await exportNote(source);
  const second = await exportNote(first.markdown);
  assert.equal(first.markdown, second.markdown);
  assert.match(first.markdown, /\$\$\n/);
  const {html} = await renderPost(second.markdown);
  assert.equal(count(html, 'katex-display'), 1);
  assert.equal(count(html, 'katex'), 2);
  assert.doesNotMatch(html, /katex-error/);
  assert.match(html, /After\./);
});

test('display math inside lists and quotes, aligned equations, and table inline math render correctly', async () => {
  const source = String.raw`- An equation: $$\frac{1}{2}$$ and its explanation.

> $$x^2 + y^2 = z^2$$

$$
\begin{aligned}
f(x) &= x^2 \\
g(x) &= \sum_{i=1}^{n} i
\end{aligned}
$$

| Quantity | Value |
| --- | --- |
| $N$ | $\operatorname{ceil}(N/P)$ |`;
  const {html} = await renderPost(source);
  assert.equal(count(html, 'katex-display'), 3);
  assert.equal(count(html, 'katex'), 5);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /katex-error/);
});

test('literal dollar placeholders and code are never turned into equations', async () => {
  const source = '[CLS] $A [SEP] for BERT, <s> $A </s>.\n\n`$$x$$` and `$A`.\n\n```text\n$$x$$\n```\n\nActual math: $A$ and $B$.';
  const {html, markdown} = await renderPost(source);
  assert.equal(count(html, 'katex'), 2);
  assert.equal(count(html, 'katex-display'), 0);
  assert.match(html, /\$A/);
  assert.match(html, /<code>\$\$x\$\$<\/code>/);
  assert.equal((await exportNote(markdown)).markdown, markdown);
});

test('legacy math is repaired on read once, without replacing inline formulas', async () => {
  const source = String.raw`Inline $x^2$.

$\text{loss}(x) = \text{freq}(x) \cdot \log p(x)$
Explanation.`;
  const old = (await renderPost(source)).html.replaceAll(' data-math-version="2"', '');
  assert.equal(count(old, 'katex-display'), 0);
  const first = presentPostForReading(old, source);
  assert.equal(presentPostForReading(old, source), first, 'reuse repair work for repeated requests');
  const html = await first;
  assert.equal(count(html, 'katex-display'), 1);
  assert.equal(count(html, 'katex'), 2);
  assert.equal(await presentPostForReading(html, source), html, 'current rendering does not need repair');
});
