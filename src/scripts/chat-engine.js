/**
 * Google Ads Solutions Architect — Client-side Chat Engine
 *
 * Matches user queries against a knowledge base using keyword scoring.
 * Designed for easy replacement with Claude API later.
 */

export class ChatEngine {
  constructor(knowledgeBase) {
    this.kb = knowledgeBase;
    this.stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
      'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
      'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
      'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
      'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
      'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
      'or', 'if', 'while', 'about', 'up', 'what', 'which', 'who', 'whom',
      'this', 'that', 'these', 'those', 'am', 'it', 'its', 'i', 'me', 'my',
      'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them', 'his', 'her',
    ]);
  }

  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !this.stopWords.has(w));
  }

  score(tokens, entry) {
    let score = 0;
    const entryKeywords = entry.keywords.map(k => k.toLowerCase());
    const questionTokens = this.tokenize(entry.question);

    for (const token of tokens) {
      // Exact keyword match (highest weight)
      for (const kw of entryKeywords) {
        if (kw === token) score += 10;
        else if (kw.includes(token) || token.includes(kw)) score += 5;
      }
      // Question text match
      if (questionTokens.includes(token)) score += 3;
    }

    // Bonus for multiple keyword matches
    const matchedKeywords = entryKeywords.filter(kw =>
      tokens.some(t => kw === t || kw.includes(t) || t.includes(kw))
    );
    if (matchedKeywords.length >= 2) score += matchedKeywords.length * 3;

    return score;
  }

  getResponse(query) {
    const tokens = this.tokenize(query);

    if (tokens.length === 0) {
      return {
        answer: "I'd be happy to help! Try asking about **Google Ads setup**, **campaign types**, **bidding strategies**, **keyword research**, or **optimization tips**.",
        links: [{ text: "Browse the Knowledge Base", url: "/hubs/projects/google-ads/" }],
        category: "general",
      };
    }

    const scored = this.kb
      .map(entry => ({ entry, score: this.score(tokens, entry) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return {
        answer: "I don't have a specific answer for that yet, but our comprehensive Google Ads guide likely covers it. You can also try rephrasing your question with specific Google Ads terms.",
        links: [{ text: "View Complete Guide", url: "/hubs/projects/google-ads/" }],
        category: "fallback",
      };
    }

    const best = scored[0].entry;
    const related = scored.slice(1, 3).map(s => s.entry);

    return {
      answer: best.answer,
      links: best.links || [],
      category: best.category,
      related: related.map(r => ({ question: r.question, id: r.id })),
    };
  }
}
