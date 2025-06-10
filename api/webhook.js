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
    'Totaal prijs',
    'Besparing per stuk',
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
      range: 'Bestellingen!A1:W1',
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
      range: 'Bestellingen!A2:W',
    });
    console.log('Sheet reset successful');
  } catch (error) {
    console.error('Error resetting sheet:', error);
  }
}

const calculateShippingCost = (items) => {
  // Calculate total weight
  const totalWeight = items.reduce((total, item) => {
    const weight = parseFloat(item.price?.product?.metadata?.weight || 0);
    return total + (weight * item.quantity);
  }, 0);

  // Shipping cost calculation based on weight in grams
  if (totalWeight <= 20) return 1.00; // €1,00 briefpost
  if (totalWeight <= 50) return 2.00; // €2,00
  if (totalWeight <= 500) return 4.10; // €4,10 brievenbuspakje
  if (totalWeight <= 2000) return 6.95; // €6,95 standaard pakket
  return 9.95; // €9,95 zwaar pakket (>2000g)
};

async function sheetWebhook(event, res) {
  if (event.type === "checkout.session.completed") {
    try {
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
        expand: ['line_items.data.price.product']
      });

      const sheets = await getGoogleSheetClient();
      
      // Initialize sheet if needed (only sets headers if they don't exist)
      await initializeSheet(sheets);

      const { shipping, subtotal, total } = calculateOrderTotals(session);
      const products = session.line_items.data;

      // Calculate total savings and format product list
      let totalSavings = 0;
      let maxSavingsPerItem = 0;
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
        if (savingsPerItem > maxSavingsPerItem) {
          maxSavingsPerItem = savingsPerItem;
        }

        return `${productName} (${quantity}x ${formatPrice(currentPrice)})`;
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

      const customer_email = session.customer_details?.email || "";
      const customer_name = session.customer_details?.name || "";
      const shippingAmount = session.total_details?.amount_shipping || 0;

      const lineItems = await stripe.checkout.sessions.listLineItems(
        session.id,
        { expand: ['data.price.product'] }
      );

      const items = lineItems.data.filter(item => !item.description?.toLowerCase().includes('verzend'));

      // Add to Google Sheet
      const values = [
        [
          new Date().toISOString(),
          session.payment_intent,
          customer_email,
          customer_name,
          items.map(item => `${item.quantity}x ${item.description}`).join(", "),
          (session.amount_subtotal / 100).toFixed(2),
          (shippingAmount / 100).toFixed(2),
          (session.amount_total / 100).toFixed(2)
        ]
      ];

      console.log('📝 Adding order to Google Sheet...');
      console.log('Values to be added:', values);
      console.log('Shipping amount from session:', (shippingAmount / 100).toFixed(2));

      const result = await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.DEFAULT_SHEET_ID,
        range: 'Bestellingen!A:H',
        valueInputOption: 'USER_ENTERED',
        resource: { values },
      });

      console.log('✅ Order added to Google Sheet successfully');
      return {
        statusCode: 200,
        body: JSON.stringify({
          received: true,
          message: "Order processed successfully"
        })
      };

    } catch (error) {
      console.error('❌ Error processing order:', error);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: {
            message: error.message
          }
        })
      };
    }
  }

  return {
    statusCode: 400,
    body: JSON.stringify({
      error: {
        message: 'Unhandled event type'
      }
    })
  };
}

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    const sig = req.headers['stripe-signature'];
    console.log('🔍 Verifying sheet webhook signature...');

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      console.log('✅ Sheet webhook signature verified');
      const result = await sheetWebhook(event, res);
      
      if (result.statusCode === 200) {
        res.status(200).json(JSON.parse(result.body));
      } else {
        res.status(result.statusCode).json(JSON.parse(result.body));
      }
    } catch (err) {
      console.error('❌ Webhook error:', err.message);
      res.status(400).json({
        error: {
          message: err.message
        }
      });
    }
  } else {
    res.setHeader('Allow', 'POST');
    res.status(405).end('Method Not Allowed');
  }
}; 