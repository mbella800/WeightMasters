import { useEffect, useState } from "react"
import { addPropertyControls, ControlType } from "framer"

export default function CartSubtotal(props) {
    const { fontSize, fontFamily, fontWeight, textColor, align } = props
    const [subtotal, setSubtotal] = useState(0)
    const [originalTotal, setOriginalTotal] = useState(0)

    const calculateSubtotal = () => {
        const cart = JSON.parse(localStorage.getItem("cart") || "[]")

        let discounted = 0
        let original = 0

        cart.forEach((item) => {
            const price = parseFloat(item["Product Price"]) || 0
            const sale = parseFloat(item["Sale Price Optioneel"]) || 0
            const qty = item.quantity || 1
            const finalPrice = sale > 0 && sale < price ? sale : price

            discounted += finalPrice * qty
            original += price * qty
        })

        setSubtotal(discounted)
        setOriginalTotal(original)
    }

    useEffect(() => {
        calculateSubtotal()
        const handleStorage = () => calculateSubtotal()
        window.addEventListener("storage", handleStorage)
        return () => window.removeEventListener("storage", handleStorage)
    }, [])

    const kortingPercentage =
        originalTotal > subtotal
            ? Math.round(((originalTotal - subtotal) / originalTotal) * 100)
            : 0

    return (
        <div
            style={{
                fontSize: `${fontSize}px`,
                fontFamily,
                fontWeight,
                color: textColor,
                textAlign: align,
                width: "100%",
            }}
        >
            <div>€ {subtotal.toFixed(2).replace(".", ",")}</div>
            {kortingPercentage > 0 && (
                <div
                    style={{
                        marginTop: 4,
                        fontSize: 14,
                        color: "#4CAF50",
                        backgroundColor: "#E6F4EA",
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 6,
                        fontWeight: 500,
                    }}
                >
                    Je bespaart {kortingPercentage}%
                </div>
            )}
        </div>
    )
}

addPropertyControls(CartSubtotal, {
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
        defaultValue: "left",
    },
})

