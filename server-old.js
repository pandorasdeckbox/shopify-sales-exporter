import express from 'express';
import session from 'express-session';
import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { initDatabase, saveSession, getSession, deleteSession } from './database.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Initialize database
const dbUrl = process.env.DATABASE_URL || 'sqlite:sessions.db';
const db = initDatabase(dbUrl);

// Initialize Shopify API
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: (process.env.SCOPES || 'read_orders,read_products').split(','),
  hostName: process.env.APP_URL?.replace(/https?:\/\//, '') || 'localhost',
  hostScheme: 'https',
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
let sessionConfig = {
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: IS_PRODUCTION,
    httpOnly: true,
    sameSite: 'lax', // Allow cookies on OAuth redirects
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
};

// Use PostgreSQL session store in production
if (IS_PRODUCTION && dbUrl.startsWith('postgres')) {
  const pgSession = (await import('connect-pg-simple')).default;
  const PgStore = pgSession(session);
  sessionConfig.store = new PgStore({
    conString: dbUrl,
    tableName: 'user_sessions'
  });
}

app.use(session(sessionConfig));
app.use(express.static(path.join(__dirname, 'public')));

// No longer using in-memory session storage - using database
// Each shop's OAuth token is stored persistently

// Debug middleware
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.path} | Session ID: ${req.sessionID} | Shop: ${req.session.shop || 'none'}`);
  // Prevent caching
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// Routes
app.get('/', (req, res) => {
  const shop = req.query.shop;
  const host = req.query.host;
  
  console.log('Root route accessed | Shop:', shop, '| Host:', host);
  
  if (!shop) {
    console.log('No shop parameter, showing install form');
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  
  // Check if we have a session for this shop
  const session = getSession(shop);
  
  if (session) {
    console.log('Session found for shop, loading dashboard');
    // Store in express session
    req.session.shop = shop;
    req.session.accessToken = session.accessToken;
    req.session.save(() => {
      res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
    });
  } else {
    console.log('No session found, redirecting to OAuth');
    // No session, need to authenticate
    const redirectUrl = `/auth?shop=${encodeURIComponent(shop)}`;
    res.redirect(redirectUrl);
  }
});

// OAuth: Start installation
app.get('/auth', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).send('Missing shop parameter');
    }

    // shopify.auth.begin handles the redirect internally when rawResponse is provided
    await shopify.auth.begin({
      shop: shopify.utils.sanitizeShop(shop, true),
      callbackPath: '/auth/callback',
      isOnline: false,
      rawRequest: req,
      rawResponse: res,
    });
  } catch (error) {
    console.error('Auth error:', error);
    if (!res.headersSent) {
      res.status(500).send('Authentication failed');
    }
  }
});

// OAuth: Callback
app.get('/auth/callback', async (req, res) => {
  try {
    const callbackResponse = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    const { session } = callbackResponse;
    
    // Store session in database
    saveSession(session);
    req.session.shop = session.shop;
    req.session.accessToken = session.accessToken;

    console.log(`Successfully authenticated shop: ${session.shop}`);
    console.log('Session before save:', { id: req.sessionID, shop: req.session.shop, hasToken: !!req.session.accessToken });
    
    // Explicitly save session before redirecting
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).send('Failed to save session');
      }
      console.log('Session saved successfully, redirecting to dashboard with shop parameter');
      // Redirect to root with shop parameter so we can load from database
      res.redirect(`/?shop=${session.shop}`);
    });
  } catch (error) {
    console.error('Callback error:', error);
    res.status(500).send('Authentication callback failed');
  }
});

// Logout
app.get('/logout', (req, res) => {
  if (req.session.shop) {
    deleteSession(req.session.shop);
  }
  req.session.destroy();
  res.redirect('/');
});

// API: Get current shop info
app.get('/api/shop', async (req, res) => {
  try {
    if (!req.session.shop || !req.session.accessToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const session = getSession(req.session.shop);
    if (!session) {
      return res.status(401).json({ error: 'Session not found' });
    }

    const client = new shopify.clients.Rest({ session });
    const response = await client.get({ path: 'shop' });

    res.json(response.body.shop);
  } catch (error) {
    console.error('Error fetching shop:', error);
    res.status(500).json({ error: 'Failed to fetch shop info' });
  }
});

// API: Generate sales report
app.post('/api/reports/generate', async (req, res) => {
  try {
    if (!req.session.shop || !req.session.accessToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { startDate, endDate } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    const session = getSession(req.session.shop);
    if (!session) {
      return res.status(401).json({ error: 'Session not found' });
    }

    const client = new shopify.clients.Rest({ session });
    
    // Fetch orders within date range
    const orders = await fetchAllOrders(client, startDate, endDate);
    
    // Generate report data
    const reportData = generateReportData(orders);
    
    res.json(reportData);
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// Helper: Fetch all orders with pagination
async function fetchAllOrders(client, startDate, endDate) {
  let allOrders = [];
  let params = {
    status: 'any',
    created_at_min: new Date(startDate).toISOString(),
    created_at_max: new Date(endDate).toISOString(),
    limit: 250,
    fields: 'id,created_at,total_price,currency,line_items,financial_status,customer'
  };

  let hasNextPage = true;
  let pageInfo = null;

  while (hasNextPage) {
    try {
      const queryParams = pageInfo 
        ? { ...params, page_info: pageInfo }
        : params;

      const response = await client.get({
        path: 'orders',
        query: queryParams
      });

      const orders = response.body.orders || [];
      allOrders = allOrders.concat(orders);

      // Check for next page
      const linkHeader = response.headers.get('link');
      if (linkHeader && linkHeader.includes('rel="next"')) {
        const match = linkHeader.match(/<[^>]*page_info=([^>&]+)[^>]*>;\s*rel="next"/);
        pageInfo = match ? match[1] : null;
        hasNextPage = !!pageInfo;
      } else {
        hasNextPage = false;
      }

      // Rate limiting: wait a bit between requests
      if (hasNextPage) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
      hasNextPage = false;
    }
  }

  return allOrders;
}

// Helper: Generate report data from orders
function generateReportData(orders) {
  const summary = {
    totalOrders: orders.length,
    totalRevenue: 0,
    totalCOGS: 0,
    totalProfit: 0,
    ordersByStatus: {},
    productSales: {},
    dailySales: {}
  };

  const orderDetails = [];

  orders.forEach(order => {
    const orderRevenue = parseFloat(order.total_price) || 0;
    let orderCOGS = 0;

    // Calculate COGS from line items
    const lineItemDetails = order.line_items.map(item => {
      const itemCOGS = parseFloat(item.variant_id?.cost || 0) * item.quantity;
      orderCOGS += itemCOGS;

      const itemRevenue = parseFloat(item.price) * item.quantity;
      const itemProfit = itemRevenue - itemCOGS;

      // Track product sales
      const productKey = item.name;
      if (!summary.productSales[productKey]) {
        summary.productSales[productKey] = {
          quantity: 0,
          revenue: 0,
          cogs: 0,
          profit: 0
        };
      }
      summary.productSales[productKey].quantity += item.quantity;
      summary.productSales[productKey].revenue += itemRevenue;
      summary.productSales[productKey].cogs += itemCOGS;
      summary.productSales[productKey].profit += itemProfit;

      return {
        name: item.name,
        sku: item.sku,
        quantity: item.quantity,
        price: parseFloat(item.price),
        total: itemRevenue,
        cogs: itemCOGS,
        profit: itemProfit
      };
    });

    const orderProfit = orderRevenue - orderCOGS;

    // Update summary
    summary.totalRevenue += orderRevenue;
    summary.totalCOGS += orderCOGS;
    summary.totalProfit += orderProfit;

    // Track by status
    const status = order.financial_status || 'unknown';
    summary.ordersByStatus[status] = (summary.ordersByStatus[status] || 0) + 1;

    // Track daily sales
    const date = new Date(order.created_at).toISOString().split('T')[0];
    if (!summary.dailySales[date]) {
      summary.dailySales[date] = {
        orders: 0,
        revenue: 0,
        cogs: 0,
        profit: 0
      };
    }
    summary.dailySales[date].orders += 1;
    summary.dailySales[date].revenue += orderRevenue;
    summary.dailySales[date].cogs += orderCOGS;
    summary.dailySales[date].profit += orderProfit;

    // Store order details
    orderDetails.push({
      id: order.id,
      orderNumber: order.name || order.order_number,
      createdAt: order.created_at,
      customer: order.customer?.email || 'Guest',
      status: status,
      revenue: orderRevenue,
      cogs: orderCOGS,
      profit: orderProfit,
      currency: order.currency,
      lineItems: lineItemDetails
    });
  });

  return {
    summary,
    orders: orderDetails
  };
}

// API: Export report to CSV
app.post('/api/reports/export', async (req, res) => {
  try {
    if (!req.session.shop || !req.session.accessToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { reportData, format } = req.body;
    
    if (!reportData) {
      return res.status(400).json({ error: 'Report data is required' });
    }

    const csv = generateCSV(reportData);
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="sales-report-${Date.now()}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting report:', error);
    res.status(500).json({ error: 'Failed to export report' });
  }
});

// Helper: Generate CSV from report data
function generateCSV(reportData) {
  const lines = [];
  
  // Header
  lines.push('Order ID,Order Number,Date,Customer,Status,Revenue,COGS,Profit,Currency');
  
  // Data rows
  reportData.orders.forEach(order => {
    lines.push([
      order.id,
      order.orderNumber,
      order.createdAt,
      order.customer,
      order.status,
      order.revenue.toFixed(2),
      order.cogs.toFixed(2),
      order.profit.toFixed(2),
      order.currency
    ].join(','));
  });
  
  // Add summary
  lines.push('');
  lines.push('SUMMARY');
  lines.push(`Total Orders,${reportData.summary.totalOrders}`);
  lines.push(`Total Revenue,$${reportData.summary.totalRevenue.toFixed(2)}`);
  lines.push(`Total COGS,$${reportData.summary.totalCOGS.toFixed(2)}`);
  lines.push(`Total Profit,$${reportData.summary.totalProfit.toFixed(2)}`);
  lines.push(`Profit Margin,${((reportData.summary.totalProfit / reportData.summary.totalRevenue) * 100).toFixed(2)}%`);
  
  return lines.join('\n');
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Shopify Sales Exporter running on port ${PORT}`);
  console.log(`App URL: ${process.env.APP_URL || `http://localhost:${PORT}`}`);
});
