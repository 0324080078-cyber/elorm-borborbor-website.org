class MediaManager {
    constructor() {
        this.apiBase = 'http://localhost:3000/api/download';
        this.mediaBase = 'http://localhost:3000/borborbor-media';
    }

    async downloadAllMedia() {
        this.showMessage('🔄 Starting download from Facebook and TikTok...', 'info');
        this.showProgressBar(true);
        this.updateProgressBar(5);

        try {
            const res = await fetch(`${this.apiBase}/download-borborbor`, { method: 'POST' });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`HTTP ${res.status}: ${text}`);
            }

            const result = await res.json();

            if (result && result.success) {
                this.showMessage(`✅ Successfully downloaded ${result.total} Borborbor media files!`, 'success');
                this.updateProgressBar(100);
                await this.loadMediaList();
            } else {
                const errMsg = result && result.error ? result.error : 'Unknown error';
                this.showMessage(`❌ Download failed: ${errMsg}`, 'error');
            }
        } catch (error) {
            this.showMessage(`❌ Error: ${error.message}`, 'error');
            console.error('downloadAllMedia error:', error);
        } finally {
            // give the user a moment to see the final state
            setTimeout(() => this.showProgressBar(false), 2000);
        }
    }

    async loadMediaList() {
        const mediaList = document.getElementById('mediaList');
        if (!mediaList) {
            console.warn('No #mediaList element found in the DOM.');
            return;
        }

        mediaList.innerHTML = '<div class="loading">Loading media...</div>';

        try {
            const res = await fetch(`${this.apiBase}/borborbor-files`);
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`HTTP ${res.status}: ${text}`);
            }

            const result = await res.json();

            if (result && result.success && Array.isArray(result.files) && result.files.length > 0) {
                mediaList.innerHTML = result.files.map(file => this.createMediaCard(file)).join('');
            } else {
                mediaList.innerHTML = '<div class="no-media">No media files downloaded yet. Click "Download All Borborbor Media" to start.</div>';
            }
        } catch (error) {
            console.error('Error loading media list:', error);
            mediaList.innerHTML = '<div class="error">Error loading media files</div>';
        }
    }

    createMediaCard(file) {
        // file: { filename, type?, size?, mimetype? }
        const filename = file.filename || 'unknown';
        const filesize = typeof file.size === 'number' ? this.formatFileSize(file.size) : 'Unknown';
        const lowerType = (file.type || '').toLowerCase();
        const isVideo = lowerType === 'video' || /\.(mp4|mov|webm)$/i.test(filename);
        const mediaUrl = `${this.mediaBase}/${encodeURIComponent(filename)}`;

        const sourceLabel = filename.toLowerCase().includes('tiktok') ? 'TikTok' : 'Facebook';

        return `
            <div class="media-item">
                <div class="media-preview">
                    ${isVideo
                        ? `<video controls preload="metadata" class="media-video">
                                <source src="${mediaUrl}" type="video/mp4">
                                Your browser does not support videos.
                           </video>`
                        : `<img src="${mediaUrl}" alt="Borborbor ${lowerType || 'media'}" loading="lazy" class="media-image">`
                    }
                </div>
                <div class="media-info">
                    <h4 class="media-filename">${filename}</h4>
                    <p><strong>Type:</strong> ${isVideo ? 'Video' : (lowerType || 'Image')}</p>
                    <p><strong>Size:</strong> ${filesize}</p>
                    <p><strong>Source:</strong> ${sourceLabel}</p>
                    <a href="${mediaUrl}" target="_blank" rel="noopener" class="btn btn-small">Open Full</a>
                </div>
            </div>
        `;
    }

    formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    showProgressBar(show) {
        const progressBar = document.getElementById('progressBar');
        if (!progressBar) return;
        progressBar.style.display = show ? 'block' : 'none';
    }

    updateProgressBar(percent) {
        const progressFill = document.getElementById('progressFill');
        if (!progressFill) return;
        const p = Math.max(0, Math.min(100, Number(percent) || 0));
        progressFill.style.width = `${p}%`;
        progressFill.setAttribute('aria-valuenow', p.toString());
    }

    showMessage(message, type = 'info') {
        const messageDiv = document.getElementById('downloadMessage');
        if (!messageDiv) {
            console.warn('No #downloadMessage element found in the DOM. Message:', message);
            return;
        }

        messageDiv.textContent = message;
        // set a simple class to style by type: info, success, error
        messageDiv.className = `download-message ${type}`;

        // Auto-hide success messages after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                if (messageDiv) {
                    messageDiv.textContent = '';
                    messageDiv.className = 'download-message';
                }
            }, 5000);
        }
    }
}

// Global instance and helper functions
const mediaManager = new MediaManager();

function downloadAllMedia() {
    mediaManager.downloadAllMedia();
}

function refreshMedia() {
    mediaManager.loadMediaList();
}

// Load media when page opens
document.addEventListener('DOMContentLoaded', () => {
    mediaManager.loadMediaList();
});