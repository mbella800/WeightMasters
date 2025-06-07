const Stripe = require("stripe")
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Webhook secret voor email notifications
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
if (!WEBHOOK_SECRET) {
  console.error("❌ Missing STRIPE_WEBHOOK_SECRET environment variable")
}

// ✅ VERCEL-SPECIFIEKE CONFIG
exports.config = {
  api: {
    bodyParser: false,
  },
}

// Hulpfunctie om afzendernaam netjes te maken
function capitalizeWords(str) {
  return str.replace(/\b\w/g, (char) => char.toUpperCase())
}

// ✅ VERCEL-SPECIFIEKE RAW BODY READER
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed")
  }

  let event
  try {
    const rawBody = await getRawBody(req)
    const sig = req.headers['stripe-signature']

    console.log("🔑 Using webhook secret:", WEBHOOK_SECRET ? "Found" : "Missing")
    
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      WEBHOOK_SECRET
    )

    console.log("✅ Email webhook signature verified")

    if (event.type === "checkout.session.completed") {
      const session = event.data.object
      const customer_email = session.customer_details?.email || ""
      const customer_name = session.customer_details?.name || ""

      if (!customer_email) {
        return res.status(400).send("No customer email found in session")
      }

      try {
        const lineItems = await stripe.checkout.sessions.listLineItems(
          session.id,
          { expand: ['data.price.product'] }
        )

        const items = lineItems.data
          .filter(item => !item.description?.toLowerCase().includes('verzend'))
          .map(item => {
            const productName = item.description?.replace(/🎉.*$/, "").trim() || ""
            const productImage = item.price?.product?.images?.[0] || ""
            const metadata = item.price?.product?.metadata || {}
            const currentPrice = item.price.unit_amount / 100
            const originalPrice = metadata.originalPrice ? parseFloat(metadata.originalPrice) : currentPrice
            const hasDiscount = originalPrice > currentPrice
            const discountPercentage = hasDiscount ? 
              Math.round(((originalPrice - currentPrice) / originalPrice) * 100) : 0

            return {
              productName: productName,
              productImage,
              productPrice: currentPrice.toFixed(2),
              originalPrice: originalPrice.toFixed(2),
              hasDiscount,
              discountPercentage,
              itemSavings: hasDiscount ? (originalPrice - currentPrice).toFixed(2) : "0.00",
              quantity: item.quantity,
              totalPrice: (currentPrice * item.quantity).toFixed(2),
              totalOriginalPrice: (originalPrice * item.quantity).toFixed(2)
            }
          })

        const itemsWithDiscount = items.filter(item => item.hasDiscount)
        const subtotal = session.amount_subtotal / 100
        const shipping = session.total_details?.amount_shipping / 100 || 0
        const total = session.amount_total / 100

        const emailPayload = {
          sender: {
            name: "Weightmasters",
            email: "mailweightmasters@gmail.com"
          },
          to: [{ 
            email: customer_email,
            name: customer_name || "Klant"
          }],
          templateId: process.env.BREVO_TEMPLATE_ID,
          params: {
            name: customer_name || "Klant",
            email: customer_email,
            orderId: session.payment_intent,
            subtotal: subtotal.toFixed(2),
            shipping: shipping.toFixed(2),
            tax: "0.00",
            total: total.toFixed(2),
            shopName: "Weightmasters",
            items: items.map(item => ({
              productName: `${item.productName} (incl. BTW)`,
              productImage: item.productImage,
              productPrice: item.productPrice,
              quantity: item.quantity,
              originalPrice: item.hasDiscount ? item.originalPrice : null,
              discountPercentage: item.hasDiscount ? item.discountPercentage : null,
              totalPrice: item.totalPrice,
              totalOriginalPrice: item.hasDiscount ? item.totalOriginalPrice : null
            })),
            hasDiscount: itemsWithDiscount.length > 0,
            discountItems: itemsWithDiscount.map(item => ({
              productName: `${item.productName} (incl. BTW)`,
              originalPrice: item.originalPrice,
              newPrice: item.productPrice,
              savedAmount: item.itemSavings,
              discountPercentage: item.discountPercentage,
              quantity: item.quantity,
              totalSaved: (parseFloat(item.itemSavings) * item.quantity).toFixed(2)
            })),
            totalSaved: itemsWithDiscount.reduce((sum, item) => 
              sum + (parseFloat(item.itemSavings) * item.quantity), 0).toFixed(2),
            shippingInfo: shipping > 0 ? 
              `Verzendkosten (incl. BTW): €${shipping.toFixed(2)}` : 
              "🎉 Gratis verzending"
          }
        }

        const response = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": process.env.BREVO_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify(emailPayload)
        })

        if (!response.ok) {
          throw new Error(`Failed to send email: ${await response.text()}`)
        }

        return res.status(200).json({ received: true })

      } catch (error) {
        console.error("❌ Error sending email:", error)
        return res.status(500).json({ error: error.message })
      }
    }

    return res.status(200).json({ received: true })

  } catch (err) {
    console.error("❌ Webhook error:", err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }
}