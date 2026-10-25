import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { knownYouTubeVideoIds } from "../../src/youtube/pipeline.js";

describe("universo de hidratación de YouTube", () => {
  let pg: PgContainer;
  beforeAll(async () => {
    pg = await startPgContainer(); process.env["DATABASE_URL"] = pg.databaseUrl; resetEnvCache();
    await applyCore(pg.name); await migrateUp();
  });
  afterAll(async () => { await closeDb(); await pg?.stop(); });

  it("incluye los videos registrados que nunca pasaron por la API", async () => {
    await getPool().query("INSERT INTO media.youtube_videos(video_id,url) VALUES('editorial01','https://youtu.be/editorial01')");
    await getPool().query(`INSERT INTO media.youtube_videos(video_id,url,publication_status,last_fetched_at)
      VALUES('hidratado01','https://youtu.be/hidratado01','published',now())`);

    const pending = await knownYouTubeVideoIds({ pendingOnly: true });
    expect(pending).toContain("editorial01");
    expect(pending).not.toContain("hidratado01");
    expect(await knownYouTubeVideoIds()).toContain("editorial01");
  });

  it("no repite un video que ya tiene ficha de la API", async () => {
    const ids = (await knownYouTubeVideoIds()).filter((id) => id === "editorial01");
    expect(ids).toHaveLength(1);
  });
});
