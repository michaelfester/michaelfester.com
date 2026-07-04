require('dotenv').config();
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const sizeOf = require('image-size');
const sharp = require('sharp');

// Configuration
const ARTISTS = [
  { id: 'claude-monet', name: 'Claude Monet', wikidataId: 'Q296' },
  { id: 'paul-cezanne', name: 'Paul Cézanne', wikidataId: 'Q35548' },
  { id: 'henri-matisse', name: 'Henri Matisse', wikidataId: 'Q5589' },
  { id: 'pablo-picasso', name: 'Pablo Picasso', wikidataId: 'Q5593' },
  { id: 'georgia-o-keeffe', name: "Georgia O'Keeffe", wikidataId: 'Q46408' },
  { id: 'egon-schiele', name: 'Egon Schiele', wikidataId: 'Q153739' },
  { id: 'lucian-freud', name: 'Lucian Freud', wikidataId: 'Q154594' },
  { id: 'francis-bacon', name: 'Francis Bacon', wikidataId: 'Q154340' },
  { id: 'rembrandt', name: 'Rembrandt', wikidataId: 'Q5598' },
  { id: 'raphael', name: 'Raphael', wikidataId: 'Q5597' },
];

const S3_BUCKET = 'artworks-all';
const S3_REGION = 'us-east-2';
const S3_PREFIX = 'quilts'; // Base folder in S3
const WIKIDATA_SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

function normalizeArtistQuery(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function printUsage() {
  console.log('Usage: bun start [artist-id]');
  console.log('');
  console.log('Examples:');
  console.log('  bun start');
  console.log('  bun start raphael');
  console.log('');
  console.log('Available artists:');
  for (const artist of ARTISTS) {
    console.log(`  ${artist.id} (${artist.name})`);
  }
}

function getSelectedArtists(args) {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const artistQueries = args.filter(arg => !arg.startsWith('-'));
  if (artistQueries.length === 0 || artistQueries.includes('all')) {
    return ARTISTS;
  }

  const selectedArtists = [];
  const unknownArtists = [];

  for (const query of artistQueries) {
    const normalizedQuery = normalizeArtistQuery(query);
    const artist = ARTISTS.find(a =>
      a.id === normalizedQuery || normalizeArtistQuery(a.name) === normalizedQuery
    );

    if (artist) {
      selectedArtists.push(artist);
    } else {
      unknownArtists.push(query);
    }
  }

  if (unknownArtists.length > 0) {
    console.error(`Unknown artist: ${unknownArtists.join(', ')}`);
    console.error('');
    printUsage();
    process.exit(1);
  }

  return selectedArtists.filter((artist, index, arr) =>
    arr.findIndex(a => a.id === artist.id) === index
  );
}

// Initialize S3 client
const s3Client = new S3Client({
  region: S3_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Helper to download image
async function downloadImage(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer': 'https://www.wikiart.org/',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

// Upload to S3
async function uploadToS3(buffer, key, contentType = 'image/jpeg') {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    // Uncomment the line below if your bucket has ACLs enabled:
    // ACL: 'public-read',
  });

  await s3Client.send(command);
  console.log(`  Uploaded to S3: ${key}`);
}

// Decode HTML entities in a string
function decodeHtmlEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/'/g, "'")  // curly apostrophe to straight
    .replace(/'/g, "'")  // another curly apostrophe
    .replace(/"/g, '"')  // curly quotes
    .replace(/"/g, '"');
}

// Normalize title for comparison (handles encoding differences)
function normalizeTitle(title) {
  return decodeHtmlEntities(title)
    .replace(/['\']/g, "'")  // normalize all apostrophe types
    .trim();
}

function normalizeTitleForMatch(title) {
  return normalizeTitle(title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[`'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getTitleMatchKeys(title) {
  const normalized = normalizeTitleForMatch(title);
  const withoutParentheticals = normalizeTitleForMatch(String(title || '').replace(/\([^)]*\)/g, ' '));
  return Array.from(new Set([normalized, withoutParentheticals].filter(Boolean)));
}

function getYearFromDate(dateValue) {
  if (!dateValue) return null;
  const match = String(dateValue).match(/[+-]?(\d{4})/);
  return match ? match[1] : null;
}

function formatQuantity(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2)));
}

function formatUnit(unit) {
  const normalizedUnit = String(unit || '').toLowerCase();
  if (normalizedUnit === 'centimetre' || normalizedUnit === 'centimeter') return 'cm';
  if (normalizedUnit === 'millimetre' || normalizedUnit === 'millimeter') return 'mm';
  if (normalizedUnit === 'metre' || normalizedUnit === 'meter') return 'm';
  if (normalizedUnit === 'inch') return 'in';
  return unit || '';
}

function formatPhysicalSize(metadata) {
  const height = formatQuantity(metadata.height);
  const width = formatQuantity(metadata.width);
  const heightUnit = formatUnit(metadata.heightUnit || metadata.widthUnit);
  const widthUnit = formatUnit(metadata.widthUnit || metadata.heightUnit);

  if (height && width) {
    const unit = heightUnit === widthUnit ? heightUnit : '';
    return `${height} x ${width}${unit ? ` ${unit}` : ''}`;
  }

  if (height) return `${height}${heightUnit ? ` ${heightUnit}` : ''} high`;
  if (width) return `${width}${widthUnit ? ` ${widthUnit}` : ''} wide`;
  return null;
}

function getBindingValue(binding, key) {
  return binding[key]?.value || null;
}

function buildWikidataQuery(wikidataId) {
  return `
SELECT ?work ?workLabel (SAMPLE(?title) AS ?titleText) (SAMPLE(?inception) AS ?inceptionDate)
       (GROUP_CONCAT(DISTINCT ?materialLabel; separator="; ") AS ?mediums)
       (SAMPLE(?heightAmount) AS ?height) (SAMPLE(?heightUnitLabel) AS ?heightUnit)
       (SAMPLE(?widthAmount) AS ?width) (SAMPLE(?widthUnitLabel) AS ?widthUnit)
WHERE {
  ?work wdt:P170 wd:${wikidataId}.
  OPTIONAL { ?work wdt:P1476 ?title. }
  OPTIONAL { ?work wdt:P571 ?inception. }
  OPTIONAL { ?work wdt:P186 ?material. }
  OPTIONAL {
    ?work p:P2048 ?heightStatement.
    ?heightStatement ps:P2048 ?heightAmount.
    OPTIONAL { ?heightStatement psv:P2048/wikibase:quantityUnit ?heightUnit. }
  }
  OPTIONAL {
    ?work p:P2049 ?widthStatement.
    ?widthStatement ps:P2049 ?widthAmount.
    OPTIONAL { ?widthStatement psv:P2049/wikibase:quantityUnit ?widthUnit. }
  }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en".
    ?work rdfs:label ?workLabel.
    ?material rdfs:label ?materialLabel.
    ?heightUnit rdfs:label ?heightUnitLabel.
    ?widthUnit rdfs:label ?widthUnitLabel.
  }
}
GROUP BY ?work ?workLabel
LIMIT 5000`;
}

async function fetchWikidataMetadata(artist) {
  if (!artist.wikidataId) return [];

  const params = new URLSearchParams({
    query: buildWikidataQuery(artist.wikidataId),
    format: 'json',
  });

  const response = await fetch(`${WIKIDATA_SPARQL_ENDPOINT}?${params}`, {
    headers: {
      Accept: 'application/sparql-results+json',
      'User-Agent': 'michaelfester.com quilt scraper metadata enrichment',
    },
  });

  if (!response.ok) {
    throw new Error(`Wikidata metadata fetch failed: ${response.status}`);
  }

  const data = await response.json();
  return (data.results?.bindings || []).map(binding => {
    const title = getBindingValue(binding, 'titleText') || getBindingValue(binding, 'workLabel');
    const mediums = (getBindingValue(binding, 'mediums') || '')
      .split(';')
      .map(value => value.trim())
      .filter(Boolean);
    const metadata = {
      title,
      year: getYearFromDate(getBindingValue(binding, 'inceptionDate')),
      mediums,
      height: getBindingValue(binding, 'height'),
      heightUnit: getBindingValue(binding, 'heightUnit'),
      width: getBindingValue(binding, 'width'),
      widthUnit: getBindingValue(binding, 'widthUnit'),
      wikidataUrl: getBindingValue(binding, 'work'),
      wikidataId: (getBindingValue(binding, 'work') || '').split('/').pop() || null,
    };
    metadata.physicalSize = formatPhysicalSize(metadata);
    return metadata;
  }).filter(metadata => metadata.title);
}

function indexMetadataByTitle(metadataItems) {
  const index = new Map();

  for (const metadata of metadataItems) {
    for (const key of getTitleMatchKeys(metadata.title)) {
      const existing = index.get(key) || [];
      existing.push(metadata);
      index.set(key, existing);
    }
  }

  return index;
}

function findMetadataMatch(artwork, metadataByTitle) {
  const candidates = getTitleMatchKeys(artwork.title)
    .flatMap(key => metadataByTitle.get(key) || []);

  if (candidates.length === 0) return null;

  const artworkYear = artwork.year && artwork.year !== 'Unknown' ? String(artwork.year) : null;
  if (artworkYear) {
    const sameYear = candidates.find(metadata => metadata.year === artworkYear);
    if (sameYear) return sameYear;
  }

  return candidates[0];
}

async function enrichArtworksWithWikidata(artist, artworks) {
  if (!artist.wikidataId || artworks.length === 0) return artworks;

  try {
    console.log(`\nFetching Wikidata metadata for ${artist.name} (${artist.wikidataId})...`);
    const metadataItems = await fetchWikidataMetadata(artist);
    const metadataByTitle = indexMetadataByTitle(metadataItems);
    let matched = 0;
    let enriched = 0;

    const updatedArtworks = artworks.map(artwork => {
      const metadata = findMetadataMatch(artwork, metadataByTitle);
      if (!metadata) return artwork;

      matched += 1;
      const nextArtwork = { ...artwork };

      if (metadata.mediums.length > 0) {
        nextArtwork.mediums = metadata.mediums;
      }

      if (metadata.physicalSize) {
        nextArtwork.physicalSize = metadata.physicalSize;
        nextArtwork.physicalDimensions = {
          height: formatQuantity(metadata.height),
          heightUnit: formatUnit(metadata.heightUnit),
          width: formatQuantity(metadata.width),
          widthUnit: formatUnit(metadata.widthUnit),
        };
      }

      if (metadata.wikidataId) {
        nextArtwork.wikidataId = metadata.wikidataId;
        nextArtwork.wikidataUrl = metadata.wikidataUrl;
      }

      if (nextArtwork.mediums || nextArtwork.physicalSize) {
        enriched += 1;
      }

      return nextArtwork;
    });

    console.log(`Wikidata metadata matched ${matched}/${artworks.length} artworks; enriched ${enriched} with medium and/or size`);
    return updatedArtworks;
  } catch (error) {
    console.error(`Wikidata metadata error for ${artist.name}: ${error.message}`);
    return artworks;
  }
}

// Parse the text-list page to get all artwork links and years
function parseTextList(html) {
  const artworks = [];

  // Match pattern: <a href="/en/artist/artwork-slug">Title</a><span>, Year</span>
  // or variations with different year formats
  const linkRegex = /<a\s+href="(\/en\/[^"]+\/([^"]+))"[^>]*>([^<]+)<\/a>(?:<span>[,\s]*(\d{4}(?:\s*-\s*\d{4})?|[^<]*)<\/span>)?/gi;

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const [, fullPath, slug, title, yearSpan] = match;

    // Skip non-artwork links (like artist pages, all-works pages, etc.)
    if (fullPath.includes('/all-works') || fullPath.includes('/mode/') || !slug || slug === '') {
      continue;
    }

    // Extract year from the span (might be "1872" or "1872-1873" or empty)
    let year = 'Unknown';
    if (yearSpan) {
      const yearMatch = yearSpan.match(/\d{4}/);
      if (yearMatch) {
        year = yearMatch[0];
      }
    }

    artworks.push({
      path: fullPath,
      slug: slug,
      title: normalizeTitle(title),
      year: year,
    });
  }

  // Remove duplicates based on slug
  const unique = artworks.filter((a, i, arr) => arr.findIndex(x => x.slug === a.slug) === i);

  return unique;
}

// Extract image URL from individual artwork page
function extractImageUrl(html, artistId, slug) {
  // Try multiple patterns to find the image URL

  // Pattern 1: og:image meta tag
  const ogMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
  if (ogMatch) {
    return ogMatch[1];
  }

  // Pattern 2: Look for image URL in embedded JSON data
  const jsonImageMatch = html.match(/"image"\s*:\s*"(https:\/\/uploads\d*\.wikiart\.org\/[^"]+)"/);
  if (jsonImageMatch) {
    return jsonImageMatch[1];
  }

  // Pattern 3: Look for og:image with different attribute order
  const ogMatch2 = html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
  if (ogMatch2) {
    return ogMatch2[1];
  }

  // Pattern 4: Look for itemprop="image"
  const itemPropMatch = html.match(/itemprop="image"[^>]*content="([^"]+)"/i);
  if (itemPropMatch) {
    return itemPropMatch[1];
  }

  // Pattern 5: Look for any wikiart image URL in the page
  const anyImageMatch = html.match(/(https:\/\/uploads\d*\.wikiart\.org\/images\/[^"'\s]+\.(?:jpg|png))/i);
  if (anyImageMatch) {
    return anyImageMatch[1];
  }

  return null;
}

// Fetch artwork page and extract image URL
async function getArtworkImageUrl(artworkPath, artistId, slug) {
  const url = `https://www.wikiart.org${artworkPath}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const imageUrl = extractImageUrl(html, artistId, slug);

    if (imageUrl) {
      // Remove any size modifiers like !Large.jpg, !PinterestSmall.jpg, etc.
      // The URL might be: image.jpg!PinterestSmall.jpg -> we want: image.jpg
      let cleanUrl = imageUrl.split('!')[0];
      // Ensure it has an extension
      if (!cleanUrl.match(/\.(jpg|png)$/i)) {
        cleanUrl += '.jpg';
      }
      return cleanUrl;
    }

    return null;
  } catch (error) {
    console.error(`  Error fetching artwork page: ${error.message}`);
    return null;
  }
}

// Try to construct image URL from pattern and verify it exists
async function tryConstructedImageUrl(artistId, slug) {
  // WikiArt uses multiple upload servers (uploads1-uploads8)
  const servers = ['uploads', 'uploads0', 'uploads1', 'uploads2', 'uploads3', 'uploads4', 'uploads5', 'uploads6', 'uploads7', 'uploads8'];

  for (const server of servers) {
    const url = `https://${server}.wikiart.org/images/${artistId}/${slug}.jpg`;

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      if (response.ok) {
        return url;
      }
    } catch (error) {
      // Continue to next server
    }
  }

  return null;
}

// Fetch all artworks for an artist from the text-list page
async function fetchAllArtworks(artistId) {
  console.log(`Fetching artwork list for ${artistId}...`);

  const url = `https://www.wikiart.org/en/${artistId}/all-works/text-list`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch text-list: ${response.status}`);
  }

  const html = await response.text();
  const artworks = parseTextList(html);

  console.log(`Found ${artworks.length} artworks in text-list`);
  return artworks;
}

// Process a single artwork - returns artwork data or null on failure
async function processArtwork(artwork, artistId, existingArtwork = null) {
  try {
    // Check what we need to download
    const needsOriginal = !existingArtwork;
    const needsThumbnail = !existingArtwork?.thumbnailPath;

    // If we have everything, skip
    if (!needsOriginal && !needsThumbnail) {
      return existingArtwork;
    }

    // First, try to get image URL from the artwork page
    let imageUrl = await getArtworkImageUrl(artwork.path, artistId, artwork.slug);

    // If that fails, try constructed URL
    if (!imageUrl) {
      imageUrl = await tryConstructedImageUrl(artistId, artwork.slug);
    }

    if (!imageUrl) {
      console.log(`  [${artwork.title}] Skipping: Could not find image URL`);
      return existingArtwork;
    }

    let result = existingArtwork ? { ...existingArtwork } : null;

    // Download and upload original if needed
    if (needsOriginal) {
      const imageBuffer = await downloadImage(imageUrl);

      // Get dimensions from the downloaded image
      let dimensions;
      try {
        dimensions = sizeOf(imageBuffer);
      } catch (e) {
        console.log(`  [${artwork.title}] Skipping: Could not determine dimensions`);
        return existingArtwork;
      }

      const dimensionStr = `${dimensions.width}x${dimensions.height}`;
      const filename = `${artwork.year} - ${dimensionStr} - ${artwork.title}.jpg`;
      const s3Key = `${S3_PREFIX}/${artistId}/${filename}`;

      await uploadToS3(imageBuffer, s3Key);

      result = {
        year: artwork.year,
        dimensions: dimensionStr,
        title: artwork.title,
        path: s3Key,
      };

      console.log(`  [${artwork.title}] Original done - ${dimensionStr}`);
    }

    // Download and upload thumbnail if needed
    if (needsThumbnail && result) {
      try {
        // Thumbnail URL is original URL + !PinterestSmall.jpg
        const thumbnailUrl = imageUrl + '!PinterestSmall.jpg';
        const thumbnailBuffer = await downloadImage(thumbnailUrl);

        // Use same filename but in thumbnails subfolder
        const filename = `${result.year} - ${result.dimensions} - ${result.title}.jpg`;
        const thumbnailKey = `${S3_PREFIX}/${artistId}/thumbnails/${filename}`;

        await uploadToS3(thumbnailBuffer, thumbnailKey);
        result.thumbnailPath = thumbnailKey;
        console.log(`  [${artwork.title}] Thumbnail done`);

        // Also generate mini thumbnail (40px height, webp)
        try {
          const miniBuffer = await sharp(thumbnailBuffer)
            .resize({ height: 40 })
            .webp({ quality: 80 })
            .toBuffer();

          const baseFilename = `${result.year} - ${result.dimensions} - ${result.title}`;
          const miniKey = `${S3_PREFIX}/${artistId}/thumbnails/mini/${baseFilename}.webp`;
          await uploadToS3(miniBuffer, miniKey, 'image/webp');
          result.miniPath = miniKey;
          console.log(`  [${artwork.title}] Mini done`);
        } catch (miniError) {
          console.error(`  [${artwork.title}] Mini error: ${miniError.message}`);
        }
      } catch (thumbError) {
        console.error(`  [${artwork.title}] Thumbnail error: ${thumbError.message}`);
        // Continue without thumbnail - original is still valid
      }
    }

    return result;

  } catch (error) {
    console.error(`  [${artwork.title}] Error: ${error.message}`);
    return existingArtwork;
  }
}

// Process a single artist
async function processArtist(artist, existingArtworks = [], onProgress = null) {
  console.log(`\nProcessing artist: ${artist.name} (${artist.id})`);

  // Create a map of existing artworks by normalized title for quick lookup
  const existingByTitle = new Map(existingArtworks.map(a => [normalizeTitle(a.title), a]));

  const BATCH_SIZE = 50;

  try {
    // Fetch all artwork links from text-list
    const artworkList = await fetchAllArtworks(artist.id);

    // Determine what needs processing (new artworks or missing thumbnails)
    const toProcess = artworkList.filter(a => {
      const existing = existingByTitle.get(normalizeTitle(a.title));
      // Process if: no existing record, OR existing but missing thumbnail
      return !existing || !existing.thumbnailPath;
    });

    // Find artworks that have thumbnails but need mini
    const needsMiniOnly = Array.from(existingByTitle.values()).filter(a => a.thumbnailPath && !a.miniPath);

    const fullyComplete = artworkList.length - toProcess.length;
    console.log(`${toProcess.length} new artworks to process, ${needsMiniOnly.length} need mini thumbnails (${fullyComplete} with thumbnails)`);

    // Process in batches
    for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
      const batch = toProcess.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(toProcess.length / BATCH_SIZE);

      console.log(`\nBatch ${batchNum}/${totalBatches} (artworks ${i + 1}-${Math.min(i + BATCH_SIZE, toProcess.length)})`);

      // Process batch concurrently, passing existing artwork data if available
      const results = await Promise.all(
        batch.map(artwork => {
          const existing = existingByTitle.get(normalizeTitle(artwork.title));
          return processArtwork(artwork, artist.id, existing);
        })
      );

      // Update the map with results
      for (const result of results) {
        if (result) {
          existingByTitle.set(normalizeTitle(result.title), result);
        }
      }

      // Save progress after each batch
      if (onProgress) {
        onProgress({ id: artist.id, name: artist.name, artworks: Array.from(existingByTitle.values()) });
      }

      // Small delay between batches
      if (i + BATCH_SIZE < toProcess.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Process mini thumbnails for existing artworks (from S3)
    if (needsMiniOnly.length > 0) {
      console.log(`\nGenerating ${needsMiniOnly.length} mini thumbnails from S3...`);

      for (let i = 0; i < needsMiniOnly.length; i += BATCH_SIZE) {
        const batch = needsMiniOnly.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(needsMiniOnly.length / BATCH_SIZE);

        console.log(`\nMini batch ${batchNum}/${totalBatches} (${i + 1}-${Math.min(i + BATCH_SIZE, needsMiniOnly.length)})`);

        await Promise.all(batch.map(async (artwork) => {
          try {
            // Download thumbnail from S3
            const s3ThumbnailUrl = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${encodeURI(artwork.thumbnailPath)}`;
            const thumbnailBuffer = await downloadImage(s3ThumbnailUrl);

            // Resize to 40px height and convert to webp
            const miniBuffer = await sharp(thumbnailBuffer)
              .resize({ height: 40 })
              .webp({ quality: 80 })
              .toBuffer();

            // Store in thumbnails/mini subfolder with .webp extension
            const baseFilename = `${artwork.year} - ${artwork.dimensions} - ${artwork.title}`;
            const miniKey = `${S3_PREFIX}/${artist.id}/thumbnails/mini/${baseFilename}.webp`;
            await uploadToS3(miniBuffer, miniKey, 'image/webp');
            artwork.miniPath = miniKey;
            console.log(`  [${artwork.title}] Mini done`);
          } catch (miniError) {
            console.error(`  [${artwork.title}] Mini error: ${miniError.message}`);
          }
        }));

        // Save progress after each batch
        if (onProgress) {
          onProgress({ id: artist.id, name: artist.name, artworks: Array.from(existingByTitle.values()) });
        }
      }
    }

  } catch (error) {
    console.error(`Error processing artist ${artist.name}: ${error.message}`);
  }

  const enrichedArtworks = await enrichArtworksWithWikidata(artist, Array.from(existingByTitle.values()));

  return {
    id: artist.id,
    name: artist.name,
    artworks: enrichedArtworks,
  };
}

// Main function
async function main() {
  console.log('WikiArt Scraper - Starting...\n');
  const selectedArtists = getSelectedArtists(process.argv.slice(2));

  if (selectedArtists.length !== ARTISTS.length) {
    console.log(`Selected artists: ${selectedArtists.map(a => a.name).join(', ')}\n`);
  }

  // Validate environment variables
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('Error: Missing required environment variables.');
    console.error('Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in your .env file');
    process.exit(1);
  }

  const outputPath = path.join(__dirname, 'artists.json');

  // Load existing data if available
  let existingData = { artists: [] };
  if (fs.existsSync(outputPath)) {
    try {
      existingData = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      console.log(`Loaded existing data with ${existingData.artists.length} artists`);
    } catch (e) {
      console.log('Could not load existing data, starting fresh');
    }
  }

  const results = [...existingData.artists];

  // Helper to save progress
  const saveProgress = () => {
    const output = { artists: results };
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  };

  for (const artist of selectedArtists) {
    // Find existing artworks for this artist
    const existingArtist = existingData.artists.find(a => a.id === artist.id);
    const existingArtworks = existingArtist ? existingArtist.artworks : [];

    if (existingArtworks.length > 0) {
      console.log(`Found ${existingArtworks.length} existing artworks for ${artist.name}`);
    }

    // Process artist with progress callback that saves after each artwork
    const artistData = await processArtist(artist, existingArtworks, (updatedArtist) => {
      // Update results with current progress
      const idx = results.findIndex(a => a.id === updatedArtist.id);
      if (idx >= 0) {
        results[idx] = updatedArtist;
      } else {
        results.push(updatedArtist);
      }
      saveProgress();
    });

    // Ensure final state is saved
    const idx = results.findIndex(a => a.id === artistData.id);
    if (idx >= 0) {
      results[idx] = artistData;
    } else {
      results.push(artistData);
    }
    saveProgress();
    console.log(`\nSaved progress to ${outputPath}`);
  }

  console.log('\n=== Scraping Complete ===');
  console.log(`Scraped ${selectedArtists.length} artists`);
  console.log(`artists.json contains ${results.length} artists`);

  let totalArtworks = 0;
  results.forEach(artist => {
    console.log(`  ${artist.name}: ${artist.artworks.length} artworks`);
    totalArtworks += artist.artworks.length;
  });
  console.log(`Total artworks: ${totalArtworks}`);
}

// Run the script
main().catch(console.error);
