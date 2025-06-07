const Stripe = require("stripe")
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const { google } = require('googleapis')

// Webhook secret voor sheet updates
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET_SHEET
if (!WEBHOOK_SECRET) {
  console.error("❌ Missing STRIPE_WEBHOOK_SECRET_SHEET environment variable")
}

exports.config = {
  api: {
    bodyParser: false,
  },
}

// Definieer de headers die we willen gebruiken
const SHEET_HEADERS = [
  "Datum",
  "Order ID",
  "Naam",
  "Email",
  "Telefoon",
  "Land",
  "Stad",
  "Postcode",
  "Adres",
  "Product naam",
  "Aantal",
  "Originele prijs per stuk (incl. BTW)",
  "Huidige prijs per stuk (incl. BTW)",
  "Korting percentage",
  "Besparing per stuk",
  "Totaal originele prijs (incl. BTW)",
  "Totaal huidige prijs (incl. BTW)",
  "Totale besparing",
  "Verzendkosten (incl. BTW)",
  "BTW status",
  "Totaal bestelling (incl. BTW)",
  "Betaalstatus",
  "Email verstuurd"
]

async function getGoogleSheetClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_KEY),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}

// Nieuwe functie om sheet headers te controleren en updaten
async function ensureSheetHeaders(sheets) {
  try {
    // Lees de huidige headers
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.DEFAULT_SHEET_ID,
      range: 'Bestellingen!A1:X1',
    })

    const currentHeaders = response.data.values?.[0] || []
    
    // Als er geen headers zijn of ze zijn anders, update ze
    if (currentHeaders.length === 0 || !arraysEqual(currentHeaders, SHEET_HEADERS)) {
      console.log("📝 Updating sheet headers...")
      
      // Update de headers
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.DEFAULT_SHEET_ID,
        range: 'Bestellingen!A1:X1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [SHEET_HEADERS]
        }
      })

      // Maak de headers vast en pas opmaak toe
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: process.env.DEFAULT_SHEET_ID,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: 0,
                  gridProperties: {
                    frozenRowCount: 1
                  }
                },
                fields: 'gridProperties.frozenRowCount'
              }
            },
            {
              repeatCell: {
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 1
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                    textFormat: { bold: true },
                    horizontalAlignment: 'CENTER'
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
              }
            }
          ]
        }
      })

      console.log("✅ Sheet headers updated successfully")
    } else {
      console.log("✅ Sheet headers are up to date")
    }
  } catch (error) {
    console.error("❌ Error updating sheet headers:", error)
    throw error
  }
}

// Helper functie om arrays te vergelijken
function arraysEqual(a, b) {
  if (a.length !== b.length) return false
  return a.every((val, index) => val === b[index])
}

// Hulpfunctie om raw body te lezen
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// Hulpfunctie om getallen te formatteren
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
    // Alleen checkout.session.completed events verwerken
    if (event.type !== "checkout.session.completed") {
      console.log("⏭️ Skipping non-checkout event:", event.type)
      return { success: true, message: "Non-checkout event skipped" }
    }

    const session = event.data.object
    if (!session || !session.id) {
      throw new Error("Invalid session data received")
    }

    console.log("📦 Processing checkout session:", session.id)

    // Haal line items op van Stripe
    const lineItems = await stripe.checkout.sessions.listLineItems(
      session.id,
      { expand: ['data.price.product'] }
    )

    if (!lineItems || !lineItems.data) {
      throw new Error("No line items found in session")
    }

    // Filter verzendkosten eruit
    const products = lineItems.data.filter(item => 
      !item.description?.toLowerCase().includes('verzend')
    )

    const subtotal = session.amount_subtotal / 100
    const shipping = session.total_details?.amount_shipping / 100 || 0
    const total = session.amount_total / 100

    // Verwerk elk product als een aparte rij voor de sheet
    const rows = products.map(item => {
      const productName = item.description?.replace(/🎉.*$/, "").trim() || ""
      const quantity = item.quantity || 1
      const currentPrice = (item.price.unit_amount || 0) / 100
      const metadata = item.price?.product?.metadata || {}
      
      // Bereken alle prijzen en kortingen
      const originalPrice = metadata.originalPrice ? parseFloat(metadata.originalPrice) : currentPrice
      const hasDiscount = originalPrice > currentPrice
      const discountPercentage = hasDiscount ? 
        Math.round(((originalPrice - currentPrice) / originalPrice) * 100) : 0
      const savingsPerItem = hasDiscount ? (originalPrice - currentPrice) : 0
      const totalSavings = savingsPerItem * quantity
      
      // Bereken totalen
      const totalOriginalPrice = originalPrice * quantity
      const totalCurrentPrice = currentPrice * quantity

      return [
        formatDate(new Date()),                    // Datum
        session.payment_intent || session.id,      // Order ID
        capitalizeWords(session.customer_details?.name || ""),  // Naam
        session.customer_details?.email || "",     // Email
        session.customer_details?.phone || "",     // Telefoon
        session.customer_details?.address?.country || "", // Land
        session.customer_details?.address?.city || "", // Stad
        session.customer_details?.address?.postal_code || "", // Postcode
        `${session.customer_details?.address?.line1 || ""} ${session.customer_details?.address?.line2 || ""}`.trim(), // Adres
        productName,                               // Product naam
        quantity,                                  // Aantal
        formatPrice(originalPrice),                // Originele prijs per stuk (incl. BTW)
        formatPrice(currentPrice),                 // Huidige prijs per stuk (incl. BTW)
        hasDiscount ? `${discountPercentage}%` : "", // Korting percentage
        hasDiscount ? formatPrice(savingsPerItem) : "", // Besparing per stuk
        formatPrice(totalOriginalPrice),           // Totaal originele prijs (incl. BTW)
        formatPrice(totalCurrentPrice),            // Totaal huidige prijs (incl. BTW)
        hasDiscount ? formatPrice(totalSavings) : "", // Totale besparing
        formatPrice(shipping),                     // Verzendkosten (incl. BTW)
        "Inclusief",                              // BTW status
        formatPrice(total),                        // Totaal bestelling (incl. BTW)
        session.payment_status === 'paid' ? "✅" : "❌", // Betaalstatus
        "✅"                                       // Email verstuurd
      ]
    })

    console.log("📊 Preparing to log rows:", rows)

    // Get Google Sheets client
    const sheets = await getGoogleSheetClient()
    
    // Controleer en update headers indien nodig
    await ensureSheetHeaders(sheets)

    // Update de Google Sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.DEFAULT_SHEET_ID,
      range: 'Bestellingen!A:X',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: rows,
      },
    })

    console.log("✅ Order data logged to sheet successfully")
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

    console.log("🔑 Using sheet webhook secret:", WEBHOOK_SECRET ? "Found" : "Missing")
    
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      WEBHOOK_SECRET
    )

    console.log("✅ Sheet webhook signature verified")
    const result = await sheetWebhook(event)
    return res.json(result)

  } catch (err) {
    console.error("❌ Sheet webhook error:", err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }
} 