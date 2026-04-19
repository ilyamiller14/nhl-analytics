import { Link } from 'react-router-dom';

interface BaseEntry {
  id: number | string;
  primary: string;
  secondary?: string;
  value: string | number;
  valueSuffix: string;
  href: string;
}

interface HomeLeadersListProps {
  title: string;
  entries: BaseEntry[];
  footerHref?: string;
  footerLabel?: string;
}

/**
 * Three leader lists stacked side-by-side on the Home page (Points,
 * Goalie wins, Standings) were open-coded with duplicate inline
 * styles. This component collapses them to a single responsive
 * list of ranked, clickable rows.
 */
export default function HomeLeadersList({
  title,
  entries,
  footerHref,
  footerLabel,
}: HomeLeadersListProps) {
  return (
    <div>
      <h2 className="home-leaders-title">{title}</h2>
      <div className="home-leader-list">
        {entries.map((entry, i) => (
          <Link key={entry.id} to={entry.href} className="home-leader-row">
            <span>
              <strong>{i + 1}.</strong> {entry.primary}
              {entry.secondary && (
                <span className="home-leader-team"> ({entry.secondary})</span>
              )}
            </span>
            <strong>
              {entry.value} {entry.valueSuffix}
            </strong>
          </Link>
        ))}
      </div>
      {footerHref && footerLabel && (
        <Link to={footerHref} className="home-leader-more">
          {footerLabel}
        </Link>
      )}
    </div>
  );
}
