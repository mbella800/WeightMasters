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
        minute: '2-digit',
        second: '2-digit'
      }).format(date)
    }

    const formatPrice = (amount) => {
      return `€${amount.toFixed(2)}`.replace('.', ',')
    }

    const row = [
      formatDate(new Date()),  // Datum
      metadata.orderId || session.id,  // Order ID
      customerName,
      customerEmail,
      customerPhone,
      country,
      city,
      postalCode,
      address,
      formatPrice(total),  // Totaalbedrag
      hasAnyDiscount ? formatPrice(totalOriginalValue) : formatPrice(subtotal),  // Originele prijs
      formatPrice(shipping),  // Verzendkosten
      "incl. 21% BTW",  // BTW info
      "✅",  // Order verwerkt
      emailSent ? "✅" : "❌",  // Email status
      session.payment_status === 'paid' ? "✅" : ""  // Betaalstatus
    ]

    console.log("👉 Row contents:", row)

    const sheets = await getGoogleSheetClient()
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: 'Bestellingen!A:P',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [row],
      },
    })

    console.log("✅ Bestelling gelogd in Google Sheet")
    return true
  } catch (error) {
    console.error("❌ Error logging to sheet:", error)
    return false
  }
} 