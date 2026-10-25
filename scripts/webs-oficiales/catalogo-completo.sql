select json_agg(json_build_object(
  'id', a.id,
  'name', a.name,
  'aliases', coalesce((select json_agg(al.alias) from ingest.artist_aliases al where al.artist_id = a.id), '[]'::json),
  'biography', a.biography,
  'origin_country', coalesce(a.origin_country, 'Venezuela'),
  'albums', coalesce((select json_agg(json_build_object('id', d.id, 'title', d.title)) from public.albums d where d.artist_id = a.id), '[]'::json),
  'streaming', coalesce((select json_agg(json_build_object('platform', l.platform, 'url', l.url, 'verified', l.verified))
                         from public.social_links l where l.artist_id = a.id
                         and l.platform in ('spotify','apple','deezer','youtube','bandcamp','soundcloud','tidal')), '[]'::json),
  'socials', coalesce((select json_agg(json_build_object('platform', l.platform, 'url', l.url, 'verified', l.verified))
                       from public.social_links l where l.artist_id = a.id
                       and l.platform not in ('spotify','apple','deezer','youtube','bandcamp','soundcloud','tidal')), '[]'::json)
))
from public.artists a;
