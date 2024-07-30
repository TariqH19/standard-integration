import fetch from "node-fetch";

// set some important variables
const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;
const BASE_URL = "https://api-m.sandbox.paypal.com";
// const production = "https://api-m.paypal.com";
const base = `${BASE_URL}`;

// call the create order method
export async function createOrder(cart) {
  const accessToken = await generateAccessToken();
  const url = `${base}/v2/checkout/orders`;
  const payload = {
    intent: "AUTHORIZE",
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
    },
    method: "POST",
    body: JSON.stringify(payload),
  });

  return handleResponse(response);
}

export async function authorizeOrder(orderID) {
  const accessToken = await generateAccessToken();
  const url = `${base}/v2/checkout/orders/${orderID}/authorize`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return handleResponse(response);
}

// capture payment for an order
export async function captureOrder(authorizationID) {
  const accessToken = await generateAccessToken();
  const url = `${base}/v2/payments/authorizations/${authorizationID}/capture`;

  // Generate a unique PayPal-Request-ID to ensure idempotency
  // const requestId = `capture-${Date.now()}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      // "PayPal-Request-Id": requestId, // Unique ID for the request
    },
  });

  return handleResponse(response);
}

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
