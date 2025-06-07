// Get values from metadata and session
const metadata = session.metadata || {}
const hasAnyDiscount = metadata.hasAnyDiscount === "true"
const totalOriginalValue = parseFloat(metadata.totalOriginalValue || 0) / 100
const totalSavedAmount = parseFloat(metadata.totalSavedAmount || 0) / 100

const row = [
  session.id,
  customerName,
  customerEmail,
  customerPhone,
  country,
  city,
  postalCode,
  address,
  `€${(session.amount_total / 100).toFixed(2)}`,  // Totaalbedrag
  hasAnyDiscount ? 
    `€${totalOriginalValue.toFixed(2)} → €${(session.amount_subtotal / 100).toFixed(2)}` :  // Subtotaal met korting
    `€${(session.amount_subtotal / 100).toFixed(2)}`,  // Subtotaal zonder korting
  `€${(session.total_details.amount_shipping / 100).toFixed(2)}`,  // Verzendkosten
  "Prijzen zijn inclusief 21% BTW",  // BTW duidelijker vermeld
  new Date().toISOString(),
  emailSent ? "✅" : "❌",  // Email status alleen ✅ als echt verzonden
  "✅",  // Order verwerkt
  session.payment_status
] 