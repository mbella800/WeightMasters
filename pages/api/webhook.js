const calculateShippingCost = (items) => {
  // Calculate total weight
  const totalWeight = items.reduce((total, item) => {
    const weight = parseFloat(item.price?.product?.metadata?.weight || 0);
    return total + (weight * item.quantity);
  }, 0);

  // Shipping cost calculation based on weight
  if (totalWeight <= 0) return 0;
  if (totalWeight <= 2) return 4.95;
  if (totalWeight <= 5) return 5.95;
  if (totalWeight <= 10) return 6.95;
  if (totalWeight <= 20) return 7.95;
  if (totalWeight <= 30) return 13.95;
  return 19.95; // Above 30kg
}

const lineItems = await stripe.checkout.sessions.listLineItems(
  session.id,
  { expand: ['data.price.product'] }
);

const items = lineItems.data.filter(item => !item.description?.toLowerCase().includes('verzend'));
const shippingCost = calculateShippingCost(items);

// Add to Google Sheet
const values = [
  [
    new Date().toISOString(),
    session.payment_intent,
    customer_email,
    customer_name,
    items.map(item => `${item.quantity}x ${item.description}`).join(", "),
    (session.amount_subtotal / 100).toFixed(2),
    shippingCost.toFixed(2),
    (session.amount_total / 100).toFixed(2)
  ]
]; 