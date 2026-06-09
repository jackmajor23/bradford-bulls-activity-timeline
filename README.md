# Bradford Bulls Timeline - Secure Google Sheets Integration

## 🚀 Simple Setup (Recommended)

**Use this approach for easy setup with one configuration file.**

### Quick Start (5 minutes):

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure the simple server:**
   - Open `simple-server.js`
   - Paste your Google Service Account JSON key where indicated
   - Change the secret key to something random

3. **Update your HTML file:**
   - Open `index.html`
   - Update the `PROXY_API_KEY` to match your secret key

4. **Start the server:**
   ```bash
   node simple-server.js
   ```

5. **Setup Google Sheet:**
   - Create a Google Sheet
   - Share it with your service account email
   - Test connection in timeline Settings

**📖 Detailed Instructions:** See `SIMPLE_SETUP_GUIDE.md`

---

## 📁 What You Need

**Essential Files:**
- `simple-server.js` - All-in-one server (configure this)
- `index.html` - Your timeline (configure this)
- `package.json` - Dependencies
- `SIMPLE_SETUP_GUIDE.md` - Simple setup instructions

**Optional Files (for reference):**
- `GOOGLE_SHEETS_SETUP_GUIDE.md` - Original detailed guide
- Other files can be ignored for simple setup

---

## 🔐 Why This Approach?

✅ **One file to configure** - simple-server.js has everything
✅ **Secure** - API credentials hidden on server
✅ **Simple** - No complex environment files
✅ **Fast setup** - Get running in 5 minutes
✅ **Secure sharing** - Team collaboration with permissions

---

## 🛠️ Quick Commands

```bash
# Install dependencies
npm install

# Start the simple server
node simple-server.js

# Test server is running
curl http://localhost:3000/api/health
```

---

## 📝 Configuration Summary

**In simple-server.js:**
1. Paste your Google Service Account JSON key
2. Change the PROXY_SECRET_KEY to something random

**In index.html:**
1. Update PROXY_API_KEY to match your secret key

**In Google Cloud Console:**
1. Create service account
2. Download JSON key
3. Share Google Sheet with service account email

---

## 🎯 Ready to Go?

Follow the **SIMPLE_SETUP_GUIDE.md** for step-by-step instructions.

Your timeline will have secure cloud sync, cross-device access, and team collaboration with minimal setup complexity!