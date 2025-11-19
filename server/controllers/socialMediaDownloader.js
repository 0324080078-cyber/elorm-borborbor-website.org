const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

class SocialMediaDownloader {
    constructor() {
        this.downloadDir = path.join(__dirname, '../uploads/borborbor-media');
        this.ensureDirectoryExists();
    }

    ensureDirectoryExists() {
        if (!fs.existsSync(this.downloadDir)) {
            fs.mkdirSync(this.downloadDir, { recursive: true });
        }
    }

    // REAL LINKS PROVIDED BY USER
    getSocialMediaLinks() {
        return {
            facebook: [
                'https://www.facebook.com/groups/415760661306857/permalink/791877887028464',
                'https://www.facebook.com/groups/415760661306857/permalink/415760727973517'
            ],
            tiktok: [
                'https://www.tiktok.com/@elorm.borborbor.g/video/7569276213580107020',
                'https://vm.tiktok.com/ZMAcGoW1V/'
            ]
        };
    }

    async downloadAllContent() {
        console.log('🔄 Starting download from ELORM Borborbor social media...');
        const results = [];

        // Download from Facebook
        try {
            const facebookResults = await this.downloadFacebookContent();
            results.push(...facebookResults);
            console.log(`✅ Downloaded ${facebookResults.length} items from Facebook`);
        } catch (error) {
            console.error('❌ Facebook download failed:', error && error.message ? error.message : error);
        }

        // Download from TikTok
        try {
            const tiktokResults = await this.downloadTikTokContent();
            results.push(...tiktokResults);
            console.log(`✅ Downloaded ${tiktokResults.length} items from TikTok`);
        } catch (error) {
            console.error('❌ TikTok download failed:', error && error.message ? error.message : error);
        }

        return results;
    }

    async downloadFacebookContent() {
        const links = this.getSocialMediaLinks().facebook;
        const results = [];

        for (const link of links) {
            try {
                console.log(`📥 Downloading from Facebook: ${link}`);

                // Prefer yt-dlp for social downloads; fallback to direct fetch if it fails
                try {
                    const result = await this.downloadWithYtDlp(link, 'facebook');
                    if (result) results.push(result);
                    continue;
                } catch (err) {
                    console.warn('yt-dlp failed for Facebook link, attempting direct download fallback:', err && err.message ? err.message : err);
                }

                // fallback (best-effort)
                const directResult = await this.downloadDirect(link, 'facebook');
                if (directResult) results.push(directResult);
            } catch (error) {
                console.error(`Failed to download ${link}:`, error && error.message ? error.message : error);
            }
        }

        return results;
    }

    async downloadTikTokContent() {
        const links = this.getSocialMediaLinks().tiktok;
        const results = [];

        for (const link of links) {
            try {
                console.log(`📥 Downloading from TikTok: ${link}`);

                try {
                    const result = await this.downloadWithYtDlp(link, 'tiktok');
                    if (result) results.push(result);
                    continue;
                } catch (err) {
                    console.warn('yt-dlp failed for TikTok link, attempting direct download fallback:', err && err.message ? err.message : err);
                }

                const directResult = await this.downloadDirect(link, 'tiktok');
                if (directResult) results.push(directResult);
            } catch (error) {
                console.error(`Failed to download ${link}:`, error && error.message ? error.message : error);
            }
        }

        return results;
    }

    downloadWithYtDlp(url, platform) {
        return new Promise((resolve, reject) => {
            const filenamePattern = `borborbor-${platform}-${Date.now()}.%(ext)s`;
            const outputPath = path.join(this.downloadDir, filenamePattern);

            // Ensure yt-dlp binary is quoted
            const command = `yt-dlp -o "${outputPath}" "${url}"`;

            // increase buffer for verbose output
            exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                const combined = `${stdout || ''}\n${stderr || ''}`.trim();

                if (error) {
                    // If yt-dlp returns non-zero code, provide stderr for debugging
                    reject(new Error((error && error.message) || `yt-dlp failed. ${stderr || stdout}`));
                    return;
                }

                const downloadedFile = this.extractDownloadedFile(combined);
                if (downloadedFile) {
                    const filepath = path.join(this.downloadDir, downloadedFile);
                    resolve({
                        platform,
                        filename: downloadedFile,
                        type: downloadedFile.endsWith('.mp4') ? 'video' : 'image',
                        source: url,
                        filepath
                    });
                    return;
                }

                // If we cannot parse the output, still try to find a newly created file in the folder matching pattern
                try {
                    const created = fs.readdirSync(this.downloadDir)
                        .filter(f => f.startsWith(`borborbor-${platform}-`))
                        .map(f => ({ f, t: fs.statSync(path.join(this.downloadDir, f)).birthtimeMs }))
                        .sort((a, b) => b.t - a.t);

                    if (created.length > 0) {
                        const downloaded = created[0].f;
                        resolve({
                            platform,
                            filename: downloaded,
                            type: downloaded.endsWith('.mp4') ? 'video' : 'image',
                            source: url,
                            filepath: path.join(this.downloadDir, downloaded)
                        });
                        return;
                    }
                } catch (e) {
                    // ignore
                }

                reject(new Error('Could not determine downloaded file from yt-dlp output.'));
            });
        });
    }

    extractDownloadedFile(output) {
        if (!output) return null;
        const lines = output.split(/\r?\n/).map(l => l.trim());

        // Look for common yt-dlp lines
        for (const line of lines) {
            // e.g. "[download] Destination: /path/borborbor-tiktok-...mp4"
            if (line.includes('Destination:')) {
                const idx = line.indexOf('Destination:');
                const part = line.substring(idx + 'Destination:'.length).trim();
                if (part) return path.basename(part);
            }

            // e.g. "[Merger] Merging formats into "path/to/file.mp4""
            if (line.includes('Merging formats into')) {
                const parts = line.split('Merging formats into');
                if (parts[1]) {
                    const candidate = parts[1].replace(/["']/g, '').trim();
                    if (candidate) return path.basename(candidate);
                }
            }

            // e.g. "Deleting original file ... (pass -k to keep)"
            // or other patterns - check for path-looking tokens
            const matchPath = line.match(/\/?([^\s]+borborbor-[\w-]+\.\w{2,4})/i);
            if (matchPath && matchPath[1]) {
                return path.basename(matchPath[1]);
            }
        }

        return null;
    }

    // Alternative: Direct download if yt-dlp fails
    async downloadDirect(url, platform) {
        try {
            const response = await axios({
                method: 'GET',
                url,
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 30_000
            });

            // Determine extension from content-type or url
            let ext = null;
            const contentType = (response.headers['content-type'] || '').toLowerCase();
            if (contentType.includes('video')) ext = 'mp4';
            else if (contentType.includes('image/png')) ext = 'png';
            else if (contentType.includes('image/webp')) ext = 'webp';
            else if (contentType.includes('image/jpeg')) ext = 'jpg';

            if (!ext) {
                const parsed = path.parse(new URL(url).pathname || '');
                if (parsed.ext) ext = parsed.ext.replace('.', '');
            }
            if (!ext) ext = 'jpg';

            const filename = `borborbor-${platform}-direct-${Date.now()}.${ext}`;
            const filepath = path.join(this.downloadDir, filename);

            const writer = fs.createWriteStream(filepath);
            response.data.pipe(writer);

            return await new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    resolve({
                        platform,
                        filename,
                        type: ext === 'mp4' ? 'video' : 'image',
                        source: url,
                        filepath
                    });
                });
                writer.on('error', (err) => {
                    // remove incomplete file
                    try { fs.unlinkSync(filepath); } catch (e) {}
                    reject(err);
                });
            });
        } catch (error) {
            throw new Error(`Direct download failed: ${error && error.message ? error.message : error}`);
        }
    }

    // Get list of downloaded files
    getDownloadedFiles() {
        try {
            const files = fs.readdirSync(this.downloadDir);
            return files.map(filename => {
                const filepath = path.join(this.downloadDir, filename);
                const stats = fs.statSync(filepath);

                return {
                    filename,
                    filepath,
                    url: `/media/${filename}`,
                    size: stats.size,
                    type: filename.endsWith('.mp4') ? 'video' : 'image',
                    created: stats.birthtime
                };
            });
        } catch (error) {
            return [];
        }
    }
}

module.exports = SocialMediaDownloader;