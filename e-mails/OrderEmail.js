import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Text,
  Img,
  Section,
} from "@react-email/components"
import * as React from "react"

type Props = {
  name?: string
  items?: {
    title: string
    productImage: string
    productPrice: number
    quantity: number
  }[]
}

export const OrderEmail = ({ name = "", items = [] }: Props) => {
  const subtotal = items.reduce((sum, item) => sum + item.productPrice * item.quantity, 0)
  const tax = subtotal * 0.21
  const shipping = 4.95
  const total = subtotal + tax + shipping

  return (
    <Html>
      <Head />
      <Preview>Bedankt voor je bestelling bij jouw webshop!</Preview>
      <Body style={{ fontFamily: "Arial", backgroundColor: "#fffbee" }}>
        <Container style={{ padding: "24px" }}>
          <Img
            src="https://jouwdomein.nl/logo.png"
            width={100}
            alt="Logo"
            style={{ marginBottom: "16px" }}
          />

          <Text style={{ fontSize: 16 }}>
            Hi {name || "klant"}, bedankt voor je bestelling!
          </Text>

          {items.map((item, index) => (
            <Section key={index} style={{ margin: "12px 0" }}>
              <Img
                src={item.productImage}
                width={48}
                height={48}
                style={{ borderRadius: 4, marginBottom: 4 }}
                alt={item.title}
              />
              <Text style={{ fontSize: 14 }}>
                {item.quantity}× {item.title} – €{item.productPrice.toFixed(2)}
              </Text>
            </Section>
          ))}

          <hr style={{ margin: "16px 0" }} />

          <Text>Subtotaal: €{subtotal.toFixed(2)}</Text>
          <Text>21% BTW: €{tax.toFixed(2)}</Text>
          <Text>Verzendkosten: €{shipping.toFixed(2)}</Text>
          <Text style={{ fontWeight: "bold", fontSize: 16 }}>
            Totaal: €{total.toFixed(2)}
          </Text>

          <Text style={{ marginTop: 20, fontSize: 12 }}>
            Heb je vragen? Mail ons via info@jouwdomein.nl
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
