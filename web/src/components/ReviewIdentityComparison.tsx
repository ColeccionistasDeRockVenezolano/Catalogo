import { useState } from "react";
import { Link } from "react-router-dom";
import { Users } from "@phosphor-icons/react";
import { mediaImage } from "../lib/media";
import { entityHref } from "../lib/routes";
import type { ClaimReviewEntity } from "../../../src/shared/claim-review";
import type { ReviewDetail } from "../lib/types";

function Identity({ entity,label }: { entity: ClaimReviewEntity;label: string }) {
  const [failed,setFailed] = useState(false);
  const image = entity.imageUrl && /^(https?:\/\/|\/(?!\/))/u.test(entity.imageUrl) ? entity.imageUrl : null;
  return <div className="review-identity__side"><span className="review-identity__label">{label}</span>
    <div className="review-identity__picture">{image && !failed ? <img {...mediaImage(image,200)} src={mediaImage(image,200).src} alt="" onError={() => setFailed(true)} /> : <Users size={42} aria-hidden="true" />}</div>
    <strong>{entity.name}</strong>{entity.context ? <p>{entity.context}</p> : null}
    {entity.id !== null ? <Link to={entityHref(entity.kind as "artist" | "person" | "album" | "track" | "organization",entity.id,entity.albumId ?? undefined)} target="_blank" rel="noopener noreferrer">Abrir ficha</Link> : null}
  </div>;
}
export function ReviewIdentityComparison({ context }: { context: ReviewDetail["identityContext"] }) {
  if (!context) return null;
  return <div className="review-identity" aria-label="Comparación visual de identidad"><Identity entity={context.incoming} label="Aporte por identificar" /><Identity entity={context.candidate} label="Posible ficha existente" /></div>;
}
