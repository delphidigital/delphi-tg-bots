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

To simulate hitting the live endpoints to create a Read or an AF post, temporarily update fetch calls to use URLs with:
```
http://localhost:5555/af
http://localhost:5555/reads
```

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


```
# deploy to beta/staging environment
npm run deploy

# deploy to prod
npm run deploy:prod
```

## Resources

[Telegraf Docs](https://github.com/feathers-studio/telegraf-docs)
