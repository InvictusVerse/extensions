const CryptoJS = require('crypto-js');

// --- PIGGYBACK ON THE REACT IPC PIPELINE ---
const nativeAxios = {
    get: async (url, config = {}) => {
        const headers = config.headers || {};
        const maxRedirects = config.maxRedirects !== undefined ? config.maxRedirects : -1;
        const followRedirects = maxRedirects !== 0;

        // Check if React has exposed the Native Fetch bridge
        if (typeof window !== 'undefined' && window.StreamCoreProviders?.backend?.nativeFetch) {
            console.log("[NativeAxios] Routing GET via React Bridge:", url);
            
            const res = await window.StreamCoreProviders.backend.nativeFetch(url, 'GET', headers, '', followRedirects);

            let data = res.body;
            try { data = JSON.parse(res.body); } catch(e) {}

            const responseObj = {
                data: data,
                status: res.statusCode,
                headers: { location: res.redirectUrl || "" }
            };

            if (res.statusCode >= 300 && res.statusCode < 400 && !followRedirects) {
                const err = new Error("Redirected");
                err.response = responseObj;
                throw err;
            }

            if (!res.success && res.statusCode >= 400) {
                const err = new Error("Request failed with status code " + res.statusCode);
                err.response = responseObj;
                throw err;
            }
            return responseObj;
        } else {
            console.warn("[NativeAxios] React Bridge missing. Falling back to sandbox axios.");
            const axios = require('axios');
            return axios.get(url, config);
        }
    },
    post: async (url, data, config = {}) => {
        const headers = config.headers || {};
        if (typeof window !== 'undefined' && window.StreamCoreProviders?.backend?.nativeFetch) {
            console.log("[NativeAxios] Routing POST via React Bridge:", url);
            
            const bodyStr = typeof data === 'string' ? data : JSON.stringify(data);
            const res = await window.StreamCoreProviders.backend.nativeFetch(url, 'POST', headers, bodyStr, true);
            
            let parsedData = res.body;
            try { parsedData = JSON.parse(res.body); } catch(e) {}
            
            const responseObj = { data: parsedData, status: res.statusCode, headers: {} };
            if (!res.success && res.statusCode >= 400) {
                const err = new Error("Request failed with status code " + res.statusCode);
                err.response = responseObj;
                throw err;
            }
            return responseObj;
        } else {
            const axios = require('axios');
            return axios.post(url, data, config);
        }
    }
};

function base64Decode(encoded) {
    return CryptoJS.enc.Base64.parse(encoded).toString(CryptoJS.enc.Utf8);
}

function base64Encode(data) {
    return CryptoJS.enc.Utf8.parse(data).toString(CryptoJS.enc.Base64);
}

function rot13(str) {
    return str.replace(/[a-zA-Z]/g, function(c) {
        return String.fromCharCode(
            (c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26
        );
    });
}

function aesDecryptCBC(hexCiphertext, keyStr, ivStr) {
    try {
        const key = CryptoJS.enc.Utf8.parse(keyStr.padEnd(16, '\0').slice(0, 16));
        const iv = CryptoJS.enc.Utf8.parse(ivStr.padEnd(16, '\0').slice(0, 16));
        const ciphertext = CryptoJS.enc.Hex.parse(hexCiphertext);
        const cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext: ciphertext });
        const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
            iv: iv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        });
        return decrypted.toString(CryptoJS.enc.Utf8);
    } catch (e) {
        console.error("AES Decrypt Error:", e.message);
        return "";
    }
}

function cleanTitle(raw) {
    let name = raw;
    const parenPos = name.indexOf('(');
    if (parenPos !== -1) name = name.substring(0, parenPos);
    name = name.trim().replace(/\s+/g, ' ');
    if (name.length > 0) name = name.charAt(0).toUpperCase() + name.slice(1);
    
    const seasonMatch = raw.match(/Season\s*(\d+)/i);
    const yearMatch = raw.match(/\b(19|20)\d{2}\b/);
    
    let result = name;
    if (seasonMatch) result += ` (Season ${seasonMatch[1]})`;
    if (yearMatch) result += ` (${yearMatch[0]})`;
    return result;
}

function cleanFileTitle(title) {
    let name = title.replace(/\.[a-zA-Z0-9]{2,4}$/, '');
    const parts = name.split(/[\s_\.]+/).filter(Boolean);
    const sourceTags = ["WEB-DL","WEBRIP","BLURAY","HDRIP","DVDRIP","HDTV","CAM","TS","BRRIP","BDRIP"];
    const codecTags = ["H264","H265","X264","X265","HEVC","AVC"];
    const audioTags = ["AAC","AC3","DTS","MP3","FLAC","DD","DDP","EAC3"];
    const hdrTags = ["SDR","HDR","HDR10","HDR10+","DV","DOLBYVISION"];
    
    const filtered = [];
    for (const part of parts) {
        const p = part.toUpperCase();
        if (sourceTags.includes(p) || codecTags.includes(p) || hdrTags.includes(p) || p === "ATMOS" || p === "NF" || p === "CR") {
            filtered.push(p);
        } else {
            for (const at of audioTags) {
                if (p.startsWith(at)) { filtered.push(p); break; }
            }
        }
    }
    return [...new Set(filtered)].join(' ');
}

function getBaseUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.origin;
    } catch {
        return url;
    }
}

async function getRedirectLinks(url) {
    try {
        const resp = await nativeAxios.get(url);
        const doc = resp.data;
        const re = /s\('o','([A-Za-z0-9+/=]+)'\)|ck\('_wp_http_\d+','([^']+)'\)/g;
        let combined = "";
        let match;
        
        while ((match = re.exec(doc)) !== null) {
            if (match[1]) combined += match[1];
            else if (match[2]) combined += match[2];
        }

        const decoded = base64Decode(rot13(base64Decode(base64Decode(combined))));
        const obj = JSON.parse(decoded);
        
        const encodedUrl = base64Decode(obj.o || "").trim();
        const dataField = base64Decode(obj.data || "").trim();
        const blogUrl = (obj.blog_url || "").trim();

        let directLink = "";
        try {
            if (blogUrl && dataField) {
                const linkResp = await nativeAxios.get(`${blogUrl}?re=${dataField}`);
                directLink = linkResp.data.trim();
            }
        } catch (e) {}

        return encodedUrl || directLink;
    } catch (e) {
        return "";
    }
}

let cachedDomains = null;
async function fetchDomains(forceRefresh = false) {
    if (cachedDomains && !forceRefresh) return cachedDomains;
    try {
        const resp = await nativeAxios.get("https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json");
        cachedDomains = {
            hubcloud: resp.data.hubcloud,
            hdhub4u: resp.data.HDHUB4u
        };
        return cachedDomains;
    } catch (e) {
        return null;
    }
}

module.exports = {
    nativeAxios, 
    base64Decode, base64Encode, rot13, aesDecryptCBC, cleanTitle,
    cleanFileTitle, getBaseUrl, getRedirectLinks, fetchDomains
};