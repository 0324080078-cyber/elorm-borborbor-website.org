const express = require('express');
const fs = require('fs');
const path = require('path');
const SocialMediaDownloader = require('../controllers/socialMediaDownloader');

const router = express.Router();

const downloader = new SocialMediaDownloader();

// Download all content from provided links
router.get('/download-borborbor', async (req, res) => {
    try {
        console.log('Starting Borborbor media download...');
        const results = await downloader.downloadAllContent();
        
        res.json({
            success: true,
            message: `Downloaded ${results.length} Borborbor media files`,
            files: results,
            total: results.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Download failed',
            error: error.message
        });
    }
});

// Get downloaded files list
router.get('/borborbor-files', (req, res) => {
    try {
        const files = downloader.getDownloadedFiles();
        
        res.json({
            success: true,
            files: files,
            total: files.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Serve downloaded files
router.get('/media/:filename', (req, res) => {
    const filename = req.params.filename;
    const filepath = path.resolve(__dirname, '../uploads/borborbor-media', filename);
    
    if (fs.existsSync(filepath)) {
        res.sendFile(filepath, (err) => {
            if (err) {
                res.status(500).json({ error: 'Failed to send file' });
            }
        });
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// Test individual platform download
router.get('/test-download', async (req, res) => {
    try {
        const links = downloader.getSocialMediaLinks();
        if (!links || !links.tiktok || links.tiktok.length === 0) {
            return res.status(400).json({ success: false, error: 'No TikTok links available for testing' });
        }

        const testResult = await downloader.downloadWithYtDlp(links.tiktok[0], 'tiktok-test');
        
        res.json({
            success: true,
            message: 'Test download completed',
            result: testResult
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;