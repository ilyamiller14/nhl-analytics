import './Glossary.css';

interface Term {
  abbr: string;
  name: string;
  definition: string;
}

const SECTIONS: Array<{ title: string; terms: Term[] }> = [
  {
    title: 'Scoring & Efficiency',
    terms: [
      { abbr: 'G',   name: 'Goals',                   definition: 'Goals scored by the player.' },
      { abbr: 'A',   name: 'Assists',                 definition: 'Primary or secondary assist on a teammate\u2019s goal.' },
      { abbr: 'P',   name: 'Points',                  definition: 'Goals + Assists.' },
      { abbr: 'SH%', name: 'Shooting Percentage',     definition: 'Goals divided by shots on net. League average for skaters is roughly 9%.' },
      { abbr: 'Sv%', name: 'Save Percentage',         definition: 'Saves divided by shots faced. Above .915 is starter-tier in the modern era.' },
    ],
  },
  {
    title: 'Shot Quality',
    terms: [
      { abbr: 'xG',   name: 'Expected Goals',  definition: 'Predicted goal value of every shot a player takes, summed over the season. Based on distance, angle, shot type, and rebound state.' },
      { abbr: 'ixG',  name: 'Individual xG',   definition: 'xG credited only to the shooter, excluding deflections and tips by teammates.' },
      { abbr: 'GSAx', name: 'Goals Saved Above Expected', definition: 'Goalie metric: actual saves minus the expected saves a league-average goalie would have made given the same shot quality.' },
      { abbr: 'HD',   name: 'High-Danger',     definition: 'Shots taken from inside the slot and within 25 feet of the net \u2014 the most likely to become goals.' },
    ],
  },
  {
    title: 'Possession (Fancy Stats)',
    terms: [
      { abbr: 'CF%',    name: 'Corsi For %',        definition: 'Share of shot attempts (on-goal, missed, and blocked) taken by your team while you\u2019re on the ice at 5v5.' },
      { abbr: 'FF%',    name: 'Fenwick For %',      definition: 'Like Corsi, but excludes blocked shots \u2014 a cleaner proxy for shot-quality territory.' },
      { abbr: 'PDO',    name: 'PDO',                definition: 'On-ice shooting% + on-ice save%. Trends toward 100 over time \u2014 values far from 100 usually indicate unsustainable luck.' },
      { abbr: 'xGF%',   name: 'Expected Goals For %', definition: 'Team share of expected goals while the player is on the ice.' },
    ],
  },
  {
    title: 'Player Value',
    terms: [
      { abbr: 'WAR',    name: 'Wins Above Replacement', definition: 'Total wins a player contributed above what a freely-available AHL call-up would have provided in the same role.' },
      { abbr: 'GAR',    name: 'Goals Above Replacement', definition: 'Like WAR, but expressed in goals rather than wins. Roughly: 1 WAR \u2248 6 GAR.' },
      { abbr: 'SV',     name: 'Surplus Value',      definition: 'Estimated on-ice production value minus contract cap hit. Positive = outperforming contract.' },
    ],
  },
  {
    title: 'NHL EDGE Tracking (2023\u201324+)',
    terms: [
      { abbr: 'Top Speed',  name: 'Top Skating Speed',   definition: 'Peak skating speed recorded by optical tracking (mph).' },
      { abbr: 'Bursts',     name: 'Speed Bursts',        definition: 'Count of skating sprints above a threshold speed \u2014 proxy for pace and urgency.' },
      { abbr: 'Zone Time',  name: 'Offensive Zone Time', definition: 'Share of ice time the player spent in the offensive zone.' },
      { abbr: 'Shot Speed', name: 'Peak Shot Velocity',  definition: 'Fastest shot (mph). Tracked only for skaters.' },
    ],
  },
];

export default function Glossary() {
  return (
    <div className="glossary-page page-container">
      <header className="glossary-header">
        <h1>Stats Glossary</h1>
        <p className="glossary-subtitle">
          Every acronym you\u2019ll see on the site, explained in plain English.
        </p>
      </header>

      {SECTIONS.map((section) => (
        <section key={section.title} className="glossary-section">
          <h2 className="glossary-section__title">{section.title}</h2>
          <dl className="glossary-list">
            {section.terms.map((term) => (
              <div key={term.abbr} className="glossary-entry">
                <dt className="glossary-term">
                  <span className="glossary-abbr">{term.abbr}</span>
                  <span className="glossary-name">{term.name}</span>
                </dt>
                <dd className="glossary-def">{term.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
