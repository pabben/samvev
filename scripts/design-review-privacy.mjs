// Capture-only masking: preserve the real layout, never mutate household data.
const style = `[data-review-redact]{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;background:#b4b7ba!important;background-image:none!important;border-radius:4px!important;user-select:none!important}[data-review-redact] *,[data-review-redact]::before,[data-review-redact]::after,img[data-review-redact],.avatar[data-review-redact]{visibility:hidden!important}`;

export async function maskReviewPrivacy(page, names) {
  const values = [...new Set(names.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
  return page.evaluate(({ values, style }) => {
    window.__reviewPrivacyObserver?.disconnect();
    const marked = new Set();
    const mark = (node, kind) => { if (!(node instanceof Element)) return; node.setAttribute('data-review-redact', kind); marked.add(kind); };
    const selectors = {
      personIdentity: '.hub-person-name strong,.hub-identities strong,.account-button strong,.household-label>strong,.hub-hero p',
      messageMeta: '.hub-message-meta strong,.hub-message-meta time',
      messageBody: '.hub-message .display-card-body',
      fallbackAvatar: '.family-hub .avatar:not(.avatar-illustrated),.account-button .avatar:not(.avatar-illustrated)',
      protectedPhoto: 'img[src*="/api/v1/households/"][src*="/photo/"]',
      personalActivity: '.hub-person-activity',
      taskStatus: '.family-hub .person-task-entry span,.family-hub .person-task-inline span',
      provenance: '.family-hub .hub-provenance',
    };
    const patterns=values.map(value=>new RegExp(`(^|[^\\p{L}\\p{N}])${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?=$|[^\\p{L}\\p{N}])`,'u'));
    const apply=()=>{
      for (const [kind, selector] of Object.entries(selectors)) document.querySelectorAll(selector).forEach(node => mark(node, kind));
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '', parent=node.parentElement;
        if (!parent || !text.trim() || parent.closest('script,style')) continue;
        // Item titles, locations, agenda times, reminders and AI summaries are
        // private even when they contain no household member's name.
        if(parent.closest('.family-hub [data-item-id],.family-hub .hub-timeline,.family-hub .hub-reminder,.family-hub .hub-support-preview,.family-hub .hub-provenance'))mark(parent,'dynamicItem');
        if(patterns.some(pattern=>pattern.test(text)))mark(parent,'runtimeIdentity');
      }
    };
    let tag = document.querySelector('style[data-review-privacy]');
    if (!tag) { tag = document.createElement('style'); tag.setAttribute('data-review-privacy', 'true'); document.head.append(tag); }
    tag.textContent = style;
    apply();
    if (!marked.size) throw new Error('No capture privacy redactions were applied.');
    // Polling and responsive React re-renders can add text between masking and
    // capture. Reapply before the browser paints those DOM mutations.
    window.__reviewPrivacyObserver=new MutationObserver(apply);
    window.__reviewPrivacyObserver.observe(document.body,{childList:true,characterData:true,subtree:true});
    return [...marked].sort();
  }, { values, style });
}
