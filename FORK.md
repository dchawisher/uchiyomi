# Household fork

Based on Uchiyomi v0.99.0, upstream commit `4863bbf973ebfa0ea43afe606cb257be499f6467`.

## Changes

- Show 18+ in profile settings and quick settings follows account permission, even without adult tags.
  A badge on each profile control replaces the global banner. The mobile profile tab opens quick settings.
- Double-page pairing offset is a configurable reader action, defaulting to `p` in paged mode.
- New extensions enable one source by default: English, then a language-neutral/main source, then the
  first available source. Hidden languages are excluded. Explicit Languages → Show choices add defaults
  for future installs; individual source switches remain exceptions. Extension updates preserve switches.
- New series default to fetching the first ten chapters. Discover opens details first, including the full
  synopsis, before offering library/download options. Opening details does not add or download the series.
- Ratings accept half-star steps from 0.5 to 5, including API validation and database constraints.

The additional-source search algorithm and chapter/volume data model are unchanged, pending design discussion.

## Build

`Dockerfile.fork` builds the backend and static frontend against the exact deployed upstream base image.
It preserves that image's embedded PostgreSQL, engine, entrypoint, users, and volume layout.

```sh
docker build -f Dockerfile.fork -t local/uchiyomi-fork:household-v1 .
```

The added migration converts rating storage to floating point with a half-step constraint and adds
`server_settings.enabled_langs`. It preserves existing ratings, source switches, and hidden-language settings.

## NAS rollout

The Compose project is `/volume1/apps/media/uchiyomi`. Before changing its Uchiyomi image, save the Compose
file, config directory, and a custom-format PostgreSQL dump; tag the current image for rollback. Change
only the Uchiyomi service's image and recreate only that service with `docker compose up -d --no-deps uchiyomi`.
Keep Suwayomi, FlareSolverr, mounted libraries, and all existing environment settings intact.

For rollback, restore the saved Compose file (using the saved immutable image/tag) and recreate Uchiyomi.
Keep the database backup for recovery; do not restore it casually because doing so discards subsequent changes.

## Validation

- Isolated PostgreSQL integration tests cover account permissions with no adult tags, all half-star values,
  invalid values, migration reruns, default languages, per-source exceptions, and extension updates.
- Frontend tests cover the badge, new-series defaults, reader binding/rebinding, ratings, and existing UI contracts.
- A disposable NAS instance with generated books and a fake source was browser-tested on desktop and mobile.
  It exercised the profile toggle/badge, details without writes, first-ten selection, saved half-stars,
  and persistent spread offset. Production library content was not used for these tests.
