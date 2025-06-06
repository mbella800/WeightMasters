const { json } = require("micro")
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)

function generateOrderId() {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 9000 + 1000)
  return `WM-${year}-${random}`
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") return res.status(204).end()
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed")

  try {
    const data = await json(req)
    const items = data.items || []
    const shippingMethod = data.shippingMethod || "postnl"
    const checkoutSlug = data.checkoutSlug

    if (!checkoutSlug) throw new Error("checkoutSlug ontbreekt in request")

    let subtotal = 0
    const line_items = []

    for (const item of items) {
      const quantity = item.quantity || 1
      const unitAmount = Math.round(Number(item["Product Price"] || item.productPrice || 0) * 100)
      if (isNaN(unitAmount)) throw new Error("unitAmount is geen geldig getal")
      subtotal += unitAmount * quantity

      line_items.push({
        price_data: {
          currency: "eur",
          product_data: {
            name: item["Product Name"] || item.title || "Product",
            images: [item["Product Image"] || item["ProductImage"]].filter(Boolean),
          },
          unit_amount: unitAmount,
        },
        quantity,
      })
    }

    const tax = Math.round(subtotal * 0.21)

    const shippingFees = {
      postnl: 500,
      dhl: 600,
      ophalen: 0,
    }
    const shippingFee = shippingFees[shippingMethod] ?? 500

    if (tax > 0) {
      line_items.push({
        price_data: {
          currency: "eur",
          product_data: { name: "BTW (21%)" },
          unit_amount: tax,
        },
        quantity: 1,
      })
    }

    if (shippingFee > 0) {
      line_items.push({
        price_data: {
          currency: "eur",
          product_data: { name: `Verzendkosten - ${shippingMethod.toUpperCase()}` },
          unit_amount: shippingFee,
        },
        quantity: 1,
      })
    }

    const orderId = generateOrderId()

    const metadata = {
      orderId,
      checkoutSlug,
      shippingMethod,
      subtotal: subtotal.toString(),
      tax: tax.toString(),
      shippingFee: shippingFee.toString(),
      total: (subtotal + tax + shippingFee).toString(),
      items: JSON.stringify(items),
    }

    const origin = req.headers.origin || "https://example.com"

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card", "ideal"],
      mode: "payment",
      line_items,
      success_url: `${origin}/nl/bedankt?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/order-mislukt`,
      metadata,
      shipping_address_collection: {
        allowed_countries: ["NL", "BE"],
      },
      phone_number_collection: {
        enabled: true,
      },
      customer_email: data.email || undefined,
    })

    res.status(200).json({ id: session.id, url: session.url })
  } catch (err) {
    console.error("Checkout fout:", err)
    res.status(500).end("Internal Server Error")
  }
}
