import * as React from "react"
import { addPropertyControls, ControlType, RenderTarget } from "framer"

/**
 * @framerIntrinsicWidth 320
 * @framerIntrinsicHeight 400
 */
export default function CartList(props) {
    const {
        background,
        textColor,
        borderColor,
        borderRadius,
        buttonColor,
        buttonTextColor,
        fontSize,
        fontWeight,
        fontFamily,
    } = props

    const [cartItems, setCartItems] = React.useState([])

    React.useEffect(() => {
        if (RenderTarget.current() === RenderTarget.canvas) return

        const loadCart = () => {
            try {
                const cart = JSON.parse(localStorage.getItem("cart") || "[]")
                console.log("Loading cart:", cart)
                setCartItems(
                    cart.filter((item) => item && typeof item === "object")
                )
            } catch (error) {
                console.error("Error loading cart:", error)
                setCartItems([])
            }
        }

        loadCart()
        window.addEventListener("storage", loadCart)
        return () => window.removeEventListener("storage", loadCart)
    }, [])

    const updateQuantity = (stripeProductId, change) => {
        if (RenderTarget.current() === RenderTarget.canvas) return

        const updatedCart = cartItems.map((item) => {
            if (item.stripeProductId === stripeProductId) {
                const newQty = Math.max(1, (item.quantity || 1) + change)
                return { ...item, quantity: newQty }
            }
            return item
        })

        localStorage.setItem("cart", JSON.stringify(updatedCart))
        setCartItems(updatedCart)
        window.dispatchEvent(new Event("storage"))
    }

    const removeItem = (stripeProductId) => {
        if (RenderTarget.current() === RenderTarget.canvas) return

        const updatedCart = cartItems.filter(
            (item) => item.stripeProductId !== stripeProductId
        )

        localStorage.setItem("cart", JSON.stringify(updatedCart))
        setCartItems(updatedCart)
        window.dispatchEvent(new Event("storage"))
    }

    const items =
        RenderTarget.current() === RenderTarget.canvas
            ? [
                  {
                      stripeProductId: "preview_1",
                      "Product Name": "Voorbeeld Product 1",
                      "Product Image": "https://placehold.co/60x60",
                      "Product Price": 29.99,
                      quantity: 1,
                  },
                  {
                      stripeProductId: "preview_2",
                      "Product Name": "Voorbeeld Product 2",
                      "Product Image": "https://placehold.co/60x60",
                      "Product Price": 39.99,
                      "Sale Price Optioneel": 29.99,
                      quantity: 2,
                  },
              ]
            : cartItems

    return (
        <div
            style={{
                background,
                color: textColor,
                padding: 16,
                borderRadius,
                border: `1px solid ${borderColor}`,
                fontSize,
                fontWeight,
                fontFamily,
                width: "100%",
                height: "100%",
                overflow: "auto",
                boxSizing: "border-box",
            }}
        >
            {items.length === 0 ? (
                <p>Je winkelmandje is leeg</p>
            ) : (
                items.map((item, index) => {
                    const original = parseFloat(item["Product Price"]) || 0
                    const sale = parseFloat(item["Sale Price Optioneel"]) || 0
                    const hasDiscount = sale > 0 && sale < original
                    const price = hasDiscount ? sale : original
                    const total = (price * (item.quantity || 1)).toFixed(2)
                    const originalTotal = (
                        original * (item.quantity || 1)
                    ).toFixed(2)
                    const discountPercent = hasDiscount
                        ? Math.round(((original - sale) / original) * 100)
                        : 0

                    return (
                        <div
                            key={item.stripeProductId || index}
                            style={{
                                marginBottom: index < items.length - 1 ? 16 : 0,
                                paddingBottom:
                                    index < items.length - 1 ? 16 : 0,
                                borderBottom:
                                    index < items.length - 1
                                        ? `1px solid ${borderColor}`
                                        : "none",
                            }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "flex-start",
                                    gap: 12,
                                }}
                            >
                                <img
                                    src={item["Product Image"] || ""}
                                    alt={item["Product Name"]}
                                    style={{
                                        width: 60,
                                        height: 60,
                                        borderRadius: 8,
                                        objectFit: "cover",
                                        backgroundColor: "#f5f5f5",
                                        flexShrink: 0,
                                    }}
                                    onError={(e) => {
                                        e.target.onerror = null
                                        e.target.src =
                                            "https://placehold.co/60x60/f5f5f5/666666?text=Foto"
                                    }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600 }}>
                                        {item["Product Name"]}
                                    </div>

                                    <div style={{ marginTop: 4, fontSize: 14 }}>
                                        <span>€{total.replace(".", ",")}</span>
                                        {hasDiscount && (
                                            <>
                                                <span
                                                    style={{
                                                        textDecoration:
                                                            "line-through",
                                                        marginLeft: 8,
                                                        opacity: 0.6,
                                                    }}
                                                >
                                                    €
                                                    {originalTotal.replace(
                                                        ".",
                                                        ","
                                                    )}
                                                </span>
                                                <span
                                                    style={{
                                                        marginLeft: 8,
                                                        fontSize: 12,
                                                        color: "#16a34a",
                                                        fontWeight: 500,
                                                    }}
                                                >
                                                    -{discountPercent}%
                                                </span>
                                            </>
                                        )}
                                    </div>

                                    <div
                                        style={{
                                            marginTop: 8,
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 12,
                                            fontSize: 14,
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 8,
                                            }}
                                        >
                                            <button
                                                onClick={() =>
                                                    updateQuantity(
                                                        item.stripeProductId,
                                                        -1
                                                    )
                                                }
                                                style={{
                                                    background: buttonColor,
                                                    color: buttonTextColor,
                                                    padding: "4px 8px",
                                                    borderRadius: 4,
                                                    border: "none",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                −
                                            </button>
                                            <span>
                                                Aantal: {item.quantity || 1}
                                            </span>
                                            <button
                                                onClick={() =>
                                                    updateQuantity(
                                                        item.stripeProductId,
                                                        1
                                                    )
                                                }
                                                style={{
                                                    background: buttonColor,
                                                    color: buttonTextColor,
                                                    padding: "4px 8px",
                                                    borderRadius: 4,
                                                    border: "none",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                +
                                            </button>
                                        </div>
                                        <span
                                            onClick={() =>
                                                removeItem(item.stripeProductId)
                                            }
                                            style={{
                                                cursor: "pointer",
                                                color: "#B00020",
                                                display: "flex",
                                                alignItems: "center",
                                            }}
                                        >
                                            × Verwijder
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                })
            )}
        </div>
    )
}

CartList.defaultProps = {
    background: "#fff",
    textColor: "#000",
    borderColor: "#eee",
    borderRadius: 12,
    buttonColor: "#000",
    buttonTextColor: "#fff",
    fontSize: 16,
    fontWeight: "500",
    fontFamily: "Inter",
}

addPropertyControls(CartList, {
    background: {
        type: ControlType.Color,
        title: "Achtergrond",
        defaultValue: "#fff",
    },
    textColor: {
        type: ControlType.Color,
        title: "Tekstkleur",
        defaultValue: "#000",
    },
    borderColor: {
        type: ControlType.Color,
        title: "Lijnkleur",
        defaultValue: "#eee",
    },
    borderRadius: {
        type: ControlType.Number,
        title: "Ronde hoeken",
        defaultValue: 12,
    },
    buttonColor: {
        type: ControlType.Color,
        title: "Buttonkleur",
        defaultValue: "#000",
    },
    buttonTextColor: {
        type: ControlType.Color,
        title: "Buttontekst",
        defaultValue: "#fff",
    },
    fontSize: {
        type: ControlType.Number,
        title: "Fontgrootte",
        defaultValue: 16,
    },
    fontWeight: {
        type: ControlType.String,
        title: "Font Weight",
        defaultValue: "500",
    },
    fontFamily: {
        type: ControlType.String,
        title: "Font Family",
        defaultValue: "Inter",
    },
})
