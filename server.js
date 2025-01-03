require('dotenv').config();
const express = require('express');
const path = require('path');

const puppeteer = require('puppeteer');
const instagramGetUrl = require('instagram-url-direct'); // Changed import

const bodyParser = require('body-parser'); // Make sure this is installed
const cheerio = require('cheerio');

const os = require('os');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const env = require('dotenv').config();
const qs = require('querystring');
const axios = require('axios');
const app = express();
const cors = require('cors');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
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
app.get('/index', (req, res) => { 
    res.render('index');
});

app.get('/coming-soon', (req, res) => {
    res.render('Coming');
})
app.get('/privacy-policy', (req, res) => { 
    res.render('privacy-policy');
});
app.get('/terms', (req, res) => { 
    res.render('terms');
});
app.get('/contact', (req, res) => { 
    res.render('contact');
});
app.get('/faq', (req, res) => { 
    res.render('faq');
});
app.get('/about', (req, res) => { 
    res.render('about');
});



const mp3Routes = require('./mp3Routes');
app.use('/', mp3Routes);

const reelRoutes = require('./post');
app.use('/', reelRoutes);

// Test route to verify server is working
app.get('/test', (req, res) => {
    res.json({ message: 'Server is working!' });
});

const cache = new Map();
const CACHE_DURATION = 3600000; // 1 hour

// Browser instance management
let browserInstance = null;
const PAGE_POOL = [];
const MAX_PAGES = 3;

// Validate Instagram reel URLs - Optimized regex
const REEL_URL_REGEX = /^https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|tv)\/([A-Za-z0-9_-]+)/;

async function getBrowser() {
    if (!browserInstance) {
        browserInstance = await puppeteer.launch({
            executablePath:
              process.env.NODE_ENV === "production"
                ? process.env.PUPPETEER_EXECUTABLE_PATH
                : puppeteer.executablePath(),
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--no-zygote',
                '--disable-gpu',
                '--disable-extensions',
                '--disable-audio-output',
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-breakpad',
                '--disable-component-extensions-with-background-pages',
                '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection',
                '--disable-renderer-backgrounding',
                '--enable-features=NetworkService,NetworkServiceInProcess',
                '--mute-audio',
                '--no-default-browser-check',
                '--no-experiments',
                '--no-pings'
            ],
            defaultViewport: { width: 1280, height: 720 }
        });
    }
    return browserInstance;
}

async function getPage() {
    // Reuse existing page if available
    const freePage = PAGE_POOL.find(p => !p.inUse);
    if (freePage) {
        freePage.inUse = true;
        return freePage.page;
    }

    // Create new page if pool not full
    if (PAGE_POOL.length < MAX_PAGES) {
        const browser = await getBrowser();
        const page = await browser.newPage();
        
        // Optimize page settings
        await Promise.all([
            page.setRequestInterception(true),
            page.setDefaultNavigationTimeout(15000),
            page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
        ]);

        // Aggressive resource blocking for faster loading
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media', 'other'].includes(resourceType) ||
                req.url().includes('analytics') ||
                req.url().includes('logging')) {
                req.abort();
            } else {
                req.continue();
            }
        });

        PAGE_POOL.push({ page, inUse: true });
        return page;
    }

    // Wait for a page to become available
    return new Promise((resolve) => {
        const checkInterval = setInterval(async () => {
            const freePage = PAGE_POOL.find(p => !p.inUse);
            if (freePage) {
                clearInterval(checkInterval);
                freePage.inUse = true;
                resolve(freePage.page);
            }
        }, 100);
    });
}

async function releasePage(page) {
    const pageEntry = PAGE_POOL.find(p => p.page === page);
    if (pageEntry) {
        pageEntry.inUse = false;
    }
}

async function fetchReelContent(url, page) {
    try {
        // Optimize page load
        await page.evaluate(() => {
            window.scrollBy = () => {};
            window.innerWidth = 1280;
            window.innerHeight = 720;
        });

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15000
        });

        // Fast content extraction
        const content = await page.evaluate(() => {
            const metaTags = {};
            document.querySelectorAll('meta[property^="og:"]').forEach(meta => {
                metaTags[meta.getAttribute('property')] = meta.getAttribute('content');
            });

            return {
                thumbnail: metaTags['og:image'] || null,
                title: document.title?.slice(0, 50) || 'Instagram Reel',
                username: metaTags['og:title'] || null
            };
        });

        return content;
    } catch (error) {
        console.error('Error in fetchReelContent:', error);
        throw error;
    }
}

app.post('/api/fetch-instagram', async (req, res) => {
    const { url } = req.body;
    
    if (!url || !REEL_URL_REGEX.test(url)) {
        return res.status(400).json({
            success: false,
            message: 'Please provide a valid Instagram reel URL'
        });
    }

    try {
        // Check cache
        const cachedData = cache.get(url);
        if (cachedData && (Date.now() - cachedData.timestamp) < CACHE_DURATION) {
            return res.json(cachedData.data);
        }

        const page = await getPage();
        
        // Parallel fetching with timeout
        const [content, igResponse] = await Promise.all([
            fetchReelContent(url, page),
            Promise.race([
                instagramGetUrl(url),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), 15000)
                )
            ])
        ]);

        await releasePage(page);

        if (!igResponse?.url_list?.length) {
            throw new Error('Failed to fetch reel data');
        }

        const mediaUrl = igResponse.url_list.find(url => url.includes('.mp4'));
        const responseData = {
            success: true,
            type: 'reel',
            title: content.title,
            thumbnail: content.thumbnail,
            downloadUrl: mediaUrl,
            mediaType: 'video'
        };

        // Cache successful responses
        cache.set(url, {
            timestamp: Date.now(),
            data: responseData
        });

        res.json(responseData);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch reel: ' + error.message
        });
    }
});

app.get('/download', async (req, res) => {
    const { url, filename } = req.query;
    
    if (!url) {
        return res.status(400).json({ 
            success: false,
            message: 'Download URL is required' 
        });
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive'
            },
            timeout: 20000,
            maxContentLength: 200 * 1024 * 1024,
            signal: controller.signal
        });

        clearTimeout(timeout);

        res.setHeader('Content-Disposition', `attachment; filename="${filename || 'instagram-reel.mp4'}"`);
        res.setHeader('Content-Type', 'video/mp4');
        
        // Optimized streaming
        response.data.pipe(res);
        
        response.data.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({ success: false, message: 'Download failed' });
            }
        });

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Download failed',
            details: error.message 
        });
    }
});

// Cleanup on exit
process.on('SIGINT', async () => {
    if (browserInstance) {
        await browserInstance.close();
    }
    process.exit();
});



app.listen(PORT, () => {
    console.log(`Server is started on http://127.0.0.1:${PORT}`);
});
