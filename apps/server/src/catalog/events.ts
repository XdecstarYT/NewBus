import type { EventTemplate } from '@dw/shared';

/** Global random office events (on top of each industry's own events). */
export const OFFICE_EVENTS: EventTemplate[] = [
  {
    id: 'free-pizza-friday',
    title: 'Free Pizza Friday',
    emoji: '🍕',
    text: 'Someone ordered 40 pizzas. The office smells amazing and productivity is... complicated.',
    choices: [
      { label: 'Pizza party! Everyone eats 🎉', effect: { mood: 20, incomeMult: 0.9, minutes: 10 }, result: 'Morale skyrockets. A few people fell asleep in a cheese coma.' },
      { label: 'Working lunch - eat at your desks 💻', effect: { mood: 6, incomeMult: 1.2, minutes: 10 }, result: 'Greasy keyboards, but output is up 20%!' },
      { label: 'Sell the extra slices 💰', effect: { bitsPct: 0.02, mood: -5 }, result: 'Profit! The team is side-eyeing you though.' },
    ],
  },
  {
    id: 'server-fire',
    title: 'Server on Fire',
    emoji: '🔥',
    text: 'The server room is on fire. Cartoon fire, but still. Smoke is shaped like a sad face.',
    bad: true,
    insurable: 'fire',
    choices: [
      { label: 'Use the fire extinguisher 🧯', effect: { bitsPct: -0.03, mood: 3 }, result: 'Fire out! Repairs cost a little.' },
      { label: 'Toast marshmallows first 🍡', effect: { bitsPct: -0.06, mood: 15 }, result: 'Best team-building ever. Repairs cost more though.' },
      { label: 'Call it "Hot Data" and sell tickets 🎟️', effect: { chance: 0.4, bitsPct: 0.03, failBitsPct: -0.08 }, result: 'People paid to see it! Incredible.', failResult: 'Nobody came, and it spread to the break room.' },
    ],
  },
  {
    id: 'printer-jam',
    title: 'Printer Jam',
    emoji: '🖨️',
    text: 'The printer jammed and is making noises like a whale. 400 pages are stuck inside.',
    bad: true,
    choices: [
      { label: 'Gently coax it 🫳', effect: { chance: 0.6, mood: 5, failBitsPct: -0.01 }, result: 'It purrs back to life!', failResult: 'It ate your sleeve. You had to buy a new printer roller.' },
      { label: 'Percussive maintenance 👊', effect: { chance: 0.5, mood: 10, failBitsPct: -0.03 }, result: 'One whack and it works. Legendary.', failResult: 'It works now, but only prints in Comic Sans.' },
      { label: 'Go paperless forever 🌱', effect: { incomeMult: 1.05, minutes: 30, mood: -3 }, result: 'Eco-friendly and slightly faster!' },
    ],
  },
  {
    id: 'surprise-audit',
    title: 'Surprise Audit',
    emoji: '🧾',
    text: 'An auditor in a beige suit has arrived. They brought their own calculator. And a second calculator.',
    bad: true,
    insurable: 'audit',
    choices: [
      { label: 'Show them the spreadsheets 📊', effect: { bitsPct: -0.02, mood: -3 }, result: 'Small fine for a typo. Could be worse.' },
      { label: 'Offer them a muffin 🧁', effect: { chance: 0.5, mood: 5, failBitsPct: -0.05 }, result: 'They loved the muffin. Audit passed!', failResult: 'Bribery-adjacent! Bigger fine. The muffin was good though.' },
      { label: 'Hide in the supply closet 🫣', effect: { chance: 0.3, failBitsPct: -0.07, mood: 8 }, result: 'They gave up and left. Wow.', failResult: 'They found you. Awkward AND expensive.' },
    ],
  },
  {
    id: 'viral-meme',
    title: 'Viral Meme Boom',
    emoji: '📈',
    text: 'A photo of your intern sneezing has become the internet\'s favourite meme.',
    choices: [
      { label: 'Print it on mugs ☕', effect: { bitsPct: 0.04, mood: 5 }, result: 'Mugs sold out in an hour!' },
      { label: 'Ride the hype 🚀', effect: { incomeMult: 1.4, minutes: 15 }, result: 'Customers are flooding in. +40% for 15 minutes!' },
      { label: 'Respect the intern\'s privacy 🙏', effect: { mood: 15 }, result: 'The intern is touched. Team spirit is glowing.' },
    ],
  },
  {
    id: 'coffee-breakdown',
    title: 'Coffee Machine Breakdown',
    emoji: '☕',
    text: 'The coffee machine is making noises like a dial-up modem. Panic spreads.',
    bad: true,
    choices: [
      { label: 'Buy a fancy new one ✨', effect: { bitsPct: -0.03, mood: 12, energy: 20 }, result: 'Lattes for everyone! Energy restored.' },
      { label: 'Tea for everyone 🍵', effect: { mood: -5, incomeMult: 0.95, minutes: 10 }, result: 'Calm, but sleepy.' },
      { label: 'Fix it with duct tape 🩶', effect: { chance: 0.5, energy: 15, failBitsPct: -0.02 }, result: 'Somehow it works better than before.', failResult: 'It now only dispenses soup.' },
    ],
  },
  {
    id: 'rogue-ai-intern',
    title: 'Rogue AI Intern',
    emoji: '🤖',
    text: 'The AI intern renamed every file to "final_final_v3" and is asking for a corner office.',
    bad: true,
    choices: [
      { label: 'Give it the corner office 🏢', effect: { incomeMult: 1.15, minutes: 20, mood: -4 }, result: 'Happy AI, happy output. Humans are mildly jealous.' },
      { label: 'Turn it off and on again 🔌', effect: { chance: 0.7, failBitsPct: -0.03 }, result: 'Classic fix. Works every time.', failResult: 'It came back angrier. It deleted the snack budget.' },
      { label: 'Teach it about feelings 💗', effect: { mood: 10 }, result: 'It wrote everyone a poem. Tears were shed.' },
    ],
  },
  {
    id: 'power-outage',
    title: 'Power Outage',
    emoji: '🔦',
    text: 'Everything went dark. Someone is telling ghost stories by phone-light.',
    bad: true,
    insurable: 'fire',
    choices: [
      { label: 'Fire up the hamster generator 🐹', effect: { bitsPct: -0.01, incomeMult: 0.8, minutes: 5 }, result: 'Limited power. The hamsters are thrilled.' },
      { label: 'Candlelit brainstorm 🕯️', effect: { mood: 10, incomeMult: 0.7, minutes: 5 }, result: 'Great ideas, zero output. Romantic though.' },
      { label: 'Send everyone home early 🏠', effect: { mood: 20, energy: 30, incomeMult: 0.5, minutes: 10 }, result: 'Everyone comes back refreshed.' },
    ],
  },
  {
    id: 'office-dog',
    title: 'Office Dog Escapes',
    emoji: '🐕',
    text: 'The office dog escaped and is doing zoomies through accounting. Spreadsheets everywhere.',
    choices: [
      { label: 'Chase the dog! 🏃', effect: { energy: -15, mood: 15 }, result: 'Everyone is exhausted but beaming.' },
      { label: 'Lure it with treats 🦴', effect: { bitsPct: -0.005, mood: 5 }, result: 'Good boy recovered. Treats were pricey.' },
      { label: 'Let it supervise 🐶', effect: { incomeMult: 1.1, minutes: 15, mood: 8 }, result: 'Dog-supervised productivity is up 10%!' },
    ],
  },
];

/** Gossip/drama events fired by rivalries and crushes. {a} and {b} are worker names. */
export const DRAMA_EVENTS: EventTemplate[] = [
  {
    id: 'drama-rivalry',
    title: 'Office Drama!',
    emoji: '🎭',
    text: '{a} and {b} are arguing about whose turn it is to refill the stapler. Sides are being taken.',
    choices: [
      { label: 'Mediate with snacks 🍪', effect: { bitsPct: -0.005, mood: 8 }, result: 'Peace is restored. The cookies helped.' },
      { label: 'Let them settle it with a dance-off 💃', effect: { mood: 12, incomeMult: 0.9, minutes: 5 }, result: 'Spectacular. Nobody won. Everybody won.' },
      { label: 'Ignore it 🙉', effect: { mood: -8 }, result: 'The tension is... palpable.' },
    ],
  },
  {
    id: 'drama-crush',
    title: 'Coffee-Break Gossip',
    emoji: '💘',
    text: 'Rumour has it {a} has a crush on {b}. The whole office is whispering.',
    choices: [
      { label: 'Plan a "team lunch" for two 🍝', effect: { mood: 12, incomeMult: 1.05, minutes: 15 }, result: 'Adorable. Productivity is oddly up.' },
      { label: 'Office prank: secret admirer notes 💌', effect: { mood: 6 }, result: 'Giggles all round.' },
      { label: 'Back to work, everyone! 📋', effect: { mood: -5, incomeMult: 1.05, minutes: 10 }, result: 'Back to business. Booo.' },
    ],
  },
];

export const ALL_EVENT_IDS = [...OFFICE_EVENTS, ...DRAMA_EVENTS].map((e) => e.id);
