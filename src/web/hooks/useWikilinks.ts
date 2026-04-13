import { useState, useEffect, useCallback } from 'react';
import { getPages } from '../api';

/**
 * Module-level cache so multiple components / remounts
 * don't re-fetch the page list within the TTL window.
 */
let _pageMap: Map<string, string> = new Map();
let _fetchedAt = 0;
const TTL = 60_000; // 1 minute

/**
 * Hook that returns a function to convert [[wikilinks]] in markdown text
 * into correct `/browse/:type/:slug` links. Unresolved wikilinks render
 * as bold text instead of broken links.
 */
export function useWikilinks(): (text: string) => string {
  const [pageMap, setPageMap] = useState(_pageMap);

  useEffect(() => {
    if (_pageMap.size > 0 && Date.now() - _fetchedAt < TTL) {
      if (pageMap !== _pageMap) setPageMap(_pageMap);
      return;
    }
    getPages()
      .then((pages) => {
        const map = new Map<string, string>();
        for (const p of pages) map.set(p.slug, p.type);
        _pageMap = map;
        _fetchedAt = Date.now();
        setPageMap(map);
      })
      .catch(() => {});
  }, []);

  return useCallback(
    (text: string): string =>
      text.replace(
        /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
        (_match, target, display) => {
          const slug = target.trim().toLowerCase().replace(/\s+/g, '-');
          const type = pageMap.get(slug);
          if (type) {
            return `[${display || target}](/browse/${type}/${slug})`;
          }
          // No matching page — render as bold, not a broken link
          return `**${display || target}**`;
        },
      ),
    [pageMap],
  );
}
