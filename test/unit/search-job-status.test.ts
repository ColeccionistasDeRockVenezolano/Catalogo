import { describe, expect, it } from "vitest";
import { classifyJob, STALE_FACTOR, SEARCH_JOBS } from "../../src/search/job-status.js";

const now = new Date("2026-11-12T12:00:00Z");
const ago = (secs: number) => new Date(now.getTime() - secs * 1000);
const row = (cadence: number, ok: Date | null, err: Date | null = null) => ({ cadence_secs: cadence, last_ok_at: ok, last_error_at: err });

describe("latido de los trabajos del buscador", () => {
  it("sin fila o sin ninguna ejecución es «sin datos», no «detenido»", () => {
    expect(classifyJob(null, now)).toBe("sin_datos");
    expect(classifyJob(row(3600, null), now)).toBe("sin_datos");
  });
  it("con un latido reciente está al día", () => {
    expect(classifyJob(row(3600, ago(1800)), now)).toBe("al_dia");
    expect(classifyJob(row(3600, ago(STALE_FACTOR * 3600)), now)).toBe("al_dia");
  });
  it("pasado el doble de su cadencia sin latido correcto está detenido", () => {
    expect(classifyJob(row(3600, ago(STALE_FACTOR * 3600 + 1)), now)).toBe("detenido");
    expect(classifyJob(row(300, ago(601)), now)).toBe("detenido");
  });
  it("un fallo posterior al último éxito es «con error»; un éxito posterior lo borra", () => {
    expect(classifyJob(row(3600, ago(600), ago(60)), now)).toBe("con_error");
    expect(classifyJob(row(3600, null, ago(60)), now)).toBe("con_error");
    expect(classifyJob(row(3600, ago(60), ago(600)), now)).toBe("al_dia");
  });
  it("declara la cadencia de cada trabajo", () => {
    expect(SEARCH_JOBS.retention.cadenceSecs).toBe(3600);
    expect(SEARCH_JOBS.collector.cadenceSecs).toBe(300);
  });
});
