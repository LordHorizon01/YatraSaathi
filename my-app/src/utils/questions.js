// ─── Digital Johns Test – Question Pool ──────────────────────────────────────
// Questions are casual, culturally relevant, and designed to require
// a coherent (non-robotic) answer. A fatigued driver will slur or go silent.

export const QUESTIONS = {
  hi: [
    'Bhai, aage mausam kaisa hai? Barish ho rahi hai kya?',
    'Aaj subah kya khaya tha? Kuch achha mila raste mein?',
    'Kitne baje pahunchoge apni manzil par?',
    'Gaadi theek chal rahi hai? Koi aawaz toh nahi aa rahi?',
    'Ghar se nikle kitne ghante ho gaye?',
    'Aage koi dhaba dikha? Chai peena chahoge?',
  ],
  en: [
    'Hey, how\'s the weather looking ahead? Any rain?',
    'What did you eat this morning? Did you find a good stop?',
    'What time do you expect to reach your destination?',
    'Is the truck running fine? Any unusual sounds?',
    'How many hours have you been on the road?',
    'See any dhabas coming up? Fancy a chai break?',
  ],
  ta: [
    'Annaa, munnaadi vaanam epdi irukku?',
    'Innikki kaalai enna saapteenga?',
    'Engge poga irukkeengga? Eppo serveengga?',
  ],
  te: [
    'Anna, mundu weather ela undi? Varsham vastundaa?',
    'Ee rojju prati nallu em tinnaaru?',
    'Mariyu ela unnaru? Gaadi bagundi kaadaa?',
  ],
  bn: [
    'Bhai, samne mausam kemon? Brishthi hochhe?',
    'Aaj shokal e ki kheyechho?',
    'Kotottime destination e pouuchhhabe?',
  ],
  mr: [
    'Bhai, pudhe havaaman kasa ahe? Paaus aahe ka?',
    'Aaj sakaali kaay khallas?',
    'Gaadi theek chal aahe na? Kahi aawaj yet aahe ka?',
  ],
  kn: [
    'Anna, munde havishu hege ide? Male bardde?',
    'Innu beligge yenu tindri?',
    'Vehicle sari idiya? Yenu sound barthida?',
  ],
};

/** Pick a random question for a given language, falling back to Hindi. */
export function pickQuestion(lang = 'hi') {
  const pool = QUESTIONS[lang] ?? QUESTIONS.hi;
  return pool[Math.floor(Math.random() * pool.length)];
}
