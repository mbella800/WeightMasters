const { json } = require("micro")
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)

function generateOrderId() {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 9000 + 1000)
  return `WM-${year}-${random}`
}

module.exports = async (req, res) => {
  // ✅ EXPLICIETE CORS HEADERS
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept")
  res.setHeader("Access-Control-Allow-Credentials", "false")

  if (req.method === "OPTIONS") return res.status(204).end()
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed")

  try {
    const data = await json(req)
    const items = data.items || []
    const checkoutSlug = data.checkoutSlug

    if (!checkoutSlug) throw new Error("checkoutSlug ontbreekt in request")
    if (!items.length) throw new Error("Geen items in winkelwagen")

    // ✅ Haal FreeShippingTreshold uit het eerste item (alle items hebben dezelfde waarde)
    const freeShippingThreshold = Number(items[0].FreeShippingTreshold)
    if (isNaN(freeShippingThreshold)) throw new Error("FreeShippingTreshold is geen geldig getal")

    let subtotal = 0
    let totalWeight = 0
    const line_items = []
    let stripeCouponId = null

    // ✅ NIEUWE DISCOUNT TRACKING VARIABELEN
    let totalOriginalValue = 0
    let totalSavedAmount = 0
    const itemsWithDiscountInfo = []

    // Process alle items
    for (const item of items) {
      const quantity = item.quantity || 1
      
      // ✅ DISCOUNT BEREKENINGEN
      const originalPrice = Number(item["Product Price"] || 0)
      const salePrice = Number(item["Sale Price Optioneel"] || 0)
      
      // Effectieve prijs: sale price als beschikbaar, anders originele prijs
      const effectivePrice = (salePrice > 0 && salePrice < originalPrice) ? salePrice : originalPrice
      const hasDiscount = salePrice > 0 && salePrice < originalPrice
      const itemSavings = hasDiscount ? (originalPrice - salePrice) * quantity : 0
      const discountPercentage = hasDiscount ? Math.round(((originalPrice - salePrice) / originalPrice) * 100) : 0
      
      // Calculate unit amount including BTW
      const unitAmountExBtw = Math.round(effectivePrice * 100) // Price without BTW
      const unitAmount = unitAmountExBtw // Don't add BTW again, it's already included
      if (isNaN(unitAmount)) throw new Error("unitAmount is geen geldig getal")
      
      subtotal += unitAmount * quantity
      
      // ✅ TOTAAL TRACKING
      totalOriginalValue += Math.round(originalPrice * 100) * quantity // Original price already includes BTW
      totalSavedAmount += Math.round(itemSavings * 100) // Savings already include BTW
      
      // Weight berekening voor gratis verzending
      const itemWeight = Number(item["Weight (g)"] || 0)
      totalWeight += itemWeight * quantity
      
      // Stripe Coupon ID opslaan (eerste item met coupon)
      if (!stripeCouponId && item["Coupon ID"]) {
        stripeCouponId = item["Coupon ID"]
      }

      // ✅ ITEM MET DISCOUNT INFO VOOR METADATA
      itemsWithDiscountInfo.push({
        ...item,
        originalPrice: (originalPrice * 1.21).toFixed(2), // Include BTW
        effectivePrice: (effectivePrice * 1.21).toFixed(2), // Include BTW
        salePrice: hasDiscount ? (salePrice * 1.21).toFixed(2) : null, // Include BTW
        hasDiscount: hasDiscount,
        itemSavings: (itemSavings * 1.21).toFixed(2), // Include BTW
        discountPercentage: discountPercentage,
        quantity: quantity
      })

      // ✅ PRODUCT LINE ITEMS (met BTW notitie en duidelijke namen)
      line_items.push({
        price_data: {
          currency: "eur",
          product_data: {
            name: hasDiscount 
              ? `${item["Product Name"] || "Product"} (incl. BTW) 🎉 -${discountPercentage}%`
              : `${item["Product Name"] || "Product"} (incl. BTW)`,
            images: [item["Product Image"]].filter(Boolean),
            metadata: {
              weight: itemWeight.toString(),
              stripePriceId: item.price || "",
              stripeProductId: item.stripeProductId || "",
              originalPrice: originalPrice.toString(), // Already includes BTW
              effectivePrice: effectivePrice.toString(), // Already includes BTW
              salePrice: hasDiscount ? salePrice.toString() : "", // Already includes BTW
              hasDiscount: hasDiscount.toString(),
              discountPercentage: discountPercentage.toString(),
              itemSavings: itemSavings.toString() // Already includes BTW
            }
          },
          unit_amount: unitAmount, // Already includes BTW
        },
        quantity,
      })
    }

    // ✅ TOTALE KORTING BEREKENINGEN
    const totalDiscountPercentage = totalOriginalValue > 0 ? 
      Math.round((totalSavedAmount / totalOriginalValue) * 100) : 0

    // Calculate shipping costs exactly like in CartShippingEstimate
    let shippingFee = 0
    const subtotalBeforeTax = subtotal / 100 // No need to divide by 1.21, prices already include BTW

    if (subtotalBeforeTax < freeShippingThreshold) {
      if (totalWeight <= 20) shippingFee = 100 // €1,00
      else if (totalWeight <= 50) shippingFee = 200 // €2,00
      else if (totalWeight <= 500) shippingFee = 410 // €4,10
      else if (totalWeight <= 2000) shippingFee = 695 // €6,95
      else shippingFee = 995 // €9,95
    }

    console.log('🚚 SHIPPING DEBUG:', {
      subtotalBeforeTax,
      totalWeight,
      freeShippingThreshold,
      shippingFee: shippingFee / 100
    });

    // Verzendkosten toevoegen
    if (shippingFee > 0) {
      line_items.push({
        price_data: {
          currency: "eur",
          product_data: { 
            name: "Verzendkosten (incl. BTW)",
            metadata: {
              isShipping: "true"
            }
          },
          unit_amount: shippingFee,
        },
        quantity: 1,
      })
    } else {
      // Voeg gratis verzending toe als line item met bedrag 0
      line_items.push({
        price_data: {
          currency: "eur",
          product_data: { 
            name: "🎉 Gratis verzending (vanaf €" + freeShippingThreshold.toFixed(2) + ")",
            metadata: {
              isShipping: "true"
            }
          },
          unit_amount: 0,
        },
        quantity: 1,
      })
    }

    const orderId = generateOrderId()

    // ✅ UITGEBREIDE METADATA MET DISCOUNT INFO
    const metadata = {
      orderId,
      checkoutSlug,
      subtotal: subtotal.toString(), // Already includes BTW
      shippingFee: shippingFee.toString(),
      totalWeight: totalWeight.toString(),
      freeShippingThreshold: freeShippingThreshold.toString(),
      stripeCouponId: stripeCouponId || "",
      
      // ✅ NIEUWE DISCOUNT METADATA
      totalOriginalValue: totalOriginalValue.toString(), // Already includes BTW
      totalSavedAmount: totalSavedAmount.toString(), // Already includes BTW
      totalDiscountPercentage: totalDiscountPercentage.toString(),
      hasAnyDiscount: (totalSavedAmount > 0).toString(),
      
      // ✅ COMPACTE ITEMS DATA (alleen essentiële info)
      itemCount: items.length.toString(),
      productNames: items.map(item => item["Product Name"] || "Product").join(", ").substring(0, 400),
    }

    const origin = req.headers.origin || "https://example.com"

    // ✅ Stripe Session configuratie met coupon support
    const sessionConfig = {
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
      // ✅ KORTINGSCODES EXPLICIET INSCHAKELEN
      allow_promotion_codes: true,
      // ✅ AUTOMATISCHE BTW BEREKENING UITSCHAKELEN (we doen het handmatig)
      automatic_tax: {
        enabled: false,
      },
      // ✅ BILLING ADDRESS VOOR BTW
      billing_address_collection: "auto",
    }

    // ✅ Voeg automatische coupon toe als aanwezig
    if (stripeCouponId) {
      sessionConfig.discounts = [{
        coupon: stripeCouponId
      }]
    }

    const session = await stripe.checkout.sessions.create(sessionConfig)
    return res.status(200).json({ url: session.url })

  } catch (err) {
    console.error("Checkout error:", err)
    return res.status(500).json({ error: err.message })
  }
}
