import express from "express";
import fetch from "node-fetch";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import * as paypal from "./paypal-api.js";
import * as authcap from "./auth-capture.js";
import * as acdc from "./advanced-api.js";
import * as applepay from "./applepay-api.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PORT = 8888 } = process.env;
const base = "https://api-m.sandbox.paypal.com";
const app = express();

app.use(express.static(path.join(__dirname, "../client")));
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));
app.set("view engine", "ejs");
app.set("views", "../views");

const generateAccessToken = async () => {
  try {
    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
      throw new Error("MISSING_API_CREDENTIALS");
    }
    const auth = Buffer.from(
      `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
    ).toString("base64");
    const response = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      body: "grant_type=client_credentials",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error("Failed to generate Access Token:", error);
    throw error;
  }
};

app.post("/api/create-product-plan", async (req, res) => {
  try {
    const accessToken = await generateAccessToken();
    const productResponse = await fetch(`${base}/v1/catalogs/products`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Gym Membership",
        description: "A monthly membership for the gym",
        type: "SERVICE",
        category: "EXERCISE_AND_FITNESS",
        image_url: "https://example.com/image.jpg",
        home_url: "https://example.com",
      }),
    });

    if (!productResponse.ok) {
      const error = await productResponse.text();
      console.error("Product creation error:", error);
      return res.status(productResponse.status).send("Error creating product");
    }

    const productData = await productResponse.json();
    const productId = productData.id;

    const planResponse = await fetch(`${base}/v1/billing/plans`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        product_id: productId,
        name: "Basic Gym Plan",
        description: "Monthly subscription to the gym.",
        billing_cycles: [
          {
            frequency: {
              interval_unit: "MONTH",
              interval_count: 1,
            },
            tenure_type: "REGULAR",
            sequence: 1,
            total_cycles: 12,
            pricing_scheme: {
              fixed_price: {
                value: "35",
                currency_code: "GBP",
              },
            },
          },
        ],
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee: {
            value: "0",
            currency_code: "GBP",
          },
          setup_fee_failure_action: "CONTINUE",
          payment_failure_threshold: 3,
        },
        taxes: {
          percentage: "0",
          inclusive: false,
        },
      }),
    });

    if (!planResponse.ok) {
      const error = await planResponse.text();
      console.error("Plan creation error:", error);
      return res.status(planResponse.status).send("Error creating plan");
    }

    const planData = await planResponse.json();
    res.json({ productId, planId: planData.id });
  } catch (error) {
    console.error("Error creating product or plan:", error);
    res.status(500).send("Error creating product or plan");
  }
});

const createOrder = async (cart) => {
  // use the cart information passed from the front-end to calculate the purchase unit details
  console.log(
    "shopping cart information passed from the frontend createOrder() callback:",
    cart
  );

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
      },
    ],
  };

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      // Uncomment one of these to force an error for negative testing (in sandbox mode only). Documentation:
      // https://developer.paypal.com/tools/sandbox/negative-testing/request-headers/
      // "PayPal-Mock-Response": '{"mock_application_codes": "MISSING_REQUIRED_PARAMETER"}'
      // "PayPal-Mock-Response": '{"mock_application_codes": "PERMISSION_DENIED"}'
      // "PayPal-Mock-Response": '{"mock_application_codes": "INTERNAL_SERVER_ERROR"}'
    },
    method: "POST",
    body: JSON.stringify(payload),
  });

  return handleResponse(response);
};

/**
 * Capture payment for the created order to complete the transaction.
 * @see https://developer.paypal.com/docs/api/orders/v2/#orders_capture
 */
const captureOrder = async (orderID) => {
  const accessToken = await generateAccessToken();
  const url = `${base}/v2/checkout/orders/${orderID}/capture`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      // Uncomment one of these to force an error for negative testing (in sandbox mode only). Documentation:
      // https://developer.paypal.com/tools/sandbox/negative-testing/request-headers/
      // "PayPal-Mock-Response": '{"mock_application_codes": "INSTRUMENT_DECLINED"}'
      // "PayPal-Mock-Response": '{"mock_application_codes": "TRANSACTION_REFUSED"}'
      // "PayPal-Mock-Response": '{"mock_application_codes": "INTERNAL_SERVER_ERROR"}'
    },
  });

  return handleResponse(response);
};

async function handleResponse(response) {
  try {
    const jsonResponse = await response.json();
    return {
      jsonResponse,
      httpStatusCode: response.status,
    };
  } catch (err) {
    const errorMessage = await response.text();
    throw new Error(errorMessage);
  }
}

app.post("/api/orders", async (req, res) => {
  try {
    // use the cart information passed from the front-end to calculate the order amount detals
    const { cart } = req.body;
    const { jsonResponse, httpStatusCode } = await createOrder(cart);
    res.status(httpStatusCode).json(jsonResponse);
  } catch (error) {
    console.error("Failed to create order:", error);
    res.status(500).json({ error: "Failed to create order." });
  }
});

app.post("/api/orders/:orderID/capture", async (req, res) => {
  try {
    const { orderID } = req.params;
    const { jsonResponse, httpStatusCode } = await captureOrder(orderID);
    res.status(httpStatusCode).json(jsonResponse);
  } catch (error) {
    console.error("Failed to create order:", error);
    res.status(500).json({ error: "Failed to capture order." });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.resolve(__dirname, "../client/checkout.html"));
});

app.get("/standard", (req, res) => {
  res.sendFile(path.resolve(__dirname, "../client/standard.html"));
});

app.get("/authcap", (req, res) => {
  res.sendFile(path.resolve(__dirname, "../client/authcap.html"));
});

app.get("/acdc", async (req, res) => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const tokenId = await acdc.generateAccessToken();

  res.render("acdc", {
    clientId,
    tokenId,
  });
});

app.get("/googlepay", async (req, res) => {
  const clientId = process.env.PAYPAL_CLIENT_ID,
    merchantId = process.env.PAYPAL_MERCHANT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  try {
    if (!clientId || !merchantId || !clientSecret) {
      throw new Error("Client Id or App Secret or Merchant Id is missing.");
    }
    const clientToken = await paypal.generateClientToken();
    res.render("checkout", { clientId, clientToken, merchantId });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/applepay", async (req, res) => {
  const clientId = process.env.PAYPAL_CLIENT_ID,
    merchantId = process.env.PAYPAL_MERCHANT_ID;
  try {
    const clientToken = await applepay.generateClientToken();
    res.render("applepay", { clientId, clientToken, merchantId });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post("/googlepay/api/orders", async (req, res) => {
  try {
    const order = await paypal.createOrder();
    res.json(order);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post("/googlepay/api/orders/:orderID", async (req, res) => {
  const { orderID } = req.params;
  try {
    const order = await paypal.getOrder(orderID);
    res.json(order);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// capture payment
app.post("/googlepay/api/orders/:orderID/capture", async (req, res) => {
  const { orderID } = req.params;
  try {
    const captureData = await paypal.capturePayment(orderID);
    res.json(captureData);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post("/authcap/api/orders", async (req, res) => {
  try {
    const { cart } = req.body;
    const { jsonResponse, httpStatusCode } = await authcap.createOrder(cart);

    if (httpStatusCode === 201) {
      // HTTP 201 Created
      // Send the order ID back to the client
      const orderID = jsonResponse.id;
      res.status(httpStatusCode).json({ orderID });
    } else {
      res.status(httpStatusCode).json(jsonResponse);
    }
  } catch (error) {
    console.error("Failed to create order:", error);
    res.status(500).json({ error: "Failed to create order." });
  }
});

app.post("/authcap/api/orders/:orderID/authorize", async (req, res) => {
  try {
    const { orderID } = req.params;
    const { jsonResponse, httpStatusCode } = await authcap.authorizeOrder(
      orderID
    );
    res.status(httpStatusCode).json(jsonResponse);
  } catch (error) {
    console.error("Failed to authorize order:", error);
    res.status(500).json({ error: "Failed to authorize order." });
  }
});

app.post("/authcap/api/orders/:authorizationID/capture", async (req, res) => {
  try {
    const { authorizationID } = req.params;
    console.log(
      `Attempting to capture with authorizationID: ${authorizationID}`
    );
    const { jsonResponse, httpStatusCode } = await authcap.captureOrder(
      authorizationID
    );
    res.status(httpStatusCode).json(jsonResponse);
  } catch (error) {
    console.error("Failed to capture order:", error);
    res.status(500).json({ error: "Failed to capture order." });
  }
});

app.post("/acdc/api/orders", async (req, res) => {
  try {
    const { task, saveCard } = req.body;
    const order = await acdc.createOrder(task, saveCard);
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: "Failed to create order" });
  }
});

app.get("/acdc/api/orders/:orderID", async (req, res) => {
  const { orderID } = req.params; // Ensure orderID is defined here
  try {
    const orderDetails = await acdc.getOrderDetails(orderID);
    res.json(orderDetails);
  } catch (error) {
    console.error(
      `Error fetching order details for ${orderID}:`,
      error.message
    );
    res
      .status(500)
      .json({ error: `Failed to get order details: ${error.message}` });
  }
});

// Capture payment
app.post("/acdc/api/orders/:orderID/capture", async (req, res) => {
  try {
    const { orderID } = req.params;
    const captureData = await acdc.capturePayment(orderID);
    res.json(captureData);
  } catch (error) {
    res.status(500).json({ error: "Failed to capture payment" });
  }
});

app.post("/applepay/api/orders", async (req, res) => {
  try {
    const order = await applepay.createOrder();
    console.log("order", order);
    res.json(order);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// capture payment
app.post("/applepay/api/orders/:orderID/capture", async (req, res) => {
  const { orderID } = req.params;
  try {
    const captureData = await applepay.capturePayment(orderID);
    res.json(captureData);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Node server listening at http://localhost:${PORT}/`);
});
