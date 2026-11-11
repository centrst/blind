/** The two languages blind writes fakes in. */
export type Lang = 'en' | 'es';

/**
 * One language's fakes. Long enough that a thread with 50 people and 30
 * companies never runs out; past that, two entries are joined with a hyphen.
 */
export interface FakeLists {
  female: readonly string[];
  male: readonly string[];
  last: readonly string[];
  /** Invented company names. */
  orgBases: readonly string[];
  /** Words that follow (English) or lead (Spanish) a company name. */
  orgNouns: readonly string[];
  places: readonly string[];
  /** The words of a fake host: what the business is, and a name. */
  domainNouns: readonly string[];
  domainNames: readonly string[];
}

export const FAKES: Record<Lang, FakeLists> = {
  en: {
    female: [
      'Claire', 'Emma', 'Hannah', 'Olivia', 'Megan', 'Naomi', 'Helen', 'Amelia', 'Tessa', 'Fiona',
      'Gemma', 'Rebecca', 'Natalie', 'Brenda', 'Harriet', 'Lucy', 'Abigail', 'Charlotte', 'Eleanor', 'Grace',
      'Holly', 'Joanna', 'Katie', 'Lydia', 'Maisie', 'Penny', 'Rosie', 'Sophie', 'Wendy', 'Bethany',
      'Alison', 'Bridget', 'Caroline', 'Danielle', 'Edith', 'Frances', 'Gillian', 'Jocelyn', 'Jessica', 'Joanne',
      'Kirsty', 'Leanne', 'Lorraine', 'Melanie', 'Nicola', 'Pauline', 'Rachel', 'Shannon', 'Stacey', 'Tracey',
      'Vanessa', 'Yvonne', 'Zoe', 'Annabel', 'Chloe', 'Erin', 'Felicity', 'Josephine', 'Isla', 'Jemima',
      'Kathryn', 'Lauren', 'Maureen', 'Paige', 'Rhiannon', 'Sabrina', 'Tabitha', 'Verity', 'Agnes', 'Beverley',
      'Cheryl', 'Deborah', 'Elaine', 'Gail', 'Hilary', 'Janet', 'Kerry', 'Leah', 'Marion', 'Philippa',
    ],
    male: [
      'Oliver', 'Ethan', 'Nathan', 'Owen', 'Caleb', 'Graham', 'Dennis', 'Felix', 'Simon', 'Colin',
      'Trevor', 'Isaac', 'Harvey', 'Rupert', 'Toby', 'Lewis', 'Miles', 'Stuart', 'Duncan', 'Gavin',
      'Howard', 'Keith', 'Leonard', 'Malcolm', 'Neil', 'Peter', 'Russell', 'Spencer', 'Warren', 'Gordon',
      'Alastair', 'Bernard', 'Clive', 'Douglas', 'Edmund', 'Geoffrey', 'Gregory', 'Hamish', 'Ian', 'Jeremy',
      'Kenneth', 'Lawrence', 'Martyn', 'Norman', 'Philip', 'Raymond', 'Roland', 'Stanley', 'Terence', 'Vernon',
      'Wallace', 'Alfred', 'Bradley', 'Callum', 'Darren', 'Elliot', 'Fraser', 'Gilbert', 'Henry', 'Jonathan',
      'Kieran', 'Lachlan', 'Matthew', 'Nicholas', 'Patrick', 'Reginald', 'Stephen', 'Timothy', 'Wesley', 'Adam',
      'Barry', 'Craig', 'Derek', 'Edgar', 'Gerald', 'Jeffrey', 'Kevin', 'Liam', 'Rodney', 'Steven',
    ],
    last: [
      'Hayes', 'Brooks', 'Whitaker', 'Sutton', 'Holloway', 'Prescott', 'Langley', 'Fenwick', 'Ashby', 'Calloway',
      'Dalton', 'Everett', 'Garrison', 'Hartley', 'Kendrick', 'Lockwood', 'Merrick', 'Norwood', 'Pemberton', 'Radcliffe',
      'Sheridan', 'Thornton', 'Underwood', 'Wexford', 'Bradshaw', 'Coleman', 'Fletcher', 'Granger', 'Hollis', 'Marsh',
      'Aldridge', 'Ainsworth', 'Atherton', 'Barlow', 'Bentley', 'Blakemore', 'Brierley', 'Burton', 'Caldwell', 'Chadwick',
      'Chilton', 'Cranfield', 'Dunstan', 'Eastwood', 'Elwood', 'Farrow', 'Fairbanks', 'Fothergill', 'Gillespie', 'Hadley',
      'Halford', 'Hargreaves', 'Hawthorne', 'Hepworth', 'Hollings', 'Huxley', 'Ingleby', 'Jarvis', 'Kearney', 'Kenworthy',
      'Kirkland', 'Lowther', 'Lyndon', 'Maddox', 'Marlowe', 'Mayhew', 'Meacham', 'Millard', 'Moorhouse', 'Netherton',
      'Oldfield', 'Ormsby', 'Paxton', 'Pickering', 'Platt', 'Pollard', 'Quayle', 'Ramsden', 'Rawlings', 'Redmond',
      'Ridley', 'Rowley', 'Sanderson', 'Sedgwick', 'Shelby', 'Shipley', 'Sinclair', 'Slater', 'Stanton', 'Stockdale',
      'Strickland', 'Sumner', 'Tasker', 'Thackeray', 'Tolliver', 'Tremayne', 'Tyndall', 'Uttley', 'Vickers', 'Wainwright',
      'Walcott', 'Wardell', 'Waverley', 'Weatherby', 'Wheeler', 'Whitlock', 'Wilmot', 'Winslow', 'Woodall', 'Wycliffe',
      'Yelland', 'Aspinall', 'Battersby', 'Beckwith', 'Bramley', 'Carver', 'Coulson', 'Darby', 'Egerton', 'Fairclough',
      'Garside', 'Hebden',
    ],
    orgBases: [
      'Brindle', 'Dunmore', 'Fernhill', 'Havenor', 'Kestrel', 'Larkmoor', 'Quillon', 'Tarrant', 'Westerly', 'Yarrow',
      'Corvane', 'Norvale', 'Ashcombe', 'Bramwell', 'Copperfield', 'Thistle', 'Oakridge', 'Redfern',
      'Alderwick', 'Barrowmere', 'Bellhaven', 'Birchley', 'Bramblewood', 'Caddington', 'Calderwyn', 'Dunholt', 'Elmstead', 'Embervale',
      'Farrowdale', 'Fennimore', 'Glenmarsh', 'Greywell', 'Halberton', 'Hazelmere', 'Inglewick', 'Kelderby', 'Linhurst', 'Marlowfield',
      'Mossbury', 'Netherwick', 'Pennridge', 'Quarrendon', 'Rookwell', 'Sandmere', 'Tamberley', 'Thornwick', 'Vellmoor', 'Wyncroft',
      'Yewbridge', 'Amberlow',
    ],
    orgNouns: ['Consulting', 'Partners', 'Group', 'Studio', 'Labs', 'Solutions', 'Associates', 'Works', 'Services', 'Supply', 'Advisory', 'Holdings'],
    places: [
      'Brookfield', 'Oakhaven', 'Lindenwood', 'Fairmont', 'Riverton', 'Westbrook', 'Millbrook', 'Eastgate',
      'Ashbourne', 'Thornbury', 'Kingsmead', 'Hollins Cross',
      'Alderford', 'Bramblecote', 'Birchmere', 'Copperton', 'Dunwick', 'Elmhurst', 'Glenbury', 'Harrowby', 'Hazelden', 'Kestlewood',
      'Lowerby', 'Marchbank', 'Oakwick', 'Redmarsh', 'Saltwick', 'Stowbridge', 'Thistleton', 'Underhill', 'Wyckham', 'Yarrowby',
      'Ashendale', 'Fernleigh', 'Greyhollow', 'Pellham',
    ],
    domainNouns: ['consulting', 'partners', 'studio', 'labs', 'works', 'design', 'advisory', 'supply', 'clinic', 'group', 'services', 'accounts'],
    domainNames: ['north', 'south', 'brindle', 'kestrel', 'norvale', 'fernhill', 'harbour', 'westerly', 'larkmoor', 'ashby', 'meadow', 'oakridge'],
  },
  es: {
    female: [
      'Clara', 'Lucía', 'Marta', 'Elena', 'Irene', 'Paula', 'Alicia', 'Noelia', 'Carla', 'Teresa',
      'Inés', 'Nuria', 'Beatriz', 'Sonia', 'Silvia', 'Raquel', 'Miriam', 'Esther', 'Lorena', 'Valeria',
      'Adriana', 'Cecilia', 'Daniela', 'Eva', 'Rocío', 'Pilar', 'Begoña', 'Yolanda', 'Rosario', 'Andrea',
      'Ainhoa', 'Almudena', 'Araceli', 'Celia', 'Elvira', 'Encarna', 'Fátima', 'Guadalupe', 'Inmaculada', 'Jimena',
      'Leire', 'Lidia', 'Lourdes', 'Maite', 'Manuela', 'Montserrat', 'Nerea', 'Olga', 'Rebeca', 'Susana',
      'Vanesa', 'Ximena', 'Amaia', 'Ariadna', 'Carolina', 'Elisa', 'Eugenia', 'Felisa', 'Gabriela', 'Graciela',
      'Josefa', 'Leticia', 'Luisa', 'Marisol', 'Mónica', 'Natalia', 'Rosalía', 'Úrsula', 'Zulema', 'Arantxa',
      'Idoia', 'Noemí', 'Yaiza', 'Delia', 'Emilia', 'Fabiola', 'Soraya',
    ],
    male: [
      'Álvaro', 'Diego', 'Marcos', 'Sergio', 'Adrián', 'Iván', 'Rubén', 'Tomás', 'Gonzalo', 'Ignacio',
      'Ramón', 'Emilio', 'Gerardo', 'Andrés', 'Rodrigo', 'Bruno', 'Cristian', 'Eduardo', 'Fabián', 'Héctor',
      'Leandro', 'Javier', 'Joaquín', 'Mateo', 'Raúl', 'Jaime', 'Alfonso', 'Ricardo', 'Esteban', 'Sebastián',
      'Agustín', 'Alberto', 'Alejandro', 'Amador', 'Aurelio', 'Benito', 'Bernardo', 'Borja', 'Camilo', 'Casimiro',
      'Cipriano', 'Cristóbal', 'Efrén', 'Eladio', 'Eugenio', 'Federico', 'Fernando', 'Fidel', 'Gaspar', 'Gregorio',
      'Gustavo', 'Horacio', 'Humberto', 'Iñigo', 'Jacinto', 'Leopoldo', 'Lorenzo', 'Marcelino', 'Mariano', 'Maximiliano',
      'Nazario', 'Octavio', 'Patricio', 'Rafael', 'Rogelio', 'Severino', 'Teodoro', 'Valentín', 'Vicente', 'Xabier',
      'Arturo', 'Ismael', 'Hilario', 'Justino', 'Remigio',
    ],
    last: [
      'Vidal', 'Soler', 'Ferrer', 'Pons', 'Mercader', 'Casals', 'Roig', 'Prats', 'Sala', 'Camps',
      'Marín', 'Ortega', 'Herrera', 'Cabrera', 'Lozano', 'Benítez', 'Ibáñez', 'Montero', 'Crespo', 'Salas',
      'Alcalá', 'Barrera', 'Cordero', 'Aguado', 'Bermejo', 'Carrasco', 'Quesada', 'Robles', 'Salinas', 'Valero',
      'Abad', 'Acosta', 'Aguirre', 'Alarcón', 'Almansa', 'Altamirano', 'Andrade', 'Aranda', 'Arévalo', 'Argüello',
      'Arias', 'Ayala', 'Baena', 'Ballesteros', 'Barreiro', 'Becerra', 'Beltrán', 'Bolaños', 'Camacho', 'Cantero',
      'Carmona', 'Carrillo', 'Castañeda', 'Cebrián', 'Cerezo', 'Chacón', 'Cisneros', 'Escobar', 'Escudero', 'Esteve',
      'Estévez', 'Falcón', 'Fajardo', 'Ferrándiz', 'Gálvez', 'Gallardo', 'Garrido', 'Giménez', 'Godoy', 'Granados',
      'Guijarro', 'Guzmán', 'Heredia', 'Huertas', 'Lafuente', 'Ledesma', 'Llorente', 'Luján', 'Machado', 'Madrigal',
      'Mancebo', 'Márquez', 'Mateu', 'Mejía', 'Miralles', 'Mojica', 'Montalvo', 'Murillo', 'Nadal', 'Noguera',
      'Olivares', 'Ordóñez', 'Orozco', 'Osorio', 'Pacheco', 'Pineda', 'Poveda', 'Quiroga', 'Rosales', 'Salazar',
      'Samper', 'Sanchís', 'Santamaría', 'Segarra', 'Solís', 'Sotomayor', 'Tamayo', 'Trujillo', 'Ugarte', 'Valdés',
      'Vallejo', 'Vázquez', 'Villanueva', 'Villegas', 'Zambrano', 'Zapata', 'Zúñiga', 'Bonet', 'Riera', 'Puig',
      'Serra', 'Bosch', 'Sabater', 'Ribas', 'Galván', 'Montes', 'Escrivá',
    ],
    orgBases: [
      'Lumera', 'Tessera', 'Altavia', 'Cobalto', 'Estival', 'Galdera', 'Jarale', 'Maravel', 'Nordela', 'Orvino',
      'Pelara', 'Rivenda', 'Solvera', 'Valderon', 'Zendal', 'Alcora', 'Belmora', 'Arenal',
      'Abriel', 'Alvenda', 'Belvira', 'Brisal', 'Candeal', 'Carvela', 'Celanda', 'Corvia', 'Dalmira', 'Elvana',
      'Ferenda', 'Galvia', 'Garbera', 'Ilvera', 'Jaravel', 'Lindara', 'Lorvento', 'Mirande', 'Montaral', 'Navelia',
      'Olvara', 'Palvera', 'Quilara', 'Rocalba', 'Sarvena', 'Selvara', 'Taravel', 'Telmira', 'Ulvera', 'Vandela',
      'Velaria', 'Zarela',
    ],
    orgNouns: ['Asesores', 'Servicios', 'Logística', 'Gestión', 'Ingeniería', 'Soluciones', 'Consultores', 'Talleres', 'Estudio', 'Reformas'],
    places: [
      'Valdemar', 'Montecillo', 'Puerto Claro', 'Casalta', 'Pinares', 'Torrelara', 'Villanova del Mar', 'Santa Elvira',
      'Fuentealba', 'Robledo', 'Peñaclara', 'San Ginés del Monte',
      'Aldeaclara', 'Arroyoverde', 'Benalía', 'Castrillo del Valle', 'Cerrolargo', 'Fuentesol', 'Losares', 'Montealto', 'Navalsol', 'Olmedilla Baja',
      'Peñaserena', 'Pozoclaro', 'Riosereno', 'San Bartolo del Pinar', 'Santa Olaya del Campo', 'Torrealba', 'Valdeolmo', 'Villarrosa', 'Villaserena', 'Fuentecilla',
      'Cañada Honda', 'Monteserrín', 'Losilla de Arriba', 'Valhermoso',
    ],
    domainNouns: ['asesoria', 'clinica', 'estudio', 'taller', 'grupo', 'servicios', 'logistica', 'gestion', 'despacho', 'centro', 'consultores', 'reformas'],
    domainNames: ['norte', 'sur', 'vidal', 'lumen', 'cobalto', 'tessera', 'altavia', 'ribera', 'mirador', 'olmedo', 'sierra', 'solvera'],
  },
};

const both = (pick: (l: FakeLists) => readonly string[]): string[] => [...pick(FAKES.en), ...pick(FAKES.es)];

/** Every fake of a kind, both languages. */
export const FEMALE_FIRST = both((l) => l.female);
export const MALE_FIRST = both((l) => l.male);
export const LAST_NAMES = both((l) => l.last);
export const ORG_BASES = both((l) => l.orgBases);
export const PLACES = both((l) => l.places);

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);

/**
 * Common given names, written without accents, used to tell a name's language
 * and gender. Public knowledge, like a baby-name table, and small: a name that
 * is not here falls back to its spelling and the text around it. A name in
 * both languages' lists says nothing about language, and one in both genders'
 * lists falls back to the final-a rule.
 */
export const GIVEN: Record<Lang, { female: readonly string[]; male: readonly string[] }> = {
  en: {
    female: words(`
      mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty margaret sandra
      ashley kimberly emily donna michelle carol amanda melissa deborah stephanie rebecca sharon laura cynthia
      kathleen amy angela shirley anna brenda pamela emma nicole helen samantha katherine christine rachel
      carolyn janet catherine heather diane ruth julie olivia joyce virginia victoria kelly lauren christina joan
      evelyn judith megan cheryl hannah jacqueline martha ann frances kathryn janice jean abigail alice judy
      sophia sophie grace denise amber doris marilyn danielle beverly isabella theresa diana natalie charlotte
      marie rose rosie imogen chloe lily amelia isla ava mia ella poppy freya florence evie harriet phoebe
      eleanor matilda georgia ruby holly lucy millie daisy zoe erin niamh siobhan bethany gemma kirsty leanne
      joanne claire fiona tessa naomi hazel violet iris ivy mabel edith agnes beatrice elsie esme penelope
      scarlett willow yvonne wendy tracy gillian hilary maureen marjorie muriel nora olive pauline sheila sylvia
      vera winifred priscilla rosalind georgina isadora lavinia odette rowena tamsin cordelia gwendolyn
      delphine maisie katie lydia joanna penny alison caroline harriet jane jill kate madeleine megan molly
      paige rhiannon shannon stacey tamara una
    `),
    male: words(`
      james john robert michael william david richard joseph thomas charles christopher daniel matthew anthony
      mark donald steven paul andrew joshua kenneth kevin brian george timothy ronald edward jason jeffrey ryan
      jacob gary nicholas eric jonathan stephen larry justin scott brandon benjamin samuel gregory alexander
      frank patrick raymond jack dennis jerry tyler aaron adam nathan henry douglas zachary peter kyle ethan
      walter noah jeremy christian keith roger terry gerald harold sean austin carl arthur lawrence dylan jesse
      bryan billy joe bruce logan albert willie alan wayne elijah randy roy vincent ralph eugene russell bobby
      mason philip louis oliver harry oscar charlie leo alfie freddie archie theo arlo finley callum liam
      connor declan rhys gareth owen ben hugh rupert giles nigel clive graham colin trevor neil barry ian
      stuart alistair winston percival cedric lionel ambrose humphrey jasper quentin sebastian barnaby desmond
      frederick edmund reginald rowan toby felix miles jude ellis caleb isaac simon martin victor julian hugo
      harvey lewis duncan gavin howard leonard malcolm spencer warren gordon luca ezra jonah nikita
    `),
  },
  es: {
    female: words(`
      maria carmen ana isabel laura lucia cristina marta elena pilar sara paula raquel rosa dolores mercedes
      rocio beatriz silvia julia patricia teresa montserrat nuria irene alba andrea sofia claudia ines
      concepcion josefa manuela francisca antonia encarnacion inmaculada esther angeles lorena noelia veronica
      eva natalia alicia sonia yolanda begona amparo remedios gloria aurora leonor belen macarena trinidad
      itziar ainhoa aitana nerea lidia miriam susana rosario consuelo milagros soledad asuncion estefania
      candelaria valeria daniela carla martina lola clara adriana cecilia elvira esperanza guadalupe luz
      margarita vanesa rebeca ximena abril noa jimena olga blanca celia marina ariadna leire maite amaia
      garazi idoia edurne oihana ane nieves purificacion reyes caridad monica
    `),
    male: words(`
      antonio manuel jose francisco david juan javier daniel jesus carlos alejandro miguel rafael pedro pablo
      angel sergio fernando jorge luis alberto alvaro adrian diego raul enrique ramon vicente ivan ruben oscar
      andres joaquin santiago eduardo victor roberto jaime mario ignacio alfonso salvador ricardo marcos jordi
      emilio julian julio guillermo gabriel tomas agustin gonzalo felix hugo lucas mateo martin nicolas marc
      iker unai gorka xabier aitor ander mikel jon josu eneko asier inaki aritz koldo ernesto gerardo rodrigo
      hector leandro fabian cristian bruno arturo esteban ismael lorenzo benito bernardo cristobal domingo
      eusebio fidel gregorio hilario jacinto leopoldo marcelino pascual rogelio teodoro valentin elias isaias
      jonas matias tobias andreas borja sebastian
    `),
  },
};

/** Common surnames, without accents, used only to tell a name's language. */
export const SURNAMES: Record<Lang, readonly string[]> = {
  en: words(`
    smith jones williams taylor brown davies evans wilson thomas johnson roberts robinson thompson wright walker
    white edwards hughes green hall lewis harris clarke jackson wood turner cooper hill ward morris moore clark
    king baker harrison morgan allen james scott phillips watson davis parker price bennett young griffiths
    mitchell kelly cook carter richardson bailey collins bell shaw murphy miller cox richards marshall anderson
    simpson ellis adams wilkinson foster chapman powell webb rogers gray mason hunt campbell matthews owen
    palmer holmes mills barnes knight lloyd butler russell barker fisher stevens jenkins murray dixon harvey
  `),
  es: words(`
    garcia gonzalez rodriguez fernandez lopez martinez sanchez perez gomez ruiz hernandez jimenez diaz moreno
    munoz alvarez romero alonso gutierrez navarro torres dominguez vazquez ramos gil ramirez serrano blanco
    molina morales suarez ortega delgado castro ortiz rubio marin sanz nunez iglesias medina garrido cortes
    castillo santos lozano guerrero cano prieto mendez cruz calvo gallego vidal leon marquez herrera pena
    flores cabrera campos vega fuentes carrasco diez caballero reyes nieto aguilar pascual santana herrero
    lorenzo montero hidalgo gimenez ibanez ferrer duran santiago benitez mora vicente vargas arias carmona
    crespo roman pastor soto saez velasco moya soler parra esteban bravo gallardo rojas vera
  `),
};

/** Words of company names, without accents, used only to tell a company's or host's language. */
export const ORG_WORDS: Record<Lang, readonly string[]> = {
  en: words(`
    joinery bookkeeping consulting consultants partners services solutions associates holdings group studio
    labs works roofing plumbing builders building accounting accountants clinic trust bank
    insurance logistics systems technologies foundation council school college bakery garage motors supplies
    supply advisory ventures design north south east west new the and of company limited
    brothers sons cleaning catering kitchens gardens landscaping removals estates lettings surgery pharmacy
    shop store office agency care health trading electrical joiners carpentry
  `),
  es: words(`
    gestoria asesoria asesores abogados talleres taller construcciones clinica consultores consultoria
    servicios soluciones hermanos transportes inmobiliaria distribuciones ingenieria logistica gestion
    instalaciones reformas farmacia ferreteria panaderia academia estudio despacho fundacion asociacion
    ayuntamiento colegio bodegas restaurante barberia peluqueria optica seguros grupo centro norte sur
    nuevo nueva cuatro vientos y del los las hijos limpiezas carpinteria fontaneria electricidad
    agencia tienda oficina sociedad comercial
  `),
};

/**
 * Function words, the ones a text cannot avoid, used to tell the language of
 * the text around a value. Words both languages write (a, no, me, he, has) are left out.
 */
export const FUNCTION_WORDS: Record<Lang, readonly string[]> = {
  en: words(`
    the and of to is are was were you your for on in with this that it we our i my please thanks thank hi
    hello dear regards best here there be will have had at by an not can would could should if or but what
    when which who as about any all just let know see attached kind cheers yours sincerely today tomorrow
    us they them their been do does did
  `),
  es: words(`
    el la los las de del que y en un una unos unas por para con es son esta este estos estas se su sus te
    le les lo al mi tu hola gracias saludo saludos estimado estimada buenos buenas dias muy pero como mas
    si ya hay ha han sobre entre desde hasta cuando nos os usted ustedes adjunto atentamente cordial tambien
    aqui nuestro nuestra vuestro
  `),
};

/** Local parts that carry no personal information. Kept as they are. */
export const ROLE_WORDS = new Set([
  'info', 'admin', 'support', 'soporte', 'noreply', 'reply', 'sales', 'ventas', 'billing', 'facturacion',
  'hello', 'hola', 'contact', 'contacto', 'office', 'oficina', 'team', 'equipo', 'news', 'newsletter',
  'notifications', 'notificaciones', 'notification', 'mail', 'help', 'ayuda', 'service', 'servicio',
  'accounts', 'account', 'cita', 'citas', 'reservas', 'booking', 'bookings', 'orders', 'pedidos',
  'postmaster', 'webmaster', 'security', 'mailer', 'system', 'alerts', 'updates', 'receipts', 'invoice',
  'invoices', 'marketing', 'jobs', 'press', 'donotreply', 'bounce', 'bounces', 'unsubscribe',
]);

/** Host labels worth keeping when a subdomain is rewritten. */
export const COMMON_LABELS = new Set([
  'www', 'mail', 'smtp', 'mx', 'app', 'api', 'web', 'news', 'email', 'em', 'click', 'links', 'link', 'shop',
  'store', 'support', 'help', 'm', 'secure', 'portal', 'booking', 'login', 'accounts', 'my', 'e', 't', 'r',
  'go', 'mailer', 'notify', 'billing', 'pay', 'cdn', 'static',
]);

/** Public platforms and free mail providers that say nothing about the owner. */
export const DEFAULT_ALLOW_DOMAINS = [
  'gmail.com', 'googlemail.com', 'google.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com',
  'me.com', 'yahoo.com', 'proton.me', 'protonmail.com', 'booksy.com', 'fresha.com', 'calendly.com',
  'github.com', 'apple.com', 'microsoft.com', 'zoom.us', 'linkedin.com', 'paypal.com',
];

export const PARTICLES = new Set([
  'de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'do', 'dos', 'di', 'van', 'von', 'der', 'den',
  'el', 'al', 'of', 'the', 'and',
]);

export const COUNTRY_CODES = new Set([
  '1', '7', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47',
  '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81',
  '82', '84', '86', '90', '91', '92', '93', '94', '95', '98', '212', '213', '216', '351', '352', '353',
  '354', '355', '356', '357', '358', '359', '370', '371', '372', '380', '381', '385', '386', '420', '421',
  '502', '503', '504', '505', '506', '507', '591', '593', '595', '598', '971', '972',
]);

export const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27,
  GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31,
  NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27,
};

// ------------------------------------------------------------ shared patterns

/** The legal form a company name may end in ("S.L.", "Inc.", "GmbH"), with the space before it. */
// Try each whitespace run once, rather than retrying at every space in it.
export const ORG_SUFFIX = /(?<!\s)\s+(?:S\.?L\.?U?\.?|S\.?A\.?|S\.?L\.?P\.?|Inc\.?|LLC|Ltd\.?|GmbH|Corp\.?|B\.?V\.?)$/i;

/** The at sign, or the ways mail gets it encoded: %40 and HTML entities. */
export const AT_SRC = String.raw`(?:@|%40|&#0*64;|&#x0*40;|&commat;)`;

/** Host names RFC 2606 and RFC 6761 reserve: `.example`, `.test`, `.invalid`, `.localhost`, `example.com/.net/.org`. */
export const RESERVED_HOST = /(?:^|\.)(?:example|test|invalid|localhost)$|^example\.(?:com|net|org)$/;
export const GMAIL = new Set(['gmail.com', 'googlemail.com']);

/**
 * True when no one can own `local@host`: a reserved host, a Gmail mailbox
 * with an underscore or a dash before any `+tag` (Google's username rules
 * allow only letters, digits and dots, support.google.com/mail/answer/9211434),
 * or, at any other host, two dots in a row, which RFC 5322 section 3.4.1 does
 * not allow in an unquoted local part.
 */
export function unownableMailbox(local: string, host: string): boolean {
  const h = host.toLowerCase();
  if (RESERVED_HOST.test(h)) return true;
  return GMAIL.has(h) ? /[_-]/.test(local.split('+')[0] as string) : local.includes('..');
}
