const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const { google } = require('googleapis')

async function getGoogleSheetClient() {
  try {
    let credentials;
    const serviceKey = process.env.GOOGLE_SERVICE_KEY;
    
    if (!serviceKey) {
      throw new Error("Missing GOOGLE_SERVICE_KEY");
    }

    try {
      // Parse the service key
      credentials = JSON.parse(serviceKey);
      
      // Convert the private key to a proper format
      if (credentials.private_key) {
        credentials.private_key = credentials.private_key
          .replace(/\\n/g, '\n')
          .replace(/\\"/, '"');
      }
    } catch (e) {
      console.error("Failed to parse GOOGLE_SERVICE_KEY:", e);
      throw new Error("Invalid GOOGLE_SERVICE_KEY format");
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    return google.sheets({ version: 'v4', auth });
  } catch (error) {
    console.error("❌ Google Sheets Auth Error:", error);
    throw error;
  }
}

async function initializeSheet(sheets) {
  const headers = [
    'Datum',
    'Order ID',
    'Naam',
    'Email',
    'Telefoon',
    'Land',
    'Stad',
    'Postcode',
    'Adres',
    'Totaalbedrag',
    'Subtotaal',
    'Verzendkosten',
    'BTW',
    'Korting %',
    'Order verwerkt',
    'Email verstuurd',
    'Betaalstatus',
    'Track & Trace',
    'Verzendmethode',
    'Producten',
    'Totaal prijs',
    'Besparing per stuk',
    'Totale besparing'
  ]

  try {
    console.log("🔍 Using sheet ID:", process.env.DEFAULT_SHEET_ID);
    
    // First get the spreadsheet metadata to get the correct sheet ID
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: process.env.DEFAULT_SHEET_ID
    });
    
    const sheet = spreadsheet.data.sheets[0];
    const sheetId = sheet.properties.sheetId;
    console.log("📊 Found sheet ID:", sheetId);

    // Clear all content except headers
    console.log("🗑️ Clearing sheet content...");
    await sheets.spreadsheets.values.clear({
      spreadsheetId: process.env.DEFAULT_SHEET_ID,
      range: 'Bestellingen!A2:W',
    });
    console.log("✅ Sheet content cleared");

    // Set headers
    console.log("📝 Setting headers...");
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.DEFAULT_SHEET_ID,
      range: 'Bestellingen!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [headers]
      }
    });
    console.log("✅ Headers set");

    // Format headers
    console.log("🎨 Formatting headers...");
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: process.env.DEFAULT_SHEET_ID,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: headers.length
              },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true },
                  backgroundColor: {
                    red: 0.9,
                    green: 0.9,
                    blue: 0.9
                  }
                }
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor)'
            }
          },
          {
            updateSheetProperties: {
              properties: {
                sheetId: sheetId,
                gridProperties: {
                  frozenRowCount: 1
                }
              },
              fields: 'gridProperties.frozenRowCount'
            }
          }
        ]
      }
    });
    console.log("✅ Headers formatted");

    console.log("✅ Sheet reset successful");
    return true;
  } catch (error) {
    console.error('❌ Error resetting sheet:', error);
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader('Allow', 'POST')
    res.status(405).end('Method Not Allowed')
    return
  }

  try {
    console.log("🔑 Getting Google Sheets client...");
    const sheets = await getGoogleSheetClient();
    console.log("✅ Got Google Sheets client");
    
    console.log("🔄 Initializing sheet...");
    await initializeSheet(sheets);
    console.log("✅ Sheet initialized");
    
    res.status(200).json({ 
      success: true, 
      message: "Sheet reset successful",
      sheetId: process.env.DEFAULT_SHEET_ID
    });
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: error.stack
    });
  }
}
