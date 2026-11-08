/**
 * Template-based synthetic email generator. Output is annotated source in the
 * corpus format. Used by the property tests (through fast-check) and by
 * scripts/gen-corpus.ts (through a seeded Rng). Every name, number and domain
 * is invented, and private parties only get `.example` domains.
 */
import { ann } from './annotate.js';
import {
  chance, makeEmail, makeId, makeIban, makeMinor, makeOrg, makePerson, makePhone, makePlace, makeYmd, pick, range,
  renderAmount, renderDateText, type DateDraw, type DateStyle, type Lang, type Org, type Person, type Src,
} from './values.js';

export type Category = 'booking' | 'invoice' | 'tax' | 'forward' | 'newsletter' | 'security' | 'thread';
export const CATEGORIES: Category[] = ['booking', 'invoice', 'tax', 'forward', 'newsletter', 'security', 'thread'];
export type LangMode = 'en' | 'es' | 'mixed';

const PUBLIC_MAIL = ['gmail.com', 'outlook.com', 'icloud.com'];
const WEEKDAY_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type Phrase = () => string;

export class Doc {
  readonly taken = new Set<string>();
  readonly owners: Array<{ kind: string; value: string }> = [];
  readonly base: Lang;
  readonly mixed: boolean;
  /** Numeric dates in one document all read the same way. */
  readonly numOrder: 'dmy' | 'mdy';

  constructor(
    readonly s: Src,
    mode: LangMode,
  ) {
    this.mixed = mode === 'mixed';
    this.base = mode === 'mixed' ? pick(s, ['en', 'es'] as const) : mode;
    this.numOrder = this.base === 'en' && chance(s, 50) ? 'mdy' : 'dmy';
  }

  /** Language of the next sentence. Mixed documents switch now and then. */
  lang(): Lang {
    if (!this.mixed || !chance(this.s, 30)) return this.base;
    return this.base === 'en' ? 'es' : 'en';
  }

  say(en: Phrase[], es: Phrase[]): string {
    return pick(this.s, this.lang() === 'en' ? en : es)();
  }

  owner(kind: string, value: string): void {
    if (!this.owners.some((o) => o.kind === kind && o.value === value)) this.owners.push({ kind, value });
  }

  person(): Person {
    return makePerson(this.s, this.base, this.taken);
  }

  org(): Org {
    return makeOrg(this.s, this.base, this.taken);
  }

  place(): string {
    return makePlace(this.s, this.base);
  }

  money(minor: number): string {
    return ann('amount', renderAmount(minor, this.s, this.base === 'es' ? 'eu' : 'us'));
  }

  date(dt: DateDraw, withYear = true, forceStyle?: DateStyle): string {
    const es = this.base === 'es';
    const style: DateStyle =
      forceStyle ??
      (es ? pick(this.s, ['es', 'es', 'es', 'num', 'iso'] as DateStyle[]) : pick(this.s, ['enMdy', 'enMdy', 'enDmy', 'iso', 'num'] as DateStyle[]));
    return ann('date', renderDateText(this.s, dt, style, this.numOrder, withYear));
  }

  /** A date a few days after `dt`, still inside the same month for simplicity. */
  later(dt: DateDraw, days: number): DateDraw {
    const t = new Date(Date.UTC(dt.y, dt.m - 1, dt.d + days));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }

  weekday(dt: DateDraw): string {
    return WEEKDAY_EN[(new Date(Date.UTC(dt.y, dt.m - 1, dt.d)).getUTCDay() + 6) % 7] as string;
  }

  time(): string {
    return `${String(range(this.s, 8, 19)).padStart(2, '0')}:${pick(this.s, ['00', '15', '30', '45'])}`;
  }

  /** `Name <address>` with the display name annotated. */
  mailbox(p: Person, email: string, bare = false): string {
    if (bare) return ann('email', email);
    const q = chance(this.s, 15);
    return q ? `"${ann('person', p.full)}" <${ann('email', email)}>` : `${ann('person', p.full)} <${ann('email', email)}>`;
  }

  header(from: string, to: string, subject: string, dt: DateDraw): string {
    const stamp = `${this.weekday(dt)}, ${ann('date', `${dt.d} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.m - 1]} ${dt.y}`)} ${this.time()}:00 +0100`;
    return [`From: ${from}`, `To: ${to}`, `Date: ${stamp}`, `Subject: ${subject}`].join('\n');
  }

  render(body: string): string {
    const head = [...(this.numOrder === 'mdy' ? ['%order mdy'] : []), ...this.owners.map((o) => `%known ${o.kind}|${o.value}`)].join('\n');
    return head ? `${head}\n${body}\n` : `${body}\n`;
  }
}

// -------------------------------------------------------------- shared bits

interface Party {
  p: Person;
  org: Org;
  host: string;
  email: string;
  phone: string;
}

function party(d: Doc, personalMail = false): Party {
  const p = d.person();
  const org = d.org();
  const host = personalMail ? pick(d.s, PUBLIC_MAIL) : `${org.slug}.example`;
  return { p, org, host, email: makeEmail(d.s, p, host), phone: makePhone(d.s) };
}

function signature(d: Doc, who: Party, role: string[]): string {
  const web = `www.${who.org.slug}.example`;
  const lines = [
    d.say([() => 'Best regards,', () => 'Kind regards,', () => 'Thanks,', () => 'Cheers,'], [() => 'Un saludo,', () => 'Saludos cordiales,', () => 'Gracias,', () => 'Atentamente,']),
    ann('person', who.p.full),
    pick(d.s, role),
    ann('org', who.org.name),
  ];
  if (chance(d.s, 75)) lines.push(`Tel: ${ann('phone', who.phone)}`);
  if (chance(d.s, 70)) lines.push(ann('email', who.email));
  if (chance(d.s, 50)) lines.push(ann('url', web));
  if (chance(d.s, 30)) lines.push(d.say([() => `Office: ${ann('place', d.place())}`], [() => `Oficina de ${ann('place', d.place())}`]));
  return ['--', ...lines].join('\n');
}

function greet(d: Doc, who: Party | null, owner: Party): string {
  void who;
  const first = ann('person', owner.p.first);
  d.owner('person', owner.p.full);
  return d.say([() => `Hi ${first},`, () => `Hello ${first},`, () => `Dear ${first},`], [() => `Hola ${first},`, () => `Buenos días ${first},`, () => `Estimado/a ${first},`]);
}

function disclaimer(d: Doc): string {
  return d.say(
    [() => 'This message is confidential and intended only for the addressee.'],
    [() => 'Este mensaje es confidencial y está dirigido únicamente a su destinatario.'],
  );
}

// ----------------------------------------------------------------- bookings

function booking(d: Doc): string {
  const me = party(d, chance(d.s, 60));
  const biz = party(d);
  const dt = makeYmd(d.s);
  const place = d.place();
  const price = makeMinor(d.s, 30000);
  const ref = makeId(d.s).value;
  d.owner('person', me.p.full);
  const kind = d.s.int(4);
  const what = [
    { en: 'haircut and colour', es: 'corte y color' },
    { en: 'dental check-up', es: 'revisión dental' },
    { en: 'table for four', es: 'mesa para cuatro' },
    { en: 'physio session', es: 'sesión de fisioterapia' },
  ][kind] as { en: string; es: string };
  const platform = chance(d.s, 40);
  const from = platform ? 'Booksy <no..reply@booksy.com>' : d.mailbox(biz.p, biz.email);
  const parts: string[] = [d.header(from, d.mailbox(me.p, me.email), d.say([() => 'Your booking is confirmed', () => `Booking ${ann('id', ref)} confirmed`], [() => 'Reserva confirmada', () => `Confirmación de cita ${ann('id', ref)}`]), dt)];
  parts.push(greet(d, biz, me));
  parts.push(
    d.say(
      [
        () => `Your ${what.en} at ${ann('org', biz.org.name)} is booked for ${d.date(d.later(dt, range(d.s, 2, 20)))} at ${d.time()}.`,
        () => `We have reserved a ${what.en} for you on ${d.date(d.later(dt, range(d.s, 2, 20)))}. The address is ${ann('org', biz.org.name)}, ${ann('place', place)}.`,
      ],
      [
        () => `Tu ${what.es} en ${ann('org', biz.org.name)} queda reservada para el ${d.date(d.later(dt, range(d.s, 2, 20)))} a las ${d.time()}.`,
        () => `Hemos reservado ${what.es} para ti el ${d.date(d.later(dt, range(d.s, 2, 20)))}. Estamos en ${ann('place', place)}.`,
      ],
    ),
  );
  parts.push(
    d.say(
      [() => `The price is ${d.money(price)}, payable on arrival. A deposit of ${d.money(Math.round(price / 4))} is held on your card.`, () => `Total: ${d.money(price)}. Free cancellation until ${d.date(d.later(dt, 1), false)}.`],
      [() => `El importe es ${d.money(price)}, a pagar en el local. Hemos retenido una señal de ${d.money(Math.round(price / 4))}.`, () => `Total: ${d.money(price)}. Cancelación gratuita hasta el ${d.date(d.later(dt, 1), false)}.`],
    ),
  );
  if (chance(d.s, 70)) {
    parts.push(
      d.say(
        [() => `Questions? Call us on ${ann('phone', biz.phone)} or write to ${ann('email', biz.email)}.`],
        [() => `¿Dudas? Llámanos al ${ann('phone', biz.phone)} o escribe a ${ann('email', biz.email)}.`],
      ),
    );
  }
  if (platform) {
    parts.push(`Manage your visit: ${ann('url', `https://booksy.com/en-es/${range(d.s, 100000, 999999)}_${biz.org.slug}_${range(d.s, 1000, 9999)}`)}`);
  }
  if (chance(d.s, 40)) parts.push(signature(d, biz, ['Reception', 'Recepción', 'Front desk']));
  return d.render(parts.join('\n\n'));
}

// ----------------------------------------------------------------- invoices

function invoice(d: Doc): string {
  const me = party(d, chance(d.s, 30));
  const seller = party(d);
  const dt = makeYmd(d.s);
  const es = d.base === 'es';
  const rate = es ? pick(d.s, [21, 10, 21, 4]) : pick(d.s, [20, 8, 5, 20]);
  const net = makeMinor(d.s, 400000);
  const vat = Math.round((net * rate) / 100);
  const total = net + vat;
  const inv = makeId(d.s);
  const iban = makeIban(d.s);
  const due = d.later(dt, pick(d.s, [15, 30, 30, 45]));
  d.owner('person', me.p.full);
  d.owner('org', me.org.name);
  const pct = es ? `${rate} %` : `${rate}%`;
  const parts: string[] = [
    d.header(d.mailbox(seller.p, seller.email), d.mailbox(me.p, me.email), d.say([() => `Invoice ${ann('id', inv.value)}`, () => `Invoice ${ann('id', inv.value)} from ${ann('org', seller.org.name)}`], [() => `Factura ${ann('id', inv.value)}`, () => `Factura ${ann('id', inv.value)} de ${ann('org', seller.org.name)}`]), dt),
    greet(d, seller, me),
    d.say(
      [() => `Please find attached invoice ${ann('id', inv.value)} for the work done for ${ann('org', me.org.name)}.`, () => `Attached is our invoice for last month's services to ${ann('org', me.org.name)}.`],
      [() => `Adjuntamos la factura ${ann('id', inv.value)} por los servicios prestados a ${ann('org', me.org.name)}.`, () => `Te enviamos la factura del último periodo de ${ann('org', me.org.name)}.`],
    ),
  ];
  const lines = d.s.int(3);
  if (lines === 0) {
    parts.push(
      d.say(
        [() => `Net amount: ${d.money(net)}\nVAT ${pct}: ${d.money(vat)}\nTotal due: ${d.money(total)}`, () => `Base ${d.money(net)} plus ${pct} tax = ${d.money(total)}`],
        [() => `Base imponible: ${d.money(net)}\nIVA ${pct}: ${d.money(vat)}\nTotal a pagar: ${d.money(total)}`, () => `La cuota es ${d.money(net)} más ${pct} de IVA, en total ${d.money(total)}.`],
      ),
    );
  } else if (lines === 1) {
    const a = Math.round(net * 0.6);
    const b = net - a;
    parts.push(
      d.say(
        [() => `Consulting, first half: ${d.money(a)}\nConsulting, second half: ${d.money(b)}\nSubtotal: ${d.money(net)}\nTax (${pct}): ${d.money(vat)}\nTotal: ${d.money(total)}`],
        [() => `Servicios, primera parte: ${d.money(a)}\nServicios, segunda parte: ${d.money(b)}\nSubtotal: ${d.money(net)}\nIVA (${pct}): ${d.money(vat)}\nTotal: ${d.money(total)}`],
      ),
    );
  } else {
    parts.push(
      d.say(
        [() => `The total is ${d.money(total)}, which includes ${pct} tax on ${d.money(net)}.`],
        [() => `El total es ${d.money(total)}, con ${pct} de IVA sobre ${d.money(net)}.`],
      ),
    );
  }
  parts.push(
    d.say(
      [() => `Payment is due by ${d.date(due)}. Transfer to ${ann('iban', iban)}, quoting ${ann('id', inv.value)}.`, () => `Please pay before ${d.date(due)} to IBAN ${ann('iban', iban)}.`],
      [() => `El pago vence el ${d.date(due)}. Transferencia a ${ann('iban', iban)} indicando ${ann('id', inv.value)}.`, () => `Agradecemos el pago antes del ${d.date(due)} en la cuenta ${ann('iban', iban)}.`],
    ),
  );
  if (chance(d.s, 50)) parts.push(d.say([() => `Our tax number is ${ann('id', seller.org.slug.toUpperCase().slice(0, 1) + String(range(d.s, 10000000, 99999999)))}.`], [() => `Nuestro NIF es ${ann('id', 'B' + String(range(d.s, 10000000, 99999999)))}.`]));
  parts.push(signature(d, seller, ['Accounts', 'Administración', 'Billing department']));
  if (chance(d.s, 25)) parts.push(disclaimer(d));
  return d.render(parts.join('\n\n'));
}

// -------------------------------------------------------------------- tax

function tax(d: Doc): string {
  const me = party(d, true);
  const clerk = party(d);
  const dt = makeYmd(d.s);
  const place = d.place();
  const due = d.later(dt, pick(d.s, [10, 20, 30]));
  const owed = makeMinor(d.s, 900000);
  const pctRate = pick(d.s, [5, 10, 20]);
  const surcharge = Math.round((owed * pctRate) / 100);
  const nif = chance(d.s, 50) ? `${range(d.s, 10000000, 99999999)}${pick(d.s, ['K', 'M', 'T', 'W', 'Z'])}` : `${pick(d.s, ['X', 'Y'])}${range(d.s, 1000000, 9999999)}${pick(d.s, ['B', 'J', 'R'])}`;
  const file = `EXP-${dt.y}-${String(range(d.s, 0, 9999)).padStart(4, '0')}`;
  const iban = makeIban(d.s);
  d.owner('person', me.p.full);
  const es = d.base === 'es';
  const office = es ? `Oficina Tributaria de ${ann('place', place)}` : `Regional Revenue Office of ${ann('place', place)}`;
  const parts: string[] = [
    d.header(d.mailbox(clerk.p, `notificaciones.${makeEmail(d.s, clerk.p, `${clerk.org.slug}.example`)}`), d.mailbox(me.p, me.email), d.say([() => `Notice ${ann('id', file)}: payment pending`, () => 'Notification of outstanding balance'], [() => `Notificación ${ann('id', file)}: pago pendiente`, () => 'Aviso de deuda pendiente']), dt),
    d.say(
      [() => `Dear ${ann('person', me.p.full)},`, () => `To ${ann('person', me.p.full)}, holder of ID ${ann('id', nif)}:`],
      [() => `Estimado/a ${ann('person', me.p.full)},`, () => `A ${ann('person', me.p.full)}, titular del documento ${ann('id', nif)}:`],
    ),
    d.say(
      [
        () => `${office} informs you that file ${ann('id', file)} shows a balance of ${d.money(owed)} for the period ending ${d.date(d.later(dt, -40))}.`,
        () => `Our records show an unpaid balance of ${d.money(owed)} on file ${ann('id', file)}.`,
      ],
      [
        () => `La ${office} le comunica que el expediente ${ann('id', file)} presenta un saldo de ${d.money(owed)} correspondiente al periodo cerrado el ${d.date(d.later(dt, -40))}.`,
        () => `Según nuestros registros, consta una deuda de ${d.money(owed)} en el expediente ${ann('id', file)}.`,
      ],
    ),
    d.say(
      [() => `If it is not paid by ${d.date(due)}, a surcharge of ${pctRate}% applies: ${d.money(surcharge)}, for a total of ${d.money(owed + surcharge)}.`],
      [() => `Si no se abona antes del ${d.date(due)}, se aplicará un recargo del ${pctRate} %: ${d.money(surcharge)}, en total ${d.money(owed + surcharge)}.`],
    ),
    d.say(
      [() => `Pay by transfer to ${ann('iban', iban)} and keep the receipt. For help call ${ann('phone', clerk.phone)}.`],
      [() => `Puede pagar por transferencia a ${ann('iban', iban)} y conservar el justificante. Atención telefónica: ${ann('phone', clerk.phone)}.`],
    ),
  ];
  if (chance(d.s, 40)) {
    parts.push(
      d.say(
        [() => `Social security contributions for ${d.date({ ...dt, d: 1 }, false)} are listed in the portal: ${ann('url', `https://sede.${clerk.org.slug}.example/cuotas/${range(d.s, 10000, 99999)}A${range(d.s, 100, 999)}`)}`],
        [() => `Las cuotas de la Seguridad Social del periodo ${d.date({ ...dt, d: 1 }, false)} están en la sede: ${ann('url', `https://sede.${clerk.org.slug}.example/cuotas/${range(d.s, 10000, 99999)}A${range(d.s, 100, 999)}`)}`],
      ),
    );
  }
  parts.push(d.say([() => 'This is an automatic notice. Do not reply.'], [() => 'Este es un aviso automático. No responda a este correo.']));
  return d.render(parts.join('\n\n'));
}

// ---------------------------------------------------------------- forwards

function forward(d: Doc): string {
  const me = party(d, chance(d.s, 50));
  const client = party(d);
  const colleague = party(d);
  const dt = makeYmd(d.s);
  const amount = makeMinor(d.s, 500000);
  const meet = d.later(dt, range(d.s, 3, 14));
  const proj = makeId(d.s).value;
  d.owner('person', me.p.full);
  const parts: string[] = [
    d.header(d.mailbox(me.p, me.email), d.mailbox(colleague.p, colleague.email), d.say([() => `Fwd: question from ${ann('org', client.org.name)}`, () => `Fwd: ${ann('org', client.org.name)} quote`], [() => `Fwd: consulta de ${ann('org', client.org.name)}`, () => `Fwd: presupuesto ${ann('org', client.org.name)}`]), dt),
    d.say(
      [() => `Hi ${ann('person', colleague.p.first)}, can you take this one? The client wants an answer by ${d.date(meet)}.`, () => `${ann('person', colleague.p.first)}, forwarding below. Please check the numbers and call them on ${ann('phone', client.phone)}.`],
      [() => `Hola ${ann('person', colleague.p.first)}, ¿puedes encargarte de este? El cliente quiere respuesta antes del ${d.date(meet)}.`, () => `${ann('person', colleague.p.first)}, te reenvío el correo. Revisa las cifras y llámales al ${ann('phone', client.phone)}.`],
    ),
    '---------- Forwarded message ---------',
    `From: ${d.mailbox(client.p, client.email)}`,
    `Date: ${ann('date', `${dt.d} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.m - 1]} ${dt.y}`)}`,
    `Subject: ${d.say([() => `Quote for project ${ann('id', proj)}`], [() => `Presupuesto proyecto ${ann('id', proj)}`])}`,
    '',
    greet(d, client, me),
    d.say(
      [() => `We at ${ann('org', client.org.name)} have a budget of ${d.money(amount)} for the work in ${ann('place', d.place())}. Could you confirm the start date?`, () => `The board approved ${d.money(amount)} for project ${ann('id', proj)}. When can you begin?`],
      [() => `En ${ann('org', client.org.name)} disponemos de ${d.money(amount)} para la obra en ${ann('place', d.place())}. ¿Puedes confirmarnos la fecha de inicio?`, () => `El consejo aprobó ${d.money(amount)} para el proyecto ${ann('id', proj)}. ¿Cuándo podríais empezar?`],
    ),
    signature(d, client, ['Operations manager', 'Directora de operaciones', 'Purchasing']),
  ];
  return d.render(parts.join('\n'));
}

// -------------------------------------------------------------- newsletters

function newsletter(d: Doc): string {
  const me = party(d, true);
  const shop = party(d);
  const dt = makeYmd(d.s);
  const price = makeMinor(d.s, 20000);
  const was = price + Math.round(price / 4);
  const event = d.later(dt, range(d.s, 5, 30));
  d.owner('person', me.p.full);
  const list = `${ann('email', `news@${shop.org.slug}.example`)}`;
  const unsub = ann('url', `https://news.${shop.org.slug}.example/unsubscribe?u=${range(d.s, 100000000, 999999999)}x&e=${me.email.replace('@', '%40')}`);
  const parts: string[] = [
    d.header(`${shop.org.name.replace(/[.]/g, '')} <${list}>`.replace(shop.org.name.replace(/[.]/g, ''), ann('org', shop.org.name.replace(/[.]/g, '')) ), d.mailbox(me.p, me.email, chance(d.s, 50)), d.say([() => `${shop.p.first}'s picks for the season`, () => 'Spring offers inside'], [() => 'Novedades de temporada', () => 'Ofertas de primavera']), dt),
    d.say([() => `Hi ${ann('person', me.p.first)}, here is what is new this month.`], [() => `Hola ${ann('person', me.p.first)}, estas son las novedades del mes.`]),
    d.say(
      [() => `Our best seller is now ${d.money(price)}, down from ${d.money(was)}. Offer ends ${d.date(event)}.`, () => `Join our open day in ${ann('place', d.place())} on ${d.date(event)}. Entry ${d.money(price)}.`],
      [() => `Nuestro producto estrella baja a ${d.money(price)}, antes ${d.money(was)}. La oferta termina el ${d.date(event)}.`, () => `Te esperamos en la jornada de puertas abiertas en ${ann('place', d.place())} el ${d.date(event)}. Entrada ${d.money(price)}.`],
    ),
    d.say([() => `Shop online: ${ann('url', `https://www.${shop.org.slug}.example/shop?utm_campaign=${range(d.s, 1000, 9999)}`)}`], [() => `Compra online: ${ann('url', `https://www.${shop.org.slug}.example/tienda?utm_campaign=${range(d.s, 1000, 9999)}`)}`]),
    d.say([() => `You receive this because ${ann('email', me.email)} subscribed. Unsubscribe: ${unsub}`], [() => `Recibes este correo porque ${ann('email', me.email)} se suscribió. Darte de baja: ${unsub}`]),
    `${ann('org', shop.org.name)}, ${d.say([() => 'Customer care'], [() => 'Atención al cliente'])} ${ann('phone', shop.phone)}`,
  ];
  return d.render(parts.join('\n\n'));
}

// ---------------------------------------------------------------- security

function security(d: Doc): string {
  const me = party(d, true);
  const svc = party(d);
  const dt = makeYmd(d.s);
  const code = String(range(d.s, 100000, 999999));
  const place = d.place();
  d.owner('person', me.p.full);
  const alertMail = `security@${svc.org.slug}.example`;
  const parts: string[] = [
    d.header(`${ann('org', svc.org.name)} <${ann('email', alertMail)}>`, d.mailbox(me.p, me.email, chance(d.s, 40)), d.say([() => 'New sign-in to your account', () => 'Your verification code', () => 'Password change requested'], [() => 'Nuevo inicio de sesión en tu cuenta', () => 'Tu código de verificación', () => 'Solicitud de cambio de contraseña']), dt),
    d.say([() => `Hi ${ann('person', me.p.first)},`], [() => `Hola ${ann('person', me.p.first)},`]),
    d.say(
      [
        () => `We noticed a sign-in to ${ann('email', me.email)} from ${ann('place', place)} on ${d.date(dt)} at ${d.time()}.`,
        () => `Your verification code is ${ann('id', code)}. It expires in 10 minutes. Never share it.`,
        () => `Someone asked to change the password for ${ann('email', me.email)} on ${d.date(dt)}. Use this link within one hour: ${ann('url', `https://accounts.${svc.org.slug}.example/reset?token=${range(d.s, 100000, 999999)}ab${range(d.s, 100000, 999999)}`)}`,
      ],
      [
        () => `Detectamos un inicio de sesión en ${ann('email', me.email)} desde ${ann('place', place)} el ${d.date(dt)} a las ${d.time()}.`,
        () => `Tu código de verificación es ${ann('id', code)}. Caduca en 10 minutos. No lo compartas.`,
        () => `Alguien solicitó cambiar la contraseña de ${ann('email', me.email)} el ${d.date(dt)}. Usa este enlace en la próxima hora: ${ann('url', `https://accounts.${svc.org.slug}.example/reset?token=${range(d.s, 100000, 999999)}ab${range(d.s, 100000, 999999)}`)}`,
      ],
    ),
    d.say(
      [() => `If this was not you, call ${ann('phone', svc.phone)} or write to ${ann('email', alertMail)}.`],
      [() => `Si no fuiste tú, llama al ${ann('phone', svc.phone)} o escribe a ${ann('email', alertMail)}.`],
    ),
    d.say([() => `The ${ann('org', svc.org.name)} security team`], [() => `El equipo de seguridad de ${ann('org', svc.org.name)}`]),
  ];
  return d.render(parts.join('\n\n'));
}

// ------------------------------------------------------------------ threads

function thread(d: Doc): string {
  const a = party(d, chance(d.s, 30));
  const b = party(d);
  const dt = makeYmd(d.s);
  const first = makeMinor(d.s, 300000);
  const second = Math.round(first * 0.85);
  const meet = d.later(dt, range(d.s, 2, 12));
  d.owner('person', a.p.full);
  d.owner('org', a.org.name);
  const quote = (s: string): string => s.split('\n').map((l) => `> ${l}`).join('\n');
  const original = [
    d.say(
      [() => `Hello ${ann('person', a.p.first)}, our offer for ${ann('org', a.org.name)} is ${d.money(first)}. Can we meet on ${d.date(meet)} at ${d.time()}?`],
      [() => `Hola ${ann('person', a.p.first)}, nuestra oferta para ${ann('org', a.org.name)} es de ${d.money(first)}. ¿Quedamos el ${d.date(meet)} a las ${d.time()}?`],
    ),
    signature(d, b, ['Sales', 'Comercial']),
  ].join('\n\n');
  const reply1 = [
    d.say(
      [() => `Thanks ${ann('person', b.p.first)}. That is high for us. Could you do ${d.money(second)}? The meeting works, call me on ${ann('phone', a.phone)} if it moves.`],
      [() => `Gracias ${ann('person', b.p.first)}. Nos resulta alto. ¿Podríais dejarlo en ${d.money(second)}? La reunión nos va bien, llámame al ${ann('phone', a.phone)} si cambia.`],
    ),
  ].join('\n\n');
  const wrote = d.say(
    [() => `On ${d.date(dt)}, ${ann('person', b.p.full)} wrote:`],
    [() => `El ${d.date(dt)}, ${ann('person', b.p.full)} escribió:`],
  );
  const reply2 = d.say(
    [() => `We can accept ${d.money(Math.round((first + second) / 2))} and send the contract to ${ann('email', a.email)}.`],
    [() => `Podemos aceptar ${d.money(Math.round((first + second) / 2))} y enviar el contrato a ${ann('email', a.email)}.`],
  );
  const parts = [
    d.header(d.mailbox(b.p, b.email), d.mailbox(a.p, a.email), d.say([() => `Re: offer for ${ann('org', a.org.name)}`], [() => `Re: oferta para ${ann('org', a.org.name)}`]), d.later(dt, 2)),
    reply2,
    `On ${d.date(d.later(dt, 1))}, ${ann('person', a.p.full)} wrote:`,
    quote(reply1),
    '>',
    `> ${wrote}`,
    quote(quote(original)),
    '',
    ann('person', b.p.first),
  ];
  return d.render(parts.join('\n'));
}

const BUILDERS: Record<Category, (d: Doc) => string> = { booking, invoice, tax, forward, newsletter, security, thread };

/** One annotated email. */
export function genEmail(s: Src, category: Category, mode: LangMode): string {
  return BUILDERS[category](new Doc(s, mode));
}
