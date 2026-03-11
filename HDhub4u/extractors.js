const axios = require('axios');
const cheerio = require('cheerio');
const utils = require('./utils');

function getIndexQuality(header) {
    const match = header.match(/(\d{3,4})[pP]/);
    return match ? parseInt(match[1]) : 2160;
}

async function extractVidStack(url, referer, subtitleCb, linkCb) {
    try {
        const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0" };
        let hash = url.split('#').pop();
        if (hash.includes('/')) hash = hash.split('/').pop();
        
        const baseUrl = utils.getBaseUrl(url);
        const resp = await axios.get(`${baseUrl}/api/v1/video?id=${hash}`, { headers });
        const encoded = resp.data.toString().trim();
        
        const key = "kiemtienmua911ca";
        const ivs = ["1234567890oiuytr", "0123456789abcdef"];
        
        let decrypted = "";
        for (const iv of ivs) {
            decrypted = utils.aesDecryptCBC(encoded, key, iv);
            if (decrypted) break;
        }
        if (!decrypted) return;

        const m3u8Match = decrypted.match(/"source":"(.*?)"/);
        if (m3u8Match) {
            let m3u8 = m3u8Match[1].replace(/\\\//g, '/');
            if (m3u8.startsWith("https")) m3u8 = "http" + m3u8.substring(5);
            
            const subtitleSection = decrypted.match(/"subtitle":\{(.*?)\}/);
            if (subtitleSection) {
                const subMatches = [...subtitleSection[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)];
                for (const match of subMatches) {
                    const lang = match[1];
                    let path = match[2].split('#')[0].replace(/\\\//g, '/');
                    if (path) {
                        subtitleCb({ lang, url: baseUrl + path });
                    }
                }
            }

            linkCb({
                source: "Vidstack", name: "Vidstack", url: m3u8,
                referer: url, type: "M3U8", quality: 0, headers: { referer: url }
            });
        }
    } catch (e) { console.error("[VidStack] Error:", e.message); }
}

async function extractHubCloud(url, referer, subtitleCb, linkCb) {
    try {
        let href = url;
        const baseUrl = utils.getBaseUrl(url);

        if (!url.includes("hubcloud.php")) {
            const resp = await axios.get(url);
            const $ = cheerio.load(resp.data);
            const rawHref = $('#download').attr('href');
            if (rawHref) {
                href = rawHref.startsWith('http') ? rawHref : `${baseUrl}${rawHref.startsWith('/') ? '' : '/'}${rawHref}`;
            }
        }
        if (!href) return;

        const resp2 = await axios.get(href);
        const $ = cheerio.load(resp2.data);
        
        const size = $('i#size').text().trim();
        const header = $('div.card-header').text().trim();
        const headerDetails = utils.cleanFileTitle(header);
        const quality = getIndexQuality(header);
        const labelExtras = (headerDetails ? `[${headerDetails}]` : "") + (size ? `[${size}]` : "");

        const promises = [];
        $('a.btn').each((_, el) => {
            const buttonLink = $(el).attr('href');
            const label = $(el).text().toLowerCase();

            if (label.includes("fsl server")) {
                linkCb({ source: `${referer} [FSL Server]`, name: `${referer} [FSL Server] ${labelExtras}`, url: buttonLink, quality });
            } else if (label.includes("download file")) {
                linkCb({ source: referer, name: `${referer} ${labelExtras}`, url: buttonLink, quality });
            } else if (label.includes("buzzserver")) {
                promises.push(axios.get(`${buttonLink}/download`, { headers: { Referer: buttonLink }, maxRedirects: 0 })
                    .catch(err => {
                        if (err.response && err.response.headers.location) {
                            linkCb({ source: `${referer} [BuzzServer]`, name: `${referer} [BuzzServer] ${labelExtras}`, url: err.response.headers.location, quality });
                        }
                    }));
            } else if (label.includes("pixeldra") || label.includes("pixel server")) {
                const fileId = buttonLink.split('/').pop().split('?')[0];
                const pixelBase = utils.getBaseUrl(buttonLink);
                const finalUrl = buttonLink.includes("download") ? buttonLink : `${pixelBase}/api/file/${fileId}?download`;
                linkCb({ source: `${referer} Pixeldrain`, name: `${referer} Pixeldrain ${labelExtras}`, url: finalUrl, quality });
            } else if (label.includes("s3 server")) {
                linkCb({ source: `${referer} [S3 Server]`, name: `${referer} [S3 Server] ${labelExtras}`, url: buttonLink, quality });
            } else if (label.includes("fslv2")) {
                linkCb({ source: `${referer} [FSLv2]`, name: `${referer} [FSLv2] ${labelExtras}`, url: buttonLink, quality });
            } else if (label.includes("mega server")) {
                linkCb({ source: `${referer} [Mega Server]`, name: `${referer} [Mega Server] ${labelExtras}`, url: buttonLink, quality });
            } else {
                promises.push(extractGeneric(buttonLink, "", subtitleCb, linkCb));
            }
        });
        await Promise.all(promises);
    } catch (e) { console.error("[HubCloud] Error:", e.message); }
}

async function extractHubdrive(url, referer, subtitleCb, linkCb) {
    try {
        const resp = await axios.get(url);
        const $ = cheerio.load(resp.data);
        const href = $('.btn.btn-primary.btn-user.btn-success1.m-1').attr('href');
        if (!href) return;

        if (href.toLowerCase().includes("hubcloud")) {
            await extractHubCloud(href, "HubDrive", subtitleCb, linkCb);
        } else {
            await extractGeneric(href, "HubDrive", subtitleCb, linkCb);
        }
    } catch (e) {}
}

async function extractHubCDN(url, referer, subtitleCb, linkCb) {
    try {
        const resp = await axios.get(url);
        const match = resp.data.match(/reurl\s*=\s*"([^"]+)"/);
        if (!match) return;

        let encoded = match[1];
        if (encoded.includes("?r=")) encoded = encoded.split("?r=")[1];
        
        let decoded = utils.base64Decode(encoded);
        if (decoded.includes("link=")) decoded = decoded.split("link=")[1];

        if (decoded) {
            linkCb({ source: "HUBCDN", name: "HUBCDN", url: decoded, quality: 0 });
        }
    } catch (e) {}
}

async function extractHubcdnn(url, referer, subtitleCb, linkCb) {
    try {
        const resp = await axios.get(url);
        const match = resp.data.match(/r=([A-Za-z0-9+/=]+)/);
        if (!match) return;

        let m3u8 = utils.base64Decode(match[1]);
        if (m3u8.includes("link=")) m3u8 = m3u8.split("link=")[1];

        if (m3u8) {
            linkCb({ source: "Hubcdn", name: "Hubcdn", url: m3u8, type: "M3U8", referer: url, quality: 0 });
        }
    } catch (e) {}
}

async function extractHblinks(url, referer, subtitleCb, linkCb) {
    try {
        const resp = await axios.get(url);
        const $ = cheerio.load(resp.data);
        const promises = [];

        $('h3 a, h5 a, div.entry-content p a').each((_, el) => {
            const href = $(el).attr('href');
            if (!href) return;

            const lower = href.toLowerCase();
            if (lower.includes("hubdrive")) promises.push(extractHubdrive(href, "Hblinks", subtitleCb, linkCb));
            else if (lower.includes("hubcloud")) promises.push(extractHubCloud(href, "Hblinks", subtitleCb, linkCb));
            else if (lower.includes("hubcdn")) promises.push(extractHubCDN(href, "Hblinks", subtitleCb, linkCb));
            else promises.push(extractGeneric(href, "Hblinks", subtitleCb, linkCb));
        });
        await Promise.all(promises);
    } catch (e) {}
}

async function extractGeneric(url, referer, subtitleCb, linkCb) {
    const lower = url.toLowerCase();
    if (lower.includes("hubcloud")) {
        await extractHubCloud(url, referer, subtitleCb, linkCb);
    } else if (lower.includes("hubstream") || lower.includes("vidstack") || lower.includes("hdstream4u")) {
        await extractVidStack(url, referer, subtitleCb, linkCb);
    } else if (lower.includes("hblinks")) {
        await extractHblinks(url, referer, subtitleCb, linkCb);
    } else if (lower.includes("hubcdn")) {
        await extractHubCDN(url, referer, subtitleCb, linkCb);
    } else if (lower.includes("hubcdnn")) {
        await extractHubcdnn(url, referer, subtitleCb, linkCb);
    } else if (lower.includes("hubdrive")) {
        await extractHubdrive(url, referer, subtitleCb, linkCb);
    } else if (lower.includes("pixeldrain") || lower.includes("pixeldra")) {
        const pixelBase = utils.getBaseUrl(url);
        const fileId = url.split('/').pop().split('?')[0];
        linkCb({ source: "Pixeldrain", name: "Pixeldrain", url: `${pixelBase}/api/file/${fileId}?download`, quality: 0 });
    } else if (lower.includes("streamtape")) {
        try {
            const resp = await axios.get(url);
            const match = resp.data.match(/document\.getElementById\('robotlink'\)\.innerHTML = '([^']+)'/);
            if (match) {
                linkCb({ source: "StreamTape", name: "StreamTape", url: `https:${match[1]}`, quality: 0 });
            }
        } catch (e) {}
    } else {
        linkCb({ source: referer || "Direct", name: referer || "Direct", url: url, quality: 0 });
    }
}

module.exports = {
    extractVidStack, extractHubCloud, extractHblinks, extractHubCDN,
    extractHubcdnn, extractHubdrive, extractGeneric
};