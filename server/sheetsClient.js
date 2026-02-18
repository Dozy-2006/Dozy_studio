const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const creds = require('./credentials.json');

const serviceAccountAuth = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive', // Crucial for 'assign-sheet' permissions
  ],
});

// Your Sheet ID is Correct
const DATABASE_SHEET_ID = '1O-89EpgXUMMmEEye-WQrRz8lmxOT2iOE_YpvypJ-zKQ';

const doc = new GoogleSpreadsheet(DATABASE_SHEET_ID, serviceAccountAuth);

async function loadDB() {
  await doc.loadInfo(); 
}

module.exports = { doc, loadDB, serviceAccountAuth };