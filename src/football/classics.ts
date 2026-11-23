import { derbies, type Mode } from './teams.ts';

// Goal Rush's classic matches, picked whole from the studio's "Classic matches" list, as the race
// has its classics: the derbies, Europe's great nights, Red Star and Partizan against Europe's
// giants, the GOAT debates, today's rivals, then and now. Each is a pair of ids from teams.ts, home
// first; the list shows beside each how many times the account has made it and who won how many
// (the studio counts them from its library).

export interface Classic {
  mode: Mode;
  home: string;
  away: string;
}

export interface ClassicGroup {
  label: string;
  matches: Classic[];
}

const clubs = (pairs: string): Classic[] => pairs.split(',').map((pair) => {
  const [home, away] = pair.trim().split(/\s+/);
  return { mode: 'clubs', home, away };
});

const players = (pairs: string): Classic[] => pairs.split(',').map((pair) => {
  const [home, away] = pair.trim().split(/\s+/);
  return { mode: 'players', home, away };
});

export const CLASSICS: ClassicGroup[] = [
  { label: 'Derbies', matches: derbies('clubs').map(([home, away]) => ({ mode: 'clubs' as const, home, away })) },
  {
    label: "Europe's great nights",
    matches: clubs(`real-madrid bayern, real-madrid liverpool, real-madrid man-city, real-madrid juventus, real-madrid psg, real-madrid dortmund,
      barcelona bayern, barcelona psg, barcelona chelsea, barcelona inter, barcelona juventus, barcelona man-united, barcelona liverpool, barcelona milan,
      bayern psg, bayern liverpool, bayern arsenal, bayern chelsea, bayern inter, man-city inter, man-city psg, man-city real-madrid,
      liverpool milan, liverpool tottenham, inter psg, arsenal psg, juventus atletico, atletico chelsea, ajax real-madrid, porto chelsea, benfica barcelona, milan ajax`),
  },
  {
    label: 'The big leagues',
    matches: clubs(`man-city liverpool, liverpool arsenal, arsenal chelsea, chelsea tottenham, man-united arsenal, man-united chelsea, man-city arsenal, newcastle sunderland,
      atletico barcelona, real-madrid sevilla, juventus napoli, inter napoli, milan napoli, roma juventus, bayern leverkusen, dortmund leipzig, psg monaco, marseille lyon`),
  },
  {
    label: 'Serbia and the Balkans',
    matches: clubs(`crvena-zvezda partizan, crvena-zvezda dinamo-zagreb, partizan hajduk, crvena-zvezda hajduk, partizan dinamo-zagreb, crvena-zvezda vojvodina, partizan vojvodina,
      crvena-zvezda bayern, crvena-zvezda marseille, crvena-zvezda real-madrid, partizan real-madrid, crvena-zvezda barcelona, crvena-zvezda milan, crvena-zvezda liverpool,
      crvena-zvezda psg, partizan man-united, crvena-zvezda celtic, partizan benfica`),
  },
  { label: 'South America and beyond', matches: clubs('boca river, flamengo palmeiras, corinthians sao-paulo, boca flamengo, river flamengo, al-nassr inter-miami, al-hilal real-madrid, inter-miami la-galaxy') },
  {
    label: 'The GOAT debate',
    matches: players(`messi cristiano-ronaldo, pele maradona, messi maradona, cristiano-ronaldo ronaldo-nazario, messi pele, maradona cristiano-ronaldo,
      zidane ronaldinho, cruyff beckenbauer, di-stefano puskas, messi zidane, cristiano-ronaldo pele, messi ronaldo-nazario`),
  },
  {
    label: "Today's rivals",
    matches: players(`mbappe haaland, yamal mbappe, vinicius yamal, kane haaland, bellingham musiala, salah mbappe, lewandowski haaland, kvaratskhelia yamal,
      neymar vinicius, rodri bellingham, de-bruyne modric, saka foden, palmer bellingham, odegaard de-bruyne, van-dijk haaland, yamal musiala, wirtz musiala,
      dembele yamal, raphinha vinicius, isak gyokeres, lautaro kane, olise doue`),
  },
  {
    label: 'Then and now',
    matches: players(`yamal messi, cristiano-ronaldo eusebio, mbappe zidane, yamal iniesta, kane shearer, haaland ibrahimovic, vinicius ronaldinho, bellingham gerrard,
      modric boban, haaland ronaldo-nazario, mbappe henry, salah drogba, pedri xavi, rodri busquets, van-dijk maldini, courtois buffon, neymar romario`),
  },
  {
    label: 'Legends',
    matches: players(`maldini ronaldo-nazario, henry bergkamp, gerrard lampard, xavi iniesta, buffon casillas, beckham figo, totti del-piero, kaka ronaldinho, drogba etoo,
      cruyff van-basten, baggio maradona, pele eusebio, george-best bobby-charlton, cantona keane, zidane figo, roberto-carlos cafu, rooney ronaldo-nazario,
      gullit van-basten, puyol pique, nesta maldini, schmeichel kahn, shevchenko kaka, raul figo, matthaus maradona, rummenigge platini`),
  },
  {
    label: 'Serbia and the Balkans, players',
    matches: players(`vlahovic mitrovic, stojkovic savicevic, stankovic modric, tadic modric, dzeko vlahovic, milinkovic-savic modric, suker pancev, jovetic vlahovic,
      vidic ivanovic, dzajic stojkovic, mijatovic suker, mihajlovic boban, kezman milosevic, kostic perisic, oblak livakovic, sesko vlahovic`),
  },
];

/** Every classic of `mode`, in the list's order. */
export function classicsOf(mode: Mode): ClassicGroup[] {
  return CLASSICS.map((g) => ({ label: g.label, matches: g.matches.filter((m) => m.mode === mode) })).filter((g) => g.matches.length);
}

/** One key for a pair, whichever is home: Real Madrid–Barcelona and Barcelona–Real Madrid are one match to count. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
