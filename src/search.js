/**
 * YouTube search via the Piped API (no API key required).
 * Falls back through multiple public instances for reliability.
 */

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.in.projectsegfau.lt',
];

/**
 * Search YouTube for videos matching the query.
 * @param {string} query - search terms
 * @returns {Promise<Array<{videoId: string, title: string, uploaderName: string, duration: number, thumbnail: string}>>}
 */
export async function searchYouTube(query) {
  if (!query || !query.trim()) return [];

  for (const instance of PIPED_INSTANCES) {
    try {
      const url = `${instance}/search?q=${encodeURIComponent(query.trim())}&filter=videos`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;

      const data = await res.json();
      const items = (data.items || [])
        .filter((item) => item.type === 'stream' && item.url)
        .slice(0, 8)
        .map((item) => {
          // Extract video ID from url like "/watch?v=XXXXX"
          const match = item.url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
          return {
            videoId: match ? match[1] : null,
            title: item.title || 'Untitled',
            uploaderName: item.uploaderName || item.uploaderUrl || '',
            duration: item.duration || 0,
            thumbnail: item.thumbnail || '',
          };
        })
        .filter((item) => item.videoId);

      return items;
    } catch {
      // Try next instance
      continue;
    }
  }

  return [];
}

/**
 * Format duration in seconds to m:ss or h:mm:ss
 */
export function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '';
  seconds = Math.floor(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
