const express = require('express');
const path = require('path');
const router = express.Router();
const puppeteer = require('puppeteer');
const instagramGetUrl = require('instagram-url-direct'); // Changed import
const bodyParser = require('body-parser'); // Make sure this is installed
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());
app.use(express.static('public'));
app.use(express.json()); // For parsing application/json
app.use(express.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded
app.use(bodyParser.json());
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(express.static(path.join(__dirname, 'views', 'assets')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));


router.get('/', (req, res) => {
    res.render('downloader');
});

app.get('/test', (req, res) => {
    res.json({ message: 'Server is working!' });
});

// Instagram URL patterns to match post, TV, and reel
const INSTAGRAM_URL_PATTERNS = {
    post: /^https?:\/\/(?:www\.)?instagram\.com\/p\/([A-Za-z0-9_-]+)/
};

function getUrlType(url) {
    if (INSTAGRAM_URL_PATTERNS.post.test(url)) return 'post';
    return null;
}

// Function to fetch Instagram content using Puppeteer
async function fetchInstagramContent(url) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    try {
        await page.setUserAgent('Mozilla/5.0...');
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 100000 });

        const content = await page.evaluate(() => {
            const thumbnail = document.querySelector('meta[property="og:image"]')?.content || null;
            const title = document.title?.slice(0, 50) || 'Instagram Content';
            const username = document.querySelector('meta[property="og:title"]')?.content || null;

            return { thumbnail, title, username };
        });

        return content;
    } catch (error) {
        console.error('Error fetching Instagram content:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

// API endpoint to fetch Instagram content
router.post('/api/fetch-instagram-post', async (req, res) => {
    const { url } = req.body;

    try {
        const content = await fetchInstagramContent(url);
        const igResponse = await instagramGetUrl(url);

        // Improved media type detection
        const mediaType = await detectMediaType(igResponse?.url_list?.[0]);

        res.json({
            success: true,
            type: 'post',
            title: content.title,
            thumbnail: content.thumbnail,
            username: content.username,
            downloadUrl: igResponse?.url_list?.[0] || null,
            mediaType
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Add this new helper function for media type detection
async function detectMediaType(url) {
    if (!url) return null;
    
    try {
        // First check the URL pattern
        if (url.includes('.mp4')) return 'video';
        if (url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png')) return 'image';

        // If no clear extension, make a HEAD request
        const response = await axios({
            method: 'HEAD',
            url: url,
            timeout: 5000
        });

        const contentType = response.headers['content-type'];
        if (contentType.includes('video')) return 'video';
        if (contentType.includes('image')) return 'image';

        // Default to image if we can't determine type
        return 'image';
    } catch (error) {
        console.error('Error detecting media type:', error);
        // If we can't detect, check URL for common patterns
        return url.includes('video') ? 'video' : 'image';
    }
}

// Helper function to get file extension from content type
function getFileExtension(contentType) {
    const types = {
        'video/mp4': '.mp4',
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png'
    };
    return types[contentType] || '.jpg';
}

// Handle downloads
router.get('/download', async (req, res) => {
    const { url, filename, type } = req.query;
    
    if (!url || !filename) {
        return res.status(400).json({ 
            success: false, 
            message: 'URL and filename are required' 
        });
    }

    try {
        // Get the file with a streaming response
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        // Get content type and size
        const contentType = response.headers['content-type'];
        const contentLength = response.headers['content-length'];

        // Determine proper file extension
        const fileExt = getFileExtension(contentType);
        const sanitizedFilename = filename.replace(/[^a-zA-Z0-9]/g, '-') + fileExt;

        // Set headers for download
        res.setHeader('Content-Disposition', `attachment; filename="savereelify.com - ${sanitizedFilename}"`);
        res.setHeader('Content-Type', contentType);
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }

        // Handle different content types
        if (type === 'video') {
            // For videos, we'll pipe the stream directly
            response.data.pipe(res);
        } else {
            // For images, we'll also pipe directly
            response.data.pipe(res);
        }

        // Handle errors during streaming
        response.data.on('error', (error) => {
            console.error('Error streaming file:', error);
            if (!res.headersSent) {
                res.status(500).json({ 
                    success: false, 
                    message: 'Error downloading file' 
                });
            }
        });

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to download file' 
        });
    }
});

// Optional: Add a route to check download status
router.get('/download-status/:downloadId', (req, res) => {
    // Implement download status checking if needed
    res.json({ status: 'completed' });
});

module.exports = router;
