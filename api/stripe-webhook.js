import Stripe from "stripe"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// ✅ VERCEL-SPECIFIEKE CONFIG
export const config = {
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
    req.on('data', (chunk) => {
      chunks.push(chunk)
    })
    req.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed")
  }

  // ✅ STRIPE SIGNATURE UIT HEADERS
  const sig = req.headers['stripe-signature']

  let body
  let event

  try {
    // ✅ PROBEER VERSCHILLENDE MANIEREN OM RAW BODY TE KRIJGEN
    if (typeof req.body === 'string') {
      // Body is al een string - gebruik die
      body = Buffer.from(req.body, 'utf8')
    } else if (Buffer.isBuffer(req.body)) {
      // Body is al een buffer
      body = req.body
    } else {
      // Lees de raw body rechtstreeks van de request
      body = await getRawBody(req)
    }

    console.log("📨 Raw body length:", body.length)
    console.log("📨 Signature:", sig)

    // ✅ SIGNATURE VERIFICATIE MET JUISTE SECRET
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET // Changed to correct secret for email webhook
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

    // ✅ DEBUG: LOG HELE SESSION VOOR EMAIL DEBUGGING
    console.log("🔍 Session ID:", session.id)
    console.log("🔍 Customer details:", JSON.stringify(session.customer_details, null, 2))
    console.log("🔍 Customer email from session:", session.customer_details?.email)
    console.log("🔍 Customer name from session:", session.customer_details?.name)

    const customer_email = session.customer_details?.email || ""
    const customer_name = session.customer_details?.name || ""
    const shipping = session.total_details?.amount_shipping || metadata.shippingFee || 0

    if (!customer_email) {
      console.error("❌ GEEN CUSTOMER EMAIL GEVONDEN!")
      console.error("❌ Session object keys:", Object.keys(session))
      console.error("❌ Trying alternative email sources...")
      
      // Probeer andere bronnen voor email
      const altEmail = session.customer?.email || session.receipt_email || ""
      console.log("🔍 Alternative email sources:", {
        customer_email: session.customer?.email,
        receipt_email: session.receipt_email
      })
      
      if (!altEmail) {
        return res.status(400).send("No customer email found in session")
      }
    }

    console.log("📧 Final email to send to:", customer_email || "NO EMAIL FOUND")

    // ✅ DISCOUNT INFORMATIE UIT METADATA
    const totalOriginalValue = parseFloat(metadata.totalOriginalValue || 0) / 100
    const totalSavedAmount = parseFloat(metadata.totalSavedAmount || 0) / 100
    const totalDiscountPercentage = parseInt(metadata.totalDiscountPercentage || 0)
    const hasAnyDiscount = metadata.hasAnyDiscount === "true"

    let items = []
    let itemsWithDiscount = []

    try {
      // ✅ KRIJG ITEMS UIT STRIPE LINE_ITEMS IN PLAATS VAN METADATA
      const lineItems = session.line_items.data.map(item => ({
        productName: item.description,
        productImage: item.price?.product?.images?.[0] || "",
        productPrice: (item.price.unit_amount / 100).toFixed(2),
        originalPrice: item.price.unit_amount_original ? 
          (item.price.unit_amount_original / 100).toFixed(2) : 
          (item.price.unit_amount / 100).toFixed(2),
        hasDiscount: item.price.unit_amount_original ? true : false,
        discountPercentage: item.price.unit_amount_original ? 
          Math.round(((item.price.unit_amount_original - item.price.unit_amount) / item.price.unit_amount_original) * 100) : 0,
        itemSavings: item.price.unit_amount_original ? 
          ((item.price.unit_amount_original - item.price.unit_amount) / 100).toFixed(2) : "0.00",
        quantity: item.quantity,
        totalPrice: ((item.price.unit_amount * item.quantity) / 100).toFixed(2),
        totalOriginalPrice: item.price.unit_amount_original ? 
          ((item.price.unit_amount_original * item.quantity) / 100).toFixed(2) : 
          ((item.price.unit_amount * item.quantity) / 100).toFixed(2)
      }))

      // Filter out items with actual discounts for the discount summary
      itemsWithDiscount = lineItems.filter(item => item.hasDiscount)
      
    } catch (err) {
      console.error("❌ Kon line items niet ophalen:", err.message)
      
      // ✅ FALLBACK: simpele items uit productNames metadata
      try {
        const productNames = metadata.productNames || ""
        if (productNames) {
          const names = productNames.split(", ")
          items = names.map(name => ({
            productName: name,
            productImage: "",
            productPrice: "0.00",
            originalPrice: "0.00",
            hasDiscount: false,
            discountPercentage: 0,
            itemSavings: "0.00",
            quantity: 1,
            totalPrice: "0.00",
            totalOriginalPrice: "0.00",
          }))
        }
      } catch (fallbackErr) {
        console.error("❌ Fallback parsing ook gefaald:", fallbackErr.message)
      }
    }

    // ❌ Reduce items array for email payload to max 10 to avoid huge Brevo params
    const MAX_ITEMS_EMAIL = 10
    const itemsForEmail = items.slice(0, MAX_ITEMS_EMAIL)

    // ❌ Reduce discount items array too
    const itemsWithDiscountForEmail = itemsWithDiscount.slice(0, MAX_ITEMS_EMAIL)

    // Build params without heavy images to keep payload light
    const paramsForEmail = {
      name: customer_name,
      email: customer_email,
      orderId: session.payment_intent,
      subtotal: (parseFloat(metadata.subtotal) / 100).toFixed(2),
      shipping: (parseFloat(shipping) / 100).toFixed(2),
      tax: "incl. 21% BTW", // Updated to show included VAT
      total: (session.amount_total / 100).toFixed(2),
      shopName: capitalizeWords((metadata.checkoutSlug || "Webshop").replace(/-/g, " ")),

      // Discount summary
      hasAnyDiscount,
      totalOriginalValue: totalOriginalValue.toFixed(2),
      totalSavedAmount: totalSavedAmount.toFixed(2),
      totalDiscountPercentage,

      // Items for Brevo template (max 10)
      items: itemsForEmail,
      itemsWithDiscount: itemsWithDiscountForEmail,

      // Helpful extra strings
      savingsText: hasAnyDiscount ? `Je totale besparing: €${totalSavedAmount.toFixed(2)}` : "",
      discountSummary: hasAnyDiscount ? `${totalDiscountPercentage}% korting - €${totalSavedAmount.toFixed(2)} bespaard!` : "",
    }

    const emailPayload = {
      sender: {
        name: paramsForEmail.shopName,
        email: "mailweightmasters@gmail.com",
      },
      replyTo: {
        name: paramsForEmail.shopName,
        email: "mailweightmasters@gmail.com",
      },
      to: [{ email: paramsForEmail.email, name: paramsForEmail.name }],
      templateId: 1,
      params: paramsForEmail,
    }

    console.log("📧 Sending email to:", customer_email)

    try {
      console.log("📤 Email payload:", JSON.stringify(emailPayload, null, 2))
      console.log("🔑 Brevo API Key:", process.env.BREVO_API_KEY ? "SET" : "NOT SET")
      console.log("🆔 Brevo Template ID:", process.env.BREVO_TEMPLATE_ID)

      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailPayload),
      })

      console.log("📬 Brevo response status:", response.status)
      console.log("📬 Brevo response headers:", JSON.stringify([...response.headers.entries()]))

      if (!response.ok) {
        const errorText = await response.text()
        console.error("❌ Brevo response fout:", response.status, errorText)
        console.error("❌ Full response:", response)
      } else {
        const responseData = await response.text()
        console.log("✅ Brevo response success:", responseData)
        console.log("✅ Bevestigingsmail verzonden naar", paramsForEmail.email)
        // ✅ DEBUG: Log discount info
        if (hasAnyDiscount) {
          console.log(`💰 Korting verwerkt: ${totalDiscountPercentage}% (€${totalSavedAmount.toFixed(2)} bespaard)`)
        }
      }
    } catch (err) {
      console.error("❌ Fout bij verzenden mail via Brevo:", err.message)
      console.error("❌ Full error:", err)
    }
  } else {
    console.log(`ℹ️ Unhandled event type: ${event.type}`)
  }

  res.status(200).json({ received: true })
}