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

async function sheetWebhook(event) {
  try {
    if (event.type !== "checkout.session.completed") {
      return { success: true, message: "Non-checkout event skipped" }
    }

    const session = event.data.object
    if (!session || !session.id) {
      throw new Error("Invalid session data received")
    }

    const lineItems = await stripe.checkout.sessions.listLineItems(
      session.id,
      { expand: ['data.price.product'] }
    )

    if (!lineItems || !lineItems.data) {
      throw new Error("No line items found in session")
    }

    const products = lineItems.data.filter(item => 
      !item.description?.toLowerCase().includes('verzend')
    )

    const subtotal = session.amount_subtotal / 100
    const shipping = session.total_details?.amount_shipping / 100 || 0
    const total = session.amount_total / 100

    const rows = products.map(item => {
      const productName = item.description?.replace(/🎉.*$/, "").trim() || ""
      const quantity = item.quantity || 1
      const currentPrice = (item.price.unit_amount || 0) / 100
      const metadata = item.price?.product?.metadata || {}
      
      const originalPrice = metadata.originalPrice ? parseFloat(metadata.originalPrice) : currentPrice
      const hasDiscount = originalPrice > currentPrice
      const discountPercentage = hasDiscount ? 
        Math.round(((originalPrice - currentPrice) / originalPrice) * 100) : 0
      const savingsPerItem = hasDiscount ? (originalPrice - currentPrice) : 0
      const totalSavings = savingsPerItem * quantity
      
      const totalOriginalPrice = originalPrice * quantity
      const totalCurrentPrice = currentPrice * quantity

      return [
        formatDate(new Date()),
        session.payment_intent || session.id,
        capitalizeWords(session.customer_details?.name || ""),
        session.customer_details?.email || "",
        session.customer_details?.phone || "",
        session.customer_details?.address?.country || "",
        session.customer_details?.address?.city || "",
        session.customer_details?.address?.postal_code || "",
        `${session.customer_details?.address?.line1 || ""} ${session.customer_details?.address?.line2 || ""}`.trim(),
        formatPrice(total),
        formatPrice(subtotal),
        formatPrice(shipping),
        hasDiscount ? `${discountPercentage}%` : "incl. 21% BTW",
        "✅",
        "✅",
        session.payment_status,
        "",
        "postnl",
        productName,
        quantity,
        formatPrice(currentPrice),
        formatPrice(totalCurrentPrice),
        hasDiscount ? formatPrice(savingsPerItem) : "",
        hasDiscount ? formatPrice(totalSavings) : ""
      ]
    })

    const sheets = await getGoogleSheetClient()
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.DEFAULT_SHEET_ID || "1GO9yTvqVebtBMhn3o1sKY-Hcz_d067Zj8P4RQj--bwo",
      range: 'Bestellingen!A:X',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: rows,
      },
    })

    console.log("✅ Order succesvol gelogd in Google Sheet")
    return { success: true, message: "Order logged to sheet" }

  } catch (error) {
    console.error("❌ Error processing webhook:", error)
    throw error
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed")
  }

  let event
  try {
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