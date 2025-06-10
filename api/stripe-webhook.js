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

// Hulpfunctie om raw body te lezen
async function getRawBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const calculateShippingCost = (items) => {
  // Calculate total weight
  const totalWeight = items.reduce((total, item) => {
    const weight = parseFloat(item.price?.product?.metadata?.weight || 0);
    return total + (weight * item.quantity);
  }, 0);

  // Shipping cost calculation based on weight in grams
  if (totalWeight <= 20) return 100; // €1,00 briefpost
  if (totalWeight <= 50) return 200; // €2,00
  if (totalWeight <= 500) return 410; // €4,10 brievenbuspakje
  if (totalWeight <= 2000) return 695; // €6,95 standaard pakket
  return 995; // €9,95 zwaar pakket (>2000g)
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed")
  }

  let event
  try {
    const rawBody = await getRawBody(req)
    const sig = req.headers['stripe-signature']

    console.log("🔍 Verifying email webhook signature...")
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    )
    console.log("✅ Email webhook signature verified")

    if (event.type === "checkout.session.completed") {
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
        expand: ['line_items']
      });

      if (!session.line_items) {
        throw new Error("No line items found in session");
      }

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
            productName,
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
      const subtotal = session.amount_subtotal
      const shippingAmount = session.total_details?.amount_shipping || 0
      const total = session.amount_total

      const customer_email = session.customer_details?.email || ""
      const customer_name = session.customer_details?.name || ""

      if (!customer_email) {
        return res.status(400).send("No customer email found in session")
      }

      try {
        console.log('💰 Order details:', {
          subtotal: (subtotal / 100).toFixed(2),
          shipping: (shippingAmount / 100).toFixed(2),
          total: (total / 100).toFixed(2)
        });

        const emailPayload = {
          sender: {
            name: "Weightmasters",
            email: "mailweightmasters@gmail.com"
          },
          to: [{
            email: customer_email,
            name: customer_name || "Klant"
          }],
          templateId: parseInt(process.env.BREVO_TEMPLATE_ID),
          params: {
            name: capitalizeWords(customer_name) || "Klant",
            email: customer_email,
            orderId: session.payment_intent,
            subtotal: (subtotal / 100).toFixed(2),
            shipping: (shippingAmount / 100).toFixed(2),
            tax: "0.00",
            total: (total / 100).toFixed(2),
            shopName: "Weightmasters",
            items: items.map(item => ({
              productName: item.productName.replace(' (incl. BTW)', ''),
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
              productName: item.productName.replace(' (incl. BTW)', ''),
              originalPrice: item.originalPrice,
              newPrice: item.productPrice,
              savedAmount: item.itemSavings,
              discountPercentage: item.discountPercentage,
              quantity: item.quantity,
              totalSaved: (parseFloat(item.itemSavings) * item.quantity).toFixed(2)
            })),
            totalSaved: itemsWithDiscount.reduce((sum, item) => 
              sum + (parseFloat(item.itemSavings) * item.quantity), 0).toFixed(2),
            shippingInfo: shippingAmount === 0 ? 
              "🎉 Gratis verzending" : 
              `Verzendkosten (incl. BTW): €${(shippingAmount / 100).toFixed(2)}`
          }
        }

        console.log("📧 Sending order confirmation email...")
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
          const errorText = await response.text()
          console.error("❌ Brevo API error response:", errorText)
          throw new Error(`Failed to send email: ${errorText}`)
        }

        console.log("✅ Order confirmation email sent successfully")

        // Find shipping line item
        const shippingLineItem = session.line_items.data.find(item => 
          item.price.product.metadata.isShipping === "true"
        );
        const shippingCost = shippingLineItem ? shippingLineItem.amount_total / 100 : 0;

        // Add row to sheet
        await appendToSheet([
          new Date().toISOString(),
          session.customer_details.email,
          session.customer_details.name,
          session.customer_details.address.line1,
          session.customer_details.address.postal_code,
          session.customer_details.address.city,
          session.customer_details.phone || "",
          subtotalBeforeShipping / 100,
          shippingCost, // Add shipping cost to sheet
          totalAmount / 100,
          session.payment_status,
          session.id,
          productDetails
        ]);

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