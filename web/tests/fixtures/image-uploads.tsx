import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { EntityFormModal } from "../../src/components/EntityFormModal";
import { Modal } from "../../src/components/Modal";
import { CatalogResourceEditor } from "../../src/components/CatalogResourceEditor";
import { CatalogProposalCard } from "../../src/components/CatalogProposalCard";
import { CurationImagesPage } from "../../src/pages/CurationImagesPage";
import { ARTIST_FIELDS, PERSON_FIELDS, ORGANIZATION_FIELDS, ALBUM_FIELDS } from "../../src/lib/entityFields";
import { albumWrites, artistWrites, organizationWrites, personWrites } from "../../src/lib/api";
import { setSessionCsrf } from "../../src/lib/operator";
import { ToastProvider } from "../../src/lib/ToastContext";
import type { CatalogOperation, CatalogPlan, CatalogVocabulary } from "../../../src/curation/ai/types";
import "../../src/styles/global.css";

setSessionCsrf("image-upload-qa-csrf");
const config = { artist: [ARTIST_FIELDS, artistWrites], person: [PERSON_FIELDS, personWrites], organization: [ORGANIZATION_FIELDS, organizationWrites], album: [ALBUM_FIELDS, albumWrites] } as const;
const operation = { op: "replace_fields", key: "qa-picture", label: "Cambiar foto", reason: "Foto documentada", evidenceIds: [], target: { kind: "artist", id: 1 }, values: { pictureUrl: "/crv/media/upload-before.webp" } } as CatalogOperation;
const plan = { status: "ready", entityKind: "artist", entityId: 1, draft: { operations: [operation] }, evidence: [], decisions: {}, preview: null } as unknown as CatalogPlan;
const vocabulary = { entities: { artist: [{ key: "pictureUrl", type: "string", nullable: true }] }, relations: {}, genres: [] } as unknown as CatalogVocabulary;

function Fixture() {
  const [surface, setSurface] = useState<string>();
  const close = () => setSurface(undefined);
  const entry = surface && surface in config ? config[surface as keyof typeof config] : undefined;
  return <main style={{ padding: 20 }}>
    <h1>Subidas de imágenes</h1>
    <div className="page-actions">{[...Object.keys(config), "version", "proposal", "curation"].map(key => <button className="btn" type="button" key={key} onClick={() => setSurface(key)}>{key}</button>)}</div>
    {entry ? <EntityFormModal title={`Imagen: ${surface}`} fields={entry[0].filter(field => field.type === "mediaUrl")} partial
      initialValues={{ pictureUrl: "/crv/media/upload-before.webp", logoUrl: "/crv/media/upload-before.webp", coverUrl: "/crv/media/upload-before.webp" }}
      onSubmit={(values, note) => entry[1].update(1, { ...values, note })} onSuccess={close} onClose={close} /> : null}
    {surface === "version" ? <Modal title="Portada de versión" onClose={close}><CatalogResourceEditor owner="album" id={1} resource="version" onChanged={close}/></Modal> : null}
    {surface === "proposal" ? <Modal title="Propuesta de foto" onClose={close}><CatalogProposalCard operation={operation} plan={plan} rootLabel="Artista de prueba" vocabulary={vocabulary} busy={false} processing={false}
      onDecide={op => { if (op.op === "replace_fields") void artistWrites.update(1, { ...op.values, note: "Foto documentada" }).then(close); }} onUndo={() => {}} /></Modal> : null}
    {surface === "curation" ? <CurationImagesPage/> : null}
  </main>;
}
createRoot(document.getElementById("root")!).render(<BrowserRouter><ToastProvider><Fixture/></ToastProvider></BrowserRouter>);
