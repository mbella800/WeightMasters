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
    const shippingMethod = data.shippingMethod || "postnl"
    const checkoutSlug = data.checkoutSlug

    if (!checkoutSlug) throw new Error("checkoutSlug ontbreekt in request")

    let subtotal = 0
    let totalWeight = 0
    let freeShippingThreshold = 0
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
      const originalPrice = Number(item["Product Price"] || item.productPrice || 0)
      const salePrice = Number(item["SalePriceOptioneel"] || item["Sale Price Optioneel"] || 0)
      
      // Effectieve prijs: sale price als beschikbaar, anders originele prijs
      const effectivePrice = (salePrice > 0 && salePrice < originalPrice) ? salePrice : originalPrice
      const hasDiscount = salePrice > 0 && salePrice < originalPrice
      const itemSavings = hasDiscount ? (originalPrice - salePrice) * quantity : 0
      const discountPercentage = hasDiscount ? Math.round(((originalPrice - salePrice) / originalPrice) * 100) : 0
      
      const unitAmount = Math.round(effectivePrice * 100)
      if (isNaN(unitAmount)) throw new Error("unitAmount is geen geldig getal")
      
      subtotal += unitAmount * quantity
      
      // ✅ TOTAAL TRACKING
      totalOriginalValue += Math.round(originalPrice * 100) * quantity
      totalSavedAmount += Math.round(itemSavings * 100)
      
      // Weight berekening voor gratis verzending
      const itemWeight = Number(item["Weight"] || 0)
      totalWeight += itemWeight * quantity
      
      // Hoogste free shipping threshold gebruiken
      const threshold = Number(item["Free Shipping Threshold"] || 0)
      if (threshold > freeShippingThreshold) {
        freeShippingThreshold = threshold
      }

      // Stripe Coupon ID opslaan (eerste item met coupon)
      if (!stripeCouponId && item["Coupon ID"]) {
        stripeCouponId = item["Coupon ID"]
      }

      // ✅ ITEM MET DISCOUNT INFO VOOR METADATA
      itemsWithDiscountInfo.push({
        ...item,
        originalPrice: originalPrice,
        effectivePrice: effectivePrice,
        salePrice: hasDiscount ? salePrice : null,
        hasDiscount: hasDiscount,
        itemSavings: itemSavings,
        discountPercentage: discountPercentage,
        quantity: quantity
      })

      // ✅ PRODUCT LINE ITEMS ZONDER BTW (BTW wordt apart toegevoegd)
      line_items.push({
        price_data: {
          currency: "eur",
          product_data: {
            name: hasDiscount 
              ? `${item["Product Name"] || item.title || "Product"} 🎉 -${discountPercentage}% (was €${originalPrice.toFixed(2)})`
              : item["Product Name"] || item.title || "Product",
            images: [item["Product Image"] || item["ProductImage"]].filter(Boolean),
            metadata: {
              weight: itemWeight.toString(),
              stripePriceId: item["Stripe Price ID"] || "",
              stripeProductId: item["Stripe Product Id"] || "",
              // ✅ DISCOUNT METADATA PER PRODUCT
              originalPrice: originalPrice.toString(),
              effectivePrice: effectivePrice.toString(),
              salePrice: hasDiscount ? salePrice.toString() : "",
              hasDiscount: hasDiscount.toString(),
              discountPercentage: discountPercentage.toString(),
              itemSavings: itemSavings.toString()
            }
          },
          unit_amount: unitAmount,
        },
        quantity,
      })
    }

    // ✅ TOTALE KORTING BEREKENINGEN
    const totalDiscountPercentage = totalOriginalValue > 0 ? 
      Math.round((totalSavedAmount / totalOriginalValue) * 100) : 0

    // ✅ VOEG BESPARING SAMENVATTING TOE (€0 informatieve regel)
    if (totalSavedAmount > 0) {
      line_items.push({
        price_data: {
          currency: "eur",
          product_data: { 
            name: `💰 Totaal bespaard: €${(totalSavedAmount / 100).toFixed(2)} (${totalDiscountPercentage}%)`,
            description: "Je bespaart met onze sale prijzen!"
          },
          unit_amount: 0, // €0 - alleen informatief
        },
        quantity: 1,
      })
    }

    // Verzendkosten logica (gratis verzending check)
    const shippingFees = {
      postnl: 500,
      dhl: 600,
      ophalen: 0,
    }
    
    let shippingFee = shippingFees[shippingMethod] ?? 500
    
    // Gratis verzending als drempel bereikt is (op subtotal, voor korting)
    if (freeShippingThreshold > 0 && (subtotal / 100) >= freeShippingThreshold) {
      shippingFee = 0
    }

    // Verzendkosten toevoegen
    if (shippingFee > 0) {
      line_items.push({
        price_data: {
          currency: "eur",
          product_data: { name: `Verzendkosten - ${shippingMethod.toUpperCase()}` },
          unit_amount: shippingFee,
        },
        quantity: 1,
      })
    } else if (freeShippingThreshold > 0 && shippingFee === 0) {
      line_items.push({
        price_data: {
          currency: "eur",
          product_data: { name: "Gratis verzending" },
          unit_amount: 0,
        },
        quantity: 1,
      })
    }

    // ✅ BTW BEREKENING OVER HELE CART (SUBTOTAL + VERZENDKOSTEN)
    const taxableAmount = subtotal + shippingFee
    const tax = Math.round(taxableAmount * 0.21)

    // BTW toevoegen ALS APARTE REGEL
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

    const orderId = generateOrderId()

    // ✅ UITGEBREIDE METADATA MET DISCOUNT INFO
    const metadata = {
      orderId,
      checkoutSlug,
      shippingMethod,
      subtotal: subtotal.toString(),
      tax: tax.toString(),
      shippingFee: shippingFee.toString(),
      totalWeight: totalWeight.toString(),
      freeShippingThreshold: freeShippingThreshold.toString(),
      stripeCouponId: stripeCouponId || "",
      
      // ✅ NIEUWE DISCOUNT METADATA
      totalOriginalValue: totalOriginalValue.toString(),
      totalSavedAmount: totalSavedAmount.toString(),
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

    res.status(200).json({ id: session.id, url: session.url })
  } catch (err) {
    console.error("Checkout fout:", err)
    res.status(500).end("Internal Server Error")
  }
}
