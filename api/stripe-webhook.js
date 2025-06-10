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

      const items = session.line_items.data.map(item => {
        const quantity = item.quantity || 1;
        const unitPrice = (item.price.unit_amount || 0) / 100;
        const totalPrice = unitPrice * quantity;
        
        return {
          productName: item.description?.replace(/🎉.*$/, "").trim() || "",
          quantity: quantity,
          unitPrice: unitPrice,
          totalPrice: totalPrice,
          discountPercentage: item.price?.product?.metadata?.discountPercentage || null,
          totalSaved: item.price?.product?.metadata?.totalSaved || null
        };
      });

      const customer_email = session.customer_details?.email || ""
      const customer_name = session.customer_details?.name || ""

      if (!customer_email) {
        return res.status(400).send("No customer email found in session")
      }

      try {
        const subtotal = session.amount_subtotal / 100
        const shipping = session.total_details?.amount_shipping / 100 || 0
        const total = session.amount_total / 100

        const emailPayload = {
          sender: {
            name: "WeightMasters",
            email: process.env.BREVO_FROM_EMAIL
          },
          to: [{
            email: customer_email,
            name: customer_name
          }],
          templateId: parseInt(process.env.BREVO_TEMPLATE_ID),
          params: {
            customerName: customer_name,
            orderItems: items,
            subtotal: subtotal / 100,
            shipping: shipping / 100,
            total: total / 100,
            orderId: session.id
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