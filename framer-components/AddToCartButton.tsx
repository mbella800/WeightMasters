import * as React from "react"
import { addPropertyControls, ControlType } from "framer"

// ✅ JUISTE API URL
const API_URL = "https://weight-masters.vercel.app/api/checkout"

export function AddToCartButton(props) {
    const {
        // CMS props
        price,
        stripeProductId,
        ProductName,
        ProductPrice,
        CheckoutSlug, // ✅ Nu vanuit CMS
        ProductImage,
        Weight,
        FreeShippingTreshold,
        CouponID,
        SalePriceOptioneel,
        // Button styling
        text,
        background,
        textColor,
        fontSize,
        fontWeight,
        fontFamily,
        borderRadius,
        borderColor,
        borderWidth,
        paddingVertical,
        paddingHorizontal,
    } = props

    const resolvedImage =
        typeof ProductImage === "object" && ProductImage?.url
            ? ProductImage.url
            : ProductImage || ""
    const resolvedTitle = ProductName || "Geen titel"
    const resolvedPrice = Number(ProductPrice) || 0
    const resolvedSalePrice = Number(SalePriceOptioneel) || 0
    const resolvedWeight = parseFloat(Weight) || 0
    const resolvedThreshold = parseFloat(FreeShippingTreshold) || 0
    const resolvedSlug = CheckoutSlug || "weightmasters" // ✅ Fallback naar weightmasters
    const resolvedCouponId = CouponID || null

    // Use sale price if available, otherwise regular price
    const finalPrice =
        resolvedSalePrice > 0 && resolvedSalePrice < resolvedPrice
            ? resolvedSalePrice
            : resolvedPrice

    const handleAddToCart = () => {
        if (!price) {
            alert("Stripe Price ID ontbreekt")
            return
        }

        const cartItem = {
            price,
            stripePriceId: price,
            stripeProductId,
            "Product Name": resolvedTitle,
            "Product Image": resolvedImage,
            "Product Price": finalPrice,
            "Original Price": resolvedPrice,
            "SalePriceOptioneel": resolvedSalePrice, // ✅ Correcte field naam
            Weight: resolvedWeight,
            "Free Shipping Threshold": resolvedThreshold,
            "Coupon ID": resolvedCouponId,
            quantity: 1,
            checkoutSlug: resolvedSlug, // ✅ Dynamisch uit CMS
        }

        const existingCart = JSON.parse(localStorage.getItem("cart") || "[]")
        const existingItem = existingCart.find((item) => item.price === price)

        const updatedCart = existingItem
            ? existingCart.map((item) =>
                  item.price === price
                      ? { ...item, quantity: item.quantity + 1 }
                      : item
              )
            : [...existingCart, cartItem]

        localStorage.setItem("cart", JSON.stringify(updatedCart))
        window.dispatchEvent(new Event("storage"))
    }

    // ✅ CHECKOUT FUNCTIE NAAR API
    const handleCheckout = async () => {
        try {
            const cart = JSON.parse(localStorage.getItem("cart") || "[]")
            
            if (cart.length === 0) {
                alert("Winkelwagen is leeg")
                return
            }

            const response = await fetch(API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    items: cart,
                    checkoutSlug: resolvedSlug, // ✅ Dynamisch uit CMS
                    shippingMethod: "postnl", // Default, kan later configureerbaar maken
                }),
            })

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`)
            }

            const data = await response.json()
            
            if (data.url) {
                // Redirect naar Stripe Checkout
                window.location.href = data.url
            } else {
                throw new Error("Geen checkout URL ontvangen")
            }
        } catch (error) {
            console.error("Checkout error:", error)
            alert("Er is een fout opgetreden bij het afrekenen. Probeer het opnieuw.")
        }
    }

    return (
        <div
            onClick={handleAddToCart}
            style={{
                width: "100%",
                height: "100%",
                backgroundColor: background,
                color: textColor,
                padding: `${paddingVertical}px ${paddingHorizontal}px`,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                fontSize: `${fontSize}px`,
                fontWeight,
                fontFamily,
                borderRadius: `${borderRadius}px`,
                border: `${borderWidth}px solid ${borderColor}`,
                boxSizing: "border-box",
                cursor: "pointer",
            }}
        >
            {text}
        </div>
    )
}

addPropertyControls(AddToCartButton, {
    price: { type: ControlType.String, title: "Stripe Price ID" },
    stripeProductId: { type: ControlType.String, title: "Stripe Product ID" },
    ProductName: { type: ControlType.String, title: "Product Name" },
    ProductImage: { type: ControlType.Image, title: "Product Image" },
    ProductPrice: {
        type: ControlType.Number,
        title: "Product Price",
        defaultValue: 0,
    },
    SalePriceOptioneel: {
        type: ControlType.Number,
        title: "Sale Price Optioneel",
        defaultValue: 0,
        description: "Voor van/voor prijs. Laat leeg of 0 voor geen korting.",
    },
    CheckoutSlug: { // ✅ Nu uit CMS
        type: ControlType.String,
        title: "Checkout Slug",
        defaultValue: "weightmasters",
        description: "Wordt gebruikt voor order identificatie en emails",
    },
    Weight: {
        type: ControlType.Number,
        title: "Weight (g)",
        defaultValue: 0,
    },
    FreeShippingTreshold: {
        type: ControlType.Number,
        title: "Free Shipping Threshold",
        defaultValue: 50,
    },
    CouponID: {
        type: ControlType.String,
        title: "Stripe Coupon ID",
        defaultValue: "",
        description: "bijv: SUMMER20_abc123 (optioneel)",
    },
    text: {
        type: ControlType.String,
        title: "Buttontekst",
        defaultValue: "Toevoegen",
    },
    background: {
        type: ControlType.Color,
        title: "Achtergrondkleur",
        defaultValue: "#000000",
    },
    textColor: {
        type: ControlType.Color,
        title: "Tekstkleur",
        defaultValue: "#ffffff",
    },
    fontSize: {
        type: ControlType.Number,
        title: "Fontgrootte",
        defaultValue: 16,
    },
    fontWeight: {
        type: ControlType.Enum,
        title: "Font weight",
        options: [
            "normal",
            "bold",
            "100",
            "200",
            "300",
            "400",
            "500",
            "600",
            "700",
            "800",
            "900",
        ],
        defaultValue: "500",
    },
    fontFamily: {
        type: ControlType.String,
        title: "Font family",
        defaultValue: "Inter",
    },
    paddingVertical: {
        type: ControlType.Number,
        title: "Padding boven/onder",
        defaultValue: 12,
    },
    paddingHorizontal: {
        type: ControlType.Number,
        title: "Padding zijkanten",
        defaultValue: 24,
    },
    borderRadius: {
        type: ControlType.Number,
        title: "Border radius",
        defaultValue: 8,
    },
    borderColor: {
        type: ControlType.Color,
        title: "Borderkleur",
        defaultValue: "#000000",
    },
    borderWidth: {
        type: ControlType.Number,
        title: "Border dikte",
        defaultValue: 0,
    },
}) 