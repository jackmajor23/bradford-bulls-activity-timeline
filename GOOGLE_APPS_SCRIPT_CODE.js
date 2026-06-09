// Google Apps Script for Bradford Bulls Activity Timeline
// Add this code to your Google Sheets extension (Extensions > Apps Script)

// Expected token - change this to your secure token
const VALID_TOKEN = 'gnjvsuhg48gh8rwn';

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  // Enable CORS
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    const params = e.parameter;
    const action = params.action;
    const token = params.token;

    // Validate token
    if (token !== VALID_TOKEN) {
      output.setContent(JSON.stringify({ success: false, error: 'Invalid token' }));
      return output;
    }

    if (action === 'read') {
      const data = readSheet();
      output.setContent(JSON.stringify({ success: true, rows: data }));
    } else if (action === 'write') {
      const formData = params;
      const result = writeSheet(formData);
      output.setContent(JSON.stringify(result));
    } else {
      output.setContent(JSON.stringify({ success: false, error: 'Invalid action' }));
    }

  } catch (error) {
    output.setContent(JSON.stringify({ success: false, error: error.toString() }));
  }

  return output;
}

function readSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();
  
  // Get headers from first row
  const headers = data[0];
  const rows = [];
  
  // Convert remaining rows to objects
  for (let i = 1; i < data.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    rows.push(row);
  }
  
  return rows;
}

function writeSheet(formData) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  // Check if sheet has headers, if not add them
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.appendRow(['timestamp', 'identifier', 'data']);
  }
  
  // Append new row
  sheet.appendRow([
    new Date(),
    formData.identifier || 'unknown',
    formData.data || ''
  ]);
  
  return { success: true };
}

// Optional: Setup function to initialize the sheet structure
function setupSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.clear();
  sheet.appendRow(['timestamp', 'identifier', 'data']);
  return { success: true, message: 'Sheet structure created' };
}
