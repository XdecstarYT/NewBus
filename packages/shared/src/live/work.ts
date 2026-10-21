/**
 * Office work: real tasks players do (data entry, emails, reports, maths...).
 * Templates describe the job, give reference data to work from, list the answer
 * fields and say how it is graded: automatically (exact answers), by AI (rubric),
 * or by the Owner.
 */

export const WORK_CATEGORIES = {
  data: { label: 'Data entry', emoji: '⌨️' },
  sheets: { label: 'Spreadsheets & maths', emoji: '📊' },
  finance: { label: 'Invoices & budgets', emoji: '🧾' },
  inventory: { label: 'Stock & logistics', emoji: '📦' },
  planning: { label: 'Planning & scheduling', emoji: '🗓️' },
  email: { label: 'Emails', emoji: '✉️' },
  support: { label: 'Customer support', emoji: '🎧' },
  marketing: { label: 'Marketing copy', emoji: '📣' },
  social: { label: 'Social media', emoji: '📱' },
  product: { label: 'Product descriptions', emoji: '🏷️' },
  writing: { label: 'Reports & summaries', emoji: '📝' },
  proofread: { label: 'Proofreading & editing', emoji: '🔍' },
  meetings: { label: 'Meeting notes', emoji: '🗒️' },
  sales: { label: 'Sales & pitches', emoji: '🤝' },
  hr: { label: 'HR & hiring', emoji: '🧑‍💼' },
  research: { label: 'Research & analysis', emoji: '🔬' },
  creative: { label: 'Naming & creative', emoji: '💡' },
  it: { label: 'IT & bug triage', emoji: '🐞' },
} as const;
export type WorkCategory = keyof typeof WORK_CATEGORIES;

export interface WorkField {
  key: string;
  label: string;
  type: 'text' | 'long' | 'number' | 'choice';
  options?: string[];
  placeholder?: string;
}

export type Grading = 'auto' | 'ai' | 'owner';

export interface WorkTemplate {
  id: string;
  category: WorkCategory;
  title: string;
  emoji: string;
  /** what to do */
  brief: string;
  /** the material to work from (text, a list or CSV) */
  reference?: string;
  fields: WorkField[];
  grading: Grading;
  /** auto grading: the right answer per field */
  answers?: Record<string, string | number>;
  /** AI / owner grading: what a great answer looks like */
  rubric?: string;
  reward: number;
  energy: number;
  minutes: number;
  difficulty: 1 | 2 | 3;
}

const long = (key: string, label: string, placeholder?: string): WorkField => ({ key, label, type: 'long', placeholder });
const text = (key: string, label: string, placeholder?: string): WorkField => ({ key, label, type: 'text', placeholder });
const num = (key: string, label: string): WorkField => ({ key, label, type: 'number' });
const choice = (key: string, label: string, options: string[]): WorkField => ({ key, label, type: 'choice', options });

type T = Omit<WorkTemplate, 'reward' | 'energy' | 'minutes'> & Partial<Pick<WorkTemplate, 'reward' | 'energy' | 'minutes'>>;
const REWARD = { 1: 60, 2: 110, 3: 180 };
const ENERGY = { 1: 5, 2: 8, 3: 12 };
const MINUTES = { 1: 15, 2: 25, 3: 40 };
const t = (x: T): WorkTemplate => ({ reward: REWARD[x.difficulty], energy: ENERGY[x.difficulty], minutes: MINUTES[x.difficulty], ...x });

const auto = (x: Omit<T, 'grading'>) => t({ ...x, grading: 'auto' });
const ai = (x: Omit<T, 'grading'>) => t({ ...x, grading: 'ai' });

export const WORK_TEMPLATES: WorkTemplate[] = [
  // ------------------------------------------------------------ data entry (auto)
  auto({
    id: 'data-phonebook', category: 'data', title: 'Phone book clean-up', emoji: '☎️', difficulty: 1,
    brief: 'Find the details in the messy notes and type them in exactly.',
    reference: 'Notes from the front desk:\n- "Called by Priya Nair, she\'s at 555-0142, wants a quote"\n- "Tom Becker rang twice (555-0199) about the late order"\n- "Lena from Sunrise Cafe, call back on 555-0177"',
    fields: [text('priya', "Priya Nair's number"), text('tom', "Tom Becker's number"), text('lena', 'Which business is Lena from?')],
    answers: { priya: '555-0142', tom: '555-0199', lena: 'Sunrise Cafe' },
  }),
  auto({
    id: 'data-order-form', category: 'data', title: 'Order form transcription', emoji: '📋', difficulty: 1,
    brief: 'A customer emailed an order. Fill in the order form fields.',
    reference: 'Hi! I\'d like 12 sourdough loaves and 30 croissants delivered to 14 Maple Street on Friday. Pay on delivery. - Grace Lin',
    fields: [text('name', 'Customer name'), num('loaves', 'Sourdough loaves'), num('croissants', 'Croissants'), text('address', 'Delivery address'), choice('day', 'Delivery day', ['Monday', 'Wednesday', 'Friday', 'Sunday'])],
    answers: { name: 'Grace Lin', loaves: 12, croissants: 30, address: '14 Maple Street', day: 'Friday' },
  }),
  auto({
    id: 'data-dedupe', category: 'data', title: 'Remove duplicate customers', emoji: '🧹', difficulty: 2,
    brief: 'The customer list has duplicates (same email = same person). How many unique customers are there, and which email appears the most times?',
    reference: 'name,email\nAva Smith,ava@mail.com\nBen Ortiz,ben@mail.com\nava smith,ava@mail.com\nChloe Wu,chloe@mail.com\nBen O.,ben@mail.com\nDev Patel,dev@mail.com\nAVA SMITH,ava@mail.com\nChloe W,chloe@mail.com',
    fields: [num('unique', 'Unique customers'), text('most', 'Email that appears most')],
    answers: { unique: 4, most: 'ava@mail.com' },
  }),
  auto({
    id: 'data-categorise', category: 'data', title: 'Sort the expenses', emoji: '🗂️', difficulty: 1,
    brief: 'Put each expense in the right category.',
    reference: '1) Printer paper\n2) Electricity bill\n3) Train ticket to a client\n4) Team pizza lunch',
    fields: [choice('e1', '1) Printer paper', ['Office supplies', 'Utilities', 'Travel', 'Meals']), choice('e2', '2) Electricity bill', ['Office supplies', 'Utilities', 'Travel', 'Meals']), choice('e3', '3) Train ticket', ['Office supplies', 'Utilities', 'Travel', 'Meals']), choice('e4', '4) Team pizza', ['Office supplies', 'Utilities', 'Travel', 'Meals'])],
    answers: { e1: 'Office supplies', e2: 'Utilities', e3: 'Travel', e4: 'Meals' },
  }),
  auto({
    id: 'data-dates', category: 'data', title: 'Fix the date formats', emoji: '📅', difficulty: 2,
    brief: 'Convert each date to YYYY-MM-DD.',
    reference: 'A) 3rd of March 2026\nB) 12/25/2026 (US format)\nC) 7 Jan 2027',
    fields: [text('a', 'A'), text('b', 'B'), text('c', 'C')],
    answers: { a: '2026-03-03', b: '2026-12-25', c: '2027-01-07' },
  }),
  // ------------------------------------------------------------ spreadsheets & maths (auto)
  auto({
    id: 'sheet-sales-total', category: 'sheets', title: 'Weekly sales totals', emoji: '📈', difficulty: 1,
    brief: 'Add up the week. Which day sold the most?',
    reference: 'day,sales\nMon,120\nTue,95\nWed,140\nThu,110\nFri,185\nSat,210\nSun,90',
    fields: [num('total', 'Total sales for the week'), choice('best', 'Best day', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])],
    answers: { total: 950, best: 'Sat' },
  }),
  auto({
    id: 'sheet-average', category: 'sheets', title: 'Average order value', emoji: '🧮', difficulty: 1,
    brief: 'Work out the average order value (total ÷ number of orders), rounded to 2 decimals.',
    reference: 'order,value\n#101,24.50\n#102,13.00\n#103,48.25\n#104,30.00\n#105,9.75',
    fields: [num('avg', 'Average order value')],
    answers: { avg: 25.1 },
  }),
  auto({
    id: 'sheet-top-product', category: 'sheets', title: 'Best-selling product', emoji: '🏆', difficulty: 2,
    brief: 'Add up units per product across all rows. Which product sold the most units, and how many?',
    reference: 'date,product,units\n1 May,Bread,40\n1 May,Latte,25\n2 May,Pastry,30\n2 May,Bread,35\n3 May,Latte,50\n3 May,Pastry,20\n4 May,Latte,15',
    fields: [choice('top', 'Top product', ['Bread', 'Latte', 'Pastry']), num('units', 'Its total units')],
    answers: { top: 'Latte', units: 90 },
  }),
  auto({
    id: 'sheet-percent-change', category: 'sheets', title: 'Month-on-month growth', emoji: '📉', difficulty: 2,
    brief: 'Calculate the % change from April to May for each shop (rounded to 1 decimal; use a minus sign for drops).',
    reference: 'shop,april,may\nNorth,2000,2300\nSouth,1500,1200\nEast,800,1000',
    fields: [num('north', 'North %'), num('south', 'South %'), num('east', 'East %')],
    answers: { north: 15, south: -20, east: 25 },
  }),
  auto({
    id: 'sheet-margin', category: 'sheets', title: 'Profit margins', emoji: '💹', difficulty: 3,
    brief: 'Profit = price − cost. Margin % = profit ÷ price × 100 (1 decimal). Which product has the best margin?',
    reference: 'product,cost,price\nMug,4,10\nT-shirt,9,20\nCap,6,12\nPoster,1,5',
    fields: [num('mug', 'Mug margin %'), num('tshirt', 'T-shirt margin %'), num('cap', 'Cap margin %'), choice('best', 'Best margin', ['Mug', 'T-shirt', 'Cap', 'Poster'])],
    answers: { mug: 60, tshirt: 55, cap: 50, best: 'Poster' },
  }),
  auto({
    id: 'sheet-hours', category: 'sheets', title: 'Timesheet hours', emoji: '⏱️', difficulty: 2,
    brief: 'Work out the total hours worked (breaks are not paid).',
    reference: 'day,start,end,break_minutes\nMon,09:00,17:00,60\nTue,08:30,16:30,30\nWed,10:00,14:00,0',
    fields: [num('hours', 'Total paid hours')],
    answers: { hours: 18.5 },
  }),
  // ------------------------------------------------------------ invoices & budgets (auto)
  auto({
    id: 'fin-invoice', category: 'finance', title: 'Check an invoice', emoji: '🧾', difficulty: 1,
    brief: 'Work out the subtotal, 10% tax and total.',
    reference: 'Item, Qty, Unit price\nFlour sack, 4, 12.00\nButter box, 2, 18.50\nYeast pack, 5, 3.00',
    fields: [num('subtotal', 'Subtotal'), num('tax', 'Tax (10%)'), num('total', 'Total')],
    answers: { subtotal: 100, tax: 10, total: 110 },
  }),
  auto({
    id: 'fin-error', category: 'finance', title: 'Spot the invoice mistake', emoji: '🕵️', difficulty: 2,
    brief: 'One line on this invoice is calculated wrong. Which item, and what should its line total be?',
    reference: 'item,qty,price,line_total\nPens,10,1.50,15.00\nNotebooks,6,4.00,24.00\nStapler,3,7.25,22.75\nTape,4,2.00,8.00',
    fields: [choice('item', 'Wrong line', ['Pens', 'Notebooks', 'Stapler', 'Tape']), num('correct', 'Correct line total')],
    answers: { item: 'Stapler', correct: 21.75 },
  }),
  auto({
    id: 'fin-budget', category: 'finance', title: 'Monthly budget', emoji: '💰', difficulty: 2,
    brief: 'The team has a 5,000 budget. How much is left after these costs, and what is the biggest cost?',
    reference: 'Rent: 2,200\nWages: 1,800\nMarketing: 350\nSnacks: 120\nSoftware: 240',
    fields: [num('left', 'Money left'), choice('biggest', 'Biggest cost', ['Rent', 'Wages', 'Marketing', 'Snacks', 'Software'])],
    answers: { left: 290, biggest: 'Rent' },
  }),
  auto({
    id: 'fin-split', category: 'finance', title: 'Split the bill', emoji: '🍽️', difficulty: 1,
    brief: 'A team dinner cost 186 plus a 14 tip. Split it evenly between 8 people.',
    fields: [num('each', 'Each person pays')],
    answers: { each: 25 },
  }),
  auto({
    id: 'fin-discount', category: 'finance', title: 'Apply the discounts', emoji: '🏷️', difficulty: 2,
    brief: 'Work out the final price of each order.',
    reference: 'Order A: 80, 25% off\nOrder B: 120, 10% off, then 5 off delivery\nOrder C: 45, buy 2 get 1 free (price is for 3 items at 15 each)',
    fields: [num('a', 'Order A'), num('b', 'Order B'), num('c', 'Order C')],
    answers: { a: 60, b: 103, c: 30 },
  }),
  // ------------------------------------------------------------ stock & logistics (auto)
  auto({
    id: 'inv-stocktake', category: 'inventory', title: 'Stock take', emoji: '📦', difficulty: 1,
    brief: 'Start stock + deliveries − sold = closing stock. Fill in the closing stock.',
    reference: 'item,start,delivered,sold\nFlour,40,20,35\nSugar,25,0,12\nEggs,120,60,150',
    fields: [num('flour', 'Flour'), num('sugar', 'Sugar'), num('eggs', 'Eggs')],
    answers: { flour: 25, sugar: 13, eggs: 30 },
  }),
  auto({
    id: 'inv-reorder', category: 'inventory', title: 'What to reorder', emoji: '🔁', difficulty: 2,
    brief: 'Reorder anything below its minimum. How many items need reordering, and which one is furthest below its minimum?',
    reference: 'item,in_stock,minimum\nCups,140,100\nLids,60,100\nStraws,20,80\nNapkins,300,200\nSleeves,45,50',
    fields: [num('count', 'Items to reorder'), choice('worst', 'Furthest below', ['Cups', 'Lids', 'Straws', 'Napkins', 'Sleeves'])],
    answers: { count: 3, worst: 'Straws' },
  }),
  auto({
    id: 'inv-shipping', category: 'inventory', title: 'Cheapest shipping', emoji: '🚚', difficulty: 2,
    brief: 'A 12 kg parcel must arrive within 3 days. Which carrier is cheapest that meets the deadline, and what does it cost?',
    reference: 'carrier,price_per_kg,days\nZoomPost,1.20,4\nSwiftBox,1.50,2\nParcelPal,1.40,3\nTurtleShip,0.80,9',
    fields: [choice('carrier', 'Carrier', ['ZoomPost', 'SwiftBox', 'ParcelPal', 'TurtleShip']), num('cost', 'Cost')],
    answers: { carrier: 'ParcelPal', cost: 16.8 },
  }),
  // ------------------------------------------------------------ planning (auto + ai)
  auto({
    id: 'plan-meeting', category: 'planning', title: 'Find a meeting slot', emoji: '🗓️', difficulty: 2,
    brief: 'Find the one-hour slot on Tuesday when all three people are free (office hours 9-17).',
    reference: 'Ana busy: 9-11, 13-14\nBo busy: 11-12, 13-14\nCy busy: 9-10, 12-13, 14-16',
    fields: [choice('slot', 'Free slot starts at', ['9:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'])],
    answers: { slot: '16:00' },
  }),
  auto({
    id: 'plan-rota', category: 'planning', title: 'Count the shifts', emoji: '👥', difficulty: 1,
    brief: 'Who works the most shifts this week, and how many shifts are there in total?',
    reference: 'Mon: Kim, Leo\nTue: Leo, Mia\nWed: Kim, Mia\nThu: Leo\nFri: Kim, Leo, Mia',
    fields: [choice('most', 'Most shifts', ['Kim', 'Leo', 'Mia']), num('total', 'Total shifts')],
    answers: { most: 'Leo', total: 10 },
  }),
  ai({
    id: 'plan-event', category: 'planning', title: 'Plan a team event', emoji: '🎉', difficulty: 2,
    brief: 'Plan a fun 3-hour team event for 12 people with a budget of 600. Give a timetable and a cost breakdown that stays within budget.',
    fields: [long('timetable', 'Timetable'), long('costs', 'Cost breakdown')],
    rubric: 'Timetable covers ~3 hours with clear times. Costs are itemised, add up correctly and stay within 600 for 12 people. Activities are realistic and inclusive.',
  }),
  ai({
    id: 'plan-project', category: 'planning', title: 'Break a project into tasks', emoji: '🧩', difficulty: 3,
    brief: 'Break "launch a new coffee menu in 4 weeks" into weekly milestones with owners and risks.',
    fields: [long('plan', 'Week-by-week plan'), long('risks', 'Top 3 risks and how to handle them')],
    rubric: 'Four weekly milestones in a sensible order (recipes, suppliers, pricing, staff training, marketing, launch). Each has an owner role. Three specific risks with practical mitigations.',
  }),
  // ------------------------------------------------------------ emails (ai)
  ai({
    id: 'email-late-order', category: 'email', title: 'Apologise for a late order', emoji: '⏰', difficulty: 1,
    brief: 'A customer\'s order of 20 cupcakes for a birthday arrived 2 hours late. Write an apology email that offers something to make it right.',
    fields: [text('subject', 'Subject line'), long('body', 'Email body')],
    rubric: 'Clear sincere apology, takes responsibility without excuses, offers a concrete remedy (refund, discount or free item), friendly professional tone, under 150 words, good subject line.',
  }),
  ai({
    id: 'email-follow-up', category: 'email', title: 'Follow up after a meeting', emoji: '📨', difficulty: 1,
    brief: 'You met a café owner who might buy your coffee beans every week. Write a follow-up email.',
    reference: 'Meeting notes: owner = Sam Rivera, Rivera Roasts café. Wants 10 kg a week. Worried about price and delivery days. Next step: send a sample and price list.',
    fields: [text('subject', 'Subject line'), long('body', 'Email body')],
    rubric: 'Thanks Sam by name, recaps the 10 kg/week need, addresses price and delivery concerns, confirms the sample and price list, clear next step, concise and warm.',
  }),
  ai({
    id: 'email-decline', category: 'email', title: 'Politely say no', emoji: '🙅', difficulty: 2,
    brief: 'A big client asked for a 40% discount. You can only do 10%. Write a reply that keeps them happy.',
    fields: [long('body', 'Email body')],
    rubric: 'Declines 40% clearly but kindly, offers 10% (or other value adds), explains briefly why, keeps the relationship positive, professional, not grovelling.',
  }),
  ai({
    id: 'email-announce', category: 'email', title: 'Announce office news', emoji: '📢', difficulty: 1,
    brief: 'Write an all-staff email announcing the office moves to a new building next month.',
    reference: 'New address: 88 Harbour Road. Move date: the 15th. Packing boxes arrive on the 10th. Parking is free at the new place. Questions to Jo in Facilities.',
    fields: [text('subject', 'Subject line'), long('body', 'Email body')],
    rubric: 'Includes all facts (address, date, boxes on the 10th, free parking, contact Jo), upbeat tone, easy to scan, short.',
  }),
  ai({
    id: 'email-invoice-chase', category: 'email', title: 'Chase an unpaid invoice', emoji: '💸', difficulty: 2,
    brief: 'Invoice #2045 for 1,250 is 30 days overdue. Write a firm but polite reminder.',
    fields: [text('subject', 'Subject line'), long('body', 'Email body')],
    rubric: 'Mentions invoice number, amount and how overdue, asks for payment by a clear date, explains how to pay, polite but firm, no threats.',
  }),
  // ------------------------------------------------------------ customer support (ai)
  ai({
    id: 'support-refund', category: 'support', title: 'Handle a refund request', emoji: '🔁', difficulty: 1,
    brief: 'Reply to this customer.',
    reference: 'Customer: "My blender stopped working after 3 days. I want my money back NOW." Policy: full refund within 30 days with receipt, or a free replacement.',
    fields: [long('reply', 'Your reply')],
    rubric: 'Empathetic, calm, explains the two options from the policy, asks for the receipt, clear next steps, no blame.',
  }),
  ai({
    id: 'support-faq', category: 'support', title: 'Write 3 FAQ answers', emoji: '❓', difficulty: 2,
    brief: 'Write short, friendly FAQ answers for an online bakery.',
    reference: 'Q1: Do you deliver on weekends? (Yes, Saturday only, 8-12.)\nQ2: Are your products nut-free? (No, kitchen uses nuts.)\nQ3: Can I change my order? (Yes, up to 24 h before delivery.)',
    fields: [long('q1', 'Answer 1'), long('q2', 'Answer 2'), long('q3', 'Answer 3')],
    rubric: 'Each answer is accurate to the facts given, short (1-3 sentences), friendly, and Q2 is clear about allergy safety.',
  }),
  ai({
    id: 'support-angry', category: 'support', title: 'Calm an angry customer', emoji: '😤', difficulty: 2,
    brief: 'Reply to this live chat message.',
    reference: 'Customer: "This is the THIRD time my delivery went to the wrong address. Your company is useless."',
    fields: [long('reply', 'Your reply')],
    rubric: 'Acknowledges the frustration and the repeat failure, apologises, asks to confirm the address, explains a concrete fix (flag on account, priority re-send), offers a goodwill gesture.',
  }),
  ai({
    id: 'support-howto', category: 'support', title: 'Explain how to reset a password', emoji: '🔑', difficulty: 1,
    brief: 'Write step-by-step instructions a non-techy customer can follow.',
    reference: 'Steps: click "Log in" → "Forgot password" → enter email → open the email → click the link (valid 30 min) → choose a new password (8+ characters).',
    fields: [long('steps', 'Instructions')],
    rubric: 'Numbered steps covering everything in the reference, mentions the 30-minute limit and 8+ characters, simple language, a tip if the email does not arrive.',
  }),
  // ------------------------------------------------------------ marketing (ai)
  ai({
    id: 'mkt-tagline', category: 'marketing', title: 'Write 5 taglines', emoji: '✨', difficulty: 1,
    brief: 'Write five catchy taglines for a new eco-friendly coffee shop called "Bean There".',
    fields: [long('taglines', 'Five taglines (one per line)')],
    rubric: 'Exactly five, short (under 8 words), varied, catchy, fit an eco-friendly coffee shop, at least one plays on the name.',
  }),
  ai({
    id: 'mkt-flyer', category: 'marketing', title: 'Flyer copy for a sale', emoji: '📄', difficulty: 1,
    brief: 'Write the words for a flyer about a weekend sale.',
    reference: 'Shop: Pixel Pals Games. Sale: 30% off board games, Sat-Sun only. Free demo table. Address: 5 Station Road.',
    fields: [text('headline', 'Headline'), long('body', 'Body text'), text('cta', 'Call to action')],
    rubric: 'Includes all facts, headline grabs attention, body is short and scannable, strong call to action.',
  }),
  ai({
    id: 'mkt-newsletter', category: 'marketing', title: 'Monthly newsletter', emoji: '📰', difficulty: 2,
    brief: 'Write a short customer newsletter for a bakery covering three news items.',
    reference: 'News: new pumpkin loaf; opening at 7am now; loyalty card - 10th coffee free.',
    fields: [text('subject', 'Subject line'), long('body', 'Newsletter')],
    rubric: 'Covers all three news items, has a friendly intro and sign-off, clear sections, under 250 words, engaging subject line.',
  }),
  ai({
    id: 'mkt-ad', category: 'marketing', title: 'Write a 30-second radio ad', emoji: '📻', difficulty: 2,
    brief: 'Script a 30-second radio ad for a furniture store\'s spring sale.',
    fields: [long('script', 'Script (about 75 words)')],
    rubric: 'About 60-90 words, includes store name (make one up), the offer and when it ends, a memorable hook and a call to action, sounds natural read aloud.',
  }),
  ai({
    id: 'mkt-persona', category: 'marketing', title: 'Build a customer persona', emoji: '🧑', difficulty: 3,
    brief: 'Create a customer persona for a meal-kit delivery service aimed at busy parents.',
    fields: [text('name', 'Persona name & age'), long('goals', 'Goals and frustrations'), long('channels', 'How to reach them (channels & message)')],
    rubric: 'Believable persona, specific goals and pain points tied to busy parents, concrete channels and a message that addresses the pain points.',
  }),
  // ------------------------------------------------------------ social media (ai)
  ai({
    id: 'social-launch', category: 'social', title: 'Announce a product launch', emoji: '🚀', difficulty: 1,
    brief: 'Write one post each for Instagram and LinkedIn announcing a new reusable cup.',
    fields: [long('insta', 'Instagram post'), long('linkedin', 'LinkedIn post')],
    rubric: 'Instagram: fun, emoji, hashtags. LinkedIn: professional, focuses on sustainability/business value. Both mention the reusable cup and a call to action.',
  }),
  ai({
    id: 'social-calendar', category: 'social', title: 'One-week content calendar', emoji: '🗓️', difficulty: 2,
    brief: 'Plan 5 posts (Mon-Fri) for a gym\'s social media.',
    fields: [long('calendar', 'Day: idea / caption for each')],
    rubric: 'Five days, varied content types (tip, member story, offer, behind the scenes, challenge), each with a caption idea, consistent brand voice.',
  }),
  ai({
    id: 'social-reply', category: 'social', title: 'Reply to a bad review', emoji: '⭐', difficulty: 2,
    brief: 'Write a public reply to this 1-star review.',
    reference: 'Review: "Cold food, waited 40 minutes, staff ignored us. Never again." - Restaurant: The Copper Pot',
    fields: [long('reply', 'Public reply')],
    rubric: 'Apologises sincerely, does not argue, shows it will be fixed, invites them to get in touch privately, signs off with a name/role, short.',
  }),
  // ------------------------------------------------------------ product descriptions (ai)
  ai({
    id: 'prod-desc', category: 'product', title: 'Product description', emoji: '🏷️', difficulty: 1,
    brief: 'Write a shop description for this product.',
    reference: 'Product: CloudSoft hoodie. 100% organic cotton, 3 colours (sand, forest, night), unisex, machine washable, kangaroo pocket. Price 45.',
    fields: [text('title', 'Product title'), long('desc', 'Description (60-100 words)'), long('bullets', '3 bullet points')],
    rubric: 'Accurate to every fact, 60-100 words, appealing benefits not just features, three clear bullets.',
  }),
  ai({
    id: 'prod-compare', category: 'product', title: 'Compare two plans', emoji: '⚖️', difficulty: 2,
    brief: 'Explain the difference between these two plans so a customer can choose.',
    reference: 'Basic: 5/month, 1 user, 10 GB, email support.\nPro: 12/month, 5 users, 100 GB, chat support, custom domain.',
    fields: [long('explain', 'Comparison'), text('rec', 'Who should pick Pro?')],
    rubric: 'Correct facts, clear side-by-side differences, helpful recommendation of who Pro suits.',
  }),
  ai({
    id: 'prod-menu', category: 'product', title: 'Menu descriptions', emoji: '🍽️', difficulty: 1,
    brief: 'Write tasty one-line menu descriptions for these dishes.',
    reference: 'Tomato soup, Club sandwich, Lemon tart',
    fields: [text('soup', 'Tomato soup'), text('sandwich', 'Club sandwich'), text('tart', 'Lemon tart')],
    rubric: 'One appetising line each, vivid sensory words, not too long, no false claims.',
  }),
  // ------------------------------------------------------------ reports & summaries (ai)
  ai({
    id: 'write-summary', category: 'writing', title: 'Summarise a long email', emoji: '📝', difficulty: 1,
    brief: 'Summarise this email in 3 bullet points for a busy manager.',
    reference: 'Hi team, quick update on the warehouse move. The new racking was delayed by the supplier until next Thursday, which pushes our move from Monday to the following Wednesday. In the meantime, please keep using the old loading bay. We also need two volunteers for the weekend to help label shelves - pizza provided! Finally, the forklift training is still on for Friday at 2pm, attendance is required for everyone on the floor. Thanks, Rosa',
    fields: [long('bullets', 'Three bullet points')],
    rubric: 'Three bullets: move delayed to the following Wednesday (racking late), need 2 weekend volunteers, mandatory forklift training Friday 2pm. Concise, no missing facts.',
  }),
  ai({
    id: 'write-report', category: 'writing', title: 'Weekly sales report', emoji: '📊', difficulty: 2,
    brief: 'Write a short weekly report for the boss from this data: what went well, what didn\'t, one recommendation.',
    reference: 'Sales 9,400 (last week 8,100). Online orders up 30%. In-store down 5%. Croissants sold out by 10am 4 days. 2 staff sick.',
    fields: [long('report', 'Report')],
    rubric: 'Correct figures (+16% overall), highlights online growth and croissant sell-outs, notes in-store dip and staffing, gives a sensible recommendation (bake more croissants / cover staff), concise.',
  }),
  ai({
    id: 'write-incident', category: 'writing', title: 'Incident report', emoji: '⚠️', difficulty: 2,
    brief: 'Write a short incident report from these notes.',
    reference: 'Tuesday 3pm: a shelf in aisle 4 collapsed. Nobody hurt. 30 jars broken. Shelf bracket was loose. Aisle closed 1 hour. Cleaned by Jamal.',
    fields: [long('report', 'Incident report')],
    rubric: 'Structured (what, when, where, impact, cause, actions taken, prevention). Accurate, neutral tone, includes a prevention step (check brackets).',
  }),
  ai({
    id: 'write-brief', category: 'writing', title: 'Explain it simply', emoji: '🧒', difficulty: 2,
    brief: 'Explain what "cash flow" is to a 12-year-old who wants to start a lemonade stand.',
    fields: [long('explain', 'Explanation')],
    rubric: 'Accurate, simple language, uses the lemonade stand example, explains money in vs out and timing, short and fun.',
  }),
  // ------------------------------------------------------------ proofreading (ai)
  ai({
    id: 'proof-fix', category: 'proofread', title: 'Fix the typos', emoji: '🔍', difficulty: 1,
    brief: 'Rewrite this notice with all spelling and grammar mistakes fixed.',
    reference: 'Their will be a fire drill on wensday at 10am. Please make you\'re way to the car park and dont use the lift. Thank you for you\'re patience.',
    fields: [long('fixed', 'Corrected notice')],
    rubric: 'Fixes their→there, wensday→Wednesday, you\'re→your (twice), dont→don\'t, keeps meaning, no new errors.',
  }),
  ai({
    id: 'proof-shorten', category: 'proofread', title: 'Make it shorter', emoji: '✂️', difficulty: 2,
    brief: 'Cut this paragraph to under 40 words without losing any facts.',
    reference: 'We would like to take this opportunity to let you all know that, due to the fact that the kitchen is going to be renovated, it will unfortunately be closed for the entire period from Monday the 3rd until Friday the 7th, and we apologise for any inconvenience this may cause.',
    fields: [long('short', 'Shorter version')],
    rubric: 'Under 40 words, keeps: kitchen closed for renovation, Mon 3rd to Fri 7th, apology. Clear and natural.',
  }),
  ai({
    id: 'proof-tone', category: 'proofread', title: 'Make it friendlier', emoji: '😊', difficulty: 1,
    brief: 'Rewrite this message so it sounds friendly but still clear.',
    reference: 'STOP leaving dirty mugs in the sink. It is disgusting. Wash them or they will be thrown away.',
    fields: [long('friendly', 'Friendlier version')],
    rubric: 'Polite and warm, keeps the request (wash mugs) and the consequence softened, no shouting, short.',
  }),
  // ------------------------------------------------------------ meetings (ai + auto)
  ai({
    id: 'meet-minutes', category: 'meetings', title: 'Turn notes into minutes', emoji: '🗒️', difficulty: 2,
    brief: 'Turn these scribbles into tidy meeting minutes with decisions and action items.',
    reference: 'mtg 10am - Ali, Bea, Cam. budget ok\'d for new oven (3k). Bea to get 3 quotes by fri. xmas party - vote = bowling. Cam books it. next mtg tues 10',
    fields: [long('minutes', 'Minutes')],
    rubric: 'Attendees, decisions (oven budget 3k approved, party = bowling), actions with owners and dates (Bea quotes by Friday, Cam books bowling), next meeting Tuesday 10am. Clean format.',
  }),
  auto({
    id: 'meet-actions', category: 'meetings', title: 'Who does what?', emoji: '✅', difficulty: 1,
    brief: 'Read the meeting transcript and fill in who owns each action.',
    reference: 'Nina: "I\'ll send the contract today."\nOmar: "Can you update the website, Pia?" Pia: "Sure, by Thursday."\nOmar: "Then I\'ll call the printer."',
    fields: [choice('contract', 'Send the contract', ['Nina', 'Omar', 'Pia']), choice('website', 'Update the website', ['Nina', 'Omar', 'Pia']), choice('printer', 'Call the printer', ['Nina', 'Omar', 'Pia'])],
    answers: { contract: 'Nina', website: 'Pia', printer: 'Omar' },
  }),
  // ------------------------------------------------------------ sales (ai)
  ai({
    id: 'sales-pitch', category: 'sales', title: 'Elevator pitch', emoji: '🛗', difficulty: 1,
    brief: 'Write a 30-second elevator pitch for a company that cleans office windows with drones.',
    fields: [long('pitch', 'Pitch')],
    rubric: 'Under ~80 words, clear problem and solution, a benefit (safer/faster/cheaper), memorable, ends with an ask.',
  }),
  ai({
    id: 'sales-objection', category: 'sales', title: 'Handle an objection', emoji: '🛡️', difficulty: 2,
    brief: 'A prospect says: "Your software is too expensive." Write what you would reply.',
    reference: 'Product: StockSmart inventory app, 49/month. Saves about 6 hours a week of manual counting. Free 14-day trial.',
    fields: [long('reply', 'Reply')],
    rubric: 'Acknowledges the concern, reframes value (6 hours/week saved worth more than 49), mentions the free trial, asks a question to keep the conversation going.',
  }),
  ai({
    id: 'sales-proposal', category: 'sales', title: 'One-page proposal', emoji: '📑', difficulty: 3,
    brief: 'Write a one-page proposal to supply bread to a hotel.',
    reference: 'Hotel: Seaview Hotel, 80 rooms. Needs: 60 rolls + 10 loaves daily, delivery by 6am. Our price: rolls 0.40, loaves 2.50.',
    fields: [long('proposal', 'Proposal')],
    rubric: 'Sections (intro, what we offer, delivery, pricing with correct daily total 49.00, why us, next steps), professional and persuasive.',
  }),
  // ------------------------------------------------------------ HR (ai)
  ai({
    id: 'hr-job-ad', category: 'hr', title: 'Write a job advert', emoji: '📌', difficulty: 2,
    brief: 'Write a job advert for a part-time barista.',
    reference: '20 hours/week, weekends required, 12/hour, free coffee, training provided, apply by the 30th to jobs@beanthere.example',
    fields: [text('title', 'Job title'), long('ad', 'Advert')],
    rubric: 'Includes all facts, inviting tone, lists duties and what we look for, clear how to apply and deadline, inclusive language.',
  }),
  ai({
    id: 'hr-interview', category: 'hr', title: 'Interview questions', emoji: '🎤', difficulty: 1,
    brief: 'Write 5 good interview questions for a customer service role and say what a great answer shows.',
    fields: [long('questions', 'Questions + what a great answer shows')],
    rubric: 'Five relevant questions (behavioural and situational), each with what it reveals, no illegal/personal questions.',
  }),
  ai({
    id: 'hr-feedback', category: 'hr', title: 'Give constructive feedback', emoji: '💬', difficulty: 2,
    brief: 'Write feedback for an employee who is great with customers but is often 10 minutes late.',
    fields: [long('feedback', 'Feedback')],
    rubric: 'Starts with genuine praise, states the lateness issue with specifics and impact, sets a clear expectation, offers support, ends positively.',
  }),
  // ------------------------------------------------------------ research (auto + ai)
  auto({
    id: 'res-survey', category: 'research', title: 'Read the survey results', emoji: '📋', difficulty: 2,
    brief: 'Answer from the survey data.',
    reference: 'question,yes,no\nWould recommend us,84,16\nUsed our app,45,55\nWant longer hours,62,38\n(100 people answered)',
    fields: [num('recommend', '% who would recommend'), choice('most_no', 'Which question got the most "no"?', ['Would recommend us', 'Used our app', 'Want longer hours'])],
    answers: { recommend: 84, most_no: 'Used our app' },
  }),
  ai({
    id: 'res-swot', category: 'research', title: 'SWOT analysis', emoji: '🧭', difficulty: 3,
    brief: 'Do a SWOT analysis for a small bike repair shop near a university.',
    fields: [long('s', 'Strengths'), long('w', 'Weaknesses'), long('o', 'Opportunities'), long('t', 'Threats')],
    rubric: 'Each quadrant has 2-4 specific, realistic points tied to the location (students, seasonal demand, competition, e-bikes). No overlap between quadrants.',
  }),
  ai({
    id: 'res-compare-suppliers', category: 'research', title: 'Recommend a supplier', emoji: '🏭', difficulty: 2,
    brief: 'Recommend one supplier and explain why.',
    reference: 'Supplier A: cheapest, 7-day delivery, 3-star reviews.\nSupplier B: 10% dearer, next-day delivery, 5-star reviews.\nSupplier C: 5% dearer, 3-day delivery, 4-star reviews, eco-certified.',
    fields: [choice('pick', 'Pick', ['Supplier A', 'Supplier B', 'Supplier C']), long('why', 'Why')],
    rubric: 'Any pick is fine if well argued: weighs price vs speed vs quality vs eco, mentions trade-offs, clear and logical.',
  }),
  // ------------------------------------------------------------ creative (ai)
  ai({
    id: 'creative-names', category: 'creative', title: 'Name a new product', emoji: '💡', difficulty: 1,
    brief: 'Suggest 5 names for a glow-in-the-dark dog collar and pick your favourite.',
    fields: [long('names', 'Five names'), text('fav', 'Favourite and why')],
    rubric: 'Five catchy, varied, easy-to-say names that hint at glowing/dogs, a reasoned favourite.',
  }),
  ai({
    id: 'creative-slogan', category: 'creative', title: 'Company motto', emoji: '🏁', difficulty: 1,
    brief: 'Write a motto for your own company in this game and explain what it means.',
    fields: [text('motto', 'Motto'), long('meaning', 'What it means')],
    rubric: 'Short memorable motto, explanation connects it to the company\'s values, fun is welcome.',
  }),
  ai({
    id: 'creative-story', category: 'creative', title: 'Brand story', emoji: '📖', difficulty: 2,
    brief: 'Write the "About us" story for a family-run pizza place that opened in 1985.',
    fields: [long('story', 'About us (80-150 words)')],
    rubric: '80-150 words, warm, mentions 1985 and family, what makes the pizza special, ends inviting people in.',
  }),
  // ------------------------------------------------------------ IT (auto + ai)
  auto({
    id: 'it-priority', category: 'it', title: 'Prioritise bug reports', emoji: '🐞', difficulty: 2,
    brief: 'Give each bug a priority: High = blocks payments or loses data; Medium = annoying but has a workaround; Low = cosmetic.',
    reference: 'Bug 1: Checkout button does nothing on mobile.\nBug 2: Logo is slightly blurry on the About page.\nBug 3: Search ignores capital letters, but filters still work.\nBug 4: Saving a draft sometimes deletes it.',
    fields: [choice('b1', 'Bug 1', ['High', 'Medium', 'Low']), choice('b2', 'Bug 2', ['High', 'Medium', 'Low']), choice('b3', 'Bug 3', ['High', 'Medium', 'Low']), choice('b4', 'Bug 4', ['High', 'Medium', 'Low'])],
    answers: { b1: 'High', b2: 'Low', b3: 'Medium', b4: 'High' },
  }),
  ai({
    id: 'it-bug-report', category: 'it', title: 'Write a good bug report', emoji: '🧾', difficulty: 2,
    brief: 'Turn this complaint into a proper bug report.',
    reference: 'Complaint: "the app crashes when I upload a photo. iPhone. happened like 5 times today. was fine last week."',
    fields: [text('title', 'Title'), long('steps', 'Steps to reproduce'), long('details', 'Expected vs actual, device, frequency')],
    rubric: 'Clear title, numbered repro steps, expected vs actual, device (iPhone), frequency (5 times today), notes it started recently (regression).',
  }),
  ai({
    id: 'it-explain', category: 'it', title: 'Explain a tech change to staff', emoji: '🖥️', difficulty: 1,
    brief: 'Tell staff, in plain words, why they now need two-factor authentication (2FA) and what to do.',
    fields: [long('message', 'Message')],
    rubric: 'Explains why (protects accounts even if a password leaks), simple steps to set it up, reassuring tone, no jargon.',
  }),
];

const BY_ID = new Map(WORK_TEMPLATES.map((x) => [x.id, x]));
export const findWorkTemplate = (id: string) => BY_ID.get(id);

/** Compare one answer with the expected one (numbers get a small tolerance). */
export function answerMatches(expected: string | number, given: unknown) {
  if (typeof expected === 'number') {
    const n = Number(String(given ?? '').replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(n) || String(given ?? '').trim() === '') return false;
    return Math.abs(n - expected) <= Math.max(0.01, Math.abs(expected) * 0.005);
  }
  const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!]$/, '');
  return norm(given) === norm(expected);
}

/** Score 0-100 for an auto-graded template, plus per-field results. */
export function autoGrade(answers: Record<string, string | number>, given: Record<string, unknown>) {
  const keys = Object.keys(answers);
  const results = Object.fromEntries(keys.map((k) => [k, answerMatches(answers[k], given[k])]));
  const right = Object.values(results).filter(Boolean).length;
  return { score: keys.length ? Math.round((right / keys.length) * 100) : 0, results };
}

/** A pool of client personas for jobs and customers when no AI is available. */
export const CLIENT_NAMES = [
  ['Grandma Gloria', '👵'], ['Captain Byte', '🧑‍✈️'], ['Dr. Waffles', '🧇'], ['Sir Reginald', '🎩'], ['Luna the Lawyer', '⚖️'],
  ['Coach Rex', '🏋️'], ['Professor Plum', '🎓'], ['Mayor McQuack', '🦆'], ['Chef Pierre', '👨‍🍳'], ['DJ Spinz', '🎧'],
  ['Nurse Noor', '🩺'], ['Farmer Fern', '🧑‍🌾'], ['Robo-Rita', '🤖'], ['Agent Zero', '🕶️'], ['Tiny Tim Tech', '💻'],
  ['Madame Moonbeam', '🔮'], ['Ranger Rick', '🌲'], ['Pixel Penny', '👾'], ['Barista Bo', '☕'], ['Aunt Edna', '🧶'],
] as const;
