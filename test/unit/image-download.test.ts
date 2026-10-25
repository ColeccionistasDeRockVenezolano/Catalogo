import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadImage } from "../../src/merge/image-inspection.js";

describe("descarga de imágenes candidatas", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "crv-media-"));
    await mkdir(path.join(root, "album"));
    await writeFile(path.join(root, "album", "1-aq.jpg"), Buffer.from("jpeg"));
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });
  const never = async (): Promise<Response> => { throw new Error("no debe salir a la red"); };
  it("lee las copias locales del catálogo sin red y no sale de su carpeta", async () => {
    expect(await downloadImage("/crv/media/album/1-aq.jpg?w=640", never, root)).toEqual({ bytes: Buffer.from("jpeg") });
    expect(await downloadImage("/crv/media/album/2-aq.jpg", never, root)).toEqual({ error: "La copia local no existe" });
    expect(await downloadImage("/crv/media/..%2F..%2Fetc%2Fpasswd", never, root)).toEqual({ error: "Ruta local fuera de los medios del catálogo" });
  });
  it("solo reintenta fallos de red recuperables y rechaza una página", async () => {
    const failing = (message: string) => async (): Promise<Response> => { throw new Error(message); };
    expect(await downloadImage("http://a20.ac-images.myspacecdn.com/x.jpg", failing("getaddrinfo ENOTFOUND a20.ac-images.myspacecdn.com"), root)).toMatchObject({ transient: false });
    expect(await downloadImage("https://img.example/x.jpg", failing("read ECONNRESET"), root)).toMatchObject({ transient: true });
    expect(await downloadImage("https://img.example/x.jpg", async () => new Response("<html></html>", { headers: { "content-type": "text/html" } }), root)).toEqual({ error: "La dirección devuelve una página, no una imagen" });
  });
});
