/** Una colección con entregas sin número conserva el orden cronológico documentado. */
export function seriesVolumeOrderSql(membership: string, album: string): string {
  return `CASE WHEN NOT EXISTS (
      SELECT 1 FROM ingest.series_albums unnumbered
      JOIN ingest.catalog_albums visible ON visible.id=unnumbered.album_id
      WHERE unnumbered.series_id=${membership}.series_id AND unnumbered.volume_number IS NULL
    ) THEN ${membership}.volume_number END NULLS LAST,
    ${album}.release_year NULLS LAST, ${membership}.volume_number NULLS FIRST, ${album}.id`;
}
