/**
 * Apollo.io REST API client.
 * Endpoints:
 *   POST /api/v1/mixed_people/api_search — search people (obfuscated results)
 *   POST /api/v1/people/match — enrich a single person (full data, consumes 1 credit)
 */

const APOLLO_BASE_URL = 'https://api.apollo.io/api/v1';

export interface ApolloSearchParams {
  personTitles?: string[];
  personLocations?: string[];
  organizationLocations?: string[];
  organizationKeywords?: string[];
  organizationDomains?: string[];
  employeeRanges?: string[];
  personSeniorities?: string[];
  contactEmailStatus?: string[];
  technologyUids?: string[];
  organizationIndustryTagIds?: string[];
  revenueRange?: { min?: number; max?: number };
  includeSimilarTitles?: boolean;
  qKeywords?: string;
  page?: number;
  perPage?: number;
}

// Search returns obfuscated data (last_name_obfuscated, no email, boolean flags)
export interface ApolloSearchOrganization {
  name: string;
  has_industry: boolean;
  has_phone: boolean;
  has_city: boolean;
  has_state: boolean;
  has_country: boolean;
  has_employee_count: boolean;
}

export interface ApolloSearchPerson {
  id: string;
  first_name: string | null;
  last_name_obfuscated: string | null;
  title: string | null;
  has_email: boolean;
  has_city: boolean;
  has_state: boolean;
  has_country: boolean;
  seniority?: string | null;
  has_direct_phone: string | null;
  organization: ApolloSearchOrganization | null;
}

// Enrichment returns full data
export interface ApolloOrganization {
  name: string;
  website_url: string | null;
  primary_domain: string | null;
  industry: string | null;
  estimated_num_employees: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

export interface ApolloPhoneNumber {
  raw_number: string;
  type: string;
}

export interface ApolloPersonFull {
  id: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  title: string | null;
  headline: string | null;
  linkedin_url: string | null;
  organization: ApolloOrganization | null;
  city: string | null;
  state: string | null;
  country: string | null;
  email: string | null;
  sanitized_phone: string | null;
  phone_numbers: ApolloPhoneNumber[] | null;
}

export interface ApolloSearchResult {
  people: ApolloSearchPerson[];
  totalEntries: number;
  page: number;
}

async function apolloFetch<T>(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
  queryParams?: Record<string, string>,
): Promise<T> {
  let url = `${APOLLO_BASE_URL}${path}`;
  if (queryParams && Object.keys(queryParams).length > 0) {
    const qs = new URLSearchParams(queryParams).toString();
    url = `${url}?${qs}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Apollo API ${response.status}: ${text.slice(0, 200)}`);
  }

  return response.json() as Promise<T>;
}

export async function searchPeople(apiKey: string, params: ApolloSearchParams): Promise<ApolloSearchResult> {
  const body: Record<string, unknown> = {
    page: params.page ?? 1,
    per_page: params.perPage ?? 25,
  };

  if (params.personTitles?.length) body.person_titles = params.personTitles;
  if (params.personLocations?.length) body.person_locations = params.personLocations;
  if (params.organizationLocations?.length) body.organization_locations = params.organizationLocations;
  if (params.organizationKeywords?.length) body.q_organization_keyword_tags = params.organizationKeywords;
  if (params.organizationDomains?.length) body.q_organization_domains_list = params.organizationDomains;
  if (params.employeeRanges?.length) body.organization_num_employees_ranges = params.employeeRanges;
  if (params.personSeniorities?.length) body.person_seniorities = params.personSeniorities;
  if (params.contactEmailStatus?.length) body.contact_email_status = params.contactEmailStatus;
  if (params.technologyUids?.length) body.currently_using_any_of_technology_uids = params.technologyUids;
  if (params.organizationIndustryTagIds?.length) body.organization_industry_tag_ids = params.organizationIndustryTagIds;
  if (params.revenueRange) body.revenue_range = params.revenueRange;
  if (params.includeSimilarTitles !== undefined) body.include_similar_titles = params.includeSimilarTitles;
  if (params.qKeywords) body.q_keywords = params.qKeywords;

  const data = await apolloFetch<{
    people: ApolloSearchPerson[];
    total_entries: number;
  }>(apiKey, '/mixed_people/api_search', body);

  return {
    people: data.people ?? [],
    totalEntries: data.total_entries ?? 0,
    page: params.page ?? 1,
  };
}

export async function enrichPerson(
  apiKey: string,
  params: { id?: string; firstName?: string; lastName?: string; domain?: string; linkedinUrl?: string; webhookUrl?: string },
): Promise<{ person: ApolloPersonFull | null }> {
  const body: Record<string, unknown> = {};

  if (params.id) body.id = params.id;
  if (params.firstName) body.first_name = params.firstName;
  if (params.lastName) body.last_name = params.lastName;
  if (params.domain) body.domain = params.domain;
  if (params.linkedinUrl) body.linkedin_url = params.linkedinUrl;

  // reveal_phone_number and webhook_url must be QUERY PARAMS per Apollo docs
  const queryParams: Record<string, string> = {
    reveal_phone_number: 'true',
  };
  if (params.webhookUrl) {
    queryParams.webhook_url = params.webhookUrl;
  }

  const data = await apolloFetch<Record<string, unknown>>(apiKey, '/people/match', body, queryParams);

  // Log raw response keys at top level
  console.warn(`[apollo-enrich] RAW top-level keys: ${Object.keys(data).join(', ')}`);

  const p = (data.person ?? data.match ?? data.contact) as ApolloPersonFull | null;
  if (p) {
    console.warn(
      `[apollo-enrich] ${p.first_name} ${p.last_name} | phone_numbers: ${JSON.stringify(p.phone_numbers)} | sanitized_phone: ${p.sanitized_phone}`,
    );
  }

  return { person: p ?? null };
}
