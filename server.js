const express = require('express');
const path = require('path');
// const ytdlCore = require('ytdl-core');
const ytdlCore = require('@distube/ytdl-core');
const fs = require('fs');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const env = require('dotenv').config();
const app = express();
const cors = require('cors');

const PORT = process.env.PORT || 3001;
app.use(cors());


app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(express.static(path.join(__dirname, 'views', 'assets')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.get('/index', (req, res) => { 
    res.render('index');
});
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
app.get('/', (req, res) => { 
    res.render('downloader');
});
app.get('/mp3', (req, res) => { 
    res.render('mp3');
});


const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY; // Add this to your Render environment variables

app.get('/quick-info', async (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        const videoId = ytdlCore.getVideoID(videoUrl);
        if (!YOUTUBE_API_KEY) throw new Error('YouTube API key is missing');
        const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`;

        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('YouTube API error');
        const data = await response.json();

        if (data.items.length === 0) {
            return res.status(404).json({ error: 'Video not found' });
        }

        const videoDetails = data.items[0].snippet;
        res.json({
            title: videoDetails.title,
            thumbnail: videoDetails.thumbnails.high.url,
        });
    } catch (error) {
        console.error('Error fetching quick info:', error);
        res.status(500).json({ error: 'Failed to fetch video info' });
    }
});


app.get('/video-info', async (req, res) => {
    const videoUrl = decodeURIComponent(req.query.url);
    console.log('Received URL:', videoUrl);
  
    if (!videoUrl) {
        return res.status(400).json({ error: 'URL is required' });
    }
  
    try {
        if (!ytdlCore.validateURL(videoUrl)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }
  
        const videoInfo = await ytdlCore.getInfo(videoUrl);
  
        const getAccurateFileSize = async (url) => {
            try {
                const response = await fetch(url, {
                    method: 'HEAD',
                    headers: { 'Range': 'bytes=0-' }
                });
                const contentRange = response.headers.get('Content-Range');
                if (contentRange) {
                    const size = contentRange.split('/')[1];
                    return parseInt(size);
                }
            } catch (error) {
                console.error('Error fetching accurate file size:', error);
            }
            return null;
        };
  
        const calculateTotalSize = async (format, videoInfo) => {
            let totalSize = 0;
            if (format.url) {
                const accurateSize = await getAccurateFileSize(format.url);
                if (accurateSize) {
                    totalSize += accurateSize;
                } else if (format.contentLength) {
                    totalSize += parseInt(format.contentLength);
                }
            }
            if (!format.hasAudio && format.url) {
                const audioFormat = ytdlCore.chooseFormat(videoInfo.formats, { quality: 'highestaudio' });
                if (audioFormat && audioFormat.url) {
                    const audioSize = await getAccurateFileSize(audioFormat.url);
                    if (audioSize) {
                        totalSize += audioSize;
                    } else if (audioFormat.contentLength) {
                        totalSize += parseInt(audioFormat.contentLength);
                    }
                }
            }
            return totalSize;
        };
  
        const formatSize = (bytes) => {
            if (typeof bytes !== 'number' || isNaN(bytes)) {
                return 'Unknown';
            }
            const mb = bytes / 1024 / 1024;
            const lowerBound = mb.toFixed(1);
            
            return `${lowerBound}MB`;
        };
  
        const formats = await Promise.all(videoInfo.formats
            .filter(format => format.qualityLabel && format.hasVideo && format.itag !== 18)
            .map(async format => {
                const totalSize = await calculateTotalSize(format, videoInfo);
                return {
                    quality: format.qualityLabel,
                    itag: format.itag,
                    size: formatSize(totalSize),
                    mimeType: format.mimeType,
                    hasAudio: format.hasAudio
                };
            }));
  
        // Group formats by quality
        const groupedFormats = formats.reduce((acc, format) => {
            if (!acc[format.quality]) {
                acc[format.quality] = [];
            }
            acc[format.quality].push(format);
            return acc;
        }, {});
  
        // Select the best format for each quality
        const bestFormats = Object.values(groupedFormats).map(qualityGroup => {
            const withAudio = qualityGroup.filter(f => f.hasAudio);
            if (withAudio.length > 0) {
                return withAudio.reduce((a, b) => (parseFloat(a.size.split(' - ')[0]) < parseFloat(b.size.split(' - ')[0]) ? a : b));
            }
            return qualityGroup.reduce((a, b) => (parseFloat(a.size.split(' - ')[0]) < parseFloat(b.size.split(' - ')[0]) ? a : b));
        });
  
        // Sort formats by resolution (highest to lowest)
        bestFormats.sort((a, b) => {
            const aRes = parseInt(a.quality.split('p')[0]);
            const bRes = parseInt(b.quality.split('p')[0]);
            return bRes - aRes;
        });
  
        // Add a fallback format for 360p if it's missing
        if (!bestFormats.some(f => f.quality === '360p')) {
            const fallback360p = videoInfo.formats.find(f => f.qualityLabel === '360p' && f.itag !== 18);
            if (fallback360p) {
                const totalSize = await calculateTotalSize(fallback360p, videoInfo);
                bestFormats.push({
                    quality: '360p',
                    itag: fallback360p.itag,
                    size: formatSize(totalSize),
                    mimeType: fallback360p.mimeType,
                    hasAudio: fallback360p.hasAudio
                });
            }
        }
  
        // Add MP3 format
        const audioFormat = ytdlCore.chooseFormat(videoInfo.formats, { quality: 'highestaudio', filter: 'audioonly' });
        const audioSize = await calculateTotalSize(audioFormat, videoInfo);
        bestFormats.push({
            quality: 'Audio (MP3)',
            itag: audioFormat.itag,
            size: formatSize(audioSize),
            mimeType: audioFormat.mimeType,
            hasAudio: true
        });
  
        res.json({
          
            formats: bestFormats,
            url: videoUrl
        });
    } catch (error) {
        console.error('Error fetching video info:', error);
        res.status(500).json({ error: 'Failed to fetch video info' });
    }
  });
  



  const { spawn } = require('child_process');


  

  app.get('/download', async (req, res) => {
    const videoUrl = decodeURIComponent(req.query.url);
    const itag = req.query.itag;

    console.log('Download URL:', videoUrl);
    console.log('Download itag:', itag);

    if (!videoUrl || !itag) {
        return res.status(400).json({ error: 'URL and itag are required' });
    }

    try {
        const isHighQuality = parseInt(itag) > 140;
        const ytdl = isHighQuality ? distubeYtdlCore : ytdlCore;

        const videoInfo = await ytdl.getInfo(videoUrl);
        const selectedFormat = videoInfo.formats.find(format => format.itag == itag);

        if (!selectedFormat) {
            console.error('Selected format not found');
            return res.status(500).json({ error: 'Selected format not found' });
        }
        console.log(`Selected format: ${selectedFormat.qualityLabel} with itag ${selectedFormat.itag}`);

        const tempDir = os.tmpdir();
        const outputFilePath = path.join(tempDir, `video-${Date.now()}.mp4`);

        if (selectedFormat.hasAudio) {
            // If the format already has audio, download it directly
            await new Promise((resolve, reject) => {
                ytdl(videoUrl, { quality: itag })
                    .pipe(fs.createWriteStream(outputFilePath))
                    .on('finish', resolve)
                    .on('error', reject);
            });
        } else {
            // If the format doesn't have audio, we need to merge video and audio
            const videoStream = ytdl(videoUrl, { quality: itag });
            const audioStream = ytdl(videoUrl, { quality: 'highestaudio', filter: 'audioonly' });

            await new Promise((resolve, reject) => {
                const ffmpeg = spawn(ffmpegPath, [
                    '-i', 'pipe:3',   // Video input
                    '-i', 'pipe:4',   // Audio input
                    '-c:v', 'copy',   // Copy video stream as is
                    '-c:a', 'aac',    // Encode audio as AAC
                    '-movflags', 'faststart',  // Enable fast start for web playback
                    outputFilePath    // Output file
                ], {
                    stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe']
                });

                videoStream.pipe(ffmpeg.stdio[3]);
                audioStream.pipe(ffmpeg.stdio[4]);

                ffmpeg.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`FFmpeg process exited with code ${code}`));
                    }
                });

                ffmpeg.on('error', reject);
            });
        }

        // Set headers for file download
        res.setHeader('Content-Disposition', `attachment; filename="y2dpro.com - ${videoInfo.videoDetails.title} ${selectedFormat.qualityLabel}.mp4"`);
        res.setHeader('Content-Type', 'video/mp4');

        // Stream the file to the client
        const fileStream = fs.createReadStream(outputFilePath);
        fileStream.pipe(res);

        // Delete the file after it's sent
        fileStream.on('close', () => {
            fs.unlink(outputFilePath, (err) => {
                if (err) console.error('Error deleting temporary file:', err);
            });
        });

    } catch (error) {
        console.error('Error downloading video:', error);
        res.status(500).json({ error: 'Failed to download video', details: error.message });
    }
});




app.listen(PORT, () => {
    console.log(`Server is started on http://127.0.0.1:${PORT}`);
});
