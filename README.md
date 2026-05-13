# Ismuscle — Deploy to Heroku

## Setup

```bash
npm install
```

## Deploy to Heroku

```bash
heroku create ismuscle-ton-nom
heroku config:set VAPID_PUBLIC_KEY=xxx VAPID_PRIVATE_KEY=yyy
git push heroku main
```

## Get VAPID keys (run once locally)

```bash
node -e "const w=require('web-push');const k=w.generateVAPIDKeys();console.log(k);"
```

Copy the output and set as Heroku env vars.

## Install as PWA on Android Firefox

1. Open your Heroku URL in Firefox Android
2. Tap ⋮ menu → "Installer" or "Ajouter à l'écran d'accueil"
3. Go to GTG tab → tap "Activer" to enable push notifications

## GTG Notifications

Notifications are sent every hour at the times you configure in the GTG tab.
The server uses node-cron running on the Heroku dyno.

Note: Free Heroku dynos sleep after 30min of inactivity — upgrade to Eco ($5/mo)
to keep notifications running 24/7.
