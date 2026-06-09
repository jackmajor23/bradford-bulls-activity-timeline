# Bradford Bulls Timeline - Google Sheets Cloud Sync

## 🚀 Quick Setup

This timeline uses Google Apps Script for cloud sync. No backend server required!

### Quick Start (2 minutes):

1. **Open `index.html` in your browser**

2. **Enable Cloud Sync:**
   - Click Settings → Enable cloud sync checkbox
   - Your data will sync to Google Sheets automatically

3. **That's it!**

---

## 📁 What You Need

**Essential Files:**
- `index.html` - Your timeline (everything is self-contained)

---

## 🔐 How It Works

✅ **No backend server** - Uses Google Apps Script API directly
✅ **Simple** - Just open the HTML file in a browser
✅ **Secure** - Token-based authentication with Google Apps Script
✅ **Real-time sync** - Polls for updates every 10 seconds
✅ **Offline support** - Local storage fallback when offline

---

## 📝 Configuration

**In index.html:**
- `SHEET_API` - Google Apps Script deployment URL
- `SHEET_TOKEN` - Authentication token for the Apps Script

**Current Configuration:**
- Token: `gnjvsuhg48gh8rwn`
- Cloud sync: Enabled

---

## 🎯 Features

- ✅ Cross-device sync via Google Sheets
- ✅ Team collaboration with shared sheets
- ✅ Offline support with local storage
- ✅ Automatic polling for updates
- ✅ No server setup required

---

## 🛠️ Google Apps Script Setup (Optional)

If you need to deploy your own Google Apps Script:

1. Create a Google Sheet
2. Open Extensions → Apps Script
3. Paste the Apps Script code
4. Deploy as web app
5. Update `SHEET_API` and `SHEET_TOKEN` in index.html