/**
 * spikeDetector.js
 * Detects real-time traffic spikes across GA4 properties and analyzes referral data,
 * landing page trends, and traffic origins.
 */

const { runSafeRealtimeReport, runSafeHistoricalReport } = require("./ga4Service");

/**
 * Known referral domains & categories.
 * `shape` maps to a generic SVG icon on the frontend (search/social/forum/code/
 * video/ai) — no per-brand logos, just a recognizable shape for the type of source.
 */
const REFERRAL_CATEGORIES = [
  { key: "hn", label: "Hacker News", shape: "forum", match: /ycombinator|news\.ycombinator/i },
  { key: "twitter", label: "X / Twitter", shape: "social", match: /t\.co|twitter\.com|x\.com/i },
  { key: "reddit", label: "Reddit", shape: "forum", match: /reddit\.com|redd\.it/i },
  { key: "producthunt", label: "Product Hunt", shape: "social", match: /producthunt\.com/i },
  { key: "google", label: "Google Search", shape: "search", match: /google\./i },
  { key: "github", label: "GitHub", shape: "code", match: /github\.com/i },
  { key: "linkedin", label: "LinkedIn", shape: "social", match: /linkedin\.com|lnkd\.in/i },
  { key: "youtube", label: "YouTube", shape: "video", match: /youtube\.com|youtu\.be/i },
  { key: "facebook", label: "Facebook / Meta", shape: "social", match: /facebook\.com|fb\.me|meta\.com/i },
  { key: "instagram", label: "Instagram", shape: "social", match: /instagram\.com/i },
  { key: "chatgpt", label: "ChatGPT / OpenAI", shape: "ai", match: /chatgpt|openai\.com|chat\.openai/i },
  { key: "tiktok", label: "TikTok", shape: "video", match: /tiktok\.com/i },
  { key: "discord", label: "Discord", shape: "social", match: /discord\.com|discord\.gg/i },
  { key: "telegram", label: "Telegram", shape: "social", match: /t\.me|telegram\.org/i },
  { key: "whatsapp", label: "WhatsApp", shape: "social", match: /whatsapp\.com/i },
  { key: "pinterest", label: "Pinterest", shape: "social", match: /pinterest\.com/i },
  { key: "medium", label: "Medium", shape: "forum", match: /medium\.com/i },
  { key: "quora", label: "Quora", shape: "forum", match: /quora\.com/i },
  { key: "stackoverflow", label: "Stack Overflow", shape: "forum", match: /stackoverflow\.com|stackexchange\.com/i },
  { key: "bing", label: "Bing / Microsoft", shape: "search", match: /bing\.com/i },
  { key: "duckduckgo", label: "DuckDuckGo", shape: "search", match: /duckduckgo\.com/i },
  { key: "perplexity", label: "Perplexity AI", shape: "ai", match: /perplexity\.ai|perplexity/i },
  { key: "claude", label: "Claude (Anthropic)", shape: "ai", match: /claude|anthropic\.com/i },
];

/**
 * Classifies a raw source/referrer string into a recognizable platform category
 */
function classifyReferralSource(sourceStr) {
  if (!sourceStr || sourceStr === "(direct)" || sourceStr === "(none)" || sourceStr === "(not set)") {
    return { name: "Direct / Bookmark", category: "direct", shape: "link" };
  }

  for (const cat of REFERRAL_CATEGORIES) {
    if (cat.match.test(sourceStr)) {
      return { name: cat.label, category: cat.key, shape: cat.shape };
    }
  }

  return { name: sourceStr, category: "other", shape: "globe" };
}

/**
 * Detects traffic spikes across all available properties
 */
async function detectAllSpikes(properties) {
  if (!properties || properties.length === 0) return [];

  const results = await Promise.all(
    properties.map(async (prop) => {
      try {
        // 1. Fetch Realtime Active Users & Screen Pages
        const rtRes = await runSafeRealtimeReport({
          propertyId: prop.id,
          dimensions: [{ name: "unifiedScreenName" }],
          metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
          minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
          limit: 10,
        });

        if (!rtRes.ok) return null;

        const totalActive = rtRes.rows.reduce(
          (sum, r) => sum + parseInt(r.metricValues?.[0]?.value || "0", 10),
          0
        );

        // 2. Fetch Historical 7-day average baseline (active users per 30m window)
        const histRes = await runSafeHistoricalReport({
          propertyId: prop.id,
          dimensions: [{ name: "date" }],
          metrics: [{ name: "activeUsers" }],
          dateRange: { startDate: "7daysAgo", endDate: "yesterday" },
          limit: 7,
        });

        let avgBaseline = 1;
        if (histRes.ok && histRes.rows.length > 0) {
          const sum7d = histRes.rows.reduce(
            (s, r) => s + parseInt(r.metricValues?.[0]?.value || "0", 10),
            0
          );
          // Average active users per 30-min window over 7 days (48 windows per day)
          avgBaseline = Math.max(1, Math.round(sum7d / (histRes.rows.length * 48)));
        }

        const spikeRatio = totalActive / avgBaseline;
        const isSpike = (totalActive >= 4 && spikeRatio >= 1.7) || totalActive >= 12;

        if (!isSpike) return null;

        // 3. Query Referral Sources & Landing Pages for this property
        const refRes = await runSafeHistoricalReport({
          propertyId: prop.id,
          dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
          metrics: [{ name: "sessions" }, { name: "activeUsers" }],
          dateRange: { startDate: "today", endDate: "today" },
          limit: 10,
        });

        const topReferrals = (refRes.rows || [])
          .map((r) => {
            const src = r.dimensionValues?.[0]?.value || "(direct)";
            const med = r.dimensionValues?.[1]?.value || "(none)";
            const users = parseInt(r.metricValues?.[1]?.value || "0", 10);
            const classified = classifyReferralSource(src);
            return {
              rawSource: `${src} / ${med}`,
              classifiedName: classified.name,
              category: classified.category,
              shape: classified.shape,
              users,
            };
          })
          .filter((r) => r.users > 0)
          .sort((a, b) => b.users - a.users);

        const topPage = rtRes.rows?.[0]?.dimensionValues?.[0]?.value || "/";

        // Heuristic Explanation Generation
        const primaryRef = topReferrals[0];
        let reasonSummary = "Increased visitor interest detected";
        if (primaryRef && primaryRef.category !== "direct") {
          reasonSummary = `Traffic surge driven by ${primaryRef.classifiedName} referring visitors to ${topPage}`;
        } else if (topPage && topPage !== "/") {
          reasonSummary = `Surge in activity concentrated on landing page: ${topPage}`;
        } else {
          reasonSummary = `High concurrent active visitor count (${totalActive} active users)`;
        }

        return {
          propertyId: prop.id,
          siteName: prop.site,
          domain: prop.domain || null,
          activeUsers: totalActive,
          baselineUsers: avgBaseline,
          spikeMultiplier: Math.round(spikeRatio * 10) / 10,
          topPage,
          topReferrals,
          primarySource: primaryRef ? primaryRef.classifiedName : "Direct / Search",
          primaryShape: primaryRef ? primaryRef.shape : "spike",
          reasonSummary,
          detectedAt: new Date().toISOString(),
        };
      } catch (err) {
        console.warn(`[spikeDetector] Failed analysis for property ${prop.id}:`, err.message);
        return null;
      }
    })
  );

  return results.filter((r) => r !== null).sort((a, b) => b.activeUsers - a.activeUsers);
}

module.exports = {
  classifyReferralSource,
  detectAllSpikes,
};
