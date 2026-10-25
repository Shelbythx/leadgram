export const UTM_PARAMETERS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

export type UtmParameters = Partial<Record<(typeof UTM_PARAMETERS)[number], string>>;

export function parseWebUrl(value: string | undefined): URL | undefined {
  if (!value || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
}

export function utmParameters(page: URL | undefined): UtmParameters {
  const utm: UtmParameters = {};
  for (const name of UTM_PARAMETERS) {
    const value = page?.searchParams.get(`utm_${name}`);
    if (value) utm[name] = value;
  }
  return utm;
}
