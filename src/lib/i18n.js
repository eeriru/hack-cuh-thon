// English / Bahasa Melayu. Text is written in English in the code and wrapped in tr();
// when Malay is on, tr() looks the English text up in i18n-ms.js. Anything without a
// translation falls back to English, so nothing ever shows blank.
// Placeholders: tr('Updated {time}', { time }) → "Dikemas kini {time}".

import { MS } from './i18n-ms.js';

const KEY = 'sh-lang';
let lang = (() => {
  try {
    return localStorage.getItem(KEY) === 'ms' ? 'ms' : 'en';
  } catch {
    return 'en';
  }
})();

export const getLang = () => lang;
export const locale = () => (lang === 'ms' ? 'ms-MY' : 'en-MY');

export function setLang(l) {
  lang = l === 'ms' ? 'ms' : 'en';
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* fine: just won't be remembered */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'ms' ? 'ms' : 'en';
}

export function tr(text, vars) {
  if (text === null || text === undefined) return text;
  let out = (lang === 'ms' && MS[text]) || text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
  return out;
}
