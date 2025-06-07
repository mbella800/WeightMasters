const row = [
  session.id,
  customerName,
  customerEmail,
  customerPhone,
  country,
  city,
  postalCode,
  address,
  `€${(session.amount_total / 100).toFixed(2)}`,
  hasAnyDiscount ? 
    `€${totalOriginalValue.toFixed(2)} → €${(session.amount_subtotal / 100).toFixed(2)}` : 
    `€${(session.amount_subtotal / 100).toFixed(2)}`,
  `€${(session.total_details.amount_shipping / 100).toFixed(2)}`,
  "Prijzen zijn inclusief 21% BTW",
  new Date().toISOString(),
  emailSent ? "✅" : "❌",
  "✅",
  session.payment_status
] 