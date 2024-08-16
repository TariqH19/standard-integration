import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PORT = 8888 } = process.env;
const base = "https://api-m.sandbox.paypal.com";
const app = express();

app.use(express.static(path.join(__dirname, "../client")));
app.use(express.json());

// Generate OAuth 2.0 access token
const generateAccessToken = async () => {
  const auth = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
  ).toString("base64");
  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    body: "grant_type=client_credentials",
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });
  const data = await response.json();
  return data.access_token;
};

// Create an order
const createOrder = async (cart) => {
  const accessToken = await generateAccessToken();
  const url = `${base}/v2/checkout/orders`;
  const payload = {
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: "GBP",
          value: "10.00",
        },
        shipping: {
          options: [
            {
              id: "SHIP_123",
              label: "Free Shipping",
              type: "SHIPPING",
              selected: true,
              amount: {
                value: "0.00",
                currency_code: "GBP",
              },
            },
            {
              id: "SHIP_456",
              label: "Expedited Shipping",
              type: "SHIPPING",
              selected: false,
              amount: {
                value: "5.00",
                currency_code: "GBP",
              },
            },
          ],
        },
      },
    ],
  };

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    method: "POST",
    body: JSON.stringify(payload),
  });

  return response.json();
};

// Capture an order
const captureOrder = async (orderID) => {
  const accessToken = await generateAccessToken();
  const url = `${base}/v2/checkout/orders/${orderID}/capture`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return response.json();
};

// Update shipping options
const updateShippingOption = async (orderID, selectedShippingOption) => {
  const accessToken = await generateAccessToken();
  const url = `${base}/v2/checkout/orders/${orderID}`;
  const payload = {
    purchase_units: [
      {
        shipping: {
          options: [
            {
              id: selectedShippingOption.id,
              label: selectedShippingOption.label,
              type: selectedShippingOption.type,
              amount: selectedShippingOption.amount,
            },
          ],
        },
      },
    ],
  };

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify([
      {
        op: "replace",
        path: "/purchase_units/@reference_id=='default'/shipping",
        value: payload.purchase_units[0].shipping,
      },
    ]),
  });

  return response.json();
};

// Update shipping address
const updateShippingAddress = async (orderID, shippingAddress) => {
  const accessToken = await generateAccessToken();
  const url = `${base}/v2/checkout/orders/${orderID}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify([
      {
        op: "replace",
        path: "/purchase_units/@reference_id=='default'/shipping/address",
        value: shippingAddress,
      },
    ]),
  });
  const responseBody = await response.json();
  console.log("Response Status:", response.status);
  console.log("Response Body:", responseBody);
  return responseBody;
};

// API routes
app.post("/api/orders", async (req, res) => {
  try {
    const { cart } = req.body;
    const order = await createOrder(cart);
    res.json(order);
  } catch (error) {
    console.error("Failed to create order:", error);
    res.status(500).json({ error: "Failed to create order." });
  }
});

app.post("/api/orders/:orderID/capture", async (req, res) => {
  try {
    const { orderID } = req.params;
    const order = await captureOrder(orderID);
    res.json(order);
  } catch (error) {
    console.error("Failed to capture order:", error);
    res.status(500).json({ error: "Failed to capture order." });
  }
});

app.patch("/api/orders/update-shipping", async (req, res) => {
  try {
    const { orderID, selectedShippingOption } = req.body;
    const updatedOrder = await updateShippingOption(
      orderID,
      selectedShippingOption
    );
    res.json(updatedOrder);
  } catch (error) {
    console.error("Failed to update shipping option:", error);
    res.status(500).json({ error: "Failed to update shipping option." });
  }
});

app.patch("/api/orders/update-address", async (req, res) => {
  try {
    const { orderID, shippingAddress } = req.body;
    const updatedOrder = await updateShippingAddress(orderID, shippingAddress);
    res.json(updatedOrder);
  } catch (error) {
    console.error("Failed to update shipping address:", error);
    res.status(500).json({ error: "Failed to update shipping address." });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.resolve("../client/checkout.html"));
});

app.get("/donate", (req, res) => {
  res.sendFile(path.resolve("../client/donate.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
