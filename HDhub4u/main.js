// --- SWAPPED IMPORT ---
const axios = require('./utils').nativeAxios; 
const cheerio = require('cheerio');
const utils = require('./utils');
const extractors = require('./extractors');

const TMDBAPIKEY = "1865f43a0549ca50d341dd9ab8b29f49";
const TMDBBASE = "https://image.tmdb.org/t/p/original";
const TMDBAPI = "https://wild-surf-4a0d.phisher1.workers.dev";

class HDhub4uProvider {
    constructor() {
        this.name = "HDHub4U";
        this.lang = "hi";
        this.mainUrl = "https://hdhub4u.rehab"; // Fallback
        this.defaultHeaders = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
            "Cookie": "xla=s4t"
        };
    }

    async init() {
        const domains = await utils.fetchDomains();
        if (domains && domains.hdhub4u) this.mainUrl = domains.hdhub4u;
    }

    async getMainPage() {
        await this.init();
        const pages = [
            { path: "", title: "Latest" },
            { path: "category/bollywood-movies/", title: "Bollywood" },
            { path: "category/hollywood-movies/", title: "Hollywood" },
            { path: "category/hindi-dubbed/", title: "Hindi Dubbed" },
            { path: "category/south-hindi-movies/", title: "South Hindi Dubbed" },
            { path: "category/category/web-series/", title: "Web Series" },
            { path: "category/adult/", title: "Adult" }
        ];

        const response = { items: [], hasNext: true };

        for (const pageDef of pages) {
            try {
                const resp = await axios.get(`${this.mainUrl}/${pageDef.path}page/1/`, { headers: this.defaultHeaders });
                const $ = cheerio.load(resp.data);
                
                const homeItems = [];
                $('.recent-movies li.thumb').each((_, el) => {
                    const titleRaw = $(el).find('figcaption a p').text().trim();
                    const url = $(el).find('figure a').attr('href');
                    const posterUrl = $(el).find('figure img').attr('src');
                    
                    if (titleRaw && url) {
                        homeItems.push({
                            name: utils.cleanTitle(titleRaw),
                            url,
                            posterUrl,
                            type: 'Movie'
                        });
                    }
                });

                if (homeItems.length > 0) {
                    response.items.push({ name: pageDef.title, list: homeItems });
                }
            } catch (e) {
                console.error("Error fetching homepage category:", pageDef.title);
            }
        }
        return response.items.length > 0 ? response : null;
    }

    async search(query) {
        const searchUrl = `https://search.pingora.fyi/collections/post/documents/search?q=${encodeURIComponent(query)}&query_by=post_title,category&query_by_weights=4,2&sort_by=sort_by_date:desc&limit=15&highlight_fields=none&use_cache=true&page=1`;
        
        try {
            const resp = await axios.get(searchUrl, { headers: this.defaultHeaders });
            const hits = resp.data.hits || [];
            
            return hits.map(hit => ({
                name: hit.document.post_title,
                url: hit.document.permalink,
                posterUrl: hit.document.post_thumbnail,
                apiName: this.name,
                type: 'Movie' // API doesn't distinguish, fallback to Movie
            }));
        } catch (e) {
            console.error("Search Error:", e.message);
            return [];
        }
    }

    async fetchTMDBMeta(tmdbId, isTvSeries, seasonNumber, fallbackTitle, fallbackPlot, fallbackImage) {
        if (!tmdbId) return null;
        try {
            const type = isTvSeries ? "tv" : "movie";
            const resp = await axios.get(`${TMDBAPI}/${type}/${tmdbId}?api_key=${TMDBAPIKEY}&append_to_response=credits,external_ids`);
            const details = resp.data;

            const meta = {
                name: details.name || details.title || fallbackTitle,
                description: details.overview || fallbackPlot,
                year: (details.release_date || details.first_air_date || "").substring(0, 4),
                rating: details.vote_average,
                background: details.backdrop_path ? `${TMDBBASE}${details.backdrop_path}` : fallbackImage,
                genres: (details.genres || []).map(g => g.name),
                actors: [],
                actorRoles: [],
                videos: []
            };

            if (seasonNumber > 0 && !meta.name.toLowerCase().includes(`season ${seasonNumber}`)) {
                meta.name += ` (Season ${seasonNumber})`;
            }

            if (details.external_ids && details.external_ids.imdb_id) {
                meta.logo = `https://live.metahub.space/logo/medium/${details.external_ids.imdb_id}/img`;
            }

            if (details.credits && details.credits.cast) {
                details.credits.cast.forEach(c => {
                    meta.actors.push({ name: c.name || c.original_name, image: c.profile_path ? `${TMDBBASE}${c.profile_path}` : "" });
                    meta.actorRoles.push(c.character || "");
                });
            }

            if (isTvSeries && seasonNumber > 0) {
                try {
                    const seasonResp = await axios.get(`${TMDBAPI}/tv/${tmdbId}/season/${seasonNumber}?api_key=${TMDBAPIKEY}`);
                    if (seasonResp.data && seasonResp.data.episodes) {
                        meta.videos = seasonResp.data.episodes.map(ep => ({
                            episode: ep.episode_number,
                            season: seasonNumber,
                            title: ep.name,
                            overview: ep.overview,
                            thumbnail: ep.still_path ? `${TMDBBASE}${ep.still_path}` : "",
                            released: ep.air_date,
                            rating: ep.vote_average
                        }));
                    }
                } catch (e) {}
            }

            return { meta };
        } catch (e) { return null; }
    }

    async load(url) {
        await this.init();
        try {
            const resp = await axios.get(url, { headers: this.defaultHeaders });
            const $ = cheerio.load(resp.data);
            
            let title = $('h2[data-ved="2ahUKEwjL0NrBk4vnAhWlH7cAHRCeAlwQ3B0oATAfegQIFBAM"], h2[data-ved="2ahUKEwiP0pGdlermAhUFYVAKHV8tAmgQ3B0oATAZegQIDhAM"]').first().text() || "Unknown";
            const seasonMatch = title.match(/\bSeason\s*(\d+)\b/i);
            const seasonNumber = seasonMatch ? parseInt(seasonMatch[1]) : 0;
            
            const image = $('meta[property=og:image]').attr('content') || "";
            const plot = $('.kno-rdesc .kno-rdesc').first().text() || "";
            const poster = $('main.page-body img.aligncenter').attr('src') || "";
            let trailer = $('.responsive-embed-container iframe').attr('src') || "";
            if (trailer.includes('/embed/')) trailer = trailer.replace('/embed/', '/watch?v=');

            const typeRawLower = ($('h1.page-title span').text() || "").toLowerCase();
            const isMovie = typeRawLower.includes('movie');

            // TMDB ID Resolution
            let imdbUrl = $('div span a[href*=imdb.com]').attr('href') || "";
            let tmdbId = "";
            const tmdbEl = $('div span a[href*=themoviedb.org]').attr('href');
            
            if (tmdbEl) {
                const parts = tmdbEl.split('?')[0].split('-');
                tmdbId = parts[0].split('/').pop();
                
                if (!imdbUrl && tmdbId) {
                    try {
                        const tmdbResp = await axios.get(`${TMDBAPI}/${isMovie ? "movie" : "tv"}/${tmdbId}/external_ids?api_key=${TMDBAPIKEY}`);
                        imdbUrl = tmdbResp.data.imdb_id || "";
                    } catch (e) {}
                }
            }

            if (!tmdbId && imdbUrl) {
                const imdbIdOnly = imdbUrl.split('title/')[1]?.split('/')[0] || imdbUrl;
                try {
                    const findResp = await axios.get(`${TMDBAPI}/find/${imdbIdOnly}?api_key=${TMDBAPIKEY}&external_source=imdb_id`);
                    const resultKey = isMovie ? "movie_results" : "tv_results";
                    if (findResp.data[resultKey] && findResp.data[resultKey].length > 0) {
                        tmdbId = findResp.data[resultKey][0].id.toString();
                    }
                } catch (e) {}
            }

            // TMDB Enrichment
            const tmdbMeta = await this.fetchTMDBMeta(tmdbId, !isMovie, seasonNumber, title, plot, image);
            let description = plot, background = image, year = "", tags = [], actors = [], score = null;

            $('.page-meta em').each((_, el) => {
                const t = $(el).text();
                if (t && !tags.includes(t)) tags.push(t);
            });

            if (tmdbMeta && tmdbMeta.meta) {
                const m = tmdbMeta.meta;
                if (m.description) description = m.description;
                if (m.name) title = m.name;
                year = m.year;
                if (m.background) background = m.background;
                if (m.rating > 0) score = m.rating;
                m.genres.forEach(g => { if (!tags.includes(g)) tags.push(g); });
                
                for (let i = 0; i < m.actors.length; i++) {
                    actors.push({ actor: m.actors[i], roleString: m.actorRoles[i] || "" });
                }
            }

            let loadResp = {
                name: title, url: url, apiName: this.name,
                type: isMovie ? 'Movie' : 'TvSeries',
                posterUrl: poster, backgroundPosterUrl: background,
                plot: description, tags, actors, score, episodes: []
            };

            if (year) loadResp.year = parseInt(year);
            if (trailer) loadResp.trailers = [{ extractorUrl: trailer }];

            if (isMovie) {
                const links = [];
                $('h3 a, h4 a').each((_, el) => {
                    const href = $(el).attr('href');
                    const txt = $(el).text().toLowerCase();
                    if (href && (txt.includes('480') || txt.includes('720') || txt.includes('1080') || txt.includes('2160') || txt.includes('4k'))) {
                        links.push(href);
                    }
                });
                $('.page-body a').each((_, el) => {
                    const href = $(el).attr('href');
                    if (href && (href.toLowerCase().includes('hdstream4u') || href.toLowerCase().includes('hubstream')) && !links.includes(href)) {
                        links.push(href);
                    }
                });

                loadResp.episodes.push({
                    name: title, season: 1, episode: 1,
                    data: JSON.stringify([...new Set(links)])
                });
            } else {
                const epLinksMap = {};
                const epPromises = [];

                $('h3, h4').each((_, el) => {
                    const elemText = $(el).text();
                    const epMatch = elemText.match(/EPiSODE\s*(\d+)/i);
                    const epNum = epMatch ? parseInt(epMatch[1]) : 0;
                    
                    const baseLinks = [];
                    $(el).find('a[href]').each((_, aEl) => { baseLinks.push($(aEl).attr('href')); });

                    let isDirectLinkBlock = false;
                    $(el).find('a[href]').each((_, aEl) => {
                        const t = $(aEl).text().toLowerCase();
                        if (t.includes("1080") || t.includes("720") || t.includes("4k") || t.includes("2160")) {
                            isDirectLinkBlock = true;
                        }
                    });

                    if (isDirectLinkBlock) {
                        for (const linkUrl of baseLinks) {
                            epPromises.push((async () => {
                                try {
                                    const resolved = await utils.getRedirectLinks(linkUrl);
                                    if (!resolved) return;
                                    const linkResp = await axios.get(resolved, { headers: this.defaultHeaders });
                                    const $link = cheerio.load(linkResp.data);
                                    
                                    $link('h5 a').each((_, epLink) => {
                                        const text = $link(epLink).text();
                                        const href = $link(epLink).attr('href');
                                        if (!href) return;
                                        const epNumMatch = text.match(/Episode\s*(\d+)/i);
                                        if (epNumMatch) {
                                            const eNum = parseInt(epNumMatch[1]);
                                            if (!epLinksMap[eNum]) epLinksMap[eNum] = [];
                                            epLinksMap[eNum].push(href);
                                        }
                                    });
                                } catch (e) {}
                            })());
                        }
                    } else if (epNum > 0) {
                        const allLinks = [...baseLinks];
                        if (el.tagName.toLowerCase() === 'h4') {
                            let sibling = $(el).next();
                            while (sibling.length > 0 && sibling[0].tagName.toLowerCase() !== 'hr') {
                                sibling.find('a[href]').each((_, aEl) => { allLinks.push($(aEl).attr('href')); });
                                sibling = sibling.next();
                            }
                        }
                        
                        if (!epLinksMap[epNum]) epLinksMap[epNum] = [];
                        [...new Set(allLinks)].forEach(l => epLinksMap[epNum].push(l));
                    }
                });

                await Promise.all(epPromises);

                for (const [eNum, links] of Object.entries(epLinksMap)) {
                    let ep = {
                        season: seasonNumber > 0 ? seasonNumber : 1,
                        episode: parseInt(eNum),
                        data: JSON.stringify([...new Set(links)])
                    };

                    if (tmdbMeta && tmdbMeta.meta && tmdbMeta.meta.videos) {
                        const vid = tmdbMeta.meta.videos.find(v => v.season === ep.season && v.episode === ep.episode);
                        if (vid) {
                            ep.name = vid.title || `Episode ${ep.episode}`;
                            ep.posterUrl = vid.thumbnail;
                            ep.description = vid.overview;
                            if (vid.rating > 0) ep.score = vid.rating;
                        }
                    }
                    if (!ep.name) ep.name = `Episode ${ep.episode}`;
                    loadResp.episodes.push(ep);
                }
            }

            return loadResp;
        } catch (e) {
            console.error("Load Error:", e.message);
            return null;
        }
    }

   async loadLinks(dataUrl) {
        const links = [];
        const subtitleCb = (sub) => console.log("Found Subtitle:", sub);
        const linkCb = (link) => links.push(link);

        // 1. Parse the incoming string (If it's an array of links, parse it. If it's a single URL, wrap it in an array)
        let parsedUrls = [];
        try {
            parsedUrls = JSON.parse(dataUrl);
            if (!Array.isArray(parsedUrls)) parsedUrls = [dataUrl];
        } catch (e) {
            parsedUrls = [dataUrl];
        }

        const promises = [];

        // 2. Loop through every URL and scrape it
        for (const targetUrl of parsedUrls) {
            promises.push((async () => {
                try {
                    const resp = await axios.get(targetUrl, { 
                        headers: { 
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
                            "Cookie": "xla=s4t" 
                        }
                    });
                    const $ = cheerio.load(resp.data);
                    const extractPromises = [];

                    $("p").each((i, pEl) => {
                        $(pEl).find("a").each((j, aEl) => {
                            const href = $(aEl).attr("href");
                            if (!href) return;

                            const lowerHref = href.toLowerCase();
                            if (lowerHref.includes("youtube.com") || lowerHref.includes("youtu.be")) return;

                            if (
                                lowerHref.includes("hub") || 
                                lowerHref.includes("vidstack") || 
                                lowerHref.includes("hdstream4u")
                            ) {
                                extractPromises.push(extractors.extractGeneric(href, targetUrl, subtitleCb, linkCb));
                            }
                        });
                    });

                    $("iframe").each((i, el) => {
                        const src = $(el).attr("src");
                        if (!src) return;
                        
                        const lowerSrc = src.toLowerCase();
                        if (
                            lowerSrc.includes("hub") || 
                            lowerSrc.includes("vidstack") || 
                            lowerSrc.includes("hdstream4u")
                        ) {
                            extractPromises.push(extractors.extractGeneric(src, targetUrl, subtitleCb, linkCb));
                        }
                    });

                    await Promise.all(extractPromises);

                } catch (e) {
                    console.error(`[HDhub4u] Failed to scrape intermediate link ${targetUrl}:`, e.message);
                }
            })());
        }

        // Wait for all intermediate pages to be scraped
        await Promise.all(promises);
        
        return links;
    }
}

if (typeof window !== 'undefined') {
    window['com.hdhub4u'] = new HDhub4uProvider();
}

module.exports = HDhub4uProvider;