import React from 'react';
import { Badge } from '../ds/Badge.jsx';
import { PageHeader, StatusBadge, Tag, SectionHeading } from '../chrome/Parts';
import { CopyValue } from '../ds/CopyValue.jsx';
import { ElementTable, elementViews, ResolveType } from './ElementTable';
import { Tabs } from '../chrome/Tabs';
import type { ResourceRow } from '../core/db';

export interface ProfileRequirement {
  key: string;
  severity?: string;
  human?: string;
  expression?: string;
}

export interface ProfileExampleUse {
  title: string;
  href: string;
  count: number;
  direct: boolean;
  resourceTypes: string[];
}

function ProfileRequirements({ requirements }: { requirements: ProfileRequirement[] }) {
  if (!requirements.length) return null;
  return (
    <section className="art-section" id="requirements">
      <SectionHeading id="requirements">Profile requirements</SectionHeading>
      <div className="constraint-list">
        {requirements.map((c) => (
          <div className="constraint-card" key={c.key}>
            <div className="constraint-head">
              <code>{c.key}</code>
              {c.severity && <Badge tone="menstrual" variant="soft">{c.severity}</Badge>}
            </div>
            {c.human && <p>{c.human}</p>}
            {c.expression && <CopyValue value={c.expression} label={`${c.key} FHIRPath expression`} />}
          </div>
        ))}
      </div>
    </section>
  );
}

function ProfileExamples({ examples }: { examples: ProfileExampleUse[] }) {
  if (!examples.length) return null;
  return (
    <section className="art-section" id="examples">
      <SectionHeading id="examples">Examples using this profile</SectionHeading>
      <div className="profile-example-list">
        {examples.map((e) => (
          <a className="profile-example" href={e.href} key={e.href}>
            <span>
              <strong>{e.title}</strong>
              <span>{e.direct ? 'Direct profile use' : 'Use through derived profiles'}</span>
            </span>
            <span>{e.count.toLocaleString()} {e.count === 1 ? 'resource' : 'resources'}</span>
            <span>{e.resourceTypes.join(', ')}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

export function ProfilePage({
  r, data, resolve, requirements = [], examples = [],
}: {
  r: ResourceRow;
  data: any;
  resolve: ResolveType;
  requirements?: ProfileRequirement[];
  examples?: ProfileExampleUse[];
}) {
  const rootType = r.sdType || data.type;
  const baseName = r.base ? (r.base.split('/').pop() || r.base) : rootType;
  return (
    <>
      <PageHeader
        eyebrow={`Profile · ${rootType}`}
        title={r.Title || r.Name || r.Id}
        badges={<><StatusBadge status={r.Status} /><Badge tone="neutral" variant="outline">{r.derivation === 'constraint' ? 'Constraint' : r.derivation || 'Profile'}</Badge></>}
        lead={r.Description}
        meta={[
          ['Official URL', <CopyValue value={r.Url} label="official URL" />],
          ['Computable', <CopyValue value={r.Name} label="computable name" />],
          ['Status', `${r.Status} · v${r.Version}`],
          ['Base', <Tag tone="luteal" href={resolve(rootType!, r.base)}>{baseName}</Tag>],
        ]}
      />
      <ProfileRequirements requirements={requirements} />
      <ProfileExamples examples={examples} />

      <section className="art-section" id="elements">
        <div className="eyebrow" style={{ color: 'var(--ovulatory-deep)' }}>Formal content</div>
        <SectionHeading id="elements">Formal definition</SectionHeading>
        {(() => {
          const v = elementViews(data.snapshot?.element, data.differential?.element, rootType);
          return (
            <Tabs id="elements" tabs={[
              { label: `Key elements (${v.key.length})`, content: <ElementTable elements={v.key} resolve={resolve} /> },
              { label: `Differential (${v.differential.length})`, content: <ElementTable elements={v.differential} resolve={resolve} /> },
              { label: `Snapshot (${v.snapshot.length})`, content: <ElementTable elements={v.snapshot} resolve={resolve} /> },
            ]} />
          );
        })()}
        <p className="flag-legend">
          Flags — <strong>S</strong> Must Support · <strong>?!</strong> Modifier · <strong>Σ</strong> In summary. Required elements (min&nbsp;≥&nbsp;1) shown in coral. <strong>Key elements</strong> = what this profile constrains; <strong>Snapshot</strong> = the full resolved structure.
        </p>
      </section>
    </>
  );
}
