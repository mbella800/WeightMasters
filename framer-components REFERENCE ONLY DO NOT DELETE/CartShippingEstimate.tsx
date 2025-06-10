import { useEffect, useState } from "react"
import { addPropertyControls, ControlType } from "framer"

// REFERENTIE COMPONENT - ALLEEN GEBRUIKEN IN FRAMER
export default function CartShippingEstimate(props) {
    const {
        fontSize,
        fontFamily,
        fontWeight,
        textColor,
        align,
        shippingLabel,
        freeShippingText,
    } = props

    const [shippingText, setShippingText] = useState("Verzendkosten: €0,00")

    const calculateShipping = () => {
        const cart = JSON.parse(localStorage.getItem("cart") || "[]")
        console.log("CartShippingEstimate cart:", cart) // Debug logging

        if (!cart.length) {
            setShippingText(`${shippingLabel || "Verzendkosten"}: €0,00`)
            return
        }

        const subtotal = cart.reduce((sum, item) => {
            const price = parseFloat(item["Product Price"]) || 0
            const sale = parseFloat(item["Sale Price Optioneel"]) || 0
            const finalPrice = sale > 0 && sale < price ? sale : price
            const qty = item.quantity || 1
            return sum + finalPrice * qty
        }, 0)

        const totalWeight = cart.reduce((sum, item) => {
            const weight = parseFloat(item["Weight (g)"]) || 0
            const qty = item.quantity || 1
            return sum + weight * qty
        }, 0)

        console.log("Subtotal:", subtotal, "Total weight:", totalWeight) // Debug logging

        const threshold = parseFloat(cart[0]?.FreeShippingTreshold) || 50
        let fee = 0

        if (subtotal < threshold) {
            if (totalWeight <= 20) fee = 1.0
            else if (totalWeight <= 50) fee = 2.0
            else if (totalWeight <= 500) fee = 4.1
            else if (totalWeight <= 2000) fee = 6.95
            else fee = 9.95
        }

        console.log("Shipping fee:", fee, "Threshold:", threshold) // Debug logging

        const display =
            fee === 0
                ? `${shippingLabel || "Verzendkosten"}: ${freeShippingText || "€0,00"}`
                : `${shippingLabel || "Verzendkosten"}: €${fee.toFixed(2).replace(".", ",")}`

        setShippingText(display)
    }

    useEffect(() => {
        calculateShipping()
        window.addEventListener("storage", calculateShipping)
        return () => window.removeEventListener("storage", calculateShipping)
    }, [shippingLabel, freeShippingText])

    return (
        <div
            style={{
                color: textColor,
                fontSize: `${fontSize}px`,
                fontFamily,
                fontWeight,
                textAlign: align,
                width: "100%",
            }}
        >
            {shippingText}
        </div>
    )
}

addPropertyControls(CartShippingEstimate, {
    fontSize: {
        type: ControlType.Number,
        title: "Fontgrootte",
        defaultValue: 16,
    },
    fontFamily: {
        type: ControlType.String,
        title: "Font Family",
        defaultValue: "Inter",
    },
    fontWeight: {
        type: ControlType.Enum,
        title: "Font Weight",
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
        defaultValue: "400",
    },
    textColor: {
        type: ControlType.Color,
        title: "Tekstkleur",
        defaultValue: "#000",
    },
    align: {
        type: ControlType.Enum,
        title: "Tekst uitlijning",
        options: ["left", "center", "right"],
        optionTitles: ["Links", "Midden", "Rechts"],
        defaultValue: "left",
    },
    shippingLabel: {
        type: ControlType.String,
        title: "Verzendkosten label",
        defaultValue: "Verzendkosten",
    },
    freeShippingText: {
        type: ControlType.String,
        title: "Gratis verzending tekst",
        defaultValue: "€0,00",
    },
})
