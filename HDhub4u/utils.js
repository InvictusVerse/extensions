const CryptoJS = require('crypto-js');
const axios = require('axios');

function base64Decode(encoded) {
    // Browser-safe Base64 decode using CryptoJS (removes Node.js Buffer requirement)
    return CryptoJS.enc.Base64.parse(encoded).toString(CryptoJS.enc.Utf8);
}

function base64Encode(data) {
    // Browser-safe Base64 encode
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
        // Parse the Key and IV into CryptoJS WordArrays (16 bytes)
        const key = CryptoJS.enc.Utf8.parse(keyStr.padEnd(16, '\0').slice(0, 16));
        const iv = CryptoJS.enc.Utf8.parse(ivStr.padEnd(16, '\0').slice(0, 16));
        
        // Parse the raw hex ciphertext
        const ciphertext = CryptoJS.enc.Hex.parse(hexCiphertext);
        const cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext: ciphertext });
        
        // Decrypt using AES-CBC with PKCS7 padding (standard for createDecipheriv)
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
        const resp = await axios.get(url);
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
                const linkResp = await axios.get(`${blogUrl}?re=${dataField}`);
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
        const resp = await axios.get("https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json");
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
    base64Decode, base64Encode, rot13, aesDecryptCBC, cleanTitle,
    cleanFileTitle, getBaseUrl, getRedirectLinks, fetchDomains
};