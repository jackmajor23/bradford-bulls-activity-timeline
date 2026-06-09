# Simple Setup Guide - Supabase Cloud Sync

This is the simplified approach with Supabase. No server required - everything runs in the browser!

## 🚀 Quick Setup (2 minutes)

### Step 1: Create Config File

Copy the example config file:
```bash
cp config.example.js config.js
```

The example already has your Supabase credentials pre-filled:
```javascript
const SUPABASE_CONFIG = {
  URL: 'https://iqenyprolzxzwnbubuar.supabase.co',
  ANON_KEY: 'sb_publishable_s7P_E83Hu701PzDJoBE8aw_lDr5ruqS'
};
```

### Step 2: Open in Browser

Simply open `index.html` in your browser.

### Step 3: Start Using

Cloud sync is automatically enabled! Your data will:
- ✅ Sync to Supabase automatically
- ✅ Update in real-time across devices
- ✅ Work offline with local storage fallback

## ✅ That's It!

Your timeline now has secure cloud sync with:
- ✅ No server required (browser-only)
- ✅ Credentials in gitignored config file
- ✅ Real-time PostgreSQL subscriptions
- ✅ Cross-device sync
- ✅ Team collaboration
- ✅ Offline support

## 📁 Files You Need

- `index.html` - Your timeline (no changes needed)
- `config.js` - Supabase credentials (create from config.example.js)
- `config.example.js` - Template with your credentials pre-filled

## 🔐 Security

- `config.js` is in `.gitignore` - your credentials won't be committed
- Uses Supabase anon key (safe for browser use)
- Row Level Security enabled on database
- No service role keys exposed

## 🛠️ Common Issues

**"Supabase not initialized"**
- Make sure `config.js` exists in the project root
- Check that the credentials match your Supabase project
- Verify the file is named exactly `config.js` (not `config.example.js`)

**"Cloud sync not working"**
- Check browser console for errors (F12)
- Verify your Supabase project is active
- Ensure you have internet connection

**"Data not syncing across devices"**
- Both devices must use the same Supabase credentials
- Check real-time subscriptions are active in console
- Verify Supabase project allows connections

## 📝 Configuration Checklist

- [ ] Copy `config.example.js` to `config.js`
- [ ] Verify credentials in `config.js` are correct
- [ ] Open `index.html` in browser
- [ ] Check browser console for "✓ Supabase initialized"
- [ ] Start adding items - they'll sync automatically!

## 🚀 Next Steps

- **For development**: Just open `index.html` in browser
- **For deployment**: Upload to any static hosting (GitHub Pages, Netlify, etc.)
- **For team sharing**: Share the Supabase project with team members

## 🔧 Advanced: Using Environment Variables

If you're using a build tool like Vite:

1. Copy `.env.example` to `.env`
2. Add your credentials:
```
VITE_SUPABASE_URL=https://iqenyprolzxzwnbubuar.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_s7P_E83Hu701PzDJoBE8aw_lDr5ruqS
```
3. Uncomment the environment variable code in `config.example.js`

---

**That's the entire setup! Just copy the config file and you're ready to go.**