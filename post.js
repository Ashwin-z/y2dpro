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

app.get('/download', async (req, res) => {
    try {
        const { url, filename, type } = req.query;

        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'Download URL is required'
            });
        }

        console.log(`Starting download for URL: ${url}, Type: ${type}`);

        // Create custom headers for the request
        const requestHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'image/*, video/*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Range': 'bytes=0-'
        };

        // First get the content information
        const headResponse = await axios.head(url, { headers: requestHeaders });
        const contentLength = headResponse.headers['content-length'];
        const contentType = headResponse.headers['content-type'];

        // Determine if it's an image or video based on content type
        const isImage = contentType.includes('image');
        const isVideo = contentType.includes('video');

        // Set the appropriate filename and extension
        const fileExtension = isVideo ? 'mp4' : 'jpg';
        const finalFilename = filename || `instagram-${isVideo ? 'video' : 'image'}.${fileExtension}`;

        // Set response headers to force download
        res.setHeader('Content-Type', 'application/octet-stream'); // Force download
        res.setHeader('Content-Disposition', `attachment; filename="${finalFilename}"`);
        res.setHeader('Content-Length', contentLength);
        res.setHeader('Content-Transfer-Encoding', 'binary');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        // Stream the response
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            headers: requestHeaders,
            timeout: 30000
        });

        // Create a transform stream to handle errors
        const stream = new require('stream').PassThrough();

        // Handle stream errors
        stream.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    message: 'Download failed during streaming',
                    details: error.message
                });
            }
        });

        // Pipe the response through our error-handling stream
        response.data.pipe(stream).pipe(res);

    } catch (error) {
        console.error('Download error:', error);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Download failed',
                details: error.message
            });
        }
    }
});
module.exports = router;
