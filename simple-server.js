// ============================================
// BRADFORD BULLS TIMELINE - SECURE BACKEND SERVER
// All-in-one server configuration
// ============================================

// Load environment variables from .env file
require('dotenv').config();

// ============================================
// STEP 1: ADD YOUR CREDENTIALS HERE
// ============================================

// Your Google Service Account JSON key
// Set as environment variable: GOOGLE_SERVICE_ACCOUNT_KEY
// Or paste the JSON content between the backticks below (NOT RECOMMENDED for production)
const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || `{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "your-private-key-id",
  "private_key": "-----BEGIN PRIVATE KEY-----\\nYOUR_PRIVATE_KEY_HERE\\n-----END PRIVATE KEY-----\\n",
  "client_email": "your-service-account@your-project.iam.gserviceaccount.com",
  "client_id": "your-client-id",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/your-service-account%40your-project.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
}`;

// Secret key for securing the proxy
// Set as environment variable: PROXY_SECRET_KEY
// Or change the value below (NOT RECOMMENDED for production)
// Generate a random key with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const PROXY_SECRET_KEY = process.env.PROXY_SECRET_KEY || "YOUR_SECRET_KEY_HERE"; // Replace with a random secure key

// Server port
const PORT = 3000;

// Allowed origins (which domains can access this proxy)
const ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000", "file://", "https://jackmajor23.github.io"];

// ============================================
// STEP 2: INSTALL DEPENDENCIES (run once)
// Run: npm install express cors googleapis
// ============================================

// ============================================
// STEP 3: START THE SERVER
// Run: node simple-server.js
// ============================================

// ============================================
// SERVER CODE - NO NEED TO EDIT BELOW HERE
// ============================================

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();

// CORS configuration
app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true
}));
app.use(express.json());

// Security: Simple API key authentication
function authenticateProxy(req, res, next) {
  const clientKey = req.headers['x-proxy-secret-key'];
  if (clientKey !== PROXY_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Google Sheets Authentication
let sheets;
try {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheets = google.sheets({ version: 'v4', auth });
  console.log('✅ Google Sheets authentication configured successfully');
} catch (error) {
  console.error('❌ Error configuring Google Sheets authentication:');
  console.error('   Make sure you pasted your service account JSON key correctly above');
  console.error('   Error:', error.message);
}

// Error handler
function handleGoogleError(error, res) {
  console.error('Google API Error:', error);

  if (error.code === 403) {
    return res.status(403).json({ error: 'Permission denied. Make sure your service account email has Editor access to the Google Sheet.' });
  } else if (error.code === 404) {
    return res.status(404).json({ error: 'Sheet not found. Check the Sheet ID.' });
  } else if (error.code === 401) {
    return res.status(401).json({ error: 'Authentication failed. Check your service account key.' });
  }

  return res.status(500).json({ error: 'Failed to connect to Google Sheets API' });
}

// API Endpoints

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Backend proxy is running',
    googleAuth: sheets ? 'configured' : 'not configured'
  });
});

// Save timeline data to Google Sheets
app.post('/api/sheets/save', authenticateProxy, async (req, res) => {
  try {
    const { sheetId, items, savedAssignees } = req.body;

    if (!sheetId) {
      return res.status(400).json({ error: 'Sheet ID is required' });
    }

    if (!sheets) {
      return res.status(500).json({ error: 'Google Sheets authentication not configured' });
    }

    // Save timeline items to 'TimelineItems' sheet
    const itemsData = [['id', 'type', 'title', 'date', 'fixtureId', 'assignees', 'data']];
    items.forEach(item => {
      itemsData.push([
        item.id,
        item.type,
        item.title,
        item.date,
        item.fixtureId || '',
        JSON.stringify(item.assignees || []),
        JSON.stringify(item)
      ]);
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'TimelineItems!A1',
      valueInputOption: 'RAW',
      resource: { values: itemsData }
    });

    // Save assignees to 'Assignees' sheet
    const assigneeData = [['name']];
    (savedAssignees || []).forEach(assignee => {
      assigneeData.push([assignee]);
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Assignees!A1',
      valueInputOption: 'RAW',
      resource: { values: assigneeData }
    });

    res.json({ success: true, message: 'Data saved to Google Sheets' });
  } catch (error) {
    handleGoogleError(error, res);
  }
});

// Load timeline data from Google Sheets
app.get('/api/sheets/load', authenticateProxy, async (req, res) => {
  try {
    const { sheetId } = req.query;

    if (!sheetId) {
      return res.status(400).json({ error: 'Sheet ID is required' });
    }

    if (!sheets) {
      return res.status(500).json({ error: 'Google Sheets authentication not configured' });
    }

    // Load timeline items from 'TimelineItems' sheet
    const itemsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'TimelineItems!A2:G'
    });

    const rows = itemsResponse.result.values || [];
    const loadedItems = [];

    rows.forEach(row => {
      try {
        const data = JSON.parse(row[6] || '{}');
        data.assignees = JSON.parse(row[5] || '[]');
        loadedItems.push(data);
      } catch (e) {
        console.error('Error parsing item:', e);
      }
    });

    // Load assignees from 'Assignees' sheet
    const assigneesResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Assignees!A2:A'
    });

    const assigneeRows = assigneesResponse.result.values || [];
    const loadedAssignees = assigneeRows.map(row => row[0]).filter(name => name);

    res.json({
      success: true,
      data: {
        items: loadedItems,
        savedAssignees: loadedAssignees
      }
    });
  } catch (error) {
    handleGoogleError(error, res);
  }
});

// Setup Google Sheets structure
app.post('/api/sheets/setup', authenticateProxy, async (req, res) => {
  try {
    const { sheetId } = req.body;

    if (!sheetId) {
      return res.status(400).json({ error: 'Sheet ID is required' });
    }

    if (!sheets) {
      return res.status(500).json({ error: 'Google Sheets authentication not configured' });
    }

    // Create worksheets if they don't exist
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: sheetId
    });

    const sheetTitles = spreadsheet.data.sheets.map(s => s.properties.title);

    // Create TimelineItems sheet if needed
    if (!sheetTitles.includes('TimelineItems')) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        resource: {
          requests: [{
            addSheet: { properties: { title: 'TimelineItems' } }
          }]
        }
      });
    }

    // Create Assignees sheet if needed
    if (!sheetTitles.includes('Assignees')) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        resource: {
          requests: [{
            addSheet: { properties: { title: 'Assignees' } }
          }]
        }
      });
    }

    res.json({ success: true, message: 'Google Sheets structure created' });
  } catch (error) {
    handleGoogleError(error, res);
  }
});

// Start server
app.listen(PORT, () => {
  console.log('=================================');
  console.log('BRADFORD BULLS TIMELINE SERVER');
  console.log('=================================');
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔧 Proxy URL: http://localhost:${PORT}/api`);
  console.log(`🔐 Secret Key: ${PROXY_SECRET_KEY}`);
  console.log(`🌐 Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log('=================================');
  console.log('\n⚠️  SETUP INSTRUCTIONS:');
  console.log('1. Add your Google Service Account JSON key above');
  console.log('2. Change the PROXY_SECRET_KEY to something random');
  console.log('3. Update the PROXY_SECRET_KEY in your HTML file');
  console.log('4. Share your Google Sheet with the service account email');
  console.log('5. Test connection: curl http://localhost:3000/api/health');
  console.log('=================================\n');
});