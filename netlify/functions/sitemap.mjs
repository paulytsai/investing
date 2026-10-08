// sitemap.xml: landing, contact and one public ticker page per warmed symbol.
import { warmUniverse } from "../lib/universe.mjs";
import { siteMeta } from "../lib/seo.mjs";

export default async () => {
  const m = siteMeta();
  const today = new Date().toISOString().slice(0, 10);
  const urls = [`${m.url}/`, `${m.url}/#/contact`, ...warmUniverse().map((s) => `${m.url}/s/${s}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u, i) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>${i === 0 ? "weekly" : "daily"}</changefreq><priority>${i === 0 ? "1.0" : "0.7"}</priority></url>`).join("\n")}\n</urlset>\n`;
  return new Response(xml, { status: 200, headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
};

export const config = { path: "/sitemap.xml" };
