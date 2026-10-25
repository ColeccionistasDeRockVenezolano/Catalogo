// CRV · Acciones de administración de una ficha, arriba y siempre en el mismo
// lugar: «Editar ficha» como única acción principal, las secundarias a la
// vista y las destructivas en «Más», lejos del clic por inercia.
import type { ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { DotsThree, GitMerge, PencilSimple, Trash } from "@phosphor-icons/react";

export interface AdminAction { label: string; icon?: ReactNode; onClick: () => void }

interface EntityAdminBarProps {
  onEdit: () => void;
  onMerge?: () => void;
  onRemove?: () => void;
  /** Acciones secundarias propias de la ficha (dividir, investigar…). */
  extra?: readonly AdminAction[];
  /** Acciones poco frecuentes: van en «Más», junto a Retirar. */
  more?: readonly AdminAction[];
}

export function EntityAdminBar({ onEdit, onMerge, onRemove, extra = [], more = [] }: EntityAdminBarProps) {
  const overflow = [...more, ...(onRemove ? [{ label: "Retirar del catálogo", icon: <Trash size={16} weight="bold" aria-hidden="true" />, onClick: onRemove, danger: true }] : [])];
  return (
    <div className="page-actions entity-admin-bar" role="toolbar" aria-label="Administrar esta ficha">
      <span className="entity-admin-bar__label">Administrar</span>
      <button type="button" className="btn btn--sm btn--primary" onClick={onEdit}>
        <PencilSimple size={14} weight="bold" aria-hidden="true" />Editar
      </button>
      {onMerge ? (
        <button type="button" className="btn btn--sm" onClick={onMerge}>
          <GitMerge size={14} weight="bold" aria-hidden="true" />Fusionar con…
        </button>
      ) : null}
      {extra.map((action) => (
        <button key={action.label} type="button" className="btn btn--sm" onClick={action.onClick}>{action.icon}{action.label}</button>
      ))}
      {overflow.length ? (
        <Menu.Root>
          <Menu.Trigger className="btn btn--sm btn--ghost" aria-label="Más acciones">
            <DotsThree size={16} weight="bold" aria-hidden="true" />Más
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner sideOffset={6} align="end" className="recent-changes__positioner">
              <Menu.Popup className="entity-admin-menu">
                {overflow.map((action) => (
                  <Menu.Item key={action.label} onClick={action.onClick}
                    className={`entity-admin-menu__item${"danger" in action && action.danger ? " entity-admin-menu__item--danger" : ""}`}>
                    {action.icon}{action.label}
                  </Menu.Item>
                ))}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      ) : null}
    </div>
  );
}
