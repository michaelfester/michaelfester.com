# WikiArt Scraper

Scrapes artwork from WikiArt.org and uploads images to Amazon S3 with structured metadata.

## Prerequisites

- Node.js 18+ installed
- An AWS account
- AWS CLI (optional, for verification)

## AWS S3 Setup Guide

### Step 1: Create an S3 Bucket

1. Go to the [AWS Console](https://console.aws.amazon.com/)
2. Search for "S3" in the search bar and click on S3
3. Click **Create bucket**
4. Configure your bucket:
   - **Bucket name**: Choose a unique name (e.g., `my-art-collection-2024`)
   - **AWS Region**: Select a region close to you (e.g., `us-east-1`)
   - **Object Ownership**: Keep "ACLs disabled" (recommended)
   - **Block Public Access**: Uncheck "Block all public access" (required for public gallery)
   - Acknowledge the warning about public access
   - Leave other settings as default
5. Click **Create bucket**

### Step 2: Add a Bucket Policy for Public Access

1. Click on your newly created bucket
2. Go to the **Permissions** tab
3. Scroll to **Bucket policy** and click **Edit**
4. Paste the following policy (replace `your-bucket-name` with your actual bucket name):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "PublicReadGetObject",
         "Effect": "Allow",
         "Principal": "*",
         "Action": "s3:GetObject",
         "Resource": "arn:aws:s3:::your-bucket-name/*"
       }
     ]
   }
   ```
5. Click **Save changes**

This allows anyone to view the images (required for the gallery to work).

### Step 3: Create an IAM User with S3 Access

1. Go to [IAM Console](https://console.aws.amazon.com/iam/)
2. Click **Users** in the left sidebar
3. Click **Create user**
4. Enter a username (e.g., `wikiart-scraper`) and click **Next**
5. Select **Attach policies directly**
6. Search for `AmazonS3FullAccess` and check the box (or create a more restrictive policy below)
7. Click **Next**, then **Create user**

### Step 4: Create Access Keys

1. Click on the user you just created
2. Go to the **Security credentials** tab
3. Scroll down to **Access keys** and click **Create access key**
4. Select **Command Line Interface (CLI)** as the use case
5. Check the confirmation box and click **Next**
6. (Optional) Add a description tag
7. Click **Create access key**
8. **IMPORTANT**: Copy both the **Access key ID** and **Secret access key**
   - This is the only time you'll see the secret key!
   - Store them securely

### Step 5: Configure Environment Variables

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your credentials:
   ```
   AWS_ACCESS_KEY_ID=AKIA...your_access_key
   AWS_SECRET_ACCESS_KEY=your_secret_key
   AWS_REGION=us-east-1
   S3_BUCKET=your-bucket-name
   ```

**Security Note**: Never commit your `.env` file to version control. The `.gitignore` should exclude it.

### (Optional) Create a Restricted IAM Policy

For better security, create a custom policy that only allows access to your specific bucket:

1. Go to IAM > Policies > Create policy
2. Select JSON and paste:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:PutObject",
           "s3:GetObject",
           "s3:ListBucket"
         ],
         "Resource": [
           "arn:aws:s3:::your-bucket-name",
           "arn:aws:s3:::your-bucket-name/*"
         ]
       }
     ]
   }
   ```
3. Replace `your-bucket-name` with your actual bucket name
4. Name the policy and create it
5. Attach this policy to your IAM user instead of `AmazonS3FullAccess`

## Installation

```bash
cd scraper
bun install
```

## Configuration

### Adding Artists

Edit `scrape-art.js` and add artists to the `ARTISTS` array:

```javascript
const ARTISTS = [
  { id: 'claude-monet', name: 'Claude Monet' },
  { id: 'vincent-van-gogh', name: 'Vincent van Gogh' },
  { id: 'pablo-picasso', name: 'Pablo Picasso' },
  { id: 'rembrandt', name: 'Rembrandt' },
  // Add more artists here
];
```

The `id` is the URL slug used on WikiArt (the part after `/en/` in the URL).

## Usage

### Scrape Artworks

```bash
bun start
```

The script will:
1. Iterate through each artist
2. Fetch all paintings from their WikiArt page
3. Download each painting in original resolution + thumbnail
4. Upload to S3 with the naming format: `{Year} - {Width}x{Height} - {Title}.jpg`
5. Save metadata to `artists.json`

The script is resumable - if interrupted, re-run it and it will skip already-downloaded artworks.

### Generate Gallery Pages

```bash
bun run generate
```

This generates static HTML gallery pages:
- `quilts.html` - Index page listing all artists
- `quilts/{artist-id}.html` - Individual artist pages with thumbnail grids and lightbox

## Output

### S3 Structure

```
quilts/
  claude-monet/
    1858 - 1280x797 - View At Rouelles Le Havre.jpg
    1861 - 881x1273 - A Corner of the Studio.jpg
    ...
    thumbnails/
      1858 - 1280x797 - View At Rouelles Le Havre.jpg
      1861 - 881x1273 - A Corner of the Studio.jpg
      ...
  vincent-van-gogh/
    1885 - 1280x1024 - The Potato Eaters.jpg
    ...
    thumbnails/
      1885 - 1280x1024 - The Potato Eaters.jpg
      ...
```

### artists.json

```json
{
  "artists": [
    {
      "id": "claude-monet",
      "name": "Claude Monet",
      "artworks": [
        {
          "year": "1858",
          "dimensions": "1280x797",
          "title": "View At Rouelles Le Havre",
          "path": "quilts/claude-monet/1858 - 1280x797 - View At Rouelles Le Havre.jpg",
          "thumbnailPath": "quilts/claude-monet/thumbnails/1858 - 1280x797 - View At Rouelles Le Havre.jpg"
        }
      ]
    }
  ]
}
```

## Notes

- Downloads both original images and thumbnails
- Processes artworks in batches of 50 for faster downloads
- Progress is saved after each batch, so you can resume if interrupted
- On re-run, only downloads missing artworks or thumbnails
- Some paintings may be skipped if the image cannot be downloaded

## Troubleshooting

### "Access Denied" when viewing images
- Ensure you've added the bucket policy (Step 2)
- Ensure "Block all public access" is unchecked in bucket permissions
- The bucket policy must use your actual bucket name

### "Access Denied" when uploading
- Verify your IAM user has the correct S3 permissions
- Check that the bucket name in `.env` matches your actual bucket

### Rate limiting
If WikiArt blocks requests, reduce the `BATCH_SIZE` in `scrape-art.js` or increase the delay between batches.
