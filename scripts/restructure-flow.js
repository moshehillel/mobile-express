'use strict';
/**
 * Restructures twilio.json into the new ordering flow:
 *   main menu -> order submenu -> per-category select (+phone plan) -> add-more loop -> calculate
 * Everything from record-address onward (pay / place order / status / terms / callback) is preserved.
 *
 * Re-runnable: it keeps a known set of states, modifies a few, and (re)adds the new ones.
 * Run: node scripts/restructure-flow.js
 */

const fs = require('fs');
const path = require('path');
const FLOW_PATH = path.join(__dirname, '..', 'twilio.json');

const flow = JSON.parse(fs.readFileSync(FLOW_PATH, 'utf8'));

// ── States to preserve as-is (the unchanged downstream + reused branches) ──
const KEEP = new Set([
  'Trigger', 'gather_walcome', 'split_1',
  // checkout + address + payment + order placement
  'calculate', 'gather_confirm_total', 'split_3',
  'record_name_and_address', 'record_voicemail_1', 'transcribe_address',
  'gather_confirm_address', 'split_confirm_address', 'say_address_incorrect',
  'pay_1', 'say_play_1', 'place_order', 'split_7', 'faild_order', 'say_play_4', 'say_play_10', 'connect_call_1',
  // order status lookup
  'gather_lookup_method', 'split_5', 'gather_lookup_number', 'split_star_gather_lookup_number',
  'set_variables_1', 'set_variables_2', 'http_1', 'split_6', 'say_play_2', 'say_play_3',
  // terms
  'say_play_terms',
  // callback / leave a message
  'gather_2', 'split_star_gather_2', 'set_variables_4', 'set_variables_3',
  'say_play_5', 'record_voicemail_2', 'function_2', 'say_play_6',
]);

// Drop everything that is not preserved (new states are re-added below).
flow.states = flow.states.filter(s => KEEP.has(s.name));
const byName = Object.fromEntries(flow.states.map(s => [s.name, s]));

// ── Builders ──
const gather = (name, nextSplit, say, offset, digits = 1) => ({
  name, type: 'gather-input-on-call',
  transitions: [
    { next: nextSplit, event: 'keypress' },
    { event: 'speech' },
    { next: name, event: 'timeout' },
  ],
  properties: {
    say, language: 'en-US', number_of_digits: digits, speech_timeout: '5',
    offset, loop: 1, finish_on_key: '#', stop_gather: true,
    gather_language: 'en', speech_model: 'default', timeout: 6,
  },
});

const cond = (val, inputWidget, next) => ({
  next, event: 'match',
  conditions: [{
    friendly_name: `If value equal_to ${val}`,
    arguments: [`{{widgets.${inputWidget}.Digits}}`],
    type: 'equal_to', value: String(val),
  }],
});

const split = (name, inputWidget, transitions, offset) => ({
  name, type: 'split-based-on', transitions,
  properties: { input: `{{widgets.${inputWidget}.Digits}}`, offset },
});

const setVars = (name, vars, next, offset) => ({
  name, type: 'set-variables',
  transitions: [{ next, event: 'next' }],
  properties: { variables: vars, offset },
});

const sayPlay = (name, say, next, offset) => ({
  name, type: 'say-play',
  transitions: [{ next, event: 'audioComplete' }],
  properties: { say, offset, loop: 1 },
});

const runSubflow = (name, flowSid, next, offset) => ({
  name, type: 'run-subflow',
  transitions: [{ next, event: 'completed' }, { next, event: 'failed' }],
  properties: { flow_sid: flowSid, flow_revision: 'LatestPublished', offset },
});

const appendVar = (key, widget) => ({
  type: 'string', key,
  value: `{{flow.variables.${key}},{{widgets.${widget}.Digits}}`,
});

// ── Modify preserved states ──

// Main menu prompt (editable later via the Voice Messages editor / can switch to audio)
const gw = byName['gather_walcome'];
delete gw.properties.play;
gw.properties.say = 'Thank you for calling Mobile Express. To place a new order, press 1. '
  + 'To track an existing order, press 2. To activate a SIM, press 3. '
  + 'For terms and conditions, press 4. For repairs, press 5. '
  + 'To request a call back, press 6. To leave a message, press 7.';
gw.properties.language = 'en-US';
gw.properties.number_of_digits = 1;

// Main menu router
byName['split_1'].transitions = [
  { next: 'gather_walcome', event: 'noMatch' },
  cond(1, 'gather_walcome', 'reset_cart'),
  cond(2, 'gather_walcome', 'gather_lookup_method'),
  cond(3, 'gather_walcome', 'gather_activate_sim'),
  cond(4, 'gather_walcome', 'say_play_terms'),
  cond(5, 'gather_walcome', 'say_repairs'),
  cond(6, 'gather_walcome', 'gather_2'),
  cond(7, 'gather_walcome', 'set_variables_3'),
  cond('*', 'gather_walcome', 'gather_walcome'),
];

// calculate now receives one bucket per category
byName['calculate'].properties.parameters = [
  { value: '{{flow.variables.phones}}',      key: 'phones' },
  { value: '{{flow.variables.phone_modes}}', key: 'phone_modes' },
  { value: '{{flow.variables.cases}}',       key: 'cases' },
  { value: '{{flow.variables.tablets}}',     key: 'tablets' },
  { value: '{{flow.variables.travel}}',      key: 'travel' },
  { value: '{{flow.variables.local}}',       key: 'local' },
  { value: '{{flow.variables.other}}',       key: 'other' },
];

// ── New states ──
const placeholderList = 'Please enter the number of the item you want, then press pound. To go back, press star.';
const SINGLE = [
  { key: 'case',   bucket: 'cases',   y: 200 },
  { key: 'tablet', bucket: 'tablets', y: 600 },
  { key: 'travel', bucket: 'travel',  y: 1000 },
  { key: 'local',  bucket: 'local',   y: 1400 },
  { key: 'other',  bucket: 'other',   y: 1800 },
];

const newStates = [];

// Reset cart (fresh order from main menu) -> submenu
newStates.push(setVars('reset_cart', [
  { type: 'string', key: 'phones',      value: '' },
  { type: 'string', key: 'phone_modes', value: '' },
  { type: 'string', key: 'cases',       value: '' },
  { type: 'string', key: 'tablets',     value: '' },
  { type: 'string', key: 'travel',      value: '' },
  { type: 'string', key: 'local',       value: '' },
  { type: 'string', key: 'other',       value: '' },
], 'gather_order_category', { x: 400, y: 2400 }));

// Order category submenu
newStates.push(gather('gather_order_category', 'split_order_category',
  'To order phones, press 1. For cases and accessories, press 2. For tablets, press 3. '
  + 'For travel SIMs and phones, press 4. For local SIMs and plans, press 5. '
  + 'For other items, press 6. To return to the main menu, press star.',
  { x: 700, y: 2400 }));
newStates.push(split('split_order_category', 'gather_order_category', [
  { next: 'gather_order_category', event: 'noMatch' },
  cond(1, 'gather_order_category', 'gather_cat_phone'),
  cond(2, 'gather_order_category', 'gather_cat_case'),
  cond(3, 'gather_order_category', 'gather_cat_tablet'),
  cond(4, 'gather_order_category', 'gather_cat_travel'),
  cond(5, 'gather_order_category', 'gather_cat_local'),
  cond(6, 'gather_order_category', 'gather_cat_other'),
  cond('*', 'gather_order_category', 'gather_walcome'),
], { x: 1000, y: 2400 }));

// Phones: select -> plan -> append phone + mode -> add more
// Category item gathers use 2 digits + '#' so a category can hold more than 9 items.
newStates.push(gather('gather_cat_phone', 'split_cat_phone', placeholderList, { x: 1300, y: 100 }, 2));
newStates.push(split('split_cat_phone', 'gather_cat_phone', [
  { next: 'gather_phone_mode', event: 'noMatch' },
  cond('*', 'gather_cat_phone', 'gather_walcome'),
], { x: 1600, y: 100 }));
newStates.push(gather('gather_phone_mode', 'split_phone_mode',
  'For talk and text, press 1. For talk and media, press 2. For talk only, press 3. To hear what is included in each plan, press 4.', { x: 1900, y: 100 }));
newStates.push(split('split_phone_mode', 'gather_phone_mode', [
  { next: 'gather_phone_mode', event: 'noMatch' },
  cond(1, 'gather_phone_mode', 'set_phone_cart'),
  cond(2, 'gather_phone_mode', 'set_phone_cart'),
  cond(3, 'gather_phone_mode', 'set_phone_cart'),
  cond(4, 'gather_phone_mode', 'say_plan_details'),
], { x: 2200, y: 100 }));
// Plan explainer — caller presses 4, hears it, returns to the plan menu.
newStates.push(sayPlay('say_plan_details',
  'Talk only includes unlimited calling. Talk and text also includes unlimited texting. Talk and media also includes mobile data for the internet and apps.',
  'gather_phone_mode', { x: 2200, y: -150 }));
newStates.push(setVars('set_phone_cart', [
  appendVar('phones', 'gather_cat_phone'),
  appendVar('phone_modes', 'gather_phone_mode'),
], 'gather_add_more', { x: 2500, y: 100 }));
// Single-price phones skip the plan question; append a dummy mode to stay aligned
// with the phones list (the calculate function ignores the mode for single phones).
newStates.push(setVars('set_phone_cart_single', [
  appendVar('phones', 'gather_cat_phone'),
  { type: 'string', key: 'phone_modes', value: '{{flow.variables.phone_modes},1' },
], 'gather_add_more', { x: 2500, y: 300 }));

// Single-price categories: select -> append -> add more
for (const c of SINGLE) {
  const g = `gather_cat_${c.key}`;
  const sp = `split_cat_${c.key}`;
  const sv = `set_cart_${c.key}`;
  newStates.push(gather(g, sp, placeholderList, { x: 1300, y: c.y }, 2));
  newStates.push(split(sp, g, [
    { next: sv, event: 'noMatch' },
    cond('*', g, 'gather_walcome'),
  ], { x: 1600, y: c.y }));
  newStates.push(setVars(sv, [appendVar(c.bucket, g)], 'gather_add_more', { x: 1900, y: c.y }));
}

// Add-more loop
newStates.push(gather('gather_add_more', 'split_add_more',
  'To add more items, press 1. To check out, press 2. To return to the main menu, press 3.',
  { x: 2800, y: 1000 }));
newStates.push(split('split_add_more', 'gather_add_more', [
  { next: 'gather_add_more', event: 'noMatch' },
  cond(1, 'gather_add_more', 'gather_order_category'),
  cond(2, 'gather_add_more', 'calculate'),
  cond(3, 'gather_add_more', 'gather_walcome'),
  cond('*', 'gather_add_more', 'gather_walcome'),
], { x: 3100, y: 1000 }));

// Activate a SIM submenu: travel -> subflow (assign later), others -> placeholders
newStates.push(gather('gather_activate_sim', 'split_activate_sim',
  'To activate a travel SIM, press 1. For a US Mobile SIM, press 2. For a Red Pocket SIM, press 3. To go back, press star.',
  { x: 1020, y: 2800 }));
newStates.push(split('split_activate_sim', 'gather_activate_sim', [
  { next: 'gather_activate_sim', event: 'noMatch' },
  cond(1, 'gather_activate_sim', 'run_subflow_travel_sim'),
  cond(2, 'gather_activate_sim', 'say_us_mobile_sim'),
  cond(3, 'gather_activate_sim', 'say_redpocket_sim'),
  cond('*', 'gather_activate_sim', 'gather_walcome'),
], { x: 1360, y: 2800 }));
// Placeholder subflow SID — reassign to the real travel-SIM subflow in Studio.
newStates.push(runSubflow('run_subflow_travel_sim', 'FW56c8fbe176cf1cdd04758af840c1d898', 'gather_walcome', { x: 1700, y: 2700 }));
newStates.push(sayPlay('say_us_mobile_sim',
  'US Mobile SIM activation is coming soon. Returning you to the main menu.', 'gather_walcome', { x: 1700, y: 2950 }));
newStates.push(sayPlay('say_redpocket_sim',
  'Red Pocket SIM activation is coming soon. Returning you to the main menu.', 'gather_walcome', { x: 1700, y: 3200 }));

// Main-menu placeholder
newStates.push(sayPlay('say_repairs',
  'To request a repair, please visit our website, mobile express n y dot com. Returning you to the main menu.',
  'gather_walcome', { x: 700, y: 3500 }));

flow.states.push(...newStates);

// ── Validate: every transition target exists ──
const names = new Set(flow.states.map(s => s.name));
const dangling = [];
for (const s of flow.states) {
  for (const t of (s.transitions || [])) {
    if (t.next && !names.has(t.next)) dangling.push(`${s.name} -> ${t.next}`);
  }
}
if (dangling.length) {
  console.error('DANGLING TRANSITIONS:\n  ' + dangling.join('\n  '));
  process.exit(1);
}

fs.writeFileSync(FLOW_PATH, JSON.stringify(flow, null, 2), 'utf8');
console.log(`✓ Flow restructured. ${flow.states.length} states, no dangling transitions.`);
