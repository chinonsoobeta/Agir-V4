# Address and building search

Set `GOOGLE_MAPS_API_KEY` on the Agir server to enable Google Places address and
building-name search. Restrict the key to the Places API and the production
server environment. The key is never returned to the browser.

Production does not send address queries to another provider when Google is
missing or unavailable. Users can always type an address manually. An operator
may set `ADDRESS_SEARCH_OPENSTREETMAP_FALLBACK=1` only after approving the
fallback provider's privacy, licensing, and data-processing terms. Local
development enables the labelled fallback unless it is explicitly disabled.

Search results provide a location suggestion only. The selected municipality
must still be confirmed, unit/suite is stored separately in `address_line_2`,
and neither zoning nor Permit applicability is inferred from the result.
