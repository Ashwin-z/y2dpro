require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer');
const instagramGetUrl = require('instagram-url-direct');
const axios = require('axios');
const NodeCache = require('node-cache');
const { body, validationResult } = require('express-validator');

const app = express();
const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

// Basic Security Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "img-src": ["'self'", "https:", "data:"],
            "script-src": ["'self'", "'unsafe-inline'"]
        }
    }
}));

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false
});

// Apply rate limiting to all routes
app.use(limiter);

// Middleware Setup
app.use(cors());
app.use(express.static('public'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json());

// Static Files Setup
app.use(express.static(path.join(__dirname, 'views', 'assets')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));

// View Engine Setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.get('/', (req, res) => {
    res.render('downloader');
});
// URL Patterns
const INSTAGRAM_URL_PATTERNS = {
    post: /^https?:\/\/(?:www\.)?instagram\.com\/p\/([A-Za-z0-9_-]+)/,
    reel: /^https?:\/\/(?:www\.)?instagram\.com\/(?:reel|tv)\/([A-Za-z0-9_-]+)/
};

// Puppeteer Configuration
const PUPPETEER_CONFIG = {
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920x1080'
    ],
    defaultViewport: { width: 1920, height: 1080 }
};

// URL Validation Middleware
const validateInstagramUrl = [
    body('url')
        .trim()
        .notEmpty()
        .withMessage('URL is required')
        .matches(/^https?:\/\/(?:www\.)?instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+/)
        .withMessage('Invalid Instagram URL format'),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }
        next();
    }
];

// Helper Functions
async function fetchInstagramContent(url) {
    const cacheKey = `instagram_${url}`;
    const cachedContent = cache.get(cacheKey);
    
    if (cachedContent) {
        return cachedContent;
    }

    const browser = await puppeteer.launch(PUPPETEER_CONFIG);
    const page = await browser.newPage();

    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.goto(url, { 
            waitUntil: 'domcontentloaded', 
            timeout: 30000 
        });

        const content = await page.evaluate(() => ({
            thumbnail: document.querySelector('meta[property="og:image"]')?.content || null,
            title: document.title?.slice(0, 50) || 'Instagram Content',
            username: document.querySelector('meta[property="og:title"]')?.content || null
        }));

        cache.set(cacheKey, content);
        return content;
    } catch (error) {
        console.error('Error fetching Instagram content:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

async function detectMediaType(url) {
    if (!url) return null;
    
    try {
        if (url.includes('.mp4')) return 'video';
        if (url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png')) return 'image';

        const response = await axios({
            method: 'HEAD',
            url: url,
            timeout: 5000
        });

        const contentType = response.headers['content-type'];
        if (contentType.includes('video')) return 'video';
        if (contentType.includes('image')) return 'image';

        return 'image';
    } catch (error) {
        console.error('Error detecting media type:', error);
        return url.includes('video') ? 'video' : 'image';
    }
}

// Routes
app.get('/', (req, res) => {
    res.render('downloader');
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage()
    });
});

// API Endpoints
app.post('/api/fetch-instagram-post', validateInstagramUrl, async (req, res) => {
    const { url } = req.body;

    try {
        const content = await fetchInstagramContent(url);
        const igResponse = await instagramGetUrl(url);
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
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch Instagram content'
        });
    }
});

app.get('/download', async (req, res) => {
    const { url, filename, type } = req.query;
    
    if (!url || !filename) {
        return res.status(400).json({ 
            success: false, 
            message: 'URL and filename are required' 
        });
    }

    try {
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            timeout: 30000,
            maxContentLength: 50 * 1024 * 1024, // 50MB max
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate, br'
            }
        });

        const contentType = response.headers['content-type'];
        const contentLength = response.headers['content-length'];
        const fileExt = contentType.includes('video') ? '.mp4' : 
                       contentType.includes('jpeg') ? '.jpg' : '.png';
        
        const sanitizedFilename = `savereelify.com-${filename.replace(/[^a-zA-Z0-9]/g, '-')}${fileExt}`;

        res.setHeader('Content-Disposition', `attachment; filename="savereelify - ${sanitizedFilename}"`);
        res.setHeader('Content-Type', contentType);
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }

        response.data.pipe(res);

        res.on('finish', () => {
            response.data.destroy();
        });

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to download file' 
        });
    }
});

// Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: process.env.NODE_ENV === 'production' 
            ? 'An unexpected error occurred' 
            : err.message
    });
});

// Graceful Shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Performing graceful shutdown...');
    
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });

    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 10000);
});



module.exports = app;