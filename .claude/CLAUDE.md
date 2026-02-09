# NHL Analytics Project

## Deployment
This project is deployed on **Cloudflare Pages** (NOT Netlify).

To deploy:
```bash
npx wrangler pages deploy dist --project-name=nhl-analytics
```

The workers directory contains Cloudflare Workers for the backend API.

## Domain Validation
The `/validate` function includes domain checks for security.
