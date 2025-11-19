class DownloadManager {
    constructor(apiBase = 'http://localhost:3000/api') {
        this.apiBase = apiBase;
    }

    async downloadAll() {
        this.showMessage('Starting download from all social media platforms...', 'info');

        try {
            const response = await fetch(`${this.apiBase}/download/download-all`);
            const result = await response.json();

            if (result && result.success) {
                this.showMessage(`✅ Downloaded ${result.files.length} files successfully!`, 'success');
                this.displayResults(result.files);
                await this.listFiles(); // Refresh file list
            } else {
                const err = result && result.error ? result.error : 'Unknown error';
                this.showMessage(`❌ Download failed: ${err}`, 'error');
            }
        } catch (error) {
            this.showMessage(`❌ Error: ${error.message}`, 'error');
        }
    }

    async downloadFrom(platform) {
        this.showMessage(`Downloading from ${platform}...`, 'info');

        try {
            const links = {
                tiktok: 'https://share.google/5IWZLxustUaQqTNsM',
                instagram: 'https://share.google/eAuMkoKodiuxNGdMF',
                facebook: 'https://share.google/bS1Sv2X7fy54ZOi69'
            };

            if (!links[platform]) {
                this.showMessage(`❌ Unknown platform: ${platform}`, 'error');
                return;
            }

            const endpoint = `${this.apiBase}/download/download/${encodeURIComponent(platform)}?url=${encodeURIComponent(links[platform])}`;
            const response = await fetch(endpoint);
            const result = await response.json();

            if (result && result.success) {
                this.showMessage(`✅ Downloaded ${result.files.length} files from ${platform}`, 'success');
                this.displayResults(result.files);
                await this.listFiles();
            } else {
                const err = result && result.error ? result.error : 'Unknown error';
                this.showMessage(`❌ ${platform} download failed: ${err}`, 'error');
            }
        } catch (error) {
            this.showMessage(`❌ Error downloading from ${platform}: ${error.message}`, 'error');
        }
    }

    async listFiles() {
        try {
            const response = await fetch(`${this.apiBase}/download/files`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            const fileList = document.getElementById('fileList');
            if (!fileList) return;

            fileList.innerHTML = '';

            if (result && Array.isArray(result.files) && result.files.length > 0) {
                result.files.forEach(file => {
                    const fileElement = this.createFileElement(file);
                    fileList.appendChild(fileElement);
                });
            } else {
                fileList.innerHTML = '<p>No files downloaded yet.</p>';
            }
        } catch (error) {
            console.error('Error listing files:', error);
            this.showMessage(`❌ Error listing files: ${error.message}`, 'error');
        }
    }

    createFileElement(file = {}) {
        const div = document.createElement('div');
        div.className = 'file-item';

        const isVideo = file.type === 'video';
        const fileUrl = `${this.apiBase.replace(/\/api\/?$/, '')}/media/${encodeURIComponent(file.filename)}`;

        const preview = document.createElement('div');
        preview.className = 'file-preview';

        if (isVideo) {
            const video = document.createElement('video');
            video.controls = true;
            video.width = 200;

            const source = document.createElement('source');
            source.src = fileUrl;
            source.type = 'video/mp4';

            video.appendChild(source);
            video.textContent = 'Your browser does not support the video tag.';
            preview.appendChild(video);
        } else {
            const img = document.createElement('img');
            img.src = fileUrl;
            img.alt = file.filename || 'file';
            img.width = 200;
            preview.appendChild(img);
        }

        const info = document.createElement('div');
        info.className = 'file-info';

        const title = document.createElement('h4');
        title.textContent = file.filename || 'unknown';

        const sizeP = document.createElement('p');
        sizeP.textContent = `Size: ${this.formatFileSize(file.size || 0)}`;

        const typeP = document.createElement('p');
        typeP.textContent = `Type: ${file.type || 'unknown'}`;

        const link = document.createElement('a');
        link.href = fileUrl;
        link.target = '_blank';
        link.className = 'btn btn-small';
        link.textContent = 'Open Full Size';

        info.appendChild(title);
        info.appendChild(sizeP);
        info.appendChild(typeP);
        info.appendChild(link);

        div.appendChild(preview);
        div.appendChild(info);

        return div;
    }

    formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    showMessage(message, type = 'info') {
        const messageDiv = document.getElementById('progressMessage');
        if (!messageDiv) return;
        messageDiv.textContent = message;
        messageDiv.className = `progress-message ${type}`;
    }

    displayResults(files = []) {
        const resultsDiv = document.getElementById('downloadResults');
        if (!resultsDiv) return;

        resultsDiv.innerHTML = '<h4>Downloaded Files:</h4>';
        if (!Array.isArray(files) || files.length === 0) {
            const p = document.createElement('p');
            p.textContent = 'No new files.';
            resultsDiv.appendChild(p);
            return;
        }

        files.forEach(file => {
            const fileElement = document.createElement('div');
            fileElement.className = 'result-item';
            fileElement.innerHTML = `<strong>${this._escapeHtml(file.platform || 'unknown')}</strong>: ${this._escapeHtml(file.filename || '')} (${this._escapeHtml(file.type || '')})`;
            resultsDiv.appendChild(fileElement);
        });
    }

    // Small helper to avoid inserting raw HTML from server responses
    _escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

// Global functions for buttons
const downloadManager = new DownloadManager();

function downloadAll() {
    downloadManager.downloadAll();
}

function downloadFrom(platform) {
    downloadManager.downloadFrom(platform);
}

function listFiles() {
    downloadManager.listFiles();
}

// Load files when page loads
document.addEventListener('DOMContentLoaded', () => {
    listFiles();
});

// Expose on window for debugging if needed
window.downloadManager = downloadManager;
window.downloadAll = downloadAll;
window.downloadFrom = downloadFrom;
window.listFiles = listFiles;