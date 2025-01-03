const express = require('express');
const router = express.Router();
const app = express();
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const cheerio = require('cheerio');
const InstaFetcher = require('insta-fetcher');
const https = require('https');
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
const RAPIDAPI_KEY = process.env.KEY;
const RAPIDAPI_HOST = 'save-insta1.p.rapidapi.com';
const ENDPOINT_URL = `https://${RAPIDAPI_HOST}/profileposts`;

// Helper function to recursively search for HD profile URL in nested object
// Helper function to find HD profile URL
function findHDProfileUrl(obj) {
  if (!obj || typeof obj !== 'object') return null;

  if (obj.hd_profile_pic_url_info && obj.hd_profile_pic_url_info.url) {
      return { url: obj.hd_profile_pic_url_info.url, type: 'HD' };
  }

  if (obj.profile_pic_url &&
      !obj.profile_pic_url.includes('150x150') &&
      !obj.profile_pic_url.includes('320x320')) {
      return { url: obj.profile_pic_url, type: 'Full Size' };
  }

  for (const key in obj) {
      if (Array.isArray(obj[key])) {
          for (const item of obj[key]) {
              const result = findHDProfileUrl(item);
              if (result) return result;
          }
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          const result = findHDProfileUrl(obj[key]);
          if (result) return result;
      }
  }

  return null;
}

// Function to fetch profile picture
async function fetchProfilePicture(username) {
  try {
      console.log(`Fetching high-resolution profile picture for: ${username}`);
      const response = await fetch(ENDPOINT_URL, {
          method: 'POST',
          headers: {
              'x-rapidapi-key': "36e84dee12msh44306a8f68cd375p176090jsn88f44b1db756",
              'x-rapidapi-host': "save-insta1.p.rapidapi.com",
              'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username }),
      });

      if (!response.ok) {
          throw new Error(`Error fetching profile: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('API Response Structure:', JSON.stringify(data.data?.user || data.items?.[0]?.user || data, null, 2));

      const profilePic = findHDProfileUrl(data);
      if (!profilePic) {
          throw new Error('No HD or full-size profile picture URL found in response');
      }

      console.log(`Found ${profilePic.type} profile picture URL: ${profilePic.url}`);
      return profilePic.url;

  } catch (error) {
      console.error('Error fetching profile picture:', error.message);
      throw error;
  }
}

// Route to fetch HD URL
// Backend: Fetch profile picture URL dynamically based on the username
router.get('/fetch-hd-url', async (req, res) => {
  const username = req.query.username; // Fetch username from query parameters
  if (!username) {
      return res.status(400).json({ success: false, error: 'Username is required' });
  }

  try {
      const imageUrl = await fetchProfilePicture(username);
      res.json({ success: true, url: imageUrl });
  } catch (error) {
      console.error('Error fetching profile picture:', error.message);
      res.status(500).json({ success: false, error: error.message });
  }
});

// New route for downloading profile picture
// Download endpoint
router.get('/download-profile-pic', async (req, res) => {
  try {
      const imageUrl = req.query.url;
      
      if (!imageUrl) {
          return res.status(400).json({ 
              success: false, 
              error: 'Image URL is required' 
          });
      }

      // Fetch the image with appropriate headers
      const response = await axios({
          url: imageUrl,
          method: 'GET',
          responseType: 'arraybuffer',
          headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
              'Referer': 'https://www.instagram.com/',
              'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
          }
      });

      // Generate filename from URL or use default
      const filename = `instagram_profile_${Date.now()}.jpg`;

      // Set response headers for download
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', response.data.length);

      // Send the image data
      res.send(response.data);

  } catch (error) {
      console.error('Download error:', error);
      res.status(500).json({ 
          success: false, 
          error: 'Failed to download image',
          details: error.message 
      });
  }
});


// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server Error:', error);
  res.status(500).json({
      success: false,
      error: 'Internal server error'
  });
});

module.exports = router;