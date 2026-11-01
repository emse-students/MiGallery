/**
 * Trombinoscope PDF (`src/lib/trombi-pdf.ts`, `src/lib/pdf/*`): pagination, the sheet's markup,
 * member order, escaping, and the line grouping of the searchable raster.
 *
 * Pure functions, no browser: only what takes strings and numbers is tested here.
 */

import { describe, it, expect } from 'vitest';
import {
  TROMBI_GEOMETRY as G,
  buildTrombiHtml,
  cellWidth,
  initialsOf,
  layoutTrombi,
  rowHeight,
  sortMembers,
  tileHtml,
  tileStyle,
  type TrombiMember,
  type TrombiTexts,
} from '#lib/trombi-pdf.ts';
import { escapeHtmlAttribute } from '#lib/escape-html.ts';
import { groupCharsIntoLines } from '#lib/pdf/searchable-raster.ts';
import { pickAppFont } from '#lib/pdf/app-fonts.ts';

const texts: TrombiTexts = {
  title: 'Trombinoscope',
  subtitle: '3 membres',
  date: '1 novembre 2026',
  page: (p, t) => `Page ${p} / ${t}`,
  count: (n) => `${n} membres`,
};

const member = (over: Partial<TrombiMember> = {}): TrombiMember => ({
  id: 'u1',
  name: 'Manon TEISSIER',
  firstName: 'Manon',
  lastName: 'TEISSIER',
  image: null,
  ...over,
});

describe('tiles: one shape for every member', () => {
  const photo = tileHtml(member({ image: 'data:image/jpeg;base64,AAAA' }));
  const initials = tileHtml(member({ image: null }));
  const frame = (html: string) => html.match(/data-trombi-tile style="([^"]*)"/)?.[1];

  it('gives a photo and the initials the same frame: same size, same radius', () => {
    expect(frame(photo)).toBe(tileStyle());
    expect(frame(initials)).toBe(tileStyle());
    expect(tileStyle()).toContain(`width:${G.tileSize}px;height:${G.tileSize}px`);
    expect(tileStyle()).toContain(`border-radius:${G.tileRadius}px`);
    expect(tileStyle()).toContain('overflow:hidden');
  });

  it('draws the photo inside the frame, covering it, with no radius of its own', () => {
    expect(photo).toContain('object-fit:cover');
    expect(photo).not.toMatch(/<img[^>]*border-radius/);
  });

  it('has ONE fallback, the initials, and no <img> for a member without a photo', () => {
    expect(initials).not.toContain('<img');
    expect(initials).toContain('MT');
    expect(initials).toContain('display:flex');
    // With a photo the initials wait behind it, for the failed-load case.
    expect(photo).toContain('display:none');
  });

  it('uses a single tile frame across a whole sheet', () => {
    const { html } = buildTrombiHtml(
      [
        {
          label: 'P',
          members: [
            member({ image: 'data:image/jpeg;base64,AAAA' }),
            member({ id: 'u2', image: null }),
            member({ id: 'u3', image: 'data:image/jpeg;base64,BBBB' }),
          ],
        },
      ],
      texts
    );
    const frames = [...html.matchAll(/data-trombi-tile style="([^"]*)"/g)].map((m) => m[1]);
    expect(frames).toHaveLength(3);
    expect(new Set(frames).size).toBe(1);
  });
});

describe('escaping', () => {
  it('escapes names, labels and image sources in the sheet', () => {
    const evil = '"><img src=x onerror=alert(1)>';
    const { html } = buildTrombiHtml(
      [
        {
          label: evil,
          members: [member({ firstName: evil, lastName: '<b>', name: evil, image: evil })],
        },
      ],
      { ...texts, title: evil }
    );
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>');
    expect(html).toContain(escapeHtmlAttribute(evil));
  });

  it('escapes every special character', () => {
    expect(escapeHtmlAttribute('&<>"\'`')).toBe('&amp;&lt;&gt;&quot;&#39;&#96;');
  });
});

describe('sortMembers', () => {
  const m = (firstName: string, lastName: string) =>
    member({ id: firstName + lastName, name: `${firstName} ${lastName}`, firstName, lastName });
  const order = (xs: TrombiMember[]) => sortMembers(xs).map((x) => `${x.firstName} ${x.lastName}`);

  it('sorts by last name, then first name', () => {
    expect(order([m('Zoe', 'DURAND'), m('Alice', 'DURAND'), m('Paul', 'ABADIE')])).toEqual([
      'Paul ABADIE',
      'Alice DURAND',
      'Zoe DURAND',
    ]);
  });

  it('ignores case and accents: an accented initial sorts with its base letter', () => {
    expect(
      order([m('Anne', 'FABRE'), m('Elodie', 'ÉLOY'), m('Luc', 'EMERY'), m('Zoe', 'DUPONT')])
    ).toEqual(['Zoe DUPONT', 'Elodie ÉLOY', 'Luc EMERY', 'Anne FABRE']);
    expect(order([m('b', 'martin'), m('a', 'Martin')])).toEqual(['a Martin', 'b martin']);
  });

  it('sorts compound last names on the whole string as stored', () => {
    expect(
      order([
        m('Ana', 'MARTIN--CHAN-YAT-TSEUNG'),
        m('Bo', 'LE GRAËT'),
        m('Cy', 'CHALARD-LE GRAËT'),
        m('Di', 'LEBLANC'),
        m('Ed', 'MARTIN'),
      ])
    ).toEqual([
      'Cy CHALARD-LE GRAËT',
      'Bo LE GRAËT',
      'Di LEBLANC',
      'Ed MARTIN',
      'Ana MARTIN--CHAN-YAT-TSEUNG',
    ]);
  });

  it('does not split the display name, and does not mutate its input', () => {
    const noLast = [
      member({ id: 'a', name: 'Zed', firstName: null, lastName: null }),
      m('Al', 'BERT'),
    ];
    expect(sortMembers(noLast).map((x) => x.id)).toEqual([m('Al', 'BERT').id, 'a']);
    expect(noLast[0].id).toBe('a');
  });
});

describe('layoutTrombi', () => {
  const bottom = G.pageHeight - G.margin - G.footerHeight;
  const sections = [
    { label: 'Promo 2027', count: 23 },
    { label: 'Promo 2026', count: 31 },
    { label: 'Staff', count: 3 },
  ];
  const placed = layoutTrombi(sections);

  it('places every member once, on the columns of the fixed grid', () => {
    const cells = placed.filter((p) => p.kind === 'cell');
    expect(cells).toHaveLength(57);
    for (const c of cells) {
      if (c.kind !== 'cell') continue;
      const col = Math.round((c.x - G.margin) / cellWidth());
      expect(c.x).toBeCloseTo(G.margin + col * cellWidth());
      expect(col).toBeLessThan(G.columns);
    }
  });

  it('never lets a row run past the bottom margin', () => {
    for (const p of placed) {
      const h = p.kind === 'cell' ? rowHeight() : G.bandHeight;
      expect(p.y + h).toBeLessThanOrEqual(bottom + 1e-9);
    }
  });

  it('keeps a band on the page of its first row', () => {
    for (const b of placed.filter((p) => p.kind === 'band')) {
      const first = placed.find(
        (p) => p.kind === 'cell' && p.section === b.section && p.member === 0
      );
      expect(first?.page).toBe(b.page);
    }
  });

  it('moves a band to a new page when no row would fit under it', () => {
    const top = G.margin + G.headerHeight;
    const rows = Math.floor((bottom - top - G.bandHeight - G.bandGap) / rowHeight());
    const out = layoutTrombi([
      { label: 'A', count: rows * G.columns },
      { label: 'B', count: 1 },
    ]);
    const bandB = out.find((p) => p.kind === 'band' && p.section === 1);
    const cellB = out.find((p) => p.kind === 'cell' && p.section === 1);
    expect(bandB?.page).toBe(cellB?.page);
    expect(bandB?.page).toBe(2);
  });

  it('skips an empty section', () => {
    expect(layoutTrombi([{ label: 'x', count: 0 }])).toEqual([]);
  });

  it('builds one fixed-size page per laid out page', () => {
    const { pages, html } = buildTrombiHtml(
      sections.map((s) => ({
        label: s.label,
        members: Array.from({ length: s.count }, (_, i) => member({ id: `${s.label}${i}` })),
      })),
      texts
    );
    expect(pages).toBe(Math.max(...placed.map((p) => p.page)));
    expect((html.match(/data-trombi-page/g) ?? []).length).toBe(pages);
    expect(html).toContain(`Page ${pages} / ${pages}`);
  });
});

describe('initialsOf', () => {
  it('reads first and last name, like the app avatar', () => {
    expect(initialsOf('manon', 'teissier', 'x')).toBe('MT');
    expect(initialsOf(null, null, 'Serigne Mahmoudane Mbacke TOURE')).toBe('ST');
    expect(initialsOf(null, null, 'Solo')).toBe('SO');
    expect(initialsOf(null, null, '')).toBe('?');
  });
});

describe('searchable raster', () => {
  const box = (top: number, left: number, right: number) => ({ top, left, right, height: 14 });

  it('groups characters into the lines the browser laid out, trimming the wrap space', () => {
    const chars = [
      ...'Serigne'.split('').map((ch, i) => ({ ch, rect: box(0, i * 6, i * 6 + 6) })),
      { ch: ' ', rect: null },
      ...'TOURE'.split('').map((ch, i) => ({ ch, rect: box(16, 20 + i * 6, 26 + i * 6) })),
    ];
    const lines = groupCharsIntoLines(chars);
    expect(lines.map((l) => l.text)).toEqual(['Serigne', 'TOURE']);
    expect(lines[1].left).toBe(20);
  });

  it('picks the app font from the first family of the stack that is embedded', () => {
    expect(pickAppFont("'Space Grotesk', 'Inter', sans-serif", 700)).toEqual({
      name: 'SpaceGrotesk',
      style: 'bold',
    });
    expect(pickAppFont('Inter, system-ui', 600)).toEqual({ name: 'Inter', style: 'bold' });
    expect(pickAppFont('"Inter", sans-serif', 400)).toEqual({ name: 'Inter', style: 'normal' });
    expect(pickAppFont('Arial', 400)).toBeNull();
  });
});
