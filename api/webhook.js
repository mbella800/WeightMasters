const { google } = require('googleapis')

async function getGoogleSheetClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}

module.exports = async function sheetWebhook(session, customerName, customerEmail, customerPhone, country, city, postalCode, address, emailSent) {
  try {
    // Get values from metadata and session
    const metadata = session.metadata || {}
    const hasAnyDiscount = metadata.hasAnyDiscount === "true"
    const totalOriginalValue = parseFloat(metadata.totalOriginalValue || 0) / 100
    const totalSavedAmount = parseFloat(metadata.totalSavedAmount || 0) / 100
    const totalDiscountPercentage = parseInt(metadata.totalDiscountPercentage || 0)
    const subtotal = session.amount_subtotal / 100
    const shipping = session.total_details?.amount_shipping / 100 || 0
    const total = session.amount_total / 100
    const btw = (total - shipping) * 0.21 // BTW is 21% over subtotaal

    const formatDate = (date) => {
      return new Intl.DateTimeFormat('nl-NL', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date)
    }

    const formatPrice = (amount) => {
      return `€${amount.toFixed(2)}`.replace('.', ',')
    }

    const formatPercentage = (percentage) => {
      return percentage ? `${percentage}%` : ""
    }

    // Get line items for product details
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { expand: ['data.price.product'] })
    const items = lineItems.data.filter(item => !item.description.includes("Verzendkosten"))
    
    // Process all items and create rows for each
    const rows = items.map(item => {
      const productName = item.description?.replace(/🎉.*$/, "").trim() || ""
      const quantity = item.quantity || 1
      const currentPrice = (item.price.unit_amount || 0) / 100
      const metadata = item.price?.product?.metadata || {}
      const originalPrice = metadata.originalPrice ? parseFloat(metadata.originalPrice) : currentPrice
      const hasDiscount = originalPrice > currentPrice
      const discountPercentage = hasDiscount ? 
        Math.round(((originalPrice - currentPrice) / originalPrice) * 100) : 0
      const savings = hasDiscount ? (originalPrice - currentPrice) : 0
      
      return [
        formatDate(new Date()),                    // Datum
        session.id.slice(0, 8),                    // Order ID (verkort)
        capitalizeWords(customerName),             // Naam
        customerEmail,                             // Email
        customerPhone,                             // Telefoon
        country,                                   // Land
        city,                                      // Stad
        postalCode,                                // Postcode
        address,                                   // Adres
        productName,                               // Product
        quantity,                                  // Aantal
        formatPrice(originalPrice),                // Originele prijs
        hasDiscount ? formatPrice(currentPrice) : "",  // Prijs na korting
        hasDiscount ? `${discountPercentage}%` : "",  // Korting %
        hasDiscount ? formatPrice(savings) : "",   // Besparing per item
        formatPrice(shipping),                     // Verzendkosten
        "incl. 21% BTW",                          // BTW info
        formatPrice(total),                        // Totaal
        session.payment_status === 'paid' ? "✅" : "",  // Betaalstatus
        emailSent ? "✅" : "❌"                    // Email status
      ]
    })

    console.log("👉 Row contents:", rows)

    const sheets = await getGoogleSheetClient()

    // Update the sheet with multiple rows
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: 'Bestellingen!A:T',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: rows,
      },
    })

    console.log("✅ Bestellingen gelogd in Google Sheet")
    return true
  } catch (error) {
    console.error("❌ Error logging to sheet:", error)
    return false
  }
} 