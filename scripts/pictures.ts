// Goal Rush's real pictures, for the superadmin alone: every club's crest and every player's photo,
// fetched from Wikipedia, kept on this computer in pictures/ (never in git, never in the site's
// public files), and put into the private R2 bucket under sides/, where only a superadmin's session
// gets them (worker/routes/sides.ts). Everyone else's videos draw the kits (src/football/kits.ts).
// The owner's decision, 2026-11-23: real crests and photos in his own videos, none shipped to
// customers (docs/goal-rush.md §3).
//
//   npm run pictures -- fetch              download the clubs' crests that are missing into pictures/
//   npm run pictures -- fetch --again      download every crest again
//   npm run pictures -- photos             pick each player's best photo and cut his head out of it
//   npm run pictures -- photos --again     pick again for every player
//   npm run pictures -- photos --only=messi,pele   pick again for these
//   npm run pictures -- photos --relaxed   a second pass for those with none: smaller faces, a second face allowed
//   npm run pictures -- upload             put them into the local bucket (npm run dev, preview)
//   npm run pictures -- upload --remote    put them into production's bucket
//
// A crest is its club's Wikipedia page's picture, as it is (a PNG, its background clear). A player's
// photo is the best of up to eight: his page's picture and Wikimedia Commons' first photos with his
// name, each looked at by macOS's face detection (scripts/faces.swift); the one with one clear face,
// big, sharp and looking at the camera wins, and a square round his head and shoulders is cut out
// of it (sips, macOS's own), so the ball shows a face as a team's photo would.
//
// pictures/manifest.json says, per club or player, its file, what it is (a crest or a photo) and
// where it came from (the Wikipedia page and the file's page, for its author and licence). A file
// named in PHOTOS is taken for a player instead of the pick, where the pick was wrong.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { SIDES, type Side } from '../src/football/teams.ts';

declare const process: { argv: string[]; exit(code: number): never };

const DIR = new URL('../pictures/', import.meta.url);
const MANIFEST = new URL('manifest.json', DIR);
/** Wikimedia asks scripts to say who they are; no contact details go out (CLAUDE.md). */
const AGENT = 'BounceReelPictures/1.0 (one-off fetch of page images)';
/** The size asked for: the ball is 168 px across at its biggest and the winner card's 240 px. */
const SIZE = 512;

export interface Picture {
  file: string;
  kind: 'crest' | 'photo';
  /** The Wikipedia page it is the picture of, and the file's page (its author and licence). */
  page: string;
  source: string;
  /** A photo's pick: how good a capture of a face it is (0 to 1), and how many it was picked from. */
  score?: number;
  of?: number;
}

export interface Manifest {
  /** Bumped by every fetch, so the studio never shows a picture its cache kept from before. */
  version: string;
  sides: Record<string, Picture>;
}

/**
 * Each club's page on the English Wikipedia; a player's is his name, unless his name is several
 * people's (then the page that is his).
 */
const PAGES: Record<string, string> = {
  arsenal: 'Arsenal F.C.',
  'aston-villa': 'Aston Villa F.C.',
  bournemouth: 'AFC Bournemouth',
  brentford: 'Brentford F.C.',
  brighton: 'Brighton & Hove Albion F.C.',
  burnley: 'Burnley F.C.',
  chelsea: 'Chelsea F.C.',
  'crystal-palace': 'Crystal Palace F.C.',
  everton: 'Everton F.C.',
  fulham: 'Fulham F.C.',
  leeds: 'Leeds United F.C.',
  liverpool: 'Liverpool F.C.',
  'man-city': 'Manchester City F.C.',
  'man-united': 'Manchester United F.C.',
  newcastle: 'Newcastle United F.C.',
  'nottingham-forest': 'Nottingham Forest F.C.',
  sunderland: 'Sunderland A.F.C.',
  tottenham: 'Tottenham Hotspur F.C.',
  'west-ham': 'West Ham United F.C.',
  wolves: 'Wolverhampton Wanderers F.C.',
  alaves: 'Deportivo Alavés',
  athletic: 'Athletic Bilbao',
  atletico: 'Atlético Madrid',
  barcelona: 'FC Barcelona',
  celta: 'RC Celta de Vigo',
  elche: 'Elche CF',
  espanyol: 'RCD Espanyol',
  getafe: 'Getafe CF',
  girona: 'Girona FC',
  levante: 'Levante UD',
  mallorca: 'RCD Mallorca',
  osasuna: 'CA Osasuna',
  rayo: 'Rayo Vallecano',
  betis: 'Real Betis',
  'real-madrid': 'Real Madrid CF',
  oviedo: 'Real Oviedo',
  'real-sociedad': 'Real Sociedad',
  sevilla: 'Sevilla FC',
  valencia: 'Valencia CF',
  villarreal: 'Villarreal CF',
  atalanta: 'Atalanta BC',
  bologna: 'Bologna FC 1909',
  cagliari: 'Cagliari Calcio',
  como: 'Como 1907',
  cremonese: 'US Cremonese',
  fiorentina: 'ACF Fiorentina',
  genoa: 'Genoa CFC',
  verona: 'Hellas Verona FC',
  inter: 'Inter Milan',
  juventus: 'Juventus FC',
  lazio: 'SS Lazio',
  lecce: 'US Lecce',
  milan: 'AC Milan',
  napoli: 'SSC Napoli',
  parma: 'Parma Calcio 1913',
  pisa: 'Pisa SC',
  roma: 'AS Roma',
  sassuolo: 'US Sassuolo Calcio',
  torino: 'Torino FC',
  udinese: 'Udinese Calcio',
  augsburg: 'FC Augsburg',
  leverkusen: 'Bayer 04 Leverkusen',
  bayern: 'FC Bayern Munich',
  dortmund: 'Borussia Dortmund',
  gladbach: 'Borussia Mönchengladbach',
  frankfurt: 'Eintracht Frankfurt',
  freiburg: 'SC Freiburg',
  hamburg: 'Hamburger SV',
  heidenheim: '1. FC Heidenheim',
  hoffenheim: 'TSG Hoffenheim',
  koln: '1. FC Köln',
  mainz: '1. FSV Mainz 05',
  leipzig: 'RB Leipzig',
  'st-pauli': 'FC St. Pauli',
  'union-berlin': '1. FC Union Berlin',
  stuttgart: 'VfB Stuttgart',
  werder: 'SV Werder Bremen',
  wolfsburg: 'VfL Wolfsburg',
  schalke: 'FC Schalke 04',
  angers: 'Angers SCO',
  auxerre: 'AJ Auxerre',
  brest: 'Stade Brestois 29',
  'le-havre': 'Le Havre AC',
  lens: 'RC Lens',
  lille: 'Lille OSC',
  lorient: 'FC Lorient',
  lyon: 'Olympique Lyonnais',
  marseille: 'Olympique de Marseille',
  metz: 'FC Metz',
  monaco: 'AS Monaco FC',
  nantes: 'FC Nantes',
  nice: 'OGC Nice',
  'paris-fc': 'Paris FC',
  psg: 'Paris Saint-Germain FC',
  rennes: 'Stade Rennais FC',
  strasbourg: 'RC Strasbourg Alsace',
  toulouse: 'Toulouse FC',
  'crvena-zvezda': 'Red Star Belgrade',
  partizan: 'FK Partizan',
  vojvodina: 'FK Vojvodina',
  'dinamo-zagreb': 'GNK Dinamo Zagreb',
  hajduk: 'HNK Hajduk Split',
  celtic: 'Celtic F.C.',
  rangers: 'Rangers F.C.',
  ajax: 'AFC Ajax',
  psv: 'PSV Eindhoven',
  feyenoord: 'Feyenoord',
  az: 'AZ Alkmaar',
  benfica: 'S.L. Benfica',
  porto: 'FC Porto',
  sporting: 'Sporting CP',
  braga: 'S.C. Braga',
  'club-brugge': 'Club Brugge KV',
  anderlecht: 'R.S.C. Anderlecht',
  'union-sg': 'Royale Union Saint-Gilloise',
  galatasaray: 'Galatasaray S.K. (football)',
  fenerbahce: 'Fenerbahçe S.K. (football)',
  besiktas: 'Beşiktaş J.K.',
  trabzonspor: 'Trabzonspor',
  olympiacos: 'Olympiacos F.C.',
  panathinaikos: 'Panathinaikos F.C.',
  paok: 'PAOK FC',
  aek: 'AEK Athens F.C.',
  copenhagen: 'F.C. Copenhagen',
  'bodo-glimt': 'FK Bodø/Glimt',
  slavia: 'SK Slavia Prague',
  sparta: 'AC Sparta Prague',
  pafos: 'Pafos FC',
  kairat: 'FC Kairat',
  qarabag: 'Qarabağ FK',
  salzburg: 'FC Red Bull Salzburg',
  shakhtar: 'FC Shakhtar Donetsk',
  'dynamo-kyiv': 'FC Dynamo Kyiv',
  zenit: 'FC Zenit Saint Petersburg',
  spartak: 'FC Spartak Moscow',
  ferencvaros: 'Ferencvárosi TC',
  legia: 'Legia Warsaw',
  'young-boys': 'BSC Young Boys',
  basel: 'FC Basel',
  boca: 'Boca Juniors',
  river: 'Club Atlético River Plate',
  flamengo: 'CR Flamengo',
  palmeiras: 'SE Palmeiras',
  corinthians: 'Sport Club Corinthians Paulista',
  santos: 'Santos FC',
  'sao-paulo': 'São Paulo FC',
  fluminense: 'Fluminense FC',
  vasco: 'CR Vasco da Gama',
  america: 'Club América',
  chivas: 'C.D. Guadalajara',
  'inter-miami': 'Inter Miami CF',
  'la-galaxy': 'LA Galaxy',
  lafc: 'Los Angeles FC',
  'al-nassr': 'Al-Nassr FC',
  'al-hilal': 'Al Hilal SFC',
  'al-ittihad': 'Ittihad FC',
  'al-ahly': 'Al Ahly SC',
  // Players whose name is several people's.
  gavi: 'Gavi (footballer)',
  ederson: 'Ederson (footballer, born 1993)',
  rodri: 'Rodri (footballer, born 1996)',
  marquinhos: 'Marquinhos (footballer, born 1994)',
  vitinha: 'Vitinha (footballer, born 2000)',
  endrick: 'Endrick (footballer, born 2006)',
  rodrygo: 'Rodrygo',
  zico: 'Zico (footballer)',
  socrates: 'Sócrates (footballer)',
  raul: 'Raúl (footballer)',
  'luis-diaz': 'Luis Díaz (Colombian footballer)',
  'ronaldo-nazario': 'Ronaldo (Brazilian footballer)',
  'roberto-carlos': 'Roberto Carlos',
  xavi: 'Xavi',
  'theo-hernandez': 'Theo Hernandez',
  // "Adriano" is a list of people; its first photo was the singer Adriano Celentano.
  adriano: 'Adriano (footballer, born February 1982)',
  ugarte: 'Manuel Ugarte (footballer)',
  estevao: 'Estêvão Willian',
};

/**
 * Files a player's photo is taken from by hand, where the pick was another man or a poor one: on
 * Commons, or with "it:" on the Italian Wikipedia, which keeps old Serie A photos of its own.
 */
const PHOTOS: Record<string, string> = {
  // Each of these lost to a statue, a mural, a fan's painting, a billboard or a namesake.
  ballack: 'Michael Ballack 2009 cropped.jpg',
  estevao: 'Estevao-Palmeiras-Liverpool-abr24 (cropped).jpg',
  henry: 'Thierry Henry (51649035951) (cropped).jpg',
  pogba: 'FRA-ARG (11) - Paul Pogba (cropped).jpg',
  riquelme: 'Juan Román Riquelme - 2019.jpg',
  ugarte: 'M.UGARTE.jpg',
  zinchenko: 'Oleksandr Zinchenko (footballer) 2023 (cropped).jpg',
  // These found no clear face of their own: a small one, a face turned away, a crowd round him, or
  // too small a file for the size the pick asks of a photo.
  'al-dawsari': 'Salem Al-Dawsari (Saudi Arabia v Uruguay, June 2026) (cropped).jpg',
  antony: 'Antony In Betis 23rd November 2025.png 2.png',
  boksic: 'it:Alen Bokšić - Juventus FC 1996-97.jpg',
  cubillas: 'Teófilo Cubillas 1978.jpg',
  dumfries: 'Edison ndreca inter egnati (cropped Denzel Dumfries).jpg',
  futre: '(Paulo Futre) Manuela Carmena - “¡Bienvenida la orejona!.jpg',
  inzaghi: 'Filippo Inzaghi 2011.jpg',
  'kenan-yildiz': 'Kenan Yıldız in the international match (March 2025) (cropped).jpg',
  // The owner's choice: Maradona in Argentina's shirt, 1986, not in a suit years later.
  maradona: 'Argentina celebrando copa (cropped).jpg',
  mijatovic: 'Predrag Mijatović 2007 b.jpg',
  'milinkovic-savic': 'Milinković-Savić 2018.jpg',
  okocha: 'Match legends 2017 CC (5).jpg',
  rivaldo: 'Rivaldo.jpg',
};
/**
 * A photo's square, cut round the face: this many times the face's height across, its middle this
 * much of the face's height above the face's own (Vision's box runs from the brows to the chin, so
 * the hair is above it): the whole head with room over it, and the neck and shoulders under it.
 */
const HEAD = 2.5;
const HEAD_RISE = 0.12;
/** The square's side, px: the winner card draws a photo 240 px across. */
const HEAD_PX = 360;
/** Words in a file's name that say it is not a photo of the man himself. */
const NOT_HIM = /signature|autograph|statue|mural|graffiti|sticker|wax|tussaud|painting|drawing|card|stamp|logo|kit|shirt|jersey|tomb|grave|bust|poster|cartoon|caricature|banner|coin|sculpture|figurine|museum/i;

/**
 * A request to Wikimedia, slowly: a pause before each, and on a 429 (too many requests) a wait that
 * doubles, up to five times. It asks scripts to keep to a few requests a second.
 */
async function polite(url: string | URL, tries = 6): Promise<Response> {
  for (let wait = 2000, i = 0; ; wait *= 2, i++) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      // 20 s at the most: a request left hanging stopped a whole run once.
      const res = await fetch(url, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(20_000) });
      if (res.status !== 429 || i >= tries - 1) return res;
      // Never more than half a minute: a long Retry-After is a run that looks stuck.
      await new Promise((r) => setTimeout(r, Math.min(30_000, Number(res.headers.get('retry-after')) * 1000 || wait)));
    } catch (err) {
      if (i >= Math.min(3, tries - 1)) return new Response(null, { status: 599, statusText: String(err) });
    }
  }
}

function pageOf(side: Side): string {
  return PAGES[side.id] ?? side.name;
}

/**
 * Writes one side's entry into the manifest on disk, read again just before: several `photos`
 * runs may go at once (each with its own --only), and none may write over another's picks.
 */
function saveEntry(id: string, picture: Picture): void {
  const now = readManifest();
  now.sides[id] = picture;
  const tmp = new URL(`manifest.${id}.tmp`, DIR);
  writeFileSync(tmp, `${JSON.stringify(now, null, 2)}\n`);
  execFileSync('mv', [tmp.pathname, MANIFEST.pathname]);
}

function readManifest(): Manifest {
  return existsSync(MANIFEST) ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest) : { version: '', sides: {} };
}

async function api(titles: string[]): Promise<Map<string, { title: string; thumb?: string; image?: string; ambiguous: boolean }>> {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    titles: titles.join('|'),
    prop: 'pageimages|pageprops',
    piprop: 'thumbnail|name',
    pithumbsize: String(SIZE),
    pilicense: 'any',
    ppprop: 'disambiguation',
    redirects: '1',
    format: 'json',
    formatversion: '2',
  }).toString();
  const res = await polite(url);
  if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`);
  const body = (await res.json()) as {
    query: {
      normalized?: { from: string; to: string }[];
      redirects?: { from: string; to: string }[];
      pages: { title: string; missing?: boolean; thumbnail?: { source: string }; pageimage?: string; pageprops?: { disambiguation?: string } }[];
    };
  };
  // Each title asked for, through its normalising and redirects, to the page it ends at.
  const follow = (title: string) => {
    let t = body.query.normalized?.find((n) => n.from === title)?.to ?? title;
    t = body.query.redirects?.find((r) => r.from === t)?.to ?? t;
    return t;
  };
  const out = new Map<string, { title: string; thumb?: string; image?: string; ambiguous: boolean }>();
  for (const asked of titles) {
    const page = body.query.pages.find((p) => p.title === follow(asked));
    if (!page || page.missing) continue;
    out.set(asked, { title: page.title, thumb: page.thumbnail?.source, image: page.pageimage, ambiguous: !!page.pageprops?.disambiguation });
  }
  return out;
}

async function fetchAll(again: boolean): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  const manifest = readManifest();
  const todo = SIDES.filter((s) => s.mode === 'clubs' && (again || !manifest.sides[s.id] || !existsSync(new URL(manifest.sides[s.id].file, DIR))));
  const missing: string[] = [];
  for (let i = 0; i < todo.length; i += 40) {
    const batch = todo.slice(i, i + 40);
    const pages = await api(batch.map(pageOf));
    for (const side of batch) {
      const page = pages.get(pageOf(side));
      if (!page?.thumb || page.ambiguous) {
        missing.push(`${side.id} (${pageOf(side)}${page?.ambiguous ? ', a disambiguation page' : page ? ', no picture' : ', no such page'})`);
        continue;
      }
      const res = await polite(page.thumb);
      if (!res.ok) {
        missing.push(`${side.id} (the picture answered ${res.status})`);
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const type = res.headers.get('content-type') ?? '';
      const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
      // The content's hash in the name: a new picture is a new address, past the browser's year-long cache.
      const file = `${side.id}.${createHash('sha256').update(bytes).digest('hex').slice(0, 8)}.${ext}`;
      writeFileSync(new URL(file, DIR), bytes);
      manifest.sides[side.id] = {
        file,
        kind: side.mode === 'clubs' ? 'crest' : 'photo',
        page: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
        source: page.image ? `https://en.wikipedia.org/wiki/File:${encodeURIComponent(page.image)}` : page.thumb,
      };
      console.log(`  ${side.id.padEnd(22)} ${file}`);
    }
    // Kept after every batch: a fetch stopped halfway keeps what it got.
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  manifest.version = createHash('sha256').update(JSON.stringify(manifest.sides)).digest('hex').slice(0, 10);
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  const clubs = SIDES.filter((s) => s.mode === 'clubs');
  console.log(`\n${clubs.filter((s) => manifest.sides[s.id]).length} of ${clubs.length} clubs have their crest in pictures/.`);
  if (missing.length) console.log(`Not found, ${missing.length}:\n  ${missing.join('\n  ')}`);
}

interface Candidate {
  path: string;
  /** The file's page, for its author and licence. */
  source: string;
  /** His Wikipedia page's own picture: chosen by its editors, so surely him. */
  page: boolean;
}

interface Faces {
  file: string;
  width: number;
  height: number;
  faces: { x: number; y: number; w: number; h: number; confidence: number; quality: number }[];
}

/**
 * Commons' photos of the player, up to `n`, at 960 px: from his own category there ("Category:Luka
 * Modrić", one cheap request, and its files are of him), else from a search for his name (Commons'
 * search is throttled hard: it once held a run for minutes). Within a category, the photos cut
 * close by Commons' editors ("(cropped)") first, then the newest, so a star looks as he does now.
 */
async function commonsPhotos(side: Side, n: number, chosen?: string): Promise<{ url: string; title: string; source: string }[]> {
  type Page = { title: string; index?: number; imageinfo?: { thumburl?: string; mime: string; width: number; height: number; timestamp?: string }[] };
  const host = chosen?.startsWith('it:') ? 'it.wikipedia.org' : 'commons.wikimedia.org';
  const ask = async (params: Record<string, string>) => {
    const url = new URL(`https://${host}/w/api.php`);
    url.search = new URLSearchParams({ action: 'query', prop: 'imageinfo', iiprop: 'url|size|mime|timestamp', iiurlwidth: '960', format: 'json', formatversion: '2', ...params }).toString();
    const res = await polite(url, 3);
    return res.ok ? (((await res.json()) as { query?: { pages: Page[] } }).query?.pages ?? []) : [];
  };
  const surname = fold(side.name.split(' ').pop() ?? side.name);
  const usable = (p: Page, named: boolean) => {
    const info = p.imageinfo?.[0];
    return !!info?.thumburl && /jpeg|png/.test(info.mime) && Math.min(info.width, info.height) >= 400 && !NOT_HIM.test(p.title) && (!named || fold(p.title).includes(surname));
  };
  const fileUrl = (title: string) => `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  if (chosen) {
    const titles = `File:${chosen.replace(/^it:/, '')}`;
    let [page] = await ask({ titles });
    // A file no wider than the size asked for comes as the original, which upload.wikimedia.org
    // throttles hard (a 429 for ten minutes); a thumbnail is served at once, but only at Wikimedia's
    // standard widths (another is rounded up to one, and past the file's own width is the original
    // again), so the widest standard one narrower than the file.
    const width = page?.imageinfo?.[0]?.width ?? 0;
    const step = [250, 330, 500].filter((w) => w < width).pop();
    if (width <= 960 && step) [page] = await ask({ titles, iiurlwidth: String(step) });
    const url = page?.imageinfo?.[0]?.thumburl;
    return url ? [{ url, title: page.title, source: fileUrl(page.title) }] : [];
  }
  const own = (await ask({ generator: 'categorymembers', gcmtitle: `Category:${side.name}`, gcmtype: 'file', gcmlimit: '60' })).filter((p) => usable(p, false));
  const pages = own.length >= 2
    ? own.sort((a, b) => Number(/cropped/i.test(b.title)) - Number(/cropped/i.test(a.title)) || (b.imageinfo![0].timestamp ?? '').localeCompare(a.imageinfo![0].timestamp ?? ''))
    : (await ask({ generator: 'search', gsrsearch: `"${side.name}"`, gsrnamespace: '6', gsrlimit: '20' })).filter((p) => usable(p, true)).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.slice(0, n).map((p) => ({ url: p.imageinfo![0].thumburl!, title: p.title, source: fileUrl(p.title) }));
}

/** Lowercase without accents, as names are compared. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * How good a photo is of the player's face, 0 for none: the best capture of a face Vision rates
 * (sharp, lit, facing the camera), more for a face that fills more of it, his page's own picture a
 * little more (its editors chose it, so it is surely him), and nothing for a photo where another
 * face is nearly as big as his, which may be the other man's.
 */
function rate(f: Faces, page: boolean): number {
  const faces = f.faces.filter((x) => x.confidence >= 0.5).sort((a, b) => b.w * b.h - a.w * a.h);
  const [face, next] = faces;
  // --relaxed (a second pass for those with no pick): a smaller face, and another face up to half his.
  if (!face || face.h * f.height < (RELAXED ? 50 : 80)) return 0;
  if (next && next.w * next.h > (RELAXED ? 0.5 : 0.35) * face.w * face.h) return 0;
  // A face against the photo's edge cannot be centred in its square: the head comes out cut or to one side.
  const cut = square(f);
  const off = Math.hypot(cut.cx - cut.left - cut.side / 2, cut.cy - cut.top - cut.side / 2) / cut.side;
  const small = cut.side < cut.want * 0.9;
  return face.quality * (0.55 + 0.45 * Math.min(1, face.h / 0.3)) * (page ? 1.15 : 1) * (off > 0.08 || small ? 0.35 : 1);
}

/** A hand-picked photo's score: its biggest face's capture quality, above 0 whenever there is a face (0 is "none", and upload sends only scored photos). */
function handPicked(f: Faces): number {
  const face = [...f.faces].sort((a, b) => b.w * b.h - a.w * a.h)[0];
  return face ? Math.max(0.01, face.quality) : 0;
}

/** The square round a photo's biggest face (HEAD, HEAD_RISE), kept inside the photo: where it is, where the face's middle is, and how big it wanted to be. */
function square(f: Faces): { left: number; top: number; side: number; cx: number; cy: number; want: number } {
  const face = [...f.faces].sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const want = face.h * f.height * HEAD;
  const side = Math.round(Math.min(f.width, f.height, want));
  const cx = (face.x + face.w / 2) * f.width;
  const cy = (face.y + face.h / 2 - face.h * HEAD_RISE) * f.height;
  const left = Math.round(Math.max(0, Math.min(f.width - side, cx - side / 2)));
  const top = Math.round(Math.max(0, Math.min(f.height - side, cy - side / 2)));
  return { left, top, side, cx, cy, want };
}

/** Cuts the square round the photo's biggest face out of `path` into `out`, HEAD_PX across. */
function cutHead(f: Faces, path: string, out: string): void {
  const { left, top, side } = square(f);
  const tmp = `${out}.tmp.jpg`;
  execFileSync('sips', ['-s', 'format', 'jpeg', '--cropOffset', String(top), String(left), '-c', String(side), String(side), path, '--out', tmp], { stdio: 'ignore' });
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', String(HEAD_PX), tmp, '--out', out], { stdio: 'ignore' });
  rmSync(tmp);
}

/** Every player's best photo, his head cut out of it (see the top of this file). */
async function pickPhotos(again: boolean, only: string[]): Promise<void> {
  const manifest = readManifest();
  const work = new URL('candidates/', DIR);
  mkdirSync(work, { recursive: true });
  // faces.swift built once, and again only when it changes: run as a script it is compiled anew for
  // every player, seconds each, and runs going at once would build over each other.
  const faces = new URL('faces', work).pathname;
  const source = new URL('faces.swift', import.meta.url).pathname;
  if (!existsSync(faces) || statSync(faces).mtimeMs < statSync(source).mtimeMs) execFileSync('swiftc', ['-O', source, '-o', faces], { stdio: 'inherit' });
  const players = SIDES.filter((s) => s.mode === 'players' && (only.length ? only.includes(s.id) : again || !manifest.sides[s.id]?.score));
  const unsure: string[] = [];
  // Each player's own page's picture, forty pages a request.
  const pages = new Map<string, { title: string; thumb?: string; image?: string; ambiguous: boolean }>();
  for (let i = 0; i < players.length; i += 40) {
    const batch = players.slice(i, i + 40);
    const found = await api(batch.map(pageOf));
    for (const side of batch) {
      const page = found.get(pageOf(side));
      if (page && !page.ambiguous) pages.set(side.id, page);
    }
  }
  for (const [n, side] of players.entries()) {
    const candidates: Candidate[] = [];
    const page = pages.get(side.id);
    // A file chosen by hand is the only one rated: the page's picture, or another, lost it before.
    const chosen = PHOTOS[side.id];
    if (page?.thumb && !chosen) {
      const res = await polite(page.thumb);
      if (res.ok) {
        const path = new URL(`${side.id}-page.jpg`, work).pathname;
        writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
        candidates.push({ path, source: page.image ? `https://en.wikipedia.org/wiki/File:${encodeURIComponent(page.image)}` : page.thumb, page: true });
      }
    }
    const found = await commonsPhotos(side, 5, chosen);
    for (const [i, c] of found.entries()) {
      if (!chosen && page?.image && c.title.replace(/^File:/, '').replace(/ /g, '_') === page.image) continue;
      // A photo Commons will not scale just now (429) is skipped after one more try: there are others.
      const res = await polite(c.url, 2);
      if (!res.ok) continue;
      const path = new URL(`${side.id}-${i}.jpg`, work).pathname;
      writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
      candidates.push({ path, source: c.source, page: false });
    }
    if (!candidates.length) {
      unsure.push(`${side.id} (no photo)`);
      continue;
    }
    const rated = execFileSync(faces, candidates.map((c) => c.path), { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Faces);
    let best = -1;
    let score = 0;
    rated.forEach((f, i) => {
      // A file chosen by hand is surely him: his face is only found in it, however small or turned.
      const s = chosen ? handPicked(f) : rate(f, candidates[i].page);
      if (s > score) [best, score] = [i, s];
    });
    if (best < 0) {
      unsure.push(`${side.id} (no clear face in ${candidates.length})`);
      continue;
    }
    const pick = candidates[best];
    const bytes = readFileSync(pick.path);
    const file = `${side.id}.${createHash('sha256').update(bytes).update('head').digest('hex').slice(0, 8)}.jpg`;
    cutHead(rated[best], pick.path, new URL(file, DIR).pathname);
    const picture: Picture = {
      file,
      kind: 'photo',
      page: `https://en.wikipedia.org/wiki/${encodeURIComponent((page?.title ?? pageOf(side)).replace(/ /g, '_'))}`,
      source: pick.source,
      score: Math.round(score * 100) / 100,
      of: candidates.length,
    };
    manifest.sides[side.id] = picture;
    saveEntry(side.id, picture);
    if (score < 0.3 && !chosen) unsure.push(`${side.id} (best only ${score.toFixed(2)})`);
    console.log(`  ${String(n + 1).padStart(3)}/${players.length} ${side.id.padEnd(22)} ${score.toFixed(2)} of ${candidates.length}${pick.page ? ' (his page)' : ''}`);
  }
  const done = readManifest();
  done.version = createHash('sha256').update(JSON.stringify(done.sides)).digest('hex').slice(0, 10);
  writeFileSync(MANIFEST, `${JSON.stringify(done, null, 2)}\n`);
  if (unsure.length) console.log(`\nLook at these, ${unsure.length}:\n  ${unsure.join('\n  ')}`);
}

function upload(remote: boolean): void {
  const manifest = readManifest();
  // Only the pictures the manifest names, and of the photos only those cut round a face (a page's
  // picture from an older fetch is a man running across a pitch): an older pick left in pictures/ is not sent.
  // Nor a side the game no longer has.
  const ids = new Set(SIDES.map((s) => s.id));
  const ready = Object.fromEntries(Object.entries(manifest.sides).filter(([id, p]) => ids.has(id) && (p.kind === 'crest' || p.score)));
  const files = Object.values(ready).map((p) => p.file);
  if (!files.length) {
    console.error('pictures/ is empty: run `npm run pictures -- fetch` and `photos` first.');
    process.exit(1);
  }
  const where = remote ? '--remote' : '--local';
  // `wrangler r2 bulk put` sends a list at once, twenty at a time; one list per type, as the type is one flag for all.
  const byType = new Map<string, string[]>();
  for (const file of files) {
    const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    byType.set(type, [...(byType.get(type) ?? []), file]);
  }
  const list = new URL('.upload.json', DIR);
  for (const [type, group] of byType) {
    writeFileSync(list, JSON.stringify(group.map((file) => ({ key: `sides/${file}`, file: new URL(file, DIR).pathname }))));
    execFileSync('npx', ['wrangler', 'r2', 'bulk', 'put', 'bouncereel', '--filename', list.pathname, '--content-type', type, where, '--force'], { stdio: ['ignore', 'ignore', 'inherit'] });
    console.log(`  ${group.length} ${type}`);
  }
  rmSync(list);
  // The manifest last, naming only what was sent: the studio never lists a picture that is not there.
  const sent = new URL('.manifest.json', DIR);
  writeFileSync(sent, JSON.stringify({ version: manifest.version, sides: ready }));
  execFileSync('npx', ['wrangler', 'r2', 'object', 'put', 'bouncereel/sides/manifest.json', '--file', sent.pathname, '--content-type', 'application/json', where], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  rmSync(sent);
  console.log(`${files.length} pictures and the manifest are in ${remote ? "production's" : 'the local'} bucket, under sides/.`);
}

/** `photos --relaxed`: the second pass for players the first found no clear face for (rate). */
const RELAXED = process.argv.includes('--relaxed');

const [command] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (command === 'fetch') await fetchAll(process.argv.includes('--again'));
else if (command === 'photos') await pickPhotos(process.argv.includes('--again'), (process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? '').split(',').filter(Boolean));
else if (command === 'upload') upload(process.argv.includes('--remote'));
else {
  console.error('Usage: npm run pictures -- fetch [--again] | photos [--again] | upload [--remote]');
  process.exit(1);
}
