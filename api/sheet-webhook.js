// Get values from metadata and session
const metadata = session.metadata || {}
const hasAnyDiscount = metadata.hasAnyDiscount === "true"
const totalOriginalValue = parseFloat(metadata.totalOriginalValue || 0) / 100
const totalSavedAmount = parseFloat(metadata.totalSavedAmount || 0) / 100

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
  `€${(session.amount_total / 100).toFixed(2)}`.replace('.', ','),  // Totaalbedrag
  hasAnyDiscount ? 
    `€${totalOriginalValue.toFixed(2)}`.replace('.', ',') :  // Originele prijs
    `€${(session.amount_subtotal / 100).toFixed(2)}`.replace('.', ','),  // Prijs zonder korting
  `€${(session.total_details.amount_shipping / 100).toFixed(2)}`.replace('.', ','),  // Verzendkosten
  "Prijzen zijn inclusief 21% BTW",  // BTW vermelding
  "✅",  // Order verwerkt
  emailSent ? "✅" : "❌",  // Email status
  session.payment_status  // Betaalstatus
] 