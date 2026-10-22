/*
 * Small, dependency-free text reduction helpers for prompts and AI input.
 * Works in browsers (`TextReducer`) and in Node (`require('./reducer.js')`).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TextReducer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by',
    'for', 'from', 'has', 'have', 'he', 'her', 'hers', 'him', 'his', 'i', 'if',
    'in', 'into', 'is', 'it', 'its', 'me', 'my', 'nor', 'not', 'of', 'on', 'or',
    'our', 'ours', 'she', 'so', 'that', 'the', 'their', 'theirs', 'them', 'they',
    'this', 'those', 'to', 'was', 'we', 'were', 'what', 'when', 'where', 'which',
    'who', 'will', 'with', 'would', 'you', 'your', 'yours'
  ]);

  // Expand common shorthand before tokenization so matching is more reliable.
  const ABBREVIATIONS = {
    'ai': 'artificial intelligence',
    'api': 'application programming interface',
    'approx': 'approximately',
    'asap': 'as soon as possible',
    'e.g.': 'for example',
    'etc.': 'and so on',
    'i.e.': 'that is',
    'info': 'information',
    'msg': 'message',
    'pls': 'please',
    'plz': 'please',
    'repo': 'repository',
    'req': 'requirement',
    'ui': 'user interface',
    'url': 'uniform resource locator',
    'vs': 'versus'
  };

  // Canonical terminology; callers can extend or override it per request.
  const NORMALIZATION_MAP = {
    'e-mail': 'email',
    'e mail': 'email',
    'log in': 'login',
    'sign in': 'login',
    'sign up': 'register',
    'set up': 'setup',
    'web-site': 'website',
    'web site': 'website'
  };

  // Phrases that carry no meaningful instruction in most AI prompts.
  const FILLER_PHRASES = [
    'can you', 'could you', 'would you', 'i want you to', 'i would like you to',
    'please', 'kind of', 'sort of', 'you know', 'basically', 'actually',
    'just', 'really', 'very', 'literally', 'in order to'
  ];

  // Remove only when they modify a following word; keeps words such as "very" alone intact.
  const REDUNDANT_MODIFIERS = [
    'absolutely', 'actually', 'basically', 'clearly', 'completely', 'extremely',
    'highly', 'just', 'literally', 'really', 'simply', 'totally', 'very'
  ];
  const DEFAULT_API_URL = 'http://127.0.0.1:8080/compress';

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function replacePhrases(text, phraseMap) {
    let result = String(text || '');
    Object.entries(phraseMap || {}).forEach(([from, to]) => {
      const expression = new RegExp('\\b' + escapeRegExp(from) + '\\b', 'gi');
      result = result.replace(expression, to);
    });
    return result;
  }

  /** Turns text into lowercase word tokens using the requested /\w+/g matcher. */
  function tokenize(text, options) {
    const settings = options || {};
    const normalized = settings.normalize === false ? String(text || '') : normalize(text, settings);
    const tokens = normalized.toLowerCase().match(/\w+/g) || [];
    return settings.removeStopWords ? tokens.filter((token) => !STOP_WORDS.has(token)) : tokens;
  }

  function countTokens(text, options) {
    const tokens = tokenize(text, options);
    const unique = new Set(tokens);
    const stopWordCount = tokens.filter((token) => STOP_WORDS.has(token)).length;
    return { count: tokens.length, uniqueCount: unique.size, stopWordCount, tokens };
  }

  /** Expands abbreviations, applies a normalisation map, lowercases, and compacts whitespace. */
  function normalize(text, options) {
    const settings = options || {};
    const abbreviations = { ...ABBREVIATIONS, ...(settings.abbreviations || {}) };
    const phraseMap = { ...NORMALIZATION_MAP, ...(settings.normalizationMap || {}) };
    let result = String(text || '').toLowerCase().trim();
    result = replacePhrases(result, abbreviations);
    result = replacePhrases(result, phraseMap);
    return result.replace(/\s+/g, ' ').trim();
  }

  /** Replaces equivalent phrase variants with their preferred phrase. */
  function swapPhrases(text, phraseMap) {
    return replacePhrases(text, phraseMap);
  }

  /** Removes filler phrases and redundant modifiers with deterministic rules. */
  function reduce(text, options) {
    const settings = options || {};
    const filler = settings.fillerPhrases || FILLER_PHRASES;
    const modifiers = settings.redundantModifiers || REDUNDANT_MODIFIERS;
    let result = normalize(text, settings);
    result = swapPhrases(result, settings.phraseMap || {});

    filler.forEach((phrase) => {
      result = result.replace(new RegExp('\\b' + escapeRegExp(phrase) + '\\b', 'gi'), ' ');
    });
    modifiers.forEach((word) => {
      result = result.replace(new RegExp('\\b' + escapeRegExp(word) + '\\b(?=\\s+\\w+)', 'gi'), ' ');
    });
    return result.replace(/\s+/g, ' ').replace(/\s+([,.;!?])/g, '$1').trim();
  }

  /**
   * Jaccard similarity based on unique /\w+/g word tokens.
   * ratio = |intersection(A, B)| / |union(A, B)|. Empty vs empty is 1.
   */
  function jaccard(a, b, options) {
    const left = new Set(tokenize(a, options));
    const right = new Set(tokenize(b, options));
    const intersection = [...left].filter((token) => right.has(token));
    const union = new Set([...left, ...right]);
    const ratio = union.size === 0 ? 1 : intersection.length / union.size;
    return {
      ratio,
      percentage: Number((ratio * 100).toFixed(2)),
      intersection,
      union: [...union],
      intersectionCount: intersection.length,
      unionCount: union.size
    };
  }

  /** Calls the local FastAPI reducer and returns its JSON response. */
  async function reduceWithApi(text, options) {
    const settings = options || {};
    const response = await fetch(settings.apiUrl || DEFAULT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: String(text || ''),
        rate: settings.rate || 0.5,
        phrase_map: settings.phraseMap || {},
        use_ai: Boolean(settings.useAi),
        target_token: settings.targetToken || null
      })
    });
    if (!response.ok) {
      let detail = 'FastAPI request failed';
      try { detail = (await response.json()).detail || detail; } catch (_) { /* non-JSON error */ }
      throw new Error(detail);
    }
    return response.json();
  }

  // Explicit name for callers that use the LLMLingua `/compress` endpoint.
  const compressWithApi = reduceWithApi;

  return {
    STOP_WORDS,
    ABBREVIATIONS,
    NORMALIZATION_MAP,
    FILLER_PHRASES,
    REDUNDANT_MODIFIERS,
    DEFAULT_API_URL,
    tokenize,
    countTokens,
    normalize,
    swapPhrases,
    reduce,
    jaccard,
    reduceWithApi,
    compressWithApi
  };
});
