import * as React from "react"
import { addPropertyControls, ControlType } from "framer"

// ✅ JUISTE API URL
const API_URL = "https://weight-masters.vercel.app/api/checkout"

export function StripeCartCheckout(props) {
    const {
        // CMS props voor fallback CheckoutSlug
        CheckoutSlug,
        DefaultShippingMethod = "postnl",
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
        disabledBackground,
        disabledTextColor,
    } = props

    const [isLoading, setIsLoading] = React.useState(false)
    const [cart, setCart] = React.useState([])

    // ✅ LUISTER NAAR CART WIJZIGINGEN
    React.useEffect(() => {
        const updateCart = () => {
            const cartData = JSON.parse(localStorage.getItem("cart") || "[]")
            setCart(cartData)
        }

        updateCart()
        window.addEventListener("storage", updateCart)
        
        return () => window.removeEventListener("storage", updateCart)
    }, [])

    const isCartEmpty = cart.length === 0

    // ✅ CHECKOUT FUNCTIE
    const handleCheckout = async () => {
        if (isCartEmpty || isLoading) return

        setIsLoading(true)
        
        try {
            // ✅ KRIJG CHECKOUT SLUG VAN EERSTE ITEM OF GEBRUIK CMS FALLBACK
            const checkoutSlug = cart[0]?.checkoutSlug || CheckoutSlug || "weightmasters"
            
            const response = await fetch(API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    items: cart,
                    checkoutSlug: checkoutSlug,
                    shippingMethod: DefaultShippingMethod,
                }),
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`HTTP ${response.status}: ${errorText}`)
            }

            const data = await response.json()
            
            if (data.url) {
                // ✅ REDIRECT NAAR STRIPE CHECKOUT
                window.location.href = data.url
            } else {
                throw new Error("Geen checkout URL ontvangen van API")
            }
        } catch (error) {
            console.error("Checkout error:", error)
            alert(`Checkout error: ${error.message}. Probeer het opnieuw.`)
        } finally {
            setIsLoading(false)
        }
    }

    const buttonText = isLoading 
        ? "Bezig met laden..." 
        : isCartEmpty 
        ? "Winkelwagen leeg" 
        : text

    const buttonBg = isCartEmpty || isLoading ? disabledBackground : background
    const buttonColor = isCartEmpty || isLoading ? disabledTextColor : textColor

    return (
        <div
            onClick={handleCheckout}
            style={{
                width: "100%",
                height: "100%",
                backgroundColor: buttonBg,
                color: buttonColor,
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
                cursor: isCartEmpty || isLoading ? "not-allowed" : "pointer",
                opacity: isCartEmpty || isLoading ? 0.6 : 1,
                transition: "all 0.2s ease",
            }}
        >
            {buttonText}
        </div>
    )
}

addPropertyControls(StripeCartCheckout, {
    CheckoutSlug: {
        type: ControlType.String,
        title: "Fallback Checkout Slug",
        defaultValue: "weightmasters",
        description: "Wordt gebruikt als cart items geen checkoutSlug hebben",
    },
    DefaultShippingMethod: {
        type: ControlType.Enum,
        title: "Standaard Verzendmethode",
        options: ["postnl", "dhl", "ophalen"],
        defaultValue: "postnl",
    },
    text: {
        type: ControlType.String,
        title: "Button tekst",
        defaultValue: "Afrekenen",
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
        defaultValue: "600",
    },
    fontFamily: {
        type: ControlType.String,
        title: "Font family",
        defaultValue: "Inter",
    },
    paddingVertical: {
        type: ControlType.Number,
        title: "Padding boven/onder",
        defaultValue: 16,
    },
    paddingHorizontal: {
        type: ControlType.Number,
        title: "Padding zijkanten",
        defaultValue: 32,
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