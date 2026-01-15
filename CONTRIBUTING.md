# Contributing to Shopify Sales Exporter

Thank you for your interest in contributing! This is an open-source project meant to help Shopify store owners get the profit data they need.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/pandorasdeckbox/shopify-sales-exporter/issues)
2. If not, create a new issue with:
   - Clear description of the problem
   - Steps to reproduce
   - Expected vs actual behavior
   - Your environment (OS, Node version, etc.)

### Suggesting Features

1. Open an issue with the `enhancement` label
2. Describe the feature and why it would be useful
3. Include mockups or examples if applicable

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Test thoroughly
5. Commit with clear messages: `git commit -m "Add feature: description"`
6. Push to your fork: `git push origin feature/your-feature-name`
7. Open a Pull Request with:
   - Description of changes
   - Why the change is needed
   - Any breaking changes
   - Screenshots (for UI changes)

### Development Setup

See the main [README.md](README.md) for development setup instructions.

### Code Style

- Use ES6+ features
- Follow existing code formatting
- Add comments for complex logic
- Keep functions small and focused

### Testing

Before submitting a PR:
- Test OAuth flow with a development store
- Test report generation with various date ranges
- Test with stores that have/don't have COGS data
- Check error handling

## Questions?

Open a discussion or reach out via issues!
