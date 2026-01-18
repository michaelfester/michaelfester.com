require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Configuration
const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.AWS_REGION || 'us-east-1';
const S3_BASE_URL = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`;

const OUTPUT_DIR = path.join(__dirname, '..');
const ARTISTS_FILE = path.join(__dirname, 'artists.json');

// Encode S3 path for use in URLs
function encodeS3Path(filePath) {
  // Split by '/' to preserve directory structure, encode each segment
  return filePath
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

// Get full S3 URL with proper encoding
function getS3Url(filePath) {
  return `${S3_BASE_URL}/${encodeS3Path(filePath)}`;
}

// HTML template for the main index page
function generateIndexPage(artists) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Art Collection</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #f5f5f5;
      color: #333;
      line-height: 1.6;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 40px;
      font-weight: 300;
      color: #111;
    }
    .artists-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 24px;
    }
    .artist-card {
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      transition: transform 0.2s, box-shadow 0.2s;
      text-decoration: none;
      color: inherit;
      display: block;
    }
    .artist-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    }
    .artist-preview {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2px;
      background: #eee;
    }
    .artist-preview img {
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
    }
    .artist-info {
      padding: 20px;
    }
    .artist-name {
      font-size: 1.25rem;
      font-weight: 500;
      margin-bottom: 4px;
    }
    .artist-count {
      color: #666;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Art Collection</h1>
    <div class="artists-grid">
      ${artists.map(artist => {
        // Get first 6 artworks for preview
        const previewArtworks = artist.artworks.slice(0, 6);
        return `
      <a href="quilts/${artist.id}.html" class="artist-card">
        <div class="artist-preview">
          ${previewArtworks.map(artwork => `
          <img src="${getS3Url(artwork.thumbnailPath || artwork.path)}" alt="${artwork.title}" loading="lazy">
          `).join('')}
        </div>
        <div class="artist-info">
          <div class="artist-name">${artist.name}</div>
          <div class="artist-count">${artist.artworks.length} artworks</div>
        </div>
      </a>`;
      }).join('')}
    </div>
  </div>
</body>
</html>`;
}

// HTML template for individual artist pages
function generateArtistPage(artist) {
  // Sort artworks by year
  const sortedArtworks = [...artist.artworks].sort((a, b) => {
    const yearA = parseInt(a.year) || 0;
    const yearB = parseInt(b.year) || 0;
    return yearA - yearB;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${artist.name} - Art Collection</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #f5f5f5;
      color: #333;
      line-height: 1.6;
    }
    .container {
      max-width: 100%;
    }
    .header {
      max-width: 1400px;
      margin: 0 auto;
      padding: 40px 20px 40px;
    }
    .back-link {
      color: #666;
      text-decoration: none;
      font-size: 0.9rem;
      display: inline-block;
      margin-bottom: 16px;
    }
    .back-link:hover {
      color: #333;
    }
    h1 {
      font-size: 2.5rem;
      font-weight: 300;
      color: #111;
      margin-bottom: 8px;
    }
    .artwork-count {
      color: #666;
      font-size: 1rem;
    }
    .gallery {
      display: flex;
      flex-wrap: wrap;
      line-height: 0;
    }
    .artwork {
      height: 60px;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .artwork:hover {
      opacity: 0.8;
    }
    .artwork img {
      height: 60px;
      width: auto;
      display: block;
    }

    /* Lightbox */
    .lightbox {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.95);
      z-index: 1000;
      justify-content: center;
      align-items: center;
      cursor: pointer;
    }
    .lightbox.active {
      display: flex;
    }
    .lightbox img {
      max-width: 95%;
      max-height: 95%;
      object-fit: contain;
    }
    .lightbox-info {
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      color: white;
      text-align: center;
      font-size: 0.9rem;
    }
    .lightbox-close {
      position: absolute;
      top: 20px;
      right: 20px;
      color: white;
      font-size: 2rem;
      cursor: pointer;
      opacity: 0.7;
      transition: opacity 0.2s;
    }
    .lightbox-close:hover {
      opacity: 1;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <a href="../quilts.html" class="back-link">← Back to Artists</a>
      <h1>${artist.name}</h1>
      <div class="artwork-count">${artist.artworks.length} artworks</div>
    </div>
    <div class="gallery">
      ${sortedArtworks.map(artwork => {
        const escapedTitle = artwork.title.replace(/[''\']/g, "\\'");
        return `<div class="artwork" onclick="openLightbox('${getS3Url(artwork.path)}', '${escapedTitle}', '${artwork.year}', '${artwork.dimensions}')"><img src="${getS3Url(artwork.thumbnailPath || artwork.path)}" alt="${artwork.title.replace(/"/g, '&quot;')}" loading="lazy"></div>`;
      }).join('')}
    </div>
  </div>

  <div class="lightbox" id="lightbox" onclick="closeLightbox()">
    <span class="lightbox-close">&times;</span>
    <img id="lightbox-img" src="" alt="">
    <div class="lightbox-info">
      <div id="lightbox-title"></div>
      <div id="lightbox-meta"></div>
    </div>
  </div>

  <script>
    function openLightbox(src, title, year, dimensions) {
      const lightbox = document.getElementById('lightbox');
      const img = document.getElementById('lightbox-img');
      const titleEl = document.getElementById('lightbox-title');
      const metaEl = document.getElementById('lightbox-meta');

      img.src = src;
      titleEl.textContent = title;
      metaEl.textContent = year + ' · ' + dimensions;
      lightbox.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
      const lightbox = document.getElementById('lightbox');
      lightbox.classList.remove('active');
      document.body.style.overflow = '';
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeLightbox();
      }
    });
  </script>
</body>
</html>`;
}

// Main function
function main() {
  console.log('Generating gallery pages...\n');

  // Check for required env vars
  if (!S3_BUCKET) {
    console.error('Error: S3_BUCKET not set in .env file');
    process.exit(1);
  }

  // Load artists data
  if (!fs.existsSync(ARTISTS_FILE)) {
    console.error('Error: artists.json not found. Run the scraper first.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(ARTISTS_FILE, 'utf8'));
  const artists = data.artists.filter(a => a.artworks.length > 0);

  console.log(`Found ${artists.length} artists with artworks`);

  // Create quilts directory if it doesn't exist
  const quiltsDir = path.join(OUTPUT_DIR, 'quilts');
  if (!fs.existsSync(quiltsDir)) {
    fs.mkdirSync(quiltsDir, { recursive: true });
  }

  // Generate main index page
  const indexHtml = generateIndexPage(artists);
  const indexPath = path.join(OUTPUT_DIR, 'quilts.html');
  fs.writeFileSync(indexPath, indexHtml);
  console.log(`Generated: quilts.html`);

  // Generate individual artist pages
  for (const artist of artists) {
    const artistHtml = generateArtistPage(artist);
    const artistPath = path.join(quiltsDir, `${artist.id}.html`);
    fs.writeFileSync(artistPath, artistHtml);
    console.log(`Generated: quilts/${artist.id}.html (${artist.artworks.length} artworks)`);
  }

  console.log('\nDone! Open quilts.html to view the gallery.');
}

main();
