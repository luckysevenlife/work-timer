# Lucky's Work Timer

A simple timer that only counts the time you actually worked. Lives at timer.luckysevenmac.com.

- `public/` is the whole site (plain HTML, CSS and JavaScript, no build step).
- `functions/api/` is the small backend that stores data under a save code like `Mike4821`.

## Hosting (Cloudflare Pages)

- Build command: none
- Build output directory: `public`
- Bindings: a D1 database with the variable name `DB` (the table is created automatically)

## Run it locally

```bash
npx wrangler pages dev public --d1 DB
```
