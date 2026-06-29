/**
 * Holding content for a mode/section whose real interface is a later craft pass.
 * Shown only in the live state; the default no-feed state is the fully-built one.
 * Honest about being scaffold rather than faking data.
 */
export function ModePlaceholder({
  kicker,
  title,
  lead,
  items,
}: {
  kicker: string;
  title: string;
  lead: string;
  items: string[];
}) {
  return (
    <div className="placeholder">
      <p className="placeholder-kicker">{kicker}</p>
      <h2 className="placeholder-title">{title}</h2>
      <p className="placeholder-lead">{lead}</p>
      <ul className="placeholder-list">
        {items.map((it) => (
          <li key={it} className="placeholder-chip">
            {it}
          </li>
        ))}
      </ul>
      <p className="placeholder-note">
        Built next with <span className="mono">/impeccable craft</span>.
      </p>
    </div>
  );
}
