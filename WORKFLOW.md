# Mobile Express — how the shop works today

This file describes the system as it is. It is the map for editing the project in git. Each change should be committed and pushed. If an edit breaks something, check out the last good commit and push that again.

The shop is one folder of HTML, a local Node server, Netlify functions, and a Twilio phone menu. Orders are stored in Airtable. There is no separate database in this folder.

## Two places a change can go

| Change | Where it is saved first | How it goes live |
| --- | --- | --- |
| Website pages, product catalog, repair catalog | Files in this folder, written by the local admin server | `PUBLISH.bat` runs `netlify deploy --prod` |
| Phone menu wording, phone prices, phone flow | `twilio.json` and `twilio_phones_total` in this folder | `PUBLISH-TWILIO.bat` uploads the price function and publishes the Studio flow |
| A new website or phone order | Airtable, at the moment the order is placed | Already live. No publish step |

Editing a file on this computer does not change the public site or the phone line until the matching publish script is run.

## Run the admin on this computer

1. Install Node.js.
2. In this folder run `npm install` once.
3. Double-click `START.bat`, or run `npm start`.
4. The admin opens at `http://localhost:5173/admin-home.html`.

`server.js` is that local server. It serves the HTML files and the `/api/...` routes the admin pages use. The public site does not run `server.js`. The public site is the same folder deployed to Netlify.

`admin-home.html` asks for a password before showing the menu. The password is the value of `ADMIN_PASSWORD` in that file.

## Admin menu

| Page | What it edits |
| --- | --- |
| `admin.html` | Products on the website: name, price, type, photos, plans, variants |
| `admin-ivr.html` | What callers hear, and the phone price list |
| `ivr-diagram.html` | A picture of the phone flow. It does not change the live menu |
| `admin-repairs.html` | Makes, models, and repair prices shown on the repairs page |
| `process_repairs.html` | Repair requests that customers already submitted |

Order processing for purchases is `process_orders.html`. It is not on the admin home cards. It talks to Netlify, not to the local server.

## Website shopping

Pages: `index.html`, `accessories.html`, `detail.html`, `checkout.html`, `order-success.html`, `order-status.html`, `contact.html`, `repairs.html`.

Shared header and footer come from `components.js`. Shared look comes from `shared.css`.

The shop reads `data/products.json`. The cart is kept in the browser under the key `me_cart`.

Checkout:

1. The page loads the Stripe publishable key from `/.netlify/functions/stripe-config`.
2. `create-payment-intent` prices the cart from `data/products.json` (tax 8.125%) and creates the Stripe charge. The browser does not get to choose the amount.
3. After the card succeeds, `place_order` checks that the Stripe payment succeeded and matches that total, then writes the order to Airtable and emails the buyer and the shop.
4. The success page reads the last order from the browser session.

Order lookup uses `/.netlify/functions/order_status`. Staff updates use `update_order`, `pending_orders`, and `create_label` (Shippo shipping label).

## Phone menu

The live call flow is `twilio.json`. A caller hears `gather_walcome` first:

1. Place an order
2. Track an order
3. Activate a SIM
4. Terms
5. Repairs (tells the caller to use the website)
6. Request a callback
7. Leave a message

An order walks through a category menu, then `twilio_phones_total` (the `/phones_total` function, also called calculate). Phone plan keys are `1` talk and text, `2` talk and media, `3` talk only. The function returns the spoken total. Twilio charges the card. `twilio_transcribe_address` turns the spoken address into text. `twilio_place_order` (the `/place_order` function) writes the order to the same Airtable orders table with source `IVR`.

Saving the phone catalog in `admin-ivr.html` does two local things:

- Rewrites the category prompts inside `twilio.json`
- Regenerates `twilio_phones_total`

Those files stay local until `PUBLISH-TWILIO.bat`. That script runs `scripts/deploy-function.js` for `/phones_total`, then `scripts/publish-flow.js` for the Studio flow. `scripts/deploy-place-order.js` publishes `/place_order` only. `scripts/deploy-transcribe.js` publishes `/transcribe_address`.

`twilio-local.json` holds the Twilio account SID, auth token, and Functions service SID. It is listed in `.gitignore`. Do not commit it.

## Repairs

`repairs.html` loads `/.netlify/functions/repairs_catalog` and submits `/.netlify/functions/submit_repair`. Staff use `get_repairs`, `update_repair`, and `create_repair_label`. Repair rows go to a second Airtable table. The catalog the customer sees is `data/repairs-catalog.json`, edited by the local admin.

## Netlify functions

All of these live in `netlify/functions/` and run on the public site, not on the local server.

| Function | Role |
| --- | --- |
| `stripe-config.js` | Gives checkout the Stripe publishable key |
| `create-payment-intent.js` | Prices the cart and starts the card payment |
| `lib/pricing.js` | Shared price and tax math. Both payment and `place_order` use it |
| `place_order.js` | Verifies the payment, saves the website order, sends email |
| `order_status.js` | Customer order lookup |
| `pending_orders.js` | Staff list of orders |
| `update_order.js` | Staff password check, status, IMEI, tracking |
| `create_label.js` | Shippo label for an order |
| `repairs_catalog.js` | Public repair price list |
| `submit_repair.js` | New repair request |
| `get_repairs.js` | Staff repair list |
| `update_repair.js` | Staff repair update |
| `create_repair_label.js` | Shippo label for a repair |

`netlify.toml` publishes this whole folder. `data/products.json` is included with the functions so they can price a cart. A catch-all redirect sends unknown paths to `index.html`. Real files, such as `checkout.html`, are still served as themselves.

## Accounts the live shop depends on

These are not stored in git. They are environment variables on Netlify, and the Twilio ones are also environment variables on the Twilio Functions service.

- Airtable — orders and repairs (`AIRTABLE_TOKEN`, and the repairs table id)
- Stripe — card charges (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`)
- Gmail — order email (`GMAIL_USER`, `GMAIL_APP_PASS`, `SELLER_EMAIL`)
- Shippo — labels (`SHIPPO_API_KEY` plus the sender address variables)
- Admin tools that update orders — `ADMIN_PASSWORD` on Netlify
- Twilio — phone account in `twilio-local.json`, plus `AIRTABLE_TOKEN`, `GMAIL_USER`, and `GMAIL_APP_PASS` on the Twilio service

`netlify-env-vars.txt` is only a list of the names. Keep real values out of git.

`SETUP.html` is the longer click-by-click setup. This file is the map of how the pieces connect.

## Files an editor should treat as the source of truth

- Storefront and admin HTML, `components.js`, `shared.css`, `server.js`
- `data/products.json`, `data/ivr-config.json`, `data/repairs-catalog.json`
- `netlify/functions/`
- `twilio.json`, `twilio_phones_total`, `twilio_place_order`, `twilio_transcribe_address`
- `scripts/deploy-function.js`, `scripts/deploy-place-order.js`, `scripts/deploy-transcribe.js`, `scripts/publish-flow.js`

`twilio.json.bak` is a backup of an older flow. `node_modules/` and `.netlify/` are generated.

## Working with git

The person running the shop keeps this folder in their own git account.

1. Initialize or clone the repo on that account.
2. Edit with Claude Code or a similar tool.
3. After each edit, commit and push.
4. If that edit is buggy, revert to the previous commit and push again. The last good push is the restore point.

Do not commit `twilio-local.json` or any file that contains a live token, app password, or secret key. A pushed secret has to be rotated at the service that issued it. Reverting the commit does not undo a key that was already exposed.
