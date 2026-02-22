require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Product = require("./models/product");
const Store = require("./models/Store");
const Order = require("./models/Order");

const app = express();

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());

// ================= DATABASE =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB Atlas Connected");
  })
  .catch((err) => {
    console.log("Database Error:", err);
  });
// ================= AUTH MIDDLEWARE =================
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, "secretkey");
    req.storeId = decoded.id;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

// ================= TEST ROUTE =================
app.get("/", (req, res) => {
  res.send("Backend + Database Working!");
});

// ================= STORE REGISTER =================
app.post("/store-register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingStore = await Store.findOne({ email });
    if (existingStore) {
      return res.status(400).json({ error: "Store already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newStore = new Store({
      name,
      email,
      password: hashedPassword
    });

    await newStore.save();

    res.json({ message: "Store Registered Successfully" });

  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error registering store" });
  }
});

// ================= STORE LOGIN =================
app.post("/store-login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const store = await Store.findOne({ email });
    if (!store) {
      return res.status(400).json({ error: "Store not found" });
    }

    const isMatch = await bcrypt.compare(password, store.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid password" });
    }

    const token = jwt.sign(
      { id: store._id },
      "secretkey",
      { expiresIn: "1d" }
    );

    res.json({
      message: "Login successful",
      token
    });

  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error logging in" });
  }
});

// ================= ADD PRODUCT (PROTECTED) =================
app.post("/add-product", authMiddleware, async (req, res) => {
  try {
    const { name, price, stock } = req.body;

    const newProduct = new Product({
      name,
      price,
      stock,
      store: req.storeId
    });

    await newProduct.save();

    res.json({ message: "Product Added Successfully" });

  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error adding product" });
  }
});

// ================= GET PRODUCTS =================
app.get("/products", async (req, res) => {
  try {
    const products = await Product.find().populate("store", "name email");
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: "Error fetching products" });
  }
});

// ================= START SERVER =================
// ================= PLACE ORDER =================

app.post("/place-order", async (req, res) => {
  try {
    const { storeId, products } = req.body;
// Check if store is open
const store = await Store.findById(storeId);

if (!store) {
  return res.status(404).json({ error: "Store not found" });
}

if (!store.isOpen) {
  return res.status(400).json({
    error: "Online ordering is closed. You can visit the store."
  });
}
    let totalAmount = 0;

    for (let item of products) {
      const productData = await Product.findById(item.product);

      if (!productData) {
        return res.status(400).json({ error: "Product not found" });
      }

      // Check stock
      if (productData.stock < item.quantity) {
        return res.status(400).json({
          error: `Not enough stock for ${productData.name}`
        });
      }

      // Reduce stock
      productData.stock -= item.quantity;
      await productData.save();

      totalAmount += productData.price * item.quantity;
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const bagNumber = Math.floor(1 + Math.random() * 100);

    const newOrder = new Order({
      store: storeId,
      products,
      totalAmount,
      otp,
      bagNumber
    });

    await newOrder.save();

    res.json({
      message: "Order placed successfully",
      totalAmount,
      bagNumber,
      otp
    });

  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error placing order" });
  }
});
// ================= GET STORE ORDERS =================
app.get("/store-orders", authMiddleware, async (req, res) => {
  try {
    const orders = await Order.find({ store: req.storeId })
      .populate("products.product");

    res.json(orders);

  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error fetching orders" });
  }
});
app.get("/test-route", (req, res) => {
  res.send("Test working");
});
// ================= ACCEPT ORDER =================
app.patch("/accept-order/:orderId", authMiddleware, async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.orderId,
      store: req.storeId
    });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    order.status = "accepted";
    await order.save();

    res.json({ message: "Order accepted successfully" });

  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error accepting order" });
  }
});
// ================= COMPLETE ORDER (OTP VERIFY) =================
app.patch("/complete-order/:orderId", authMiddleware, async (req, res) => {
  try {
    const { otp } = req.body;

    const order = await Order.findOne({
      _id: req.params.orderId,
      store: req.storeId
    });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.otp !== otp) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    order.status = "completed";
    await order.save();

    res.json({ message: "Order completed successfully" });

  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error completing order" });
  }
});
// ================= DAILY REVENUE =================
app.get("/daily-revenue", authMiddleware, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const revenue = await Order.aggregate([
      {
        $match: {
          store: new mongoose.Types.ObjectId(req.storeId),
          status: "completed",
          createdAt: { $gte: today }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$totalAmount" }
        }
      }
    ]);

    res.json({
      totalRevenue: revenue[0]?.totalRevenue || 0
    });

  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error calculating revenue" });
  }
});
app.patch("/toggle-store", authMiddleware, async (req, res) => {
  try {
    const store = await Store.findById(req.storeId);

    store.isOpen = !store.isOpen;
    await store.save();

    res.json({
      message: `Store is now ${store.isOpen ? "Open" : "Closed"}`
    });

  } catch (error) {
    res.status(500).json({ error: "Error updating store status" });
  }
});
app.get("/all-stores", async (req, res) => {
  try {
    const stores = await Store.find();
    res.json(stores);
  } catch (err) {
    res.status(500).json({ error: "Error fetching stores" });
  }
}); 
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});