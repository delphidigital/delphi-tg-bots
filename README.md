# delphi-tg-bots

Delphi Reads Telegram Bot powers creation of Delphi Reads items by Delphi research analysts

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
npm run start:dev
```

Dev mode will automatically configure smee to proxy requests to your local server.

Reads talk to Hydra (`HYDRA_API_BASE_URL`, e.g. a local Hydra on
`http://localhost:4000`) with `HYDRA_READS_API_KEY`, which must equal that
Hydra's `READS_BOT_API_KEY`. `DELPHI_READS_READING_LIST_ID` is Hydra's reading
list (Beta 9, Prod 1). Notes (AF posts) still go to the members portal
(`DELPHI_API_BASE_URL`, `DELPHI_AF_API_KEY`).

## How Reads work

- The link's title, description and image come from Hydra's
  `GET /api/v1/bots/tg/reads/link-metadata`.
- Publishing calls Hydra's `POST /api/v1/bots/tg/reads` as the sender, by
  Telegram user id. Hydra checks that the id is linked to a Delphi account
  that is an employee, stores the read and announces it in the Telegram
  channels.
- A sender whose Telegram isn't linked is told to link it on the page Hydra
  returns (the Pro chat page); their draft is kept so they can publish again.

## Bot Commands

Use BotFather to set commands for your bot.

1. In conversation with BotFather:

```
/setcommands
```

2. Then, select the bot to set commands for

3. Finally, add all your commands. Below could be used for the Delphi Reads bot:

```
menu - Display the main menu
newread - Create a new Delphi Read item
newafpost - Create a new AF post
help - Get help or provide feedback
```

## Deployment

A push to `beta` deploys Beta and a push to `main` deploys Prod
(`.github/workflows/deploy.yml`). Set any new Fly secrets on the app first.

```
# deploy to beta/staging environment
npm run deploy

# deploy to prod
npm run deploy:prod
```

## Resources

[Telegraf Docs](https://github.com/feathers-studio/telegraf-docs)
