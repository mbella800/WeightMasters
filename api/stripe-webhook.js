const Stripe = require("stripe")

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

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

  const sig = req.headers['stripe-signature']
  let event
  let body

  try {
    if (typeof req.body === 'string') {
      body = Buffer.from(req.body, 'utf8')
    } else if (Buffer.isBuffer(req.body)) {
      body = req.body
    } else {
      body = await getRawBody(req)
    }

    console.log("📨 Raw body length:", body.length)
    console.log("📨 Signature:", sig)

    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    )
    console.log("✅ Email webhook signature verified successfully")
    
  } catch (err) {
    console.error("❌ Error processing webhook:", err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  if (event.type === "checkout.session.completed") {
    console.log("🎯 Processing checkout.session.completed event")
    
    const session = event.data.object
    const metadata = session.metadata || {}
    const customer_email = session.customer_details?.email || ""
    const customer_name = session.customer_details?.name || ""

    console.log("🔍 Session ID:", session.id)
    console.log("🔍 Customer details:", JSON.stringify(session.customer_details, null, 2))
    console.log("🔍 Customer email from session:", customer_email)
    console.log("🔍 Customer name from session:", customer_name)

    if (!customer_email) {
      console.error("❌ No customer email found!")
      return res.status(400).send("No customer email found in session")
    }

    console.log("📧 Final email to send to:", customer_email)

    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(
        session.id,
        { expand: ['data.price.product'] }
      )

      console.log("📦 Retrieved line items:", JSON.stringify(lineItems, null, 2))

      const items = lineItems.data
        .filter(item => {
          const name = item.description || ""
          return !name.includes("Verzendkosten") && !name.includes("Gratis verzending")
        })
        .map(item => {
          const productName = item.description || ""
          const productImage = item.price?.product?.images?.[0] || ""
          const hasDiscount = productName.includes("🎉") && productName.includes("was €")
          
          let originalPrice = item.price.unit_amount / 100
          let discountPercentage = 0
          
          if (hasDiscount) {
            const wasMatch = productName.match(/was €([\d.,]+)/)
            if (wasMatch) {
              originalPrice = parseFloat(wasMatch[1].replace(",", "."))
              discountPercentage = Math.round(((originalPrice - (item.price.unit_amount / 100)) / originalPrice) * 100)
            }
          }

          return {
            productName: productName.replace(/🎉.*$/, "").trim(),
            productImage,
            productPrice: (item.price.unit_amount / 100).toFixed(2),
            originalPrice: originalPrice.toFixed(2),
            hasDiscount,
            discountPercentage,
            itemSavings: hasDiscount ? (originalPrice - (item.price.unit_amount / 100)).toFixed(2) : "0.00",
            quantity: item.quantity,
            totalPrice: ((item.price.unit_amount / 100) * item.quantity).toFixed(2),
            totalOriginalPrice: (originalPrice * item.quantity).toFixed(2)
          }
        })

      const itemsWithDiscount = items.filter(item => item.hasDiscount)

      const emailPayload = {
        sender: {
          name: "Weightmasters",
          email: "mailweightmasters@gmail.com"
        },
        to: [{ 
          email: customer_email,
          name: customer_name || "Klant"
        }],
        templateId: 1,
        params: {
          name: customer_name || "Klant",
          email: customer_email,
          orderId: session.payment_intent,
          subtotal: (session.amount_subtotal / 100).toFixed(2),
          shipping: (session.total_details.amount_shipping / 100).toFixed(2),
          tax: ((session.amount_total - session.amount_subtotal - session.total_details.amount_shipping) / 100).toFixed(2),
          total: (session.amount_total / 100).toFixed(2),
          shopName: "Weightmasters",
          items: items.map(item => ({
            productName: item.productName,
            productPrice: item.productPrice,
            quantity: item.quantity,
            originalPrice: item.hasDiscount ? item.originalPrice : null,
            discountPercentage: item.hasDiscount ? item.discountPercentage : null,
            productImage: item.productImage
          })),
          hasDiscount: itemsWithDiscount.length > 0,
          discountItems: itemsWithDiscount.map(item => ({
            productName: item.productName,
            originalPrice: item.originalPrice,
            newPrice: item.productPrice,
            savedAmount: item.itemSavings,
            discountPercentage: item.discountPercentage
          })),
          totalSaved: itemsWithDiscount.reduce((sum, item) => sum + parseFloat(item.itemSavings), 0).toFixed(2)
        }
      }

      console.log("📧 Sending email to:", customer_email)
      console.log("📤 Email payload:", JSON.stringify(emailPayload, null, 2))

      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(emailPayload)
      })

      console.log("📬 Brevo response status:", response.status)
      const responseText = await response.text()
      console.log("📬 Brevo response:", responseText)

      if (!response.ok) {
        throw new Error(`Failed to send email: ${responseText}`)
      }

      console.log("✅ Email sent successfully to", customer_email)
      return res.status(200).json({ received: true })

    } catch (error) {
      console.error("❌ Error sending email:", error)
      return res.status(500).json({ error: error.message })
    }
  } else {
    console.log("ℹ️ Unhandled event type:", event.type)
    return res.status(200).json({ received: true })
  }
}