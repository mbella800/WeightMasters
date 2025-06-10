import { useEffect, useState } from "react"
import { addPropertyControls, ControlType } from "framer"

// REFERENTIE COMPONENT - ALLEEN GEBRUIKEN IN FRAMER
// Deze component dient als referentie voor de juiste property namen en structuur
export default function StripeCartCheckout(props) {
    const {
        stripeCheckoutUrl = "https://weight-masters.vercel.app/api/checkout",
        buttonText = "Afrekenen",
        backgroundColor = "#000000",
        textColor = "#ffffff",
        fontSize = 16,
        fontWeight = "600",
        borderRadius = 12,
        paddingVertical = 16,
        paddingHorizontal = 32,
        disabledBackground = "#cccccc",
        disabledTextColor = "#666666",
    } = props

    const [isLoading, setIsLoading] = useState(false)
    const [cart, setCart] = useState([])

    useEffect(() => {
        const updateCart = () => {
            const cartData = JSON.parse(localStorage.getItem("cart") || "[]")
            setCart(cartData.filter((item) => item && typeof item === "object"))
        }

        updateCart()
        window.addEventListener("storage", updateCart)
        return () => window.removeEventListener("storage", updateCart)
    }, [])

    const calculateTotals = () => {
        let subtotal = 0
        let totalWeight = 0

        cart.forEach((item) => {
            const original = parseFloat(item["Product Price"]) || 0
            const sale = parseFloat(item["Sale Price Optioneel"]) || 0
            const price = sale > 0 && sale < original ? sale : original
            const qty = item.quantity || 1
            const weight = parseFloat(item["Weight (g)"]) || 0

            subtotal += price * qty
            totalWeight += weight * qty
        })

        const threshold = parseFloat(cart[0]?.FreeShippingTreshold) || 100
        let shippingFee = 0

        if (subtotal < threshold) {
            if (totalWeight <= 20) shippingFee = 1.0
            else if (totalWeight <= 50) shippingFee = 2.0
            else if (totalWeight <= 500) shippingFee = 4.1
            else if (totalWeight <= 2000) shippingFee = 6.95
            else shippingFee = 9.95
        }

        return { subtotal, shippingFee, totalWeight }
    }

    const redirectToCheckout = async () => {
        if (!cart.length || isLoading) return
        setIsLoading(true)

        try {
            const { shippingFee } = calculateTotals()

            // Format for Stripe Checkout Session
            const payload = {
                items: cart.map((item) => ({
                    "Product Name": item["Product Name"],
                    "Product Image": item["Product Image"],
                    "Product Price": item["Product Price"],
                    "Sale Price Optioneel": item["Sale Price Optioneel"],
                    "Weight (g)": item["Weight (g)"],
                    "FreeShippingTreshold": item.FreeShippingTreshold,
                    "Coupon ID": item["Coupon ID"],
                    price: item.price,
                    stripeProductId: item.stripeProductId,
                    quantity: item.quantity || 1,
                })),
                checkoutSlug: cart[0]?.checkoutSlug || "weightmasters",
                shipping_amount: Math.round(shippingFee * 100),
                success_url: window.location.origin + "?success=true",
                cancel_url: window.location.origin + "?canceled=true",
            }

            console.log("Sending to Stripe:", payload)

            const response = await fetch(stripeCheckoutUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })

            if (!response.ok) {
                const errorText = await response.text()
                console.error("Checkout error response:", errorText)
                throw new Error(`HTTP ${response.status}: ${errorText}`)
            }

            const data = await response.json()
            console.log("Stripe response:", data)

            if (data.url) {
                window.location.href = data.url
            } else {
                throw new Error("Geen checkout URL ontvangen")
            }
        } catch (error) {
            console.error("Checkout error:", error)
            alert("Er ging iets mis bij het afrekenen. Probeer het opnieuw.")
        } finally {
            setIsLoading(false)
        }
    }

    const isDisabled = !cart.length || isLoading
    const currentBgColor = isDisabled ? disabledBackground : backgroundColor
    const currentTextColor = isDisabled ? disabledTextColor : textColor
    const currentButtonText = isLoading
        ? "Bezig met laden..."
        : !cart.length
          ? "Winkelwagen is leeg"
          : buttonText

    return (
        <button
            onClick={redirectToCheckout}
            disabled={isDisabled}
            style={{
                width: "100%",
                backgroundColor: currentBgColor,
                color: currentTextColor,
                padding: `${paddingVertical}px ${paddingHorizontal}px`,
                fontSize: `${fontSize}px`,
                fontWeight,
                borderRadius: `${borderRadius}px`,
                border: "none",
                cursor: isDisabled ? "not-allowed" : "pointer",
                opacity: isDisabled ? 0.7 : 1,
                transition: "all 0.2s ease",
            }}
        >
            {currentButtonText}
        </button>
    )
}

addPropertyControls(StripeCartCheckout, {
    stripeCheckoutUrl: {
        type: ControlType.String,
        title: "Checkout URL",
        defaultValue: "https://weight-masters.vercel.app/api/checkout",
    },
    buttonText: {
        type: ControlType.String,
        title: "Button tekst",
        defaultValue: "Afrekenen",
    },
    backgroundColor: {
        type: ControlType.Color,
        title: "Achtergrond",
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
        type: ControlType.String,
        title: "Font Weight",
        defaultValue: "600",
    },
    borderRadius: {
        type: ControlType.Number,
        title: "Ronde hoeken",
        defaultValue: 12,
    },
    paddingVertical: {
        type: ControlType.Number,
        title: "Padding verticaal",
        defaultValue: 16,
    },
    paddingHorizontal: {
        type: ControlType.Number,
        title: "Padding horizontaal",
        defaultValue: 32,
    },
    disabledBackground: {
        type: ControlType.Color,
        title: "Disabled achtergrond",
        defaultValue: "#cccccc",
    },
    disabledTextColor: {
        type: ControlType.Color,
        title: "Disabled tekstkleur",
        defaultValue: "#666666",
    },
})
