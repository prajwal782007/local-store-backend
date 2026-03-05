require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Product = require("./models/product");
const Store = require("./models/store");
const Order = require("./models/order");

const app = express();

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());

// ================= DATABASE =================
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("MongoDB Atlas Connected"))
.catch((err) => console.log("Database Error:", err));


// ================= AUTH MIDDLEWARE =================
const authMiddleware = (req, res, next) => {

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

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

    res.status(500).json({ error: "Error logging in" });

  }

});


// ================= ADD PRODUCT =================
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

    res.status(500).json({ error: "Error adding product" });

  }

});


// ================= GET PRODUCTS =================
app.get("/products", async (req, res) => {

  try {

    const products = await Product.find()
      .populate("store", "name email");

    res.json(products);

  } catch (error) {

    res.status(500).json({ error: "Error fetching products" });

  }

});


// ================= PLACE ORDER =================
app.post("/place-order", async (req, res) => {

  try {

    const { storeId, products } = req.body;

    const store = await Store.findById(storeId);

    if (!store) {
      return res.status(404).json({ error: "Store not found" });
    }

    if (!store.isOpen) {
      return res.status(400).json({
        error: "Online ordering is closed"
      });
    }

    let totalAmount = 0;

    for (let item of products) {

      const productData = await Product.findById(item.product);

      if (!productData) {
        return res.status(400).json({ error: "Product not found" });
      }

      if (productData.stock < item.quantity) {
        return res.status(400).json({
          error: `Not enough stock for ${productData.name}`
        });
      }

      productData.stock -= item.quantity;

      await productData.save();

      totalAmount += productData.price * item.quantity;

    }

    const newOrder = new Order({
      store: storeId,
      products,
      totalAmount,
      status: "pending",
      otp: null,
      bagNumber: null
    });

    await newOrder.save();

    res.json({
      message: "Order placed successfully",
      orderId: newOrder._id
    });

  } catch (error) {

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

    res.status(500).json({ error: "Error fetching orders" });

  }

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

    if (order.status !== "pending") {
      return res.status(400).json({ error: "Order already processed" });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const bagNumber = Math.floor(1 + Math.random() * 100);

    order.status = "accepted";
    order.otp = otp;
    order.bagNumber = bagNumber;

    await order.save();

    res.json({
      message: "Order accepted",
      otp,
      bagNumber
    });

  } catch (error) {

    res.status(500).json({ error: "Error accepting order" });

  }

});


// ================= COMPLETE ORDER =================
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

    res.status(500).json({ error: "Error completing order" });

  }

});


// ================= ORDER STATUS =================
app.get("/order-status/:orderId", async (req, res) => {

  try {

    const order = await Order.findById(req.params.orderId);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json({
      status: order.status,
      otp: order.otp,
      bagNumber: order.bagNumber
    });

  } catch (error) {

    res.status(500).json({ error: "Error fetching order status" });

  }

});


// ================= TOGGLE STORE =================
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


// ================= ALL STORES =================
app.get("/all-stores", async (req, res) => {

  try {

    const stores = await Store.find();

    res.json(stores);

  } catch (err) {

    res.status(500).json({ error: "Error fetching stores" });

  }

});


// ================= START SERVER =================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});