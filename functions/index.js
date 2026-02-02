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
      shipping_address_collection: {
        allowed_countries: [
          "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
          "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
          "PL", "PT", "RO", "SK", "SI", "ES", "SE", "GB", "CH", "NO",
        ],
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: 499, currency: "eur" },
            display_name: "Home Delivery",
            delivery_estimate: {
              minimum: { unit: "business_day", value: 3 },
              maximum: { unit: "business_day", value: 5 },
            },
          },
        },
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: 349, currency: "eur" },
            display_name: "Parcel Locker / Delivery Box",
            delivery_estimate: {
              minimum: { unit: "business_day", value: 2 },
              maximum: { unit: "business_day", value: 4 },
            },
          },
        },
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: 0, currency: "eur" },
            display_name: "Local Pickup",
            delivery_estimate: {
              minimum: { unit: "business_day", value: 1 },
              maximum: { unit: "business_day", value: 2 },
            },
          },
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
          shippingName: session.shipping_details?.name || "",
          shippingAddress: session.shipping_details?.address || null,
          shippingAmount: (session.shipping_cost?.amount_total || 0) / 100,
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

// One-time seed function to populate sample product data
exports.seedListings = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    const sellerId = request.auth.uid;
    const sellerEmail = request.auth.token.email || "store@littletreasures.com";
    const sellerDisplayName = request.auth.token.name || sellerEmail.split("@")[0];

    const products = [
      // === TOYS ===
      {
        title: "Wooden Building Blocks (50 pcs)",
        price: 15.00,
        category: "toys",
        condition: "Like New",
        age: "2-5 years",
        location: "Brussels, Belgium",
        description: "Handcrafted natural wood blocks in various shapes and sizes. Non-toxic paint, smooth edges safe for little hands. Perfect for creative play and early learning.",
        image: "https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=500&h=400&fit=crop",
      },
      {
        title: "LEGO Duplo Farm Set",
        price: 28.00,
        category: "toys",
        condition: "Excellent",
        age: "3-6 years",
        location: "Amsterdam, Netherlands",
        description: "Complete farm set with animals, farmer figures, and tractor. All 87 pieces included in original box. Great for developing motor skills and imagination.",
        image: "https://images.unsplash.com/photo-1587654780291-39c9404d7dd0?w=500&h=400&fit=crop",
      },
      {
        title: "Montessori Shape Puzzle",
        price: 19.00,
        category: "toys",
        condition: "Like New",
        age: "1-3 years",
        location: "Munich, Germany",
        description: "Wooden peg puzzle with geometric shapes in natural colors. Helps with shape recognition and hand-eye coordination. Montessori-aligned design.",
        image: "https://images.unsplash.com/photo-1606503153255-59d8b8b82176?w=500&h=400&fit=crop",
      },
      {
        title: "Wooden Play Kitchen",
        price: 35.00,
        category: "toys",
        condition: "Good",
        age: "3-7 years",
        location: "Paris, France",
        description: "Compact wooden kitchen with oven, sink, and 12-piece cookware set including pots, pans, and play food. Minor surface wear. Hours of imaginative play.",
        image: "https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=500&h=400&fit=crop",
      },
      {
        title: "Classic Wooden Train Set",
        price: 22.00,
        category: "toys",
        condition: "Excellent",
        age: "2-5 years",
        location: "Vienna, Austria",
        description: "42-piece wooden train set with tracks, bridge, station, and 3 train cars. Compatible with major wooden rail brands. Encourages creative track building.",
        image: "https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=500&h=400&fit=crop",
      },
      {
        title: "Plush Animal Collection (5 pcs)",
        price: 12.00,
        category: "toys",
        condition: "Good",
        age: "0-3 years",
        location: "Berlin, Germany",
        description: "Set of 5 soft plush animals: bear, bunny, elephant, giraffe, and fox. Each approx. 25cm tall. Machine washable. Well-loved but in good shape.",
        image: "https://images.unsplash.com/photo-1559715541-5daf8a0296d0?w=500&h=400&fit=crop",
      },
      {
        title: "Baby Doll with Stroller",
        price: 25.00,
        category: "toys",
        condition: "Like New",
        age: "3-6 years",
        location: "Madrid, Spain",
        description: "Realistic 40cm soft-body baby doll with folding stroller, bottle, and blanket. Doll has closing eyes and is dressed in removable outfit.",
        image: "https://images.unsplash.com/photo-1558060370-d644479cb6f7?w=500&h=400&fit=crop",
      },
      {
        title: "Remote Control Dinosaur",
        price: 18.00,
        category: "toys",
        condition: "Excellent",
        age: "4-8 years",
        location: "Dublin, Ireland",
        description: "Walking T-Rex with LED eyes, roaring sounds, and remote control. Moves forward, backward, and turns. Batteries included. A real crowd-pleaser!",
        image: "https://images.unsplash.com/photo-1535572290543-960a8046f5af?w=500&h=400&fit=crop",
      },
      {
        title: "Animal Memory Card Game",
        price: 8.00,
        category: "toys",
        condition: "Like New",
        age: "3-6 years",
        location: "Lisbon, Portugal",
        description: "48-card memory matching game with beautiful watercolor animal illustrations. Thick cardboard cards, durable for little hands. Great for concentration skills.",
        image: "https://images.unsplash.com/photo-1611371805429-8b5c1b2c34ba?w=500&h=400&fit=crop",
      },
      {
        title: "Wooden Xylophone",
        price: 14.00,
        category: "toys",
        condition: "Excellent",
        age: "1-4 years",
        location: "Copenhagen, Denmark",
        description: "Colorful 8-note xylophone with two wooden mallets. Clear, pleasant tones. Develops musical awareness and rhythm. Sturdy wooden frame.",
        image: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=500&h=400&fit=crop",
      },
      // === CLOTHES ===
      {
        title: "Organic Cotton Onesies (3-pack)",
        price: 16.00,
        category: "clothes",
        condition: "Like New",
        age: "0-6 months",
        location: "Luxembourg City, Luxembourg",
        description: "GOTS certified organic cotton onesies with nickel-free snap buttons. Gentle on sensitive skin. Pastel colors: mint, cream, and soft pink. Worn twice.",
        image: "https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=500&h=400&fit=crop",
      },
      {
        title: "Winter Puffer Jacket",
        price: 32.00,
        category: "clothes",
        condition: "Excellent",
        age: "4-5 years",
        location: "Zurich, Switzerland",
        description: "Warm, water-resistant puffer jacket in navy blue. Detachable hood, reflective strips, and cozy fleece lining. Machine washable. Very well maintained.",
        image: "https://images.unsplash.com/photo-1544022613-e87ca75a784a?w=500&h=400&fit=crop",
      },
      {
        title: "Floral Summer Dress",
        price: 14.00,
        category: "clothes",
        condition: "Like New",
        age: "3-4 years",
        location: "Barcelona, Spain",
        description: "Light cotton dress with delicate floral pattern. Adjustable tie straps and twirly skirt. Perfect for warm days. Worn only once for a photo.",
        image: "https://images.unsplash.com/photo-1518831959646-742c3a14ebf7?w=500&h=400&fit=crop",
      },
      {
        title: "Denim Overalls",
        price: 18.00,
        category: "clothes",
        condition: "Good",
        age: "2-3 years",
        location: "Milan, Italy",
        description: "Classic denim overalls with adjustable shoulder straps. Soft, pre-washed fabric. Multiple functional pockets. Light natural fading from regular wash.",
        image: "https://images.unsplash.com/photo-1522771930-78848d9293e8?w=500&h=400&fit=crop",
      },
      {
        title: "Raincoat & Boots Set",
        price: 28.00,
        category: "clothes",
        condition: "Excellent",
        age: "5-6 years",
        location: "Stockholm, Sweden",
        description: "Bright yellow raincoat with matching Wellington boots (EU size 30). Fully waterproof with taped seams. Reflective safety strips. Ready for puddle jumping!",
        image: "https://images.unsplash.com/photo-1504439468489-c8920d796a29?w=500&h=400&fit=crop",
      },
      {
        title: "Knitted Wool Sweater",
        price: 20.00,
        category: "clothes",
        condition: "Like New",
        age: "3-4 years",
        location: "Oslo, Norway",
        description: "Hand-knitted merino wool sweater in forest green with a leaf pattern. Incredibly soft and warm. Perfect for autumn and winter. No pilling or wear.",
        image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=500&h=400&fit=crop",
      },
      {
        title: "Cotton Pajama Set",
        price: 10.00,
        category: "clothes",
        condition: "Good",
        age: "4-5 years",
        location: "Prague, Czech Republic",
        description: "Soft cotton pajama top and bottoms with star and moon pattern. Comfortable fit for sleep. Some light pilling but very clean and functional.",
        image: "https://images.unsplash.com/photo-1519722417352-7d6959729417?w=500&h=400&fit=crop",
      },
      {
        title: "T-Shirt Bundle (5 pcs)",
        price: 15.00,
        category: "clothes",
        condition: "Excellent",
        age: "5-6 years",
        location: "Bratislava, Slovakia",
        description: "Five high-quality cotton t-shirts in assorted solid colors: white, navy, green, yellow, and red. All in excellent condition with vibrant colors.",
        image: "https://images.unsplash.com/photo-1523381294911-8d3cead13b3d?w=500&h=400&fit=crop",
      },
      {
        title: "Warm Hat & Mittens Set",
        price: 9.00,
        category: "clothes",
        condition: "Like New",
        age: "2-4 years",
        location: "Helsinki, Finland",
        description: "Fleece-lined knitted hat and mittens set. Mittens connected with a string so they don't get lost. Cream color with brown bear ears on the hat.",
        image: "https://images.unsplash.com/photo-1529958030586-3aae4ca485ff?w=500&h=400&fit=crop",
      },
      {
        title: "Sneakers (EU Size 28)",
        price: 16.00,
        category: "clothes",
        condition: "Good",
        age: "4-5 years",
        location: "Warsaw, Poland",
        description: "Lightweight kids running shoes with easy velcro closure. White and blue colorway. Some minor scuff marks on the toe area. Still plenty of life left.",
        image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500&h=400&fit=crop",
      },
      // === ACCESSORIES ===
      {
        title: "Kids Nature Backpack",
        price: 24.00,
        category: "accessories",
        condition: "Like New",
        age: "3-8 years",
        location: "Brussels, Belgium",
        description: "Eco-friendly backpack made from recycled materials with forest animal prints. Padded adjustable straps, front zip pocket, and inner name tag. 12L capacity.",
        image: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500&h=400&fit=crop",
      },
      {
        title: "Stainless Steel Lunch Box Set",
        price: 18.00,
        category: "accessories",
        condition: "Excellent",
        age: "3-10 years",
        location: "Amsterdam, Netherlands",
        description: "Three-compartment leak-proof stainless steel lunch box with matching 350ml water bottle. BPA-free silicone seals. Dishwasher safe. Perfect for school.",
        image: "https://images.unsplash.com/photo-1594027308808-24d523ecb4c9?w=500&h=400&fit=crop",
      },
      {
        title: "Hair Accessories Collection",
        price: 7.00,
        category: "accessories",
        condition: "Like New",
        age: "2-8 years",
        location: "Berlin, Germany",
        description: "Over 20 pieces: ribbon bows, snap clips, fabric headbands, and elastic bands in assorted colors. Gentle-grip, no-snag design. Comes in a reusable pouch.",
        image: "https://images.unsplash.com/photo-1590736969955-71cc94901144?w=500&h=400&fit=crop",
      },
      {
        title: "Kids Polarized Sunglasses",
        price: 12.00,
        category: "accessories",
        condition: "Like New",
        age: "3-8 years",
        location: "Lisbon, Portugal",
        description: "Two pairs of UV400 polarized sunglasses with flexible rubber frames. One round, one aviator style. Impact-resistant lenses. Comes with soft carrying cases.",
        image: "https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=500&h=400&fit=crop",
      },
      {
        title: "Complete Art Supply Kit",
        price: 20.00,
        category: "accessories",
        condition: "Excellent",
        age: "4-10 years",
        location: "Munich, Germany",
        description: "All-in-one art set in a wooden carrying case: 24 crayons, 18 colored pencils, 12 markers, 2 sketchpads, scissors, and glue. Over 60 pieces total.",
        image: "https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=500&h=400&fit=crop",
      },
      {
        title: "Bicycle Helmet (Size S)",
        price: 19.00,
        category: "accessories",
        condition: "Good",
        age: "4-8 years",
        location: "Vienna, Austria",
        description: "EN 1078 certified kids bike helmet with adjustable dial-fit system. 11 ventilation holes. Blue with star design. Minor cosmetic scratches only.",
        image: "https://images.unsplash.com/photo-1557803175-df172cf4dc10?w=500&h=400&fit=crop",
      },
      {
        title: "Kids Animal Umbrella",
        price: 10.00,
        category: "accessories",
        condition: "Like New",
        age: "3-10 years",
        location: "Paris, France",
        description: "Compact kids umbrella with cute cat ears and whiskers design. Easy-grip handle sized for small hands. Safety rounded tips. Comes with matching sleeve.",
        image: "https://images.unsplash.com/photo-1503602642458-232111445657?w=500&h=400&fit=crop",
      },
      {
        title: "Insulated Water Bottle",
        price: 8.00,
        category: "accessories",
        condition: "Excellent",
        age: "2-8 years",
        location: "Dublin, Ireland",
        description: "350ml double-wall insulated stainless steel bottle. Keeps drinks cold for 12 hours. Leak-proof flip-top lid. Mint green with woodland animal design.",
        image: "https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=500&h=400&fit=crop",
      },
    ];

    const batch = admin.firestore().batch();
    const now = Date.now();

    products.forEach((product, index) => {
      const docRef = admin.firestore().collection("listings").doc();
      batch.set(docRef, {
        ...product,
        seller: sellerEmail,
        sellerId: sellerId,
        sellerDisplayName: sellerDisplayName,
        status: "available",
        createdAt: admin.firestore.Timestamp.fromMillis(now - (index * 5400000)),
      });
    });

    await batch.commit();
    return { success: true, count: products.length };
  }
);
