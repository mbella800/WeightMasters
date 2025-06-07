const row = [
  session.id,
  customerName,
  customerEmail,
  customerPhone,
  country,
  city,
  postalCode,
  address,
  (session.amount_total / 100).toFixed(2),
  (session.amount_subtotal / 100).toFixed(2),
  (session.total_details.amount_shipping / 100).toFixed(2),
  "incl. 21% BTW",
  new Date().toISOString(),
  "✅",
  "✅",
  session.payment_status
] 