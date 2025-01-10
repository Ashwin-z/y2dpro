require('dotenv').config();
const express = require('express');
const router = express.Router();
const app = express();
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const bodyParser = require('body-parser');
const NodeCache = require('node-cache');
const helmet = require('helmet');

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
// Define the route for rendering mp3.ejs
router.get('/mp3', (req, res) => { 
    res.render('mp3');
});


app.use(express.urlencoded({ extended: true }));
const puppeteer = require("puppeteer");

// Connect to Instagram
// API endpoint to fetch profile picture
// API endpoint to fetch profile picture using Puppeteer

app.use(bodyParser.json());
// Middleware configuration
const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

// Middleware for security headers
app.use(helmet());

// Middleware for CORS
app.use(cors({
    origin: ['https://y2dpro-production.up.railway.app/mp3'], // Replace with your allowed domains
    methods: ['GET', 'POST'],
}));

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
});
app.use(limiter);

// Body Parser Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static Assets
app.use(express.static('public'));

// Function to extract profile picture URLs
function extractProfilePicUrls(jsonResponse) {
    try {
        const data = JSON.parse(jsonResponse);
        let selectedUrl = null;

        function findInstagramUrls(obj) {
            if (typeof obj === 'string' && obj.includes('instagram.f') && obj.includes('/t51.2885-19/')) {
                if (!obj.match(/_s\d+x\d+/) && obj.includes('oh=') && obj.includes('oe=')) {
                    selectedUrl = obj;
                }
            } else if (obj && typeof obj === 'object') {
                Object.values(obj).forEach(value => findInstagramUrls(value));
            }
        }

        findInstagramUrls(data);
        return selectedUrl;
    } catch (error) {
        console.error('Error parsing response:', error.message);
        return null;
    }
}

// API Endpoint to fetch profile picture
router.post('/profile-pic', async (req, res) => {
    const { username } = req.body;

    if (!username || username.trim() === '') {
        return res.status(400).json({ error: 'Username is required' });
    }

    // Check cache first
    const cachedUrl = cache.get(username);
    if (cachedUrl) {
        return res.json({ url: cachedUrl });
    }

    // RapidAPI options
    const options = {
        method: 'POST',
        url: 'https://save-insta1.p.rapidapi.com/profile',
        headers: {
            'x-rapidapi-key': process.env.RAPIDAPI_KEY,
            'x-rapidapi-host': 'save-insta1.p.rapidapi.com',
            'Content-Type': 'application/json',
        },
        data: { username },
    };

    try {
        const response = await axios.request(options);
        const profilePicUrl = extractProfilePicUrls(JSON.stringify(response.data));

        if (profilePicUrl) {
            // Cache the URL
            cache.set(username, profilePicUrl);

            return res.json({ url: profilePicUrl });
        } else {
            return res.status(404).json({ error: 'Profile picture not found' });
        }
    } catch (error) {
        console.error('Error fetching profile picture:', error.message);
        return res.status(500).json({ error: 'Failed to fetch profile picture' });
    }
});

// Endpoint to download the profile picture
router.get('/download-pic', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).send('URL is required');
    }

    try {
        // Fetch the image data from the URL
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
        });

        // Set headers for downloading the file
        res.setHeader('Content-Disposition', 'attachment; filename="profile-pic.jpg"');
        response.data.pipe(res);
    } catch (error) {
        console.error('Error downloading profile picture:', error.message);
        res.status(500).send('Failed to download the profile picture');
    }
});

// Error Handling Middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});


module.exports = router;