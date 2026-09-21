export function enableCodeCopy(article) {
  article.querySelectorAll('.blog-code-copy').forEach(button => { button.hidden = false; });
  // Delegation keeps copy working after the article body is replaced by live sync.
  article.addEventListener('click', async event => {
    const button = event.target.closest?.('.blog-code-copy');
    if (!button || !article.contains(button)) return;
    const code = button.closest('.blog-code-block')?.querySelector('pre > code');
    if (!code) return;
    button.disabled = true;
    try {
      await navigator.clipboard.writeText(code.textContent || '');
      button.textContent = 'Copied!';
      button.setAttribute('aria-label', 'Code copied');
    } catch {
      button.textContent = 'Copy failed';
      button.setAttribute('aria-label', 'Copy failed. Select the code to copy it manually.');
    }
    setTimeout(() => {
      button.textContent = 'Copy';
      button.setAttribute('aria-label', 'Copy code');
      button.disabled = false;
    }, 2000);
  });
}
