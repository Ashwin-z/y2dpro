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

    // Post URL pattern
    const POST_URL_PATTERN = /^https?:\/\/(?:www\.)?instagram\.com\/p\/([A-Za-z0-9_-]+)/;

    // Ensure URL is provided and is a post URL
    if (!url || !POST_URL_PATTERN.test(url)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Please provide a valid Instagram post URL' 
        });
    }

    try {
        // Rest of your existing post download logic
        const content = await fetchInstagramContent(url);
        const igResponse = await instagramGetUrl(url);

        res.json({
            success: true,
            type: 'post',
            title: content.title,
            thumbnail: content.thumbnail,
            username: content.username,
            downloadUrl: igResponse?.url_list?.[0] || null,
            mediaType: igResponse?.url_list?.some(url => url.includes('.mp4')) ? 'video' : 'image'
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Download endpoint
app.get('/download', async (req, res) => {
    try {
        const { url, filename } = req.query;

        // Ensure URL is provided
        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'Download URL is required'
            });
        }

        console.log(`Starting download for URL: ${url}`);  // Log URL being downloaded

        // Fetch the content and pipe the response to the client
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 30000
        });

        // Set headers for file download
        res.setHeader('Content-Disposition', `y2dpro.com - attachment; filename="${filename || 'instagram-content'}`);
        res.setHeader('Content-Type', response.headers['content-type']);
        
        // Pipe the response data to the client
        response.data.pipe(res);

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({
            success: false,
            message: 'Download failed',
            details: error.message
        });
    }
});

module.exports = router;
