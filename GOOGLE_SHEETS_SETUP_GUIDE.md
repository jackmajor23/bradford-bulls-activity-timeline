# Google Sheets Cloud Sync Setup Guide

## ⚠️ Important Security Notice

**For maximum security, we recommend using the Backend Proxy approach.**

Your timeline now supports two integration approaches:

### Recommended: Backend Proxy (Secure) 🔒
- **Use for**: Production, public hosting, team collaboration
- **Security**: API credentials completely hidden from frontend
- **Setup Guide**: See `BACKEND_PROXY_SETUP.md`
- **Complexity**: Requires running a Node.js server
- **Benefits**: Enterprise-grade security, no API keys exposed

### Alternative: Direct API (Simpler) ⚠️
- **Use for**: Personal use, local development, testing
- **Security**: API keys stored in HTML file (visible)
- **Setup Guide**: Follow the steps below
- **Complexity**: Simpler setup, no server required
- **Limitations**: Not recommended for public production

**💡 Recommendation**: Start with the Backend Proxy approach if you need to share your timeline with others or host it publicly. Use Direct API only for personal local use.

This guide will help you configure the Bradford Bulls Timeline to use Google Sheets as a backend for cloud storage, enabling cross-device sync and sharing with permissions.

## Overview

The timeline now supports multiple storage modes:
- **Local Storage**: Data stored in browser localStorage (default, works offline)
- **Cloud Sync (Backend Proxy)**: Data stored in Google Sheets via secure backend proxy (recommended)
- **Cloud Sync (Direct API)**: Data stored in Google Sheets via direct API calls (simpler, less secure)

## Quick Setup Decision

**Choose your approach:**

| Your Use Case | Recommended Approach | Setup Guide |
|---------------|---------------------|-------------|
| Personal/local use | Direct API (Simpler) | Continue with this guide |
| Team collaboration | Backend Proxy (Secure) | See `BACKEND_PROXY_SETUP.md` |
| Public hosting | Backend Proxy (Secure) | See `BACKEND_PROXY_SETUP.md` |
| Maximum security required | Backend Proxy (Secure) | See `BACKEND_PROXY_SETUP.md` |

**🔧 This guide continues with the Direct API approach for simpler setup. For the secure Backend Proxy approach, please refer to `BACKEND_PROXY_SETUP.md`.**

---

## Direct API Setup Guide (Simpler, Less Secure)

The following steps describe the Direct API approach where API keys are stored in the HTML file. This is simpler to set up but less secure than the Backend Proxy approach.

1. A Google account
2. Basic understanding of Google Cloud Console
3. Your HTML file (bradford-bulls-timeline.html)

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Name it something like "Bradford Bulls Timeline" and click "Create"

## Step 2: Enable Google Sheets API

1. In your new project, go to "APIs & Services" → "Library"
2. Search for "Google Sheets API"
3. Click on it and press "Enable"

## Step 3: Configure OAuth Consent Screen

1. Go to "APIs & Services" → "OAuth consent screen"
2. Choose "External" and click "Create"
3. Fill in the required fields:
   - **App name**: Bradford Bulls Timeline
   - **User support email**: Your email
   - **Developer contact email**: Your email
4. Click "Save and Continue" through all sections (you can skip optional fields)
5. Final step: Click "Back to Dashboard"

## Step 4: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "+ Create Credentials" → "OAuth client ID"
3. Choose "Web application"
4. Configure the following:
   - **Name**: Bradford Bulls Timeline
   - **Authorized JavaScript origins**: 
     - Add your local development server (e.g., `http://localhost:3000` or `http://127.0.0.1:5500`)
     - If hosting, add your production URL (e.g., `https://your-site.com`)
   - **Authorized redirect URIs**: Same as JavaScript origins
5. Click "Create"
6. **Copy the Client ID** - you'll need this for your HTML file

## Step 5: Create API Key

1. On the Credentials page, click "+ Create Credentials" → "API Key"
2. **Copy the API Key** - you'll need this for your HTML file

## Step 6: Add Security Restrictions (IMPORTANT!)

**⚠️ SECURITY WARNING**: API keys stored in HTML files are visible to anyone who can access the file. You MUST add security restrictions to protect your account and quota.

### Restrict API Key

1. On the Credentials page, click on your API key
2. **Application Restrictions** (choose one based on your use case):
   
   **For Local Development:**
   - Select "IP addresses"
   - Add: `127.0.0.1` and `::1` (localhost)
   
   **For Domain Hosting:**
   - Select "HTTP referrers"
   - Add your domain: `https://your-site.com/*`
   - Add localhost for testing: `http://localhost:*`
   
   **For File:// Protocol (opening HTML directly):**
   - This is less secure - consider using a local server
   - Can use IP restrictions with your local IP

3. **API Restrictions**:
   - Select "Restrict key"
   - Only check "Google Sheets API"
   - This prevents the key from being used for other Google services

### Restrict OAuth Client ID

1. Go to your OAuth client ID credentials
2. Click "Edit"
3. Under "Authorized JavaScript origins":
   - Add only the domains where you'll host the app
   - For local: `http://localhost:3000` or `http://127.0.0.1:5500`
   - For production: `https://your-site.com`
4. Under "Authorized redirect URIs":
   - Add the same URLs as JavaScript origins
5. Click "Save"

## Step 7: Update Your HTML File

1. On the Credentials page, click "+ Create Credentials" → "API Key"
2. **Copy the API Key** - you'll need this for your HTML file

## Step 6: Update Your HTML File

1. Open `bradford-bulls-timeline.html` in a text editor
2. Find the Google Sheets configuration section (around line 2086-2089):
   ```javascript
   const GCP_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID_HERE'; // Replace with your Google Client ID
   const GCP_API_KEY = 'YOUR_GOOGLE_API_KEY_HERE'; // Replace with your Google API Key
   ```
3. Replace the placeholder values:
   - Replace `YOUR_GOOGLE_CLIENT_ID_HERE` with your Client ID from Step 4
   - Replace `YOUR_GOOGLE_API_KEY_HERE` with your API Key from Step 5

## Step 7: Set Up Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new sheet
2. Name it something like "Bradford Bulls Timeline Data"
3. Copy the Sheet ID from the URL:
   - URL format: `https://docs.google.com/spreadsheets/d/SHEET_ID/edit`
   - Copy the part between `/d/` and `/edit`

## Step 8: Configure Cloud Sync in the Timeline

1. Open your timeline HTML file in a browser
2. Click the "Settings" button (or access settings)
3. In the Cloud Sync section:
   - Check "Enable cloud sync"
   - Paste your Sheet ID in the "Google Sheet ID" field
   - Click "🔐 Authenticate"
   - Sign in with your Google account
   - Click "📊 Setup Sheet" to create the data structure
   - Click "💾 Save Configuration"

## Step 9: Share the Sheet (Optional)

1. In your Google Sheet, click "Share"
2. Add email addresses of people you want to share with
3. Choose permission level:
   - **Editor**: Can make changes to the timeline
   - **Viewer**: Can only view the timeline (read-only)
4. Click "Send"

## Data Structure

The setup process will create two worksheets in your Google Sheet:

### TimelineItems Worksheet
Contains all timeline data (activities, fixtures, milestones, notes)
- Columns: id, type, title, date, fixtureId, assignees, data

### Assignees Worksheet  
Contains saved assignee names
- Columns: name

## Permission Handling

- **View Permissions**: Controlled by Google Sheets sharing (Viewers = read-only)
- **Edit Permissions**: Controlled by Google Sheets sharing (Editors = full access)
- **No Auth Required for Viewers**: Anyone with the sheet link can view if shared appropriately

## Troubleshooting

### "Authentication failed" error
- Check that your Client ID and API Key are correct
- Verify your OAuth consent screen is published
- Ensure your domain is in the authorized JavaScript origins

### "Permission denied" error
- Check that you have authenticated with the correct Google account
- Verify the sheet is shared with your account
- Check Google Sheets API is enabled in your project

### "Sheet not found" error
- Verify the Sheet ID is correct
- Check that the sheet exists and you have access
- Ensure the sheet URL format is correct

### Data not syncing
- Check that cloud sync is enabled in settings
- Verify you're authenticated
- Check browser console for errors
- Ensure Google API quota limits haven't been exceeded

## Security Notes

### API Key Security
- **API Keys**: These are visible in the HTML file source. Anyone with access to the file can see them.
- **Protection**: Add application and API restrictions in Google Cloud Console (see Step 6)
- **Monitoring**: Check your Google Cloud Console usage regularly for unusual activity
- **Quota**: Free tier has limits (~10,000 requests/day). Abuse could exhaust your quota.

### OAuth Client Security
- **Client IDs**: Designed to be public but should be restricted to authorized domains
- **Domain Restrictions**: Only add domains you control to prevent misuse
- **Token Security**: OAuth tokens are stored in browser and not shared

### Google Sheet Security
- **Sheet Access**: Anyone with the sheet ID can potentially access data if they guess it
- **Sharing**: Use Google Sheets sharing to control who can view/edit
- **Recommendations**: 
  - Keep the sheet private initially
  - Share only with specific email addresses
  - Use "Editor" for collaborators who need full access
  - Use "Viewer" for read-only access
  - Avoid sharing via "Anyone with the link" unless necessary

### Data Privacy
- **Storage**: Timeline data is stored in Google Sheets
- **Privacy**: Subject to Google's privacy policies and terms of service
- **Control**: You own your Google Sheet and can delete it anytime
- **Backup**: Google Sheets has built-in versioning and backup

### Alternative Security Approaches

**For Maximum Security (Recommended for Public Use):**

1. **Backend Proxy Server:**
   - Create a simple backend (Node.js, Python, etc.)
   - Store API keys in server environment variables
   - Browser calls your backend → Backend calls Google API
   - Never expose API keys to frontend
   - Pros: Maximum security, full control
   - Cons: Requires backend server

2. **Firebase Alternative:**
   - Use Firebase instead of Google Sheets
   - Built-in authentication and security rules
   - No API keys in frontend code
   - Real-time sync capabilities
   - Pros: Better security model, real-time features
   - Cons: Different setup process, learning curve

3. **Self-Hosted Database:**
   - Use a private database with backend API
   - Complete control over security
   - Pros: Maximum control, self-hosted
   - Cons: Requires DevOps, maintenance

## Limitations

- Google API has usage limits (free tier: ~10,000 requests/day)
- Changes sync only when save() is called (automatic on edits)
- No real-time collaboration (changes appear on next page load or manual refresh)
- Requires internet connection for cloud sync to work

## Cost

- **Google Sheets API**: Free tier is sufficient for personal use
- **Google Cloud**: Free tier covers most use cases
- **Additional costs**: Only if you exceed free tier limits (unlikely for personal use)

## Support

For issues with:
- **Google Cloud Setup**: Visit [Google Cloud Console Help](https://cloud.google.com/docs)
- **Google Sheets API**: Visit [Google Sheets API Documentation](https://developers.google.com/sheets/api)
- **Timeline App**: Check the console (F12) for error messages

---

**Note**: The timeline will continue to work with local storage even if cloud sync is not configured. Cloud sync is completely optional.