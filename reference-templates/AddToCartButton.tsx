import * as React from "react"
import { addPropertyControls, ControlType } from "framer"

/**
 * @framerIntrinsicWidth 200
 * @framerIntrinsicHeight 50
 */
export function AddToCartButton(props) {
    const {
        text = "In winkelwagen",
        background = "#000000",
        textColor = "#ffffff",
        fontSize = 16,
        fontWeight = "600",
        fontFamily = "Inter",
        borderRadius = 8,
        borderColor = "transparent",
        borderWidth = 0,
        paddingVertical = 12,
        paddingHorizontal = 24,
        // CMS velden
        price = "",
        stripeProductId = "",
        ProductName = "",
        ProductImage = "",
        ProductPrice = 0,
        SalePriceOptioneel = 0,
        CheckoutSlug = "weightmasters",
        Weight = 0,
        FreeShippingTreshold = 50,
        CouponID = "",
    } = props

    const handleClick = () => {
        if (!stripeProductId) return

        try {
            const cart = JSON.parse(localStorage.getItem("cart") || "[]")
            const item = {
                "price": price,
                "stripeProductId": stripeProductId,
                "Product Name": ProductName,
                "Product Image": typeof ProductImage === "object" ? ProductImage.url : ProductImage,
                "Product Price": Number(ProductPrice) || 0,
                "Sale Price Optioneel": Number(SalePriceOptioneel) || 0,
                "Weight (g)": Number(Weight) || 0,
                "FreeShippingTreshold": Number(FreeShippingTreshold) || 50,
                "checkoutSlug": CheckoutSlug,
                "Coupon ID": CouponID,
                quantity: 1,
            }

            const exists = cart.findIndex(
                (x) => x.stripeProductId === stripeProductId
            )

            if (exists > -1) {
                cart[exists].quantity = (cart[exists].quantity || 1) + 1
            } else {
                cart.push(item)
            }

            localStorage.setItem("cart", JSON.stringify(cart))
            window.dispatchEvent(new Event("storage"))
        } catch (error) {
            console.error("Error adding to cart:", error)
        }
    }

    return (
        <div
            onClick={handleClick}
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
                userSelect: "none",
            }}
        >
            {text}
        </div>
    )
}

addPropertyControls(AddToCartButton, {
    text: {
        type: ControlType.String,
        title: "Button tekst",
        defaultValue: "In winkelwagen",
    },
    background: {
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
    fontFamily: {
        type: ControlType.String,
        title: "Font Family",
        defaultValue: "Inter",
    },
    borderRadius: {
        type: ControlType.Number,
        title: "Ronde hoeken",
        defaultValue: 8,
    },
    borderColor: {
        type: ControlType.Color,
        title: "Lijnkleur",
        defaultValue: "transparent",
    },
    borderWidth: {
        type: ControlType.Number,
        title: "Lijndikte",
        defaultValue: 0,
    },
    paddingVertical: {
        type: ControlType.Number,
        title: "Padding verticaal",
        defaultValue: 12,
    },
    paddingHorizontal: {
        type: ControlType.Number,
        title: "Padding horizontaal",
        defaultValue: 24,
    },
    // CMS velden
    price: {
        type: ControlType.String,
        title: "Stripe Price ID",
        defaultValue: "",
    },
    stripeProductId: {
        type: ControlType.String,
        title: "Stripe Product ID",
        defaultValue: "",
    },
    ProductName: {
        type: ControlType.String,
        title: "Product Name",
        defaultValue: "",
    },
    ProductImage: {
        type: ControlType.Image,
        title: "Product Image",
    },
    ProductPrice: {
        type: ControlType.Number,
        title: "Product Price",
        defaultValue: 0,
    },
    SalePriceOptioneel: {
        type: ControlType.Number,
        title: "Sale Price Optioneel",
        defaultValue: 0,
    },
    CheckoutSlug: {
        type: ControlType.String,
        title: "checkoutSlug",
        defaultValue: "weightmasters",
    },
    Weight: {
        type: ControlType.Number,
        title: "Weight (g)",
        defaultValue: 0,
    },
    FreeShippingTreshold: {
        type: ControlType.Number,
        title: "FreeShippingTreshold",
        defaultValue: 50,
    },
    CouponID: {
        type: ControlType.String,
        title: "Coupon ID",
        defaultValue: "",
    },
})
