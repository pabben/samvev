const style = `[data-review-redact]{color:transparent!important;text-shadow:none!important;background:color-mix(in srgb,var(--surface,#d9d9d9) 82%,#888)!important;border-radius:4px!important;user-select:none!important}[data-review-redact] img,.avatar[data-review-redact]{visibility:hidden!important}`;

export async function maskReviewPrivacy(page, names) {
  const values = [...new Set(names.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
  const result = await page.evaluate(({ values, style }) => {
    const marked = new Set();
    const mark = (node, kind) => { if (!(node instanceof Element)) return; node.setAttribute('data-review-redact', kind); marked.add(kind); };
    const selectors = {
      personIdentity: '.hub-person-name strong,.hub-identities strong,.account-button strong,.household-label>strong,.hub-hero p',
      messageMeta: '.hub-message-meta strong',
      messageBody: '.hub-message .display-card-body',
      fallbackAvatar: '.hub-person .avatar:not(.avatar-illustrated),.hub-identities .avatar:not(.avatar-illustrated),.account-button .avatar:not(.avatar-illustrated)',
      protectedPhoto: 'img[src*="/api/v1/households/"][src*="/photo/"]',
    };
    for (const [kind, selector] of Object.entries(selectors)) document.querySelectorAll(selector).forEach(node => mark(node, kind));
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      if (!values.some(value => new RegExp(`(^|[^\\p{L}\\p{N}])${value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'u').test(text))) continue;
      const parent = node.parentElement;
      if (parent) mark(parent, 'runtimeIdentity');
    }
    if (!marked.size) throw new Error('No capture privacy redactions were applied.');
    let tag = document.querySelector('style[data-review-privacy]');
    if (!tag) { tag = document.createElement('style'); tag.setAttribute('data-review-privacy', 'true'); document.head.append(tag); }
    tag.textContent = style;
    return [...marked].sort();
  }, { values, style });
  return result;
}
