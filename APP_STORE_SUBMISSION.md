# Shopify App Store Submission Checklist

## Before Submitting

### Required Assets

- [ ] **App Icon** (512x512px PNG)
  - Clear, recognizable icon
  - No text overlay
  - Represents the app's purpose

- [ ] **Screenshots** (minimum 2, recommended 4-5)
  - 1600x1200px or 1600x900px
  - Show key features:
    1. Installation/connection screen
    2. Report generation interface
    3. Sales summary with COGS
    4. CSV export functionality
  - Clean, professional appearance
  - No placeholder data

- [ ] **App Listing Copy**
  - Clear title: "Sales Exporter with COGS"
  - Subtitle/tagline
  - Detailed description (benefits, features, use cases)
  - Support email
  - Privacy policy URL (host PRIVACY.md publicly)
  - Support documentation URL

### Technical Requirements

- [ ] **Production deployment**
  - App deployed to Railway/Heroku
  - HTTPS enabled
  - Custom domain (recommended, not required)
  - Environment variables configured
  
- [ ] **Shopify Partner Setup**
  - App type: Public Distribution
  - Correct OAuth redirect URLs
  - API scopes documented
  - App not in embedded mode (standalone)

- [ ] **Testing**
  - Test on multiple Shopify stores
  - Test with various data scenarios:
    - Store with COGS data
    - Store without COGS data
    - Large number of orders (1000+)
    - Different currencies
  - Test all date range options
  - Test CSV export
  - Test error handling

### Compliance

- [ ] **Privacy Policy**
  - Hosted publicly (deploy PRIVACY.md)
  - Explains data collection
  - Describes data usage
  - Contact information

- [ ] **Terms of Service** (optional but recommended)

- [ ] **GDPR Compliance**
  - Data deletion on uninstall
  - User data rights documented
  - No unnecessary data collection

- [ ] **Accessibility**
  - Works on mobile browsers
  - Clear error messages
  - Keyboard navigation support

## Submission Steps

1. **In Shopify Partner Dashboard**
   - Go to Apps → Your App
   - Click "Distribution" tab
   - Select "Public distribution"
   - Fill out app listing form

2. **App Listing Information**
   ```
   Title: Sales Exporter with COGS
   Subtitle: Get true profit reports Shopify won't give you
   
   Description:
   Calculate your real profits! Shopify's order exports don't include
   Cost of Goods Sold, making it impossible to see true profitability.
   
   Our free app solves this by:
   • Fetching COGS from your product data
   • Calculating true profit (Revenue - COGS)
   • Breaking down performance by product
   • Exporting everything to CSV
   
   Perfect for:
   - Store owners who need profit reports
   - Accountants requiring detailed COGS data
   - Anyone tracking product profitability
   
   100% free. No monthly fees. Open source.
   
   Note: Your products must have "Cost per item" entered in Shopify
   for accurate profit calculations.
   ```

3. **Pricing**
   - Select: Free

4. **Support**
   - Support email: [your email]
   - Documentation: Link to GitHub README
   - Privacy policy: Link to hosted PRIVACY.md

5. **Categories**
   - Primary: Reporting
   - Secondary: Finance

6. **Submit for Review**
   - Click "Submit for approval"
   - Wait for Shopify review (typically 1-2 weeks)
   - Address any feedback from reviewers

## After Approval

- [ ] App appears in Shopify App Store
- [ ] Monitor for installation issues
- [ ] Set up user feedback collection
- [ ] Plan updates and improvements

## Review Process

Shopify reviews for:
- **Functionality**: Does it work as described?
- **Security**: Follows best practices?
- **User Experience**: Clear, helpful interface?
- **Compliance**: Privacy policy, data handling?
- **Performance**: Fast, reliable?

## Common Rejection Reasons

- Broken OAuth flow
- Missing privacy policy
- Poor quality screenshots
- Misleading description
- Performance issues
- Security vulnerabilities

## Tips for Approval

1. **Be transparent** - Clearly explain what the app does
2. **Show value** - Demonstrate why users need it
3. **Quality screenshots** - Professional, clear, informative
4. **Test thoroughly** - Install on fresh stores, test edge cases
5. **Quick support** - Respond promptly to Shopify's questions
6. **Documentation** - Clear README with setup instructions

## Questions?

Shopify Partner Support: partners@shopify.com
