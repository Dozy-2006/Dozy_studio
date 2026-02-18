const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { authenticator } = require('otplib');
const { google } = require('googleapis');
const { doc, serviceAccountAuth } = require('./sheetsClient');
const credentials = require('./credentials.json');
const NodeCache = require('node-cache');

// Initialize Google Drive API
const drive = google.drive({ version: 'v3', auth: serviceAccountAuth });

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 5000;

// ====================================================================
// VALIDATION CONFIGURATION
// ====================================================================
const CONFIG_SPREADSHEET_ID = ''; // Master spreadsheet ID

// Worksheet names for each sheet type
const VALIDATION_WORKSHEETS = {
    'New': 'Validation_New',
    'Daily': 'Validation_Daily',
    'Weekly': 'Validation_Weekly',
    'Fortnightly': 'Validation_Fortnightly',
    'Monthly': 'Validation_Monthly'
};

// Schema cache (5-minute TTL)
const schemaCache = new NodeCache({ stdTTL: 300 });

// ==========================================
// 0. HIGH-SPEED MEMORY STORE (RAM)
// ==========================================
let DB = {
    Users: [],
    Stations: [],
    Tasks: [],
    Groups: []
};

// Flags & Queue
let isDbReady = false;
let dbReadyPromise = null;
const WRITE_QUEUE = [];
let isProcessingQueue = false;
let isSyncing = false;

// ==========================================
// 1. SYNC ENGINE (Google -> RAM)
// ==========================================

function arrayToObjects(values, headers) {
    if (!values || values.length < 2) return [];
    const result = [];
    for (let i = 1; i < values.length; i++) {
        const row = values[i];
        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = row[index] || '';
        });
        result.push(obj);
    }
    return result;
}

// Helper: Extract Sheet ID from Google Sheets URL
function extractSheetId(url) {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

// Helper: Remove user permissions from Google Sheet
async function removeSheetPermissions(sheetUrl, userEmails) {
    try {
        const sheetId = extractSheetId(sheetUrl);
        if (!sheetId) {
            console.log('⚠️ Could not extract sheet ID from URL:', sheetUrl);
            return { success: false, error: 'Invalid sheet URL' };
        }

        // Get all permissions for the sheet
        const permissionsResponse = await drive.permissions.list({
            fileId: sheetId,
            fields: 'permissions(id,emailAddress)'
        });

        const permissions = permissionsResponse.data.permissions || [];
        let removedCount = 0;

        // Remove permissions for each user email
        for (const email of userEmails) {
            const permission = permissions.find(p => p.emailAddress === email);
            if (permission) {
                await drive.permissions.delete({
                    fileId: sheetId,
                    permissionId: permission.id
                });
                console.log(`✅ Removed permission for: ${email}`);
                removedCount++;
            }
        }

        return { success: true, removedCount };
    } catch (error) {
        console.error('❌ Error removing permissions:', error.message);
        return { success: false, error: error.message };
    }
}

// Helper: Grant user permissions to Google Sheet
async function grantSheetPermissions(sheetUrl, userEmails) {
    try {
        const sheetId = extractSheetId(sheetUrl);
        if (!sheetId) {
            console.log('⚠️ Could not extract sheet ID from URL:', sheetUrl);
            return { success: false, error: 'Invalid sheet URL' };
        }

        let grantedCount = 0;

        // Grant writer permissions for each user email
        for (const email of userEmails) {
            if (email && email.trim()) {
                try {
                    await drive.permissions.create({
                        fileId: sheetId,
                        requestBody: {
                            role: 'writer',
                            type: 'user',
                            emailAddress: email.trim()
                        }
                    });
                    console.log(`✅ Granted permission to: ${email}`);
                    grantedCount++;
                    await new Promise(r => setTimeout(r, 200)); // Rate limiting
                } catch (e) {
                    console.log(`⚠️ Failed to grant permission to ${email}:`, e.message);
                }
            }
        }

        return { success: true, grantedCount };
    } catch (error) {
        console.error('❌ Error granting permissions:', error.message);
        return { success: false, error: error.message };
    }
}

async function syncDatabase() {
    if (isSyncing || isProcessingQueue) {
        console.log("⚠️ Skipping Sync: Server is writing data.");
        return;
    }

    isSyncing = true;

    try {
        const sheets = google.sheets({ version: 'v4', auth: serviceAccountAuth });
        if (!doc.spreadsheetId) await doc.loadInfo();

        // Fetch from all sheets including 8 task sheets
        const response = await sheets.spreadsheets.values.batchGet({
            spreadsheetId: doc.spreadsheetId,
            ranges: [
                'Users!A:Z',
                'Stations!A:Z',
                'Groups!A:Z',
                // 8 Task sheets
                'Task_New!A:Z',
                'Task_Daily!A:Z',
                'Task_Weekly!A:Z',
                'Task_Monthly!A:Z',
                'Task_Fortnightly!A:Z',
                'Archived_New!A:Z',
                'Archived_Daily!A:Z',
                'Archived_Weekly!A:Z',
                'Archived_Monthly!A:Z',
                'Archived_Fortnightly!A:Z'
            ],
        });

        const data = response.data.valueRanges;

        // 1. USERS: Added 'TagNumber' before AuthKey. Email now stores comma-separated list.
        DB.Users = arrayToObjects(data[0].values, ['UserID', 'Name', 'Role', 'Subdivision', 'Station', 'Email', 'Phone', 'TagNumber', 'AuthKey']);

        // 2. STATIONS
        DB.Stations = arrayToObjects(data[1].values, ['Subdivision', 'Stations']);

        // 3. GROUPS
        DB.Groups = arrayToObjects(data[2].values, ['GroupID', 'GroupName', 'CreatedBy', 'UserIDs']);

        // 4. TASKS - Merge from all 8 task sheets
        const taskHeaders = ['TaskID', 'SheetLink', 'SheetType', 'AssignedTo', 'Status', 'Date', 'TaskName', 'DueDate', 'AllowNil', 'IsNil', 'GroupName', 'CompletedDate', 'CreatedBy', 'IsArchived', 'CompletedByManager', 'WeeklyDay', 'MonthlyDay'];

        DB.Tasks = [];
        // Indices 3-12 contain the 10 task sheets
        for (let i = 3; i <= 12; i++) {
            if (data[i] && data[i].values) {
                const tasksFromSheet = arrayToObjects(data[i].values, taskHeaders);
                // DEBUG LOG
                console.log(`   📄 Loaded ${tasksFromSheet.length} tasks from index ${i} (Expected range: ${response.data.valueRanges[i].range})`);
                DB.Tasks.push(...tasksFromSheet);
            }
        }
        console.log(`📊 Total Tasks Loaded in RAM: ${DB.Tasks.length}`);

        isDbReady = true;
    } catch (err) {
        console.error("❌ Sync Error:", err.message);
    } finally {
        isSyncing = false;
    }
}

// Initialize all required task sheets on startup
async function initializeTaskSheets() {
    const taskHeaders = ['TaskID', 'SheetLink', 'SheetType', 'AssignedTo', 'Status', 'Date', 'TaskName', 'DueDate', 'AllowNil', 'IsNil', 'GroupName', 'CompletedDate', 'CreatedBy', 'IsArchived', 'CompletedByManager', 'WeeklyDay', 'MonthlyDay'];

    const taskSheets = [
        'Task_New', 'Task_Daily', 'Task_Weekly', 'Task_Monthly', 'Task_Fortnightly',
        'Archived_New', 'Archived_Daily', 'Archived_Weekly', 'Archived_Monthly', 'Archived_Fortnightly'
    ];

    console.log('🔧 Initializing task sheets...');

    for (const sheetName of taskSheets) {
        try {
            await getSheet(sheetName, taskHeaders);
            console.log(`✅ Sheet ready: ${sheetName}`);
        } catch (err) {
            console.error(`❌ Failed to initialize ${sheetName}:`, err.message);
        }
    }

    console.log('✨ All task sheets initialized');
}

async function getSheet(title, headers) {
    try {
        await doc.loadInfo();
    } catch (e) {
        console.error("⚠️ Failed to load doc info, retrying...", e.message);
        await new Promise(r => setTimeout(r, 1000));
        await doc.loadInfo();
    }

    let sheet = doc.sheetsByIndex.find(s => s.title.toLowerCase() === title.toLowerCase());

    if (!sheet) {
        // Create new sheet with headers
        sheet = await doc.addSheet({ title: title, headerValues: headers });
        console.log(`📝 Created sheet "${title}" with ${headers.length} column headers`);
    } else {
        // Sheet exists, check if it has headers
        try {
            await sheet.loadHeaderRow();
            if (!sheet.headerValues || sheet.headerValues.length === 0) {
                // No headers, set them
                await sheet.setHeaderRow(headers);
                console.log(`📝 Added headers to existing sheet "${title}"`);
            }
        } catch (err) {
            // Error loading headers (probably empty sheet), set them
            await sheet.setHeaderRow(headers);
            console.log(`📝 Set headers on empty sheet "${title}"`);
        }
    }
    return sheet;
}

// Helper: Get correct task sheet name based on type and archive status
function getTaskSheetName(sheetType, isArchived) {
    const prefix = isArchived ? 'Archived_' : 'Task_';
    return `${prefix}${sheetType}`;
}

const waitForDb = async (req, res, next) => {
    if (isDbReady) return next();
    if (!dbReadyPromise) dbReadyPromise = syncDatabase();
    await dbReadyPromise;
    next();
};

// ==========================================
// 2. BACKGROUND WRITER (RAM -> Google)
// ==========================================
async function processWriteQueue() {
    if (isProcessingQueue || WRITE_QUEUE.length === 0) return;
    isProcessingQueue = true;

    try {
        while (WRITE_QUEUE.length > 0) {
            const job = WRITE_QUEUE.shift();
            try {
                console.log(`☁️ Writing: ${job.type} ${job.sheet}`);
                const sheet = await getSheet(job.sheet, job.headers);

                if (job.type === 'ADD') {
                    await sheet.addRow(job.data);
                }
                else if (job.type === 'UPDATE') {
                    const rows = await sheet.getRows();
                    const row = rows.find(r => r.get(job.keyField) === job.keyValue);
                    if (row) {
                        row.assign(job.data);
                        await row.save();
                    }
                }
                else if (job.type === 'DELETE') {
                    const rows = await sheet.getRows();
                    const row = rows.find(r => {
                        const val = r.get(job.keyField);
                        return val && val === job.keyValue;
                    });
                    if (row) await row.delete();
                }
                await new Promise(r => setTimeout(r, 300));

            } catch (err) {
                console.error(`❌ Write Failed: ${err.message}`);
            }
        }
    } finally {
        isProcessingQueue = false;
    }
}

function queueJob(type, sheet, data, keyField, keyValue) {
    // 1. Update RAM Immediately
    if (type === 'ADD') DB[sheet].push(data);
    else if (type === 'UPDATE') {
        const item = DB[sheet].find(i => i[keyField] === keyValue);
        if (item) Object.assign(item, data);
    }
    else if (type === 'DELETE') {
        DB[sheet] = DB[sheet].filter(i => i[keyField] !== keyValue);
    }

    // 2. Queue Cloud Update
    let headers = [];
    let targetSheet = sheet;

    // USERS Headers: Added 'TagNumber'
    if (sheet === 'Users') headers = ['UserID', 'Name', 'Role', 'Subdivision', 'Station', 'Email', 'Phone', 'TagNumber', 'AuthKey'];

    // TASKS: Route to correct sheet based on type and archive status
    if (sheet === 'Tasks') {
        headers = ['TaskID', 'SheetLink', 'SheetType', 'AssignedTo', 'Status', 'Date', 'TaskName', 'DueDate', 'AllowNil', 'IsNil', 'GroupName', 'CompletedDate', 'CreatedBy', 'IsArchived', 'CompletedByManager', 'WeeklyDay', 'MonthlyDay'];

        // Determine which physical sheet to write to
        if (type === 'ADD' && data.SheetType) {
            targetSheet = getTaskSheetName(data.SheetType, String(data.IsArchived).toUpperCase() === 'TRUE');
        } else if ((type === 'UPDATE' || type === 'DELETE') && keyValue) {
            // Find the task to determine its sheet
            const task = DB.Tasks.find(t => t[keyField] === keyValue);
            if (task) {
                targetSheet = getTaskSheetName(task.SheetType, String(task.IsArchived).toUpperCase() === 'TRUE');
            }
        }
    }

    if (sheet === 'Groups') headers = ['GroupID', 'GroupName', 'CreatedBy', 'UserIDs'];
    if (sheet === 'Stations') headers = ['Subdivision', 'Stations'];

    WRITE_QUEUE.push({ type, sheet: targetSheet, data, keyField, keyValue, headers });
    processWriteQueue();
}

// ==========================================
// 3. API ROUTES
// ==========================================

app.get('/api/system/bot-email', (req, res) => res.json({ email: credentials.client_email }));

// Manual fix endpoint to force-set headers on all task sheets
app.get('/api/system/fix-headers', async (req, res) => {
    try {
        await initializeTaskSheets();
        res.json({ success: true, message: 'Headers have been set on all task sheets' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// VALIDATION ENDPOINTS
// ==========================================

// Helper function to extract spreadsheet ID from URL
function extractSpreadsheetId(linkOrId) {
    if (!linkOrId) return null;
    if (!linkOrId.includes('/')) return linkOrId.trim();

    const patterns = [
        /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
        /id=([a-zA-Z0-9-_]+)/
    ];

    for (const pattern of patterns) {
        const match = linkOrId.match(pattern);
        if (match) return match[1];
    }

    return linkOrId.trim();
}

// List all sheet names (tabs) for a given spreadsheet
app.post('/api/manager/list-sheets', async (req, res) => {
    const { sheet_link } = req.body;
    console.log("received list-sheets request for:", sheet_link);

    if (!sheet_link) return res.status(400).json({ success: false, message: 'Missing sheet_link' });

    try {
        const spreadsheetId = extractSpreadsheetId(sheet_link);
        console.log("Extracted ID:", spreadsheetId);

        if (!spreadsheetId) return res.status(400).json({ success: false, message: 'Invalid spreadsheet link' });

        const sheets = google.sheets({ version: 'v4', auth: serviceAccountAuth });
        const meta = await sheets.spreadsheets.get({ spreadsheetId });

        const tabs = (meta.data.sheets || []).map(s => s.properties.title);
        console.log("Found tabs:", tabs);

        res.json({ success: true, tabs, spreadsheetId });
    } catch (err) {
        console.error("Error listing sheets:", err);
        res.status(500).json({ success: false, message: "Could not list sheets. Check permissions." });
    }
});

// Get validation bot email
app.get('/api/system/bot-email', (req, res) => {
    res.json({ success: true, email: credentials.client_email });
});

// Get sheet schema
app.post('/api/manager/get-sheet-schema', async (req, res) => {
    const { sheet_link, sheet_name, sheet_type } = req.body;

    if (!sheet_link || !sheet_name) {
        return res.status(400).json({
            success: false,
            message: 'Missing sheet_link or sheet_name'
        });
    }

    try {
        const spreadsheetId = extractSpreadsheetId(sheet_link);
        if (!spreadsheetId) {
            return res.status(400).json({
                success: false,
                message: 'Invalid spreadsheet link'
            });
        }

        // UNIQUE ID: ID/Tab/Type
        // If sheet_type is provided, use it. Otherwise fallback to old ID for backward compat (or default 'New')
        const typeSuffix = sheet_type ? `/${sheet_type}` : '';
        const schemaPath = `${spreadsheetId}/${sheet_name}${typeSuffix}`;

        // Check cache first
        const cached = schemaCache.get(schemaPath);
        if (cached) {
            return res.json({
                success: true,
                has_schema: true,
                schema: cached,
                spreadsheet_id: spreadsheetId
            });
        }

        // Search all validation worksheets for the schema
        const sheets = google.sheets({ version: 'v4', auth: serviceAccountAuth });
        let schema = null;
        for (const sheetType in VALIDATION_WORKSHEETS) {
            const worksheet = VALIDATION_WORKSHEETS[sheetType];
            try {
                const schemaSheet = await sheets.spreadsheets.values.get({
                    spreadsheetId: CONFIG_SPREADSHEET_ID,
                    range: `${worksheet}!A:C`,
                });

                const rows = schemaSheet.data.values || [];

                // Find schema by path (column C)
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (row[2] === schemaPath) {
                        const parsed = JSON.parse(row[1]);
                        // Handle potential object wrapper { fields: [...] } or direct array [...]
                        schema = Array.isArray(parsed) ? parsed : (parsed.fields || []);
                        schemaCache.set(schemaPath, schema);
                        break;
                    }
                }

                if (schema) break;
            } catch (err) {
                // Worksheet might not exist yet, continue
            }
        }

        if (schema) {
            return res.json({
                success: true,
                has_schema: true,
                schema: schema,
                spreadsheet_id: spreadsheetId
            });
        }

        // No schema exists, fetch headers from the actual sheet
        try {
            let actualSheetName = sheet_name;
            let sheetData;

            try {
                sheetData = await sheets.spreadsheets.values.get({
                    spreadsheetId: spreadsheetId,
                    range: `${sheet_name}!1:1`,
                });
            } catch (sheetError) {
                console.log(`Sheet "${sheet_name}" not found, trying first tab...`);
                const spreadsheet = await sheets.spreadsheets.get({
                    spreadsheetId: spreadsheetId
                });

                if (spreadsheet.data.sheets && spreadsheet.data.sheets.length > 0) {
                    actualSheetName = spreadsheet.data.sheets[0].properties.title;
                    console.log(`Using first tab: "${actualSheetName}"`);

                    sheetData = await sheets.spreadsheets.values.get({
                        spreadsheetId: spreadsheetId,
                        range: `${actualSheetName}!1:1`,
                    });
                } else {
                    throw new Error('No sheets found');
                }
            }

            const headers = sheetData.data.values ? sheetData.data.values[0] : [];

            return res.json({
                success: true,
                has_schema: false,
                headers: headers,
                spreadsheet_id: spreadsheetId,
                actual_sheet_name: actualSheetName,
                message: headers.length > 0 ? `Found ${headers.length} columns` : 'No headers found'
            });
        } catch (sheetError) {
            return res.status(404).json({
                success: false,
                message: `Could not read sheet: ${sheetError.message}`
            });
        }

    } catch (error) {
        console.error('Error in get-sheet-schema:', error);
        res.status(500).json({
            success: false,
            message: `Error fetching schema: ${error.message}`
        });
    }
});

// Save sheet schema
app.post('/api/manager/save-sheet-schema', async (req, res) => {
    const { sheet_link, sheet_name, schema, sheet_type } = req.body;

    if (!sheet_link || !sheet_name || !schema) {
        return res.status(400).json({
            success: false,
            message: 'Missing required data'
        });
    }

    if (!Array.isArray(schema)) {
        return res.status(400).json({
            success: false,
            message: 'Schema must be an array'
        });
    }

    // Validate schema structure
    for (const field of schema) {
        if (!field.name || !field.type) {
            return res.status(400).json({
                success: false,
                message: 'Each schema field must have name and type'
            });
        }
    }

    try {
        const spreadsheetId = extractSpreadsheetId(sheet_link);
        if (!spreadsheetId) {
            return res.status(400).json({
                success: false,
                message: 'Invalid spreadsheet link'
            });
        }

        // UNIQUE ID: ID/Tab/Type
        const schemaPath = `${spreadsheetId}/${sheet_name}/${sheet_type}`;
        const schemaJson = JSON.stringify(schema);

        // Determine worksheet based on sheet type
        const worksheetName = VALIDATION_WORKSHEETS[sheet_type] || VALIDATION_WORKSHEETS['New'];

        const sheets = google.sheets({ version: 'v4', auth: serviceAccountAuth });

        // Check if schema already exists
        const schemaSheet = await sheets.spreadsheets.values.get({
            spreadsheetId: CONFIG_SPREADSHEET_ID,
            range: `${worksheetName}!A:C`,
        });

        const rows = schemaSheet.data.values || [];
        let existingRow = null;

        for (let i = 1; i < rows.length; i++) {
            if (rows[i][2] === schemaPath) { // Column C is SchemaPath
                existingRow = i + 1;
                break;
            }
        }

        let message;
        if (existingRow) {
            // Update existing schema
            await sheets.spreadsheets.values.update({
                spreadsheetId: CONFIG_SPREADSHEET_ID,
                range: `${worksheetName}!B${existingRow}`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [[schemaJson]]
                }
            });
            message = `Validation schema for '${sheet_name}' updated successfully.`;
        } else {
            // Append new schema (3 columns: CaseType, SchemaJSON, SchemaPath)
            await sheets.spreadsheets.values.append({
                spreadsheetId: CONFIG_SPREADSHEET_ID,
                range: `${worksheetName}!A:C`,
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS',
                requestBody: {
                    values: [[sheet_name, schemaJson, schemaPath]]
                }
            });
            message = `Validation schema for '${sheet_name}' saved successfully.`;
        }

        // Update cache immediately
        schemaCache.set(schemaPath, schema);

        res.json({
            success: true,
            message: message,
            schema_path: schemaPath
        });

    } catch (error) {
        console.error('Error in save-sheet-schema:', error);
        res.status(500).json({
            success: false,
            message: `Error saving schema: ${error.message}`
        });
    }
});

// Validate and format sheet
app.post('/validate-and-format-sheet', async (req, res) => {
    const { spreadsheet_id, tab_name, skip_formatting } = req.body;

    if (!spreadsheet_id || !tab_name) {
        return res.status(400).json({
            success: false,
            message: 'Missing required data.'
        });
    }

    console.log(`🔍 Validate & Format Request:`);
    console.log(`   Spreadsheet ID: ${spreadsheet_id}`);
    console.log(`   Tab Name: "${tab_name}"`);
    console.log(`   Target Range: '${tab_name}'`);

    try {
        const sheets = google.sheets({ version: 'v4', auth: serviceAccountAuth });

        // SMART SHEET DISCOVERY
        // 1. Fetch spreadsheet metadata to verify sheet names
        const spreadsheetMeta = await sheets.spreadsheets.get({
            spreadsheetId: spreadsheet_id
        });

        const availableSheets = spreadsheetMeta.data.sheets.map(s => s.properties.title);
        let targetSheetName = tab_name;

        // 2. Check if requested tab exists
        if (!availableSheets.includes(tab_name)) {
            console.warn(`⚠️ Warning: Tab "${tab_name}" not found in spreadsheet.`);
            console.log(`ℹ️ Available Sheets: ${availableSheets.join(', ')}`);

            // Fallback: Use the first sheet found
            if (availableSheets.length > 0) {
                targetSheetName = availableSheets[0];
                console.log(`🔄 Fallback: Using first sheet "${targetSheetName}"`);
            } else {
                throw new Error("No sheets found in the spreadsheet.");
            }
        }

        console.log(`🎯 Validating Target Sheet: "${targetSheetName}"`);

        // 3. Get sheet data using the confirmed name
        const sheetData = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheet_id,
            range: `'${targetSheetName}'!A:ZZ`, // Safely quoted
        });

        const allData = sheetData.data.values || [];
        if (allData.length < 2) {
            return res.json({
                success: true,
                message: 'Sheet has no data to validate.',
                error_cells: [],
                data: []
            });
        }

        const headers = allData[0];


        const dataRows = allData.slice(1);

        // Get schema from cache or fetch
        // UNIQUE ID: ID/Tab/Type
        // We need sheet_type here. If not passed in body, validation might fail to find unique schema.
        // For now, assuming caller passes it OR we might have issues.
        // UPDATE: Caller MUST pass sheet_type.
        const typeSuffix = req.body.sheet_type ? `/${req.body.sheet_type}` : '';
        const schemaPath = `${spreadsheet_id}/${tab_name}${typeSuffix}`;

        let schema = schemaCache.get(schemaPath);

        if (!schema) {
            // Search all validation worksheets
            for (const sheetType in VALIDATION_WORKSHEETS) {
                const worksheet = VALIDATION_WORKSHEETS[sheetType];
                try {
                    const schemaSheet = await sheets.spreadsheets.values.get({
                        spreadsheetId: CONFIG_SPREADSHEET_ID,
                        range: `${worksheet}!A:C`,
                    });

                    const rows = schemaSheet.data.values || [];
                    for (let i = 1; i < rows.length; i++) {
                        if (rows[i][2] === schemaPath) { // Column C is SchemaPath
                            schema = JSON.parse(rows[i][1]);
                            schemaCache.set(schemaPath, schema);
                            break;
                        }
                    }

                    if (schema) break;
                } catch (err) {
                    // Continue searching
                }
            }
        }

        if (!schema) {
            return res.status(404).json({
                success: false,
                message: `No schema found for '${tab_name}'.`
            });
        }

        // Validate data
        const errorCells = [];
        const correctedData = [];

        dataRows.forEach((row, rowIdx) => {
            const rowObj = {};
            headers.forEach((header, colIdx) => {
                const value = (row[colIdx] || '').toString().trim();
                rowObj[header] = value;

                // Find schema rule for this column (Case Insensitive)
                const rule = schema.find(r => r.name.trim().toLowerCase() === header.trim().toLowerCase());
                if (rule) {
                    // Check required field
                    if (rule.required && !value) {
                        const cellRow = rowIdx + 2;
                        const cellCol = String.fromCharCode(65 + colIdx);
                        errorCells.push(`${cellCol}${cellRow}`);
                    }

                    // Add more detailed validation based on type
                    if (value) {
                        let isValid = true;

                        switch (rule.type) {
                            case 'phone_number':
                                isValid = /^\d{10}$/.test(value);
                                break;
                            case 'pincode':
                                isValid = /^\d{6}$/.test(value);
                                break;
                            case 'aadhar':
                                isValid = /^\d{12}$/.test(value);
                                break;
                            case 'pan': // ADDED PAN VALIDATION
                                isValid = /^[A-Za-z]{5}\d{4}[A-Za-z]{1}$/.test(value);
                                break;
                            case 'date':
                                isValid = /^\d{2}\/\d{2}\/\d{4}$/.test(value);
                                break;
                            case 'age':
                                isValid = !isNaN(value) && parseInt(value) >= 0 && parseInt(value) <= 130;
                                break;
                            case 'number':
                                isValid = !isNaN(value);
                                if (rule.isFixed && rule.length) {
                                    isValid = isValid && value.length === parseInt(rule.length);
                                }
                                break;
                            case 'options':
                                if (rule.options && rule.options.length > 0) {
                                    // Robust check: match string representation
                                    isValid = rule.options.some(opt => opt.toString().trim().toLowerCase() === value.toLowerCase());
                                }
                                break;
                        }

                        if (!isValid) {
                            const cellRow = rowIdx + 2;
                            const cellCol = String.fromCharCode(65 + colIdx);
                            errorCells.push(`${cellCol}${cellRow}`);
                        }
                    }
                }
            });
            correctedData.push(rowObj);
        });

        // Format cells if not skipped
        if (!skip_formatting) {
            // Get sheet ID
            const spreadsheet = await sheets.spreadsheets.get({
                spreadsheetId: spreadsheet_id
            });
            const sheetId = spreadsheet.data.sheets.find(s =>
                s.properties.title === tab_name
            )?.properties.sheetId || 0;

            // IMPORTANT: Clear all backgrounds first
            const clearRequests = [{
                repeatCell: {
                    range: {
                        sheetId: sheetId,
                        startRowIndex: 1,
                        endRowIndex: allData.length,
                        startColumnIndex: 0,
                        endColumnIndex: headers.length
                    },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: { red: 1, green: 1, blue: 1 }
                        }
                    },
                    fields: 'userEnteredFormat.backgroundColor'
                }
            }];

            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: spreadsheet_id,
                requestBody: { requests: clearRequests }
            });

            // Apply red background to error cells
            if (errorCells.length > 0) {
                const errorRequests = errorCells.map(cellA1 => {
                    const match = cellA1.match(/([A-Z]+)(\d+)/);
                    if (match) {
                        const col = match[1].charCodeAt(0) - 65;
                        const row = parseInt(match[2]) - 1;

                        return {
                            repeatCell: {
                                range: {
                                    sheetId: sheetId,
                                    startRowIndex: row,
                                    endRowIndex: row + 1,
                                    startColumnIndex: col,
                                    endColumnIndex: col + 1
                                },
                                cell: {
                                    userEnteredFormat: {
                                        backgroundColor: { red: 0.98, green: 0.8, blue: 0.8 }
                                    }
                                },
                                fields: 'userEnteredFormat.backgroundColor'
                            }
                        };
                    }
                }).filter(Boolean);

                if (errorRequests.length > 0) {
                    await sheets.spreadsheets.batchUpdate({
                        spreadsheetId: spreadsheet_id,
                        requestBody: { requests: errorRequests }
                    });
                }
            }
        }

        const message = errorCells.length > 0
            ? `Validation complete. Found ${errorCells.length} errors.`
            : 'Validation complete. No errors found.';

        res.json({
            success: true,
            message: message,
            error_cells: errorCells,
            data: correctedData
        });

    } catch (error) {
        console.error('Error in validate-and-format-sheet:', error);

        // Improve error message for common issues
        let userMessage = `An error occurred during validation: ${error.message}`;

        if (error.code === 403 || error.message.includes('403') || error.message.toLowerCase().includes('permission')) {
            userMessage = "⛔ Bot Access Denied. Please ensure you have shared the Google Sheet with the bot email as 'Editor'.";
        } else if (error.code === 404 || error.message.includes('404')) {
            userMessage = "⛔ Sheet Not Found. Please check that the URL is correct and the Sheet Name (Tab Name) matches exactly.";
        } else if (error.message.includes('No schema found')) {
            userMessage = `⛔ No validation rules found for '${tab_name}'. Please Configure Rules first in the Validation Manager.`;
        }

        res.status(500).json({
            success: false,
            message: userMessage
        });
    }
});

// ==========================================
// EXISTING ENDPOINTS CONTINUE BELOW
// ==========================================

app.post('/api/login', waitForDb, (req, res) => {
    const { role, tagNumber, authKey } = req.body;

    // Find user based on role
    const user = DB.Users.find(row => {
        if (row.Role !== role) return false;

        // For Admin: authenticate by name (they don't have tag numbers)
        if (role === 'Admin') {
            return row.Name && row.Name.toLowerCase() === tagNumber.toLowerCase();
        }

        // For User and Manager: authenticate by Tag Number
        return row.TagNumber && row.TagNumber.toLowerCase() === tagNumber.toLowerCase();
    });

    if (user) {
        authenticator.options = { window: 1 };
        if (authenticator.check(authKey, user.AuthKey)) {
            res.json({ success: true, user: { id: user.UserID, name: user.Name, role: user.Role, subdivision: user.Subdivision, station: user.Station } });
        } else { res.status(401).json({ success: false, message: 'Invalid Code' }); }
    } else {
        const errorMsg = role === 'Admin' ? 'Admin not found with this name' : 'User not found with this Tag Number';
        res.status(401).json({ success: false, message: errorMsg });
    }
});

app.get('/api/admin/users', waitForDb, (req, res) => {
    // Added TagNumber to response. Email is now comma-separated list, split into array
    const users = DB.Users.map(u => ({
        id: u.UserID,
        name: u.Name,
        role: u.Role,
        email: u.Email, // Keep as string for backward compatibility
        emails: (u.Email || '').split(',').map(e => e.trim()).filter(e => e), // Also provide as array
        subdivision: u.Subdivision,
        station: u.Station,
        phone: u.Phone,
        tagNumber: u.TagNumber
    }));
    res.json(users);
});

app.get('/api/admin/structure', waitForDb, (req, res) => {
    const structure = {};
    DB.Stations.forEach(row => {
        if (row.Subdivision) structure[row.Subdivision] = row.Stations ? row.Stations.split(',').map(s => s.trim()).filter(s => s !== '') : [];
    });
    res.json(structure);
});

app.get('/api/manager/groups', waitForDb, (req, res) => {
    const groups = DB.Groups.map(r => ({ id: r.GroupID, name: r.GroupName, createdBy: r.CreatedBy, userIds: r.UserIDs ? r.UserIDs.split(',') : [] }));
    res.json(groups);
});

app.post('/api/manager/all-tasks', waitForDb, (req, res) => {
    const { managerId } = req.body;

    // Inject TagNumber and Phone into userMap so we can include them in the response
    const userMap = {};
    DB.Users.forEach(u => userMap[u.UserID] = {
        name: u.Name,
        station: u.Station,
        subdivision: u.Subdivision,
        tagNumber: u.TagNumber,
        phone: u.Phone // <--- ADDED PHONE
    });

    const allTasks = DB.Tasks
        .filter(row => row.CreatedBy === managerId)
        .map(row => {
            const u = userMap[row.AssignedTo] || { name: 'Unknown', station: 'Unknown', subdivision: 'Unknown', tagNumber: '999999', phone: '' };
            return {
                taskId: row.TaskID, sheetType: row.SheetType, status: row.Status, link: row.SheetLink,
                date: row.Date, dueDate: row.DueDate, sheetName: row.TaskName,
                isNil: String(row.IsNil).toUpperCase() === 'TRUE', groupName: row.GroupName,
                completedDate: row.CompletedDate,
                assignedToId: row.AssignedTo,
                userName: u.name,
                userStation: u.station,
                userSubdivision: u.subdivision,
                userTagNumber: u.tagNumber,
                userPhone: u.phone, // <--- SENT TO FRONTEND
                isArchived: String(row.IsArchived).toUpperCase() === 'TRUE',
                completedByManager: row.CompletedByManager || ''
            };
        });
    res.json(allTasks);
});


app.post('/api/user/tasks', waitForDb, (req, res) => {
    const { userId } = req.body;

    // Create a map of managers for quick lookup
    const managerMap = {};
    DB.Users.forEach(u => {
        managerMap[u.UserID] = u.Name;
    });

    const myTasks = DB.Tasks.filter(row => row.AssignedTo === userId && String(row.IsArchived).toUpperCase() !== 'TRUE').map(row => ({
        id: row.TaskID, link: row.SheetLink, type: row.SheetType, status: row.Status,
        date: row.Date, name: row.TaskName, dueDate: row.DueDate,
        allowNil: String(row.AllowNil).toUpperCase() === 'TRUE',
        isNil: String(row.IsNil).toUpperCase() === 'TRUE',
        completedDate: row.CompletedDate,
        managerName: managerMap[row.CreatedBy] || 'Unknown' // Add manager name
    }));
    console.log(`👤 User ${userId} requested tasks. Found ${myTasks.length} active tasks.`);
    if (myTasks.length > 0) console.log(`   Detailed First Task:`, JSON.stringify(myTasks[0], null, 2));

    res.json(myTasks);
});


// ==========================================
// 4. WRITE ROUTES
// ==========================================

app.post('/api/admin/create-user', async (req, res) => {
    let { name, role, subdivision, station, emails, phone, tagNumber } = req.body;

    // emails is now an array, join to comma-separated string for storage
    const emailStr = (emails || []).filter(e => e.trim()).join(',');


    if (!emailStr) {
        return res.status(400).json({ message: 'At least one email is required' });
    }

    const phoneRegex = /^\d{10}$/;
    if (!phone || !phoneRegex.test(phone)) {
        return res.status(400).json({ message: 'Phone number must be exactly 10 digits' });
    }

    // Tag Number Uniqueness Validation
    if (tagNumber && tagNumber.trim()) {
        const existingUser = DB.Users.find(u =>
            u.TagNumber &&
            u.TagNumber.toLowerCase() === tagNumber.trim().toLowerCase()
        );
        if (existingUser) {
            return res.status(400).json({ message: `Tag Number '${tagNumber}' is already assigned to ${existingUser.Name}` });
        }
    }

    // Role Specific Logic
    if (role === 'Admin') { subdivision = 'HQ'; station = 'Headquarters'; }
    // For Manager, station field will contain their role name (from frontend)


    const { secret, qrCodeData } = await generateTOTP(name, tagNumber);

    const newUser = {
        UserID: uuidv4(),
        Name: name,
        Role: role,
        Subdivision: subdivision,
        Station: station,
        Email: emailStr, // Now stores comma-separated emails
        Phone: phone,
        TagNumber: tagNumber || '', // Added
        AuthKey: secret
    };

    queueJob('ADD', 'Users', newUser);
    res.json({ success: true, qrCode: qrCodeData, secret: secret });
});

app.post('/api/admin/delete-user', (req, res) => {
    queueJob('DELETE', 'Users', null, 'UserID', req.body.userId);
    res.json({ success: true });
});

app.post('/api/admin/reset-key', async (req, res) => {
    const user = DB.Users.find(u => u.Email.toLowerCase() === req.body.email.toLowerCase());
    if (user) {
        const { secret, qrCodeData } = await generateTOTP(user.Name);
        queueJob('UPDATE', 'Users', { AuthKey: secret }, 'UserID', user.UserID);
        res.json({ success: true, qrCode: qrCodeData, secret: secret });
    } else { res.status(404).json({ message: "User not found" }); }
});

app.post('/api/admin/create-subdivision', (req, res) => {
    const { subdivision, stations } = req.body;
    if (DB.Stations.some(s => (s.Subdivision || '').trim().toLowerCase() === subdivision.trim().toLowerCase())) return res.status(400).json({ message: "Exists" });
    queueJob('ADD', 'Stations', { Subdivision: subdivision, Stations: stations });
    res.json({ success: true });
});

app.post('/api/admin/update-stations-list', (req, res) => {
    const { subdivision, stations } = req.body;
    queueJob('UPDATE', 'Stations', { Stations: stations }, 'Subdivision', subdivision);
    const valid = stations.split(',').map(s => s.trim().toLowerCase());
    const toDel = DB.Users.filter(r => r.Subdivision === subdivision && r.Role === 'User' && !valid.includes((r.Station || '').trim().toLowerCase()));
    toDel.forEach(u => queueJob('DELETE', 'Users', null, 'UserID', u.UserID));
    res.json({ success: true, deletedUsers: toDel.length });
});

app.post('/api/admin/delete-subdivision', (req, res) => {
    const { subdivision } = req.body;
    queueJob('DELETE', 'Stations', null, 'Subdivision', subdivision);
    const toDel = DB.Users.filter(r => r.Subdivision === subdivision);
    toDel.forEach(u => queueJob('DELETE', 'Users', null, 'UserID', u.UserID));
    res.json({ success: true, deletedUsers: toDel.length });
});

app.post('/api/manager/create-group', (req, res) => {
    const { groupName, userIds, managerId } = req.body;
    const newGroup = { GroupID: uuidv4(), GroupName: groupName, CreatedBy: managerId, UserIDs: userIds.join(',') };
    queueJob('ADD', 'Groups', newGroup);
    res.json({ success: true });
});

app.post('/api/manager/delete-group', (req, res) => {
    const { groupId } = req.body;
    queueJob('DELETE', 'Groups', null, 'GroupID', groupId);
    res.json({ success: true });
});

app.post('/api/admin/update-group', (req, res) => {
    const { groupId, userIds } = req.body;
    // Join array back to comma-separated string for storage
    const userIdsStr = userIds.join(',');
    queueJob('UPDATE', 'Groups', { UserIDs: userIdsStr }, 'GroupID', groupId);
    res.json({ success: true });
});

app.post('/api/manager/assign-sheet', async (req, res) => {
    const { type, targets, manualLink, sheetName, dueDate, allowNil, groupNameUsed, managerId, weeklyDay, fortnightlyDays } = req.body;

    // 0. VERIFY BOT ACCESS
    try {
        const spreadsheetId = extractSpreadsheetId(manualLink);
        if (!spreadsheetId) {
            return res.status(400).json({ message: 'Invalid or missing Google Sheet Link' });
        }
        // Try to fetch file metadata - will throw if no access
        await drive.files.get({ fileId: spreadsheetId, fields: 'id, name' });
    } catch (error) {
        console.error("❌ Bot Access Check Failed:", error.message);
        return res.status(400).json({
            message: `⚠️ Bot cannot access this sheet yet.\n\nPlease share the Google Sheet with:\n${credentials.client_email}\n\nas 'Editor', then try assigning again.`
        });
    }

    // ... (Drive sharing logic) ...
    const driveTask = async () => {
        try {
            const drive = google.drive({ version: 'v3', auth: serviceAccountAuth });
            const fileId = extractFileId(manualLink);
            if (fileId) {
                for (const user of targets) {
                    // user.emails is now an array of email addresses
                    const emailsToShare = user.emails || (user.email ? [user.email] : []);

                    for (const email of emailsToShare) {
                        if (email && email.trim()) {
                            await drive.permissions.create({
                                fileId: fileId,
                                requestBody: { role: 'writer', type: 'user', emailAddress: email.trim() }
                            }).catch(e => { console.log(`Failed to share with ${email}:`, e.message); });
                            await new Promise(r => setTimeout(r, 200));
                        }
                    }
                }
            }
        } catch (e) { console.error('Drive sharing error:', e.message); }
    };
    driveTask();

    let monthlyDay = '';
    if (type === 'Monthly' && dueDate) {
        monthlyDay = new Date(dueDate).getDate(); // Store the day (1-31)
    } else if (type === 'Fortnightly' && fortnightlyDays) {
        monthlyDay = fortnightlyDays; // Store "d1,d2"
    }

    targets.forEach(user => {
        const newTask = {
            TaskID: uuidv4(), SheetLink: manualLink, SheetType: type,
            AssignedTo: user.id || user.UserID, Status: 'Pending', Date: new Date().toISOString(),
            TaskName: sheetName || `${type} Report`, DueDate: dueDate || '',
            AllowNil: allowNil ? 'TRUE' : 'FALSE', IsNil: 'FALSE', GroupName: groupNameUsed || '',
            CompletedDate: '',
            CreatedBy: managerId || '',
            IsArchived: 'FALSE',
            CompletedByManager: '',
            WeeklyDay: weeklyDay || '', // Store the day of the week for weekly tasks
            MonthlyDay: monthlyDay || '' // Store anchor day for monthly/fortnightly
        };
        queueJob('ADD', 'Tasks', newTask);
    });
    res.json({ success: true });
});

app.post('/api/user/complete', (req, res) => {
    const timestamp = new Date().toISOString();
    queueJob('UPDATE', 'Tasks', { Status: 'Completed', IsNil: 'FALSE', CompletedDate: timestamp }, 'TaskID', req.body.taskId);
    res.json({ success: true });
});

app.post('/api/user/submit-nil', (req, res) => {
    const timestamp = new Date().toISOString();
    queueJob('UPDATE', 'Tasks', { Status: 'Completed', IsNil: 'TRUE', CompletedDate: timestamp }, 'TaskID', req.body.taskId);
    res.json({ success: true });
});

app.post('/api/manager/reassign', (req, res) => {
    queueJob('UPDATE', 'Tasks', { Status: 'Pending', IsNil: 'FALSE', CompletedDate: '' }, 'TaskID', req.body.taskId);
    res.json({ success: true });
});

app.post('/api/manager/mark-all-complete', (req, res) => {
    const { sheetName, sheetType, managerId, managerName } = req.body;

    // Find all pending tasks for this sheet
    const tasksToComplete = DB.Tasks.filter(t =>
        t.TaskName === sheetName &&
        t.SheetType === sheetType &&
        t.CreatedBy === managerId &&
        t.Status === 'Pending'
    );

    if (tasksToComplete.length === 0) {
        return res.status(404).json({ message: 'No pending tasks found' });
    }

    const timestamp = new Date().toISOString();

    // Mark all tasks as completed by manager
    tasksToComplete.forEach(task => {
        queueJob('UPDATE', 'Tasks', {
            Status: 'Completed',
            IsNil: 'FALSE',
            CompletedDate: timestamp,
            CompletedByManager: managerId  // Store manager ID instead of name
        }, 'TaskID', task.TaskID);
    });

    res.json({ success: true, completedCount: tasksToComplete.length });
});

app.post('/api/manager/archive-sheet', async (req, res) => {
    const { sheetName, sheetType, managerId } = req.body;

    // Find all tasks for this sheet created by this manager
    const tasksToArchive = DB.Tasks.filter(t =>
        t.TaskName === sheetName &&
        t.SheetType === sheetType &&
        t.CreatedBy === managerId &&
        String(t.IsArchived).toUpperCase() !== 'TRUE' // Only archive active tasks
    );

    if (tasksToArchive.length === 0) {
        return res.status(404).json({ message: 'No tasks found for this sheet' });
    }

    // Collect all unique user emails assigned to this sheet
    const userIds = [...new Set(tasksToArchive.map(t => t.AssignedTo))];
    const userEmails = [];

    userIds.forEach(userId => {
        const user = DB.Users.find(u => u.UserID === userId);
        if (user && user.Email) {
            // User.Email is a comma-separated list, split and add all emails
            const emails = user.Email.split(',').map(e => e.trim()).filter(e => e);
            userEmails.push(...emails);
        }
    });

    // Remove duplicates from email list
    const uniqueEmails = [...new Set(userEmails)];

    // Get the sheet URL from the first task (all tasks should have the same sheet link)
    const sheetUrl = tasksToArchive[0]?.SheetLink;

    // Remove Google Sheet permissions for all users
    if (sheetUrl && uniqueEmails.length > 0) {
        const permissionResult = await removeSheetPermissions(sheetUrl, uniqueEmails);
        console.log(`📋 Archive Sheet: ${sheetName} | Removed permissions for ${permissionResult.removedCount || 0} users`);
    }

    // Move tasks from active sheet to archived sheet
    tasksToArchive.forEach(task => {
        // Delete from active sheet
        const activeSheetName = getTaskSheetName(task.SheetType, false);
        WRITE_QUEUE.push({
            type: 'DELETE',
            sheet: activeSheetName,
            data: null,
            keyField: 'TaskID',
            keyValue: task.TaskID,
            headers: ['TaskID', 'SheetLink', 'SheetType', 'AssignedTo', 'Status', 'Date', 'TaskName', 'DueDate', 'AllowNil', 'IsNil', 'GroupName', 'CompletedDate', 'CreatedBy', 'IsArchived', 'CompletedByManager', 'WeeklyDay']
        });

        // Add to archived sheet with IsArchived = TRUE
        const archivedSheetName = getTaskSheetName(task.SheetType, true);
        const archivedTask = { ...task, IsArchived: 'TRUE' };

        // Update in RAM
        const ramTask = DB.Tasks.find(t => t.TaskID === task.TaskID);
        if (ramTask) ramTask.IsArchived = 'TRUE';

        WRITE_QUEUE.push({
            type: 'ADD',
            sheet: archivedSheetName,
            data: archivedTask,
            keyField: 'TaskID',
            keyValue: task.TaskID,
            headers: ['TaskID', 'SheetLink', 'SheetType', 'AssignedTo', 'Status', 'Date', 'TaskName', 'DueDate', 'AllowNil', 'IsNil', 'GroupName', 'CompletedDate', 'CreatedBy', 'IsArchived', 'CompletedByManager', 'WeeklyDay']
        });
    });

    processWriteQueue();

    res.json({
        success: true,
        archivedCount: tasksToArchive.length,
        permissionsRemoved: uniqueEmails.length
    });
});

app.post('/api/manager/unarchive-sheet', async (req, res) => {
    const { sheetName, sheetType, managerId } = req.body;

    // Find all tasks for this sheet created by this manager
    const tasksToUnarchive = DB.Tasks.filter(t =>
        t.TaskName === sheetName &&
        t.SheetType === sheetType &&
        t.CreatedBy === managerId &&
        String(t.IsArchived).toUpperCase() === 'TRUE' // Only unarchive archived tasks
    );

    if (tasksToUnarchive.length === 0) {
        return res.status(404).json({ message: 'No tasks found for this sheet' });
    }

    // Collect all unique user emails assigned to this sheet
    const userIds = [...new Set(tasksToUnarchive.map(t => t.AssignedTo))];
    const userEmails = [];

    userIds.forEach(userId => {
        const user = DB.Users.find(u => u.UserID === userId);
        if (user && user.Email) {
            // User.Email is a comma-separated list, split and add all emails
            const emails = user.Email.split(',').map(e => e.trim()).filter(e => e);
            userEmails.push(...emails);
        }
    });

    // Remove duplicates from email list
    const uniqueEmails = [...new Set(userEmails)];

    // Get the sheet URL from the first task (all tasks should have the same sheet link)
    const sheetUrl = tasksToUnarchive[0]?.SheetLink;

    // Restore Google Sheet permissions for all users
    if (sheetUrl && uniqueEmails.length > 0) {
        const permissionResult = await grantSheetPermissions(sheetUrl, uniqueEmails);
        console.log(`📤 Unarchive Sheet: ${sheetName} | Granted permissions to ${permissionResult.grantedCount || 0} users`);
    }

    // Move tasks from archived sheet to active sheet
    tasksToUnarchive.forEach(task => {
        // Delete from archived sheet
        const archivedSheetName = getTaskSheetName(task.SheetType, true);
        WRITE_QUEUE.push({
            type: 'DELETE',
            sheet: archivedSheetName,
            data: null,
            keyField: 'TaskID',
            keyValue: task.TaskID,
            headers: ['TaskID', 'SheetLink', 'SheetType', 'AssignedTo', 'Status', 'Date', 'TaskName', 'DueDate', 'AllowNil', 'IsNil', 'GroupName', 'CompletedDate', 'CreatedBy', 'IsArchived', 'CompletedByManager', 'WeeklyDay']
        });

        // Add to active sheet with IsArchived = FALSE
        const activeSheetName = getTaskSheetName(task.SheetType, false);
        const activeTask = { ...task, IsArchived: 'FALSE' };

        // Update in RAM
        const ramTask = DB.Tasks.find(t => t.TaskID === task.TaskID);
        if (ramTask) ramTask.IsArchived = 'FALSE';

        WRITE_QUEUE.push({
            type: 'ADD',
            sheet: activeSheetName,
            data: activeTask,
            keyField: 'TaskID',
            keyValue: task.TaskID,
            headers: ['TaskID', 'SheetLink', 'SheetType', 'AssignedTo', 'Status', 'Date', 'TaskName', 'DueDate', 'AllowNil', 'IsNil', 'GroupName', 'CompletedDate', 'CreatedBy', 'IsArchived', 'CompletedByManager', 'WeeklyDay']
        });
    });

    processWriteQueue();

    res.json({
        success: true,
        unarchivedCount: tasksToUnarchive.length,
        permissionsGranted: uniqueEmails.length
    });
});

async function generateTOTP(name, tagNumber) {
    const secret = authenticator.generateSecret();
    // Display as "Name - TagNumber" for easier identification
    const displayName = tagNumber ? `${name} - ${tagNumber}` : name;
    const otpauth = authenticator.keyuri(displayName, 'PoliceApp', secret);
    const qrCodeData = await QRCode.toDataURL(otpauth);
    return { secret, qrCodeData };
}

function checkRecurringTasks() {
    console.log("⏰ Checking Recurring Tasks...");
    if (isSyncing || isProcessingQueue) return;

    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Filter Tasks for reset
    const processList = DB.Tasks.filter(t => {
        // Must be one of our recurring types
        if (t.SheetType !== 'Daily' && t.SheetType !== 'Monthly' && t.SheetType !== 'Weekly' && t.SheetType !== 'Fortnightly') return false;

        // Skip archived tasks - they should not auto-reset or rollover
        if (String(t.IsArchived).toUpperCase() === 'TRUE') return false;

        // For Daily: We always check (to catch the specific time slot)
        // For Weekly/Monthly/Fortnightly: We always check because:
        // 1. We might need to Rollover the Date (if passed)
        // 2. We might need to Reset Status (if in 3-day window)
        // The detailed logic is in the loop below, so we shouldn't filter prematurely.
        return true;
    });

    processList.forEach(task => {
        // For Daily sheets: Reset at specific Time (HH:MM)
        if (task.SheetType === 'Daily') {
            const now = new Date();
            let targetHour = 0;
            let targetMinute = 0;

            if (task.DueDate) {
                const due = new Date(task.DueDate);
                targetHour = due.getHours();
                targetMinute = due.getMinutes();
            }

            // Determine the most recent Reset Point (Today HH:MM or Yesterday HH:MM)
            const todayReset = new Date();
            todayReset.setHours(targetHour, targetMinute, 0, 0);

            let lastResetPoint = new Date(todayReset);
            if (now < todayReset) {
                // We haven't reached today's reset time yet, so the last reset was yesterday
                lastResetPoint.setDate(lastResetPoint.getDate() - 1);
            }

            // Check if task needs reset
            // Reset if it is 'Completed' AND was completed BEFORE the last reset point
            if (task.Status === 'Completed' || task.CompletedDate) {
                let shouldReset = false;
                if (task.CompletedDate) {
                    const completedDate = new Date(task.CompletedDate);
                    if (completedDate < lastResetPoint) {
                        shouldReset = true;
                    }
                } else {
                    // Legacy: If status is completed but no date, force reset
                    shouldReset = true;
                }

                if (shouldReset) {
                    console.log(`♻️ Resetting Daily Task: ${task.TaskName} (Reset Time: ${targetHour}:${String(targetMinute).padStart(2, '0')})`);
                    queueJob('UPDATE', 'Tasks', {
                        Status: 'Pending',
                        IsNil: 'FALSE',
                        CompletedDate: '', // Clear completed date
                        CompletedByManager: ''
                    }, 'TaskID', task.TaskID);
                }
            }
        }

        // For Weekly sheets: Reset logic with 3-day window (Precise Time)
        else if (task.SheetType === 'Weekly') {
            if (!task.WeeklyDay || !task.DueDate) return;

            let currentDue = new Date(task.DueDate);
            let needsDateUpdate = false;
            let needsStatusReset = false;

            // 1. DATE ROLLOVER: If DueDate is in the past, move it forward
            // Check precise time (now > currentDue)
            if (now > currentDue) {
                while (now > currentDue) {
                    currentDue.setDate(currentDue.getDate() + 7);
                }
                needsDateUpdate = true;
            }

            // 2. STATUS RESET: Check if we are within 3 days of the (possibly new) due date
            // Activation date is 3 days before Due Date (Preserving Time)
            const activationDate = new Date(currentDue);
            activationDate.setDate(activationDate.getDate() - 3);

            // If we are int the active window (Now >= Activation)
            if (now >= activationDate) {
                // If satisfied (completed), check if it's a STALE completion from a previous cycle
                if (task.Status === 'Completed' || task.CompletedDate) {
                    if (task.CompletedDate) {
                        const completedDate = new Date(task.CompletedDate);
                        // If completed BEFORE the current activation window, it's stale
                        if (completedDate < activationDate) {
                            needsStatusReset = true;
                        }
                    } else {
                        // If status is completed but no date (legacy?), force reset
                        needsStatusReset = true;
                    }
                }
                // If it's already Pending, do nothing (it's active)
            }

            // Apply Updates
            if (needsDateUpdate || needsStatusReset) {
                const updates = {};
                let logMsg = `♻️ Updating Weekly Task: ${task.TaskName}`;

                if (needsDateUpdate) {
                    const newDueStr = currentDue.toISOString();
                    updates.DueDate = newDueStr;
                    logMsg += ` | New Due: ${newDueStr}`;
                }

                if (needsStatusReset) {
                    updates.Status = 'Pending';
                    updates.IsNil = 'FALSE';
                    updates.CompletedDate = '';
                    updates.CompletedByManager = '';
                    logMsg += ` | Status Reset to Pending`;
                }

                console.log(logMsg);
                queueJob('UPDATE', 'Tasks', updates, 'TaskID', task.TaskID);
            }
        }

        // For Monthly sheets: Sticky Date Logic with 3-day window (Precise Time)
        else if (task.SheetType === 'Monthly') {
            if (!task.DueDate) return;

            let currentDue = new Date(task.DueDate);
            // Use stored MonthlyDay (anchor) or fallback to current due day
            const anchorDay = task.MonthlyDay ? parseInt(task.MonthlyDay) : currentDue.getDate();

            let needsDateUpdate = false;
            let needsStatusReset = false;

            // 1. DATE ROLLOVER: If DueDate is in the past, move it forward
            if (now > currentDue) {
                while (now > currentDue) {
                    // Move to next month
                    currentDue.setDate(1); // Safely go to 1st to avoid overflow
                    currentDue.setMonth(currentDue.getMonth() + 1);

                    // Clamp to Anchor Day vs Last Day of Month
                    const year = currentDue.getFullYear();
                    const month = currentDue.getMonth();
                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                    const finalDay = Math.min(anchorDay, daysInMonth);

                    currentDue.setDate(finalDay);
                }
                needsDateUpdate = true;
            }

            // 2. STATUS RESET: Check if we are within 3 days of the (possibly new) due date (Preserving Time)
            const activationDate = new Date(currentDue);
            activationDate.setDate(activationDate.getDate() - 3);

            if (now >= activationDate) {
                // Check for stale completion
                if (task.Status === 'Completed' || task.CompletedDate) {
                    if (task.CompletedDate) {
                        const completedDate = new Date(task.CompletedDate);
                        if (completedDate < activationDate) {
                            needsStatusReset = true;
                        }
                    } else {
                        needsStatusReset = true;
                    }
                }
            }

            // Apply Updates
            if (needsDateUpdate || needsStatusReset) {
                const updates = {};
                let logMsg = `♻️ Updating Monthly Task: ${task.TaskName}`;

                if (needsDateUpdate) {
                    const newDueStr = currentDue.toISOString().split('T')[0];
                    // IMPORTANT: For Monthly, we must preserve the time component which might get lost if we just use YYYY-MM-DD
                    // But wait, monthly logic in earlier steps used .split('T')[0] for newDueStr.
                    // If we want to support time, we should use .toISOString().
                    // But the frontend input for Monthly might be Date only? No, we added Due Time for Monthly too. 
                    // Let's use full ISO string to preserve time.
                    updates.DueDate = currentDue.toISOString();

                    // If this was a legacy task without MonthlyDay, save the anchor now
                    if (!task.MonthlyDay) updates.MonthlyDay = anchorDay;
                    logMsg += ` | New Due: ${updates.DueDate} (Anchor: ${anchorDay})`;
                }

                if (needsStatusReset) {
                    updates.Status = 'Pending';
                    updates.IsNil = 'FALSE';
                    updates.CompletedDate = '';
                    updates.CompletedByManager = '';
                    logMsg += ` | Status Reset to Pending`;
                }

                console.log(logMsg);
                queueJob('UPDATE', 'Tasks', updates, 'TaskID', task.TaskID);
            }
        }

        // For Fortnightly sheets: Two Sticky Dates (Precise Time)
        else if (task.SheetType === 'Fortnightly') {
            if (!task.DueDate || !task.MonthlyDay) return;

            let currentDue = new Date(task.DueDate);
            // MonthlyDay stores "d1,d2" e.g. "1,15"
            // Ensure we handle potential parse errors or single values
            const parts = String(task.MonthlyDay).split(',');
            const anchorDays = parts.map(d => parseInt(d)).filter(d => !isNaN(d)).sort((a, b) => a - b);

            if (anchorDays.length === 0) return;

            let needsDateUpdate = false;
            let needsStatusReset = false;

            // 1. DATE ROLLOVER
            if (now > currentDue) {
                // Find method: We need to find the FIRST occurrence that is strictly > currentDue
                // We generate a set of candidates around the currentDue month (Current Month, Next Month)
                // We know that Fortnightly tasks are at most ~1 month apart (usually ~2 weeks).
                // So checking Current Month and Next Month of 'currentDue' is sufficient to find the next step.
                // However, since 'now' might be far ahead (e.g. server down for a week), we should base candidates on 'now' ?
                // NO. Standard recurrence logic usually steps forward from the *last due date* to maintain the cycle.
                // But if 'now' is way ahead, we want to catch up.
                // Let's implement a simple "catch up" loop.

                while (now > currentDue) {
                    // Find next candidate strictly > currentDue
                    const candidates = [];

                    // We look at the month of currentDue, and the month AFTER currentDue.
                    // This covers all transitions (e.g. if currentDue is Jan 31, next could be Feb 15).
                    [0, 1].forEach(offset => {
                        anchorDays.forEach(day => {
                            const c = new Date(currentDue);
                            c.setDate(1); // Reset to first to avoid overflow when changing month
                            c.setMonth(c.getMonth() + offset);

                            // Set to anchor day with clamping (Sticky Logic)
                            const maxDays = new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate();
                            const actualDay = Math.min(day, maxDays);
                            c.setDate(actualDay);

                            // Restore Time from original currentDue (which has the Due Time)
                            // Note: 'c' currently has currentDue's time because we cloned 'currentDue' initially.
                            // But wait, line `c.setMonth` might shift time if crossing DST? 
                            // Usually acceptable. We just ensure HH:MM is preserved if needed, but Date object usually handles simple add.
                            // Actually, let's explicitly reset time just to be safe if we were constructing from scratch, 
                            // but since we cloned, it keeps the time.
                            candidates.push(c);
                        });
                    });

                    candidates.sort((a, b) => a - b);
                    const next = candidates.find(c => c > currentDue);

                    if (next) {
                        currentDue = next;
                    } else {
                        // Should not happen if anchors are valid, but fallback to avoid infinite loop
                        currentDue.setDate(currentDue.getDate() + 1);
                    }
                }
                needsDateUpdate = true;
            }

            // 2. STATUS RESET (3 days before)
            const activationDate = new Date(currentDue);
            activationDate.setDate(activationDate.getDate() - 3);

            if (now >= activationDate) {
                if (task.Status === 'Completed' || task.CompletedDate) {
                    if (task.CompletedDate) {
                        const completedDate = new Date(task.CompletedDate);
                        if (completedDate < activationDate) {
                            needsStatusReset = true;
                        }
                    } else {
                        needsStatusReset = true;
                    }
                }
            }

            // Apply
            if (needsDateUpdate || needsStatusReset) {
                const updates = {};
                let logMsg = `♻️ Updating Fortnightly Task: ${task.TaskName}`;

                if (needsDateUpdate) {
                    updates.DueDate = currentDue.toISOString();
                    logMsg += ` | New Due: ${updates.DueDate}`;
                }

                if (needsStatusReset) {
                    updates.Status = 'Pending';
                    updates.IsNil = 'FALSE';
                    updates.CompletedDate = '';
                    updates.CompletedByManager = '';
                    logMsg += ` | Status Reset to Pending`;
                }

                console.log(logMsg);
                queueJob('UPDATE', 'Tasks', updates, 'TaskID', task.TaskID);
            }
        }
    });
}

function extractFileId(url) {
    if (!url) return null;
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

// ==========================================
// START
// ==========================================
(async () => {
    console.log('🚀 Starting server...');

    // Initial database sync
    await syncDatabase();

    // Start recurring workers
    setInterval(syncDatabase, 5000);
    setInterval(checkRecurringTasks, 60000);

    app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
})();
