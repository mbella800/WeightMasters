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
    req.on('data', (chunk) => {
      chunks.push(chunk)
    })
    req.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

exports.handler = async function handler(req, res) {
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
      // ✅ KRIJG ITEMS UIT STRIPE SESSION
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
          
          // Extract original price from product name if discounted
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

      // Filter out items with actual discounts for the discount summary
      itemsWithDiscount = items.filter(item => item.hasDiscount)
      
    } catch (err) {
      console.error("❌ Kon line items niet ophalen:", err.message)
      console.error("❌ Full error:", err)
      
      // Fallback to using metadata
      const productNames = metadata.productNames || ""
      items = []
      if (productNames) {
        items = [{
          productName: productNames.split(", ")[0],
          productImage: "",
          productPrice: (session.amount_subtotal / 100).toFixed(2),
          originalPrice: totalOriginalValue.toFixed(2),
          hasDiscount: hasAnyDiscount,
          discountPercentage: totalDiscountPercentage,
          itemSavings: totalSavedAmount.toFixed(2),
          quantity: 1,
          totalPrice: (session.amount_subtotal / 100).toFixed(2),
          totalOriginalPrice: totalOriginalValue.toFixed(2)
        }]
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
        name: "Weightmasters",
        email: "mailweightmasters@gmail.com"
      },
      replyTo: {
        name: "Weightmasters",
        email: "mailweightmasters@gmail.com"
      },
      to: [{ 
        email: customer_email,
        name: customer_name
      }],
      templateId: 1,
      params: {
        ...paramsForEmail,
        items: itemsWithDiscount, // Use itemsWithDiscount for both arrays to ensure items are shown
        itemsWithDiscount: itemsWithDiscount
      }
    }

    console.log("📧 Sending email to:", customer_email)
    console.log("📤 Email payload:", JSON.stringify(emailPayload, null, 2))

    try {
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
      console.log("📬 Brevo raw response:", responseText)
      
      let responseData
      try {
        responseData = JSON.parse(responseText)
        console.log("✅ Brevo parsed response:", responseData)
      } catch (e) {
        console.log("⚠️ Could not parse Brevo response as JSON")
      }

      if (!response.ok) {
        throw new Error(`Email sending failed with status ${response.status}: ${responseText}`)
      }

      console.log("✅ Bevestigingsmail verzonden naar", customer_email)
      if (hasAnyDiscount) {
        console.log(`💰 Korting verwerkt: ${totalDiscountPercentage}% (€${totalSavedAmount.toFixed(2)} bespaard)`)
      }
      
      return true // Email sent successfully
    } catch (err) {
      console.error("❌ Error sending email:", err)
      console.error("❌ Full error:", err)
      return false // Email sending failed
    }
  } else {
    console.log(`