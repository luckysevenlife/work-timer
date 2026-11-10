# Lucky's Work Timer

A simple timer that only counts the time you actually worked. Lives at timer.luckysevenmac.com.

- `public/` is the whole site (plain HTML, CSS and JavaScript, no build step).
- `src/worker.js` is the small backend that stores data under a save code like `Mike4821`.
- `wrangler.jsonc` tells Cloudflare how to run both.

## Hosting

Cloudflare Workers, connected to this repo. Every push to `main` deploys with `npx wrangler deploy`.
The D1 database is created automatically on the first deploy, and its table on the first request.

## Run it locally

```bash
npx wrangler dev
```
