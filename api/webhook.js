const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const { google } = require('googleapis')

// Webhook secret voor sheet notifications
const WEBHOOK_SECRET_SHEET = process.env.STRIPE_WEBHOOK_SECRET_SHEET
if (!WEBHOOK_SECRET_SHEET) {
  console.error("❌ Missing STRIPE_WEBHOOK_SECRET_SHEET environment variable")
}

exports.config = {
  api: {
    bodyParser: false,
  },
}

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

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function formatPrice(amount) {
  return `€${Number(amount).toFixed(2)}`.replace('.', ',')
}

function formatDate(date) {
  return new Intl.DateTimeFormat('nl-NL', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function capitalizeWords(str) {
  return str?.split(' ').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ') || ""
}

function calculateOrderTotals(session) {
  return {
    subtotal: session.amount_subtotal / 100,
    shipping: session.total_details?.amount_shipping / 100 || 0,
    total: session.amount_total / 100
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
    'Totale besparing'
  ]

  try {
    // First get the spreadsheet metadata to get the correct sheet ID
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: process.env.DEFAULT_SHEET_ID
    });
    
    const sheet = spreadsheet.data.sheets[0];
    const sheetId = sheet.properties.sheetId;

    // Check if headers already exist
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.DEFAULT_SHEET_ID,
      range: 'Bestellingen!A1:U1',
    });

    if (!response.data.values || response.data.values[0].join(',') !== headers.join(',')) {
      // Only set headers if they don't exist or are different
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.DEFAULT_SHEET_ID,
        range: 'Bestellingen!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [headers]
        }
      });

      // Format headers
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
    }
  } catch (error) {
    console.error('Error initializing sheet:', error);
  }
}

async function resetSheet(sheets) {
  try {
    // Clear all content except headers
    await sheets.spreadsheets.values.clear({
      spreadsheetId: process.env.DEFAULT_SHEET_ID,
      range: 'Bestellingen!A2:U',
    });
    console.log('Sheet reset successful');
  } catch (error) {
    console.error('Error resetting sheet:', error);
  }
}

async function sheetWebhook(event) {
  try {
    const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
      expand: ['line_items.data.price.product', 'customer']
    });

    const sheets = await getGoogleSheetClient();
    
    // Reset sheet if needed (uncomment next line to reset)
    await resetSheet(sheets);
    
    // Initialize sheet if needed (only sets headers if they don't exist)
    await initializeSheet(sheets);

    const { shipping, subtotal, total } = calculateOrderTotals(session);
    const products = session.line_items.data;

    // Calculate total savings and format product list
    let totalSavings = 0;
    const formattedProducts = products.map(item => {
      const productName = item.description?.replace(/🎉.*$/, "").trim() || "";
      const quantity = item.quantity || 1;
      const currentPrice = (item.price.unit_amount || 0) / 100;
      const metadata = item.price?.product?.metadata || {};
      
      const originalPrice = metadata.originalPrice ? parseFloat(metadata.originalPrice) : currentPrice;
      const hasDiscount = originalPrice > currentPrice;
      const savingsPerItem = hasDiscount ? (originalPrice - currentPrice) : 0;
      const itemTotalSavings = savingsPerItem * quantity;

      totalSavings += itemTotalSavings;

      return `${productName} (${quantity}x ${formatPrice(currentPrice)}${hasDiscount ? `, besparing: ${formatPrice(savingsPerItem)} p/s` : ''})`;
    }).join(', ');

    // Calculate highest discount percentage
    const maxDiscount = products.reduce((max, item) => {
      const currentPrice = (item.price.unit_amount || 0) / 100;
      const metadata = item.price?.product?.metadata || {};
      const originalPrice = metadata.originalPrice ? parseFloat(metadata.originalPrice) : currentPrice;
      const discountPercentage = originalPrice > currentPrice ? 
        Math.round(((originalPrice - currentPrice) / originalPrice) * 100) : 0;
      return Math.max(max, discountPercentage);
    }, 0);

    const row = [
      formatDate(new Date()),                    // Datum
      session.payment_intent || session.id,       // Order ID
      capitalizeWords(session.customer_details?.name || ""), // Naam
      session.customer_details?.email || "",      // Email
      session.customer_details?.phone || "",      // Telefoon
      session.customer_details?.address?.country || "", // Land
      session.customer_details?.address?.city || "", // Stad
      session.customer_details?.address?.postal_code || "", // Postcode
      `${session.customer_details?.address?.line1 || ""} ${session.customer_details?.address?.line2 || ""}`.trim(), // Adres
      formatPrice(total),                         // Totaalbedrag
      formatPrice(subtotal),                      // Subtotaal
      formatPrice(shipping),                      // Verzendkosten
      "21%",                                      // BTW
      maxDiscount > 0 ? `${maxDiscount}%` : "",  // Korting %
      "✅",                                       // Order verwerkt
      "✅",                                       // Email verstuurd
      session.payment_status,                     // Betaalstatus
      "",                                         // Track & Trace
      "postnl",                                  // Verzendmethode
      formattedProducts,                         // Producten
      totalSavings > 0 ? formatPrice(totalSavings) : "" // Totale besparing
    ];

    // Append the order
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.DEFAULT_SHEET_ID,
      range: 'Bestellingen!A:U',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [row]
      }
    });

    return true;
  } catch (error) {
    console.error('Error in sheetWebhook:', error);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader('Allow', 'POST')
    res.status(405).end('Method Not Allowed')
    return
  }

  let event
  try {
    const sheets = await getGoogleSheetClient()
    
    // Initialize the sheet with headers
    await initializeSheet(sheets)

    const rawBody = await getRawBody(req)
    const sig = req.headers['stripe-signature']
    const secret = process.env.STRIPE_WEBHOOK_SECRET_SHEET

    console.log("🔍 Verifying sheet webhook signature...")
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      secret
    )
    console.log("✅ Sheet webhook signature verified")

    const result = await sheetWebhook(event)
    return res.json(result)

  } catch (err) {
    console.error("❌ Webhook error:", err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }
} 