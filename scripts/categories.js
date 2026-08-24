/* GOAT.lol — the boards.
 *
 * `prop` is the Wikidata property the query filters on:
 *   P106 occupation (people), P31 instance of (things), P39 position held.
 * `qid` is the value. `limit` is how many to seed.
 *
 * IMPORTANT: these QIDs were written without network access to Wikidata, so
 * some are certainly wrong — a wrong QID yields an empty or nonsense board
 * rather than an error. Run `node scripts/seed.js --check` first: it queries
 * every board, prints the count and the top three names it would seed, and
 * writes nothing. Fix whatever looks wrong before seeding for real.
 */
export const CATEGORIES = [
  // ---- Football
  { slug:'footballers',      name:'Footballers',       group:'Football', prop:'P106', qid:'Q937857',   limit:20 },
  { slug:'football-managers',name:'Managers',          group:'Football', prop:'P106', qid:'Q628099',   limit:20 },
  { slug:'football-clubs',   name:'Clubs',             group:'Football', prop:'P31',  qid:'Q476028',   limit:20 },
  { slug:'goalkeepers',      name:'Goalkeepers',       group:'Football', prop:'P413', qid:'Q201330',   limit:20 },

  // ---- Cricket
  { slug:'batsmen',          name:'Batsmen',           group:'Cricket',  prop:'P106', qid:'Q12299841', limit:20, note:'occupation is "cricketer"; no separate batsman QID' },
  { slug:'bowlers',          name:'Bowlers',           group:'Cricket',  prop:'P106', qid:'Q12299841', limit:20 },
  { slug:'all-rounders',     name:'All-rounders',      group:'Cricket',  prop:'P106', qid:'Q12299841', limit:20 },
  { slug:'cricket-captains', name:'Captains',          group:'Cricket',  prop:'P106', qid:'Q12299841', limit:20 },
  { slug:'ipl-players',      name:'IPL players',       group:'Cricket',  prop:'P106', qid:'Q12299841', limit:20 },
  { slug:'wicketkeepers',    name:'Wicketkeepers',     group:'Cricket',  prop:'P106', qid:'Q12299841', limit:20 },

  // ---- Basketball
  { slug:'basketball-players',name:'Players',          group:'Basketball', prop:'P106', qid:'Q3665646', limit:20 },
  { slug:'basketball-teams',  name:'Teams',            group:'Basketball', prop:'P31',  qid:'Q13393265',limit:20 },

  // ---- Tennis
  { slug:'tennis-men',       name:'Men',               group:'Tennis',   prop:'P106', qid:'Q10833314', limit:20 },
  { slug:'tennis-women',     name:'Women',             group:'Tennis',   prop:'P106', qid:'Q10833314', limit:20, gender:'Q6581072' },

  // ---- Combat
  { slug:'boxers',           name:'Boxers',            group:'Combat',   prop:'P106', qid:'Q11338576', limit:20 },
  { slug:'mma-fighters',     name:'MMA fighters',      group:'Combat',   prop:'P106', qid:'Q13474373', limit:20 },
  { slug:'wrestlers',        name:'Wrestlers',         group:'Combat',   prop:'P106', qid:'Q13474373', limit:20 },

  // ---- Motorsport
  { slug:'f1-drivers',       name:'F1 drivers',        group:'Motorsport', prop:'P106', qid:'Q10841764', limit:20 },
  { slug:'f1-teams',         name:'F1 teams',          group:'Motorsport', prop:'P31',  qid:'Q5124776',  limit:20 },
  { slug:'motogp-riders',    name:'MotoGP riders',     group:'Motorsport', prop:'P106', qid:'Q15117302', limit:20 },

  // ---- Other sport
  { slug:'track-athletes',   name:'Track athletes',    group:'Sport',    prop:'P106', qid:'Q11513337', limit:20 },
  { slug:'swimmers',         name:'Swimmers',          group:'Sport',    prop:'P106', qid:'Q10843402', limit:20 },
  { slug:'golfers',          name:'Golfers',           group:'Sport',    prop:'P106', qid:'Q11303721', limit:20 },
  { slug:'hockey-players',   name:'Hockey players',    group:'Sport',    prop:'P106', qid:'Q11774891', limit:20 },
  { slug:'gymnasts',         name:'Gymnasts',          group:'Sport',    prop:'P106', qid:'Q13382576', limit:20 },
  { slug:'cyclists',         name:'Cyclists',          group:'Sport',    prop:'P106', qid:'Q2309784',  limit:20 },

  // ---- Mind sports
  { slug:'chess-players',    name:'Chess players',     group:'Mind sports', prop:'P106', qid:'Q10873124', limit:20 },
  { slug:'esports-players',  name:'Esports players',   group:'Mind sports', prop:'P106', qid:'Q4379701',  limit:20 },
  { slug:'poker-players',    name:'Poker players',     group:'Mind sports', prop:'P106', qid:'Q10871364', limit:20 },

  // ---- Screen
  { slug:'hollywood-actors',    name:'Hollywood actors',    group:'Screen', prop:'P106', qid:'Q10800557', limit:20, country:'Q30' },
  { slug:'hollywood-actresses', name:'Hollywood actresses', group:'Screen', prop:'P106', qid:'Q10800557', limit:20, country:'Q30', gender:'Q6581072' },
  { slug:'bollywood-actors',    name:'Bollywood actors',    group:'Screen', prop:'P106', qid:'Q10800557', limit:20, country:'Q668' },
  { slug:'bollywood-actresses', name:'Bollywood actresses', group:'Screen', prop:'P106', qid:'Q10800557', limit:20, country:'Q668', gender:'Q6581072' },
  { slug:'korean-actors',       name:'Korean actors',       group:'Screen', prop:'P106', qid:'Q10800557', limit:20, country:'Q884' },
  { slug:'directors',           name:'Directors',           group:'Screen', prop:'P106', qid:'Q2526255',  limit:20 },
  { slug:'films',               name:'Films',               group:'Screen', prop:'P31',  qid:'Q11424',    limit:20 },
  { slug:'tv-shows',            name:'TV shows',            group:'Screen', prop:'P31',  qid:'Q5398426',  limit:20 },
  { slug:'animated-films',      name:'Animated films',      group:'Screen', prop:'P31',  qid:'Q202866',   limit:20 },
  { slug:'villains',            name:'Villains',            group:'Screen', prop:'P31',  qid:'Q15632617', limit:20, note:'fictional human; needs manual pruning' },
  { slug:'comedians',           name:'Comedians',           group:'Screen', prop:'P106', qid:'Q245068',   limit:20 },

  // ---- Music
  { slug:'singers',          name:'Singers',           group:'Music',    prop:'P106', qid:'Q177220',  limit:20 },
  { slug:'rappers',          name:'Rappers',           group:'Music',    prop:'P106', qid:'Q2252262', limit:20 },
  { slug:'bands',            name:'Bands',             group:'Music',    prop:'P31',  qid:'Q215380',  limit:20 },
  { slug:'guitarists',       name:'Guitarists',        group:'Music',    prop:'P106', qid:'Q855091',  limit:20 },
  { slug:'drummers',         name:'Drummers',          group:'Music',    prop:'P106', qid:'Q386854',  limit:20 },
  { slug:'composers',        name:'Composers',         group:'Music',    prop:'P106', qid:'Q36834',   limit:20 },
  { slug:'producers',        name:'Producers',         group:'Music',    prop:'P106', qid:'Q183945',  limit:20 },
  { slug:'djs',              name:'DJs',               group:'Music',    prop:'P106', qid:'Q130857',  limit:20 },
  { slug:'albums',           name:'Albums',            group:'Music',    prop:'P31',  qid:'Q482994',  limit:20 },
  { slug:'playback-singers', name:'Playback singers',  group:'Music',    prop:'P106', qid:'Q3357567', limit:20 },
  { slug:'kpop-groups',      name:'K-pop groups',      group:'Music',    prop:'P31',  qid:'Q215380',  limit:20, country:'Q884' },

  // ---- Mind
  { slug:'scientists',       name:'Scientists',        group:'Mind',     prop:'P106', qid:'Q901',     limit:20 },
  { slug:'physicists',       name:'Physicists',        group:'Mind',     prop:'P106', qid:'Q169470',  limit:20 },
  { slug:'mathematicians',   name:'Mathematicians',    group:'Mind',     prop:'P106', qid:'Q170790',  limit:20 },
  { slug:'chemists',         name:'Chemists',          group:'Mind',     prop:'P106', qid:'Q593644',  limit:20 },
  { slug:'biologists',       name:'Biologists',        group:'Mind',     prop:'P106', qid:'Q864503',  limit:20 },
  { slug:'philosophers',     name:'Philosophers',      group:'Mind',     prop:'P106', qid:'Q4964182', limit:20 },
  { slug:'economists',       name:'Economists',        group:'Mind',     prop:'P106', qid:'Q188094',  limit:20 },
  { slug:'inventors',        name:'Inventors',         group:'Mind',     prop:'P106', qid:'Q205375',  limit:20 },
  { slug:'astronauts',       name:'Astronauts',        group:'Mind',     prop:'P106', qid:'Q11631',   limit:20 },

  // ---- Words
  { slug:'novelists',        name:'Novelists',         group:'Words',    prop:'P106', qid:'Q6625963', limit:20 },
  { slug:'poets',            name:'Poets',             group:'Words',    prop:'P106', qid:'Q49757',   limit:20 },
  { slug:'playwrights',      name:'Playwrights',       group:'Words',    prop:'P106', qid:'Q214917',  limit:20 },
  { slug:'books',            name:'Books',             group:'Words',    prop:'P31',  qid:'Q7725634', limit:20 },

  // ---- Power
  { slug:'us-presidents',    name:'US presidents',     group:'Power',    prop:'P39',  qid:'Q11696',   limit:20 },
  { slug:'indian-pms',       name:'Indian PMs',        group:'Power',    prop:'P39',  qid:'Q303628',  limit:20 },
  { slug:'emperors',         name:'Emperors',          group:'Power',    prop:'P106', qid:'Q39018',   limit:20 },
  { slug:'generals',         name:'Generals',          group:'Power',    prop:'P106', qid:'Q47064',   limit:20 },
  { slug:'revolutionaries',  name:'Revolutionaries',   group:'Power',    prop:'P106', qid:'Q3242115', limit:20 },

  // ---- Business
  { slug:'founders',         name:'Founders',          group:'Business', prop:'P106', qid:'Q131524',  limit:20 },
  { slug:'investors',        name:'Investors',         group:'Business', prop:'P106', qid:'Q1364970', limit:20 },
  { slug:'ceos',             name:'CEOs',              group:'Business', prop:'P106', qid:'Q484876',  limit:20 },
  { slug:'companies',        name:'Companies',         group:'Business', prop:'P31',  qid:'Q4830453', limit:20 },

  // ---- Culture
  { slug:'painters',         name:'Painters',          group:'Culture',  prop:'P106', qid:'Q1028181', limit:20 },
  { slug:'photographers',    name:'Photographers',     group:'Culture',  prop:'P106', qid:'Q33231',   limit:20 },
  { slug:'architects',       name:'Architects',        group:'Culture',  prop:'P106', qid:'Q42973',   limit:20 },
  { slug:'chefs',            name:'Chefs',             group:'Culture',  prop:'P106', qid:'Q3499072', limit:20 },
  { slug:'fashion-designers',name:'Fashion designers', group:'Culture',  prop:'P106', qid:'Q3501317', limit:20 },
  { slug:'dancers',          name:'Dancers',           group:'Culture',  prop:'P106', qid:'Q5716684', limit:20 },

  // ---- Internet
  { slug:'youtubers',        name:'YouTubers',         group:'Internet', prop:'P106', qid:'Q17125263', limit:20 },
  { slug:'streamers',        name:'Streamers',         group:'Internet', prop:'P106', qid:'Q57712981', limit:20 },
  { slug:'podcasters',       name:'Podcasters',        group:'Internet', prop:'P106', qid:'Q49262215', limit:20 },
  { slug:'ai-startups',      name:'AI startups',       group:'Internet', prop:'P31',  qid:'Q4830453',  limit:20, note:'needs manual pruning to AI companies' }
];
