/**
 * Shopify COGS Sales Exporter - Embedded App
 * 
 * A free Shopify app that generates sales reports with Cost of Goods Sold (COGS)
 * and profit margin calculations - something Shopify doesn't natively provide.
 * 
 * Key Features:
 * - Fetches orders via GraphQL API to access product cost data
 * - Calculates COGS, revenue, and profit margins
 * - Provides daily/monthly breakdowns and product-level analysis
 * - Exports to CSV for further analysis
 * 
 * Technical Highlights:
 * - Custom OAuth flow bypassing cookie restrictions in embedded iframes
 * - GraphQL API for efficient cost data retrieval (REST API lacks this data)
 * - SQLite session storage for offline access tokens
 * - Simplified authentication using shop query parameters
 * 
 * Architecture: Embedded Shopify app (runs in admin iframe)
 */

import express from 'express';
import { shopifyApi, LogSeverity, ApiVersion, Session } from '@shopify/shopify-api';
import { SQLiteSessionStorage } from '@shopify/shopify-app-session-storage-sqlite';
import '@shopify/shopify-api/adapters/node';
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import pg from 'pg';

dotenv.config();

// In-memory storage for OAuth state (bypasses cookie restrictions in embedded apps)
const oauthStateStorage = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Initialize session storage
// Use PostgreSQL on Railway (ephemeral filesystem loses SQLite), SQLite for local dev
let sessionStorage;

if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres')) {
  // PostgreSQL session storage for Railway
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false,
  });

  // Create sessions table if it doesn't exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shopify_sessions (
      id TEXT PRIMARY KEY,
      shop TEXT NOT NULL,
      state TEXT,
      is_online BOOLEAN DEFAULT FALSE,
      scope TEXT,
      expires INTEGER,
      access_token TEXT,
      online_access_info TEXT
    )
  `);
  console.log('✅ PostgreSQL session storage initialized');

  // Custom PostgreSQL session storage adapter (implements Shopify SessionStorage interface)
  sessionStorage = {
    async storeSession(session) {
      await pool.query(
        `INSERT INTO shopify_sessions (id, shop, state, is_online, scope, expires, access_token)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           shop = EXCLUDED.shop,
           state = EXCLUDED.state,
           is_online = EXCLUDED.is_online,
           scope = EXCLUDED.scope,
           expires = EXCLUDED.expires,
           access_token = EXCLUDED.access_token`,
        [session.id, session.shop, session.state, session.isOnline, session.scope, session.expires, session.accessToken]
      );
      return true;
    },
    async loadSession(id) {
      const result = await pool.query('SELECT * FROM shopify_sessions WHERE id = $1', [id]);
      if (result.rows.length === 0) return undefined;
      const row = result.rows[0];
      return new Session({
        id: row.id,
        shop: row.shop,
        state: row.state,
        isOnline: row.is_online,
        scope: row.scope,
        expires: row.expires ? new Date(row.expires) : undefined,
        accessToken: row.access_token,
      });
    },
    async deleteSession(id) {
      await pool.query('DELETE FROM shopify_sessions WHERE id = $1', [id]);
      return true;
    },
    async deleteSessions(ids) {
      await pool.query('DELETE FROM shopify_sessions WHERE id = ANY($1)', [ids]);
      return true;
    },
    async findSessionsByShop(shop) {
      const result = await pool.query('SELECT * FROM shopify_sessions WHERE shop = $1', [shop]);
      return result.rows.map(row => new Session({
        id: row.id,
        shop: row.shop,
        state: row.state,
        isOnline: row.is_online,
        scope: row.scope,
        expires: row.expires ? new Date(row.expires) : undefined,
        accessToken: row.access_token,
      }));
    },
  };
} else {
  // SQLite for local development
  sessionStorage = new SQLiteSessionStorage('sessions.db');
  console.log('✅ SQLite session storage initialized (local dev)');
}

// Initialize Shopify API
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: ['read_all_orders', 'read_products', 'read_inventory'],
  hostName: process.env.APP_URL?.replace(/https?:\/\//, '') || 'localhost',
  hostScheme: 'https',
  apiVersion: ApiVersion.January24,
  isEmbeddedApp: true,
  sessionStorage: sessionStorage,
  logger: { level: IS_PRODUCTION ? LogSeverity.Warning : LogSeverity.Debug },
  useOnlineTokens: false, // Use offline tokens to avoid cookie issues
});

// Middleware
app.use(express.json({ limit: '50mb' })); // Increase limit for large report data
app.use(express.static(path.join(__dirname, 'public')));

// Trust proxy when behind Railway's load balancer
if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}

// Health check endpoint for Railway
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root route - always serve dashboard for embedded apps
app.get('/', (req, res) => {
  const shop = req.query.shop;
  const host = req.query.host;
  
  console.log('Root route | Shop:', shop, 'Host:', host);
  
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }
  
  // For embedded apps, always serve the dashboard
  // App Bridge will handle authentication
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Alternative route to bust cache - use this as App URL in Partner Dashboard
app.get('/app', async (req, res) => {
  const shop = req.query.shop;
  const host = req.query.host;
  
  console.log('/app route | Shop:', shop, 'Host:', host);
  
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }
  
  // Check if we have a valid session
  const sessionId = `offline_${shop}`;
  const session = await sessionStorage.loadSession(sessionId);
  
  if (!session) {
    console.log('No session found, redirecting to OAuth...');
    // Redirect to OAuth flow
    return res.redirect(`/auth?shop=${shop}${host ? `&host=${host}` : ''}`);
  }
  
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Exit iframe for OAuth (needed for embedded apps with cookie restrictions)
app.get('/exitiframe', async (req, res) => {
  const shop = req.query.shop;
  
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }
  
  const redirectUri = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}/auth?shop=${shop}`;
  
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <script>
          window.top.location.href = '${redirectUri}';
        </script>
      </head>
      <body>
        Redirecting...
      </body>
    </html>
  `);
});

/**
 * OAuth Routes - Custom Implementation
 * 
 * Why custom OAuth? Embedded apps run in iframes which block third-party cookies.
 * The standard @shopify/shopify-api OAuth flow relies on cookies for state management,
 * which fails in embedded contexts. This implementation uses in-memory storage instead.
 */
app.get('/auth', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).send('Missing shop parameter');
    }

    const sanitizedShop = shopify.utils.sanitizeShop(shop, true);
    console.log('Starting OAuth for shop:', sanitizedShop);
    
    // Generate random state for CSRF protection
    const state = Math.random().toString(36).substring(7) + Date.now();
    
    // Store state in memory (bypasses cookie restrictions in iframes)
    oauthStateStorage.set(sanitizedShop, state);
    console.log('Stored OAuth state for shop:', sanitizedShop);
    
    // Build OAuth authorization URL manually
    const authUrl = `https://${sanitizedShop}/admin/oauth/authorize?` + new URLSearchParams({
      client_id: process.env.SHOPIFY_API_KEY,
      scope: 'read_all_orders,read_products,read_inventory',
      redirect_uri: `${process.env.APP_URL}/auth/callback`,
      state: state,
    }).toString();
    
    console.log('Redirecting to:', authUrl);
    res.redirect(authUrl);
  } catch (error) {
    console.error('Auth error:', error);
    if (!res.headersSent) {
      res.status(500).send('Authentication failed: ' + error.message);
    }
  }
});

app.get('/auth/callback', async (req, res) => {
  try {
    console.log('OAuth callback received');
    console.log('Query params:', req.query);
    
    const { shop, code, state } = req.query;
    
    if (!shop || !code || !state) {
      throw new Error('Missing required parameters');
    }
    
    const sanitizedShop = shopify.utils.sanitizeShop(shop, true);
    
    // Verify state to prevent CSRF
    const storedState = oauthStateStorage.get(sanitizedShop);
    if (storedState !== state) {
      throw new Error('Invalid state parameter');
    }
    
    // Clean up used state
    oauthStateStorage.delete(sanitizedShop);
    
    console.log('State verified, exchanging code for access token...');
    
    // Exchange code for access token
    const tokenResponse = await fetch(`https://${sanitizedShop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code: code,
      }),
    });
    
    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
    }
    
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    const scope = tokenData.scope;
    
    console.log('✅ Access token received');
    console.log('   Scope:', scope);
    
    // Delete any existing session for this shop to ensure clean reinstall
    const oldSessionId = `offline_${sanitizedShop}`;
    await sessionStorage.deleteSession(oldSessionId);
    console.log('🗑️  Cleared old session (if existed)');
    
    // Create and save session manually
    const sessionId = `offline_${sanitizedShop}`;
    const session = new Session({
      id: sessionId,
      shop: sanitizedShop,
      state: state,
      isOnline: false,
      accessToken: accessToken,
      scope: scope,
    });
    
    await sessionStorage.storeSession(session);
    console.log('✅ Session saved to database');
    console.log('   Session ID:', sessionId);
    
    // Redirect to app
    const host = req.query.host;
    const redirectUrl = `/app?shop=${sanitizedShop}${host ? `&host=${host}` : ''}`;
    console.log('   Redirecting to:', redirectUrl);
    
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('❌ Callback error:', error.message);
    console.error('   Stack:', error.stack);
    res.status(500).send('Authentication callback failed: ' + error.message);
  }
});

// Session verification middleware - simplified for embedded apps
async function verifySession(req, res, next) {
  try {
    // Get shop from query parameter
    const shop = req.query.shop || req.body.shop;
    
    if (!shop) {
      console.error('❌ Missing shop parameter');
      return res.status(401).json({ error: 'Missing shop parameter', needsReauth: true });
    }

    console.log('\n🔍 Verifying session for shop:', shop);
    
    // For offline sessions, the session ID is 'offline_' + shop domain
    const sessionId = `offline_${shop}`;
    console.log('   Looking up session ID:', sessionId);
    
    // Get the full session from storage
    const storedSession = await sessionStorage.loadSession(sessionId);
    if (!storedSession) {
      console.error('❌ Session not found for ID:', sessionId);
      return res.status(401).json({ 
        error: 'Session not found - redirecting to OAuth', 
        needsReauth: true,
        authUrl: `/auth?shop=${shop}`
      });
    }

    console.log('✅ Session found:', {
      shop: storedSession.shop,
      hasAccessToken: !!storedSession.accessToken,
      scope: storedSession.scope,
      isOnline: storedSession.isOnline
    });
    req.shopifySession = storedSession;
    next();
  } catch (error) {
    console.error('Session token verification failed:', error);
    return res.status(401).json({ 
      error: 'Invalid session token',
      needsReauth: true,
      authUrl: `/auth?shop=${req.query.shop}`
    });
  }
}

// API: Get current shop info
app.get('/api/shop', verifySession, async (req, res) => {
  try {
    console.log('\n📡 Fetching shop info...');
    console.log('   Session:', {
      shop: req.shopifySession.shop,
      hasAccessToken: !!req.shopifySession.accessToken,
      accessToken: req.shopifySession.accessToken ? req.shopifySession.accessToken.substring(0, 20) + '...' : 'missing'
    });
    
    const client = new shopify.clients.Rest({ session: req.shopifySession });
    console.log('   REST client created, making API call...');
    
    const response = await client.get({ path: 'shop' });
    console.log('✅ Shop info retrieved:', response.body.shop.name);
    
    res.json(response.body.shop);
  } catch (error) {
    console.error('❌ Error fetching shop:');
    console.error('   Error message:', error.message);
    console.error('   Error stack:', error.stack);
    if (error.response) {
      console.error('   Response status:', error.response.statusCode);
      console.error('   Response body:', error.response.body);
    }
    
    // If it's a 401 error, trigger reauth
    if (error.message.includes('401 Unauthorized') || error.message.includes('Invalid API key or access token')) {
      const shop = req.query.shop || req.shopifySession?.shop;
      console.log('🔄 Triggering reauth for shop:', shop);
      return res.status(401).json({
        error: 'Session invalid - redirecting to OAuth',
        needsReauth: true,
        authUrl: `/auth?shop=${shop}`
      });
    }
    
    res.status(500).json({ error: 'Failed to fetch shop info' });
  }
});

// API: Get oldest order date
app.get('/api/oldest-order', verifySession, async (req, res) => {
  try {
    console.log('\n📅 Fetching oldest order date...');
    const client = new shopify.clients.Graphql({ session: req.shopifySession });
    
    // With read_all_orders scope, we can now query all historical orders
    // Sort by CREATED_AT ascending (oldest first) and get the first one
    const query = `
      query {
        orders(first: 1, sortKey: CREATED_AT, reverse: false) {
          nodes {
            createdAt
            name
          }
        }
      }
    `;
    
    const response = await client.request(query);
    const orders = response.data.orders.nodes;
    
    console.log('   GraphQL orders returned:', orders.length);
    if (orders.length > 0) {
      console.log('   ✅ Oldest order found:', orders[0].name);
      console.log('   📆 Date:', orders[0].createdAt);
      res.json({ oldestOrderDate: orders[0].createdAt });
    } else {
      console.log('   No orders found in store');
      // Default to current date if no orders exist
      res.json({ oldestOrderDate: new Date().toISOString() });
    }
  } catch (error) {
    console.error('❌ Error fetching oldest order:', error.message);
    res.status(500).json({ error: 'Failed to fetch oldest order' });
  }
});

// API: Generate report
app.post('/api/generate-report', verifySession, async (req, res) => {
  try {
    const { startDate, endDate, cogsRules, zeroCOGSOverride } = req.body;
    const session = req.shopifySession;

    console.log('\n📊 Generating report...');
    console.log('   Shop:', session.shop);
    console.log('   Date range:', startDate, 'to', endDate);
    if (cogsRules && cogsRules.length > 0) {
      console.log('   COGS Rules:', cogsRules);
    }
    if (zeroCOGSOverride !== null && zeroCOGSOverride !== undefined) {
      console.log('   Zero COGS Override:', zeroCOGSOverride + '%');
    }

    // Fetch orders
    console.log('   Fetching orders from Shopify API...');
    const orders = await fetchAllOrders(session, startDate, endDate);
    console.log(`   Retrieved ${orders.length} orders`);
    
    console.log('   Calculating COGS and profit...');
    const reportData = generateReportData(orders, cogsRules || [], zeroCOGSOverride, startDate, endDate);
    console.log('✅ Report generated successfully');

    res.json(reportData);
  } catch (error) {
    console.error('❌ Error generating report:');
    console.error('   Error message:', error.message);
    console.error('   Error stack:', error.stack);
    if (error.response) {
      console.error('   Response status:', error.response.statusCode);
      console.error('   Response body:', error.response.body);
    }
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// API: Export to CSV
app.post('/api/export-csv', verifySession, async (req, res) => {
  try {
    const { reportData, cogsRules, zeroCOGSOverride } = req.body;
    const csv = generateCSV(reportData, cogsRules || [], zeroCOGSOverride);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=sales-report.csv');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting CSV:', error);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

// API: Export to Excel with sheets per source
app.post('/api/export-excel', verifySession, async (req, res) => {
  try {
    const { reportData, cogsRules, zeroCOGSOverride } = req.body;
    
    if (!reportData || !reportData.rawOrders) {
      throw new Error('Invalid report data');
    }
    
    // Group orders by source
    const ordersBySource = {};
    reportData.rawOrders.forEach(order => {
      const source = order.source || 'Unknown';
      if (!ordersBySource[source]) {
        ordersBySource[source] = [];
      }
      ordersBySource[source].push(order);
    });
    
    // Create workbook
    const workbook = XLSX.utils.book_new();
    
    // Create a sheet for each source
    for (const source of Object.keys(ordersBySource)) {
      const sourceOrders = ordersBySource[source];
      const sheetData = generateSheetData(sourceOrders, cogsRules || [], zeroCOGSOverride);
      const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
      
      // Sanitize sheet name (max 31 chars, no special chars)
      const safeSheetName = source.replace(/[\[\]\*\?\/\\:]/g, '-').substring(0, 31);
      XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName);
    }
    
    // Generate buffer
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=sales-report.xlsx');
    res.send(excelBuffer);
  } catch (error) {
    console.error('Error exporting Excel:', error);
    res.status(500).json({ error: 'Failed to export Excel' });
  }
});

/**
 * Fetch Orders with COGS Data
 * 
 * Uses GraphQL API instead of REST because:
 * 1. REST Orders API doesn't include line item cost data
 * 2. Fetching costs individually via REST hits severe rate limits (2 calls/second)
 * 3. GraphQL can batch fetch orders WITH costs in single efficient queries
 * 
 * The query fetches variant.inventoryItem.unitCost which contains the product's
 * cost of goods sold - the key feature that makes this app valuable!
 * 
 * Note: Customer fields removed because app doesn't request read_customers scope.
 * Keeping scopes minimal improves security and speeds up app review.
 */
async function fetchAllOrders(session, startDate, endDate) {
  const client = new shopify.clients.Graphql({ session });
  let allOrders = [];
  let hasNextPage = true;
  let cursor = null;

  // GraphQL query fetching orders with embedded cost data
  const query = `
    query getOrders($query: String!, $cursor: String) {
      orders(first: 50, query: $query, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          name
          createdAt
          channelInformation {
            channelDefinition {
              channelName
            }
          }
          totalPriceSet {
            shopMoney {
              amount
            }
          }
          subtotalPriceSet {
            shopMoney {
              amount
            }
          }
          totalShippingPriceSet {
            shopMoney {
              amount
            }
          }
          totalTaxSet {
            shopMoney {
              amount
            }
          }
          totalDiscountsSet {
            shopMoney {
              amount
            }
          }
          totalRefundedSet {
            shopMoney {
              amount
            }
          }
          note
          displayFinancialStatus
          lineItems(first: 50) {
            nodes {
              id
              name
              quantity
              originalUnitPriceSet {
                shopMoney {
                  amount
                }
              }
              variant {
                id
                inventoryItem {
                  unitCost {
                    amount
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  // Use exclusive upper bound (< next day) to avoid ambiguous end-of-day boundary
  const endDateObj = new Date(endDate + 'T00:00:00Z');
  endDateObj.setUTCDate(endDateObj.getUTCDate() + 1);
  const nextDay = endDateObj.toISOString().split('T')[0];
  const queryString = `created_at:>='${startDate}' AND created_at:<'${nextDay}'`;
  
  console.log('   GraphQL query filter:', queryString);

  while (hasNextPage) {
    try {
      const response = await client.request(query, {
        variables: {
          query: queryString,
          cursor
        }
      });

      const data = response.data.orders;
      const orders = data.nodes;
      
      // Transform GraphQL response to REST-like format for compatibility with existing code
      // Key insight: Extract unitCost.amount from GraphQL and map to 'cost' field
      const transformedOrders = orders.map(order => ({
        id: order.id,
        name: order.name,
        order_number: order.name.replace('#', ''),
        created_at: order.createdAt,
        total_price: order.totalPriceSet.shopMoney.amount,
        subtotal_price: order.subtotalPriceSet?.shopMoney?.amount || '0',
        total_shipping: order.totalShippingPriceSet?.shopMoney?.amount || '0',
        total_tax: order.totalTaxSet?.shopMoney?.amount || '0',
        total_discounts: order.totalDiscountsSet?.shopMoney?.amount || '0',
        total_refunded: order.totalRefundedSet?.shopMoney?.amount || '0',
        note: order.note || '',
        source: order.channelInformation?.channelDefinition?.channelName || 'Unknown',
        customer: null,
        financial_status: order.displayFinancialStatus,
        line_items: order.lineItems.nodes.map(item => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          price: item.originalUnitPriceSet.shopMoney.amount,
          // Extract cost from GraphQL inventoryItem.unitCost - defaults to '0' if not set in Shopify
          cost: item.variant?.inventoryItem?.unitCost?.amount || '0',
          variant_id: item.variant?.id
        }))
      }));

      allOrders = allOrders.concat(transformedOrders);

      hasNextPage = data.pageInfo.hasNextPage;
      cursor = data.pageInfo.endCursor;

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error('Error fetching orders:', error);
      throw error;
    }
  }

  // Server-side date filter as a safety net against Shopify query edge cases
  const filtered = allOrders.filter(order => {
    const d = new Date(order.created_at);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return dateStr >= startDate && dateStr <= endDate;
  });
  if (filtered.length < allOrders.length) {
    console.log(`   Filtered out ${allOrders.length - filtered.length} orders outside date range`);
  }
  return filtered;
}

/**
 * Generate Report Data with COGS and Profit Calculations
 * 
 * This is the core business logic that makes this app unique:
 * - Calculates revenue from line item prices × quantities
 * - Calculates COGS from line item costs × quantities (fetched via GraphQL)
 * - Computes profit margin: Revenue - COGS
 * - Aggregates by product, date, and order
 * - Applies manual COGS rules for products without costs set in Shopify
 * - Applies zero COGS override as fallback when no rules match
 * 
 * Important: Products must have costs set in Shopify inventory management
 * for accurate COGS. Products without costs will show $0.00 COGS unless
 * a manual COGS rule matches the product name or zero override is set.
 */
function generateReportData(orders, cogsRules, zeroCOGSOverride, startDate, endDate) {
  let totalRevenue = 0;
  let totalCOGS = 0;
  let totalProfit = 0;
  let dailyData = {};
  let productData = {};
  let orderDetails = [];

  orders.forEach(order => {
    const od = new Date(order.created_at);
    const orderDate = `${od.getFullYear()}-${String(od.getMonth()+1).padStart(2,'0')}-${String(od.getDate()).padStart(2,'0')}`;
    const orderRevenue = parseFloat(order.total_price || 0);
    let orderCOGS = 0;

    order.line_items?.forEach(item => {
      // Calculate revenue and COGS for this line item
      const itemRevenue = parseFloat(item.price || 0) * item.quantity;
      let unitCost = parseFloat(item.cost || 0);
      
      // Apply manual COGS rules if no cost is set
      if (unitCost === 0) {
        let ruleApplied = false;
        
        // First, check pattern-matching rules
        if (cogsRules && cogsRules.length > 0) {
          const matchingRule = cogsRules.find(rule => 
            item.name && item.name.toLowerCase().includes(rule.pattern.toLowerCase())
          );
          if (matchingRule) {
            // Calculate cost as percentage of price
            unitCost = (parseFloat(item.price || 0) * matchingRule.cogsPercent) / 100;
            ruleApplied = true;
          }
        }
        
        // If no rule matched and we have a zero override, apply it
        if (!ruleApplied && zeroCOGSOverride !== null && zeroCOGSOverride !== undefined && zeroCOGSOverride > 0) {
          unitCost = (parseFloat(item.price || 0) * zeroCOGSOverride) / 100;
        }
      }
      
      const itemCOGS = unitCost * item.quantity;
      
      orderCOGS += itemCOGS;

      const productKey = item.name || item.sku || item.product_id;
      if (!productData[productKey]) {
        productData[productKey] = {
          name: item.name,
          sku: item.sku,
          quantity: 0,
          revenue: 0,
          cogs: 0,
          profit: 0,
        };
      }

      productData[productKey].quantity += item.quantity;
      productData[productKey].revenue += itemRevenue;
      productData[productKey].cogs += itemCOGS;
      productData[productKey].profit += (itemRevenue - itemCOGS);
    });

    const orderProfit = orderRevenue - orderCOGS;

    totalRevenue += orderRevenue;
    totalCOGS += orderCOGS;
    totalProfit += orderProfit;
    
    // Add order details for the orders table
    orderDetails.push({
      orderNumber: order.name || order.order_number,
      orderId: order.id,
      createdAt: order.created_at,
      source: order.source || 'Unknown',
      revenue: orderRevenue,
      cogs: orderCOGS,
      profit: orderProfit,
    });

    if (!dailyData[orderDate]) {
      dailyData[orderDate] = {
        date: orderDate,
        orders: 0,
        revenue: 0,
        cogs: 0,
        profit: 0,
      };
    }

    dailyData[orderDate].orders += 1;
    dailyData[orderDate].revenue += orderRevenue;
    dailyData[orderDate].cogs += orderCOGS;
    dailyData[orderDate].profit += orderProfit;
  });

  return {
    summary: {
      totalOrders: orders.length,
      totalRevenue,
      totalCOGS,
      totalProfit,
      profitMargin: totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100) : 0,
      startDate,
      endDate,
      productSales: productData, // Frontend expects this nested in summary
    },
    orders: orderDetails, // Frontend expects this at top level
    daily: Object.values(dailyData).sort((a, b) => new Date(a.date) - new Date(b.date)),
    rawOrders: orders, // Include raw order data for CSV export with all fields
  };
}

/**
 * Generate CSV from report data with COGS rules applied
 */
function generateCSV(reportData, cogsRules = [], zeroCOGSOverride = null) {
  // Validate reportData structure
  if (!reportData || !reportData.summary) {
    throw new Error('Invalid report data: missing summary');
  }
  
  // New detailed format: one row per order
  let csv = 'Date,Order Number,Gross,Shipping Collected,Tax Collected,Gross Total,Platform Fee,Shipping Cost,Discount,Refund,Net Total,Cost of Goods Sold,Actual Profit or Loss,ROI %,Source\n';
  
  // Generate rows from raw orders (stored in reportData.rawOrders if available)
  if (reportData.rawOrders && reportData.rawOrders.length > 0) {
    reportData.rawOrders.forEach(order => {
      const date = new Date(order.created_at).toLocaleDateString('en-US');
      const orderNumber = order.name;
      
      // Calculate gross (subtotal before shipping/tax)
      const gross = parseFloat(order.subtotal_price || 0);
      const shippingCollected = parseFloat(order.total_shipping || 0);
      const taxCollected = parseFloat(order.total_tax || 0);
      const grossTotal = parseFloat(order.total_price || 0);
      
      // Platform fee - Shopify Payments: $0.30 + 2.9% of gross total
      // Stored as positive internally, displayed as negative in CSV since it's a cost
      const platformFee = Math.round((0.30 + (grossTotal * 0.029)) * 100) / 100;
      
      // Parse shipping cost from order notes
      const shippingCost = parseShippingCostFromNotes(order.note);
      
      const discount = parseFloat(order.total_discounts || 0);
      const refund = parseFloat(order.total_refunded || 0);
      
      // Calculate COGS for this order with rules applied
      const cogs = order.line_items.reduce((sum, item) => {
        let itemCost = parseFloat(item.cost);
        
        // Apply COGS rules
        if (itemCost === 0 || itemCost === null || itemCost === undefined) {
          // Check if product matches any rule
          let ruleApplied = false;
          for (const rule of cogsRules) {
            if (item.name.toLowerCase().includes(rule.pattern.toLowerCase())) {
              const itemPrice = parseFloat(item.price);
              itemCost = (itemPrice * rule.cogsPercent) / 100;
              ruleApplied = true;
              break;
            }
          }
          
          // If no rule matched and we have a zero override, apply it
          if (!ruleApplied && zeroCOGSOverride !== null && zeroCOGSOverride > 0) {
            const itemPrice = parseFloat(item.price);
            itemCost = (itemPrice * zeroCOGSOverride) / 100;
          }
        }
        
        return sum + (itemCost * item.quantity);
      }, 0);
      
      // Net Total = Gross Total - Refund (discount already applied in Gross from Shopify)
      const netTotal = grossTotal - refund;
      
      // Actual Profit = Net Total - COGS - Shipping Cost - Platform Fee
      const actualProfit = netTotal - cogs - shippingCost - platformFee;
      
      // ROI % = (Actual Profit / (COGS + Shipping Cost)) * 100
      const costBase = cogs + shippingCost;
      const roi = costBase > 0 ? (actualProfit / costBase) * 100 : 0;
      
      const source = order.source || 'Unknown';
      csv += `${date},${orderNumber},${gross.toFixed(2)},${shippingCollected.toFixed(2)},${taxCollected.toFixed(2)},${grossTotal.toFixed(2)},${(-platformFee).toFixed(2)},${(-shippingCost).toFixed(2)},${(-discount).toFixed(2)},${(-refund).toFixed(2)},${netTotal.toFixed(2)},${(-cogs).toFixed(2)},${actualProfit.toFixed(2)},${roi.toFixed(2)}%,${source}\n`;
    });
  } else {
    // Fallback: old summary format if orders not available
    csv = 'Sales Report\n\n';
    csv += 'Summary\n';
    csv += `Date Range,${reportData.summary.startDate} to ${reportData.summary.endDate}\n`;
    csv += `Total Orders,${reportData.summary.totalOrders}\n`;
    csv += `Total Revenue,$${reportData.summary.totalRevenue}\n`;
    csv += `Total COGS,$${reportData.summary.totalCOGS}\n`;
    csv += `Total Profit,$${reportData.summary.totalProfit}\n`;
    csv += `Profit Margin,${reportData.summary.profitMargin}%\n`;
  }
  
  return csv;
}

/**
 * Generate sheet data array for Excel export
 * Returns array of arrays (rows) with header as first row
 */
function generateSheetData(orders, cogsRules = [], zeroCOGSOverride = null) {
  // Header row
  const rows = [
    ['Date', 'Order Number', 'Gross', 'Shipping Collected', 'Tax Collected', 'Gross Total', 
     'Platform Fee', 'Shipping Cost', 'Discount', 'Refund', 'Net Total', 
     'Cost of Goods Sold', 'Actual Profit or Loss', 'ROI %', 'Source']
  ];
  
  orders.forEach(order => {
    const date = new Date(order.created_at).toLocaleDateString('en-US');
    const orderNumber = order.name;
    
    const gross = parseFloat(order.subtotal_price || 0);
    const shippingCollected = parseFloat(order.total_shipping || 0);
    const taxCollected = parseFloat(order.total_tax || 0);
    const grossTotal = parseFloat(order.total_price || 0);
    
    // Platform fee - Shopify Payments: $0.30 + 2.9% of gross total
    const platformFee = Math.round((0.30 + (grossTotal * 0.029)) * 100) / 100;
    
    const shippingCost = parseShippingCostFromNotes(order.note);
    const discount = parseFloat(order.total_discounts || 0);
    const refund = parseFloat(order.total_refunded || 0);
    
    // Calculate COGS with rules applied
    const cogs = order.line_items.reduce((sum, item) => {
      let itemCost = parseFloat(item.cost);
      
      if (itemCost === 0 || itemCost === null || itemCost === undefined) {
        let ruleApplied = false;
        for (const rule of cogsRules) {
          if (item.name.toLowerCase().includes(rule.pattern.toLowerCase())) {
            const itemPrice = parseFloat(item.price);
            itemCost = (itemPrice * rule.cogsPercent) / 100;
            ruleApplied = true;
            break;
          }
        }
        
        if (!ruleApplied && zeroCOGSOverride !== null && zeroCOGSOverride > 0) {
          const itemPrice = parseFloat(item.price);
          itemCost = (itemPrice * zeroCOGSOverride) / 100;
        }
      }
      
      return sum + (itemCost * item.quantity);
    }, 0);
    
    // Net Total = Gross Total - Refund (discount already applied in Gross from Shopify)
    const netTotal = grossTotal - refund;
    const actualProfit = netTotal - cogs - shippingCost - platformFee;
    const costBase = cogs + shippingCost;
    const roi = costBase > 0 ? (actualProfit / costBase) * 100 : 0;
    const source = order.source || 'Unknown';
    
    // Add row with negative values for costs
    rows.push([
      date,
      orderNumber,
      gross,
      shippingCollected,
      taxCollected,
      grossTotal,
      -platformFee,
      -shippingCost,
      -discount,
      -refund,
      netTotal,
      -cogs,
      actualProfit,
      `${roi.toFixed(2)}%`,
      source
    ]);
  });
  
  return rows;
}

/**
 * Parse shipping cost from order notes
 * Looks for patterns like "Shipping: $1.00" or just "$1.00"
 */
function parseShippingCostFromNotes(note) {
  if (!note) return 0;
  
  // Pattern 1: "Shipping: $1.00"
  const pattern1 = /Shipping:\s*\$?(\d+\.?\d*)/i;
  const match1 = note.match(pattern1);
  if (match1) {
    return parseFloat(match1[1]);
  }
  
  // Pattern 2: Just "$1.00" (could be ambiguous, so use carefully)
  // Only match if it's on its own line or clearly separated
  const pattern2 = /(?:^|\n)\s*\$(\d+\.?\d*)\s*(?:\n|$)/;
  const match2 = note.match(pattern2);
  if (match2) {
    return parseFloat(match2[1]);
  }
  
  return 0;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Shopify Sales Exporter running on port ${PORT}`);
  console.log(`App URL: ${process.env.APP_URL}`);
  console.log(`Environment: ${IS_PRODUCTION ? 'production' : 'development'}`);
});
