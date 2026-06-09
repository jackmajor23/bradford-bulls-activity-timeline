# Bradford Bulls Timeline - Supabase Cloud Sync

## 🚀 Quick Setup

This timeline uses Supabase for secure cloud sync. No backend server required!

### Quick Start (3 minutes):

1. **Configure Supabase:**
   - Copy `config.example.js` to `config.js`
   - The example already has your project credentials pre-filled
   - `config.js` is gitignored for security

2. **Open `index.html` in your browser**

3. **Cloud sync is automatically enabled**
   - Your data will sync to Supabase automatically
   - Real-time sync across all devices

---

## 📁 What You Need

**Essential Files:**
- `index.html` - Your timeline (everything is self-contained)
- `config.js` - Supabase credentials (create from config.example.js)

**Configuration Files:**
- `config.example.js` - Template for your credentials
- `.env.example` - Environment variable template (for build tools)

---

## 🔐 Security

✅ **Credentials are gitignored** - `config.js` and `.env` are in `.gitignore`
✅ **No backend server** - Uses Supabase directly from the browser
✅ **Row Level Security** - Database has RLS policies enabled
✅ **Anon key only** - Uses publishable anon key (not service role key)
✅ **Offline support** - Local storage fallback when offline

---

## 📝 Configuration

**In `config.js` (create from `config.example.js`):**
```javascript
const SUPABASE_CONFIG = {
  URL: 'https://iqenyprolzxzwnbubuar.supabase.co',
  ANON_KEY: 'sb_publishable_s7P_E83Hu701PzDJoBE8aw_lDr5ruqS'
};
```

**For production builds with Vite/other bundlers:**
- Copy `.env.example` to `.env`
- Add your credentials as environment variables
- Use the commented code in `config.example.js`

---

## 🎯 Features

- ✅ Cross-device sync via Supabase
- ✅ Real-time sync using PostgreSQL subscriptions
- ✅ Structured database (fixtures, activities, milestones, notes)
- ✅ Offline support with local storage
- ✅ Team collaboration with shared Supabase project
- ✅ No server setup required

---

## 🛠️ Database Schema

The app uses these Supabase tables:

- **fixtures** - Match fixtures (opponent, venue, date)
- **activities** - Activities linked to fixtures or standalone
- **milestones** - Key milestones with color coding
- **notes** - General notes on dates

All tables have:
- UUID primary keys
- Timestamp tracking (created_at, updated_at)
- Row Level Security enabled

---

## 🔧 Troubleshooting

**Cloud sync not working:**
- Check browser console for errors
- Verify `config.js` exists and has correct credentials
- Ensure Supabase project is active

**Data not syncing across devices:**
- Check both devices have the same Supabase credentials
- Verify real-time subscriptions are active in browser console
- Check Supabase dashboard for connection logs