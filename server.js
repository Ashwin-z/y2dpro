require('dotenv').config();
const express = require('express');
const path = require('path');
const puppeteer = require('puppeteer');
const instagramGetUrl = require('instagram-url-direct');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');

// Memory-based rate limiter
class RateLimiter {
    constructor(windowMs = 15 * 60 * 1000, maxRequests = 100) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        this.requests = new Map();
    }

    cleanOldRequests() {
        const now = Date.now();
        for (const [ip, data] of this.requests.entries()) {
            if (now - data.timestamp > this.windowMs) {
                this.requests.delete(ip);
            }
        }
    }

    checkLimit(ip) {
        this.cleanOldRequests();
        
        const now = Date.now();
        const requestData = this.requests.get(ip) || { count: 0, timestamp: now };
        
        if (now - requestData.timestamp > this.windowMs) {
            requestData.count = 1;
            requestData.timestamp = now;
        } else {
            requestData.count++;
        }
        
        this.requests.set(ip, requestData);
        return requestData.count <= this.maxRequests;
    }
}

// Memory-based request queue
class RequestQueue {
    constructor(maxConcurrent = 5) {
        this.queue = [];
        this.processing = new Set();
        this.maxConcurrent = maxConcurrent;
    }

    async add(task) {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.processNext();
        });
    }

    async processNext() {
        if (this.processing.size >= this.maxConcurrent || this.queue.length === 0) return;

        const { task, resolve, reject } = this.queue.shift();
        const taskId = uuidv4();
        this.processing.add(taskId);

        try {
            const result = await task();
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.processing.delete(taskId);
            this.processNext();
        }
    }
}

// Browser Pool Management
class BrowserPool {
    constructor(maxPages = 3) {
        this.pages = [];
        this.maxPages = maxPages;
        this.browserInstance = null;
    }

    async initialize() {
        if (!this.browserInstance) {
            this.browserInstance = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-extensions'
                ],
                defaultViewport: { width: 1280, height: 720 }
            });
        }
    }

    async getPage() {
        await this.initialize();

        const freePage = this.pages.find(p => !p.inUse);
        if (freePage) {
            freePage.inUse = true;
            return freePage.page;
        }

        if (this.pages.length < this.maxPages) {
            const page = await this.browserInstance.newPage();
            await this.optimizePage(page);
            const pageObj = { page, inUse: true };
            this.pages.push(pageObj);
            return page;
        }

        return new Promise((resolve) => {
            const interval = setInterval(async () => {
                const freePage = this.pages.find(p => !p.inUse);
                if (freePage) {
                    clearInterval(interval);
                    freePage.inUse = true;
                    resolve(freePage.page);
                }
            }, 100);
        });
    }

    async optimizePage(page) {
        await page.setRequestInterception(true);
        await page.setDefaultNavigationTimeout(15000);
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });
    }

    async releasePage(page) {
        const pageObj = this.pages.find(p => p.page === page);
        if (pageObj) {
            pageObj.inUse = false;
        }
    }

    async cleanup() {
        if (this.browserInstance) {
            await this.browserInstance.close();
            this.browserInstance = null;
            this.pages = [];
        }
    }
}

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize utilities
const rateLimiter = new RateLimiter();
const requestQueue = new RequestQueue();
const browserPool = new BrowserPool();
const cache = new Map();
const CACHE_DURATION = 3600000; // 1 hour

// Middleware
app.use(cors());
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", 'cdnjs.cloudflare.com'],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", 'https://api.instagram.com'],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

// Static files setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'views', 'assets')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));

// Routes
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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: Date.now(),
        queueSize: requestQueue.queue.length,
        activeProcessing: requestQueue.processing.size
    });
});

// Main API endpoint
app.post('/api/fetch-instagram', async (req, res) => {
    const clientIp = req.ip;
    const requestId = uuidv4();
    
    // Rate limiting check
    if (!rateLimiter.checkLimit(clientIp)) {
        return res.status(429).json({
            success: false,
            message: 'Too many requests. Please try again later.'
        });
    }

    const { url } = req.body;
    if (!url || !url.match(/^https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|tv)\/([A-Za-z0-9_-]+)/)) {
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

        // Queue the request
        const result = await requestQueue.add(async () => {
            const page = await browserPool.getPage();
            
            try {
                const [content, igResponse] = await Promise.all([
                    fetchReelContent(url, page),
                    Promise.race([
                        instagramGetUrl(url),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Timeout')), 15000)
                        )
                    ])
                ]);

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

                // Cache the result
                cache.set(url, {
                    timestamp: Date.now(),
                    data: responseData
                });

                return responseData;
            } finally {
                await browserPool.releasePage(page);
            }
        });

        res.json(result);
    } catch (error) {
        console.error(`Error processing request ${requestId}:`, error);
        res.status(500).json({
            success: false,
            message: process.env.NODE_ENV === 'production' 
                ? 'An error occurred while processing your request' 
                : error.message
        });
    }
});

async function fetchReelContent(url, page) {
    try {
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15000
        });

        return await page.evaluate(() => {
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
    } catch (error) {
        console.error('Error in fetchReelContent:', error);
        throw error;
    }
}

// Download endpoint
app.get('/download', async (req, res) => {
    const { url, filename } = req.query;
    
    if (!url) {
        return res.status(400).json({ 
            success: false,
            message: 'Download URL is required' 
        });
    }

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch video');

        res.setHeader('Content-Disposition', `savereelify.com - attachment; filename="${filename || 'instagram-reel.mp4'}"`);
        res.setHeader('Content-Type', 'video/mp4');
        
        response.body.pipe(res);

        response.body.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({ 
                    success: false, 
                    message: 'Download failed' 
                });
            }
        });
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Download failed',
            details: process.env.NODE_ENV === 'production' ? null : error.message
        });
    }
});

// Cleanup on server shutdown
process.on('SIGINT', async () => {
    await browserPool.cleanup();
    process.exit();
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});