import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { buildApp } from "../../src/api/app.js";
import {
  DeepSeekGateway,
  MemoryDeepSeekRunStore,
  MockDeepSeekTransport,
} from "../../src/ai/gateway.js";
import {
  findArtistIdentityCandidates,
  resolvePersonArtist,
  startPersonArtistJob,
  waitForPersonArtistJobs,
  latestPersonArtistJob,
} from "../../src/curation/ai/person-artist.js";
import { loadVerificationSnapshot } from "../../src/verification/snapshot.js";
import { undoRun } from "../../src/merge/run-undo.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import type { PersonArtistDependencies } from "../../src/curation/ai/person-artist.js";
import type { WebPage } from "../../src/ambiguity/web-search.js";

const token = "person-artist-resolution-test-0123456789";
const page: WebPage = {
  url: "https://fuente.example/jeremias",
  title: "Jeremías",
  content:
    "Carlos Eduardo López Ávila, conocido por su nombre artístico Jeremías, es un cantautor venezolano.",
  contentHash: "fixture",
  fetchedAt: "2026-10-10T00:00:00Z",
  origin: "page",
};
function deps(
  stageName = "Jeremías",
  content = page.content,
): PersonArtistDependencies {
  const p = { ...page, content };
  return {
    broker: {
      search: async () => [{ url: p.url, title: p.title, snippet: "" }],
      page: async () => p,
    },
    gateway: new DeepSeekGateway(
      {
        baseUrl: "https://mock.invalid",
        models: { fast: "flash", reasoning: "pro", vision: "vision" },
        maxTokens: 3000,
        timeoutMs: 5000,
      },
      new MockDeepSeekTransport(
        {
          isSolo: true,
          stageName,
          role: "cantautor",
          explanation: "Fuente documenta al solista.",
          conflicts: [],
          evidence: [{ source: 0, quote: content }],
        },
        { compatible: true, conflicts: [] },
      ),
      new MemoryDeepSeekRunStore(),
    ),
    research: async () => 1,
  };
}
describe("resolución automática del artista: transacción, identidad e investigación", () => {
  let container: PgContainer, app: FastifyInstance, personId: number;
  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    process.env["CRV_OPERATOR_TOKEN"] = token;
    resetEnvCache();
    await applyCore(container.name);
    await migrateUp();
    personId = Number(
      (
        await getPool().query(
          "INSERT INTO persons(name,real_name) VALUES('Carlos Eduardo López Ávila','Carlos Eduardo López Ávila') RETURNING id",
        )
      ).rows[0].id,
    );
    app = await buildApp();
  }, 180000);
  afterAll(async () => {
    await waitForPersonArtistJobs();
    await app?.close();
    await closeDb();
    delete process.env["CRV_OPERATOR_TOKEN"];
    resetEnvCache();
    await container?.stop();
  }, 60000);
  const notify = async () => undefined;
  it("protege datos y acciones de la resolución para administradores", async () => {
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/curation/ai/persons/${personId}/resolve-artist`,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/curation/ai/persons/${personId}/resolve-artist`,
        })
      ).statusCode,
    ).toBe(401);
    const response = await app.inject({
      method: "GET",
      url: `/curation/ai/persons/${personId}/resolve-artist`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toBeNull();
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("lee el nombre real existente en el informe de la persona", async () => {
    expect(
      (await loadVerificationSnapshot("person", personId)).units.find(
        (u) => u.key === "identity.realName",
      )?.value,
    ).toBe("Carlos Eduardo López Ávila");
  });
  it("no confunde una palabra del nombre real con otro artista", async () => {
    const id = Number(
      (
        await getPool().query(
          "INSERT INTO artists(name) VALUES('Eduardo') RETURNING id",
        )
      ).rows[0].id,
    );
    expect(
      await findArtistIdentityCandidates(
        getPool(),
        ["Carlos Eduardo López Ávila", "Jeremías"],
        personId,
      ),
    ).toEqual([]);
    await getPool().query("DELETE FROM artists WHERE id=$1", [id]);
  });
  it("crea solista, alias y vínculo juntos, investiga después y permite deshacer", async () => {
    const phases: string[] = [];
    const result = await resolvePersonArtist(
      personId,
      "QA",
      async (phase) => {
        phases.push(phase);
      },
      deps(),
    );
    expect(result.action).toBe("created");
    expect(result.artistId).toBeGreaterThan(0);
    expect(result.reports).toEqual({ artist: 1, person: 1 });
    expect(phases.indexOf("linking")).toBeLessThan(
      phases.indexOf("researching_artist"),
    );
    const artist = (
      await getPool().query("SELECT * FROM artists WHERE id=$1", [
        result.artistId,
      ])
    ).rows[0];
    expect(artist.artist_type).toBe("solo_artist");
    expect(artist.name).toBe("Jeremías");
    expect(
      (
        await getPool().query(
          "SELECT * FROM artist_members WHERE artist_id=$1 AND person_id=$2",
          [result.artistId, personId],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await getPool().query(
          "SELECT alias FROM ingest.person_aliases WHERE person_id=$1",
          [personId],
        )
      ).rows[0].alias,
    ).toBe("Jeremías");
    const again = await resolvePersonArtist(personId, "QA", notify, deps());
    expect(again.action).toBe("already_linked");
    expect(again.artistId).toBe(result.artistId);
    expect(again.runId).toBeNull();
    expect(
      (
        await getPool().query(
          "SELECT * FROM artist_members WHERE artist_id=$1",
          [result.artistId],
        )
      ).rows,
    ).toHaveLength(1);
    await withOperatorRun(
      { name: "qa:undo", operator: "QA", note: "Deshacer fixture automático" },
      (ctx) => undoRun(ctx, result.runId!),
    );
    expect(
      (
        await getPool().query("SELECT * FROM artists WHERE id=$1", [
          result.artistId,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await getPool().query(
          "SELECT * FROM ingest.person_aliases WHERE person_id=$1",
          [personId],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("reutiliza un artista encontrado por alias e incluye su discografía personal", async () => {
    const id = Number(
      (
        await getPool().query(
          "INSERT INTO artists(name,artist_type) VALUES('Jeremías Solista','solo_artist') RETURNING id",
        )
      ).rows[0].id,
    );
    await getPool().query(
      "INSERT INTO ingest.artist_aliases(artist_id,alias,normalized_alias,alias_type) VALUES($1,'Jeremías','jeremias','stage_name')",
      [id],
    );
    const album = Number(
      (
        await getPool().query(
          "INSERT INTO albums(artist_id,title) VALUES($1,'Disco del solista') RETURNING id",
          [id],
        )
      ).rows[0].id,
    );
    const result = await resolvePersonArtist(personId, "QA", notify, deps());
    expect(result.action).toBe("linked");
    expect(result.artistId).toBe(id);
    expect(
      (await loadVerificationSnapshot("person", personId)).albums.map(
        (a) => a.id,
      ),
    ).toContain(album);
    await withOperatorRun(
      { name: "qa:undo", operator: "QA", note: "Deshacer vínculo de fixture" },
      (ctx) => undoRun(ctx, result.runId!),
    );
    await getPool().query("DELETE FROM artists WHERE id=$1", [id]);
  });
  it("bloquea un nombre artístico ocupado por una banda", async () => {
    const id = Number(
      (
        await getPool().query(
          "INSERT INTO artists(name) VALUES('Jeremías') RETURNING id",
        )
      ).rows[0].id,
    );
    const result = await resolvePersonArtist(personId, "QA", notify, deps());
    expect(result.action).toBe("conflict");
    expect(result.runId).toBeNull();
    expect(result.conflicts.join(" ")).toContain("colectivo");
    await getPool().query("DELETE FROM artists WHERE id=$1", [id]);
  });
  it("no escribe con citas inventadas ni con identidades incompletas", async () => {
    const d = deps();
    d.broker = {
      search: async () => [{ url: page.url, title: "Fuente", snippet: "" }],
      page: async () => ({
        ...page,
        content: "Otra página sin identidad documental",
      }),
    };
    const result = await resolvePersonArtist(personId, "QA", notify, d);
    expect(result.action).toBe("conflict");
    expect(result.evidence).toEqual([]);
    expect(
      (await getPool().query("SELECT id FROM artists WHERE name='Jeremías'"))
        .rows,
    ).toHaveLength(0);
  });
  it("rechaza cambios concurrentes antes de crear o vincular y no deja altas parciales", async () => {
    const result = await resolvePersonArtist(
      personId,
      "QA",
      async (phase) => {
        if (phase === "linking")
          await getPool().query(
            "UPDATE persons SET notes='Cambio concurrente' WHERE id=$1",
            [personId],
          );
      },
      deps(),
    );
    expect(result.action).toBe("conflict");
    expect(result.conflicts.join(" ")).toContain("cambió");
    expect(
      (await getPool().query("SELECT id FROM artists WHERE name='Jeremías'"))
        .rows,
    ).toHaveLength(0);
  });
  it("conserva el vínculo y explica una investigación fallida; repetir POST reutiliza el trabajo activo", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const d = deps();
    d.research = async () => {
      await gate;
      throw new Error("Fuente temporalmente indisponible");
    };
    const first = await startPersonArtistJob(personId, "QA", d);
    const second = await startPersonArtistJob(personId, "QA", d);
    expect(second.id).toBe(first.id);
    release();
    await waitForPersonArtistJobs();
    const job = await latestPersonArtistJob(personId);
    expect(job?.status).toBe("done");
    expect(job?.result?.action).toBe("created");
    expect(job?.result?.pending).toHaveLength(2);
    expect(
      (
        await getPool().query(
          "SELECT id FROM artist_members WHERE person_id=$1",
          [personId],
        )
      ).rows,
    ).toHaveLength(1);
  });
});
