# Hand the shop to the new owner

The current website and phone stay up until his new site is tested and you choose to switch the domain and the phone. Do not run `SETUP-NEW.bat` on this PC.

Current name servers for `mobileexpressny.com` (leave these alone until the last step):

- `dns1.p03.nsone.net`
- `dns2.p03.nsone.net`
- `dns3.p03.nsone.net`
- `dns4.p03.nsone.net`

---

## Tonight, on your PC

### 1. Create your private GitHub repo

1. Open https://github.com/login and sign in. If you have no account, create one at https://github.com/signup.
2. Open https://github.com/new.
3. Repository name: `mobile-express`.
4. Choose **Private**.
5. Leave “Add a README” unchecked. This folder already has the files.
6. Click **Create repository**.

### 2. Push this folder

In this folder, replace `YOUR-USER` with your GitHub username:

```
git remote add origin https://github.com/YOUR-USER/mobile-express.git
git push -u origin main
```

A browser window may ask you to sign in to GitHub. Sign in as yourself. When it finishes, open `https://github.com/YOUR-USER/mobile-express` and confirm the shop files are there. `twilio-local.json` must not be in that list.

---

## Tomorrow, before opening the project

Install these three programs on his PC. Accept the default options.

1. Node.js: https://nodejs.org/en/download
2. Git: https://git-scm.com/download/win
3. VS Code: https://code.visualstudio.com/download

Create every account below with **his** email and **his** card. Write each value in a note on his PC. The setup script will ask for them in this order.

### 3. His GitHub account

1. Open https://github.com/signup and create the account with his email.
2. Stop there. The empty repo is created later, after the files are on his PC.

### 4. Netlify

1. Open https://app.netlify.com/signup and sign up with his email.
2. Confirm the email Netlify sends.
3. No site is created by hand. `SETUP-NEW.bat` creates it and opens a browser so this PC can log in.

### 5. Twilio

1. Open https://www.twilio.com/try-twilio and create a new account with his email.
2. Confirm the email and finish the signup questions.
3. Open https://console.twilio.com/.
4. On the account dashboard, copy **Account SID**. It starts with `AC`.
5. On that same page, click show, then copy **Auth Token**.
6. Do not buy a number and do not move the current shop number.

### 6. Airtable

1. Open https://airtable.com/signup and create the account with his email.
2. Skip any sample bases it offers.
3. Open https://airtable.com/create/tokens.
4. Click **Create new token**. Name it `Mobile Express`.
5. Add these four scopes:
   - `data.records:read`
   - `data.records:write`
   - `schema.bases:read`
   - `schema.bases:write`
6. Under Access, add the one workspace on the new account. Include future bases in that workspace.
7. Click **Create token** and copy the token. Airtable shows it once.
8. Leave the base uncreated. The script creates a base named Mobile Express with Orders and Repairs tables. A brand-new account has one workspace, which is what the script expects.

### 7. Stripe

1. Open https://dashboard.stripe.com/register and create the account with his email.
2. For tomorrow’s test, open https://dashboard.stripe.com/test/apikeys.
3. Copy the **Publishable key** (`pk_test_...`) and the **Secret key** (`sk_test_...`). Click Reveal test key to see the secret.
4. A test order uses card `4242 4242 4242 4242`, any future date, and any CVC. It does not charge a real card.
5. When he is ready for real charges, open https://dashboard.stripe.com/apikeys, copy the live `pk_live_` and `sk_live_` keys, and replace the two Stripe values in Netlify. Real charges need Stripe to finish identity verification: https://dashboard.stripe.com/account/onboarding.

### 8. Shop Gmail and app password

1. Open https://accounts.google.com/signup and create a Gmail address for the shop, such as the address he wants on receipts.
2. Turn on 2-Step Verification at https://myaccount.google.com/signinoptions/two-step-verification. An app password cannot be created until this is on.
3. Open https://myaccount.google.com/apppasswords.
4. Create an app password named `Mobile Express`. Copy the 16 letters. Spaces do not matter.
5. The Gmail address is both the mailbox and the shop email. The app password is not the normal Gmail password.

### 9. Shippo

1. Open https://apps.goshippo.com/join and create the account with his email.
2. Open https://portal.goshippo.com/api-config/api.
3. For a first test, click **Create new test key**. It starts with `shippo_test_`. Copy it once.
4. For real labels later, create a live key (`shippo_live_`) on that same page and replace `SHIPPO_API_KEY` in Netlify. Live labels bill his Shippo account.

### 10. OpenAI

1. Open https://platform.openai.com/signup and create the account with his email.
2. Add a payment method at https://platform.openai.com/settings/organization/billing. The phone address transcription will not run without it.
3. Open https://platform.openai.com/api-keys, click **Create new secret key**, and copy it. It starts with `sk-`.

### 11. Start the domain transfer, and do not change DNS

1. Open https://lookup.icann.org/en/lookup?name=mobileexpressny.com.
2. The **Registrar** line is the company that holds the domain. Log in there with the current owner.
3. Unlock the domain and copy the authorization code (also called an EPP or auth code). The registrar’s help page for “transfer domain away” shows the exact click.
4. At that same registrar, or at a new registrar in his name, start a transfer in. He needs the unlocked domain and the authorization code. Transfers often take several days.
5. Do not change the four `nsone.net` name servers. While they stay as they are, `mobileexpressny.com` still opens the current shop.

Have his warehouse street, city, state, ZIP, and phone ready. The script asks for those too.

---

## Tomorrow, on his PC

### 12. Copy the project

1. Open a terminal in a folder where he wants the shop.
2. Run, with your GitHub username:

```
git clone https://github.com/YOUR-USER/mobile-express.git
```

3. Open the new `mobile-express` folder and confirm `SETUP-NEW.bat` and `index.html` are there.

### 13. Remove it from your GitHub

1. Open `https://github.com/YOUR-USER/mobile-express/settings`.
2. Scroll to **Danger Zone**.
3. Click **Delete this repository**.
4. Type `YOUR-USER/mobile-express` to confirm.

GitHub’s own steps are at https://docs.github.com/en/repositories/creating-and-managing-repositories/deleting-a-repository.

### 14. Put Git on his account

1. On his GitHub account, open https://github.com/new.
2. Name it `mobile-express`, choose **Private**, leave README unchecked, and create it.
3. In the cloned folder on his PC:

```
git remote remove origin
git remote add origin https://github.com/HIS-USER/mobile-express.git
git push -u origin main
```

4. Sign the browser window in as him.
5. Open `https://github.com/HIS-USER/mobile-express` and confirm the files are there.

### 15. Open it in VS Code

1. Open VS Code.
2. File, then Open Folder, and choose the `mobile-express` folder.
3. The Source Control icon is on the left. The first push already connected GitHub. Later edits are committed there, then pushed with **Sync** or `git push`.
4. VS Code’s GitHub sign-in help: https://code.visualstudio.com/docs/sourcecontrol/github.

### 16. Run the one-click setup

1. In the `mobile-express` folder, double-click `SETUP-NEW.bat`.
2. If a browser opens, log into **his** Netlify account.
3. Paste the values when asked. Press Enter to keep a value that is already filled.

| It asks | Paste |
| --- | --- |
| Airtable token | The token from step 6 |
| Twilio account SID | The `AC...` value from step 5 |
| Twilio auth token | The auth token from step 5 |
| Stripe secret key | `sk_test_...` for the test |
| Stripe publishable key | `pk_test_...` for the test |
| Gmail address | The shop Gmail |
| Gmail app password | The 16-letter app password |
| Shop email | The same Gmail, or press Enter |
| Shippo API key | `shippo_test_...` or `shippo_live_...` |
| Sender name | `Mobile Express NY`, or press Enter |
| Sender street, city, state, ZIP, phone | His shipping address |
| Sender email | The shop Gmail, or press Enter |
| Admin password for order tools | A password he will use on the order pages |
| OpenAI API key | The `sk-...` key |
| Netlify site name | `mobile-express`, or press Enter |

4. Wait until it prints `Setup finished` and a site address like `https://mobile-express.netlify.app`.
5. If it stops, double-click `SETUP-NEW.bat` again. Answers already saved are kept.
6. The script writes the new Airtable, Twilio, and site IDs into the project and publishes the phone menu. It does not move the phone number.

### 17. Save those ID changes to his GitHub

The script edits project files. In the project folder:

```
git add -A
git commit -m "Use the new Airtable, Twilio, and Netlify accounts."
git push
```

### 18. Test the new site

1. Open the `netlify.app` address the script printed.
2. Confirm the shop page loads.
3. Place a test order with card `4242 4242 4242 4242`. Use any future date and any CVC.
4. In his Airtable account, open the Mobile Express base and confirm the order is in Orders.
5. Open `https://THE-SITE.netlify.app/admin-home.html`. The shop admin pages still use password `admin123`.
6. The order tools use the admin password typed into `SETUP-NEW.bat`.

### 19. Point the domain only after that test passes

1. In his Netlify account, open the new site, then **Domain management**.
2. Add `mobileexpressny.com` and `www.mobileexpressny.com`.
3. Netlify shows the records to set. Its guide is https://docs.netlify.com/domains-https/custom-domains/.
4. Only then change DNS. If the domain transfer is still pending, make this change at the current registrar. Replace the four `nsone.net` name servers only if Netlify tells you to use different name servers. If it tells you to add an A or CNAME record, add those records and leave the name servers as they are.
5. Until this step, customers still reach the current shop.

### 20. Leave the phone for a later cutover

The new phone menu exists on his Twilio account and is not attached to a number. Move `mobileexpressny.com`’s phone number only when you are ready to turn the old line off.

Voice recordings and the assistance function stay on the old Twilio account. Those files are not in this project.
