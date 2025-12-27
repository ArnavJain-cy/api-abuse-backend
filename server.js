// server/server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const redis = require('redis');

const app = express();

/* ---------------- MIDDLEWARE ---------------- */
// import cors from "cors";

app.use(cors({
  origin: "http://localhost:3000",
  credentials: true
}));


/* ---------------- DATABASE ---------------- */
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error(err));

/* ---------------- REDIS ---------------- */
const redisClient = redis.createClient({
  url: process.env.REDIS_URL
});
redisClient.connect().then(() => console.log("✅ Reddis Connected"))
.catch(err => console.error(err));
// Add this temporary route to clear Redis

app.get('/reset-redis', async (req, res) => {
  try {
      // This deletes ALL keys in Redis (flushdb)
      await redisClient.flushDb(); 
      res.send("✅ Redis memory cleared! You are no longer banned.");
      console.log('Redis memory cleared! You are no longer banned.')
  } catch (error) {
      res.status(500).send("Error clearing Redis: " + error.message);
  }
});

/* ---------------- MODELS ---------------- */
const Log = mongoose.model('Log', new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  ip: String,
  endpoint: String,
  method: String,
  status: Number
}));

const Alert = mongoose.model('Alert', new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  ip: String,
  type: String,
  severity: String
}));

/* ---------------- RATE LIMITER ---------------- */
const rateLimiter = async (req, res, next) => {
    // Skip rate limiting for dashboard and reset endpoints
    if (req.path.startsWith('/dashboard') || req.path === '/reset-redis') {
      return next();
    }
  const ip = req.ip;
  const key = `rate:${ip}`;

  const blocked = await redisClient.get(`blocked:${ip}`);
  if (blocked) return res.status(403).json({ error: "IP Blocked" });

  const count = await redisClient.incr(key);
  if (count === 1) await redisClient.expire(key, 60);

  if (count > 100) {
    await redisClient.set(`blocked:${ip}`, "true");
    await new Alert({
      ip,
      type: "Rate Limit Exceeded",
      severity: "High"
    }).save();
    return res.status(429).json({ error: "Too Many Requests" });
  }
  next();
};

app.use(rateLimiter);

/* ---------------- LOGGER ---------------- */
app.use((req, res, next) => {
  const oldSend = res.send;
  res.send = function (data) {
    new Log({
      ip: req.ip,
      endpoint: req.originalUrl,
      method: req.method,
      status: res.statusCode
    }).save();
    oldSend.apply(res, arguments);
  };
  next();
});

/* ---------------- MOCK APIs ---------------- */
app.get('/api/balance', (_, res) => {
  setTimeout(() => res.json({ balance: 5000, currency: "USD" }), 100);
});

app.post('/api/transaction', (_, res) => {
  if (Math.random() > 0.9) return res.status(500).json({ error: "Failed" });
  res.json({ status: "Success" });
});

/* ---------------- DASHBOARD ---------------- */
app.get('/dashboard/stats', async (_, res) => {
  const logs = await Log.find().sort({ timestamp: -1 }).limit(50);
  const alerts = await Alert.find().sort({ timestamp: -1 }).limit(10);
  res.json({ logs, alerts });
});

/* ---------------- START ---------------- */
app.listen(5000, () => {
  console.log("🚀 Server running on http://localhost:5000");
});
