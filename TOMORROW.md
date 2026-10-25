# Tomorrow — hand the shop to the new owner

The live shop stays on the current accounts until his new site is tested and you choose to switch the domain and the phone.

## Before you leave home

- [ ] On GitHub, create a **private** repo named `mobile-express`.
- [ ] In this folder, run:
  ```
  git remote add origin https://github.com/YOUR-USER/mobile-express.git
  git push -u origin main
  ```
- [ ] Do not run `SETUP-NEW.bat` on this PC.

## On his PC, in this order

- [ ] Install Node.js (https://nodejs.org), Git, and VS Code.
- [ ] Create these accounts with his email and his card:
  - GitHub
  - Netlify
  - Twilio (new account only — do not move the phone number)
  - Airtable, then a token that can read records, write records, read schema, and write schema
  - Stripe (secret key and publishable key)
  - A Gmail address for the shop, plus a Gmail app password
  - Shippo
  - OpenAI
- [ ] Start the domain transfer for `mobileexpressny.com`. Leave the DNS pointing at the current site.
- [ ] Clone the private repo. Confirm the shop files are there.
- [ ] Delete that repo from your GitHub.
- [ ] Create an empty private repo on his GitHub. In the project folder, point `origin` at his repo and push.
- [ ] Open the folder in VS Code and sign Git in as him.
- [ ] Double-click `SETUP-NEW.bat`. Paste the new Airtable token, the new Twilio Account SID and auth token, and the Stripe, Gmail, Shippo, and OpenAI values.
- [ ] Open the `netlify.app` address the script prints. Check the shop and place a test order.
- [ ] After that test passes, add `mobileexpressny.com` in his Netlify site and set the DNS records Netlify shows.
- [ ] Leave the phone number on the old Twilio account until you are ready to turn the old line off.

Voice recordings and the assistance function stay on the old Twilio account. Those files are not in this project.

The order tools use the admin password typed into `SETUP-NEW.bat`. The shop admin pages (`admin-home.html`, `admin.html`, `admin-ivr.html`) still use `admin123` until those three lines are changed.
