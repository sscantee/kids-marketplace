const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

// Called from frontend when buyer clicks "Buy Now"
exports.createCheckoutSession = onCall(
  { secrets: [stripeSecretKey], cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in to buy items.");
    }

    const { listingId } = request.data;
    if (!listingId) {
      throw new HttpsError("invalid-argument", "Listing ID is required.");
    }

    const listingRef = admin.firestore().collection("listings").doc(listingId);
    const listingSnap = await listingRef.get();

    if (!listingSnap.exists) {
      throw new HttpsError("not-found", "Listing not found.");
    }

    const listing = listingSnap.data();

    if (listing.status === "sold") {
      throw new HttpsError("failed-precondition", "This item has already been sold.");
    }

    if (listing.sellerId === request.auth.uid) {
      throw new HttpsError("permission-denied", "You cannot buy your own item.");
    }

    const stripe = require("stripe")(stripeSecretKey.value());

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: listing.title,
              images: listing.image ? [listing.image] : [],
            },
            unit_amount: Math.round(listing.price * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        listingId: listingId,
        buyerId: request.auth.uid,
        buyerEmail: request.auth.token.email || "",
        sellerId: listing.sellerId,
      },
      success_url: `${request.rawRequest.headers.origin || "https://kids-marketplace.vercel.app"}?payment=success&listingId=${listingId}`,
      cancel_url: `${request.rawRequest.headers.origin || "https://kids-marketplace.vercel.app"}?payment=cancelled`,
    });

    return { sessionId: session.id, url: session.url };
  }
);

// Called by Stripe after payment completes
exports.stripeWebhook = onRequest(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const stripe = require("stripe")(stripeSecretKey.value());
    const sig = req.headers["stripe-signature"];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        sig,
        stripeWebhookSecret.value()
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const { listingId, buyerId, buyerEmail, sellerId } = session.metadata;

      if (!listingId) {
        console.error("No listingId in session metadata");
        res.status(400).send("Missing listingId");
        return;
      }

      try {
        const listingRef = admin.firestore().collection("listings").doc(listingId);

        await listingRef.update({
          status: "sold",
          buyerId: buyerId,
          buyerEmail: buyerEmail,
          soldAt: admin.firestore.FieldValue.serverTimestamp(),
          stripeSessionId: session.id,
          stripePaymentIntentId: session.payment_intent,
        });

        await admin.firestore().collection("transactions").add({
          listingId: listingId,
          buyerId: buyerId,
          buyerEmail: buyerEmail,
          sellerId: sellerId,
          amount: session.amount_total / 100,
          currency: session.currency,
          stripeSessionId: session.id,
          stripePaymentIntentId: session.payment_intent,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`Listing ${listingId} marked as sold`);
      } catch (err) {
        console.error("Error updating listing:", err);
        res.status(500).send("Error updating listing");
        return;
      }
    }

    res.status(200).json({ received: true });
  }
);
