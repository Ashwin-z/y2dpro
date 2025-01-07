const express = require('express');
const router = express.Router();
const app = express();
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const cheerio = require('cheerio');
const InstaFetcher = require('insta-fetcher');
const http = require('https');
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);
require('dotenv').config();
app.use(express.static('public'));

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
const bodyParser = require('body-parser');
app.use(bodyParser.json());
// Middleware configuration
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(express.json());
// Note: Replace with your Instagram credentials
// Your RapidAPI credentials
// RapidAPI credentials and endpoint


// Function to fetch profile picture
const options = {
    method: 'POST',
    hostname: 'save-insta1.p.rapidapi.com',
    port: null,
    path: '/profile',
    headers: {
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        'x-rapidapi-host': 'save-insta1.p.rapidapi.com',
        'Content-Type': 'application/json'
    }
};

function extractProfilePicUrls(jsonResponse) {
    try {
        const data = JSON.parse(jsonResponse);
        let selectedUrl = null;

        // Function to extract URLs matching the Instagram CDN pattern
        function findInstagramUrls(obj) {
            if (typeof obj === 'string' && obj.includes('instagram.f') && obj.includes('/t51.2885-19/')) {
                // Exclude URLs with sizes like s150x150, s320x320, s640x640 (resizing parameters)
                if (!obj.match(/_s\d+x\d+/) && obj.includes('oh=') && obj.includes('oe=')) {
                    selectedUrl = obj; // Select the full HD URL (highest resolution)
                }
            } else if (obj && typeof obj === 'object') {
                Object.values(obj).forEach(value => findInstagramUrls(value));
            }
        }

        // Search through the entire response
        findInstagramUrls(data);

        // Return the selected URL or null if no matching URL is found
        return selectedUrl;
    } catch (error) {
        console.error('Error parsing response:', error.message);
        return null;
    }
}



const req = http.request(options, function (res) {
    const chunks = [];

    res.on('data', function (chunk) {
        chunks.push(chunk);
    });

    res.on('end', function () {
        const body = Buffer.concat(chunks).toString();
        const profilePicUrl = extractProfilePicUrls(body);
    
        if (profilePicUrl) {
            console.log('Full HD Profile Picture URL:');
            console.log(profilePicUrl);
        } else {
            console.log('No full HD profile picture URL found in the response');
        }
    });
    
});

req.on('error', function(error) {
    console.error('Request failed:', error.message);
});


// API to fetch the profile picture URL
router.post('/profile-pic', (req, res) => {
    const { username } = req.body;

    if (!username || username.trim() === '') {
        return res.status(400).json({ error: 'Username is required' });
    }

    const reqData = http.request(options, function (response) {
        const chunks = [];

        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            const profilePicUrl = extractProfilePicUrls(body);

            if (profilePicUrl) {
                res.json({ url: profilePicUrl });
            } else {
                res.status(404).json({ error: 'Profile picture not found' });
            }
        });
    });

    reqData.on('error', (error) => {
        console.error('Request failed:', error.message);
        res.status(500).json({ error: 'Failed to fetch profile picture' });
    });

    reqData.write(JSON.stringify({ username }));
    reqData.end();
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
        res.setHeader('Content-Disposition', 'y2dpro.com - attachment; filename="profile-pic.jpg"');
        response.data.pipe(res);
    } catch (error) {
        console.error('Error downloading profile picture:', error.message);
        res.status(500).send('Failed to download the profile picture');
    }
});

module.exports = router;