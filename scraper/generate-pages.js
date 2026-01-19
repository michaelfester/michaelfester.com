require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Configuration
const S3_BUCKET = process.env.S3_BUCKET;

// Artist display order (by artist ID)
const ARTIST_ORDER = [
  'claude-monet',
  'paul-cezanne',
  'henri-matisse',
  'pablo-picasso',
  'rembrandt',
  'egon-schiele',
];

// Generate random pure dark grey with lightness variation
function getRandomArtistColor() {
  const baseLightness = 0.25;
  const lightnessVariation = (Math.random() - 0.5) * 0.1; // ±0.05
  const l = baseLightness + lightnessVariation;
  return `oklch(${l} 0 0)`; // chroma 0 = pure grey
}
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
  <title>Quilts</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #000;
      color: #FFF6ED;
      line-height: 1.6;
    }
    .container {
      max-width: 100%;
    }
    .back-link {
      position: absolute;
      top: 20px;
      left: 20px;
      color: #FFF6ED;
      font-size: 13px;
      font-weight: normal;
      opacity: 0.6;
      text-decoration: none;
    }
    .back-link:hover {
      opacity: 1;
    }
    .back-link .chevron {
      margin-right: 4px;
    }
    .back-link .label {
      text-decoration: underline dotted;
      text-decoration-color: rgba(255, 246, 237, 0.5);
      text-underline-offset: 3px;
    }
    .artists-list {
      padding-top: 80px;
      padding-bottom: 80px;
    }
    .artist-section {
      margin-bottom: 30px;
    }
    .artist-header {
      padding: 20px 16px 10px 16px;
    }
    .artist-header-inner {
      max-width: 800px;
      margin: 0 auto;
    }
    .artist-name {
      font-size: 14px;
      font-weight: normal;
      color: #FFF6ED;
      text-decoration: none;
    }
    .artist-name:hover {
      text-decoration: underline;
    }
    .artist-quilt-link {
      display: block;
      max-width: 800px;
      margin: 0 auto;
      padding: 0px 16px 0px 16px;
      background: #111;
    }
    .artist-preview {
      width: 100%;
      height: auto;
      display: block;
      transition: opacity 0.2s;
      aspect-ratio: 800 / 120;
      object-fit: cover;
    }
    .artist-preview:hover {
      opacity: 0.8;
    }
  </style>
</head>
<body>
  <div class="container">
    <a href="../index.html" class="back-link"><span class="chevron">‹</span><span class="label">Back to michaelfester.com</span></a>
    <div class="artists-list">
    ${artists.map(artist => `
    <div class="artist-section">
      <div class="artist-header">
        <div class="artist-header-inner">
          <a href="./${artist.id}.html" class="artist-name">${artist.name}</a>
        </div>
      </div>
      <a href="./${artist.id}.html" class="artist-quilt-link">
        <img src="./previews/${artist.id}.webp" alt="${artist.name}" class="artist-preview" loading="lazy">
      </a>
    </div>`).join('')}
    </div>
  </div>

</body>
</html>`;
}

// HTML template for individual artist pages
function generateArtistPage(artist) {
  // Filter out artworks with unknown year and sort by year
  const sortedArtworks = [...artist.artworks]
    .filter(a => a.year && a.year !== 'Unknown')
    .sort((a, b) => {
      const yearA = parseInt(a.year) || 0;
      const yearB = parseInt(b.year) || 0;
      return yearA - yearB;
    });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${artist.name} - Quilts</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #000;
      color: #FFF6ED;
      line-height: 1.6;
    }
    .container {
      max-width: 100%;
    }
    .header {
      padding: 80px 20px 80px 20px;
      text-align: center;
    }
    .back-link {
      position: absolute;
      top: 20px;
      left: 20px;
      color: #FFF6ED;
      font-size: 13px;
      font-weight: normal;
      opacity: 0.6;
      text-decoration: none;
    }
    .back-link:hover {
      opacity: 1;
    }
    .back-link .chevron {
      margin-right: 4px;
    }
    .back-link .label {
      text-decoration: underline dotted;
      text-decoration-color: rgba(255, 246, 237, 0.5);
      text-underline-offset: 3px;
    }
    h1 {
      font-size: 20px;
      font-weight: 400;
      color: #FFF6ED;
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
      overflow: hidden;
    }
    .artwork:hover {
      opacity: 0.8;
    }
    .artwork img {
      height: 60px;
      width: 100%;
      display: block;
      object-fit: cover;
      opacity: 0;
      transition: opacity 0.3s ease-in;
    }
    .artwork img.loaded {
      opacity: 1;
    }
    .row-filler img {
      width: 100%;
      height: 60px;
      object-fit: cover;
      object-position: left;
    }

    /* Lightbox */
    .lightbox {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: #000;
      z-index: 1000;
      flex-direction: column;
      cursor: pointer;
    }
    .lightbox.active {
      display: flex;
    }
    .lightbox-image-container {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
    }
    .lightbox img {
      max-width: 95%;
      max-height: 100%;
      object-fit: contain;
    }
    .lightbox-bar {
      height: 40px;
      background: #000;
      color: #FFF6ED;
      display: flex;
      justify-content: center;
      align-items: center;
      font-size: 13px;
    }
    .lightbox-close {
      position: absolute;
      top: 12px;
      right: 12px;
      color: #FFF6ED;
      font-size: 20px;
      cursor: pointer;
      opacity: 0.7;
      transition: opacity 0.2s;
      line-height: 1;
    }
    .lightbox-close:hover {
      opacity: 1;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <a href="./index.html" class="back-link"><span class="chevron">‹</span><span class="label">Back to artists</span></a>
      <h1>${artist.name}</h1>
    </div>
    <div class="gallery">
      ${sortedArtworks.map(artwork => {
    const escapedTitle = artwork.title.replace(/[''\']/g, "\\'");
    // Calculate width based on aspect ratio (height is fixed at 60px)
    const [width, height] = (artwork.dimensions || '100x100').split('x').map(Number);
    const aspectRatio = width / height;
    const calculatedWidth = Math.round(60 * aspectRatio);
    const bgColor = getRandomArtistColor();
    return `<div class="artwork" style="width:${calculatedWidth}px;background:${bgColor}" onclick="openLightbox('${getS3Url(artwork.path)}', '${escapedTitle}', '${artwork.year}', '${artwork.dimensions}')"><img src="${getS3Url(artwork.miniPath || artwork.thumbnailPath || artwork.path)}" alt="${artwork.title.replace(/"/g, '&quot;')}" loading="lazy" onload="this.classList.add('loaded')"></div>`;
  }).join('')}
    </div>
  </div>

  <div class="lightbox" id="lightbox" onclick="closeLightbox()">
    <span class="lightbox-close">&times;</span>
    <div class="lightbox-bar"></div>
    <div class="lightbox-image-container">
      <img id="lightbox-img" src="" alt="">
    </div>
    <div class="lightbox-bar">
      <span id="lightbox-caption"></span>
    </div>
  </div>

  <script>
    function openLightbox(src, title, year, dimensions) {
      const lightbox = document.getElementById('lightbox');
      const img = document.getElementById('lightbox-img');
      const captionEl = document.getElementById('lightbox-caption');

      img.src = src;
      captionEl.textContent = title + ', ' + year;
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

    // Fill row gaps with cropped images from next row
    function fillRowGaps() {
      const gallery = document.querySelector('.gallery');
      if (!gallery) return;

      // Remove existing fillers
      gallery.querySelectorAll('.row-filler').forEach(el => el.remove());

      const artworks = Array.from(gallery.querySelectorAll('.artwork:not(.row-filler)'));
      if (artworks.length === 0) return;

      const galleryWidth = gallery.offsetWidth;
      let currentRowStart = 0;
      let currentRowTop = artworks[0].offsetTop;

      for (let i = 1; i <= artworks.length; i++) {
        const isLastItem = i === artworks.length;
        const item = isLastItem ? null : artworks[i];
        const itemTop = isLastItem ? -1 : item.offsetTop;

        // Detect row change
        if (itemTop !== currentRowTop || isLastItem) {
          // Calculate gap at end of current row
          const lastInRow = artworks[i - 1];
          const rowEndX = lastInRow.offsetLeft + lastInRow.offsetWidth;
          const gap = galleryWidth - rowEndX;

          // If there's a gap and there's a next row, fill it
          if (gap > 0 && !isLastItem) {
            const nextRowFirstItem = artworks[i];
            const nextImg = nextRowFirstItem.querySelector('img');

            if (nextImg) {
              // Create filler element
              const filler = document.createElement('div');
              filler.className = 'artwork row-filler';
              filler.style.width = gap + 'px';
              filler.style.overflow = 'hidden';

              // Copy background color from next item
              filler.style.background = nextRowFirstItem.style.background;

              // Copy onclick from next item
              const onclickAttr = nextRowFirstItem.getAttribute('onclick');
              if (onclickAttr) {
                filler.setAttribute('onclick', onclickAttr);
              }

              // Create image clone
              const imgClone = document.createElement('img');
              imgClone.src = nextImg.src;
              imgClone.alt = nextImg.alt;
              imgClone.loading = 'lazy';
              imgClone.onload = function() { this.classList.add('loaded'); };

              filler.appendChild(imgClone);

              // Insert after last item in row
              lastInRow.after(filler);
            }
          }

          currentRowStart = i;
          currentRowTop = itemTop;
        }
      }
    }

    // Run on load and resize
    window.addEventListener('load', fillRowGaps);
    window.addEventListener('resize', debounce(fillRowGaps, 100));

    function debounce(func, wait) {
      let timeout;
      return function() {
        clearTimeout(timeout);
        timeout = setTimeout(func, wait);
      };
    }
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
  const artists = data.artists
    .filter(a => a.artworks.length > 0)
    .sort((a, b) => {
      const indexA = ARTIST_ORDER.indexOf(a.id);
      const indexB = ARTIST_ORDER.indexOf(b.id);
      // Artists not in ARTIST_ORDER go to the end
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });

  console.log(`Found ${artists.length} artists with artworks`);

  // Create quilts directory if it doesn't exist
  const quiltsDir = path.join(OUTPUT_DIR, 'quilts');
  if (!fs.existsSync(quiltsDir)) {
    fs.mkdirSync(quiltsDir, { recursive: true });
  }

  // Generate main index page
  const indexHtml = generateIndexPage(artists);
  const indexPath = path.join(quiltsDir, 'index.html');
  fs.writeFileSync(indexPath, indexHtml);
  console.log(`Generated: quilts/index.html`);

  // Generate individual artist pages
  for (const artist of artists) {
    const artistHtml = generateArtistPage(artist);
    const artistPath = path.join(quiltsDir, `${artist.id}.html`);
    fs.writeFileSync(artistPath, artistHtml);
    console.log(`Generated: ./${artist.id}.html (${artist.artworks.length} artworks)`);
  }

  console.log('\nDone! Open quilts/index.html to view the gallery.');
}

main();
