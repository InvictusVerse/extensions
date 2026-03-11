const provider = {
    name: "HDhub4u",
    lang: "hi",
    mainUrl: "https://hdhub4u.rehab",

    // Automatically fetches the latest working domain from GitHub
    resolveDomain: function() {
        try {
            let response = Bridge.fetchUrl("https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json");
            let json = JSON.parse(response);
            if (json && json.hdhub4u) {
                this.mainUrl = json.hdhub4u;
            }
        } catch (e) {
            // Silently fail and use fallback URL
        }
    },

    // 1. Load Homepage
    getMainPage: function() {
        this.resolveDomain();
        let html = Bridge.fetchUrl(this.mainUrl);
        let results = [];

        let regex = /<div class="post-item[^>]*>[\s\S]*?<a href="([^"]+)"[\s\S]*?<img.*?src="([^"]+)"[\s\S]*?alt="([^"]+)"/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
            results.push({
                url: match[1],
                posterUrl: match[2],
                name: match[3].replace(/&#[0-9]+;/g, "").trim()
            });
        }

        return [{
            title: "Recently Added",
            items: results
        }];
    },

    // 2. Search
    search: function(query) {
        this.resolveDomain();
        let searchUrl = this.mainUrl + "/?s=" + encodeURIComponent(query);
        let html = Bridge.fetchUrl(searchUrl);
        let results = [];

        let regex = /<div class="post-item[^>]*>[\s\S]*?<a href="([^"]+)"[\s\S]*?<img.*?src="([^"]+)"[\s\S]*?alt="([^"]+)"/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
            results.push({
                url: match[1],
                posterUrl: match[2],
                name: match[3].replace(/&#[0-9]+;/g, "").trim()
            });
        }

        return results;
    },

    // 3. Load Movie/Show Details
    load: function(url) {
        let html = Bridge.fetchUrl(url);

        let titleMatch = /<div class="post-title">\s*<h1>(.*?)<\/h1>/i.exec(html);
        let title = titleMatch ? titleMatch[1].replace(/&#[0-9]+;/g, "").trim() : "";

        let posterMatch = /<div class="post-thumbnail">\s*<img.*?src="([^"]+)"/i.exec(html);
        let posterUrl = posterMatch ? posterMatch[1] : "";

        let links = [];
        let linkRegex = /<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/g;
        let lMatch;

        while ((lMatch = linkRegex.exec(html)) !== null) {
            let linkUrl = lMatch[1];
            let linkText = lMatch[2].replace(/<[^>]+>/g, "").trim();

            if (linkUrl.includes("hubcloud") || linkUrl.includes("filemoon") || linkUrl.includes("wish")) {
                links.push({
                    name: linkText,
                    url: linkUrl
                });
            }
        }

        return {
            name: title,
            url: url,
            posterUrl: posterUrl,
            episodes: links 
        };
    },

    // 4. Extractor Logic (Converts Hubcloud/Filemoon links to direct .m3u8/.mp4)
    loadLinks: function(episodeUrl) {
        let finalLinks = [];

        // HubCloud acts as a redirector. We fetch it and find the real embed links.
        if (episodeUrl.includes("hubcloud") || episodeUrl.includes("drivehub")) {
            let html = Bridge.fetchUrl(episodeUrl);
            
            // Extract the actual provider links from the HubCloud page buttons
            let hostRegex = /href="([^"]+)"[^>]*class="[^"]*btn[^"]*"/gi;
            let match;
            
            while ((match = hostRegex.exec(html)) !== null) {
                let innerUrl = match[1];
                
                if (innerUrl.includes("wish")) {
                    finalLinks = finalLinks.concat(this.extractStreamWish(innerUrl));
                } else if (innerUrl.includes("filemoon")) {
                    finalLinks = finalLinks.concat(this.extractFilemoon(innerUrl));
                } else if (innerUrl.includes("voe")) {
                    finalLinks = finalLinks.concat(this.extractVoe(innerUrl));
                }
            }
        } else {
            // Direct link provided
            if (episodeUrl.includes("wish")) finalLinks = finalLinks.concat(this.extractStreamWish(episodeUrl));
            else if (episodeUrl.includes("filemoon")) finalLinks = finalLinks.concat(this.extractFilemoon(episodeUrl));
            else if (episodeUrl.includes("voe")) finalLinks = finalLinks.concat(this.extractVoe(episodeUrl));
        }

        return finalLinks;
    },

    // --- SPECIFIC EXTRACTORS ---

    extractStreamWish: function(url) {
        let links = [];
        try {
            let html = Bridge.fetchUrl(url);
            let unpacked = this.unpackScript(html);
            let m3u8Match = /file\s*:\s*["'](.*?m3u8.*?)["']/i.exec(unpacked || html);
            if (m3u8Match) {
                links.push({ name: "StreamWish", url: m3u8Match[1], isM3u8: true });
            }
        } catch(e) {}
        return links;
    },

    extractFilemoon: function(url) {
        let links = [];
        try {
            let html = Bridge.fetchUrl(url);
            let unpacked = this.unpackScript(html);
            let m3u8Match = /file\s*:\s*["'](.*?m3u8.*?)["']/i.exec(unpacked || html);
            if (m3u8Match) {
                links.push({ name: "Filemoon", url: m3u8Match[1], isM3u8: true });
            }
        } catch(e) {}
        return links;
    },

    extractVoe: function(url) {
        let links = [];
        try {
            let html = Bridge.fetchUrl(url);
            let m3u8Match = /'hls'\s*:\s*'([^']+)'/i.exec(html);
            if (m3u8Match) {
                links.push({ name: "Voe", url: m3u8Match[1], isM3u8: true });
            }
        } catch(e) {}
        return links;
    },

    // JavaScript Unpacker (Replaces the heavy C++ JSUnpacker completely)
    unpackScript: function(html) {
        let packedRegex = /eval\s*\(\s*function\s*\(p,a,c,k,e,d\).*?\.split\('\|'\).*?\)/i;
        let match = packedRegex.exec(html);
        if (match) {
            let packedScript = match[0];
            let unpacked = "";
            // Intercept the execution of the packed script to steal the decoded string
            let fakeEval = function(str) { unpacked = str; };
            try {
                let safeScript = packedScript.replace(/^eval\s*\(/i, 'fakeEval(');
                eval(safeScript); // This will call our fakeEval instead of running it globally
                return unpacked;
            } catch(e) {}
        }
        return "";
    }
};