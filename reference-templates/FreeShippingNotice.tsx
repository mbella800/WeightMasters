import { useEffect, useState } from "react"
import { addPropertyControls, ControlType } from "framer"

// REFERENTIE COMPONENT - ALLEEN GEBRUIKEN IN FRAMER
// Deze component dient als referentie voor de juiste property namen en structuur
export default function FreeShippingNotice(props) {
    const {
        fontSize,
        fontFamily,
        fontWeight,
        textColor,
        align,
        barColor,
        barBackground,
        barHeight,
        showBar,
        shippingText,
        freeText,
    } = props

    const [text, setText] = useState("")
    const [progress, setProgress] = useState(0)

    const calculateNotice = () => {
        const cart = JSON.parse(localStorage.getItem("cart") || "[]")
        console.log("FreeShippingNotice cart:", cart) // Debug logging

        if (!cart.length) {
            setText("")
            setProgress(0)
            return
        }

        const subtotal = cart.reduce((sum, item) => {
            const original = parseFloat(item["Product Price"]) || 0
            const sale = parseFloat(item["Sale Price Optioneel"]) || 0
            const prijs = sale > 0 && sale < original ? sale : original
            const qty = item.quantity || 1
            return sum + prijs * qty
        }, 0)

        const threshold = parseFloat(cart[0]?.FreeShippingTreshold) || 50

        if (subtotal >= threshold) {
            setText(freeText || "Gratis verzending geactiveerd!")
            setProgress(100)
        } else {
            const remaining = threshold - subtotal
            const formatted = `€${remaining.toFixed(2).replace(".", ",")}`
            setText(
                `Nog ${formatted} ${shippingText || "tot gratis verzending!"}`
            )
            setProgress((subtotal / threshold) * 100)
        }
    }

    useEffect(() => {
        calculateNotice()
        window.addEventListener("storage", calculateNotice)
        return () => window.removeEventListener("storage", calculateNotice)
    }, [])

    return (
        <div style={{ width: "100%" }}>
            <div
                style={{
                    color: textColor,
                    fontSize: `${fontSize}px`,
                    fontFamily,
                    fontWeight,
                    textAlign: align,
                    marginBottom: showBar ? 8 : 0,
                }}
            >
                {text}
            </div>

            {showBar && (
                <div
                    style={{
                        width: "100%",
                        height: `${barHeight}px`,
                        background: barBackground,
                        borderRadius: barHeight / 2,
                        overflow: "hidden",
                    }}
                >
                    <div
                        style={{
                            width: `${Math.min(progress, 100)}%`,
                            height: "100%",
                            background: barColor,
                            transition: "width 0.3s ease",
                        }}
                    />
                </div>
            )}
        </div>
    )
}

addPropertyControls(FreeShippingNotice, {
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
        type: ControlType.String,
        title: "Font Weight",
        defaultValue: "500",
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
        defaultValue: "center",
    },
    barColor: {
        type: ControlType.Color,
        title: "Balk kleur",
        defaultValue: "#4CAF50",
    },
    barBackground: {
        type: ControlType.Color,
        title: "Balk achtergrond",
        defaultValue: "#E8F5E9",
    },
    barHeight: {
        type: ControlType.Number,
        title: "Balk hoogte",
        defaultValue: 8,
    },
    showBar: {
        type: ControlType.Boolean,
        title: "Toon balk",
        defaultValue: true,
    },
    shippingText: {
        type: ControlType.String,
        title: "Verzendtekst",
        defaultValue: "tot gratis verzending!",
    },
    freeText: {
        type: ControlType.String,
        title: "Gratis tekst",
        defaultValue: "Gratis verzending geactiveerd!",
    },
})
