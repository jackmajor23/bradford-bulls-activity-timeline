# Simple Setup Guide - All-in-One Server

This is the simplified approach with everything in one file. No complex configuration needed!

## 🚀 Quick Setup (5 minutes)

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Get Your Google Service Account Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or use existing one
3. Enable Google Sheets API
4. Create Service Account:
   - Go to Credentials → Create Credentials → Service Account
   - Name it: Bradford Bulls Timeline Service
5. Create and Download Key:
   - Click on the service account → Keys tab → Add Key → Create new key
   - Select JSON and download the file
6. Open the downloaded JSON file and copy the contents

### Step 3: Add Your Credentials to simple-server.js

Open `simple-server.js` and paste your Google service account JSON key where it says:

```javascript
const GOOGLE_SERVICE_ACCOUNT_KEY = `PASTE_YOUR_JSON_HERE`;
```

Replace everything between the backticks with your actual JSON key content.

### Step 4: Change the Security Key

In `simple-server.js`, change this line to something random:

```javascript
const PROXY_SECRET_KEY = "bradford-bulls-secure-proxy-key-change-this";
```

Generate a random key:
```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### Step 5: Update Your HTML File

In `index.html`, update this line to match your secret key:

```javascript
const PROXY_API_KEY = 'your-secret-key-here';
```

### Step 6: Share Your Google Sheet

1. Create a Google Sheet at sheets.google.com
2. Click "Share" and add your service account email (find it in your JSON key under `client_email`)
3. Give it "Editor" permissions

### Step 7: Start the Server

```bash
node simple-server.js
```

You should see:
```
=================================
BRADFORD BULLS TIMELINE SERVER
=================================
✅ Server running on port 3000
🔧 Proxy URL: http://localhost:3000/api
🔐 Secret Key: your-secret-key
=================================
```

### Step 8: Test and Use

1. Open `index.html` in your browser
2. Click Settings → Enable Cloud Sync
3. Enter your Google Sheet ID
4. Click "🔗 Test Connection"
5. Click "📊 Setup Sheet" 
6. Click "💾 Save Configuration"

## ✅ That's It!

Your timeline now has secure cloud sync with:
- ✅ API credentials hidden in server (not in HTML)
- ✅ Simple one-file configuration
- ✅ Secure proxy authentication
- ✅ Cross-device sync
- ✅ Team collaboration

## 📁 Files You Need

- `simple-server.js` - All-in-one server (edit this file)
- `index.html` - Your timeline (edit this file)
- `package.json` - Dependencies (already exists)

## 🛠️ Common Issues

**"Google Sheets authentication not configured"**
- Make sure you pasted the JSON key correctly in simple-server.js
- Check that the JSON is valid (no extra commas, proper formatting)

**"Permission denied"**
- Make sure you shared the Google Sheet with the service account email
- The service account email is in your JSON key under `client_email`

**"Unauthorized" error**
- Make sure the PROXY_SECRET_KEY matches between simple-server.js and HTML file
- Check that the header is being sent correctly

**Server won't start**
- Make sure you ran `npm install` first
- Check that port 3000 is not already in use

## 🔧 Quick Reference

**Server commands:**
```bash
# Install dependencies
npm install

# Start server
node simple-server.js

# Test server is running
curl http://localhost:3000/api/health
```

**Google Sheet ID:**
From URL: `https://docs.google.com/spreadsheets/d/SHEET_ID/edit`
Copy the part between `/d/` and `/edit`

**Service Account Email:**
Found in your JSON key under `client_email` field

## 📝 Configuration Checklist

- [ ] Install dependencies: `npm install`
- [ ] Get Google Service Account key from Google Cloud Console
- [ ] Paste JSON key into `simple-server.js`
- [ ] Change `PROXY_SECRET_KEY` in both files
- [ ] Share Google Sheet with service account email
- [ ] Start server: `node simple-server.js`
- [ ] Test connection in timeline Settings
- [ ] Setup Google Sheet structure
- [ ] Save configuration and start using!

## 🚀 Next Steps

- **For development**: Keep running `node simple-server.js`
- **For deployment**: Upload `simple-server.js` to a hosting service like Render or Railway
- **For team sharing**: Share your Google Sheet with team members

---

**That's the entire setup! Just one file to configure and you're ready to go.**