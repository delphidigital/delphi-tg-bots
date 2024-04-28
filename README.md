# delphi-tg-bots

Delphi Reads Telegram Bot powers creation of Delphi Reads items by Delphi research analysts

## Production

Run the app

```bash
npm start
```

## Local Development

Install deps

```bash
npm i
```

Generate your [telegram bot](https://core.telegram.org/bots/tutorial) for local dev. 

Create a [smee channel](https://smee.io/new) to proxy webhook requests to your local server. Copy 
the generated smee channel url as you'll need to save it as `DELPHI_READS_WEBHOOK_URL` in your 
`.env` file.

Copy `.env.template` to `.env` file:

```bash
cp .env.template .env
```

Open `.env` and populate values.

Start the server in dev mode:

```bash
npm start:dev
```

Dev mode will automatically configure smee to proxy requests to your local server.
