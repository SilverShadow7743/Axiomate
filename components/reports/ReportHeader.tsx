import { useState } from 'react'
import type { OrganizationIdentity } from '@/lib/config'

/**
 * The one branded header every report surface shares — the client packs, the finance report,
 * and (as a plain text line, not this component) the daily IMS. Firm name and short name from
 * `OrganizationIdentity`, the report's own title and period, the generated date, and the logo
 * when one is configured. Absent logo means clean wordmark styling; a logo that fails to load
 * hides itself rather than rendering broken — the header always renders, the image only
 * sometimes.
 */
export default function ReportHeader({
  org,
  title,
  period,
  generated,
}: {
  org: OrganizationIdentity
  title: string
  period?: string
  generated: string
}) {
  const [logoBroken, setLogoBroken] = useState(false)
  const showLogo = Boolean(org.logoDataUri) && !logoBroken

  return (
    <header className="report-header">
      <div className="report-header-brand">
        {showLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="report-header-logo"
            src={org.logoDataUri}
            alt={`${org.name} logo`}
            onError={() => setLogoBroken(true)}
          />
        ) : null}
        <div>
          <div className="report-header-firm">{org.name}</div>
          {org.shortName && org.shortName !== org.name ? (
            <div className="report-header-short">{org.shortName}</div>
          ) : null}
        </div>
      </div>
      <div className="report-header-title">
        <div>{title}</div>
        {period ? <div className="report-header-period">{period}</div> : null}
        <div className="report-header-generated">Generated {generated}</div>
      </div>
    </header>
  )
}
