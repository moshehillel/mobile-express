const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const multer = require('multer');

const app = express();

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const IMAGES_DIR = path.join(ROOT_DIR, 'images');
const PRODUCTS_PATH = path.join(DATA_DIR, 'products.json');
const IVR_CONFIG_PATH = path.join(DATA_DIR, 'ivr-config.json');
const REPAIRS_CATALOG_PATH = path.join(DATA_DIR, 'repairs-catalog.json');
const TWILIO_JSON_PATH = path.join(ROOT_DIR, 'twilio.json');
const TWILIO_FUNC_PATH = path.join(ROOT_DIR, 'twilio_phones_total');

const PORT = process.env.PORT ? Number(process.env.PORT) : 5173;

app.use(express.json({ limit: '5mb' }));

const HIDDEN_PREFIXES = ['/node_modules', '/scripts', '/netlify', '/.netlify', '/.git', '/.claude', '/twilio_'];
const HIDDEN_FILES = new Set([
  '/server.js',
  '/package.json',
  '/package-lock.json',
  '/twilio.json',
  '/twilio.json.bak',
  '/twilio-local.json',
  '/netlify-env-vars.txt',
]);

app.use((req, res, next) => {
  let requestPath = req.path;
  try {
    requestPath = decodeURIComponent(requestPath);
  } catch {
    res.status(400).end();
    return;
  }
  const lower = requestPath.toLowerCase();
  const hidden = lower.includes('..')
    || lower.startsWith('/.')
    || HIDDEN_FILES.has(lower)
    || HIDDEN_PREFIXES.some((prefix) => lower.startsWith(prefix))
    || (lower.startsWith('/data/') && lower !== '/data/products.json');
  if (hidden) {
    res.status(404).end();
    return;
  }
  next();
});

app.use(express.static(ROOT_DIR));

const ensureDataFiles = async () => {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(IMAGES_DIR, { recursive: true });
  try {
    await fsp.access(PRODUCTS_PATH, fs.constants.F_OK);
  } catch {
    const initial = { products: [] };
    await fsp.writeFile(PRODUCTS_PATH, JSON.stringify(initial, null, 2), 'utf8');
  }
  try {
    await fsp.access(IVR_CONFIG_PATH, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(IVR_CONFIG_PATH, JSON.stringify(defaultIvrConfig(), null, 2), 'utf8');
  }
  try {
    await fsp.access(REPAIRS_CATALOG_PATH, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(REPAIRS_CATALOG_PATH, JSON.stringify({ makes: [] }, null, 2), 'utf8');
  }
};

const defaultIvrConfig = () => ({
  messages: {
    cat_phone: '', cat_case: '', cat_tablet: '', cat_travel: '', cat_local: '', cat_plan: '', cat_other: '',
  },
  catalog: {
    items: [],
  },
});

const readIvrConfig = async () => {
  const raw = await fsp.readFile(IVR_CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
};

const writeIvrConfig = async (cfg) => {
  await fsp.writeFile(IVR_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
};

const readProducts = async () => {
  const raw = await fsp.readFile(PRODUCTS_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return { products: [] };
  if (!Array.isArray(parsed.products)) parsed.products = [];
  return parsed;
};

const writeProducts = async (doc) => {
  await fsp.writeFile(PRODUCTS_PATH, JSON.stringify(doc, null, 2), 'utf8');
};

const safeSlug = (value) => {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
};

const uniqueId = () => {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, IMAGES_DIR),
  filename: (req, file, cb) => {
    const original = file.originalname || 'upload';
    const ext = path.extname(original).toLowerCase();
    const base = path.basename(original, ext);
    const safeBase = safeSlug(base) || 'image';
    cb(null, `${safeBase}-${Date.now()}${ext || '.jpg'}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

// ── IVR CONFIG ──

app.get('/api/ivr-config', async (req, res) => {
  try {
    const cfg = await readIvrConfig();
    res.json(cfg);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ivr-config', async (req, res) => {
  try {
    const cfg = req.body;
    if (!cfg || typeof cfg !== 'object') return res.status(400).json({ error: 'Invalid payload' });
    await writeIvrConfig(cfg);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Mutates `flow` from the catalog config: syncs each category's list message
// onto its gather widget, and routes single-price phones past the plan question
// (only phones WITH talk-only/talk-and-text variants ask gather_phone_mode).
const applyCatalogToFlow = (cfg, flow) => {
  const msgs = cfg.messages || {};
  const CAT_RE = /^gather_cat_(phone|case|tablet|travel|local|plan|other)$/;
  for (const state of flow.states) {
    const m = CAT_RE.exec(state.name);
    if (m) {
      delete state.properties.play;
      state.properties.say = msgs['cat_' + m[1]] || '';
      state.properties.language = 'en-US';
    }
  }

  const singlePhones = (cfg.catalog.items || [])
    .filter(it => (it.category || 'phone') === 'phone' && it.mode === 'single')
    .map(it => String(it.number));

  const sp = flow.states.find(s => s.name === 'split_cat_phone');
  if (sp) {
    sp.properties.input = '{{widgets.gather_cat_phone.Digits}}';
    sp.transitions = [
      // default (dual-price phones + anything unknown) -> ask the plan
      { next: 'gather_phone_mode', event: 'noMatch' },
      // single-price phones skip the plan question
      ...singlePhones.map(num => ({
        next: 'set_phone_cart_single', event: 'match',
        conditions: [{ friendly_name: `If value equal_to ${num}`, arguments: ['{{widgets.gather_cat_phone.Digits}}'], type: 'equal_to', value: num }],
      })),
      // star goes back to the main menu
      { next: 'gather_walcome', event: 'match',
        conditions: [{ friendly_name: 'If value equal_to *', arguments: ['{{widgets.gather_cat_phone.Digits}}'], type: 'equal_to', value: '*' }] },
    ];
  }
  return flow;
};

app.post('/api/ivr-apply', async (req, res) => {
  try {
    const cfg = await readIvrConfig();
    const flow = JSON.parse(await fsp.readFile(TWILIO_JSON_PATH, 'utf8'));
    applyCatalogToFlow(cfg, flow);
    await fsp.writeFile(TWILIO_JSON_PATH, JSON.stringify(flow, null, 2), 'utf8');
    await fsp.writeFile(TWILIO_FUNC_PATH, buildFunctionCode(cfg.catalog), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ── IVR WIDGET MESSAGES (every gather / say-play widget in twilio.json) ──

// The per-category list messages are auto-generated from the catalog by
// /api/ivr-apply, so they are NOT editable here (they'd be overwritten on save).
const SYNCED_WIDGETS = [
  'gather_cat_phone', 'gather_cat_case', 'gather_cat_tablet',
  'gather_cat_travel', 'gather_cat_local', 'gather_cat_plan', 'gather_cat_other',
];

// Friendly title + description + section for each widget the customer hears.
// Order matters: the admin list is rendered in exactly this order, walking the
// phone menu top-down — the main menu first, then everything under "press 1",
// then everything under "press 2", and so on, ending with the shared checkout
// steps every order passes through. `section` groups them under a header.
const WIDGET_INFO = {
  // ── Main menu ──
  gather_walcome:           { section: 'Main Menu',                   title: 'Main Menu (Welcome)',            desc: 'The first thing every caller hears. Routes: press 1 place a new order, 2 track an order, 3 activate a SIM, 4 hear terms & conditions, 5 repairs, 6 request a callback, 7 leave a voicemail.' },

  // ── Press 1: place a new order ──
  gather_order_category:    { section: '1 · Place an Order',         title: '1 · Order — Choose a Category',  desc: 'Heard after the caller presses 1. They pick what to shop for: 1 phones, 2 cases & accessories, 3 tablets, 4 travel SIMs & phones, 5 local SIMs & plans, 6 other items, 7 plans, ✱ go back. (The items inside each category — and the message read for each — are edited below in the Order Catalog.)' },
  gather_phone_mode:        { section: '1 · Place an Order',         title: '1·1 · Phones — Plan Choice',     desc: 'Phones only — heard right after the caller picks a phone. Choose a plan: 1 talk & text, 2 talk & media, 3 talk only, or 4 to hear what each plan includes.' },
  say_plan_details:         { section: '1 · Place an Order',         title: '1·1 · Phones — Plan Details',    desc: 'Phones only — played when the caller presses 4 at the plan menu. Explains what each plan includes, then returns to the plan choice.' },
  gather_add_more:          { section: '1 · Place an Order',         title: '1·2 · After an Item — Add More?', desc: 'Heard after every item is added to the cart: press 1 add more items, 2 check out, 3 return to the main menu.' },

  // ── Press 2: track an order ──
  gather_lookup_method:     { section: '2 · Track an Order',         title: '2 · Track — Which Number?',      desc: 'Heard after the caller presses 2. Look up the order using this calling number (press 1) or a different number (press 2).' },
  gather_lookup_number:     { section: '2 · Track an Order',         title: '2·2 · Track — Enter Number',     desc: 'Prompts the caller to type a 10-digit mobile number to look up their order.' },
  say_play_2:               { section: '2 · Track an Order',         title: '2 · Track — Order Found',        desc: 'Reads back the matching order and its status. Keep the {{…summary}} variable in the wording, then it returns to the main menu.' },
  say_play_3:               { section: '2 · Track an Order',         title: '2 · Track — Status Unavailable', desc: 'Played when the order status cannot be retrieved, then returns to the main menu.' },

  // ── Press 3: activate a SIM ──
  gather_activate_sim:      { section: '3 · Activate a SIM',         title: '3 · Activate a SIM — Choose',    desc: 'Heard after the caller presses 3: 1 travel SIM (opens the travel-SIM subflow), 2 US Mobile SIM, 3 Red Pocket SIM, ✱ go back.' },
  say_us_mobile_sim:        { section: '3 · Activate a SIM',         title: '3·2 · US Mobile SIM',            desc: 'Temporary "coming soon" message for US Mobile SIM activation, then returns to the main menu.' },
  say_redpocket_sim:        { section: '3 · Activate a SIM',         title: '3·3 · Red Pocket SIM',           desc: 'Temporary "coming soon" message for Red Pocket SIM activation, then returns to the main menu.' },

  // ── Press 4: terms & conditions ──
  say_play_terms:           { section: '4 · Terms & Conditions',     title: '4 · Terms & Conditions',         desc: 'Heard after the caller presses 4. Plays the terms & conditions, then returns to the main menu.' },

  // ── Press 5: repairs ──
  say_repairs:              { section: '5 · Repairs',                title: '5 · Repairs — Visit Website',    desc: 'Heard after the caller presses 5. Tells the caller to use the website for repairs, then returns to the main menu.' },

  // ── Press 6 & 7: callback / voicemail ──
  gather_2:                 { section: '6 & 7 · Callback & Voicemail', title: '6 · Callback — Enter Number',  desc: 'Heard after the caller presses 6. Asks the caller to enter a 10-digit callback number.' },
  say_play_5:               { section: '6 & 7 · Callback & Voicemail', title: '6 & 7 · Record Your Message',  desc: 'Used by both a callback (6) and leave-a-message (7). Asks the caller to record the reason for their call after the beep.' },
  say_play_6:               { section: '6 & 7 · Callback & Voicemail', title: '6 & 7 · Message Confirmed',    desc: 'Confirms the callback / message was logged, then returns to the main menu.' },

  // ── Checkout & payment (shared by every order path) ──
  gather_confirm_total:     { section: 'Checkout & Payment',         title: 'Confirm Order Total',            desc: 'Reads back the spoken order total, then asks to continue (press 1) or return to the main menu (press 2). Keep the {{…order_message}} variable so the total is spoken.' },
  record_name_and_address:  { section: 'Checkout & Payment',         title: 'Record Name & Address',          desc: 'Asks the caller to record their name and shipping address after the beep.' },
  gather_confirm_address:   { section: 'Checkout & Payment',         title: 'Confirm Shipping Address',       desc: 'Reads back the transcribed shipping address and asks to confirm (press 1) or re-record (press 2). Keep the address variable in the wording.' },
  say_address_incorrect:    { section: 'Checkout & Payment',         title: 'Address Incorrect — Hand Off',   desc: 'Played when the caller says the address is wrong; hands the order to the customer service team.' },
  say_play_1:               { section: 'Checkout & Payment',         title: 'Card Charge Failed',             desc: 'Played when a card charge fails, before payment is retried.' },
  say_play_4:               { section: 'Checkout & Payment',         title: 'Order Placed Successfully',      desc: 'The success message played after an order is placed.' },
  say_play_10:              { section: 'Checkout & Payment',         title: 'Order Success Chime',            desc: 'Short success sound played right after an order is placed.' },
};

const widgetMode = (props) =>
  (typeof props.play === 'string' && props.play.trim() !== '') ? 'play' : 'say';

app.get('/api/ivr-widgets', async (req, res) => {
  try {
    const flow = JSON.parse(await fsp.readFile(TWILIO_JSON_PATH, 'utf8'));
    const byName = {};
    for (const s of flow.states) {
      if ((s.type === 'gather-input-on-call' || s.type === 'say-play') && !SYNCED_WIDGETS.includes(s.name)) {
        byName[s.name] = s;
      }
    }
    // Curated order first (those in WIDGET_INFO), then any others.
    const order = [
      ...Object.keys(WIDGET_INFO).filter(n => byName[n]),
      ...Object.keys(byName).filter(n => !WIDGET_INFO[n]),
    ];
    const widgets = order.map(name => {
      const s = byName[name];
      const mode = widgetMode(s.properties);
      const info = WIDGET_INFO[name] || { title: name, desc: '', section: 'Other Messages' };
      return {
        name,
        kind: s.type === 'say-play' ? 'message' : 'menu',
        section: info.section || 'Other Messages',
        title: info.title,
        description: info.desc,
        mode,
        value: mode === 'play' ? (s.properties.play || '') : (s.properties.say || ''),
      };
    });
    res.json({ widgets });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ivr-widgets', async (req, res) => {
  try {
    const incoming = Array.isArray(req.body && req.body.widgets) ? req.body.widgets : null;
    if (!incoming) return res.status(400).json({ error: 'Invalid payload' });

    const flow = JSON.parse(await fsp.readFile(TWILIO_JSON_PATH, 'utf8'));
    const map = {};
    for (const w of incoming) if (w && w.name) map[w.name] = w;

    for (const s of flow.states) {
      if (!map[s.name]) continue;
      if (SYNCED_WIDGETS.includes(s.name)) continue;
      if (s.type !== 'gather-input-on-call' && s.type !== 'say-play') continue;

      const w = map[s.name];
      const value = String(w.value == null ? '' : w.value);
      if (w.mode === 'play') {
        s.properties.play = value;
        delete s.properties.say;
        delete s.properties.language;
      } else {
        s.properties.say = value;
        delete s.properties.play;
        s.properties.language = 'en-US';
      }
    }

    await fsp.writeFile(TWILIO_JSON_PATH, JSON.stringify(flow, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// Categories the IVR sells, in submenu order. Each maps to a flow variable
// bucket and a price table in the generated calculate function.
const CATEGORY_KEYS = ['phone', 'case', 'tablet', 'travel', 'local', 'plan', 'other'];

const buildCategoryTables = (items) => {
  const tables = { phone: {}, case: {}, tablet: {}, travel: {}, local: {}, plan: {}, other: {} };
  for (const item of items) {
    const cat = CATEGORY_KEYS.includes(item.category) ? item.category : 'phone';
    const num = Number(item.number);
    if (!num) continue;
    if (cat === 'phone' && item.mode !== 'single') {
      const def = tables.phone[num] || { name: item.name, ser: !!item.serialized, options: {} };
      // Plan order: 1 = Talk & Text, 2 = Talk & Media, 3 = Talk
      if (item.talk_text_price  != null) def.options[1] = { desc_suffix: 'talk and text',  price: Number(item.talk_text_price) };
      if (item.talk_media_price != null) def.options[2] = { desc_suffix: 'talk and media', price: Number(item.talk_media_price) };
      if (item.talk_only_price  != null) def.options[3] = { desc_suffix: 'talk only',      price: Number(item.talk_only_price) };
      def.ser = !!item.serialized;
      tables.phone[num] = def;
    } else {
      tables[cat][num] = { name: item.name, price: Number(item.price), ser: !!item.serialized };
    }
  }
  return tables;
};

const buildFunctionCode = (catalog) => {
  const { items = [] } = catalog;
  const tables = buildCategoryTables(items);

  return `/**
 * Twilio Function: phones_total (the "calculate" widget)
 * Catalog is managed via admin-ivr.html — do not edit manually.
 *
 * Expects one comma-separated list of per-category item numbers for each bucket:
 *   phones, cases, tablets, travel, local, other
 * Plus, for phones only:
 *   phone_modes -> comma-separated plan per phone (1=talk and text, 2=talk and media, 3=talk only)
 */

const TAX_RATE = 0.08125; // NY sales tax 8.125%

const PHONES  = ${JSON.stringify(tables.phone, null, 2)};
const CASES   = ${JSON.stringify(tables.case, null, 2)};
const TABLETS = ${JSON.stringify(tables.tablet, null, 2)};
const TRAVEL  = ${JSON.stringify(tables.travel, null, 2)};
const LOCAL   = ${JSON.stringify(tables.local, null, 2)};
const PLANS   = ${JSON.stringify(tables.plan, null, 2)};
const OTHER   = ${JSON.stringify(tables.other, null, 2)};

// Single-price buckets: param name -> price table
const SINGLE_BUCKETS = [
  { param: 'cases',   table: CASES   },
  { param: 'tablets', table: TABLETS },
  { param: 'travel',  table: TRAVEL  },
  { param: 'local',   table: LOCAL   },
  { param: 'plans',   table: PLANS   },
  { param: 'other',   table: OTHER   },
];

exports.handler = function (context, event, callback) {
  try {
    // Empty entries are dropped FIRST so a leading comma from appended flow
    // variables (e.g. ",1") does not turn into a phantom 0 (Number('') === 0).
    const parseList = (val) => {
      if (!val) return [];
      return String(val).split(/[,\\s]+/).map(v => v.trim()).filter(v => v !== '').map(Number).filter(n => Number.isFinite(n));
    };

    // Plan per phone (1=talk and text, 2=talk and media, 3=talk only), kept aligned with the phones list by dropping blanks.
    const parseModes = (val) => {
      if (val == null) return [];
      return String(val).split(',').map(s => s.trim()).filter(s => s !== '').map(Number).filter(n => Number.isFinite(n));
    };

    const normalize = s => String(s || '').replace(/\\s+/g, ' ').trim();
    const toCents = n => Math.round((Number(n) + Number.EPSILON) * 100);

    const joinSpeakable = (arr) => {
      if (arr.length === 0) return '';
      if (arr.length === 1) return arr[0];
      if (arr.length === 2) return arr[0] + ' and ' + arr[1];
      return arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1];
    };

    const numberToWords = (n) => {
      const ones = ['zero','one','two','three','four','five','six','seven','eight','nine'];
      const teens = ['ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
      const tens  = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
      const under100 = x => {
        if (x < 10) return ones[x];
        if (x < 20) return teens[x - 10];
        const t = Math.floor(x / 10), r = x % 10;
        return r ? tens[t] + ' ' + ones[r] : tens[t];
      };
      const under1000 = x => {
        if (x < 100) return under100(x);
        const h = Math.floor(x / 100), r = x % 100;
        return r ? ones[h] + ' hundred ' + under100(r) : ones[h] + ' hundred';
      };
      if (n < 1000) return under1000(n);
      const th = Math.floor(n / 1000), r = n % 1000;
      return r ? under1000(th) + ' thousand ' + under1000(r) : under1000(th) + ' thousand';
    };

    const moneyToTTS = cents => {
      const dollars = Math.floor(cents / 100), rem = cents % 100;
      return numberToWords(dollars) + ' ' + (dollars === 1 ? 'dollar' : 'dollars') + ' and ' + numberToWords(rem) + ' ' + (rem === 1 ? 'cent' : 'cents');
    };

    const phoneNums  = parseList(event.phones);
    const phoneModes = parseModes(event.phone_modes);

    const lines = [];
    const invalid = [];

    // Phones (with talk-only / talk-and-text plan)
    phoneNums.forEach((num, idx) => {
      const def = PHONES[num];
      if (!def) { invalid.push('phone ' + num); return; }
      if (def.options) {
        const mode = phoneModes[idx] || 1;
        const opt = def.options[mode] || def.options[1];
        if (!opt) { invalid.push('phone ' + num + ' plan'); return; }
        const desc = normalize(opt.desc_suffix ? def.name + ' ' + opt.desc_suffix : def.name);
        lines.push({ category: 'phone', number: num, mode, desc, price: opt.price, price_cents: toCents(opt.price), qty: 1, serialized: !!def.ser });
      } else {
        lines.push({ category: 'phone', number: num, mode: null, desc: normalize(def.name), price: def.price, price_cents: toCents(def.price), qty: 1, serialized: !!def.ser });
      }
    });

    // Single-price buckets
    SINGLE_BUCKETS.forEach(({ param, table }) => {
      parseList(event[param]).forEach(num => {
        const def = table[num];
        if (!def) { invalid.push(param + ' ' + num); return; }
        lines.push({ category: param, number: num, mode: null, desc: normalize(def.name), price: def.price, price_cents: toCents(def.price), qty: 1, serialized: !!def.ser });
      });
    });

    if (lines.length === 0) {
      return callback(null, { ok: false, error: 'No items selected', invalid });
    }
    if (invalid.length) {
      return callback(null, { ok: false, error: 'Invalid selection(s)', invalid });
    }

    const subtotalCents = lines.reduce((sum, l) => sum + l.price_cents, 0);
    const taxCents = Math.round(subtotalCents * TAX_RATE);
    const totalCents = subtotalCents + taxCents;

    const paySubtotal = (subtotalCents / 100).toFixed(2);
    const payTax = (taxCents / 100).toFixed(2);
    const payTotal = (totalCents / 100).toFixed(2);

    const orderDescription = joinSpeakable(lines.map(l => 'a ' + l.desc));
    const ttsSubtotal = moneyToTTS(subtotalCents);
    const ttsTax = moneyToTTS(taxCents);
    const ttsTotal = moneyToTTS(totalCents);

    const orderMessage =
      'Ok, so you want to order ' + orderDescription + '. ' +
      'Your subtotal is ' + ttsSubtotal + ', ' +
      'plus ' + ttsTax + ' sales tax, ' +
      'for a total of ' + ttsTotal + '.';

    const serializedCount = lines.reduce((n, l) => n + (l.serialized ? l.qty : 0), 0);

    return callback(null, {
      ok: true,
      order_description: orderDescription,
      order_message: orderMessage,
      tts_total: ttsTotal,
      pay_total: payTotal,
      pay_total_cents: totalCents,
      subtotal: paySubtotal,
      tax: payTax,
      serialized_count: serializedCount,
      lines
    });

  } catch (err) {
    return callback(null, { ok: false, error: err.message });
  }
};
`;
};

// ── REPAIRS CATALOG ──

app.get('/api/repairs-catalog', async (req, res) => {
  try {
    const raw = await fsp.readFile(REPAIRS_CATALOG_PATH, 'utf8');
    res.json(JSON.parse(raw));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/repairs-catalog', async (req, res) => {
  try {
    const catalog = req.body;
    if (!catalog || !Array.isArray(catalog.makes)) return res.status(400).json({ error: 'Invalid payload' });
    await fsp.writeFile(REPAIRS_CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PRODUCTS ──

app.get('/api/products', async (req, res) => {
  try {
    const doc = await readProducts();
    res.json(doc);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const relPath = `images/${req.file.filename}`;
    res.json({ imagePath: relPath });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }

    const name = String(payload.name || '').trim();
    const VALID_TYPES = ['phone', 'case', 'accessory', 'tablet', 'plan', 'other'];
    const type = VALID_TYPES.includes(payload.type) ? payload.type : 'phone';
    const price = Number(payload.price);
    const shortDesc = String(payload.shortDesc || '').trim();
    const longDesc = String(payload.longDesc || '').trim();
    const detailDesc = String(payload.detailDesc || '').trim();
    const image = String(payload.image || '').trim();

    if (!name || !Number.isFinite(price) || price < 0 || !shortDesc || !image) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const doc = await readProducts();

    const id = payload.id ? String(payload.id) : uniqueId();
    const product = {
      id,
      type,
      name,
      sku: payload.sku ? String(payload.sku).trim() : '',
      price,
      shortDesc,
      longDesc: longDesc || shortDesc,
      detailDesc,
      serialized: !!payload.serialized,
      image,
      gallery: Array.isArray(payload.gallery) ? payload.gallery : undefined,
      plans: Array.isArray(payload.plans) ? payload.plans : undefined,
      variants: Array.isArray(payload.variants) ? payload.variants : undefined,
    };

    const index = doc.products.findIndex((p) => p.id === id);
    if (index >= 0) {
      doc.products[index] = { ...doc.products[index], ...product };
    } else {
      doc.products.push(product);
    }

    await writeProducts(doc);
    res.json({ success: true, product });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save product' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      res.status(400).json({ error: 'Missing id' });
      return;
    }

    const doc = await readProducts();
    const before = doc.products.length;
    doc.products = doc.products.filter((p) => p.id !== id);

    if (doc.products.length === before) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    await writeProducts(doc);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

if (require.main === module) {
  ensureDataFiles()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Mobile Express admin server running on http://localhost:${PORT}`);
        console.log('Open admin page: http://localhost:' + PORT + '/admin-home.html');
      });
    })
    .catch((err) => {
      console.error('Failed to start server', err);
      process.exitCode = 1;
    });
}

module.exports = { buildFunctionCode, buildCategoryTables, CATEGORY_KEYS, applyCatalogToFlow };
