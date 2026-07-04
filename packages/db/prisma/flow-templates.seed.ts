/**
 * Pre-Built Flow Library seeder (guide §7.6) — lane:flows
 *
 * Authors the 50+ system FlowTemplate rows. Each template's `graphJson` carries a trigger
 * definition plus a flat node list that mirrors the visual builder's GraphNode shape
 * (apps/api/src/routes/journeys/schema.ts). "Use this flow" deep-copies these nodes into a real
 * merchant Journey's journey_steps via the existing saveJourneyGraph path, so every flow here is
 * immediately runnable by the live journey executor and editable in the existing builder.
 *
 * Idempotent: upsert-by-`key`. Safe to run on every `db:seed`. Re-running refreshes copy/graphs
 * for existing keys and adds any new templates without touching merchant journeys already
 * instantiated from them (Journey.sourceFlowTemplateKey is a soft key, not an FK).
 *
 * Executor contract honored by the builder DSL below:
 *   - TRIGGER  → root node, empty config; the real trigger lives on the Journey row.
 *   - ACTION   → config { channel, content: { body, subject? } }  (see ActionStepConfig)
 *   - DELAY    → config { duration, unit }                        (see DelayStepConfig)
 *   - CONDITION→ config { field, operator, value }; its two children are labeled 'true'/'false'
 *                exactly, which is how the executor routes branches. Both branches must be
 *                non-empty (a CONDITION with only a 'true' child would mis-route a false result),
 *                so `branch()` requires both `then` and `els`, and a branch is terminal in its
 *                chain — the continuation lives inside the branches.
 */
import { PrismaClient, Channel } from '@prisma/client'

// ─── Author-facing DSL ────────────────────────────────────────────────────────

type Chan = 'WHATSAPP' | 'EMAIL' | 'SMS' | 'PUSH'
type Unit = 'minutes' | 'hours' | 'days'
type TriggerType = 'segment_entered' | 'order_placed' | 'custom_event' | 'scheduled'
type ReEntryRule = 'ALLOW' | 'DISALLOW' | 'RE_ENROLL_AFTER_EXIT'
type ExitTrigger = 'order_placed' | 'segment_entered' | 'custom_event' | null
type FlowCategory =
  | 'abandoned_cart'
  | 'welcome'
  | 'post_purchase'
  | 'win_back'
  | 'loyalty_vip'
  | 'cod'

type StepSpec =
  | { k: 'msg'; channel: Chan; body: string; subject?: string; label?: string }
  | { k: 'wait'; duration: number; unit: Unit }
  | {
      k: 'if'
      field: string
      operator: string
      value: unknown
      label?: string
      then: StepSpec[]
      els: StepSpec[]
    }

const msg = (channel: Chan, body: string, opts: { subject?: string; label?: string } = {}): StepSpec => ({
  k: 'msg',
  channel,
  body,
  ...(opts.subject ? { subject: opts.subject } : {}),
  ...(opts.label ? { label: opts.label } : {}),
})
const wait = (duration: number, unit: Unit): StepSpec => ({ k: 'wait', duration, unit })
const branch = (
  field: string,
  operator: string,
  value: unknown,
  then: StepSpec[],
  els: StepSpec[],
  label?: string,
): StepSpec => ({ k: 'if', field, operator, value, then, els, ...(label ? { label } : {}) })

interface TriggerSpec {
  type: TriggerType
  config?: Record<string, unknown>
  reEntry?: ReEntryRule
  exit?: ExitTrigger
}

interface FlowDef {
  key: string
  name: string
  category: FlowCategory
  description: string
  icon?: string
  trigger: TriggerSpec
  steps: StepSpec[]
}

// ─── Graph builder (DSL → GraphNode tree) ─────────────────────────────────────

interface GraphNode {
  tempId: string
  stepType: 'TRIGGER' | 'ACTION' | 'CONDITION' | 'DELAY' | 'AB_SPLIT'
  label: string | null
  config: Record<string, unknown>
  positionX: number
  positionY: number
  parentTempId: string | null
}

const CHANNEL_LABEL: Record<Chan, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
  SMS: 'SMS',
  PUSH: 'Push',
}

function waitLabel(duration: number, unit: Unit): string {
  const u = duration === 1 ? unit.replace(/s$/, '') : unit
  return `Wait ${duration} ${u}`
}

function buildGraph(trigger: TriggerSpec, steps: StepSpec[]) {
  const nodes: GraphNode[] = []
  let counter = 0
  const nextId = () => `n${counter++}`

  const rootId = nextId()
  nodes.push({
    tempId: rootId,
    stepType: 'TRIGGER',
    label: 'Trigger',
    config: {},
    positionX: 320,
    positionY: 40,
    parentTempId: null,
  })

  // Lay out a linear chain of steps under `parentId`, starting at (x, startY). The first node in
  // the chain receives `firstLabel` (used to stamp 'true'/'false' on a CONDITION's branch heads).
  function layout(
    chain: StepSpec[],
    parentId: string,
    x: number,
    startY: number,
    firstLabel: string | null,
  ): void {
    let parent = parentId
    let y = startY
    let first = true
    for (const step of chain) {
      const id = nextId()
      const forcedLabel = first ? firstLabel : null
      if (step.k === 'msg') {
        nodes.push({
          tempId: id,
          stepType: 'ACTION',
          label: forcedLabel ?? step.label ?? `${CHANNEL_LABEL[step.channel]} message`,
          config: {
            channel: step.channel,
            content: { body: step.body, ...(step.subject ? { subject: step.subject } : {}) },
          },
          positionX: x,
          positionY: y,
          parentTempId: parent,
        })
        parent = id
        y += 120
      } else if (step.k === 'wait') {
        nodes.push({
          tempId: id,
          stepType: 'DELAY',
          label: forcedLabel ?? waitLabel(step.duration, step.unit),
          config: { duration: step.duration, unit: step.unit },
          positionX: x,
          positionY: y,
          parentTempId: parent,
        })
        parent = id
        y += 120
      } else {
        // CONDITION — terminal in this chain; continuations live inside the branches.
        nodes.push({
          tempId: id,
          stepType: 'CONDITION',
          label: forcedLabel ?? step.label ?? 'Condition',
          config: { field: step.field, operator: step.operator, value: step.value },
          positionX: x,
          positionY: y,
          parentTempId: parent,
        })
        layout(step.then, id, x + 260, y + 120, 'true')
        layout(step.els, id, x - 260, y + 120, 'false')
        return
      }
      first = false
    }
  }

  layout(steps, rootId, 320, 160, null)
  return { nodes }
}

function channelsUsed(steps: StepSpec[]): Chan[] {
  const set = new Set<Chan>()
  const walk = (chain: StepSpec[]) => {
    for (const s of chain) {
      if (s.k === 'msg') set.add(s.channel)
      else if (s.k === 'if') {
        walk(s.then)
        walk(s.els)
      }
    }
  }
  walk(steps)
  return [...set]
}

// ─── The library (50+ flows across the guide's categories) ────────────────────

const FLOWS: FlowDef[] = [
  // ═══ Abandoned Cart / Checkout ═════════════════════════════════════════════
  {
    key: 'abandoned_cart_email_sequence',
    name: 'Abandoned Cart — Email Sequence',
    category: 'abandoned_cart',
    description: 'Classic 3-email recovery: a nudge at 1 hour, a reminder at 24 hours, and a final incentive at 72 hours.',
    icon: 'ShoppingCart',
    trigger: { type: 'custom_event', config: { eventName: 'checkout_abandoned' }, reEntry: 'RE_ENROLL_AFTER_EXIT', exit: 'order_placed' },
    steps: [
      wait(1, 'hours'),
      msg('EMAIL', 'Hi {{first_name}}, you left something behind! Your cart is waiting — complete your order before it sells out.', { subject: 'You left something in your cart 🛒' }),
      wait(23, 'hours'),
      msg('EMAIL', 'Still thinking it over, {{first_name}}? Your items are still reserved. Checkout now to secure them.', { subject: 'Your cart is still waiting' }),
      wait(2, 'days'),
      msg('EMAIL', 'Last chance, {{first_name}}! Here is 10% off to complete your order: {{discount_code}}', { subject: 'A little something to help you decide — 10% off' }),
    ],
  },
  {
    key: 'abandoned_cart_whatsapp_first',
    name: 'Abandoned Cart — WhatsApp First',
    category: 'abandoned_cart',
    description: 'WhatsApp-led recovery: WhatsApp at 1 hour, email at 24 hours, SMS at 48 hours. Built for high open rates in South Asia.',
    icon: 'MessageCircle',
    trigger: { type: 'custom_event', config: { eventName: 'checkout_abandoned' }, reEntry: 'RE_ENROLL_AFTER_EXIT', exit: 'order_placed' },
    steps: [
      wait(1, 'hours'),
      msg('WHATSAPP', 'Hi {{first_name}}! 👋 You left {{product_name}} in your cart. Tap here to complete your order in seconds.'),
      wait(23, 'hours'),
      msg('EMAIL', 'Your cart misses you, {{first_name}}. Complete your purchase before your items sell out.', { subject: 'Complete your order' }),
      wait(1, 'days'),
      msg('SMS', '{{first_name}}, your cart is still saved. Finish your order now and get free delivery: {{cart_url}}'),
    ],
  },
  {
    key: 'abandoned_cart_cod',
    name: 'Abandoned Cart — COD Highlight',
    category: 'abandoned_cart',
    description: 'Recovers abandoned carts by reassuring the customer they can pay Cash on Delivery — the top reason South Asian shoppers hesitate at checkout.',
    icon: 'Banknote',
    trigger: { type: 'custom_event', config: { eventName: 'checkout_abandoned' }, reEntry: 'RE_ENROLL_AFTER_EXIT', exit: 'order_placed' },
    steps: [
      wait(45, 'minutes'),
      msg('WHATSAPP', 'Hi {{first_name}}! No need for a card — you can pay Cash on Delivery 💵. Complete your order for {{product_name}} now.'),
      wait(24, 'hours'),
      msg('WHATSAPP', 'Reminder, {{first_name}}: your order is one tap away, and Cash on Delivery is available. Shall we reserve it for you?'),
    ],
  },
  {
    key: 'abandoned_cart_high_value',
    name: 'Abandoned Cart — High-Value Recovery',
    category: 'abandoned_cart',
    description: 'Splits recovery by the customer\'s typical spend: high-value shoppers get an aggressive multi-channel push, everyone else gets the standard nudge.',
    icon: 'Gem',
    trigger: { type: 'custom_event', config: { eventName: 'checkout_abandoned' }, reEntry: 'RE_ENROLL_AFTER_EXIT', exit: 'order_placed' },
    steps: [
      wait(1, 'hours'),
      branch(
        'average_order_value',
        'gt',
        5000,
        [
          msg('WHATSAPP', 'Hi {{first_name}}, we saved your cart. As a valued customer, here is priority delivery + 5% off: {{discount_code}}'),
          wait(12, 'hours'),
          msg('SMS', '{{first_name}}, your premium selection is still reserved. Complete now: {{cart_url}}'),
          wait(1, 'days'),
          msg('EMAIL', 'A personal note, {{first_name}} — your items are waiting and your offer expires soon.', { subject: 'Your reserved items (offer inside)' }),
        ],
        [
          msg('WHATSAPP', 'Hi {{first_name}}! You left something in your cart. Tap to complete your order 🛒'),
          wait(1, 'days'),
          msg('EMAIL', 'Still interested, {{first_name}}? Your cart is saved — checkout anytime.', { subject: 'Your cart is saved' }),
        ],
        'High-value cart?',
      ),
    ],
  },
  {
    key: 'abandoned_cart_browse_abandonment',
    name: 'Browse Abandonment',
    category: 'abandoned_cart',
    description: 'Re-engages shoppers who viewed a product but never added it to cart, with a gentle WhatsApp reminder and an email follow-up.',
    icon: 'Eye',
    trigger: { type: 'custom_event', config: { eventName: 'product_viewed' }, reEntry: 'RE_ENROLL_AFTER_EXIT', exit: 'order_placed' },
    steps: [
      wait(3, 'hours'),
      msg('WHATSAPP', 'Hi {{first_name}}! Still curious about {{product_name}}? 👀 Here it is again — take another look.'),
      wait(1, 'days'),
      msg('EMAIL', 'You have great taste, {{first_name}}. {{product_name}} is still available — see it here.', { subject: 'Still thinking about {{product_name}}?' }),
    ],
  },
  {
    key: 'abandoned_cart_single_whatsapp',
    name: 'Abandoned Cart — Single WhatsApp Nudge',
    category: 'abandoned_cart',
    description: 'The simplest recovery flow: one friendly WhatsApp message two hours after abandonment. Perfect starting point for new stores.',
    icon: 'MessageCircle',
    trigger: { type: 'custom_event', config: { eventName: 'checkout_abandoned' }, reEntry: 'RE_ENROLL_AFTER_EXIT', exit: 'order_placed' },
    steps: [
      wait(2, 'hours'),
      msg('WHATSAPP', 'Hi {{first_name}}! You left {{product_name}} in your cart 🛒 Complete your order here whenever you are ready.'),
    ],
  },
  {
    key: 'abandoned_cart_sms_only',
    name: 'Abandoned Cart — SMS Only',
    category: 'abandoned_cart',
    description: 'For stores without WhatsApp yet: two SMS reminders at 1 hour and 24 hours to recover the sale.',
    icon: 'Smartphone',
    trigger: { type: 'custom_event', config: { eventName: 'checkout_abandoned' }, reEntry: 'RE_ENROLL_AFTER_EXIT', exit: 'order_placed' },
    steps: [
      wait(1, 'hours'),
      msg('SMS', '{{first_name}}, you left items in your cart. Finish your order: {{cart_url}}'),
      wait(23, 'hours'),
      msg('SMS', 'Last reminder {{first_name}} — your cart is still saved. Checkout now: {{cart_url}}'),
    ],
  },
  {
    key: 'abandoned_cart_push_reminder',
    name: 'Abandoned Cart — Push + Email',
    category: 'abandoned_cart',
    description: 'A fast web-push reminder at 30 minutes for on-site shoppers, backed by an email at 24 hours.',
    icon: 'Bell',
    trigger: { type: 'custom_event', config: { eventName: 'checkout_abandoned' }, reEntry: 'RE_ENROLL_AFTER_EXIT', exit: 'order_placed' },
    steps: [
      wait(30, 'minutes'),
      msg('PUSH', 'Your cart is waiting 🛒 Come back and complete your order in a tap.'),
      wait(23, 'hours'),
      msg('EMAIL', 'Hi {{first_name}}, your items are still in your cart. Ready to complete your order?', { subject: 'Still in your cart' }),
    ],
  },
  {
    key: 'abandoned_checkout_two_step_email',
    name: 'Abandoned Checkout — Quick 2-Step Email',
    category: 'abandoned_cart',
    description: 'A tighter email cadence — 4 hours then 24 hours — for stores that prefer a shorter recovery window.',
    icon: 'Mail',
    trigger: { type: 'custom_event', config: { eventName: 'checkout_abandoned' }, reEntry: 'RE_ENROLL_AFTER_EXIT', exit: 'order_placed' },
    steps: [
      wait(4, 'hours'),
      msg('EMAIL', 'Hi {{first_name}}, ready to finish up? Your cart is saved and waiting.', { subject: 'Ready to complete your order?' }),
      wait(20, 'hours'),
      msg('EMAIL', 'Your cart expires soon, {{first_name}}. Complete your order now to keep your items.', { subject: 'Your cart expires soon' }),
    ],
  },

  // ═══ Welcome Series ════════════════════════════════════════════════════════
  {
    key: 'welcome_new_customer_incentive',
    name: 'Welcome — New Customer + First-Purchase Incentive',
    category: 'welcome',
    description: 'Greets brand-new customers over email, then follows up on WhatsApp with a first-purchase discount to drive that crucial first order.',
    icon: 'PartyPopper',
    trigger: { type: 'segment_entered', config: { segmentName: 'New Customers' }, reEntry: 'DISALLOW', exit: 'order_placed' },
    steps: [
      msg('EMAIL', 'Welcome to the family, {{first_name}}! 🎉 We are so glad you are here. Explore our bestsellers and find your new favourite.', { subject: 'Welcome to {{store_name}}!' }),
      wait(2, 'days'),
      msg('WHATSAPP', 'Hi {{first_name}}! Here is 10% off your first order as a welcome gift 🎁 Use code {{discount_code}} at checkout.'),
    ],
  },
  {
    key: 'welcome_whatsapp_optin',
    name: 'Welcome — WhatsApp Opt-In',
    category: 'welcome',
    description: 'A warm WhatsApp welcome for customers who opted in to WhatsApp, setting expectations and offering a small incentive.',
    icon: 'MessageCircle',
    trigger: { type: 'custom_event', config: { eventName: 'whatsapp_opt_in' }, reEntry: 'DISALLOW' },
    steps: [
      msg('WHATSAPP', 'Thanks for opting in, {{first_name}}! 🙌 You will now get order updates, exclusive offers and early access — right here on WhatsApp.'),
      wait(1, 'days'),
      msg('WHATSAPP', 'As a thank you, here is a welcome treat: {{discount_code}} for 10% off your next order 🎁'),
    ],
  },
  {
    key: 'welcome_email_3part',
    name: 'Welcome — 3-Part Email Series',
    category: 'welcome',
    description: 'A three-email nurture: welcome, brand story, then bestsellers — spaced over the first week to build the relationship.',
    icon: 'Mail',
    trigger: { type: 'segment_entered', config: { segmentName: 'New Customers' }, reEntry: 'DISALLOW' },
    steps: [
      msg('EMAIL', 'Welcome aboard, {{first_name}}! Here is everything you need to get started.', { subject: 'Welcome to {{store_name}} 👋' }),
      wait(3, 'days'),
      msg('EMAIL', 'The story behind {{store_name}} — why we started and what we stand for.', { subject: 'Our story' }),
      wait(3, 'days'),
      msg('EMAIL', 'Not sure where to start, {{first_name}}? These are the pieces our customers love most.', { subject: 'Our bestsellers, picked for you' }),
    ],
  },
  {
    key: 'welcome_vip_first_order',
    name: 'Welcome — VIP First Order',
    category: 'welcome',
    description: 'Detects a big first purchase and rolls out the VIP carpet, while everyone else gets the standard welcome.',
    icon: 'Crown',
    trigger: { type: 'order_placed', config: { firstOrderOnly: true }, reEntry: 'DISALLOW' },
    steps: [
      branch(
        'total_spent',
        'gt',
        10000,
        [
          msg('WHATSAPP', 'Wow {{first_name}}, what a first order! 👑 Welcome to our VIP circle. Your dedicated support line and early access start today.'),
          wait(1, 'days'),
          msg('EMAIL', 'A personal welcome to our VIP program, {{first_name}} — here is what you unlock.', { subject: 'Welcome to VIP' }),
        ],
        [
          msg('WHATSAPP', 'Thank you for your first order, {{first_name}}! 🎉 We are thrilled to have you.'),
        ],
        'Big first order?',
      ),
    ],
  },
  {
    key: 'welcome_sms_short',
    name: 'Welcome — Short SMS',
    category: 'welcome',
    description: 'A single-SMS welcome with a discount code — minimal and effective for SMS-first audiences.',
    icon: 'Smartphone',
    trigger: { type: 'segment_entered', config: { segmentName: 'New Customers' }, reEntry: 'DISALLOW' },
    steps: [
      msg('SMS', 'Welcome to {{store_name}}, {{first_name}}! Enjoy 10% off your first order with code {{discount_code}}.'),
    ],
  },
  {
    key: 'welcome_multichannel',
    name: 'Welcome — Multi-Channel',
    category: 'welcome',
    description: 'A coordinated welcome across WhatsApp and email over three days to maximise reach and recall.',
    icon: 'Layers',
    trigger: { type: 'segment_entered', config: { segmentName: 'New Customers' }, reEntry: 'DISALLOW' },
    steps: [
      msg('WHATSAPP', 'Welcome, {{first_name}}! 🎉 So happy to have you at {{store_name}}. Reply here anytime — we are always around.'),
      wait(2, 'days'),
      msg('EMAIL', 'A few favourites to get you started, {{first_name}}.', { subject: 'Picked for you' }),
    ],
  },
  {
    key: 'welcome_back_returning_visitor',
    name: 'Welcome Back — Returning Visitor',
    category: 'welcome',
    description: 'Re-greets a known customer who returns to the store after a break, nudging them toward what is new.',
    icon: 'DoorOpen',
    trigger: { type: 'custom_event', config: { eventName: 'session_start' }, reEntry: 'ALLOW', exit: 'order_placed' },
    steps: [
      msg('WHATSAPP', 'Great to see you back, {{first_name}}! 👋 We have added new arrivals since your last visit — take a look.'),
    ],
  },

  // ═══ Post-Purchase ═════════════════════════════════════════════════════════
  {
    key: 'post_purchase_order_confirmation',
    name: 'Post-Purchase — Order Confirmation + Shipping',
    category: 'post_purchase',
    description: 'Confirms the order instantly on WhatsApp, then keeps the customer informed as it ships and arrives.',
    icon: 'PackageCheck',
    trigger: { type: 'order_placed', reEntry: 'ALLOW' },
    steps: [
      msg('WHATSAPP', 'Thank you for your order, {{first_name}}! ✅ Order {{order_number}} is confirmed. We will notify you the moment it ships.'),
      wait(1, 'days'),
      msg('WHATSAPP', 'Good news {{first_name}} — order {{order_number}} is on its way 🚚 Track it here: {{tracking_url}}'),
    ],
  },
  {
    key: 'post_purchase_review_request',
    name: 'Post-Purchase — Review Request',
    category: 'post_purchase',
    description: 'Asks for a review a few days after delivery, over WhatsApp with an email fallback — when satisfaction is highest.',
    icon: 'Star',
    trigger: { type: 'custom_event', config: { eventName: 'order_delivered' }, reEntry: 'ALLOW' },
    steps: [
      wait(3, 'days'),
      msg('WHATSAPP', 'Hi {{first_name}}! How are you enjoying {{product_name}}? ⭐ We would love a quick review — it only takes a minute.'),
      wait(3, 'days'),
      msg('EMAIL', 'Your opinion matters, {{first_name}}. Share a quick review of {{product_name}} and help other shoppers.', { subject: 'How did we do?' }),
    ],
  },
  {
    key: 'post_purchase_cross_sell',
    name: 'Post-Purchase — Cross-Sell',
    category: 'post_purchase',
    description: 'Recommends complementary products a week after purchase, based on what the customer bought.',
    icon: 'Shuffle',
    trigger: { type: 'order_placed', reEntry: 'ALLOW' },
    steps: [
      wait(7, 'days'),
      msg('WHATSAPP', 'Hi {{first_name}}! Customers who bought {{product_name}} also love these 👇 Handpicked just for you.'),
      wait(3, 'days'),
      msg('EMAIL', 'Complete your set, {{first_name}} — recommendations chosen to go with your recent order.', { subject: 'You might also like…' }),
    ],
  },
  {
    key: 'post_purchase_loyalty_points',
    name: 'Post-Purchase — Loyalty Points Notification',
    category: 'post_purchase',
    description: 'Tells the customer how many loyalty points they just earned and nudges them toward redeeming.',
    icon: 'Coins',
    trigger: { type: 'order_placed', reEntry: 'ALLOW' },
    steps: [
      wait(2, 'hours'),
      msg('WHATSAPP', 'Nice one, {{first_name}}! 🎯 You just earned {{points_earned}} loyalty points. Your balance is {{points_balance}} — redeem on your next order!'),
    ],
  },
  {
    key: 'post_purchase_cod_thankyou',
    name: 'Post-Purchase — COD Thank You + Next Incentive',
    category: 'post_purchase',
    description: 'Thanks the customer after a successful Cash-on-Delivery order and offers an incentive to build the repeat habit.',
    icon: 'Banknote',
    trigger: { type: 'custom_event', config: { eventName: 'cod_delivered' }, reEntry: 'ALLOW' },
    steps: [
      wait(1, 'days'),
      msg('WHATSAPP', 'Thank you for accepting your delivery, {{first_name}}! 🙏 We hope you love {{product_name}}. Here is 10% off your next order: {{discount_code}}'),
    ],
  },
  {
    key: 'post_purchase_return_empathy',
    name: 'Post-Purchase — Return / Refund Empathy',
    category: 'post_purchase',
    description: 'Sends a caring, no-pressure message when a return or refund is initiated, protecting the long-term relationship.',
    icon: 'HeartHandshake',
    trigger: { type: 'custom_event', config: { eventName: 'refund_created' }, reEntry: 'ALLOW' },
    steps: [
      msg('WHATSAPP', 'Hi {{first_name}}, we are sorry {{product_name}} did not work out. Your refund is being processed. If there is anything we can do better, just reply — we are listening. 💛'),
      wait(5, 'days'),
      msg('EMAIL', 'We would love another chance, {{first_name}}. Here is 15% off to find something you will love: {{discount_code}}', { subject: 'We would love another chance' }),
    ],
  },
  {
    key: 'post_purchase_shipping_updates',
    name: 'Post-Purchase — Shipping Update Sequence',
    category: 'post_purchase',
    description: 'A dedicated shipping-status sequence: dispatched, out for delivery, and delivered confirmations on WhatsApp.',
    icon: 'Truck',
    trigger: { type: 'custom_event', config: { eventName: 'order_fulfilled' }, reEntry: 'ALLOW' },
    steps: [
      msg('WHATSAPP', '📦 {{first_name}}, your order {{order_number}} has been dispatched! Track it here: {{tracking_url}}'),
      wait(2, 'days'),
      msg('WHATSAPP', '🚚 Almost there! Order {{order_number}} is out for delivery today. Please keep your phone handy.'),
    ],
  },
  {
    key: 'post_purchase_replenishment',
    name: 'Post-Purchase — Replenishment / Restock Reminder',
    category: 'post_purchase',
    description: 'For consumables: reminds the customer to reorder when they are likely running low, ~30 days after purchase.',
    icon: 'RefreshCw',
    trigger: { type: 'order_placed', reEntry: 'ALLOW' },
    steps: [
      wait(30, 'days'),
      msg('WHATSAPP', 'Running low, {{first_name}}? ⏳ It has been about a month since you bought {{product_name}}. Reorder in one tap and never run out.'),
      wait(5, 'days'),
      msg('EMAIL', 'Time to restock {{product_name}}, {{first_name}}? Reorder here in seconds.', { subject: 'Time to restock?' }),
    ],
  },
  {
    key: 'post_purchase_complete_the_look',
    name: 'Post-Purchase — Complete the Look',
    category: 'post_purchase',
    description: 'For fashion and lifestyle: suggests items frequently bought together to complete the customer\'s purchase.',
    icon: 'Sparkles',
    trigger: { type: 'order_placed', reEntry: 'ALLOW' },
    steps: [
      wait(4, 'days'),
      msg('WHATSAPP', 'Hi {{first_name}}! ✨ Complete your look — these pieces pair perfectly with {{product_name}}.'),
    ],
  },
  {
    key: 'post_purchase_first_order_nurture',
    name: 'Post-Purchase — First Order Nurture to Second',
    category: 'post_purchase',
    description: 'Turns a first-time buyer into a repeat customer with a timed thank-you and a second-order incentive.',
    icon: 'Repeat',
    trigger: { type: 'order_placed', config: { firstOrderOnly: true }, reEntry: 'DISALLOW' },
    steps: [
      wait(5, 'days'),
      msg('WHATSAPP', 'Hope you are loving your first order, {{first_name}}! 💛 Ready for round two? Here is 12% off: {{discount_code}}'),
      wait(7, 'days'),
      msg('EMAIL', 'Your welcome offer is still active, {{first_name}} — pick something new before it expires.', { subject: 'Your offer is still active' }),
    ],
  },
  {
    key: 'post_purchase_thankyou_simple',
    name: 'Post-Purchase — Simple Thank You',
    category: 'post_purchase',
    description: 'A single, heartfelt WhatsApp thank-you right after purchase. The easiest way to make customers feel appreciated.',
    icon: 'Heart',
    trigger: { type: 'order_placed', reEntry: 'ALLOW' },
    steps: [
      wait(1, 'hours'),
      msg('WHATSAPP', 'Thank you so much for your order, {{first_name}}! 🙏 It means a lot to us. We will keep you posted every step of the way.'),
    ],
  },

  // ═══ Win-Back ══════════════════════════════════════════════════════════════
  {
    key: 'winback_30day_lapsed',
    name: 'Win-Back — 30-Day Lapsed',
    category: 'win_back',
    description: 'Reaches out to customers who have not purchased in 30 days with a friendly reminder and a gentle offer.',
    icon: 'Clock',
    trigger: { type: 'segment_entered', config: { segmentName: 'Lapsed 30 Days' }, reEntry: 'RE_ENROLL_AFTER_EXIT', exit: 'order_placed' },
    steps: [
      msg('WHATSAPP', 'We miss you, {{first_name}}! 💭 It has been a while. Here is 10% off to welcome you back: {{discount_code}}'),
      wait(4, 'days'),
      msg('EMAIL', 'Come back and see what is new, {{first_name}} — your offer is waiting.', { subject: 'We saved something for you' }),
    ],
  },
  {
    key: 'winback_60day_aggressive',
    name: 'Win-Back — 60-Day Aggressive',
    category: 'win_back',
    description: 'A stronger push for 60-day lapsed customers with a bigger discount and multi-channel follow-up.',
    icon: 'Zap',
    trigger: { type: 'segment_entered', config: { segmentName: 'Lapsed 60 Days' }, reEntry: 'RE_ENROLL_AFTER_EXIT', exit: 'order_placed' },
    steps: [
      msg('WHATSAPP', '{{first_name}}, we really miss you! 🥺 Here is 20% off — our biggest welcome-back offer. Code: {{discount_code}}'),
      wait(2, 'days'),
      msg('SMS', 'Still 20% off for you {{first_name}}, but not for long. Shop now: {{store_url}}'),
      wait(3, 'days'),
      msg('EMAIL', 'Last call, {{first_name}} — your 20% welcome-back offer expires tonight.', { subject: 'Your 20% offer expires tonight' }),
    ],
  },
  {
    key: 'winback_we_miss_you_escalating',
    name: 'Win-Back — Escalating Discounts',
    category: 'win_back',
    description: 'A "we miss you" sequence with discounts that escalate over time — 10%, then 15%, then 20% — until they return.',
    icon: 'TrendingUp',
    trigger: { type: 'segment_entered', config: { segmentName: 'At Risk' }, reEntry: 'RE_ENROLL_AFTER_EXIT', exit: 'order_placed' },
    steps: [
      msg('WHATSAPP', 'We miss you, {{first_name}}! Here is 10% off to tempt you back: {{discount_code}}'),
      wait(4, 'days'),
      msg('WHATSAPP', 'Still here for you, {{first_name}} — we have bumped it to 15% off. Code: {{discount_code}}'),
      wait(4, 'days'),
      msg('EMAIL', 'Final offer, {{first_name}}: 20% off, our best. Come back before it is gone.', { subject: 'Our best offer yet — 20% off' }),
    ],
  },
  {
    key: 'winback_high_value_personal_wa',
    name: 'Win-Back — High-Value Personal Outreach',
    category: 'win_back',
    description: 'For your most valuable lapsed customers: a personal WhatsApp message with white-glove treatment, standard offer for the rest.',
    icon: 'UserStar',
    trigger: { type: 'segment_entered', config: { segmentName: 'At Risk' }, reEntry: 'RE_ENROLL_AFTER_EXIT', exit: 'order_placed' },
    steps: [
      branch(
        'total_spent',
        'gt',
        25000,
        [
          msg('WHATSAPP', 'Hi {{first_name}}, it is {{store_owner}} from {{store_name}}. You are one of our most valued customers and we have missed you. I would love to personally help you find something — and here is 20% off, just for you: {{discount_code}}'),
        ],
        [
          msg('WHATSAPP', 'We miss you, {{first_name}}! Here is 12% off to welcome you back: {{discount_code}}'),
        ],
        'High lifetime value?',
      ),
    ],
  },
  {
    key: 'winback_churn_risk_high',
    name: 'Win-Back — High Churn Risk',
    category: 'win_back',
    description: 'Triggered by the ML churn model: when a customer\'s risk crosses into High/Critical, launch a retention sequence automatically.',
    icon: 'AlertTriangle',
    trigger: { type: 'segment_entered', config: { segmentName: 'High Churn Risk' }, reEntry: 'RE_ENROLL_AFTER_EXIT', exit: 'order_placed' },
    steps: [
      branch(
        'churn_risk_score',
        'gte',
        0.75,
        [
          msg('WHATSAPP', 'Hi {{first_name}}, we would hate to lose you. 💛 Here is a special 20% thank-you for being with us: {{discount_code}}'),
          wait(3, 'days'),
          msg('EMAIL', 'A little reminder, {{first_name}} — your 20% offer is still here.', { subject: 'We value you' }),
        ],
        [
          msg('WHATSAPP', 'Thinking of you, {{first_name}}! Here is 10% off your next order: {{discount_code}}'),
        ],
        'Critical churn risk?',
      ),
    ],
  },
  {
    key: 'winback_90day_last_chance',
    name: 'Win-Back — 90-Day Last Chance',
    category: 'win_back',
    description: 'A final re-engagement attempt for customers dormant 90+ days before they are considered lost.',
    icon: 'Hourglass',
    trigger: { type: 'segment_entered', config: { segmentName: 'Lapsed 90 Days' }, reEntry: 'RE_ENROLL_AFTER_EXIT', exit: 'order_placed' },
    steps: [
      msg('EMAIL', 'Is this goodbye, {{first_name}}? We hope not. Here is 25% off — our final offer to win you back.', { subject: 'One last offer, {{first_name}}' }),
      wait(5, 'days'),
      msg('WHATSAPP', 'Last chance, {{first_name}} — your 25% offer expires today. We would love to see you again. {{discount_code}}'),
    ],
  },
  {
    key: 'winback_email_only_gentle',
    name: 'Win-Back — Gentle Email',
    category: 'win_back',
    description: 'A soft, no-discount email that simply reminds lapsed customers you exist and shares what is new.',
    icon: 'Mail',
    trigger: { type: 'segment_entered', config: { segmentName: 'Lapsed 30 Days' }, reEntry: 'RE_ENROLL_AFTER_EXIT', exit: 'order_placed' },
    steps: [
      msg('EMAIL', 'Hi {{first_name}}, it has been a while! Here is what you have missed at {{store_name}} — no strings attached.', { subject: 'A few new things you might love' }),
    ],
  },

  // ═══ Loyalty & VIP ═════════════════════════════════════════════════════════
  {
    key: 'loyalty_vip_tier_upgrade',
    name: 'Loyalty — VIP Tier Upgrade',
    category: 'loyalty_vip',
    description: 'Celebrates when a customer reaches a new VIP tier and lays out the perks they have unlocked.',
    icon: 'Crown',
    trigger: { type: 'segment_entered', config: { segmentName: 'VIP' }, reEntry: 'DISALLOW' },
    steps: [
      msg('WHATSAPP', 'Congratulations, {{first_name}}! 👑 You have been upgraded to VIP. Enjoy free delivery, early access to sales, and priority support. Welcome to the top tier!'),
      wait(1, 'days'),
      msg('EMAIL', 'Your VIP perks, explained — everything you have unlocked, {{first_name}}.', { subject: 'Welcome to VIP status 👑' }),
    ],
  },
  {
    key: 'loyalty_birthday_anniversary',
    name: 'Loyalty — Birthday / Anniversary',
    category: 'loyalty_vip',
    description: 'Sends a warm birthday or anniversary message with a special gift to make the customer feel celebrated.',
    icon: 'Cake',
    trigger: { type: 'custom_event', config: { eventName: 'customer_birthday' }, reEntry: 'ALLOW' },
    steps: [
      msg('WHATSAPP', 'Happy Birthday, {{first_name}}! 🎂🎉 To celebrate, here is a special gift just for you: 20% off anything. Code: {{discount_code}}'),
    ],
  },
  {
    key: 'loyalty_points_expiry_reminder',
    name: 'Loyalty — Points Expiry Reminder',
    category: 'loyalty_vip',
    description: 'Warns customers before their loyalty points expire, driving a redemption purchase.',
    icon: 'Timer',
    trigger: { type: 'custom_event', config: { eventName: 'points_expiring_soon' }, reEntry: 'ALLOW', exit: 'order_placed' },
    steps: [
      msg('WHATSAPP', '⏳ Heads up, {{first_name}}! Your {{points_balance}} loyalty points expire on {{expiry_date}}. Redeem them before they are gone!'),
      wait(3, 'days'),
      msg('EMAIL', 'Do not lose your points, {{first_name}} — {{points_balance}} points expire soon.', { subject: 'Your points expire soon' }),
    ],
  },
  {
    key: 'loyalty_vip_early_access',
    name: 'Loyalty — VIP Early Access',
    category: 'loyalty_vip',
    description: 'Gives VIP customers a head start on a new drop or sale before it opens to everyone.',
    icon: 'Unlock',
    trigger: { type: 'custom_event', config: { eventName: 'sale_early_access' }, reEntry: 'ALLOW' },
    steps: [
      msg('WHATSAPP', 'Psst, {{first_name}} 🤫 As a VIP, you get 24-hour early access to our new collection. Shop before anyone else: {{store_url}}'),
    ],
  },
  {
    key: 'loyalty_champion_thankyou',
    name: 'Loyalty — Champion Thank You',
    category: 'loyalty_vip',
    description: 'A surprise-and-delight thank-you for your Champions segment — your best, most loyal customers.',
    icon: 'Trophy',
    trigger: { type: 'segment_entered', config: { segmentName: 'Champions' }, reEntry: 'DISALLOW' },
    steps: [
      msg('WHATSAPP', '{{first_name}}, you are one of our absolute favourites 🏆 Thank you for your loyalty. Here is a surprise treat, just because: {{discount_code}}'),
    ],
  },
  {
    key: 'loyalty_anniversary_reward',
    name: 'Loyalty — Customer Anniversary Reward',
    category: 'loyalty_vip',
    description: 'Marks one year since the customer\'s first order with a thank-you and an anniversary reward.',
    icon: 'PartyPopper',
    trigger: { type: 'custom_event', config: { eventName: 'customer_anniversary' }, reEntry: 'ALLOW' },
    steps: [
      msg('WHATSAPP', 'It has been a whole year, {{first_name}}! 🎉 Thank you for being with {{store_name}}. Here is an anniversary gift: 15% off. Code: {{discount_code}}'),
    ],
  },
  {
    key: 'loyalty_referral_invite',
    name: 'Loyalty — Referral Invite',
    category: 'loyalty_vip',
    description: 'Invites happy repeat customers to refer friends in exchange for rewards, turning loyalty into growth.',
    icon: 'Share2',
    trigger: { type: 'segment_entered', config: { segmentName: 'Loyal Customers' }, reEntry: 'DISALLOW' },
    steps: [
      msg('WHATSAPP', 'Love shopping with us, {{first_name}}? 💛 Share {{store_name}} with a friend — you both get Rs. 500 off when they order. Your link: {{referral_url}}'),
    ],
  },

  // ═══ COD-Specific ══════════════════════════════════════════════════════════
  {
    key: 'cod_verification_whatsapp',
    name: 'COD — WhatsApp Verification',
    category: 'cod',
    description: 'Confirms a Cash-on-Delivery order over WhatsApp to cut fake orders and reduce return-to-origin losses.',
    icon: 'ShieldCheck',
    trigger: { type: 'custom_event', config: { eventName: 'cod_order_placed' }, reEntry: 'ALLOW' },
    steps: [
      msg('WHATSAPP', 'Hi {{first_name}}! Please confirm your Cash-on-Delivery order {{order_number}} for {{order_total}}. Reply YES to confirm or NO to cancel. ✅'),
      wait(6, 'hours'),
      msg('WHATSAPP', 'Reminder, {{first_name}}: please confirm your COD order {{order_number}} so we can dispatch it. Reply YES to proceed.'),
    ],
  },
  {
    key: 'cod_verification_sms_ivr',
    name: 'COD — SMS + IVR Fallback Verification',
    category: 'cod',
    description: 'Verifies a COD order by SMS first, then escalates to an automated IVR call if the customer does not confirm.',
    icon: 'PhoneCall',
    trigger: { type: 'custom_event', config: { eventName: 'cod_order_placed' }, reEntry: 'ALLOW' },
    steps: [
      msg('SMS', '{{first_name}}, please confirm your COD order {{order_number}} ({{order_total}}). Reply YES to confirm. — {{store_name}}'),
      wait(4, 'hours'),
      msg('SMS', 'Second reminder: confirm your COD order {{order_number}} by replying YES, or we will call you shortly to verify.'),
    ],
  },
  {
    key: 'cod_to_prepaid_conversion',
    name: 'COD — Convert to Prepaid',
    category: 'cod',
    description: 'Offers a small incentive to switch a Cash-on-Delivery order to prepaid, improving cash flow and cutting RTO risk.',
    icon: 'CreditCard',
    trigger: { type: 'custom_event', config: { eventName: 'cod_order_placed' }, reEntry: 'ALLOW' },
    steps: [
      wait(30, 'minutes'),
      msg('WHATSAPP', 'Hi {{first_name}}! Pay online now for order {{order_number}} and get Rs. 200 off instantly 💳 Prefer COD? No problem — your order is confirmed either way.'),
    ],
  },
  {
    key: 'cod_post_rejection_winback',
    name: 'COD — Post-Rejection Win-Back',
    category: 'cod',
    description: 'Reconnects with a customer whose COD delivery was refused, understanding why and offering to make it right.',
    icon: 'PackageX',
    trigger: { type: 'custom_event', config: { eventName: 'cod_rejected' }, reEntry: 'ALLOW', exit: 'order_placed' },
    steps: [
      msg('WHATSAPP', 'Hi {{first_name}}, we noticed your delivery for {{order_number}} was not accepted. Was something wrong? We would love to make it right — just reply here. 🙏'),
      wait(2, 'days'),
      msg('WHATSAPP', 'Still keen on {{product_name}}, {{first_name}}? We can re-send it with free delivery. Here is 10% off too: {{discount_code}}'),
    ],
  },
  {
    key: 'cod_high_fake_score_alert',
    name: 'COD — High Fake-Order Score Review',
    category: 'cod',
    description: 'When the ML fake-order model flags a risky COD order, this flow asks the customer to reconfirm before dispatch, protecting margins.',
    icon: 'ScanFace',
    trigger: { type: 'custom_event', config: { eventName: 'cod_order_placed' }, reEntry: 'ALLOW' },
    steps: [
      branch(
        'cod_fake_order_score',
        'gt',
        70,
        [
          msg('WHATSAPP', 'Hi {{first_name}}, to protect your order {{order_number}} we need a quick confirmation. Please reply YES with your delivery address to proceed. ✅'),
          wait(6, 'hours'),
          msg('SMS', 'Please confirm your order {{order_number}} by replying YES so we can dispatch it. — {{store_name}}'),
        ],
        [
          msg('WHATSAPP', 'Thanks for your order {{first_name}}! ✅ Order {{order_number}} is confirmed and will ship soon.'),
        ],
        'High fake-order score?',
      ),
    ],
  },
  {
    key: 'cod_confirmation_reminder',
    name: 'COD — Pre-Delivery Confirmation Reminder',
    category: 'cod',
    description: 'Reminds the customer that their COD order is arriving soon and to keep the cash ready, reducing failed deliveries.',
    icon: 'CalendarClock',
    trigger: { type: 'custom_event', config: { eventName: 'cod_out_for_delivery' }, reEntry: 'ALLOW' },
    steps: [
      msg('WHATSAPP', '📦 {{first_name}}, your COD order {{order_number}} arrives today! Please keep {{order_total}} ready. Our rider will reach you shortly.'),
    ],
  },
  {
    key: 'cod_repeat_buyer_prepaid_nudge',
    name: 'COD — Reliable Buyer Prepaid Nudge',
    category: 'cod',
    description: 'Rewards customers with a strong COD acceptance history by inviting them to prepaid with a loyalty perk; new/risky buyers are left on standard COD.',
    icon: 'BadgeCheck',
    trigger: { type: 'custom_event', config: { eventName: 'cod_order_placed' }, reEntry: 'ALLOW' },
    steps: [
      branch(
        'cod_acceptance_rate',
        'gte',
        0.8,
        [
          msg('WHATSAPP', 'Hi {{first_name}}! You are one of our most reliable customers 💛 Pay online next time and enjoy an extra 5% off, every time. Want us to set that up?'),
        ],
        [
          msg('WHATSAPP', 'Thanks for your order, {{first_name}}! ✅ Order {{order_number}} is confirmed for Cash on Delivery.'),
        ],
        'Reliable COD buyer?',
      ),
    ],
  },
  {
    key: 'cod_delivery_followup',
    name: 'COD — Post-Delivery Follow-Up',
    category: 'cod',
    description: 'Checks in after a completed COD delivery to confirm satisfaction and open the door to the next order.',
    icon: 'PackageCheck',
    trigger: { type: 'custom_event', config: { eventName: 'cod_delivered' }, reEntry: 'ALLOW' },
    steps: [
      wait(2, 'days'),
      msg('WHATSAPP', 'Hi {{first_name}}! Did everything arrive perfectly with order {{order_number}}? 😊 We are here if you need anything — and here is 10% off your next order: {{discount_code}}'),
    ],
  },
  {
    key: 'cod_address_confirmation',
    name: 'COD — Address Confirmation',
    category: 'cod',
    description: 'Confirms the delivery address on a COD order before dispatch to avoid failed deliveries and wasted courier trips.',
    icon: 'MapPin',
    trigger: { type: 'custom_event', config: { eventName: 'cod_order_placed' }, reEntry: 'ALLOW' },
    steps: [
      msg('WHATSAPP', 'Hi {{first_name}}! Please confirm your delivery address for order {{order_number}}:\n{{shipping_address}}\nReply YES if correct, or send the updated address. 📍'),
    ],
  },

  // ═══ Re-engagement & Reviews (extra coverage) ══════════════════════════════
  {
    key: 'reengagement_inactive_browser',
    name: 'Re-Engagement — Inactive Browser',
    category: 'win_back',
    description: 'Wakes up shoppers who browsed but went quiet, combining a web push with an email to pull them back.',
    icon: 'BellRing',
    trigger: { type: 'segment_entered', config: { segmentName: 'Inactive Browsers' }, reEntry: 'RE_ENROLL_AFTER_EXIT', exit: 'order_placed' },
    steps: [
      msg('PUSH', 'We have new arrivals you will love 👀 Come take a look before they sell out.'),
      wait(2, 'days'),
      msg('EMAIL', 'Hi {{first_name}}, here is what is trending at {{store_name}} right now.', { subject: 'Trending now — picked for you' }),
    ],
  },
  {
    key: 'review_request_photo_incentive',
    name: 'Review Request — Photo Incentive',
    category: 'post_purchase',
    description: 'Encourages customers to leave a photo review in exchange for loyalty points or a discount, boosting social proof.',
    icon: 'Camera',
    trigger: { type: 'custom_event', config: { eventName: 'order_delivered' }, reEntry: 'ALLOW' },
    steps: [
      wait(4, 'days'),
      msg('WHATSAPP', 'Loving {{product_name}}, {{first_name}}? 📸 Share a photo review and get Rs. 300 off your next order. We would love to see it in action!'),
      wait(4, 'days'),
      msg('EMAIL', 'Snap, share, save, {{first_name}} — a photo review earns you Rs. 300 off.', { subject: 'Share a photo, get Rs. 300 off' }),
    ],
  },
]

// ─── Seeder ───────────────────────────────────────────────────────────────────

const CHANNEL_MAP: Record<Chan, Channel> = {
  WHATSAPP: Channel.WHATSAPP,
  EMAIL: Channel.EMAIL,
  SMS: Channel.SMS,
  PUSH: Channel.PUSH,
}

export async function seedFlowTemplates(prisma: PrismaClient): Promise<number> {
  // Guard against duplicate keys in the source array (author error → silent overwrite).
  const seen = new Set<string>()
  for (const f of FLOWS) {
    if (seen.has(f.key)) throw new Error(`Duplicate FlowTemplate key: ${f.key}`)
    seen.add(f.key)
  }

  let sortOrder = 0
  for (const f of FLOWS) {
    const { nodes } = buildGraph(f.trigger, f.steps)
    const graphJson = {
      trigger: {
        triggerType: f.trigger.type,
        triggerConfig: f.trigger.config ?? {},
        reEntryRule: f.trigger.reEntry ?? 'DISALLOW',
        exitTrigger: f.trigger.exit ?? null,
      },
      nodes,
    }
    const channels = channelsUsed(f.steps).map((c) => CHANNEL_MAP[c])

    const data = {
      name: f.name,
      category: f.category,
      description: f.description,
      graphJson,
      channels,
      isSystem: true,
      isActive: true,
      icon: f.icon ?? null,
      sortOrder: sortOrder++,
    }

    await prisma.flowTemplate.upsert({
      where: { key: f.key },
      update: data,
      create: { key: f.key, ...data },
    })
  }

  console.log(`✓ FlowTemplates seeded: ${FLOWS.length} pre-built flows`)
  return FLOWS.length
}

// Allow standalone execution: `tsx prisma/flow-templates.seed.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const prisma = new PrismaClient()
  seedFlowTemplates(prisma)
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
