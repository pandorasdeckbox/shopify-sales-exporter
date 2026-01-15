# 📊 Shopify Sales Exporter

Get Shopify sales reports with **COGS (Cost of Goods Sold)** and true profit calculations - completely free!

## Why This App?

Shopify's built-in order exports **don't include COGS data**, making it impossible to calculate true profitability without manual work. This app solves that problem by:

- ✅ Fetching all order line items with COGS information
- ✅ Calculating true profit (Revenue - COGS) per order and product
- ✅ Generating detailed reports by date range
- ✅ Exporting everything to CSV for your own analysis
- ✅ **100% free** - no monthly fees, no hidden costs

## Features

- 📅 **Flexible Date Ranges**: Generate reports for any time period (today, this month, custom ranges)
- 💰 **True Profit Calculation**: Automatically calculates profit based on actual COGS
- 📈 **Product Performance**: See which products are most profitable
- 📊 **Daily Breakdown**: Track sales trends over time
- 💾 **CSV Export**: Download reports for further analysis
- 🔒 **Secure**: Only requests read access to orders and products

## For Shopify Store Owners

### Installation (Easy!)

1. Visit the Shopify App Store
2. Search for **"Sales Exporter with COGS"**
3. Click **Add app**
4. Approve the permissions (read orders and products only)
5. Start generating profit reports!

**Note**: Make sure your products have **Cost per item** entered in Shopify (under Product → Inventory) for accurate profit calculations.

## For Developers

This is a fully open-source Shopify app. Contributions welcome!

### Local Development Setup

1. **Clone this repository**
   ```bash
   git clone https://github.com/pandorasdeckbox/shopify-sales-exporter.git
   cd shopify-sales-exporter
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up a Shopify Partner App**
   
   - Go to [Shopify Partners](https://partners.shopify.com/)
   - Create a new app (Public app, not Custom)
   - Note your API key and secret
   - Set App URL to your ngrok URL (see below)
   - Set redirect URL to `https://your-ngrok-url/auth/callback`

4. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env`:
   ```
   SHOPIFY_API_KEY=your_api_key_from_partner_dashboard
   SHOPIFY_API_SECRET=your_api_secret_from_partner_dashboard
   APP_URL=https://your-ngrok-url.ngrok.io
   SESSION_SECRET=generate_a_random_string
   DATABASE_URL=sqlite:sessions.db  # or postgres for production
   ```

5. **Start development server with ngrok**
   ```bash
   # Terminal 1: Start the app
   npm run dev
   
   # Terminal 2: Start ngrok tunnel
   ngrok http 3000
   ```
   
   Copy the HTTPS URL from ngrok and update your `.env` and Shopify Partner app settings.

6. **Test the app**
   
   - Visit `https://your-ngrok-url.ngrok.io`
   - Enter your test store domain
   - Complete OAuth flow
   - Generate test reports

## Usage

### Generating Reports

1. **Select Date Range**: Use quick buttons (This Month, Last Month, etc.) or pick custom dates
2. **Click Generate Report**: The app fetches all orders in that range
3. **View Results**: 
   - Summary metrics (total revenue, COGS, profit, margin)
   - Order-by-order breakdown
   - Top performing products

### Exporting Data

Click **Export to CSV** to download a spreadsheet with:
- All order details with COGS and profit
- Summary statistics
- Perfect for importing into Excel or Google Sheets

## Important Notes

### COGS Data Requirements

**Your Shopify products MUST have cost data entered!** 

To add COGS to your products:
1. Go to **Products** in Shopify admin
2. Edit a product
3. Scroll to **Inventory** section
4. Enter **Cost per item**

Without cost data, the app can't calculate accurate profits.

### API Rate Limits

Shopify has API rate limits. For stores with thousands of orders:
- The app automatically handles pagination
- Adds delays between requests to avoid rate limiting
- Large reports may take a minute or two to generate

## Production Deployment

### Deploy to Railway (Recommended for production)

1. Create a [Railway](https://railway.app/) account
2. Click **New Project** → **Deploy from GitHub**
3. Connect this repository
4. Add environment variables:
   ```
   SHOPIFY_API_KEY=your_production_api_key
   SHOPIFY_API_SECRET=your_production_secret
   SESSION_SECRET=secure_random_string
   DATABASE_URL=postgresql://... (Railway provides this)
   NODE_ENV=production
   ```
5. Railway auto-deploys on push to main branch
6. Get your production URL and update Shopify Partner app settings

### Deploy to Heroku

```bash
# Create app
heroku create shopify-sales-exporter

# Add Postgres addon for session storage
heroku addons:create heroku-postgresql:mini

# Set environment variables
heroku config:set SHOPIFY_API_KEY=your_key
heroku config:set SHOPIFY_API_SECRET=your_secret
heroku config:set SESSION_SECRET=$(openssl rand -base64 32)
heroku config:set NODE_ENV=production

# Deploy
git push heroku main
```

### Shopify App Store Submission

To make the app publicly available:

1. Complete app development and testing
2. Deploy to production server (Railway/Heroku)
3. In Shopify Partners, go to your app
4. Click **Distribution** → **Public**
5. Fill out app listing details (screenshots, description, pricing)
6. Submit for Shopify review
7. Once approved, anyone can install from the app store!

**Note**: For app store approval, you'll need:
- Privacy policy URL
- Support email/URL
- Screenshots of the app
- Detailed description
- Compliance with Shopify's app requirements

## Troubleshooting

### "Session not found" error
- Make sure your `.env` file has `SESSION_SECRET` set
- Try logging out and reinstalling the app

### No COGS data showing
- Verify your products have **Cost per item** set in Shopify
- The cost must be entered before the order was placed

### Rate limit errors
- Reduce the date range for your report
- The app includes built-in rate limiting, but very large stores may need longer delays

### HTTPS required error
- Shopify requires HTTPS for all apps
- Use ngrok for development
- Use a proper SSL certificate for production

## Contributing

Contributions welcome! This is a free app for the community.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - Free to use, modify, and distribute

## Support

- 🐛 **Issues**: [GitHub Issues](https://github.com/pandorasdeckbox/shopify-sales-exporter/issues)
- 💬 **Questions**: Open a discussion on GitHub

---

Made with ❤️ for small business owners who need real profit data without monthly fees
